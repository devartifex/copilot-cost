import os, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pricing_loader import compute_cost, get_model_price, load_pricing, normalize_model

ROOT = Path(__file__).resolve().parents[1]

class PricingTests(unittest.TestCase):
    def test_pricing_math_known_models(self):
        prices = load_pricing(ROOT / 'pricing.snapshot.yaml')['models']
        tokens = {'input': 1_000_000, 'cache_read': 100_000, 'cache_write': 100_000, 'output': 100_000}
        self.assertAlmostEqual(compute_cost(tokens, prices['claude-opus-4.7']), 7.175)
        self.assertAlmostEqual(compute_cost(tokens, prices['gpt-5.4']), 3.775)
        self.assertAlmostEqual(compute_cost(tokens, prices['claude-haiku-4.5']), 1.435)

    def test_alias_normalization_and_unknown(self):
        self.assertEqual(normalize_model('claude-opus-4.7-1m-internal'), 'claude-opus-4.7')
        self.assertEqual(normalize_model('gpt-5.4-fast'), 'gpt-5.4')
        model, row = get_model_price('missing-model', ROOT / 'pricing.snapshot.yaml')
        self.assertEqual(model, 'missing-model')
        self.assertIsNone(row)

if __name__ == '__main__':
    unittest.main()
