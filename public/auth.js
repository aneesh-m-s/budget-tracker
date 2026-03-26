const tokenKey = "budgetAuthToken";

function setMessage(message, isError = true) {
  const messageEl = document.getElementById("authMessage");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.classList.toggle("error", isError);
  messageEl.classList.toggle("success", !isError);
}

function saveSession(token) {
  localStorage.setItem(tokenKey, token);
  window.location.href = "/";
}

async function send(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

async function onLogin(event) {
  event.preventDefault();
  const payload = {
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value
  };

  try {
    const data = await send("/api/auth/login", payload);
    saveSession(data.token);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function onSignup(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value
  };

  try {
    const data = await send("/api/auth/signup", payload);
    setMessage("Account created. Redirecting...", false);
    saveSession(data.token);
  } catch (error) {
    setMessage(error.message, true);
  }
}

function init() {
  const token = localStorage.getItem(tokenKey);
  if (token) {
    window.location.href = "/";
    return;
  }

  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  if (loginForm) {
    loginForm.addEventListener("submit", onLogin);
  }

  if (signupForm) {
    signupForm.addEventListener("submit", onSignup);
  }
}

init();
