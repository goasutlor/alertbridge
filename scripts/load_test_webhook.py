#!/usr/bin/env python3
"""
Simulate random HTTPS/HTTP webhook traffic to alertbridge-lite.
Measures how many requests the app can accept (RPS, latency).

Usage:
  # App must be running first (e.g. uvicorn app.main:app --host 0.0.0.0 --port 8080)
  python scripts/load_test_webhook.py
  python scripts/load_test_webhook.py --base-url https://localhost:8443 --duration 30 --concurrency 20
  python scripts/load_test_webhook.py --insecure  # skip TLS verify for self-signed
  python scripts/load_test_webhook.py --api-key YOUR_API_KEY  # if API key auth is enabled
"""
import argparse
import asyncio
import random
import statistics
import sys
import time
from pathlib import Path

# Allow run from project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

# Sources from rules.example.yaml
SOURCES = ("ocp", "confluent")

# Random OCP Alertmanager-style payloads
OCP_PAYLOADS = [
    {
        "status": "firing",
        "labels": {"severity": "critical", "alertname": "HighCPU", "instance": "node-1"},
        "annotations": {"summary": "CPU above 90%", "description": "Node node-1 CPU high"},
        "startsAt": "2025-02-02T10:00:00Z",
        "generatorURL": "http://prometheus/graph",
    },
    {
        "status": "firing",
        "labels": {"severity": "warning", "alertname": "DiskSpace", "job": "node"},
        "annotations": {"summary": "Disk usage > 80%"},
        "startsAt": "2025-02-02T10:05:00Z",
    },
    {
        "status": "resolved",
        "labels": {"severity": "info", "alertname": "PodRestart"},
        "annotations": {"summary": "Pod restarted"},
        "endsAt": "2025-02-02T10:10:00Z",
    },
]

# Random Confluent-style payloads
CONFLUENT_PAYLOADS = [
    {"alertId": "a1", "description": "Broker down", "severity": "high"},
    {"alertId": "a2", "description": "Under replicated partitions", "severity": "medium"},
]


def random_payload(source: str) -> dict:
    if source == "ocp":
        p = random.choice(OCP_PAYLOADS).copy()
        p["labels"] = {**p["labels"], "instance": f"node-{random.randint(1, 20)}"}
        return p
    return random.choice(CONFLUENT_PAYLOADS).copy()


async def send_one(
    client: httpx.AsyncClient,
    base_url: str,
    source: str,
    api_key: str | None = None,
) -> tuple[float, int]:
    """Send one POST /webhook/{source}. Returns (latency_sec, status_code)."""
    url = f"{base_url.rstrip('/')}/webhook/{source}"
    payload = random_payload(source)
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key
    start = time.perf_counter()
    try:
        r = await client.post(url, json=payload, headers=headers, timeout=10.0)
        return time.perf_counter() - start, r.status_code
    except Exception:
        return time.perf_counter() - start, 0


async def worker(
    client: httpx.AsyncClient,
    base_url: str,
    duration: float,
    results: list,
    api_key: str | None = None,
) -> None:
    end_at = time.perf_counter() + duration
    while time.perf_counter() < end_at:
        source = random.choice(SOURCES)
        lat, status = await send_one(client, base_url, source, api_key)
        results.append((lat, status))


async def run_load_test(
    base_url: str,
    duration: float,
    concurrency: int,
    insecure: bool,
    api_key: str | None = None,
) -> None:
    timeout = httpx.Timeout(5.0)
    client = httpx.AsyncClient(timeout=timeout, verify=not insecure)

    # Check app is reachable (same port as webhook)
    health_url = f"{base_url.rstrip('/')}/healthz"
    auth_info = f" (with API key)" if api_key else " (no API key)"
    print(f"Target: {base_url}  (webhook: POST {base_url.rstrip('/')}/webhook/{{ocp|confluent}}){auth_info}")
    try:
        r = await client.get(health_url)
        if r.status_code != 200:
            print(f"ERROR: App returned {r.status_code} at {health_url}. Is alertbridge-lite running on this port?")
            await client.aclose()
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: Cannot reach app at {base_url}")
        print(f"       {e}")
        print("       Make sure alertbridge-lite is running (e.g. uvicorn app.main:app --port 8081)")
        print("       If app runs on 8080, use: python scripts/load_test_webhook.py --base-url http://127.0.0.1:8080")
        await client.aclose()
        sys.exit(1)

    results: list[tuple[float, int]] = []
    try:
        workers = [
            worker(client, base_url, duration, results, api_key)
            for _ in range(concurrency)
        ]
        await asyncio.gather(*workers)
    finally:
        await client.aclose()

    total = len(results)
    if total == 0:
        print("No requests completed.")
        return

    latencies = [r[0] for r in results]
    ok = sum(1 for _, s in results if 200 <= s < 300)
    accepted = sum(1 for _, s in results if s in (200, 202))
    errors_401 = sum(1 for _, s in results if s == 401)
    errors_404 = sum(1 for _, s in results if s == 404)
    errors_other = sum(1 for _, s in results if s not in (200, 202, 401, 404) and s >= 400)

    print("\n--- Load test result ---")
    print(f"Base URL:        {base_url}")
    print(f"Duration:        {duration:.1f}s  Concurrency: {concurrency}")
    print(f"Total requests:  {total}")
    print(f"2xx (ok):        {ok}  (200/202 accepted: {accepted})")
    print(f"Errors:          {total - ok}")
    if errors_401 > 0:
        print(f"  401 Unauthorized: {errors_401} (API key required or invalid)")
    if errors_404 > 0:
        print(f"  404 Not Found: {errors_404} (route/source not configured)")
    if errors_other > 0:
        print(f"  Other 4xx/5xx: {errors_other}")
    print(f"RPS:             {total / duration:.1f}")
    if latencies:
        latencies.sort()
        print(f"Latency p50:     {latencies[int(len(latencies) * 0.50)] * 1000:.0f} ms")
        print(f"Latency p95:     {latencies[int(len(latencies) * 0.95)] * 1000:.0f} ms")
        print(f"Latency p99:     {latencies[min(int(len(latencies) * 0.99), len(latencies) - 1)] * 1000:.0f} ms")
        print(f"Latency mean:    {statistics.mean(latencies) * 1000:.0f} ms")
    print("------------------------\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Simulate webhook load to alertbridge-lite")
    ap.add_argument("--base-url", default="http://127.0.0.1:8081", help="App base URL; must match port where uvicorn runs (e.g. 8080 or 8081)")
    ap.add_argument("--duration", type=float, default=15, help="Run for N seconds")
    ap.add_argument("--concurrency", type=int, default=10, help="Concurrent workers")
    ap.add_argument("--insecure", action="store_true", help="Skip TLS verify (e.g. self-signed)")
    ap.add_argument("--api-key", default=None, help="API key for authentication (if required). Use X-API-Key header.")
    args = ap.parse_args()

    asyncio.run(run_load_test(args.base_url, args.duration, args.concurrency, args.insecure, args.api_key))


if __name__ == "__main__":
    main()
