# Minimal THREAD Specification

This starter specification reconstructs the agreed scope from the **Plan Ecommerce Backend** chat summary and the CSC4161 *Project Proposal Guide and Sample Project Report*, sections 4 and 5. The earlier Markdown download was unavailable to this workspace. Route naming, field names, integer BDT minor units, and the relationship and deletion rules below are the starter's canonical implementation choices.

## Scope and ownership

Minimal THREAD is a single-brand fashion e-commerce REST API using NestJS, TypeScript, TypeORM, and PostgreSQL. Checkout places a cash-on-delivery order. The business scope consists of customer shopping, Staff catalog CRUD, Inventory Manager stock operations, and Admin staff account management. Customer registration, login, and guarded identity are available in the starter. The starter implements shared catalog lookup and transactional stock deduction for later checkout integration.

| Role value | Access |
| --- | --- |
| `customer` | Own profile, addresses, cart, checkout, and order history |
| `staff` | Manage categories, collections, products, and variants |
| `inventory_manager` | Read stock and movements, receive stock, and adjust stock |
| `admin` | Manage Staff and Inventory Manager accounts |
| All active users | Authenticate and query their identity |
| Public | Health, customer registration and login, and planned catalog reads |

Roles are explicit and non-hierarchical. The Admin route checks the Admin role. Staff and Inventory Manager routes check their respective roles. Registration always creates a Customer, and privileged users use the same login endpoint. The bootstrap command creates the initial Admin. Deactivating a user invalidates access on the next authenticated request because the guard loads the current active account.

## Canonical PostgreSQL schema

The TypeORM entities and initial migration are authoritative. Entity rows use UUID primary keys and `createdAt` and `updatedAt` timestamps. The many-to-many junction uses a composite primary key. Store money in BDT poisha as nonnegative integers. Validate line totals and the order total against the PostgreSQL integer limit of 2,147,483,647 before persisting.

| Table | Fields and relationships |
| --- | --- |
| `users` | Unique normalized `email`, `name`, `passwordHash` (bcrypt, excluded from default selects), `role`, `isActive` |
| `addresses` | `userId`, `recipientName`, `phone`, `line1`, nullable `line2`, `city`, `postalCode`, `countryCode` |
| `categories` | `name`, unique `slug`, nullable `description` |
| `collections` | `name`, unique `slug`, nullable `description` |
| `products` | `categoryId`, `name`, unique `slug`, nullable `description`, `isActive` |
| `product_collections` | `productId` and `collectionId` form the primary key |
| `product_variants` | `productId`, unique `sku`, `size`, `color`, `priceMinor`, `isActive`. Also unique per product, size, and color |
| `inventory_stock` | Unique `variantId`, nonnegative `quantity` |
| `inventory_movements` | `variantId`, `actorId`, `type`, signed `delta`, required `reason`. Receipts are positive, adjustments nonzero, and sales negative |
| `carts` | Unique `userId` |
| `cart_items` | `cartId`, `variantId`, positive `quantity`. Each variant appears once per cart |
| `orders` | `userId`, `shippingAddress` snapshot, `totalMinor` |
| `order_items` | `orderId`, `variantId`, snapshot of `sku`, `productName`, `size`, `color`, and `unitPriceMinor`, plus `quantity`. Each variant appears once per order |

A category has many products, a product has many variants, and products can belong to many collections. A variant has at most one inventory stock row. Missing stock counts as zero. Inventory creates the first stock row on receipt, with a concurrency-safe insert or upsert. Inventory owns quantity and movement writes. Each receipt or adjustment writes the balance and movement together and respects the nonnegative stock constraint.

A user has many addresses and orders and at most one cart. Create the cart on first mutation. Cart and order items belong to their parent. Hard deletes that would break retained relationships return 409. Clear collection membership in the same transaction before deleting a collection. A variant with retained movements or order items can be deactivated. An unused variant with a stock row can be deleted only after removing an empty stock row in the same transaction. Keep completed orders and their snapshots readable after address and catalog edits.

## Checkout transaction

Customer owns the orchestration. Staff and Inventory export the services below. The stock deduction bridge is implemented and tested in the starter.

```ts
CatalogService.findSellableVariants(
  manager: EntityManager,
  variantIds: string[],
): Promise<SellableVariant[]>

InventoryService.deductStock(
  manager: EntityManager,
  variantId: string,
  quantity: number,
  actorId: string,
  orderId: string,
): Promise<void>
```

1. Validate `addressId` and resolve the logged-in Customer. Use `DataSource.transaction` for all checkout reads and writes.
2. Lock the customer's cart row for write before reading its items. Cart mutations take the same cart lock so a concurrent checkout or cart update sees a consistent cart. An empty or missing cart returns 400. Find the address by both ID and owner. Return 404 when it is missing or belongs to another user.
3. Fetch the cart's active variants on active products using the catalog service. If any variant is missing, return 409. Calculate totals from current prices read from the database.
4. Insert the order with an address snapshot and the order items with price and variant snapshots.
5. Call `deductStock` for each cart item in ascending variant ID order. It decrements only where the available quantity covers the purchase, returns 409 for a missing or insufficient balance, and writes a sale movement with the Customer actor and order reference.
6. Clear the purchased items and commit. Return 201 with the order and its items. Any error rolls back the order, items, prior deductions, movements, and cart changes.

The payment method is cash on delivery for every order. The planned scope ends at placing the order and reading its history.

## CSC4161 demonstration checklist

| Requirement | Evidence in this starter | Final demo work |
| --- | --- | --- |
| Four related entities with CRUD | Category, Collection, Product, ProductVariant and their relationships | Exercise create, paginated list, read, update, and delete for all four |
| Relational database and transaction | PostgreSQL migration, foreign keys, transactional stock helper, and a rollback test | Demonstrate successful checkout, then an insufficient-stock checkout with unchanged data |
| JWT and role-based authorization | Bcrypt, signup, login, current user, Admin seed, 401 and 403 | Exercise each role's implemented domain endpoints |
| DTO validation | Global ValidationPipe, auth and checkout inputs, separate address DTOs, pagination | Add validated Create and Update DTO pairs to the domain controllers |
| HTTP exceptions | Shared response shape and verified 400, 401, 403, 404, 409 | Show validation, missing record, conflict, and wrong-role examples in domain routes |

The starter includes Swagger with bearer authentication, versioned migrations, validated environment configuration, request-ID middleware, custom route and user decorators, and a response interceptor with pagination support. Use the course guide for the proposal, final report, and live demo. Record each member's contribution and AI usage according to instructor directions.

## Milestones

- Customer has implemented profile, addresses, cart, order history, and transactional checkout with PostgreSQL tests. The [Customer viva and demo guide](CUSTOMER_VIVA.md) covers these routes, request logging, and checkout timing.
- Staff implements the four CRUD resources, then checks catalog visibility and deletion behavior.
- Inventory implements stock and movement reads, then stock receipts and adjustments with transaction tests.
- Admin implements staff account listing, creation, role updates between staff roles, and activation changes, then verifies the complete role matrix.

Use the [API contract](API_CONTRACT.md) to implement the routes and review the end-to-end behavior.
