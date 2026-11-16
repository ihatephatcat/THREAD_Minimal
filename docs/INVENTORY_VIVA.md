# Inventory Manager viva guide

## Endpoints in Swagger

Open `/api/docs` and authorize with a JWT for an active `inventory_manager` or `admin` account. The [README](../README.md) describes how to seed the initial Admin for a local demo. Use an existing catalog variant ID throughout.

| Method and path | Expected response |
| --- | --- |
| `GET /api/inventory/stock?page=1&limit=20` | 200 with paginated variant balances and product details |
| `GET /api/inventory/stock/{variantId}` | 200 with one balance, or 404 for an unknown variant |
| `POST /api/inventory/receipts` | 201 with the new balance and a `receipt` movement |
| `POST /api/inventory/adjustments` | 201 with the new balance and an `adjustment` movement |
| `GET /api/inventory/movements?page=1&limit=20` | 200 with paginated movements, newest first |

Both list endpoints accept an optional exact `variantId` filter and return `meta.page`, `meta.limit`, and `meta.total`. Stock is sorted by SKU, then variant ID. Movements are sorted by creation time, then movement ID, both descending.

Receive ten units in **POST /api/inventory/receipts**. Replace the example UUID with your variant's ID.

```json
{
  "variantId": "aac08cc3-a4a6-4db5-84a2-946208da4741",
  "quantity": 10,
  "reason": "New supplier delivery"
}
```

Remove two units in **POST /api/inventory/adjustments**.

```json
{
  "variantId": "aac08cc3-a4a6-4db5-84a2-946208da4741",
  "delta": -2,
  "reason": "Damaged items"
}
```

Starting with an empty balance, the two responses report quantities 10 and 8. Entries in movement history record each signed change, its reason, when it happened, and the authenticated actor ID. Invalid UUIDs, blank reasons, and zero adjustments return 400. Missing authentication returns 401. A Customer or Staff token returns 403. A negative result or a result above the PostgreSQL integer limit returns 409.

## Walk through the code

1. The [controller](../src/modules/inventory/inventory.controller.ts) uses the shared JWT and role guards, validates request DTOs, and passes the authenticated user ID to the service.
2. The [service](../src/modules/inventory/inventory.service.ts) reads balances from TypeORM repositories. The shared [entities](../src/database/entities/inventory.entity.ts) map to PostgreSQL's `inventory_stock` and `inventory_movements` tables. Each variant has at most one balance row. A variant without a row displays zero. An increase can initialize that row.
3. A receipt or adjustment opens a transaction. An insert with conflict handling lets concurrent increases share one balance. The UPDATE checks both quantity bounds in SQL. PostgreSQL locks the matching row while writing and rechecks the condition after a competing write, so concurrent requests preserve the balance.
4. The service inserts the movement with the same transaction manager. If the movement insert fails, PostgreSQL rolls back the balance change, including a balance row created by that operation.

## Checkout and rollback demo

Checkout supplies its own transaction manager to `InventoryService.deductStock`. The method decreases the current balance only when enough units remain and creates a `sale` movement with the shopper's ID and order reference. A failed deduction rolls back the checkout transaction, including earlier deductions, movements, and order writes.

- In Swagger, read a variant's balance and filtered movement count. Submit a decrease larger than the balance and expect 409. Read both again to show that neither changed.
- In the dedicated PostgreSQL suite, **failed Inventory movement inserts roll back existing and newly created stock balances** deliberately fails the movement's actor foreign key after the balance write. The test confirms that an existing balance returns to its prior quantity and a newly created balance disappears.
- The checkout integration tests verify a successful sale, competing checkouts for the last unit, and rollback after a later deduction fails. The movement API includes the same checkout sale records.

## Course evidence

The module demonstrates guarded routes, request validation, paginated reads, entity relationships, PostgreSQL writes, and Swagger documentation. The concurrent-write and rollback tests provide evidence for the advanced database transaction and stock movement tracking bonus. They show that the database preserves the quantity bounds and commits the movement with the stock change.
