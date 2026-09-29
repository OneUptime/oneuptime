import App from "./App";
import "./Utils/i18n";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

Telemetry.init({
  serviceName: "accounts",
});

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

/*
 * Last-resort boundary. Anything that throws above the route-level boundary
 * (or before routing is even mounted) would otherwise unmount the entire tree
 * and paint a blank white page with no way back.
 */
root.render(
  <ErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ErrorBoundary>,
);
