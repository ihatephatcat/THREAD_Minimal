# CSC4161 faculty requirements verification

This matrix uses Sections 4 and 5 of the October 2026 *CSC4161 Project Proposal Guide and Sample Project Report*. Verification calls the real NestJS HTTP routes with TypeORM and a dedicated, migrated PostgreSQL test database. Use the [final Swagger demonstration](FINAL_SWAGGER_DEMO.md) for the live walkthrough.

## Minimum requirements

| Requirement | Status | Implementation | Test evidence | Swagger endpoint |
| --- | --- | --- | --- | --- |
| Four related entities with CRUD | Verified | Staff CRUD for Category, Collection, Product, and ProductVariant. Category to Product and Product to Variant are one-to-many. Product to Collection is many-to-many. | Category and Collection CRUD, Product CRUD and membership, Variant CRUD and safe deletion, and public pagination. Each Staff resource has POST, paginated GET, detail GET, PATCH, and DELETE assertions. | `/api/staff/categories`, `/api/staff/collections`, `/api/staff/products`, `/api/staff/variants` |
| Relational database and data transaction | Verified | TypeORM and PostgreSQL foreign keys. Checkout writes orders, items, stock, and sale movements and clears the cart in one transaction. Inventory writes balances and movements atomically. | Full four-role purchase, checkout rollback after a later deduction fails, last-unit contention, Inventory rollback after a movement insert fails, and Staff zero-stock deletion rollback. | `POST /api/checkout`, `POST /api/inventory/receipts`, `POST /api/inventory/adjustments` |
| JWT authentication and authorization | Verified | Public registration, bcrypt hashes, signed JWTs, active-user guard, and four distinct roles. Customer routes scope resources to the authenticated owner. | Bcrypt checks, seeded Admin signs in, employee role matrix, expired or malformed JWT 401, foreign role 403, deactivation blocks old tokens, and another Customer's address or order returns 404. | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/admin/access` |
| Validated DTOs | Verified | Separate create and update classes with class-validator and a global `ValidationPipe`. Whitelist and `forbidNonWhitelisted` reject unknown fields, including a role supplied at public signup. | Admin, Staff, Inventory, and Customer tests cover invalid role, password length, price, quantity, UUID, address fields, and injected properties. Registration rejects a null character in the `name` field with 400. | `POST /api/auth/register`, `POST /api/staff/variants`, `PATCH /api/admin/staff/:id`, `POST /api/addresses` |
| Consistent HTTP exceptions | Verified | NestJS exceptions and a global filter map invalid input, authentication, role, missing records, and conflicts to 400, 401, 403, 404, and 409. Unexpected errors use a generic message. | HTTP tests check status, shaped error, and matching request ID for validation, missing or invalid JWT, role rejection, scoped resource lookups, duplicate keys, and restricted deletes. | Protected and public routes. Try `GET /api/cart`, `GET /api/admin/staff`, and duplicate `POST /api/staff/categories`. |

The validation behavior matches the sample report's use of `whitelist` and `forbidNonWhitelisted`. Unexpected input is rejected before the service can act on it.

## Bonus evidence

| Requirement | Status | Implementation | Test evidence | Swagger endpoint |
| --- | --- | --- | --- | --- |
| Middleware | Verified | Request ID and finish-time logger | Unit and HTTP tests check one log entry, response status and request ID, timing, and absence of request input | Any registered route |
| Custom decorators | Verified | `@Public()`, `@Roles()`, and `@CurrentUser()` | Anonymous catalog reads, role matrix, ownership, and movement actor checks | Public products and protected role routes |
| Swagger UI | Verified on test server | Generated Swagger and OpenAPI with DTO schemas, roles, status codes, and bearer authentication | Swagger HTML returns 200 and OpenAPI declares all 50 operations with role-specific tests | `/api/docs` |
| Interceptors and response manipulation | Verified | Success envelope, pagination, and Checkout timing | Checkout returns 201 with timing header. Paginated reads include metadata. DELETE returns an empty body. | `POST /api/checkout` and paginated GET routes |
| Environment configuration | Verified | Validated database and JWT settings with ignored local secrets | Environment validation and real startup using isolated test configuration | `GET /api/health` |
| Migrations | Verified on test database | Initial schema and forward-only collection activation. Automatic synchronization is disabled. | Test bootstrap checks no pending migrations. `npm run schema:check` compares entities to the migrated test schema. | Startup prerequisite |
| Advanced database transactions | Evidence verified | Cart row locks, atomic stock predicates, concurrent stock initialization, and same-transaction movements | Competing checkout, serialized cart writes, failed Inventory movement rollback, and Staff delete rollback | `/api/checkout`, `/api/inventory/*`, `DELETE /api/staff/variants/:id` |
| Mailer and general audit log | Outside scope | Inventory movements record stock events and actor IDs | Movement history verified. Course credit for a general audit log or mailer is unclaimed. | `GET /api/inventory/movements` |

The faculty guide asks the instructor to confirm what qualifies as an advanced transaction bonus. This project provides locking and multiple transactional workflows using TypeORM callbacks. Award decisions belong to the instructor.

## Defense evidence to capture

Run the Swagger sequence on the migrated persistent demo database, take screenshots that include the URL and status, and redact live tokens. Capture PostgreSQL rollback and concurrency evidence from the dedicated test suite. Group contribution and AI-use declarations for the formal report must come from the team.
