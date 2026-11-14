const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
require('reflect-metadata');
require('dotenv').config();

const testDatabase = process.env.TEST_DB_NAME;
if (!testDatabase || testDatabase === process.env.DB_NAME) {
  throw new Error('Set TEST_DB_NAME to a separate, migrated PostgreSQL database.');
}
process.env.DB_NAME = testDatabase;

const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/configure-app');
const {
  Address, Cart, CartItem, Category, Collection, InventoryMovement, InventoryStock,
  Order, OrderItem, Product, ProductVariant, User,
} = require('../dist/database/entities');
const { CatalogService } = require('../dist/modules/staff/catalog.service');
const { InventoryService } = require('../dist/modules/inventory/inventory.service');
const { hashPassword } = require('../dist/modules/auth/password');
const { Role } = require('../dist/modules/auth/role');

const runId = randomUUID();
const password = 'starter-test-password';
const email = (label) => `${label}-${runId}@example.com`;
let app;
let db;
let url;
const deleteAfter = [];

async function insert(Entity, input, manager = db.manager) {
  const entity = await manager.save(Entity, manager.create(Entity, input));
  if (manager === db.manager) deleteAfter.push([Entity, entity.id]);
  return entity;
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: response.status === 204 ? await response.text() : await response.json() };
}

async function createActor(label, role = Role.Customer) {
  const user = await insert(User, {
    email: email(label), name: 'Test Actor', role, passwordHash: await hashPassword(password),
  });
  const token = await app.get(JwtService).signAsync({ sub: user.id });
  return { user, token };
}

const addressInput = {
  recipientName: 'Sam Rahman', phone: '0123456789', line1: 'Test street',
  city: 'Dhaka', postalCode: '1200', countryCode: 'BD',
};

function assertError(result, status, message) {
  assert.equal(result.response.status, status);
  assert.equal(result.body.success, false);
  assert.equal(result.body.statusCode, status);
  assert.ok(result.body.requestId);
  assert.equal(result.body.requestId, result.response.headers.get('x-request-id'));
  if (message) assert.equal(result.body.message, message);
}

async function createCatalog(label) {
  const slug = `${label}-${runId}`;
  const category = await insert(Category, { slug, name: 'Shirts' });
  const product = await insert(Product, { slug, name: 'Linen shirt', categoryId: category.id });
  const variants = [];
  for (const [size, color, priceMinor] of [['M', 'black', 1250], ['L', 'blue', 2000]]) {
    variants.push(await insert(ProductVariant, {
      productId: product.id, sku: `${slug}-${size}`, size, color, priceMinor,
    }));
  }
  return { product, variants };
}

function setCartItem(variantId, quantity, token) {
  return request(`/cart/items/${variantId}`, { method: 'PUT', body: { quantity }, token });
}

function removeCartItem(variantId, token) {
  return request(`/cart/items/${variantId}`, { method: 'DELETE', token });
}

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  db = app.get(DataSource);
  assert.equal(await db.showMigrations(), false);
});

after(async () => {
  try {
    for (const [Entity, id] of deleteAfter.reverse()) {
      await db.getRepository(Entity).delete(id);
    }
  } finally {
    await app?.close();
  }
});

test('health and Swagger expose the runnable starter', async () => {
  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { success: true, data: { status: 'ok' } });
  assert.ok(health.response.headers.get('x-request-id'));

  const html = await fetch(`${url}/api/docs`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Swagger UI/);
  const doc = await request('/docs-json');
  assert.ok(doc.body.paths['/api/auth/register']?.post);
  assert.deepEqual(doc.body.paths['/api/admin/access'].get.security, [{ bearer: [] }]);
});

test('Swagger documents customer routes, validation, and pagination', async () => {
  const { body: doc } = await request('/docs-json');
  const routes = [
    ['get', '/api/customers/me', 200],
    ['patch', '/api/customers/me', 200, 'UpdateProfileDto'],
    ['post', '/api/addresses', 201, 'CreateAddressDto'],
    ['get', '/api/addresses', 200],
    ['get', '/api/addresses/{id}', 200],
    ['patch', '/api/addresses/{id}', 200, 'UpdateAddressDto'],
    ['delete', '/api/addresses/{id}', 204],
  ];
  const schemaPath = (name) => `#/components/schemas/${name}`;
  for (const [method, path, successStatus, dto] of routes) {
    const operation = doc.paths[path][method];
    assert.ok(operation.summary);
    assert.deepEqual(operation.security, [{ bearer: [] }]);
    assert.ok(operation.responses[successStatus]);
    assert.ok(operation.responses[401]);
    assert.ok(operation.responses[403]);
    if (dto) {
      assert.equal(operation.requestBody.content['application/json'].schema.$ref, schemaPath(dto));
    }
    if (dto || path.startsWith('/api/addresses')) assert.ok(operation.responses[400]);
    if (path.endsWith('{id}')) {
      assert.ok(operation.responses[404]);
      const idParam = operation.parameters.find(({ name }) => name === 'id');
      assert.equal(idParam.schema.format, 'uuid');
      assert.equal(idParam.required, true);
    }
  }

  const list = doc.paths['/api/addresses'].get;
  assert.equal(list.parameters.length, 2);
  for (const [name, defaultValue, maximum] of [['page', 1, 100_000], ['limit', 20, 100]]) {
    const param = list.parameters.find((item) => item.name === name);
    assert.equal(param.in, 'query');
    assert.equal(param.required, false);
    assert.deepEqual(param.schema, { type: 'integer', default: defaultValue, minimum: 1, maximum });
  }
  const { properties } = list.responses[200].content['application/json'].schema;
  assert.equal(properties.data.items.$ref, schemaPath('AddressResponseDto'));
  assert.deepEqual(properties.meta.required, ['page', 'limit', 'total']);
  assert.equal(doc.paths['/api/addresses/{id}'].delete.responses[204].content, undefined);
});

test('Swagger documents all cart and order operations and their response schemas', async () => {
  const { body: doc } = await request('/docs-json');
  const operations = [
    ['get', '/api/cart', 200, 'CartResponseDto', [409]],
    ['put', '/api/cart/items/{variantId}', 200, 'CartResponseDto', [400, 404, 409]],
    ['delete', '/api/cart/items/{variantId}', 204, undefined, [400, 404]],
    ['get', '/api/orders', 200, 'OrderSummaryDto', [400]],
    ['get', '/api/orders/{id}', 200, 'OrderDetailDto', [400, 404]],
  ];
  const schemaPath = (name) => `#/components/schemas/${name}`;
  for (const [method, path, status, dto, errors] of operations) {
    const operation = doc.paths[path][method];
    assert.ok(operation.summary);
    assert.deepEqual(operation.security, [{ bearer: [] }]);
    for (const error of [401, 403, ...errors]) assert.ok(operation.responses[error]);

    const { content } = operation.responses[status];
    if (status === 204) {
      assert.equal(content, undefined);
    } else {
      const { data, meta } = content['application/json'].schema.properties;
      if (path === '/api/orders') {
        assert.equal(data.items.$ref, schemaPath(dto));
        assert.deepEqual(meta.required, ['page', 'limit', 'total']);
      } else {
        assert.equal(data.$ref, schemaPath(dto));
      }
    }
    if (path.endsWith('}')) {
      const [param] = operation.parameters;
      assert.equal(param.name, path.match(/\{(\w+)\}$/)[1]);
      assert.equal(param.in, 'path');
      assert.equal(param.required, true);
      assert.deepEqual(param.schema, { type: 'string', format: 'uuid' });
    }
  }

  const put = doc.paths['/api/cart/items/{variantId}'].put;
  assert.equal(put.requestBody.content['application/json'].schema.$ref, schemaPath('SetCartItemDto'));
  const schemas = doc.components.schemas;
  assert.deepEqual(schemas.SetCartItemDto.required, ['quantity']);
  assert.deepEqual(schemas.SetCartItemDto.properties.quantity, {
    type: 'integer', minimum: 1, maximum: 1000,
  });
  assert.equal(schemas.CartResponseDto.properties.id.nullable, true);
  assert.equal(schemas.CartResponseDto.properties.items.items.$ref, schemaPath('CartItemResponseDto'));
  assert.equal(schemas.OrderDetailDto.properties.items.items.$ref, schemaPath('OrderItemResponseDto'));
  assert.equal(schemas.OrderDetailDto.properties.shippingAddress.$ref, schemaPath('OrderShippingAddressDto'));

  const params = doc.paths['/api/orders'].get.parameters;
  assert.equal(params.length, 2);
  for (const [name, defaultValue, maximum] of [['page', 1, 100_000], ['limit', 20, 100]]) {
    const param = params.find((item) => item.name === name);
    assert.equal(param.in, 'query');
    assert.equal(param.required, false);
    assert.deepEqual(param.schema, { type: 'integer', default: defaultValue, minimum: 1, maximum });
  }
});

test('registration, login, authorization, and account deactivation', async () => {
  const signup = { email: email('customer'), password, name: 'Test Customer' };
  const invalid = await request('/auth/register', {
    method: 'POST', body: { ...signup, role: Role.Admin },
  });
  assert.equal(invalid.response.status, 400);
  assert.ok(invalid.body.message.includes('property role should not exist'));
  assert.equal(invalid.body.requestId, invalid.response.headers.get('x-request-id'));

  const registered = await request('/auth/register', { method: 'POST', body: signup });
  assert.equal(registered.response.status, 201);
  const { user, accessToken } = registered.body.data;
  deleteAfter.push([User, user.id]);
  assert.equal(user.role, Role.Customer);
  assert.equal(user.passwordHash, undefined);

  const duplicate = await request('/auth/register', {
    method: 'POST', body: { ...signup, email: signup.email.toUpperCase() },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.success, false);
  assert.equal(duplicate.body.message, 'A record with that value already exists');

  const wrong = await request('/auth/login', {
    method: 'POST', body: { email: signup.email, password: 'incorrect-password' },
  });
  assert.equal(wrong.response.status, 401);

  const noToken = await request('/auth/me');
  assert.equal(noToken.response.status, 401);
  assert.equal(noToken.body.success, false);
  assert.equal((await request('/auth/me', { token: 'bad.token.value' })).response.status, 401);
  assert.deepEqual((await request('/auth/me', { token: accessToken })).body.data, user);

  const forbidden = await request('/admin/access', { token: accessToken });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.statusCode, 403);

  const admin = await insert(User, {
    email: email('admin'), name: 'Test Admin', role: Role.Admin,
    passwordHash: await hashPassword(password),
  });
  const login = await request('/auth/login', { method: 'POST', body: { email: admin.email, password } });
  assert.equal(login.response.status, 200);
  const adminToken = login.body.data.accessToken;
  assert.equal((await request('/admin/access', { token: adminToken })).body.data.role, Role.Admin);

  await db.getRepository(User).update(admin.id, { isActive: false });
  assert.equal((await request('/admin/access', { token: adminToken })).response.status, 401);
  const missing = await request('/unused-route');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.success, false);
});

test('customers can read their own public profile and update only their name', async () => {
  const { user, token } = await createActor('profile');
  const expected = { id: user.id, email: user.email, name: user.name, role: Role.Customer };
  const initial = await request('/customers/me', { token });
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.body, { success: true, data: expected });

  const updated = await request('/customers/me', {
    method: 'PATCH', token, body: { name: ' Sam Rahman ' },
  });
  const renamed = { ...expected, name: 'Sam Rahman' };
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body, { success: true, data: renamed });

  const invalidProfiles = [
    {}, { name: ' ' }, { name: null }, { name: 'Sam\0' }, { name: 'Sam', email: 'other@example.com' },
  ];
  for (const body of invalidProfiles) {
    assertError(await request('/customers/me', { method: 'PATCH', token, body }), 400);
  }
  assert.deepEqual((await request('/customers/me', { token })).body.data, renamed);
  assert.equal((await db.getRepository(User).findOneByOrFail({ id: user.id })).name, 'Sam Rahman');
});

test('every customer route requires a JWT and the Customer role', async () => {
  const { token } = await createActor('customer-routes-admin', Role.Admin);
  const addressPath = `/addresses/${randomUUID()}`;
  const cartItemPath = `/cart/items/${randomUUID()}`;
  const routes = [
    ['GET', '/customers/me'],
    ['PATCH', '/customers/me', { name: 'New name' }],
    ['GET', '/addresses'],
    ['POST', '/addresses', addressInput],
    ['GET', addressPath],
    ['PATCH', addressPath, { city: 'Rajshahi' }],
    ['DELETE', addressPath],
    ['GET', '/cart'],
    ['PUT', cartItemPath, { quantity: 2 }],
    ['DELETE', cartItemPath],
    ['GET', '/orders'],
    ['GET', `/orders/${randomUUID()}`],
  ];
  for (const [method, path, body] of routes) {
    assertError(await request(path, { method, body }), 401);
    assertError(await request(path, { method, body, token }), 403);
  }
});

test('customers can create, retrieve, update, and delete an owned address', async () => {
  const { user, token } = await createActor('address-crud');
  const created = await request('/addresses', { method: 'POST', body: addressInput, token });
  assert.equal(created.response.status, 201);
  const { id, createdAt, updatedAt } = created.body.data;
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Date(createdAt).toISOString(), createdAt);
  assert.equal(new Date(updatedAt).toISOString(), updatedAt);
  assert.deepEqual(created.body, {
    success: true, data: { ...addressInput, id, line2: null, createdAt, updatedAt },
  });
  const addressPath = `/addresses/${id}`;
  const repo = db.getRepository(Address);
  assert.equal((await repo.findOneByOrFail({ id })).userId, user.id);
  const fetched = await request(addressPath, { token });
  assert.equal(fetched.response.status, 200);
  assert.deepEqual(fetched.body, created.body);

  const changes = { city: 'Rajshahi', line2: 'Flat 2A' };
  const updated = await request(addressPath, { method: 'PATCH', body: changes, token });
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body, {
    success: true, data: { ...created.body.data, ...changes, updatedAt: updated.body.data.updatedAt },
  });
  const cleared = await request(addressPath, { method: 'PATCH', body: { line2: null }, token });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.data.line2, null);
  const stored = await repo.findOneByOrFail({ id, userId: user.id });
  assert.equal(stored.line2, null);
  assert.equal(stored.city, changes.city);
  const noChange = await request(addressPath, { method: 'PATCH', body: {}, token });
  assert.equal(noChange.response.status, 200);
  assert.deepEqual(noChange.body, cleared.body);

  const deleted = await request(addressPath, { method: 'DELETE', token });
  assert.equal(deleted.response.status, 204);
  assert.equal(deleted.body, '');
  assert.equal(await repo.countBy({ id }), 0);
  assertError(await request(addressPath, { token }), 404, 'Address not found');
  assertError(await request(addressPath, { method: 'DELETE', token }), 404, 'Address not found');
});

test('address pagination counts only owned rows and sorts by creation time and ID', async () => {
  const { user, token } = await createActor('address-list');
  const { user: other } = await createActor('address-list-other');
  const createdAt = new Date('2026-01-02T00:00:00Z');
  const [thirdId, firstId, secondId] = [randomUUID(), randomUUID(), randomUUID()].sort();
  const rows = [
    { id: secondId, createdAt },
    { id: firstId, createdAt },
    { id: thirdId, createdAt: new Date('2026-01-01T00:00:00Z') },
  ];
  for (const row of rows) {
    await insert(Address, { ...addressInput, ...row, userId: user.id });
  }
  await insert(Address, { ...addressInput, userId: other.id });

  const defaults = await request('/addresses', { token });
  assert.equal(defaults.response.status, 200);
  assert.equal(defaults.body.success, true);
  assert.deepEqual(defaults.body.meta, { page: 1, limit: 20, total: 3 });
  assert.deepEqual(defaults.body.data.map(({ id }) => id), [firstId, secondId, thirdId]);

  const second = await request('/addresses?page=2&limit=1', { token });
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.body.meta, { page: 2, limit: 1, total: 3 });
  assert.deepEqual(second.body.data.map(({ id }) => id), [secondId]);

  const beyond = await request('/addresses?page=4&limit=1', { token });
  assert.equal(beyond.response.status, 200);
  assert.deepEqual(beyond.body, { success: true, data: [], meta: { page: 4, limit: 1, total: 3 } });
});

test('address routes reject invalid DTO fields, pagination, and UUIDs', async () => {
  const { user, token } = await createActor('address-validation');
  const { id } = await insert(Address, { ...addressInput, userId: user.id });
  const createBodies = [
    {},
    { ...addressInput, countryCode: 'bd' },
    { ...addressInput, line1: 'A\0B' },
    { ...addressInput, userId: randomUUID() },
  ];
  for (const body of createBodies) {
    assertError(await request('/addresses', { method: 'POST', body, token }), 400);
  }
  for (const body of [{ city: null }, { phone: 123 }, { line2: 'A\0B' }, { userId: randomUUID() }]) {
    assertError(await request(`/addresses/${id}`, { method: 'PATCH', body, token }), 400);
  }
  for (const query of ['page=0', 'page=1.5', 'limit=101', 'limit=1&limit=2', 'owner=other']) {
    assertError(await request(`/addresses?${query}`, { token }), 400);
  }
  for (const invalidId of ['invalid', '123e4567-e89b-12d3-a456-426614174000']) {
    const path = `/addresses/${invalidId}`;
    assertError(await request(path, { token }), 400);
    assertError(await request(path, { method: 'PATCH', body: { city: 'Rajshahi' }, token }), 400);
    assertError(await request(path, { method: 'DELETE', token }), 400);
  }
  const repo = db.getRepository(Address);
  assert.equal(await repo.countBy({ userId: user.id }), 1);
  assert.equal((await repo.findOneByOrFail({ id })).city, addressInput.city);
});

test('missing and unowned address IDs return the same 404 for reads and writes', async () => {
  const { user, token } = await createActor('address-owner');
  const { token: otherToken } = await createActor('address-non-owner');
  const { id } = await insert(Address, { ...addressInput, userId: user.id });
  const missing = randomUUID();
  for (const blocked of [id, missing]) {
    const path = `/addresses/${blocked}`;
    const options = { token: otherToken };
    assertError(await request(path, options), 404, 'Address not found');
    assertError(await request(path, {
      ...options, method: 'PATCH', body: { city: 'Rajshahi' },
    }), 404, 'Address not found');
    assertError(await request(path, { ...options, method: 'DELETE' }), 404, 'Address not found');
  }
  const owned = await request(`/addresses/${id}`, { token });
  assert.equal(owned.response.status, 200);
  assert.equal(owned.body.data.city, addressInput.city);
});

test('cart starts empty, sets absolute quantities, and totals current prices without affecting stock', async () => {
  const { product, variants: [first, second] } = await createCatalog('cart-crud');
  const { user, token } = await createActor('cart-crud');
  await insert(InventoryStock, { variantId: first.id, quantity: 1 });

  const empty = await request('/cart', { token });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body, { success: true, data: { id: null, items: [], totalMinor: 0 } });
  const carts = db.getRepository(Cart);
  assert.equal(await carts.countBy({ userId: user.id }), 0);

  const item = {
    variantId: first.id, sku: first.sku, productName: product.name, size: first.size, color: first.color,
    quantity: 2, unitPriceMinor: first.priceMinor, available: true,
  };
  const created = await setCartItem(first.id, 2, token);
  assert.equal(created.response.status, 200);
  const { id } = await carts.findOneByOrFail({ userId: user.id });
  assert.deepEqual(created.body, { success: true, data: { id, items: [item], totalMinor: 2500 } });

  const updated = await setCartItem(first.id, 3, token);
  assert.equal(updated.response.status, 200);
  assert.deepEqual(updated.body.data, { id, items: [{ ...item, quantity: 3 }], totalMinor: 3750 });
  const repeated = await setCartItem(first.id, 3, token);
  assert.equal(repeated.response.status, 200);
  assert.deepEqual(repeated.body, updated.body);

  const added = await setCartItem(second.id, 1, token);
  assert.equal(added.response.status, 200);
  assert.equal(added.body.data.totalMinor, 5750);
  assert.deepEqual(added.body.data.items.map(({ variantId }) => variantId), [first.id, second.id].sort());
  assert.equal(await db.getRepository(CartItem).countBy({ cartId: id }), 2);

  await db.getRepository(ProductVariant).update(first.id, { priceMinor: 1500 });
  const reread = await request('/cart', { token });
  assert.equal(reread.response.status, 200);
  assert.equal(reread.body.data.totalMinor, 6500);
  assert.equal(reread.body.data.items.find(({ variantId }) => variantId === first.id).unitPriceMinor, 1500);

  const removed = await removeCartItem(first.id, token);
  assert.equal(removed.response.status, 204);
  assert.equal(removed.body, '');
  assertError(await removeCartItem(first.id, token), 404, 'Cart item not found');
  const remaining = await request('/cart', { token });
  assert.equal(remaining.body.data.totalMinor, 2000);
  assert.deepEqual(remaining.body.data.items.map(({ variantId }) => variantId), [second.id]);
  assert.equal((await db.getRepository(InventoryStock).findOneByOrFail({ variantId: first.id })).quantity, 1);
  assert.equal(await db.getRepository(InventoryStock).countBy({ variantId: second.id }), 0);
  assert.equal(await db.getRepository(InventoryMovement).countBy({ actorId: user.id }), 0);
});

test('cart rejects invalid input and displays inactive items so they can be removed', async () => {
  const { product, variants: [first, second] } = await createCatalog('cart-validation');
  const { user, token } = await createActor('cart-validation');
  for (const quantity of [0, -1, 1.5, '2', 1001, null, undefined]) {
    assertError(await setCartItem(first.id, quantity, token), 400);
  }
  for (const invalidId of ['invalid', '123e4567-e89b-12d3-a456-426614174000']) {
    assertError(await setCartItem(invalidId, 1, token), 400);
    assertError(await removeCartItem(invalidId, token), 400);
  }
  assertError(await setCartItem(randomUUID(), 1, token), 404, 'Variant not found');

  const variants = db.getRepository(ProductVariant);
  const products = db.getRepository(Product);
  await variants.update(first.id, { isActive: false });
  assertError(await setCartItem(first.id, 1, token), 409, 'Variant is unavailable');
  await products.update(product.id, { isActive: false });
  assertError(await setCartItem(second.id, 1, token), 409, 'Variant is unavailable');
  assert.equal(await db.getRepository(Cart).countBy({ userId: user.id }), 0);

  await products.update(product.id, { isActive: true });
  await variants.update(first.id, { isActive: true });
  assert.equal((await setCartItem(first.id, 1000, token)).response.status, 200);
  assert.equal((await setCartItem(second.id, 2, token)).response.status, 200);
  await variants.update(first.id, { isActive: false });
  assertError(await setCartItem(first.id, 1, token), 409, 'Variant is unavailable');
  const partial = await request('/cart', { token });
  assert.equal(partial.response.status, 200);
  assert.equal(partial.body.data.totalMinor, 4000);
  const inactiveItem = partial.body.data.items.find(({ variantId }) => variantId === first.id);
  assert.equal(inactiveItem.available, false);
  assert.equal(inactiveItem.quantity, 1000);
  assert.equal(inactiveItem.unitPriceMinor, first.priceMinor);
  assert.equal((await removeCartItem(first.id, token)).response.status, 204);

  await products.update(product.id, { isActive: false });
  assertError(await setCartItem(second.id, 1, token), 409, 'Variant is unavailable');
  const unavailable = await request('/cart', { token });
  assert.equal(unavailable.response.status, 200);
  assert.equal(unavailable.body.data.totalMinor, 0);
  assert.equal(unavailable.body.data.items[0].available, false);
  assert.equal((await removeCartItem(second.id, token)).response.status, 204);
});

test('cart reads, writes, and deletes are isolated by customer', async () => {
  const { variants: [variant] } = await createCatalog('cart-isolation');
  const { token: ownerToken } = await createActor('cart-owner');
  const { token: otherToken } = await createActor('cart-other');
  const ownerCart = await setCartItem(variant.id, 2, ownerToken);
  assert.equal(ownerCart.response.status, 200);
  assert.equal((await request('/cart', { token: otherToken })).body.data.id, null);
  assertError(await removeCartItem(variant.id, otherToken), 404, 'Cart item not found');

  const otherCart = await setCartItem(variant.id, 5, otherToken);
  assert.equal(otherCart.response.status, 200);
  assert.notEqual(otherCart.body.data.id, ownerCart.body.data.id);
  assert.equal(otherCart.body.data.items[0].quantity, 5);
  assert.deepEqual((await request('/cart', { token: ownerToken })).body, ownerCart.body);
  assert.equal((await removeCartItem(variant.id, otherToken)).response.status, 204);
  assert.deepEqual((await request('/cart', { token: ownerToken })).body, ownerCart.body);
});

test('concurrent PUTs create one cart and one row per variant', async () => {
  const { variants: [first, second] } = await createCatalog('cart-concurrency');
  const { user, token } = await createActor('cart-concurrency');
  const requests = [[first.id, 2], [first.id, 7], [second.id, 3]];
  const results = await Promise.all(requests.map(([variantId, quantity]) =>
    setCartItem(variantId, quantity, token)));
  const carts = await db.getRepository(Cart).findBy({ userId: user.id });
  assert.equal(carts.length, 1);
  const [{ id }] = carts;
  for (const [index, result] of results.entries()) {
    const [variantId, quantity] = requests[index];
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.id, id);
    assert.equal(result.body.data.items.find((item) => item.variantId === variantId).quantity, quantity);
  }

  const stored = await db.getRepository(CartItem).findBy({ cartId: id });
  assert.equal(stored.length, 2);
  assert.ok([2, 7].includes(stored.find(({ variantId }) => variantId === first.id).quantity));
  assert.equal(stored.find(({ variantId }) => variantId === second.id).quantity, 3);
});

test('PUT and DELETE wait behind a checkout-style cart row lock', async () => {
  const { variants: [variant] } = await createCatalog('cart-lock');
  const { user, token } = await createActor('cart-lock');
  assert.equal((await setCartItem(variant.id, 1, token)).response.status, 200);

  for (const [mutate, status] of [
    [() => setCartItem(variant.id, 2, token), 200],
    [() => removeCartItem(variant.id, token), 204],
  ]) {
    let pending;
    try {
      await db.transaction(async (manager) => {
        await manager.getRepository(Cart).findOneOrFail({
          where: { userId: user.id }, lock: { mode: 'pessimistic_write' },
        });
        const [{ pid }] = await manager.query('SELECT pg_backend_pid() AS pid');
        pending = mutate();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          // Observe from outside the transaction so pg_stat_activity refreshes each time.
          const [{ blocked }] = await db.query(`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE $1 = ANY(pg_blocking_pids(pid)) AND query LIKE '%FOR UPDATE%'
            ) AS blocked
          `, [pid]);
          if (blocked) return;
          await delay(25);
        }
        assert.fail('Cart mutation did not wait for the cart row lock');
      });
    } finally {
      if (pending) assert.equal((await pending).response.status, status);
    }
  }
  assert.deepEqual((await request('/cart', { token })).body.data.items, []);
});

test('order history paginates only owned orders and uses descending creation time then ID', async () => {
  const { user, token } = await createActor('order-history');
  const { user: other } = await createActor('order-history-other');
  const empty = await request('/orders', { token });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body, { success: true, data: [], meta: { page: 1, limit: 20, total: 0 } });

  const [lowId, middleId, highId] = [randomUUID(), randomUUID(), randomUUID()].sort();
  const latest = new Date('2026-01-02T00:00:00Z');
  const older = new Date('2026-01-01T00:00:00Z');
  const rows = [
    { id: lowId, createdAt: latest, totalMinor: 100 },
    { id: middleId, createdAt: latest, totalMinor: 200 },
    { id: highId, createdAt: older, totalMinor: 300 },
  ];
  const shippingAddress = { ...addressInput, line2: null };
  for (const row of rows) await insert(Order, { ...row, shippingAddress, userId: user.id });
  await insert(Order, { shippingAddress, userId: other.id, totalMinor: 400 });

  const expected = [rows[1], rows[0], rows[2]].map((row) => ({
    ...row, createdAt: row.createdAt.toISOString(),
  }));
  const full = await request('/orders', { token });
  assert.equal(full.response.status, 200);
  assert.deepEqual(full.body, { success: true, data: expected, meta: { page: 1, limit: 20, total: 3 } });

  const second = await request('/orders?page=2&limit=2', { token });
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.body, {
    success: true, data: expected.slice(2), meta: { page: 2, limit: 2, total: 3 },
  });
  const beyond = await request('/orders?page=3&limit=2', { token });
  assert.equal(beyond.response.status, 200);
  assert.deepEqual(beyond.body, { success: true, data: [], meta: { page: 3, limit: 2, total: 3 } });
  assertError(await request('/orders?limit=101', { token }), 400);
});

test('order detail uses owned shipping and item snapshots even after catalog and address edits', async () => {
  const { product, variants: [first, second] } = await createCatalog('order-detail');
  const { user, token } = await createActor('order-detail');
  const { token: otherToken } = await createActor('order-detail-other');
  const shippingAddress = { ...addressInput, line2: null };
  const address = await insert(Address, { ...shippingAddress, userId: user.id });
  const order = await insert(Order, { shippingAddress, userId: user.id, totalMinor: 2650 });
  const snapshots = [
    {
      variantId: first.id, sku: first.sku, productName: product.name, size: first.size, color: first.color,
      quantity: 2, unitPriceMinor: 825,
    },
    {
      variantId: second.id, sku: second.sku, productName: product.name, size: second.size, color: second.color,
      quantity: 1, unitPriceMinor: 1000,
    },
  ];
  const items = [];
  for (const snapshot of snapshots) {
    const item = await insert(OrderItem, { ...snapshot, orderId: order.id });
    items.push({ ...snapshot, id: item.id });
  }
  items.sort((left, right) => left.id.localeCompare(right.id));

  await db.getRepository(Address).update(address.id, { city: 'Chattogram' });
  await db.getRepository(Product).update(product.id, { name: 'New catalog name', isActive: false });
  await db.getRepository(ProductVariant).update(first.id, { priceMinor: 5000, color: 'white' });

  const path = `/orders/${order.id}`;
  const detail = await request(path, { token });
  assert.equal(detail.response.status, 200);
  assert.deepEqual(detail.body, {
    success: true,
    data: { id: order.id, createdAt: order.createdAt.toISOString(), totalMinor: 2650, shippingAddress, items },
  });
  assertError(await request(path, { token: otherToken }), 404, 'Order not found');
  assertError(await request(`/orders/${randomUUID()}`, { token }), 404, 'Order not found');
  for (const invalidId of ['invalid', '123e4567-e89b-12d3-a456-426614174000']) {
    assertError(await request(`/orders/${invalidId}`, { token }), 400);
  }
});

test('stock deduction rolls back order, item, movement, and prior stock changes', async () => {
  const catalog = app.get(CatalogService);
  const inventory = app.get(InventoryService);
  const buyer = await insert(User, {
    email: email('buyer'), name: 'Buyer', passwordHash: await hashPassword(password),
  });
  const category = await insert(Category, { slug: runId, name: 'Shirts' });
  const collection = await insert(Collection, { slug: runId, name: 'Summer' });
  const product = await insert(Product, {
    categoryId: category.id, slug: runId, name: 'Linen Shirt', collections: [collection],
  });

  const inStock = await insert(ProductVariant, {
    productId: product.id, sku: `in-${runId}`, size: 'M', color: 'black', priceMinor: 1000,
  });
  const soldOut = await insert(ProductVariant, {
    productId: product.id, sku: `out-${runId}`, size: 'S', color: 'black', priceMinor: 1000,
  });
  await insert(InventoryStock, { variantId: inStock.id, quantity: 2 });
  await insert(InventoryStock, { variantId: soldOut.id, quantity: 0 });
  const cart = await insert(Cart, { userId: buyer.id });
  const cartItem = await insert(CartItem, { cartId: cart.id, variantId: inStock.id, quantity: 1 });
  const storedProduct = await db.getRepository(Product).findOne({
    where: { id: product.id }, relations: { collections: true },
  });
  assert.equal(storedProduct.collections[0].id, collection.id);

  const orderId = randomUUID();
  await assert.rejects(db.transaction(async (manager) => {
    const variants = await catalog.findSellableVariants(manager, [inStock.id, soldOut.id]);
    assert.equal(variants.length, 2);
    const item = variants.find(({ id }) => id === inStock.id);
    assert.equal(item.productName, product.name);
    assert.equal(item.priceMinor, 1000);

    await insert(Order, {
      id: orderId, userId: buyer.id, totalMinor: 2000,
      shippingAddress: {
        recipientName: 'Buyer', phone: '0123456789', line1: 'Test street',
        line2: null, city: 'Dhaka', postalCode: '1200', countryCode: 'BD',
      },
    }, manager);
    await insert(OrderItem, {
      orderId, variantId: item.id, productName: item.productName, sku: item.sku,
      size: item.size, color: item.color, unitPriceMinor: item.priceMinor, quantity: 1,
    }, manager);
    await inventory.deductStock(manager, inStock.id, 1, buyer.id, orderId);
    assert.equal(await manager.countBy(InventoryMovement, { variantId: inStock.id }), 1);
    await inventory.deductStock(manager, soldOut.id, 1, buyer.id, orderId);
    await manager.delete(CartItem, cartItem.id);
  }), (error) => error.getStatus() === 409);

  assert.equal(await db.getRepository(Order).countBy({ id: orderId }), 0);
  assert.equal(await db.getRepository(OrderItem).countBy({ orderId }), 0);
  assert.equal(await db.getRepository(InventoryMovement).countBy({ variantId: inStock.id }), 0);
  const stock = await db.getRepository(InventoryStock).findOneByOrFail({ variantId: inStock.id });
  assert.equal(stock.quantity, 2);
  assert.equal(await db.getRepository(CartItem).countBy({ id: cartItem.id }), 1);
});
