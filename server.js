const express = require("express");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

let transactions = [];

app.get("/transactions", (req, res) => {
  res.json(transactions);
});

app.post("/add", (req, res) => {
  const { text, amount } = req.body;
  transactions.push({ text, amount });
  res.send("Added");
});

app.listen(PORT, () => console.log("Server running on port " + PORT));