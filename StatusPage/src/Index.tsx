import App from "./App";
import Telemetry from "Common/UI/Utils/Telemetry";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

Telemetry.init({
  serviceName: "status-page",
});

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
