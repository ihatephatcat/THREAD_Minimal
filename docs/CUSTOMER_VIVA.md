# Minimal THREAD Customer Viva

## Architecture

The request travels through a controller, a service, a TypeORM repository, and PostgreSQL. Controllers validate input and pass the signed-in customer's ID to services. Services apply ownership and business rules, then read or write records through repositories. The shared JWT and role guards run before the controller. The shared success interceptor wraps returned data, and the exception filter formats errors.

[CustomerModule](../src/modules/customer/customer.module.ts) registers the five controllers and services. It imports the shared TypeORM repositories and the existing Staff and Inventory modules.

In the supplied lecture ZIP, `nestJs Tutorial/sample-proj/src/users/users.module.ts` registers a repository and exports `UsersService` for injection into `CarsService`. Checkout uses the same module and constructor injection pattern with Catalog and Inventory. See the [lecture alignment report](CUSTOMER_LECTURE_ALIGNMENT.md) for file-by-file comparisons and viva prompts.

## Features

All paths below use the `/api` prefix and require a JWT for the `customer` role.

| Feature | Endpoints | Main code and entities |
| --- | --- | --- |
| Profile | `GET /customers/me`, `PATCH /customers/me` | [ProfileController](../src/modules/customer/profile.controller.ts) reads the authenticated identity. [ProfileService.updateName](../src/modules/customer/profile.service.ts) updates the active customer's `User` row. The trimmed name must be 1–100 characters. Both responses expose only ID, email, name, and role. |
| Addresses | `POST /addresses`, `GET /addresses`, `GET /addresses/:id`, `PATCH /addresses/:id`, `DELETE /addresses/:id` | [AddressController](../src/modules/customer/address.controller.ts) calls [AddressService](../src/modules/customer/address.service.ts) for `create`, `list`, `get`, `update`, and `remove`. It uses `Address` and the signed-in owner's ID. DTOs validate text and lengths. Only `line2` accepts null. A missing or unowned address returns 404. Delete returns an empty 204. |
| Shopping cart | `GET /cart`, `PUT /cart/items/:variantId`, `DELETE /cart/items/:variantId` | [CartController](../src/modules/customer/cart.controller.ts) calls [CartService](../src/modules/customer/cart.service.ts) for `get`, `setItem`, and `removeItem`. Each customer owns one `Cart`, and each `CartItem` refers to a `ProductVariant` with a parent `Product`. PUT sets the absolute quantity to an integer from 1 to 1,000 and checks that both catalog records are active. The cart shows the current informational total for active items, and inactive items remain removable. Inventory is written during checkout. |
| Order history | `GET /orders`, `GET /orders/:id` | [OrderHistoryController](../src/modules/customer/order-history.controller.ts) calls [OrderHistoryService.list and get](../src/modules/customer/order-history.service.ts). Orders are filtered by `userId` and sorted by creation time and ID, both descending. Detail returns the `Order` shipping snapshot and its `OrderItem` snapshots. A missing or unowned order returns 404. |
| Checkout | `POST /checkout` | [CheckoutController](../src/modules/customer/checkout.controller.ts) validates a version 4 `addressId` and calls [CheckoutService.placeOrder](../src/modules/customer/checkout.service.ts). The service reads the owned `Cart` and `Address`, creates an `Order` and `OrderItem` rows, calls the shared Inventory service, and returns the placed order with 201. |

The [Customer DTOs](../src/modules/customer/customer.dto.ts) define the write inputs. Address and order lists use `PageQueryDto` and return `page`, `limit`, and `total` in `meta`. The defaults are page 1 and limit 20, with a maximum limit of 100.

## Checkout transaction

1. Start one PostgreSQL transaction. Every repository operation in checkout uses its transaction manager.
2. Lock the customer's cart row for writing before reading its items. PUT and DELETE take the same lock, so a cart edit waits for checkout. A missing or empty cart returns 400.
3. Find the address by ID and customer ID, then copy its shipping fields into the order snapshot.
4. Ask `CatalogService.findSellableVariants` for active variants of active products using the same manager. Use the latest server-side prices and reject unavailable items with 409.
5. Multiply quantity by unit price in integer BDT poisha. Check every line and the total against 2,147,483,647 before saving the order and item snapshots.
6. Call `InventoryService.deductStock` with the same manager in ascending variant ID order. Each conditional stock update requires sufficient stock and records a negative sale movement tied to the order.
7. Clear the purchased cart items, commit, and return the order. If a later deduction fails, PostgreSQL rolls back the order, its items, prior deductions, and movements. The cart remains available for another attempt.

The order is placed for cash on delivery. Its address, SKU, product name, size, color, quantity, and unit price remain readable after catalog or address edits.

## CSC4161 evidence and Customer bonuses

| Customer contribution | Evidence |
| --- | --- |
| CRUD and relationships | Address create, read, update, and delete demonstrate the user–address relationship. Cart and checkout exercise the cart–variant and order–item relationships. The team-wide four-entity CRUD demonstration uses Staff's Category, Collection, Product, and ProductVariant routes. |
| Validation, access control, and exceptions | Send an invalid DTO for 400, omit the JWT for 401, use an authorized non-customer account for 403, and try another customer's resource ID for 404. Checkout returns 409 for unavailable variants or insufficient stock. |
| Basic database transaction | A checkout commits order, inventory, and cart changes together. The PostgreSQL test demonstrates rollback after an earlier stock deduction. This is evidence for the basic transaction and rollback requirement. |
| Swagger | The Customer contribution documents 13 operations at `/api/docs` with bearer access, DTO schemas, status codes, and paginated responses where applicable. The Swagger setup and shared success envelope came from the starter. |
| Request logging middleware | [request-logging.ts](../src/common/http/request-logging.ts) runs in the HTTP pipeline, then logs once on the response's `finish` event. It records method, route template, final status, duration, and the existing request ID. It uses `[unmatched]` when there is no registered route template. |
| Checkout timing interceptor | [checkout-timing.interceptor.ts](../src/modules/customer/checkout-timing.interceptor.ts) surrounds Checkout execution after the guards. It measures with `performance.now()` and sets `X-Response-Time` in milliseconds when execution completes or errors. The existing response body still comes from the shared interceptor or exception filter. |

Middleware runs across HTTP requests and can observe the completed response. The timing interceptor attaches to one Nest handler and observes its execution before Nest sends the response.

The lecture file `nestJs Tutorial/sample-proj/src/users/users.controller.ts` uses `@UseInterceptors(FileInterceptor(...))` on the profile-picture route. The same decorator attaches the timing interceptor to Checkout.

The starter supplied authentication and RBAC, decorators, request IDs, environment validation, shared entities and migrations, DTO validation infrastructure, the global response interceptor and error filter, and the catalog and inventory service contracts. Customer used these components and added the routes, checkout orchestration, request logging, and checkout timing.

## Swagger demonstration

Follow the [local setup](../README.md#run-locally). For simultaneous development, set `PORT=3001` in the local Minimal THREAD `.env` and open Swagger at `http://127.0.0.1:3001/api/docs`.

1. Register through `POST /api/auth/register` and paste the returned access token into **Authorize**. Read and update the profile.
2. Create an address, save its ID, and list and update it. Create a second address and delete that one to show 204. Try an invalid input for 400. To show ownership, register a second customer and request the first customer's address using the second customer's token.
3. Authorize again as the first customer. Show the empty cart and order history, then call checkout with the saved address ID to see 400 for an empty cart. In the terminal, compare the `requestId` in the log with `X-Request-Id` in Swagger. Check `X-Response-Time` on the checkout response.
4. With existing catalog and inventory data, add an active variant through PUT, place an order with the saved address, then inspect order history and verify the cart is empty. The dedicated PostgreSQL suite exercises this flow with its own fixtures today.
5. After team integration, use Staff's catalog CRUD to create a category, an active product, and two active variants. Use Inventory Manager's stock receipts to give the lower-ID variant enough stock and the higher-ID variant less than the requested quantity. Add both and record the stock balances, movement history, cart, and order count. Checkout should return 409. Recheck all four to show that the earlier deduction and sale movement rolled back and the cart stayed intact.

## AI assistance

Codex assisted with generating and implementing the Customer code, tests, and this documentation. The verification commands use the project's Node.js test runner and a dedicated Minimal THREAD PostgreSQL database.
