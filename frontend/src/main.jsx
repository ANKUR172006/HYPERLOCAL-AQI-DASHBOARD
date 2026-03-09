import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

window.__AQI_API_BASE__ = window.__AQI_API_BASE__ || import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/v1";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
