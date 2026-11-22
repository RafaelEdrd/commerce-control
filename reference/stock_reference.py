"""In-memory stock reference with atomic reservations and an auditable ledger.

The public example models invariants, not financial, warehouse or ERP integration.
"""

from __future__ import annotations
from dataclasses import dataclass
from copy import deepcopy
from hashlib import sha256
import json


class StockError(ValueError):
    pass


@dataclass(frozen=True)
class Movement:
    warehouse: str
    sku: str
    physical_delta: int
    reserved_delta: int
    action: str
    reference: str


class Stock:
    def __init__(self, starting: dict[tuple[str, str], int]):
        if any(not isinstance(n, int) or n < 0 for n in starting.values()):
            raise StockError("invalid opening balance")
        self.opening = starting.copy()
        self.physical = starting.copy()
        self.reserved = {key: 0 for key in starting}
        self.ledger: list[Movement] = []
        self.orders: dict[str, dict] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}

    def available(self, warehouse: str, sku: str) -> int:
        key = (warehouse, sku)
        return self.physical.get(key, 0) - self.reserved.get(key, 0)

    def reserve(self, warehouse: str, items: dict[str, int], order: str, request_key: str) -> dict:
        if not request_key or not order or not items:
            raise StockError("missing order, items or idempotency key")
        if any(not isinstance(n, int) or n <= 0 for n in items.values()):
            raise StockError("quantities must be positive integers")
        fingerprint = sha256(json.dumps([warehouse, sorted(items.items()), order],
                                       separators=(',', ':')).encode()).hexdigest()
        if request_key in self.idempotency:
            original_fingerprint, original_order = self.idempotency[request_key]
            if fingerprint != original_fingerprint:
                raise StockError("idempotency key reused with a different payload")
            return deepcopy(self.orders[original_order])
        if order in self.orders:
            raise StockError("order already exists")
        # Preflight the full basket before modifying any quantity.
        for sku, quantity in items.items():
            if (warehouse, sku) not in self.physical:
                raise StockError(f"unknown SKU: {sku}")
            if self.available(warehouse, sku) < quantity:
                raise StockError(f"insufficient stock: {sku}")
        for sku, quantity in sorted(items.items()):
            key = (warehouse, sku)
            self.reserved[key] = self.reserved.get(key, 0) + quantity
            self.ledger.append(Movement(warehouse, sku, 0, quantity, 'reserve', order))
        receipt = {'id': order, 'warehouse': warehouse, 'items': items.copy(), 'status': 'reserved'}
        self.orders[order] = receipt
        self.idempotency[request_key] = fingerprint, order
        return deepcopy(receipt)

    def cancel(self, order: str) -> None:
        receipt = self.orders.get(order)
        if not receipt or receipt['status'] != 'reserved':
            raise StockError("order is not reserved")
        for sku, quantity in sorted(receipt['items'].items()):
            key = (receipt['warehouse'], sku)
            self.reserved[key] -= quantity
            self.ledger.append(Movement(receipt['warehouse'], sku, 0, -quantity, 'cancel', order))
        receipt['status'] = 'cancelled'

    def transfer(self, source: str, target: str, items: dict[str, int], reference: str) -> None:
        if source == target or not items or not reference:
            raise StockError("invalid transfer")
        for sku, quantity in items.items():
            if not isinstance(quantity, int) or quantity <= 0:
                raise StockError("invalid quantity")
            if self.available(source, sku) < quantity:
                raise StockError(f"insufficient transferable quantity: {sku}")
        for sku, quantity in sorted(items.items()):
            from_key, to_key = (source, sku), (target, sku)
            self.physical[from_key] -= quantity
            self.physical[to_key] = self.physical.get(to_key, 0) + quantity
            self.ledger.extend([
                Movement(source, sku, -quantity, 0, 'transfer-out', reference),
                Movement(target, sku, quantity, 0, 'transfer-in', reference),
            ])

    def reconcile(self) -> list[dict]:
        deltas: dict[tuple[str, str], list[int]] = {}
        for movement in self.ledger:
            pair = deltas.setdefault((movement.warehouse, movement.sku), [0, 0])
            pair[0] += movement.physical_delta
            pair[1] += movement.reserved_delta
        issues = []
        for key in set(self.opening) | set(self.physical) | set(deltas):
            start = self.opening.get(key, 0)
            physical_delta, reserved_delta = deltas.get(key, [0, 0])
            if (start + physical_delta != self.physical.get(key, 0)
                    or reserved_delta != self.reserved.get(key, 0)):
                issues.append({'warehouse': key[0], 'sku': key[1], 'issue': 'ledger mismatch'})
        return sorted(issues, key=lambda item: (item['warehouse'], item['sku']))


def main() -> None:
    stock = Stock({('central', 'P-100'): 10, ('central', 'P-200'): 5})
    print(stock.reserve('central', {'P-100': 2, 'P-200': 1}, 'order-1', 'request-1'))
    print('available P-100:', stock.available('central', 'P-100'))
    print('reconciliation:', stock.reconcile())


if __name__ == '__main__':
    main()
