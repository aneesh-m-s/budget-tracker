const state = {
  month: new Date().toISOString().slice(0, 7),
  currency: "INR",
  transactions: [],
  token: localStorage.getItem("budgetAuthToken") || ""
};

const el = {
  monthFilter: document.getElementById("monthFilter"),
  monthlyBudget: document.getElementById("monthlyBudget"),
  currency: document.getElementById("currency"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  form: document.getElementById("transactionForm"),
  description: document.getElementById("description"),
  amount: document.getElementById("amount"),
  type: document.getElementById("type"),
  category: document.getElementById("category"),
  date: document.getElementById("date"),
  incomeValue: document.getElementById("incomeValue"),
  expenseValue: document.getElementById("expenseValue"),
  balanceValue: document.getElementById("balanceValue"),
  budgetLeftValue: document.getElementById("budgetLeftValue"),
  transactionRows: document.getElementById("transactionRows"),
  transactionCount: document.getElementById("transactionCount"),
  categoryBreakdown: document.getElementById("categoryBreakdown"),
  welcomeUser: document.getElementById("welcomeUser"),
  logoutBtn: document.getElementById("logoutBtn")
};

function redirectToLogin() {
  localStorage.removeItem("budgetAuthToken");
  window.location.href = "/login.html";
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.currency,
    maximumFractionDigits: 2
  }).format(value || 0);
}

async function request(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    if (response.status === 401) {
      redirectToLogin();
      return null;
    }

    const err = await response.json().catch(() => ({ message: "Request failed." }));
    throw new Error(err.message || "Request failed.");
  }

  if (response.status === 204) return null;
  return response.json();
}

async function loadCurrentUser() {
  const result = await request("/api/auth/me");
  if (!result) return;
  el.welcomeUser.textContent = `Hi, ${result.user.name}`;
}

function renderSummary(summary) {
  el.incomeValue.textContent = formatMoney(summary.income);
  el.expenseValue.textContent = formatMoney(summary.expense);
  el.balanceValue.textContent = formatMoney(summary.balance);
  el.budgetLeftValue.textContent = formatMoney(summary.budgetRemaining);
  el.transactionCount.textContent = `${summary.transactionCount} entries`;
}

function renderBreakdown(transactions) {
  const expenses = transactions.filter((t) => t.type === "expense");
  const byCategory = expenses.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});

  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);

  if (!entries.length) {
    el.categoryBreakdown.innerHTML = "<li>No expense data for this month.</li>";
    return;
  }

  el.categoryBreakdown.innerHTML = entries
    .map(([category, amount]) => {
      const percent = total ? Math.round((amount / total) * 100) : 0;
      return `
      <li>
        <div>${category} • ${formatMoney(amount)} (${percent}%)</div>
        <div class="bar"><span style="width:${percent}%"></span></div>
      </li>`;
    })
    .join("");
}

function renderRows(transactions) {
  if (!transactions.length) {
    el.transactionRows.innerHTML = '<tr><td colspan="6">No transactions for this month yet.</td></tr>';
    return;
  }

  el.transactionRows.innerHTML = transactions
    .map((t) => {
      return `
      <tr>
        <td>${t.date}</td>
        <td>${t.description}</td>
        <td>${t.category}</td>
        <td><span class="tag ${t.type}">${t.type}</span></td>
        <td>${formatMoney(t.amount)}</td>
        <td>
          <div class="row-actions">
            <button class="link-btn" data-action="edit" data-id="${t.id}">Edit</button>
            <button class="link-btn delete" data-action="delete" data-id="${t.id}">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

async function loadSettings() {
  const settings = await request("/api/settings");
  state.currency = settings.currency || "INR";
  el.monthlyBudget.value = settings.monthly || 0;
  el.currency.value = state.currency;
}

async function saveSettings() {
  const payload = {
    monthly: Number(el.monthlyBudget.value || 0),
    currency: String(el.currency.value || "INR").toUpperCase()
  };

  const settings = await request("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  state.currency = settings.currency;
  await loadDashboard();
}

function openEditPrompt(transaction) {
  const description = prompt("Description", transaction.description);
  if (description === null) return null;

  const amount = prompt("Amount", String(transaction.amount));
  if (amount === null) return null;

  const type = prompt("Type (income/expense)", transaction.type);
  if (type === null) return null;

  const category = prompt("Category", transaction.category);
  if (category === null) return null;

  const date = prompt("Date (YYYY-MM-DD)", transaction.date);
  if (date === null) return null;

  return {
    description,
    amount: Number(amount),
    type: String(type).toLowerCase(),
    category,
    date
  };
}

async function submitTransaction(event) {
  event.preventDefault();

  const payload = {
    description: el.description.value.trim(),
    amount: Number(el.amount.value),
    type: el.type.value,
    category: el.category.value.trim(),
    date: el.date.value
  };

  await request("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  el.form.reset();
  el.type.value = "expense";
  el.date.value = new Date().toISOString().slice(0, 10);
  await loadDashboard();
}

async function onRowAction(event) {
  const target = event.target.closest("button[data-action]");
  if (!target) return;

  const id = target.dataset.id;
  const action = target.dataset.action;

  if (action === "delete") {
    const ok = confirm("Delete this transaction?");
    if (!ok) return;
    await request(`/api/transactions/${id}`, { method: "DELETE" });
    await loadDashboard();
    return;
  }

  if (action === "edit") {
    const existing = state.transactions.find((t) => t.id === id);
    if (!existing) return;
    const payload = openEditPrompt(existing);
    if (!payload) return;

    await request(`/api/transactions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await loadDashboard();
  }
}

async function loadDashboard() {
  const [transactions, summary] = await Promise.all([
    request(`/api/transactions?month=${state.month}`),
    request(`/api/summary?month=${state.month}`)
  ]);

  state.transactions = transactions;
  renderRows(transactions);
  renderSummary(summary);
  renderBreakdown(transactions);
}

function attachListeners() {
  el.form.addEventListener("submit", (event) => {
    submitTransaction(event).catch((error) => alert(error.message));
  });

  el.transactionRows.addEventListener("click", (event) => {
    onRowAction(event).catch((error) => alert(error.message));
  });

  el.saveSettingsBtn.addEventListener("click", () => {
    saveSettings().catch((error) => alert(error.message));
  });

  el.monthFilter.addEventListener("change", () => {
    state.month = el.monthFilter.value;
    loadDashboard().catch((error) => alert(error.message));
  });

  el.logoutBtn.addEventListener("click", () => {
    request("/api/auth/logout", { method: "POST" })
      .catch(() => null)
      .finally(() => redirectToLogin());
  });
}

async function init() {
  if (!state.token) {
    redirectToLogin();
    return;
  }

  el.monthFilter.value = state.month;
  el.date.value = new Date().toISOString().slice(0, 10);
  await loadCurrentUser();
  await loadSettings();
  await loadDashboard();
  attachListeners();
}

init().catch((error) => {
  alert(error.message || "Unable to load app.");
});