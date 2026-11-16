# Minimal THREAD API Contract

All application routes use the `/api` prefix. Open `/api/docs` on the running app to try the starter, Customer, Inventory, Staff, Public Catalog, and Admin routes.

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

## Live Customer routes

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

Checkout responses include `X-Response-Time` in milliseconds when the request reaches the route interceptor. See the [Customer viva and demo guide](CUSTOMER_VIVA.md) for the checkout flow and verification steps.

## Live Staff and Public Catalog routes

Staff CRUD requires Staff or Admin. Collection membership is managed by product create or update through `collectionIds`. An empty array clears product membership.

| Method | Path under `/api` | Access | Success |
| --- | --- | --- | --- |
| GET | `/staff/{resource}` | Staff or Admin | 200 paginated |
| GET | `/staff/{resource}/:id` | Staff or Admin | 200 |
| POST | `/staff/{resource}` | Staff or Admin | 201 |
| PATCH | `/staff/{resource}/:id` | Staff or Admin | 200 |
| DELETE | `/staff/{resource}/:id` | Staff or Admin | 204 |
| GET | `/products` | Public | 200 paginated |
| GET | `/products/:id` | Public | 200 |

| Resource | Create fields | Optional fields |
| --- | --- | --- |
| `categories` | `name`, `slug` | `description` |
| `collections` | `name`, `slug` | `description`, `isActive` |
| `products` | `name`, `slug`, `categoryId` | `description`, `collectionIds`, `isActive` |
| `variants` | `productId`, `sku`, `size`, `color`, `priceMinor` | `isActive` |

Staff reads include inactive records. Public reads show active products with their categories and active variants, including current prices. Product lists accept `categoryId`, Staff product lists also accept `isActive`, and Staff variant lists accept `productId`. Collection, product, and variant activation default to true. Category and collection descriptions may be null. Requests use lowercase URL slugs and nonnegative integer prices in BDT poisha.

Catalog writes validate referenced category, product, and collection IDs. A variant keeps its original parent after creation. Deletion conflicts follow the [specification](MINIMAL_THREAD_SPEC.md). See the [Staff viva guide](STAFF_VIVA.md) for example bodies and the catalog-to-checkout flow.

## Live Inventory routes

All these routes require the Inventory Manager or Admin role. Movements record the authenticated actor and the supplied reason. Stock and movement rows change together in one transaction.

| Method | Path | Body or result | Success |
| --- | --- | --- | --- |
| GET | `/api/inventory/stock` | Paginated balances and product details by variant, with optional `variantId` filter | 200 |
| GET | `/api/inventory/stock/:variantId` | Balance and product details for one existing variant | 200 |
| POST | `/api/inventory/receipts` | `{ variantId, quantity, reason }`. Positive receipt quantity | 201 |
| POST | `/api/inventory/adjustments` | `{ variantId, delta, reason }`. Nonzero signed integer | 201 |
| GET | `/api/inventory/movements` | Paginated newest-first movement history with optional `variantId` filter | 200 |

Detail and mutation routes return 404 for an unknown variant. Mutations return 409 when the result would be negative or exceed the PostgreSQL integer limit. A variant without a stock row has quantity zero. An increase can establish that row. A successful receipt or adjustment returns the updated balance and its movement. Movement history includes checkout sales.

## Live Admin routes

All these routes require an active Admin. The management API acts only on `staff` and `inventory_manager` accounts and returns `id`, `name`, `email`, `role`, `isActive`, `createdAt`, and `updatedAt`. `GET /api/admin/access` also remains available for checking the signed-in Admin's access.

| Method | Path | Body or result | Success |
| --- | --- | --- | --- |
| GET | `/api/admin/staff` | Paginated active and inactive managed accounts, sorted by name then ID. Optional `role` and `isActive` filters. | 200 |
| GET | `/api/admin/staff/:id` | Staff account detail | 200 |
| POST | `/api/admin/staff` | `{ email, name, password, role }`. Creates an active managed account. | 201 |
| PATCH | `/api/admin/staff/:id` | Subset of `{ name, email, role, isActive }` | 200 |
| DELETE | `/api/admin/staff/:id` | Set `isActive` to false. Repeated deactivation also succeeds. | 204 |

Deactivation retains the employee ID and inventory movement attribution. Login and previously issued tokens are rejected while the account is inactive. Admin can reactivate a managed account through PATCH. Missing or unmanaged IDs return 404. Creation and email changes use existing email normalization and return 409 for a duplicate email. Creation uses the shared bcrypt helper, and management responses exclude password hashes.
