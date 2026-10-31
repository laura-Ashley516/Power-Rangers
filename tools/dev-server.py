"""Serve app/ on http://localhost:8000 with caching turned off (so every reload runs the latest code).
Usage: python3 tools/dev-server.py [port]"""
import http.server, functools, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
http.server.ThreadingHTTPServer(('', port), functools.partial(NoCache, directory=root)).serve_forever()
