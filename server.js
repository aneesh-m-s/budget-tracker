const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "store.json");
const DATA_FILE = process.env.DATA_FILE || DEFAULT_DATA_FILE;
const DATA_DIR = path.dirname(DATA_FILE);

const DEFAULT_STORE = {
  budget: {
    monthly: 0,
    currency: "INR"
  },
  transactions: []
};

app.use(express.json());
app.use(express.static("public"));

async function ensureStore() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw || "{}");

  return {
    budget: {
      monthly: Number(parsed?.budget?.monthly) || 0,
      currency: parsed?.budget?.currency || "INR"
    },
    transactions: Array.isArray(parsed?.transactions) ? parsed.transactions : []
  };
}

async function writeStore(store) {
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function sanitizeTransaction(input) {
  const description = String(input.description || "").trim();
  const category = String(input.category || "").trim() || "General";
  const type = String(input.type || "expense").toLowerCase();
  const amount = Number(input.amount);
  const date = String(input.date || "").trim();

  if (!description) return { error: "Description is required." };
  if (!["income", "expense"].includes(type)) return { error: "Type must be income or expense." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Amount must be a positive number." };
  if (!date || Number.isNaN(Date.parse(date))) return { error: "Date must be a valid date." };

  return {
    value: {
      description,
      category,
      type,
      amount: Number(amount.toFixed(2)),
      date: new Date(date).toISOString().slice(0, 10)
    }
  };
}

function byRecentDate(a, b) {
  return new Date(b.date) - new Date(a.date);
}

function monthFilter(month, fallbackDate) {
  const source = month || fallbackDate;
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/settings", async (_req, res) => {
  const store = await readStore();
  res.json(store.budget);
});

app.put("/api/settings", async (req, res) => {
  const monthly = Number(req.body.monthly);
  const currency = String(req.body.currency || "INR").trim().toUpperCase();

  if (!Number.isFinite(monthly) || monthly < 0) {
    return res.status(400).json({ message: "Monthly budget must be a non-negative number." });
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ message: "Currency must be a 3-letter ISO code." });
  }

  const store = await readStore();
  store.budget = { monthly: Number(monthly.toFixed(2)), currency };
  await writeStore(store);

  return res.json(store.budget);
});

app.get("/api/transactions", async (req, res) => {
  const month = String(req.query.month || "").trim();
  const store = await readStore();

  let results = [...store.transactions];
  if (month) {
    results = results.filter((t) => t.date.startsWith(month));
  }

  results.sort(byRecentDate);
  res.json(results);
});

app.post("/api/transactions", async (req, res) => {
  const parsed = sanitizeTransaction(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const store = await readStore();
  const transaction = {
    id: randomUUID(),
    ...parsed.value,
    createdAt: new Date().toISOString()
  };

  store.transactions.push(transaction);
  await writeStore(store);

  return res.status(201).json(transaction);
});

app.put("/api/transactions/:id", async (req, res) => {
  const parsed = sanitizeTransaction(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const store = await readStore();
  const index = store.transactions.findIndex((t) => t.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Transaction not found." });
  }

  store.transactions[index] = {
    ...store.transactions[index],
    ...parsed.value,
    updatedAt: new Date().toISOString()
  };

  await writeStore(store);
  return res.json(store.transactions[index]);
});

app.delete("/api/transactions/:id", async (req, res) => {
  const store = await readStore();
  const next = store.transactions.filter((t) => t.id !== req.params.id);

  if (next.length === store.transactions.length) {
    return res.status(404).json({ message: "Transaction not found." });
  }

  store.transactions = next;
  await writeStore(store);
  return res.status(204).send();
});

app.get("/api/summary", async (req, res) => {
  const store = await readStore();
  const month = monthFilter(String(req.query.month || "").trim(), new Date().toISOString());
  const rows = month
    ? store.transactions.filter((t) => t.date.startsWith(month))
    : store.transactions;

  const income = rows.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const expense = rows.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = income - expense;
  const budgetRemaining = store.budget.monthly - expense;

  res.json({
    month,
    income: Number(income.toFixed(2)),
    expense: Number(expense.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    budgetRemaining: Number(budgetRemaining.toFixed(2)),
    transactionCount: rows.length,
    budget: store.budget
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;