import json, os, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cost_statusline

ROOT = Path(__file__).resolve().parents[1]

class RenderTests(unittest.TestCase):
    def test_render_fixture(self):
        os.environ['COPILOT_COST_NO_COLOR'] = '1'
        try:
            payload = json.loads((ROOT/'tests/fixtures/sample-payload.json').read_text())
            line = cost_statusline.render_payload(payload, persist=False)
            self.assertEqual(line, '$0.2934 · 23.1k in / 6.1k out · 15.1k cache')
        finally:
            os.environ.pop('COPILOT_COST_NO_COLOR', None)

    def test_null_model_zero_tokens(self):
        self.assertEqual(cost_statusline.render_payload({'model': {'id': None}, 'context_window': {}, 'cost': {}}, persist=False), '$0.00')

    def test_unknown_model(self):
        line = cost_statusline.render_payload({'model': {'id': 'unknown-fast'}, 'context_window': {'total_input_tokens': 1}, 'cost': {}}, persist=False)
        self.assertIn('$?', line)
        self.assertIn('unknown', line)

    def test_install_uses_temp_home(self):
        home = ROOT/'.test-home'/'install'
        if home.exists():
            import shutil; shutil.rmtree(home)
        home.mkdir(parents=True)
        old_home = os.environ.get('HOME')
        os.environ['HOME'] = str(home)
        try:
            original = cost_statusline.refresh_pricing
            cost_statusline.refresh_pricing = lambda force=False: ROOT/'pricing.snapshot.yaml'
            self.assertEqual(cost_statusline.cmd_install(type('A', (), {})()), 0)
            settings = json.loads((home/'.copilot/settings.json').read_text())
            self.assertIn('statusLine', settings)
            self.assertIn('cost_statusline.py', settings['statusLine']['command'])
        finally:
            cost_statusline.refresh_pricing = original
            if old_home is not None: os.environ['HOME'] = old_home

if __name__ == '__main__':
    unittest.main()
