import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { EventBusProvider } from "./lib/eventBus";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <EventBusProvider>
        <App />
      </EventBusProvider>
    </BrowserRouter>
  </React.StrictMode>
);
