const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
require('reflect-metadata');
require('dotenv').config();

const testDatabase = process.env.TEST_DB_NAME;
if (!testDatabase || testDatabase === process.env.DB_NAME) {
  throw new Error('Set TEST_DB_NAME to a separate, migrated PostgreSQL database.');
}
process.env.DB_NAME = testDatabase;

const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/configure-app');
const {
  Cart, CartItem, Category, Collection, InventoryMovement, InventoryStock,
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
  return { response, body: await response.json() };
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
