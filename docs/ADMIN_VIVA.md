# Admin viva guide

Admin manages Staff and Inventory Manager accounts. Use the existing `npm run seed:admin` command after migrating the local database. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the ignored local `.env`. Sign in through `POST /api/auth/login` and paste the returned access token into **Authorize** at `/api/docs`.

## Admin endpoints

All six operations require an active Admin account.

| Method and path | Expected response |
| --- | --- |
| `GET /api/admin/access` | 200 with the signed-in Admin's public identity |
| `POST /api/admin/staff` | 201 with a newly created active employee |
| `GET /api/admin/staff?page=1&limit=20` | 200 with a page of managed accounts |
| `GET /api/admin/staff/{id}` | 200 with one managed account |
| `PATCH /api/admin/staff/{id}` | 200 with the updated managed account |
| `DELETE /api/admin/staff/{id}` | Empty 204 when the account is inactive, including repeated requests |

The list includes active and inactive employees, sorted by name and then ID. `role=staff` or `role=inventory_manager` filters by role. `isActive=true` or `isActive=false` filters by status. Managed responses contain `id`, `name`, `email`, `role`, `isActive`, `createdAt`, and `updatedAt`.

Invalid input or UUIDs return 400. Missing or invalid authentication returns 401. An authenticated Customer, Staff member, or Inventory Manager gets 403 on Admin routes. Detail, update, and deactivation return 404 for a missing ID or an ID belonging to a Customer or Admin. Duplicate email returns 409.

## Swagger examples

1. Create a Staff account with `POST /api/admin/staff`.

   ```json
   {"name":"Catalog Staff","email":"staff@example.com","password":"DemoPass123!","role":"staff"}
   ```

2. Create an Inventory Manager with the same endpoint.

   ```json
   {"name":"Inventory Manager One","email":"inventory1@example.com","password":"DemoPass123!","role":"inventory_manager"}
   ```

3. Use the returned Staff ID in `PATCH /api/admin/staff/{id}`. Send only the fields you want to change.

   ```json
   {"name":"Inventory Lead","email":"inventory-lead@example.com","role":"inventory_manager"}
   ```

4. To demonstrate attribution, sign in as the Inventory Manager and record a receipt against an existing variant. With the Admin token, call `DELETE /api/admin/staff/{id}` using that manager's ID. Verify `isActive: false` with GET and check that the receipt in Inventory history still carries the manager's original ID. Try the manager's old token and login credentials while the account is inactive. Both return 401. Reactivate with PATCH and `{"isActive":true}`, then sign in again.

## Explain the code

The [Admin controller](../src/modules/admin/admin.controller.ts) declares routes and role requirements. The global validation pipe runs the [Admin DTOs](../src/modules/admin/admin.dto.ts) before the controller calls the [Admin service](../src/modules/admin/admin.service.ts). The service uses a TypeORM repository to read or update the shared `users` table in PostgreSQL. The managed-role condition is part of the update and deactivation queries.

Authentication asks who the caller is. Login checks the submitted password against the stored bcrypt hash and signs a JWT with the user ID as its subject. On a protected request, the shared [JWT guard](../src/modules/auth/auth.guards.ts) verifies the token and loads the current active user. Authorization asks what that user can do. `RolesGuard` reads the route's `@Roles(Role.Admin)` metadata and checks the role from the current database record. A role change applies on the next request, even with an earlier token.

Admin account creation uses the same email normalization, password validation, and bcrypt helper as public registration. The Admin DTO accepts the two employee roles. Public registration always creates a Customer. The initial Admin comes from the existing seed command. Generic account updates accept name, email, role, and active status. The password hash stays in PostgreSQL.

Deactivation sets `isActive` to false and retains the user's ID. The existing login and JWT guard both check that flag. The token itself keeps its original expiration, so reactivating an account can make a still-valid token usable again under its current role. Inventory movements retain their `actorId` foreign key and remain visible in history.

## Course evidence

Admin-specific work demonstrates validated creation and updates, paginated reads, scoped role changes, account deactivation, and Swagger examples. The integration tests demonstrate role enforcement and preserved Inventory attribution through a database relationship. JWT, bcrypt, `@Roles()`, `@CurrentUser()`, environment validation, Swagger setup, and global response formatting are shared project infrastructure. Customer checkout transactions and Inventory concurrency tests remain evidence from their respective modules.
