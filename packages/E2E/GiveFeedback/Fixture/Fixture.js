/*
 * Offline fixture for Give Feedback (#6832, #8893).
 *
 * The dialog (Components/Feedback/GiveFeedbackDialog), the Help menu that
 * offers it and ProductFeedbackInit, which reads the server's feedback
 * settings and names the page an answer is given on, are the production
 * components from this branch, mounted once as App.tsx mounts them, over a
 * real Page whose breadcrumbs are "Project > SLOs". Only the data boundary
 * (API) and the signed-in person are replaced.
 *
 * Every value is fabricated for a generic "Acme Commerce" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?goes=   where the server says Give feedback goes, as its settings
 *            answer (giveFeedbackGoesTo):
 *              server_admins (default)  a self-hosted server with no Admin
 *                                       Notification Email: kept for its
 *                                       admins, without a name
 *              server_admins_by_email   a self-hosted server that emails it
 *                                       to its admins
 *              oneuptime_team           OneUptime Cloud (server.js turns
 *                                       billing on)
 *            A send is answered as the server answers it: emailed, with a
 *            copy on its way to the person, everywhere but the first.
 *   ?open=   help: opens it as Help's Give feedback does, once the settings
 *            arrive; checkin: as Home's first-week check-in does, on Idea
 *   ?email=  long: the person's address is longer than a phone's line
 *   ?lang=   de reads the German locale file, fa the Persian one (the page
 *            then reads right to left, as the Dashboard's does)
 *   ?theme=  dark adds html.dark (handled by server.js)
 *
 * The page also carries a button that opens the dialog as the check-in
 * does, so a spec can open it twice without a reload.
 *
 * Every read and send is recorded on window.__giveFeedbackFixture:
 * settingsReads, posts (each send's route and data) and unhandled, anything
 * the fixture does not model. The spec asserts `unhandled` is empty.
 */
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { initReactI18next } from "react-i18next";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import Help from "../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import GiveFeedbackDialog, {
  GiveFeedbackOpenedFrom,
  openGiveFeedback,
} from "../../../App/FeatureSet/Dashboard/src/Components/Feedback/GiveFeedbackDialog";
import ProductFeedbackInit from "../../../App/FeatureSet/Dashboard/src/Components/Feedback/ProductFeedbackInit";
import Page from "Common/UI/Components/Page/Page";
import RouteType from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import {
  GiveFeedbackDestination,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
} from "Common/Types/ProductFeedback/ProductFeedback";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { useProductFeedbackSettings } from "Common/UI/Utils/ProductFeedback";
import UserUtil from "Common/UI/Utils/User";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") || "en";

const DESTINATIONS = [
  GiveFeedbackDestination.ServerAdmins,
  GiveFeedbackDestination.ServerAdminsByEmail,
  GiveFeedbackDestination.OneUptimeTeam,
];
const GOES = DESTINATIONS.includes(params.get("goes"))
  ? params.get("goes")
  : GiveFeedbackDestination.ServerAdmins;

const PERSON_EMAIL =
  params.get("email") === "long"
    ? "maya.chen.platform.reliability@observability-team.acme-commerce-international.example"
    : "maya@acme-commerce.example";

const fixture = { settingsReads: 0, posts: [], unhandled: [] };
window.__giveFeedbackFixture = fixture;

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getName = () => {
  return "Maya Chen";
};
UserUtil.getEmail = () => {
  return new Email(PERSON_EMAIL);
};

const pathOf = (options) => {
  return new URL(options.url.toString()).pathname;
};

API.get = async (options) => {
  const path = pathOf(options);

  // ProductFeedbackInit's read, answered as the server answers it.
  if (path.endsWith(PRODUCT_FEEDBACK_SETTINGS_ROUTE)) {
    fixture.settingsReads += 1;
    return new HTTPResponse(
      200,
      { isOn: true, isAskingMe: true, giveFeedbackGoesTo: GOES },
      {},
    );
  }

  fixture.unhandled.push(`GET ${path}`);
  return new HTTPErrorResponse(404, { message: "Not modelled" }, {});
};

API.post = async (options) => {
  const path = pathOf(options);

  /*
   * A send: kept, then emailed where the server emails it, with a copy on
   * its way to the person (ProductFeedbackAPI's answer).
   */
  if (path.endsWith(PRODUCT_FEEDBACK_ROUTE)) {
    const isEmailed = GOES !== GiveFeedbackDestination.ServerAdmins;

    fixture.posts.push({ path, data: options.data });
    return new HTTPResponse(
      200,
      {
        answerId: "20000000-0000-4000-8000-000000000001",
        isEmailed,
        copyTo: isEmailed ? PERSON_EMAIL : null,
      },
      {},
    );
  }

  fixture.unhandled.push(`POST ${path}`);
  return new HTTPErrorResponse(404, { message: "Not modelled" }, {});
};

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: await localeResources({
    language: language,
    english: en,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
});
// Dates in the reader's language, as Utils/i18n.ts sets them.
followLanguageForDates(i18next);
// <html lang dir> follow the reader's language: Persian reads right to left.
followLanguageForPage(i18next);

/*
 * ---------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------------
 */
function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

// The SLOs list, empty: a page with a trail, as every Dashboard page has.
function SlosPage() {
  useNavigationHooks();

  return (
    <Page
      title="SLOs"
      breadcrumbLinks={[
        { title: "Project", to: new RouteType("/dashboard/home") },
        { title: "SLOs", to: new RouteType("/dashboard/slos") },
      ]}
    >
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-600">No SLOs yet.</p>
        {/* Stands in for Home's first-week check-in, which opens it on Idea. */}
        <button
          type="button"
          data-testid="fixture-open-from-check-in"
          className="mt-3 text-sm font-medium text-indigo-600"
          onClick={() => {
            openGiveFeedback(GiveFeedbackOpenedFrom.CheckIn);
          }}
        >
          Open as the check-in does
        </button>
      </div>
    </Page>
  );
}

// ?open=: opens the dialog once the server's settings have arrived.
function OpenOnLoad() {
  const settings = useProductFeedbackSettings();
  const isOpened = useRef(false);

  useEffect(() => {
    const from = params.get("open");

    if (!settings || isOpened.current || !from) {
      return;
    }

    isOpened.current = true;
    openGiveFeedback(
      from === "checkin"
        ? GiveFeedbackOpenedFrom.CheckIn
        : GiveFeedbackOpenedFrom.Help,
    );
  }, [settings]);

  return <></>;
}

function FixtureApp() {
  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Commerce</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            data-testid="synthetic-banner"
            className="text-xs text-gray-500"
          >
            Preview workspace · Synthetic data
          </span>
          <Help />
        </div>
      </header>
      {/* As App.tsx mounts them, once for every page. */}
      <ProductFeedbackInit />
      <GiveFeedbackDialog />
      <OpenOnLoad />
      <Routes>
        <Route path="/dashboard/:projectId/slos" element={<SlosPage />} />
      </Routes>
    </>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
