import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stock_reference', ROOT / 'reference/stock_reference.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.stock = module.Stock({('central', 'X'): 10, ('central', 'Y'): 2})

    def test_multiline_reservation(self):
        result = self.stock.reserve('central', {'X': 2, 'Y': 1}, 'order-1', 'req-1')
        self.assertEqual(result['status'], 'reserved')
        self.assertEqual(self.stock.available('central', 'X'), 8)
        self.assertEqual(self.stock.available('central', 'Y'), 1)
        self.assertEqual(self.stock.reconcile(), [])

    def test_insufficient_stock_has_no_partial_updates(self):
        with self.assertRaisesRegex(module.StockError, 'insufficient'):
            self.stock.reserve('central', {'X': 2, 'Y': 99}, 'order-1', 'req-1')
        self.assertEqual(self.stock.available('central', 'X'), 10)
        self.assertEqual(self.stock.ledger, [])

    def test_idempotent_retry_and_conflicting_reuse(self):
        first = self.stock.reserve('central', {'X': 2}, 'order-1', 'req-1')
        self.assertEqual(first, self.stock.reserve('central', {'X': 2}, 'order-1', 'req-1'))
        self.assertEqual(len(self.stock.ledger), 1)
        with self.assertRaisesRegex(module.StockError, 'idempotency'):
            self.stock.reserve('central', {'X': 3}, 'order-2', 'req-1')

    def test_cancel_releases_reserved_quantities(self):
        self.stock.reserve('central', {'X': 2}, 'order-1', 'req-1')
        self.stock.cancel('order-1')
        self.assertEqual(self.stock.available('central', 'X'), 10)
        self.assertEqual(self.stock.reconcile(), [])

    def test_transfer_and_detect_tampering(self):
        self.stock.transfer('central', 'branch', {'X': 3}, 'transfer-1')
        self.assertEqual(self.stock.available('branch', 'X'), 3)
        self.assertEqual(self.stock.reconcile(), [])
        self.stock.physical[('central', 'X')] += 1
        self.assertEqual(self.stock.reconcile()[0]['issue'], 'ledger mismatch')

    def test_invalid_opening_balances_rejected(self):
        with self.assertRaises(module.StockError):
            module.Stock({('central', 'X'): -1})


if __name__ == '__main__':
    unittest.main()
