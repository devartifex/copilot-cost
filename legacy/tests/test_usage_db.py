import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pricing_loader import compute_cost, get_model_price
from usage_db import connect, upsert_snapshot

ROOT = Path(__file__).resolve().parents[1]

class UsageDbTests(unittest.TestCase):
    def test_idempotent_upsert_unchanged_tokens(self):
        db = ROOT/'.test-home'/'usage'/'usage.db'
        if db.exists(): db.unlink()
        payload = json.loads((ROOT/'tests/fixtures/sample-payload.json').read_text())
        model, price = get_model_price(payload['model']['id'], ROOT/'pricing.snapshot.yaml')
        usd = compute_cost({'input':38200,'cache_read':12000,'cache_write':3100,'output':6100}, price)
        self.assertTrue(upsert_snapshot(payload, model, usd, path=db, ts='2026-05-13T00:00:00Z'))
        self.assertFalse(upsert_snapshot(payload, model, usd, path=db, ts='2026-05-13T00:00:01Z'))
        conn = connect(db)
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0], 1)
        conn.close()

if __name__ == '__main__':
    unittest.main()
