import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const racine = document.getElementById("root");
if (!racine) {
  throw new Error("element #root introuvable dans index.html");
}

createRoot(racine).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
