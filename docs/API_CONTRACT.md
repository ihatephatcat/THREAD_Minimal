# Minimal THREAD API Contract

All application routes use the `/api` prefix. Run the starter and open `/api/docs` to try the live routes. This contract also lists the routes planned for domain implementation.

## Live starter routes

| Method | Path | Access | Body or result | Success |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Public | `{ status: "ok" }` | 200 |
| POST | `/api/auth/register` | Public | Accepts `email`, `name`, `password`. Returns `{ accessToken, user }` | 201 |
| POST | `/api/auth/login` | Public | Accepts `email`, `password`. Returns `{ accessToken, user }` | 200 |
| GET | `/api/auth/me` | Any active user | Returns `{ id, email, name, role }` | 200 |
| GET | `/api/admin/access` | Admin | Returns the authenticated Admin's public user fields | 200 |

Send `Authorization: Bearer <accessToken>` on protected routes. Request DTOs reject extra fields. UUID route parameters must be UUID v4. List routes use `page` and `limit`, with defaults of 1 and 20 and a maximum limit of 100. Apply deterministic ordering with an ID tie-breaker.

The interceptor wraps successes as `{ "success": true, "data": ... }`. Lists use a `meta` object with `page`, `limit`, and `total`. Successful 204 responses have an empty body. Errors use `{ "success": false, "statusCode": 400, "message": [...], "requestId": "..." }`. The `message` may be a string, and the `X-Request-Id` header matches the response ID. Use 400 for invalid input, 401 for missing or invalid authentication, 403 for a disallowed role, 404 for an unknown or unowned resource, and 409 for duplicate data, stock conflicts, or restricted deletes.

## Customer routes to implement

All these routes require Customer. Use the logged-in user's ID for repository filters. Address fields are defined by `CreateAddressDto`. For patch requests accept a subset of fields. Catalog prices and quantities shown in the cart are informational until checkout.

| Method | Path | Body or result | Success |
| --- | --- | --- | --- |
| GET | `/api/customers/me` | Customer profile | 200 |
| PATCH | `/api/customers/me` | `name` | 200 |
| GET | `/api/addresses` | Paginated owned addresses | 200 |
| GET | `/api/addresses/:id` | One owned address | 200 |
| POST | `/api/addresses` | Address fields | 201 |
| PATCH | `/api/addresses/:id` | Address updates | 200 |
| DELETE | `/api/addresses/:id` | Delete owned address | 204 |
| GET | `/api/cart` | Current cart with items. Return an empty cart representation before first mutation | 200 |
| PUT | `/api/cart/items/:variantId` | Set or create item quantity using `{ quantity }`. Return updated cart | 200 |
| DELETE | `/api/cart/items/:variantId` | Remove the owned cart item | 204 |
| POST | `/api/checkout` | `{ addressId }`. Return placed order and items | 201 |
| GET | `/api/orders` | Paginated owned order summaries, newest first | 200 |
| GET | `/api/orders/:id` | Owned order with item and shipping snapshots | 200 |

Cart quantity is an integer from 1 to 1,000. Checkout uses current catalog prices, returns 409 for inactive cart variants, and uses the transaction defined in the specification. A cart edit performs no stock write.

## Staff catalog routes to implement

Each resource has the following endpoints. Collection membership is managed by product create or update through `collectionIds`. An empty array clears product membership.

| Method | Path under `/api` | Access | Success |
| --- | --- | --- | --- |
| GET | `/{resource}` | Public | 200 paginated |
| GET | `/{resource}/:id` | Public | 200 |
| POST | `/{resource}` | Staff | 201 |
| PATCH | `/{resource}/:id` | Staff | 200 |
| DELETE | `/{resource}/:id` | Staff | 204 |

| Resource | Create fields | Optional fields |
| --- | --- | --- |
| `categories` | `name`, `slug` | `description` |
| `collections` | `name`, `slug` | `description` |
| `products` | `name`, `slug`, `categoryId` | `description`, `collectionIds`, `isActive` |
| `variants` | `productId`, `sku`, `size`, `color`, `priceMinor` | `isActive` |

Use the entity length limits, lowercase URL slugs, and nonnegative integer prices. Public reads show active products and active variants whose parent is active. Add Staff-only `GET /api/staff/products` and `GET /api/staff/variants` paginated lists that include inactive records. Use the returned IDs for updates and deletes. Validate referenced category, product, and collection IDs before writing. Keep a variant on its original product after creation. Delete conflicts follow the rules in the specification.

## Inventory routes to implement

All these routes require Inventory Manager. Movements record the user from the token and a reason supplied in the request. Stock and movement rows change together in one transaction.

| Method | Path | Body or result | Success |
| --- | --- | --- | --- |
| GET | `/api/inventory/stock` | Paginated counts by variant | 200 |
| GET | `/api/inventory/stock/:variantId` | Count for one existing variant | 200 |
| POST | `/api/inventory/receipts` | `{ variantId, quantity, reason }`. Positive receipt quantity | 201 |
| POST | `/api/inventory/adjustments` | `{ variantId, delta, reason }`. Nonzero signed integer | 201 |
| GET | `/api/inventory/movements` | Paginated newest-first movement history with optional `variantId` filter | 200 |

Return 404 for an unknown variant and 409 for an adjustment that would bring stock below zero. A variant without a stock row has quantity zero.

## Admin routes to implement

All these routes require Admin. A staff account must have role `staff` or `inventory_manager`. The management API acts only on staff accounts and returns public fields with `isActive`.

| Method | Path | Body or result | Success |
| --- | --- | --- | --- |
| GET | `/api/admin/staff` | Paginated staff and inventory accounts | 200 |
| GET | `/api/admin/staff/:id` | Staff account detail | 200 |
| POST | `/api/admin/staff` | `{ email, name, password, role }` | 201 |
| PATCH | `/api/admin/staff/:id` | Subset of `{ name, role, isActive }` | 200 |

Apply staff account deactivation through `isActive` so inventory movement attribution is retained. Return 404 for an ID outside the staff account set. Store passwords with the shared bcrypt helper and project responses to their public fields.
