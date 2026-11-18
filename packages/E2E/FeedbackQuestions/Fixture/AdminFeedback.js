/*
 * Admin Dashboard > Feedback (#6832, #7362, #7366, #7209, #7365), its
 * production page from this branch (/admin/feedback): the switch that asks
 * people, By Question, What People Said (how long answers are kept, and a
 * row's Delete), Ask AI Answers (what the answers rated down read) and, on
 * a self-hosted server, the docs pages - over the server's answers kept in
 * memory. Only the data boundary is replaced: API, ModelAPI and the
 * signed-in master admin.
 *
 *   ?cloud=1   OneUptime Cloud (billing on, set by server.js): no docs
 *              switch, and Ask AI's questions never shown
 *   ?lang=     de or fa: the Admin Dashboard's German or Persian
 *   ?theme=    dark (server.js)
 *
 * Recorded on window.__adminFeedbackFixture: every read the page makes
 * (reads), every delete (deletes) and anything the fixture does not model
 * (unmodeled), which the spec expects to stay empty.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { i18nReady } from "../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import FeedbackPage from "../../../App/FeatureSet/AdminDashboard/src/Pages/Feedback/Index";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import {
  DocsFeedbackReason,
  PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  ProductFeedbackKind,
  summarizeDocsPageFeedback,
  summarizeProductFeedback,
} from "Common/Types/ProductFeedback/ProductFeedback";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const isCloud = params.get("cloud") === "1";

const record = { reads: [], deletes: [], unmodeled: [] };
window.__adminFeedbackFixture = record;

const AT = (minutesAgo) => {
  return new Date(
    Date.parse("2026-11-18T09:00:00.000Z") - minutesAgo * 60 * 1000,
  ).toISOString();
};

// What people told this server: a setup's score, Give feedback, a thumb and two docs answers.
let answers = [
  {
    id: "73620000-0000-4000-8000-000000000001",
    kind: ProductFeedbackKind.General,
    topic: "broken",
    score: null,
    isPositive: null,
    details:
      "Add SLO does nothing after I pick a monitor and press Save. I tried twice in Firefox.",
    reason: null,
    page: "/dashboard/:projectId/slos",
    version: "16.0.0",
    createdAt: AT(12),
  },
  {
    id: "73620000-0000-4000-8000-000000000002",
    kind: ProductFeedbackKind.SetupFlow,
    topic: "website_down",
    score: 2,
    isPositive: null,
    details: "The test email went to spam.",
    reason: null,
    page: "/dashboard/:projectId/monitors/setup",
    version: "16.0.0",
    createdAt: AT(45),
  },
  {
    id: "73620000-0000-4000-8000-000000000003",
    kind: ProductFeedbackKind.DocsPage,
    topic: "monitor/website-monitor",
    score: null,
    isPositive: false,
    details: null,
    reason: DocsFeedbackReason.Unclear,
    page: "/docs/de/monitor/website-monitor",
    version: "16.0.0",
    createdAt: AT(80),
  },
  {
    id: "73620000-0000-4000-8000-000000000004",
    kind: ProductFeedbackKind.Explanation,
    topic: "how_oneuptime_works",
    score: null,
    isPositive: true,
    details: null,
    reason: null,
    page: "/dashboard/:projectId/home",
    version: "16.0.0",
    createdAt: AT(120),
  },
];

// Docs answers beyond the list's: the pages, by how they failed people.
const DOCS_ROWS = [
  { page: "monitor/website-monitor", isHelpful: false, reason: "unclear" },
  { page: "monitor/website-monitor", isHelpful: false, reason: "unclear" },
  { page: "monitor/website-monitor", isHelpful: false, reason: "missing" },
  { page: "monitor/website-monitor", isHelpful: true, reason: null },
  { page: "on-call/escalation-rules", isHelpful: false, reason: "wrong" },
  { page: "on-call/escalation-rules", isHelpful: true, reason: null },
  { page: "status-pages/subscribers", isHelpful: true, reason: null },
];

function summary() {
  return {
    sinceDays: 90,
    retentionInDays: PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
    topics: summarizeProductFeedback(
      answers.map((answer) => {
        return {
          kind: answer.kind,
          topic: answer.topic,
          score: answer.score,
          isPositive: answer.isPositive,
          hasDetails: Boolean(answer.details),
        };
      }),
    ),
    docsPages: summarizeDocsPageFeedback(DOCS_ROWS),
    askAi: {
      helpful: 42,
      notHelpful: 9,
      ratedDown: isCloud
        ? null
        : [
            {
              question: "Why did checkout-api page twice last night?",
              ratedAt: AT(30),
            },
          ],
      ratedDownDrewOn: [
        { source: "logs", answers: 4 },
        { source: "incidents", answers: 3 },
        { source: "docs", answers: 2 },
        { source: "nothing", answers: 1 },
      ],
    },
  };
}

// The server's master admin.
UserUtil.isMasterAdmin = () => {
  return true;
};
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID("80000000-0000-4000-8000-000000007362");
};
PermissionUtil.getAllPermissions = () => {
  return [];
};

// GlobalConfig, for the two switches: people are asked, docs answers are kept.
const config = new GlobalConfig();
config.id = ObjectID.getZeroObjectID();
config.disableProductFeedback = false;
config.keepDocsFeedback = true;

ModelAPI.getItem = async (options) => {
  if (options && options.modelType === GlobalConfig) {
    return config;
  }
  record.unmodeled.push({ what: "getItem" });
  return null;
};

ModelAPI.updateById = async (options) => {
  if (options && options.modelType === GlobalConfig) {
    Object.assign(config, options.data || {});
    return new HTTPResponse(200, {}, {});
  }
  record.unmodeled.push({ what: "updateById" });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
};

function urlOf(options) {
  return String((options && options.url) || "");
}

API.get = async (options) => {
  const url = urlOf(options);
  const path = new URL(url).pathname;
  record.reads.push(path);

  if (path.endsWith(PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE)) {
    return new HTTPResponse(200, summary(), {});
  }

  if (path.endsWith(PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE)) {
    const kind = new URL(url).searchParams.get("kind");
    const items = answers.filter((answer) => {
      return !kind || answer.kind === kind;
    });
    return new HTTPResponse(200, { items, count: items.length }, {});
  }

  record.unmodeled.push({ what: "get", url: path });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
};

API.delete = async (options) => {
  const path = new URL(urlOf(options)).pathname;
  const prefix = `${PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE}/`;
  const at = path.indexOf(prefix);

  if (at >= 0) {
    const id = decodeURIComponent(path.slice(at + prefix.length));
    record.deletes.push(id);
    answers = answers.filter((answer) => {
      return answer.id !== id;
    });
    return new HTTPResponse(200, { deleted: true }, {});
  }

  record.unmodeled.push({ what: "delete", url: path });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
};

API.post = async (options) => {
  record.unmodeled.push({ what: "post", url: urlOf(options) });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
};

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return <FeedbackPage />;
}

/*
 * As the Admin Dashboard's src/Index.tsx starts: every language but English
 * is a chunk of its own (Utils/i18n.ts), so i18n first settles on the
 * language it detects, and only then is this page's language set.
 */
await i18nReady.catch(() => {});
await i18next.changeLanguage(language);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
