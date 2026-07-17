import App from "./App";
import "./Utils/i18n";
import "Common/UI/Styles/Theme.css";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ProjectUtil from "Common/UI/Utils/Project";
import ThemeUtil from "Common/UI/Utils/Theme";
import UserUtil from "Common/UI/Utils/User";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

ThemeUtil.initialize();

Telemetry.init({
  serviceName: "dashboard",
});

/*
 * Seed RUM context so browser spans carry the signed-in user and the project
 * being viewed. Project context is kept fresh on switch via
 * ProjectUtil.setCurrentProject.
 */
Telemetry.setGlobalAttributes({
  ...(UserUtil.isLoggedIn() ? { userId: UserUtil.getUserId().toString() } : {}),
  ...(ProjectUtil.getCurrentProjectId()
    ? { projectId: ProjectUtil.getCurrentProjectId()!.toString() }
    : {}),
});

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
