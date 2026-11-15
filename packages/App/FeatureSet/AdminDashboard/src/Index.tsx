import App from "./App";
import { i18nReady } from "./Utils/i18n";
import "Common/UI/Styles/Theme.css";
import Telemetry from "Common/UI/Utils/Telemetry/Telemetry";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import NewVersionNavigation from "Common/UI/Components/NewVersion/NewVersionNavigation";
import NewVersionNotice from "Common/UI/Components/NewVersion/NewVersionNotice";
import NewVersion, {
  NewVersionAudience,
} from "Common/UI/Utils/NewVersion/NewVersion";
import ForeignDomMutationGuard from "Common/UI/Utils/ForeignDomMutationGuard";
import ThemeUtil from "Common/UI/Utils/Theme";
import UserUtil from "Common/UI/Utils/User";
import UserActivity from "Common/UI/Utils/UserActivity";
import API from "Common/UI/Utils/API/API";
import { enablePrivateImageSessionRefresh } from "Common/UI/Components/Markdown.tsx/SessionAwareImage";
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
 * When the person last clicked, typed or scrolled, in any tab: every renewal
 * of the session says how long ago that was, and the server's idle timeout
 * is counted from it (Common/UI/Utils/UserActivity).
 */
UserActivity.install();

ThemeUtil.initialize();

// Render dates in the timezone the user picked in User Settings.
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
  serviceName: "admin-dashboard",
});

/*
 * Notice a new version of OneUptime deployed while this tab is open, and
 * move the reader onto it: the next page they open loads it, the notice
 * says it is ready, and a page whose code is gone loads it instead of
 * failing (Common/UI/Utils/NewVersion/NewVersion.ts).
 */
NewVersion.start({ audience: NewVersionAudience.Members });

const root: any = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

/*
 * Every language but English is a lazy chunk (Utils/i18n.ts, #8146), so a
 * reader's language arrives asynchronously. Waiting for i18nReady before the
 * first render means no frame is painted in English for a German or Persian
 * reader; for English, bundled with the page, it settles in a microtask.
 * i18nReady never hangs - a chunk that cannot be fetched resolves it after
 * i18next's retries - and the catch below renders in English even if
 * initialization itself failed.
 *
 * The ErrorBoundary is the last-resort boundary: anything that throws above
 * the route-level boundary (or before routing is even mounted) would
 * otherwise unmount the entire tree and paint a blank white page with no way
 * back.
 */
i18nReady
  .catch((): void => {
    // Render anyway: the bundled English is always there.
  })
  .then((): void => {
    root.render(
      <ErrorBoundary>
        <BrowserRouter>
          <NewVersionNavigation />
          <App />
        </BrowserRouter>
        <NewVersionNotice />
      </ErrorBoundary>,
    );
  });
