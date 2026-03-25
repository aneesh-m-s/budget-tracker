async function addTransaction() {
  const text = document.getElementById("text").value;
  const amount = document.getElementById("amount").value;

  await fetch("/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, amount })
  });

  loadTransactions();
}

async function loadTransactions() {
  const res = await fetch("/transactions");
  const data = await res.json();

  const list = document.getElementById("list");
  list.innerHTML = "";

  data.forEach(t => {
    const li = document.createElement("li");
    li.innerText = `${t.text}: ₹${t.amount}`;
    list.appendChild(li);
  });
}

loadTransactions();