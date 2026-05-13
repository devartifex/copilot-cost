import json, sys, threading, unittest, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dashboard.server import make_server

class DashboardTests(unittest.TestCase):
    def test_summary_endpoint_and_local_bind_only(self):
        with self.assertRaises(ValueError):
            make_server('0.0.0.0', 0)
        srv = make_server('127.0.0.1', 0)
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{srv.server_address[1]}/api/summary'
            with urllib.request.urlopen(url, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode())
            self.assertIn('lifetime', data)
            self.assertIn('today', data)
            self.assertIn('week', data)
        finally:
            srv.shutdown(); srv.server_close(); thread.join(timeout=5)

if __name__ == '__main__':
    unittest.main()
