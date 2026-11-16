# Minimal THREAD viva reference

Minimal THREAD is a NestJS 11 and PostgreSQL REST API for a single-brand shop. Swagger at `/api/docs` documents 50 application operations. The [final Swagger guide](FINAL_SWAGGER_DEMO.md) connects the four roles in one purchase.

## Architecture and permissions

Controllers bind HTTP routes and validate input through DTOs. Services enforce business rules and call TypeORM repositories or a transaction manager. Repositories read and write the shared PostgreSQL entities. The application registers authentication and role guards, validation, exception handling, and the success interceptor once.

| Role or route group | Operations | Responsibility |
| --- | ---: | --- |
| Customer | 13 | Own profile, addresses, cart, cash-on-delivery checkout, and order history |
| Staff | 20 | Full CRUD for categories, collections, products, and variants. Admin can also use these routes. |
| Inventory Manager | 5 | Read stock, receive stock, adjust stock, and read movements. Admin can also use these routes. |
| Admin | 6 | Verify Admin access, create and manage employees, and deactivate employee accounts |
| Public catalog | 2 | Browse active products and their active variants with current prices |
| Health and Auth | 4 | Check health, register a Customer, log in, and read the current active identity |

## Relationships

- A user has many addresses and orders, and at most one cart. Each cart has multiple items, with a unique cart and variant pair.
- A category has many products. A product has many variants and can belong to many collections through the composite-key `product_collections` table.
- A variant has at most one stock balance and can have many movements. Every movement identifies its variant and the actor. Deactivating an employee keeps that actor's ID.
- An order has many order items. Shipping address and purchased item details are snapshots, so later catalog or address changes preserve order history.

The [entities](../src/database/entities) define these relationships. The [migrations](../src/database/migrations) create foreign keys, uniqueness constraints, and quantity checks. TypeORM uses migrations with automatic schema synchronization disabled.

## Authentication and validation

Public registration creates a Customer. The initial Admin comes from the local seed, and the Admin API creates Staff and Inventory Manager accounts. The shared password helper stores bcrypt hashes at cost 12. Login verifies the password and issues a signed JWT with the user ID in its subject.

For each protected request, the JWT guard verifies signature and expiry and loads the active user from PostgreSQL. The role guard reads `@Roles()` metadata. `@CurrentUser()` supplies the authenticated ID for scoped Customer queries and movement attribution. `@Public()` allows anonymous access on designated routes. Missing or expired authentication returns 401. A valid identity with the wrong role receives 403.

Separate create and update DTOs validate UUIDs, required values, integer money and quantities, and field lengths. The global `ValidationPipe` transforms query inputs and rejects unknown properties with 400. For example, public registration rejects a supplied `role`.

## CRUD, pagination, and errors

The four Staff resources each expose POST, paginated GET, GET by ID, PATCH, and DELETE. POST returns 201. Reads and updates return 200, and successful DELETE returns an empty 204. Page requests use `page` and `limit`, default to 1 and 20, cap the limit at 100, and sort with an ID tie-breaker.

The success interceptor wraps data in `{ success, data }` and adds `meta` to paginated lists. The exception filter returns `{ success: false, statusCode, message, requestId }`. A missing or unowned Customer resource returns 404. A duplicate unique value, restricted delete, or insufficient stock returns 409. Unexpected errors return a generic 500.

## Checkout, stock, and rollback

1. Checkout starts one TypeORM transaction, locks the customer's cart, and checks the delivery address belongs to that customer. Cart edits compete for the same lock.
2. Catalog returns active variants from active products and their current server-side prices. Checkout calculates and bounds line and order totals as integer BDT poisha.
3. Checkout saves the order and item snapshots. The existing Inventory service uses that same transaction manager to deduct each variant in ascending ID order. Its SQL updates stock only if enough units remain, then records a negative sale movement.
4. Checkout removes the purchased cart items and commits. If a later deduction fails, PostgreSQL rolls back the earlier stock changes, sale movements, and order writes. The Customer keeps the cart.

Inventory receipts and adjustments also commit balance changes and movements together. The unique variant balance prevents duplicate initialization. PostgreSQL rechecks a conditional update after a concurrent writer releases its lock. The isolated suite proves one checkout succeeds for the last unit and that a failed movement insert rolls back a balance change.

## Implemented bonus evidence

| Feature | Evidence |
| --- | --- |
| Middleware | Shared request IDs and a request logger with method, route template, status, and elapsed time after response completion |
| Custom decorators | Shared `@Public()`, `@Roles()`, and `@CurrentUser()` |
| Swagger | Generated DTO schemas and 50 operations with relevant bearer requirements and response codes |
| Interceptors and response manipulation | Shared success envelope and pagination metadata, plus Checkout's route-specific `X-Response-Time` |
| Environment configuration and migrations | Validated local environment variables, ignored `.env`, template `.env.example`, and two TypeORM migrations |
| Advanced transactions | Cart locks, concurrent-safe stock changes, retained movement history, and verified rollback across tables |

Shared HTTP, authentication, environment, and migration infrastructure supports all roles. The role-specific guides explain [Customer](CUSTOMER_VIVA.md), [Inventory](INVENTORY_VIVA.md), [Staff](STAFF_VIVA.md), and [Admin](ADMIN_VIVA.md) behavior. The [faculty verification matrix](FACULTY_REQUIREMENTS_VERIFICATION.md) maps the implementation to test evidence.
