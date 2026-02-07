#!/usr/bin/env python3
"""
Mock HTTPS/HTTP receiver for forwarded webhooks from alertbridge-lite.
Use this to verify that alertbridge-lite really forwards payloads to a target.

Usage:
  # Terminal 1: start mock receiver (HTTP on 9999)
  python scripts/mock_receiver.py

  # Terminal 2: set target URL and start alertbridge-lite
  set TARGET_URL_OCP=http://127.0.0.1:9999/webhook
  set TARGET_URL_CONFLUENT=http://127.0.0.1:9999/webhook
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8081

  # Terminal 3: run load test
  python scripts/load_test_webhook.py

  Then open http://127.0.0.1:9999/ to see received payloads.

  Optional HTTPS (self-signed):
  python scripts/mock_receiver.py --https --port 8443
  (requires: pip install pyopenssl, or use --cert and --key from openssl)
"""
import argparse
import json
import ssl
import sys
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from urllib.parse import urlparse

RECEIVED: deque = deque(maxlen=200)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # quiet

    def do_POST(self):
        path = urlparse(self.path).path or "/"
        if path not in ("/", "/webhook"):
            self.send_response(404)
            self.end_headers()
            return
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""
        try:
            data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            data = {"_raw": body[:500].decode("utf-8", errors="replace")}

        request_id = self.headers.get("X-Request-ID", "")
        ts = datetime.now(timezone.utc).isoformat()[:23]
        RECEIVED.append({
            "ts": ts,
            "request_id": request_id,
            "path": path,
            "body": data,
        })
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}\n')

    def do_GET(self):
        path = urlparse(self.path).path or "/"
        if path == "/received":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(list(RECEIVED), indent=2).encode("utf-8"))
            return
        if path != "/":
            self.send_response(404)
            self.end_headers()
            return
        # HTML dashboard
        rows = []
        for r in reversed(list(RECEIVED)):
            body_preview = json.dumps(r["body"])[:120] + ("..." if len(json.dumps(r["body"])) > 120 else "")
            rows.append(
                f"<tr><td>{r['ts']}</td><td><code>{r['request_id'][:12]}</code></td>"
                f"<td><pre>{body_preview}</pre></td></tr>"
            )
        table_rows = "\n".join(rows) if rows else "<tr><td colspan='3'>No requests yet. Forward from alertbridge-lite to this URL.</td></tr>"
        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mock receiver</title>
<style>
  body {{ font-family: system-ui; margin: 24px; background: #1a1f26; color: #e6edf3; }}
  h1 {{ font-size: 20px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 12px; }}
  th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; }}
  th {{ background: #0d1117; color: #8b949e; font-size: 12px; text-transform: uppercase; }}
  pre {{ margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }}
  code {{ font-size: 11px; color: #7ee787; }}
  .count {{ color: #7ee787; font-weight: bold; }}
</style></head><body>
<h1>Mock receiver (forward target)</h1>
<p>Received: <span class="count">{len(RECEIVED)}</span> requests (last 200). Refresh to update.</p>
<table><thead><tr><th>Time (UTC)</th><th>Request ID</th><th>Body</th></tr></thead>
<tbody>{table_rows}</tbody></table>
<p><a href="/received" style="color:#58a6ff">/received</a> — JSON</p>
</body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="Mock webhook receiver for forward testing")
    ap.add_argument("--port", type=int, default=9999, help="Port to listen on")
    ap.add_argument("--host", default="127.0.0.1", help="Bind address")
    ap.add_argument("--https", action="store_true", help="Use HTTPS (self-signed cert)")
    ap.add_argument("--cert", default="", help="Path to TLS cert (with --https)")
    ap.add_argument("--key", default="", help="Path to TLS key (with --https)")
    args = ap.parse_args()

    server = HTTPServer((args.host, args.port), Handler)
    if args.https:
        if not args.cert or not args.key:
            print("HTTPS requires --cert and --key. Generate with:")
            print("  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj /CN=localhost")
            print("  python scripts/mock_receiver.py --https --cert cert.pem --key key.pem --port 8443")
            sys.exit(1)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(args.cert, args.key)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
    proto = "https" if args.https else "http"
    print(f"Mock receiver: {proto}://{args.host}:{args.port}/")
    print("  POST /webhook or /  -> accept forwarded payloads")
    print("  GET  /              -> view last 200 received")
    print("  GET  /received      -> JSON")
    print()
    print("Set env and run alertbridge-lite:")
    print(f"  TARGET_URL_OCP={proto}://127.0.0.1:{args.port}/webhook")
    print(f"  TARGET_URL_CONFLUENT={proto}://127.0.0.1:{args.port}/webhook")
    print()
    server.serve_forever()


if __name__ == "__main__":
    main()
