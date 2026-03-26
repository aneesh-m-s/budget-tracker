const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "store.json");
const DATA_FILE = process.env.DATA_FILE || DEFAULT_DATA_FILE;
const DATA_DIR = path.dirname(DATA_FILE);

const DEFAULT_STORE = {
  users: [],
  sessions: [],
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
  let parsed;

  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    const backupFile = path.join(DATA_DIR, `store.corrupt.${Date.now()}.json`);
    await fs.writeFile(backupFile, raw, "utf8");
    await writeStore(DEFAULT_STORE);
    parsed = { ...DEFAULT_STORE };
  }

  const users = Array.isArray(parsed?.users) ? parsed.users : [];
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];

  return {
    users,
    sessions,
    transactions
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

function sanitizeAuthInput(input) {
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");

  return { name, email, password };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hashed = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password, value) {
  const [salt, hashed] = String(value || "").split(":");
  if (!salt || !hashed) return false;

  const hashedBuffer = Buffer.from(hashed, "hex");
  const inputBuffer = scryptSync(password, salt, 64);
  if (hashedBuffer.length !== inputBuffer.length) return false;

  return timingSafeEqual(hashedBuffer, inputBuffer);
}

function createSession(store, userId) {
  const token = randomBytes(32).toString("hex");
  store.sessions.push({
    token,
    userId,
    createdAt: new Date().toISOString()
  });
  return token;
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    monthlyBudget: Number(user.monthlyBudget || 0),
    currency: user.currency || "INR"
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

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = sanitizeAuthInput(req.body || {});

  if (!name || name.length < 2) {
    return res.status(400).json({ message: "Name must be at least 2 characters." });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ message: "A valid email is required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  const store = await readStore();
  const exists = store.users.some((user) => user.email === email);
  if (exists) {
    return res.status(409).json({ message: "Email is already registered." });
  }

  const user = {
    id: randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    monthlyBudget: 0,
    currency: "INR",
    createdAt: new Date().toISOString()
  };

  store.users.push(user);
  const token = createSession(store, user.id);
  await writeStore(store);

  return res.status(201).json({ token, user: toPublicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = sanitizeAuthInput(req.body || {});
  const store = await readStore();
  const user = store.users.find((candidate) => candidate.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const token = createSession(store, user.id);
  await writeStore(store);

  return res.json({ token, user: toPublicUser(user) });
});

async function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  const store = await readStore();
  const session = store.sessions.find((row) => row.token === token);
  if (!session) {
    return res.status(401).json({ message: "Invalid or expired session." });
  }

  const user = store.users.find((row) => row.id === session.userId);
  if (!user) {
    return res.status(401).json({ message: "User not found for session." });
  }

  req.auth = { token, user, store };
  return next();
}

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: toPublicUser(req.auth.user) });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const store = req.auth.store;
  store.sessions = store.sessions.filter((row) => row.token !== req.auth.token);
  await writeStore(store);
  res.status(204).send();
});

app.get("/api/settings", requireAuth, async (req, res) => {
  res.json({
    monthly: Number(req.auth.user.monthlyBudget || 0),
    currency: req.auth.user.currency || "INR"
  });
});

app.put("/api/settings", requireAuth, async (req, res) => {
  const monthly = Number(req.body.monthly);
  const currency = String(req.body.currency || "INR").trim().toUpperCase();

  if (!Number.isFinite(monthly) || monthly < 0) {
    return res.status(400).json({ message: "Monthly budget must be a non-negative number." });
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ message: "Currency must be a 3-letter ISO code." });
  }

  const store = req.auth.store;
  const user = store.users.find((item) => item.id === req.auth.user.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  user.monthlyBudget = Number(monthly.toFixed(2));
  user.currency = currency;
  await writeStore(store);

  return res.json({ monthly: user.monthlyBudget, currency: user.currency });
});

app.get("/api/transactions", requireAuth, async (req, res) => {
  const month = String(req.query.month || "").trim();
  const store = req.auth.store;

  let results = store.transactions.filter((t) => t.userId === req.auth.user.id);
  if (month) {
    results = results.filter((t) => t.date.startsWith(month));
  }

  results.sort(byRecentDate);
  res.json(results);
});

app.post("/api/transactions", requireAuth, async (req, res) => {
  const parsed = sanitizeTransaction(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const store = req.auth.store;
  const transaction = {
    id: randomUUID(),
    userId: req.auth.user.id,
    ...parsed.value,
    createdAt: new Date().toISOString()
  };

  store.transactions.push(transaction);
  await writeStore(store);

  return res.status(201).json(transaction);
});

app.put("/api/transactions/:id", requireAuth, async (req, res) => {
  const parsed = sanitizeTransaction(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const store = req.auth.store;
  const index = store.transactions.findIndex((t) => t.id === req.params.id && t.userId === req.auth.user.id);

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

app.delete("/api/transactions/:id", requireAuth, async (req, res) => {
  const store = req.auth.store;
  const next = store.transactions.filter((t) => !(t.id === req.params.id && t.userId === req.auth.user.id));

  if (next.length === store.transactions.length) {
    return res.status(404).json({ message: "Transaction not found." });
  }

  store.transactions = next;
  await writeStore(store);
  return res.status(204).send();
});

app.get("/api/summary", requireAuth, async (req, res) => {
  const store = req.auth.store;
  const month = monthFilter(String(req.query.month || "").trim(), new Date().toISOString());
  const rows = month
    ? store.transactions.filter((t) => t.userId === req.auth.user.id && t.date.startsWith(month))
    : store.transactions.filter((t) => t.userId === req.auth.user.id);

  const income = rows.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const expense = rows.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const balance = income - expense;
  const budgetRemaining = Number(req.auth.user.monthlyBudget || 0) - expense;

  res.json({
    month,
    income: Number(income.toFixed(2)),
    expense: Number(expense.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    budgetRemaining: Number(budgetRemaining.toFixed(2)),
    transactionCount: rows.length,
    budget: {
      monthly: Number(req.auth.user.monthlyBudget || 0),
      currency: req.auth.user.currency || "INR"
    }
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;