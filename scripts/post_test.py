#!/usr/bin/env python3
"""
Post-deployment API test. Verifies key endpoints respond correctly.
Run: python scripts/post_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

TESTS = [
    ("GET", "/healthz", lambda r: r.status_code == 200),
    ("GET", "/readyz", lambda r: r.status_code == 200 and "ready" in r.json()),
    ("GET", "/api/stats", lambda r: r.status_code == 200),
    ("GET", "/api/recent-requests", lambda r: r.status_code == 200 and isinstance(r.json(), list)),
    ("GET", "/api/recent-failed", lambda r: r.status_code == 200 and isinstance(r.json(), list)),
    ("GET", "/api/target-status", lambda r: r.status_code == 200),
    ("GET", "/api/config/targets", lambda r: r.status_code == 200 and isinstance(r.json(), list)),
    ("GET", "/metrics", lambda r: r.status_code == 200),
    ("POST", "/webhook/ocp", lambda r: r.status_code in (200, 202, 401, 404)),
]


def main():
    passed = 0
    for method, path, check in TESTS:
        if method == "GET":
            r = client.get(path)
        else:
            r = client.post(path, json={"status": "firing", "alerts": [{"labels": {"alertname": "Test"}}]})
        ok = check(r)
        status = "PASS" if ok else "FAIL"
        print(f"{status} {method} {path} -> {r.status_code}")
        if ok:
            passed += 1
    print("---")
    print(f"Post Test: {passed}/{len(TESTS)} passed")
    return 0 if passed == len(TESTS) else 1


if __name__ == "__main__":
    sys.exit(main())
