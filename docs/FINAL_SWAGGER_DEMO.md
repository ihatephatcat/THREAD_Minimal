# Final Swagger defense demonstration

Run this sequence against the persistent demo database. Use unique demo emails, slugs, and SKUs if you rehearse more than once. Save the actual IDs returned under `data.id` and replace each placeholder before executing a request.

## Set up the Windows demo

Use the auto-start PostgreSQL 18 Windows service on `127.0.0.1:5432`. If the database and dedicated login already exist, verify their ownership and credentials. Otherwise, a PostgreSQL administrator can check and create just the missing demo objects from a local terminal.

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

Check for the demo role and database in `psql`.

```text
\du minimal_thread_demo_app
\l minimal_thread_demo
```

For a new role, run the following. The password command prompts locally for a unique password without echoing it.

```text
CREATE ROLE minimal_thread_demo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password minimal_thread_demo_app
```

For a new database, create it with that owner and limit access to the dedicated database. Preserve any existing database, role, or grants.

```sql
CREATE DATABASE minimal_thread_demo OWNER minimal_thread_demo_app;
REVOKE CONNECT, TEMP ON DATABASE minimal_thread_demo FROM PUBLIC;
```

Exit `psql` with `\q`.

In Minimal THREAD's ignored `.env`, set `HOST=127.0.0.1`, `PORT=3001`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=minimal_thread_demo`, and `DB_USER=minimal_thread_demo_app`. Enter the dedicated `DB_PASSWORD` locally. Preserve the existing secure `JWT_SECRET`, or generate a new 32-byte random secret using the [README](../README.md) procedure.

Set `ADMIN_EMAIL=admin.demo@example.com` and a unique local `ADMIN_PASSWORD` in the ignored file. The seed preserves the password of an existing active Admin with that email. Use their existing credentials to sign in.

```powershell
Set-Location -LiteralPath 'C:/Users/phatcat/AWT-Projects/THREAD_Minimal/minimal-thread'
npm run migration:run
npm run migration:show
npm run seed:admin
npm run start:dev
```

Both `InitialSchema1794687772089` and `CollectionActivation1794774172089` should show as applied. Open `http://127.0.0.1:3001/api/docs` and run `GET /api/health` for 200. After a Windows restart, verify the service with `Get-Service postgresql-x64-18` and start the app from the project directory with `npm run start:dev`.

## 1 Admin creates the employee accounts

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Public | `POST /api/auth/login` | Admin login below | 200. Copy `data.accessToken` into **Authorize** to demonstrate JWT login. |
| Admin | `GET /api/admin/access` | None | 200 with the signed-in Admin's identity. |
| Admin | `POST /api/admin/staff` | Staff body below | 201. Save `<STAFF_ID>` and the Staff email for login. |
| Admin | `POST /api/admin/staff` | Inventory body below | 201. Save the Inventory email for login. Both accounts start active. |
| Admin | `GET /api/admin/staff?page=1&limit=2` | None | 200 with managed roles and pagination metadata. |
| Admin | `GET /api/admin/staff/<STAFF_ID>` | None | 200 with safe account fields. |
| Admin | `PATCH /api/admin/staff/<STAFF_ID>` | `{"name":"Catalog Lead"}` | 200. The same ID has the updated name. |
| Admin | `POST /api/admin/staff` | Staff body with a unique disposable email | 201. Save its ID as `<DISPOSABLE_STAFF_ID>`. |
| Admin | `DELETE /api/admin/staff/<DISPOSABLE_STAFF_ID>` | None | Empty 204. GET still shows the same ID with `isActive:false`. Login with that account returns 401. |

```json
{"email":"admin.demo@example.com","password":"<LOCAL_ADMIN_PASSWORD>"}
```

```json
{"name":"Catalog Staff","email":"staff.demo@example.com","password":"<UNIQUE_STAFF_PASSWORD>","role":"staff"}
```

```json
{"name":"Stock Manager","email":"inventory.demo@example.com","password":"<UNIQUE_INVENTORY_PASSWORD>","role":"inventory_manager"}
```

Passwords and JWTs stay local. Replace the literal password placeholders in Swagger with passwords you chose. Switch roles by calling public login with the next account's email and password and replacing the bearer token in **Authorize**.

## 2 Staff builds and publishes the catalog

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Public | `POST /api/auth/login` | Staff email and password | 200. Authorize with the Staff token. |
| Staff | `POST /api/staff/categories` | Category body below | 201. Save `<CATEGORY_ID>`. |
| Staff | `POST /api/staff/collections` | Collection body below | 201. Save `<COLLECTION_ID>`. |
| Staff | `POST /api/staff/products` | Product body below | 201. Save `<PRODUCT_ID>`. Response shows category and collection membership. |
| Staff | `POST /api/staff/variants` | Variant body below | 201. Save `<VARIANT_ID>`. Price 120000 poisha equals BDT 1,200. |
| Public | `GET /api/products/<PRODUCT_ID>` | None | 404 while the product is inactive. |
| Staff | `PATCH /api/staff/products/<PRODUCT_ID>` | `{"isActive":true}` | 200, publishes the product. |
| Staff | `PATCH /api/staff/variants/<VARIANT_ID>` | `{"isActive":true}` | 200, activates the associated variant. |
| Staff | `GET /api/staff/products/<PRODUCT_ID>` | None | 200, shows the category ID and collection IDs. |
| Staff | `GET /api/staff/variants?productId=<PRODUCT_ID>&page=1&limit=5` | None | 200 with a paginated list and current price. |

```json
{"name":"T-Shirts","slug":"defense-t-shirts","description":"Everyday cotton shirts"}
```

```json
{"name":"Essential Cotton","slug":"defense-essential-cotton","isActive":true}
```

```json
{"name":"THREAD Essential Cotton T-Shirt","slug":"defense-essential-tee","categoryId":"<CATEGORY_ID>","collectionIds":["<COLLECTION_ID>"],"isActive":false}
```

```json
{"productId":"<PRODUCT_ID>","sku":"DEFENSE-COTTON-BLK-M","size":"M","color":"Black","priceMinor":120000,"isActive":false}
```

For full CRUD evidence, create a second, disposable category, collection, product, and variant with a distinct suffix. Use the five operations per resource listed in the [Staff viva guide](STAFF_VIVA.md). Use `{"name":"Renamed demo record"}` for the category, collection, and product PATCH bodies and `{"priceMinor":125000}` for the variant. GET by ID and paginated list return 200. Delete the disposable variant, product, collection, and category in that order for empty 204s. Keep this set free of carts, purchases, or stock movements.

## 3 Inventory Manager opens the stock balance

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Public | `POST /api/auth/login` | Inventory email and password | 200. Authorize with the Inventory token. |
| Inventory Manager | `GET /api/inventory/stock/<VARIANT_ID>` | None | 200, quantity 0 for the fresh variant. |
| Inventory Manager | `POST /api/inventory/receipts` | Receipt below | 201, new quantity 10 and a positive receipt movement. |
| Inventory Manager | `GET /api/inventory/stock?variantId=<VARIANT_ID>&limit=5` | None | 200, quantity 10 with SKU and product details. |
| Inventory Manager | `POST /api/inventory/adjustments` | Adjustment below | 201, quantity 9 and a signed adjustment movement. |
| Inventory Manager | `GET /api/inventory/movements?variantId=<VARIANT_ID>&page=1&limit=5` | None | 200. Shows the adjustment followed by the receipt, with the employee ID. |

```json
{"variantId":"<VARIANT_ID>","quantity":10,"reason":"Opening demonstration delivery"}
```

```json
{"variantId":"<VARIANT_ID>","delta":-1,"reason":"One damaged unit"}
```

Before repeating receipt or adjustment during rehearsal, check the filtered movement history. Skip an opening receipt or correction that already exists. Use a fresh SKU to reproduce the exact balances.

## 4 Customer browses and prepares the cart

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Public | `POST /api/auth/register` | Registration below | 201, public signup assigns Customer. Save the account's email and choose a unique password. |
| Public | `POST /api/auth/login` | Customer email and password | 200. Authorize with the Customer token. |
| Customer | `GET /api/customers/me` | None | 200, confirms current identity. |
| Customer | `PATCH /api/customers/me` | `{"name":"Demo Buyer"}` | 200, updates this profile. |
| Customer | `POST /api/addresses` | Address body below | 201. Save `<ADDRESS_ID>`. |
| Customer | `GET /api/addresses?page=1&limit=5` | None | 200, lists only this customer's addresses. |
| Customer | `GET /api/addresses/<ADDRESS_ID>` | None | 200, reads back the address. Another Customer's token gets 404. |
| Customer | `PATCH /api/addresses/<ADDRESS_ID>` | `{"line2":"Flat 2A"}` | 200. Keep the address ID for checkout. |
| Public | `GET /api/products?categoryId=<CATEGORY_ID>&page=1&limit=5` | None | 200, shows the active product and active variant. |
| Public | `GET /api/products/<PRODUCT_ID>` | None | 200. Confirm the public variant ID and price. |
| Customer | `PUT /api/cart/items/<VARIANT_ID>` | `{"quantity":1}` | 200, cart total 120000. |
| Customer | `PUT /api/cart/items/<VARIANT_ID>` | `{"quantity":2}` | 200, sets exactly two units. |
| Customer | `GET /api/cart` | None | 200, quantity 2 and total 240000. |

```json
{"name":"Demo Customer","email":"customer.demo@example.com","password":"<UNIQUE_CUSTOMER_PASSWORD>"}
```

```json
{"recipientName":"Demo Buyer","phone":"01700000000","line1":"12 Campus Road","city":"Dhaka","postalCode":"1200","countryCode":"BD"}
```

Each login body uses `{"email":"<ACCOUNT_EMAIL>","password":"<LOCAL_ACCOUNT_PASSWORD>"}`.

## 5 Checkout completes the purchase

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Customer | `POST /api/checkout` | `{"addressId":"<ADDRESS_ID>"}` | 201, cash-on-delivery order. Save `<ORDER_ID>`. Check order total 240000 and `X-Response-Time`. |
| Customer | `GET /api/cart` | None | 200 with an empty items array. |
| Inventory Manager | `GET /api/inventory/stock/<VARIANT_ID>` | None | 200 with quantity 7 after buying two of the nine units. |
| Inventory Manager | `GET /api/inventory/movements?variantId=<VARIANT_ID>&page=1&limit=2` | None | 200 with sale `delta:-2` and `reason:"Order <ORDER_ID>"` at the top. |

Switch back to the Inventory token before reading stock or movements.

## 6 Customer opens order history

| Role | Request | Body | Expected result and evidence |
| --- | --- | --- | --- |
| Customer | `GET /api/orders?page=1&limit=5` | None | 200. The new order appears with total 240000. |
| Customer | `GET /api/orders/<ORDER_ID>` | None | 200. Compare the stored delivery address, name, SKU, two units, and unit price of 120000 with the checkout response. |

For a safe exception demo, clear **Authorize** and GET the cart for 401, use the Customer token on the Staff list for 403, submit cart quantity 0 for a field-level 400, and use another Customer's token on the address or order for 404. Repeat a create with the same category slug for 409. Use the isolated [PostgreSQL suite](../test/postgres.test.cjs) for forced mid-transaction rollback and concurrency scenarios.
