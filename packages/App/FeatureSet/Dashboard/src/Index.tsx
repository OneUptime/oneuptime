import App from "./App";
import { i18nReady } from "./Utils/i18n";
import "Common/UI/Styles/Theme.css";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import ProjectUtil from "Common/UI/Utils/Project";
import ThemeUtil from "Common/UI/Utils/Theme";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/UI/Utils/API/API";
import { enablePrivateImageSessionRefresh } from "Common/UI/Components/Markdown.tsx/SessionAwareImage";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

ThemeUtil.initialize();

/*
 * Resolve every date the app renders / accepts in the timezone the user picked
 * in User Settings, not the one the browser happens to report. Runs before the
 * first render so no date is ever painted in the wrong zone.
 */
UserUtil.initializeUserTimezone();

/*
 * Let a private markdown image that failed because the access token lapsed
 * refresh this app's session and load again (see SessionAwareImage). Opt-in
 * per app: status pages and public dashboards render the same markdown
 * without a session of this kind.
 */
enablePrivateImageSessionRefresh((): Promise<boolean> => {
  return API.refreshSession();
});

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

/*
 * Locale bundles other than English are lazy chunks (Utils/i18n.ts), so a
 * detected non-English language arrives asynchronously. Waiting for
 * i18nReady before the first render means no frame is ever painted with raw
 * translation keys; for English (the statically-bundled fallback) the
 * promise settles in a microtask. i18nReady never hangs — a failed locale
 * fetch resolves it after i18next's retries — and the catch below renders
 * the app with English strings even if initialization itself blew up.
 *
 * The ErrorBoundary is the last-resort boundary: anything that throws above
 * the route-level boundary (or before routing is even mounted) would
 * otherwise unmount the entire tree and paint a blank white page with no way
 * back.
 */
i18nReady
  .catch((): void => {
    // Render anyway — the bundled English strings are always available.
  })
  .then((): void => {
    root.render(
      <ErrorBoundary>
        {/*
         * Product route bundles are lazy. React Router v7 otherwise wraps the
         * location update in a transition, which keeps the previous product
         * painted while a cold bundle suspends instead of revealing App's
         * PageLoader fallback. Product navigation should acknowledge the click
         * immediately, so keep router updates synchronous and let the nearest
         * Suspense boundary show its loading state.
         */}
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
      </ErrorBoundary>,
    );
  });
