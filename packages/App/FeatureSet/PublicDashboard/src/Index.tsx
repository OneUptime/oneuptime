import App from "./App";
import DashboardThemeUtil from "./Utils/DashboardTheme";
import "Common/UI/Styles/Theme.css";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import NewVersionNavigation from "Common/UI/Components/NewVersion/NewVersionNavigation";
import NewVersion, {
  NewVersionAudience,
} from "Common/UI/Utils/NewVersion/NewVersion";
import ForeignDomMutationGuard from "Common/UI/Utils/ForeignDomMutationGuard";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

/*
 * Before anything renders. Browser extensions - translators, password
 * managers - wrap, move or remove nodes React manages, and React's next commit
 * would then throw NotFoundError and take the page down with it (see
 * ForeignDomMutationGuard).
 */
ForeignDomMutationGuard.install();

/*
 * The dashboard's theme, as the first script in <head> drew it
 * (views/index.ejs) from the link, the visitor's pick and the theme the
 * server sent, kept in step with the visitor's device from here on. The
 * dashboard's own theme follows with its metadata (App.tsx).
 */
DashboardThemeUtil.initialize();

Telemetry.init({
  serviceName: "public-dashboard",
});

/*
 * Notice a new version deployed while this page is open, and move the
 * visitor onto it on the next page they open, or when a page's code is gone
 * - in words that never name OneUptime, and without a notice: a visitor
 * has nothing to do about it (Common/UI/Utils/NewVersion/NewVersion.ts).
 */
NewVersion.start({ audience: NewVersionAudience.Visitors });

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
      <NewVersionNavigation />
      <App />
    </BrowserRouter>
  </ErrorBoundary>,
);
