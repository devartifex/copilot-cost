import shutil, sys, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pricing_fetcher
from pricing_loader import load_pricing

ROOT = Path(__file__).resolve().parents[1]

class FetcherTests(unittest.TestCase):
    def test_fallback_to_snapshot_on_network_failure(self):
        dest = ROOT/'.test-home'/'pricing'/'pricing.yaml'
        if dest.exists(): dest.unlink()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with mock.patch('urllib.request.urlopen', side_effect=OSError('boom')):
            pricing_fetcher.refresh_pricing(force=True, dest=dest)
        self.assertTrue(dest.exists())
        self.assertIn('claude-opus-4.7', load_pricing(dest)['models'])

if __name__ == '__main__':
    unittest.main()
