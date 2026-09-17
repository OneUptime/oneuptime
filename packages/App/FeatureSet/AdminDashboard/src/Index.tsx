import App from "./App";
import "./Utils/i18n";
import "Common/UI/Styles/Theme.css";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import ThemeUtil from "Common/UI/Utils/Theme";
import UserUtil from "Common/UI/Utils/User";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

ThemeUtil.initialize();

// Render dates in the timezone the user picked in User Settings.
UserUtil.initializeUserTimezone();

Telemetry.init({
  serviceName: "admin-dashboard",
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
