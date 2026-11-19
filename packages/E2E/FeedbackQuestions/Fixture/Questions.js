/*
 * Offline fixture for the questions OneUptime asks, and how they read
 * (#6832, #7362, #7462): "How easy was that?" under a finished guided setup
 * and "Stuck?" under its steps (GuidedSetupFrame, through SetupFeedback),
 * the first-week check-in on Home (SetupCheckInCard), "Was this clear?"
 * under How OneUptime works (WasThisClear) and Give feedback from the
 * phone's menu (PhoneMenuHelp, then GiveFeedbackDialog).
 *
 * Every component is the production one from this branch, mounted as the
 * Dashboard mounts it. Only the data boundary (API) and the signed-in person
 * and project are replaced. Every value is fabricated for a generic "Acme
 * Commerce" workspace.
 *
 * Picked with query parameters, parsed once at load:
 *
 *   ?view=   setup (default): a finished Know when my website or API is down,
 *            which the server says to ask about
 *            stuck: the same setup before its end, "Stuck?" under its steps
 *            checkin: Home's first-week check-in, for the project's creator
 *            on its 8th day
 *            clear: How OneUptime works' "Was this clear?"
 *            phone: the phone's menu, its Help open, Give feedback in it
 *   ?cloud=1 OneUptime Cloud (billing on, set by server.js); self-hosted
 *            otherwise, where nothing leaves the server
 *   ?lang=   de reads the German locale file, fa the Persian one (the page
 *            then reads right to left)
 *   ?theme=  dark adds html.dark (server.js)
 *
 * Every read and send is recorded on window.__feedbackQuestionsFixture:
 * asks (each question asked of the server), posts (each answer's route and
 * data) and unhandled, anything the fixture does not model.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
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
import GuidedSetupFrame from "../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import SetupCheckInCard from "../../../App/FeatureSet/Dashboard/src/Components/Feedback/SetupCheckInCard";
import GiveFeedbackDialog from "../../../App/FeatureSet/Dashboard/src/Components/Feedback/GiveFeedbackDialog";
import ProductFeedbackInit from "../../../App/FeatureSet/Dashboard/src/Components/Feedback/ProductFeedbackInit";
import { PhoneMenuHelp } from "../../../App/FeatureSet/Dashboard/src/Components/NavBar/PhoneMenuEntries";
import WasThisClear from "Common/UI/Components/Feedback/WasThisClear";
import Page from "Common/UI/Components/Page/Page";
import RouteType from "Common/Types/API/Route";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import {
  GiveFeedbackDestination,
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
} from "Common/Types/ProductFeedback/ProductFeedback";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const params = new URLSearchParams(window.location.search);
const language = params.get("lang") || "en";
const view = params.get("view") || "setup";
const isCloud = params.get("cloud") === "1";

const PROJECT_ID = "10000000-0000-4000-8000-000000007362";
const USER_ID = "40000000-0000-4000-8000-000000007362";
const ANSWER_ID = "20000000-0000-4000-8000-000000007362";
const DAY_MS = 24 * 60 * 60 * 1000;

const fixture = { asks: [], posts: [], unhandled: [] };
window.__feedbackQuestionsFixture = fixture;

/*
 * ---------------------------------------------------------------------------
 * The signed-in person, their project and the data boundary
 * ---------------------------------------------------------------------------
 */
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(USER_ID);
};
UserUtil.getName = () => {
  return "Maya Chen";
};
UserUtil.getEmail = () => {
  return new Email("maya@acme-commerce.example");
};

// A project Maya made eight days ago: the check-in's first week is over.
const project = new Project();
project.id = new ObjectID(PROJECT_ID);
project.name = "Acme Commerce";
project.createdAt = new Date(Date.now() - 8 * DAY_MS);
project.createdByUserId = new ObjectID(USER_ID);
ProjectUtil.getCurrentProject = () => {
  return project;
};
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};

const pathOf = (options) => {
  return new URL(options.url.toString()).pathname;
};

API.get = async (options) => {
  const path = pathOf(options);

  if (path.endsWith(PRODUCT_FEEDBACK_SETTINGS_ROUTE)) {
    return new HTTPResponse(
      200,
      {
        isOn: true,
        isAskingMe: true,
        giveFeedbackGoesTo: isCloud
          ? GiveFeedbackDestination.OneUptimeTeam
          : GiveFeedbackDestination.ServerAdmins,
      },
      {},
    );
  }

  fixture.unhandled.push(`GET ${path}`);
  return new HTTPErrorResponse(404, { message: "Not modelled" }, {});
};

API.post = async (options) => {
  const path = pathOf(options);

  // May OneUptime ask this question now? The server says yes, once.
  if (path.endsWith(PRODUCT_FEEDBACK_ASK_ROUTE)) {
    fixture.asks.push(options.data && options.data.question);
    return new HTTPResponse(200, { ask: true, reason: "ask" }, {});
  }

  if (path.endsWith(PRODUCT_FEEDBACK_DETAILS_ROUTE)) {
    fixture.posts.push({ path, data: options.data });
    return new HTTPResponse(200, { added: true }, {});
  }

  if (path.endsWith(PRODUCT_FEEDBACK_ROUTE)) {
    fixture.posts.push({ path, data: options.data });
    return new HTTPResponse(
      200,
      { answerId: ANSWER_ID, isEmailed: false, copyTo: null },
      {},
    );
  }

  fixture.unhandled.push(`POST ${path}`);
  return new HTTPErrorResponse(404, { message: "Not modelled" }, {});
};

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, built as the Dashboard ships them (server.js).
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
followLanguageForDates(i18next);
followLanguageForPage(i18next);

/*
 * ---------------------------------------------------------------------------
 * The views
 * ---------------------------------------------------------------------------
 */
function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

// Know when my website or API is down, finished or at its first step.
function SetupView(props) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        Know when my website or API is down
      </h1>
      <GuidedSetupFrame
        setup="website_down"
        steps={[
          {
            key: "check",
            title: "Check your website",
            isDone: props.isFinished,
            content: (
              <p className="text-sm text-gray-600">
                https://shop.acme-commerce.example is checked every minute.
              </p>
            ),
          },
          {
            key: "who_is_told",
            title: "Who is told",
            isDone: props.isFinished,
            content: (
              <p className="text-sm text-gray-600">Maya Chen, by email.</p>
            ),
          },
        ]}
        openStepKey={props.isFinished ? null : "check"}
        onOpenStep={() => {}}
        summary={
          <p className="text-sm text-gray-700">
            Your website is checked, and Maya is emailed when it goes down.
          </p>
        }
        isFinished={props.isFinished}
      />
    </div>
  );
}

function CheckInView() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Home</h1>
      <SetupCheckInCard projectId={PROJECT_ID} isInIncident={false} />
    </div>
  );
}

function ClearView() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-gray-900">
          How OneUptime works
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          A problem moves through four steps: you notice it, you are told, you
          fix it, and you tell your customers.
        </p>
        <WasThisClear topic="how_oneuptime_works" className="mt-4" />
      </div>
    </div>
  );
}

/*
 * The phone's menu, its Help folded open by the spec, over Home: a page with
 * a trail, as every Dashboard page has, so Give feedback names it ("Home").
 */
function PhoneView() {
  const [isMenuOpen, setIsMenuOpen] = useState(true);

  return (
    <Page
      title="Home"
      breadcrumbLinks={[
        {
          title: "Project",
          to: new RouteType(`/dashboard/${PROJECT_ID}/home`),
        },
        { title: "Home", to: new RouteType(`/dashboard/${PROJECT_ID}/home`) },
      ]}
    >
      {isMenuOpen ? (
        <nav
          className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm"
          data-testid="fixture-phone-menu"
        >
          <PhoneMenuHelp
            closeMenu={() => {
              setIsMenuOpen(false);
            }}
          />
        </nav>
      ) : (
        <p className="text-sm text-gray-500">Menu closed.</p>
      )}
    </Page>
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <span className="text-lg font-semibold text-gray-900">OneUptime</span>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      {/* As App.tsx mounts them, once for every page. */}
      <ProductFeedbackInit />
      <GiveFeedbackDialog />
      {view === "stuck" ? <SetupView isFinished={false} /> : <></>}
      {view === "setup" ? <SetupView isFinished={true} /> : <></>}
      {view === "checkin" ? <CheckInView /> : <></>}
      {view === "clear" ? <ClearView /> : <></>}
      {view === "phone" ? <PhoneView /> : <></>}
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
