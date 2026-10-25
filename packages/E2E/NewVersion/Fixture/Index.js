/*
 * A small app made of the real pieces every OneUptime frontend uses to move
 * onto a new version deployed while a tab is open: NewVersion and its
 * notice and navigation (Common/UI/Utils/NewVersion,
 * Common/UI/Components/NewVersion), the app's ErrorBoundary and
 * ContainedErrorBoundary, Common's Link and Navigation - with pages loaded
 * lazily, as the Dashboard's are.
 *
 * server.js builds it twice, as build A and build B, with Common's own
 * build() - which names each build and writes dist/build.json - and serves
 * one of them; the spec "deploys" the other mid-session.
 *
 * What the spec set on the first load (?audience=, ?lang=, ?theme=,
 * ?firstCheck=, ?gap=) is kept for the tab in sessionStorage, so a reload or
 * a full load of another page keeps it, as a real tab keeps its settings.
 */
import React, { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  BrowserRouter,
  Link as RouterLink,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import "Common/UI/Styles/Theme.css";
import Route from "Common/Types/API/Route";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import NewVersionNavigation from "Common/UI/Components/NewVersion/NewVersionNavigation";
import NewVersionNotice from "Common/UI/Components/NewVersion/NewVersionNotice";
import Navigation from "Common/UI/Utils/Navigation";
import NewVersion, {
  NewVersionAudience,
} from "Common/UI/Utils/NewVersion/NewVersion";
import { getRunningBuild } from "Common/UI/Utils/NewVersion/RunningBuild";
import locales from "new-version-fixture-locales";
import Home from "./Pages/Home";
import Widgets from "./Pages/Widgets";

const SETTINGS_KEY = "new-version-fixture-settings";
const BOOTS_KEY = "new-version-fixture-boots";
const DAY = 24 * 60 * 60 * 1000;

function readSettings() {
  const params = new URLSearchParams(window.location.search);
  let saved = {};

  try {
    saved = JSON.parse(window.sessionStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    saved = {};
  }

  const settings = {
    audience: params.get("audience") || saved.audience || "members",
    lang: params.get("lang") || saved.lang || "en",
    firstCheck: Number(params.get("firstCheck") || saved.firstCheck || DAY),
    gap: Number(params.get("gap") ?? saved.gap ?? 0),
  };

  window.sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  return settings;
}

const settings = readSettings();

/*
 * Every screen a page moving onto the new version showed, kept for the tab:
 * the page that showed it is gone by the time the spec can look (its
 * reload replaced it), so the spec reads them here afterwards.
 */
const SCREENS_KEY = "new-version-fixture-screens";

new MutationObserver(() => {
  const element = document.querySelector("[data-testid='chunk-load-recovery']");

  if (!element) {
    return;
  }

  const title = document.querySelector(
    "[data-testid='chunk-load-recovery-title']",
  );
  const screen = {
    step: element.getAttribute("data-step") || "",
    variant: element.getAttribute("data-variant") || "",
    title: title ? (title.innerText || "").trim() : "",
    text: (element.innerText || "").trim(),
  };
  const screens = JSON.parse(
    window.sessionStorage.getItem(SCREENS_KEY) || "[]",
  );
  const last = screens[screens.length - 1];

  if (!last || last.step !== screen.step || last.text !== screen.text) {
    screens.push(screen);
    window.sessionStorage.setItem(SCREENS_KEY, JSON.stringify(screens));
  }
}).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["data-step"],
  characterData: true,
});

const boots = Number(window.sessionStorage.getItem(BOOTS_KEY) || "0") + 1;
window.sessionStorage.setItem(BOOTS_KEY, String(boots));

window.__newVersionFixture = {
  boots: boots,
  buildId: getRunningBuild().buildId,
};

NewVersion.start({
  audience:
    settings.audience === "visitors"
      ? NewVersionAudience.Visitors
      : NewVersionAudience.Members,
  firstCheckDelayInMs: settings.firstCheck,
  checkIntervalInMs: DAY,
  minimumCheckGapInMs: settings.gap,
});

await i18next.use(initReactI18next).init({
  lng: settings.lang,
  fallbackLng: "en",
  resources: {
    en: { translation: {} },
    [settings.lang]: { translation: locales[settings.lang] || {} },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const Monitors = lazy(() => import("./Pages/Monitors"));
const Incidents = lazy(() => import("./Pages/Incidents"));
const Settings = lazy(() => import("./Pages/Settings"));

const NAV_LINK =
  "rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900";

function Shell() {
  const location = useLocation();
  const [chat, setChat] = useState("");

  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">OneUptime</span>
          <nav className="flex flex-wrap items-center gap-1">
            <Link
              to={new Route("/dashboard/home")}
              className={NAV_LINK}
              dataTestId="nav-home"
            >
              Home
            </Link>
            <Link
              to={new Route("/dashboard/monitors")}
              className={NAV_LINK}
              dataTestId="nav-monitors"
            >
              Monitors
            </Link>
            <Link
              to={new Route("/dashboard/incidents?state=open")}
              className={NAV_LINK}
              dataTestId="nav-incidents"
            >
              Incidents
            </Link>
            <RouterLink
              to="/dashboard/settings"
              className={NAV_LINK}
              data-testid="nav-settings"
            >
              Settings
            </RouterLink>
            <Link
              to={new Route("/dashboard/widgets")}
              className={NAV_LINK}
              dataTestId="nav-widgets"
            >
              Widgets
            </Link>
          </nav>
          <span
            data-testid="running-build"
            className="ms-auto text-xs text-gray-500"
          >
            {getRunningBuild().buildId}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageLoader isVisible={true} />}>
            <Routes>
              <PageRoute path="/dashboard/home" element={<Home />} />
              <PageRoute path="/dashboard/monitors" element={<Monitors />} />
              <PageRoute path="/dashboard/incidents" element={<Incidents />} />
              <PageRoute path="/dashboard/settings" element={<Settings />} />
              <PageRoute path="/dashboard/widgets" element={<Widgets />} />
              <PageRoute path="*" element={<Home />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        {/*
         * Stays on screen across pages, like the AI chat panel: what is
         * typed here is not on the page being left.
         */}
        <label className="mt-6 block max-w-md text-sm text-gray-700">
          Ask OneUptime AI
          <textarea
            data-testid="chat"
            rows={2}
            value={chat}
            onChange={(event) => setChat(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900"
          />
        </label>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <I18nextProvider i18n={i18next}>
    <ErrorBoundary>
      <BrowserRouter useTransitions={false}>
        <NewVersionNavigation />
        <Shell />
      </BrowserRouter>
      <NewVersionNotice />
    </ErrorBoundary>
  </I18nextProvider>,
);
