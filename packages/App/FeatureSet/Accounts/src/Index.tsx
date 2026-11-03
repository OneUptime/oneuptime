import App from "./App";
import { i18nReady } from "./Utils/i18n";
import AccountsTheme from "./Utils/AccountsTheme";
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
 * The person's theme, which the page's first script drew before the first
 * paint, kept in step from here: the device, and a pick made in another tab
 * (Utils/AccountsTheme.ts).
 */
AccountsTheme.initialize();

Telemetry.init({
  serviceName: "accounts",
});

/*
 * Notice a new version of OneUptime deployed while this tab is open, and
 * move the reader onto it on the next page they open, or when a page's code
 * is gone (Common/UI/Utils/NewVersion/NewVersion.ts). No notice: a sign-in
 * or a form is over in a minute.
 */
NewVersion.start({ audience: NewVersionAudience.Members });

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

/*
 * Locale bundles other than English are lazy chunks (Utils/i18n.ts), so a
 * detected non-English language arrives asynchronously. Waiting for
 * i18nReady before the first render means no frame is ever painted with raw
 * translation keys; for English (the statically-bundled fallback) the
 * promise settles in a microtask. i18nReady never hangs - a failed locale
 * fetch resolves it after i18next's retries - and the catch below renders
 * the page with English strings even if initialization itself blew up.
 *
 * The ErrorBoundary is the last-resort boundary: anything that throws above
 * the route-level boundary (or before routing is even mounted) would
 * otherwise unmount the entire tree and paint a blank white page with no way
 * back.
 */
i18nReady
  .catch((): void => {
    // Render anyway - the bundled English strings are always available.
  })
  .then((): void => {
    root.render(
      <ErrorBoundary>
        <BrowserRouter>
          <NewVersionNavigation />
          <App />
        </BrowserRouter>
      </ErrorBoundary>,
    );
  });
