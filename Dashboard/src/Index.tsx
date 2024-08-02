import App from "./App";
import Telemetry from "CommonUI/src/Utils/Telemetry";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

Telemetry.init({
  serviceName: "dashboard",
});

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
