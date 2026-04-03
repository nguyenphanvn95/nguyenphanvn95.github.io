import argparse
import http.server
import mimetypes
import socketserver
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REMOTE_API = "https://api.xiangqi.com"


mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("image/webp", ".webp")


class LocalCloneHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
            self.end_headers()
            return

        super().do_OPTIONS()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.proxy_api()
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.proxy_api()
            return

        self.send_error(405, "Method not allowed")

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self.proxy_api()
            return

        self.send_error(405, "Method not allowed")

    def do_PATCH(self):
        if self.path.startswith("/api/"):
            self.proxy_api()
            return

        self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self.proxy_api()
            return

        self.send_error(405, "Method not allowed")

    def translate_path(self, path):
        translated = super().translate_path(path)
        requested = Path(translated)

        if requested.exists():
            return str(requested)

        if path == "/" or not Path(path).suffix:
            return str(ROOT / "index.html")

        return str(requested)

    def proxy_api(self):
        target_url = REMOTE_API + self.path[len("/api"):]
        body = None
        content_length = self.headers.get("Content-Length")
        if content_length:
            body = self.rfile.read(int(content_length))

        request_headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in {"host", "origin", "referer", "content-length"}
        }
        request_headers["User-Agent"] = "xiangqi-wasm-dev-localhost"

        request = urllib.request.Request(
            target_url,
            data=body,
            headers=request_headers,
            method=self.command,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                self.send_response(response.status)

                for key, value in response.getheaders():
                    lowered = key.lower()
                    if lowered in {"content-length", "transfer-encoding", "content-encoding", "connection"}:
                        continue
                    self.send_header(key, value)

                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(response.read())
        except urllib.error.HTTPError as error:
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type", "text/plain; charset=utf-8"))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(error.read())
        except Exception as error:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"API proxy error: {error}".encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Run the Xiangqi localhost clone.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    with socketserver.ThreadingTCPServer((args.host, args.port), LocalCloneHandler) as httpd:
        print(f"Local server running at http://{args.host}:{args.port}")
        print("Press Ctrl+C to stop.")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
