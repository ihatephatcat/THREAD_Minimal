# Staff and Public Catalog viva guide

Staff and Admin accounts manage categories, collections, products, and variants. Customers browse the public catalog, and Inventory receives and adjusts stock for variant IDs created here. The [README](../README.md) explains how to seed an Admin for a local Swagger demo.

## Endpoints in Swagger

Open `/api/docs`, log in through `POST /api/auth/login`, and paste the access token into **Authorize** for Staff operations. Each row below lists the full Staff route pattern.

| Resource | Create | List | Read | Update | Delete |
| --- | --- | --- | --- | --- | --- |
| Category | `POST /api/staff/categories` | `GET /api/staff/categories` | `GET /api/staff/categories/{id}` | `PATCH /api/staff/categories/{id}` | `DELETE /api/staff/categories/{id}` |
| Collection | `POST /api/staff/collections` | `GET /api/staff/collections` | `GET /api/staff/collections/{id}` | `PATCH /api/staff/collections/{id}` | `DELETE /api/staff/collections/{id}` |
| Product | `POST /api/staff/products` | `GET /api/staff/products` | `GET /api/staff/products/{id}` | `PATCH /api/staff/products/{id}` | `DELETE /api/staff/products/{id}` |
| Variant | `POST /api/staff/variants` | `GET /api/staff/variants` | `GET /api/staff/variants/{id}` | `PATCH /api/staff/variants/{id}` | `DELETE /api/staff/variants/{id}` |

Public callers can use `GET /api/products` for a page or `GET /api/products/{id}` for details. Both expose active products, category information, and active variants with current prices. An inactive or unknown product returns 404 in public detail. A product can appear with an empty variant list.

Creation returns 201, reads and updates return 200, and deletion returns an empty 204. Invalid data returns 400, missing or invalid authentication returns 401, and a Customer or Inventory Manager token on a Staff route returns 403. Missing resources and valid UUIDs for unknown relationships return 404. Duplicate slugs, SKUs, product size/color combinations, and restricted deletions return 409.

Lists accept `page` and `limit`, with defaults of 1 and 20 and a maximum limit of 100. The response includes `meta.page`, `meta.limit`, and `meta.total`. Categories, collections, and products sort by slug, and variants sort by SKU. The ID breaks ties. Staff product lists also accept `categoryId` and `isActive`, public product lists accept `categoryId`, and Staff variant lists accept `productId`.

## Copy-paste Swagger examples

1. Category create body

   ```json
   {"name":"Linen shirts","slug":"demo-linen-shirts","description":"Lightweight everyday shirts"}
   ```

2. Collection create body

   ```json
   {"name":"Summer essentials","slug":"demo-summer-essentials","isActive":true}
   ```

3. Product create body. Replace the example UUIDs with the IDs returned by steps 1 and 2.

   ```json
   {
     "name":"Linen camp shirt",
     "slug":"demo-linen-camp-shirt",
     "description":"Relaxed cotton-linen blend",
     "categoryId":"f2068dbe-d4f0-4e5f-9b51-2b3d811d31cb",
     "collectionIds":["7230760b-5cb7-4b55-823b-72cbc62e2e0a"],
     "isActive":false
   }
   ```

4. Variant create body. Replace `productId` with the product ID. `120000` poisha equals BDT 1,200.

   ```json
   {"productId":"a02bf259-57d6-4c38-978c-be3b3adcdf16","sku":"DEMO-LINEN-M-BLACK","size":"M","color":"Black","priceMinor":120000}
   ```

5. Receive units for the variant ID using [Inventory receipts](INVENTORY_VIVA.md). Activate the product through PATCH with `{"isActive":true}`. Verify the public product and its variant, then switch to a Customer token and follow the [cart and checkout demo](CUSTOMER_VIVA.md). Check that the sale appears in movement history and the order retains its purchased price after a catalog edit.

PATCH examples include `{"description":null}` for a category, `{"isActive":false}` for a collection, `{"collectionIds":[]}` for a product, and `{"priceMinor":125000,"isActive":false}` for a variant. Collection activation leaves its membership intact. Variant PATCH keeps the original parent product.

## Explain the code

The [Staff module](../src/modules/staff/staff.module.ts) registers controllers, services, and TypeORM repositories. Controllers set up routes, run the shared guards and validated DTOs, and send typed input to services. Services load or write the [shared entities](../src/database/entities/catalog.entity.ts) through repositories. PostgreSQL enforces unique values and foreign keys, and the shared exception filter translates conflicts into safe HTTP responses.

- A category has many products, and every product belongs to one category.
- Products and collections have a many-to-many association in `product_collections`. Product create and PATCH validate every supplied collection ID. Sending an array replaces membership in the same transaction as the product write.
- A product has many variants. A variant has a unique SKU, a size and color unique for that product, and a nonnegative integer price. Product and variant activation control purchase eligibility. Checkout uses the existing [CatalogService](../src/modules/staff/catalog.service.ts) to read both flags and current prices.

## Safe deletion and course evidence

Products protect their categories, and variants protect their products. Deleting a collection unlinks its products in the same transaction and keeps the products. Deleting an unused product also clears collection links through the existing foreign key. A variant with positive stock, a cart item, an order item, or a movement returns 409 on delete. Use `isActive: false` to withdraw a variant from sale. An eligible variant and its zero balance are deleted in the same transaction. If deletion fails after removing a zero balance, the balance is restored by rollback.

The four related resources demonstrate the course CRUD and paginated-list requirements, plus DTO validation, JWT, role guards, relationship mapping, and Swagger. The collection and variant deletion flows provide multi-table transaction evidence. The PostgreSQL suite tests rollback after a variant's empty-balance removal and verifies the Staff → Inventory → Customer workflow.
