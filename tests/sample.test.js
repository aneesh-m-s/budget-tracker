const fs = require("fs/promises");
const path = require("path");
const request = require("supertest");

const tempFile = path.join(__dirname, "tmp-store.json");
let app;

beforeAll(async () => {
  process.env.DATA_FILE = tempFile;
  app = require("../server");
});

beforeEach(async () => {
  const store = {
    budget: { monthly: 50000, currency: "INR" },
    transactions: []
  };
  await fs.writeFile(tempFile, JSON.stringify(store, null, 2), "utf8");
});

afterAll(async () => {
  await fs.rm(tempFile, { force: true });
});

test("creates and lists transactions", async () => {
  const create = await request(app).post("/api/transactions").send({
    description: "Salary",
    amount: 90000,
    type: "income",
    category: "Work",
    date: "2026-03-01"
  });

  expect(create.status).toBe(201);
  expect(create.body).toMatchObject({
    description: "Salary",
    type: "income"
  });

  const list = await request(app).get("/api/transactions?month=2026-03");
  expect(list.status).toBe(200);
  expect(list.body).toHaveLength(1);
});

test("updates and deletes a transaction", async () => {
  const create = await request(app).post("/api/transactions").send({
    description: "Groceries",
    amount: 3000,
    type: "expense",
    category: "Food",
    date: "2026-03-10"
  });

  const id = create.body.id;
  const update = await request(app).put(`/api/transactions/${id}`).send({
    description: "Groceries Weekly",
    amount: 3200,
    type: "expense",
    category: "Food",
    date: "2026-03-10"
  });

  expect(update.status).toBe(200);
  expect(update.body.description).toBe("Groceries Weekly");

  const remove = await request(app).delete(`/api/transactions/${id}`);
  expect(remove.status).toBe(204);

  const list = await request(app).get("/api/transactions?month=2026-03");
  expect(list.body).toHaveLength(0);
});

test("returns monthly summary", async () => {
  await request(app).post("/api/transactions").send({
    description: "Freelance",
    amount: 12000,
    type: "income",
    category: "Work",
    date: "2026-03-05"
  });

  await request(app).post("/api/transactions").send({
    description: "Rent",
    amount: 15000,
    type: "expense",
    category: "Housing",
    date: "2026-03-03"
  });

  const summary = await request(app).get("/api/summary?month=2026-03");

  expect(summary.status).toBe(200);
  expect(summary.body).toMatchObject({
    income: 12000,
    expense: 15000,
    balance: -3000,
    budgetRemaining: 35000,
    transactionCount: 2
  });
});