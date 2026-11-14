/*
 * Offline fixture for sending a test page (#6811): "Test your pages" as User
 * Settings shows it, and "Test this policy" as a policy's escalation rules
 * show it - each opening the production dialog, with its preview, its cost
 * and, once sent, the result as it happens. The card, the button, the dialog
 * and the result are the production ones from this branch; only the
 * ModelAPI / API data boundary and the signed-in user are replaced.
 *
 * Steered by the query string:
 *   - view=policy        "Test this policy"; absent, "Test your pages"
 *   - result=<state>     what the result reads once sent: acknowledged (the
 *                        default), paging, or failed (a message that did not
 *                        go out, with where to fix it)
 *   - cost=1             the preview's test is priced on OneUptime Cloud:
 *                        yours sends a text through the project's own
 *                        Twilio account, which the balance does not pay
 *                        for, and a call it does (#7263); a policy's texts
 *                        and calls are all paid from the balance
 *   - old=1              the preview as a server from before #7015 and
 *                        #7016 sends it: English only, no codes, nothing
 *                        about the levels a walking test reaches, no
 *                        methods for a person with no rule (#7262) and no
 *                        paid counts (#7263)
 *   - lang=de            the Dashboard's German words (fa: Persian, ar:
 *                        Arabic, both read from the right)
 *   - theme=dark         dark mode (set before the bundle by server.js)
 *
 * Every request the dialog sends is recorded on window.__fixture.requests,
 * so the spec checks what was sent as well as what was drawn.
 */
import "Common/UI/Styles/Theme.css";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { initReactI18next } from "react-i18next";
import TestPageCard from "../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageCard";
import SendTestPageButton from "../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageButton";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import Page from "Common/UI/Components/Page/Page";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import AR from "../../../App/FeatureSet/Dashboard/src/Locales/ar.json";

const PROJECT_ID = "10000000-0000-4000-8000-0000000000e1";
const POLICY_ID = "20000000-0000-4000-8000-0000000000e1";
const USER_ID = "40000000-0000-4000-8000-0000000000e1";
const RUN_ID = "50000000-0000-4000-8000-0000000000e1";
const CRITICAL_ID = "60000000-0000-4000-8000-0000000000e1";
const MAJOR_ID = "60000000-0000-4000-8000-0000000000e2";
const HIGH_ID = "60000000-0000-4000-8000-0000000000e3";

const params = new URLSearchParams(window.location.search);
const view = params.get("view") === "policy" ? "policy" : "self";
const resultState = params.get("result") || "acknowledged";
const isPaid = params.get("cost") === "1";
const isOlderServer = params.get("old") === "1";
const language = ["de", "fa", "ar"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const readsFromTheRight = ["fa", "ar"].includes(language);

window.__fixture = {
  requests: [],
};

// ---- who is signed in -------------------------------------------------------

const HELD = [Permission.ProjectOwner];

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(USER_ID);
PermissionUtil.getAllPermissions = () => HELD;
PermissionUtil.getProjectPermissions = () => ({
  _type: "UserTenantAccessPermission",
  projectId: new ObjectID(PROJECT_ID),
  permissions: HELD.map((permission) => ({
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: false,
  })),
});
PermissionUtil.getGlobalPermissions = () => ({
  _type: "UserGlobalAccessPermission",
  globalPermissions: [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ],
  projectIds: [new ObjectID(PROJECT_ID)],
});
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentPlan = () => null;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

// ---- what the server holds ---------------------------------------------------

function severity(ModelType, id, name) {
  const item = new ModelType();
  item._id = id;
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

ModelAPI.getList = async (options) => {
  const items =
    options.modelType === IncidentSeverity
      ? [
          severity(IncidentSeverity, CRITICAL_ID, "Critical"),
          severity(IncidentSeverity, MAJOR_ID, "Major"),
        ]
      : options.modelType === AlertSeverity
        ? [severity(AlertSeverity, HIGH_ID, "High")]
        : [];

  return { data: items, count: items.length, skip: 0, limit: items.length };
};

const SELF_PREVIEW = {
  kind: "Self",
  people: [
    {
      userId: USER_ID,
      userName: "Dana Kim",
      methods: [
        {
          channel: "SMS",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
          address: "+1 415 555 0100",
        },
        {
          channel: "Email",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
          address: "dana@example.com",
        },
        {
          channel: "Push",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: false,
          address: "Pixel 8",
        },
        {
          channel: "Call",
          notifyAfterMinutes: 5,
          isVerified: true,
          canAcknowledge: true,
          address: "+1 415 555 0100",
        },
      ],
      hasNoRule: false,
      isOptedOut: false,
      warnings: [],
    },
  ],
  notPaged: [],
  /*
   * Priced (cost=1): the text goes through the project's own Twilio
   * account, so the balance pays for the call alone - 25 cents (#7263).
   */
  cost: {
    isPaid: isPaid,
    smsCount: isPaid ? 1 : 0,
    callCount: isPaid ? 1 : 0,
    whatsAppCount: 0,
    telegramCount: 0,
    paidSmsCount: 0,
    paidCallCount: isPaid ? 1 : 0,
    paidWhatsAppCount: 0,
    paidTelegramCount: 0,
    ...(isPaid ? { estimatedCostInUSDCents: 25 } : {}),
  },
};

// The server's English, which each code below comes with (#7015).
const EMAIL_NOT_VERIFIED =
  "This Email method is not verified, so the test can't use it.";
const NO_RULE =
  "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.";
/*
 * The same, since #7262: the method the fallback picks is listed above it -
 * "the method above" for one, as Sam's email is.
 */
const NO_RULE_LISTED =
  "No on-call rule covers this severity: like a real page, the test falls back to the method above.";
const LEE_AWAY = "Lee Park is away until Nov 14, 2026, with nobody covering.";
const LEVEL_3_EMPTY =
  "Escalation rule 3 pages nobody yet. Add people, a team or a schedule to it.";

// A policy's cost: a text 10 cents, a call 25, paid only with cost=1.
function policyCost(smsCount, callCount) {
  return {
    isPaid: isPaid,
    smsCount: smsCount,
    callCount: callCount,
    whatsAppCount: 0,
    telegramCount: 0,
    paidSmsCount: isPaid ? smsCount : 0,
    paidCallCount: isPaid ? callCount : 0,
    paidWhatsAppCount: 0,
    paidTelegramCount: 0,
    ...(isPaid
      ? { estimatedCostInUSDCents: smsCount * 10 + callCount * 25 }
      : {}),
  };
}

/*
 * Payments primary: its first level pages Dana (on call in its schedule)
 * and Sam (in team Platform; no rule for the severity, so the fallback
 * emails him), and can't reach Lee, who is away. Walking
 * every level, nobody acknowledging it, the test pages Ravi at level 2 two
 * minutes later, and passes level 3, which names nobody, two minutes after
 * that.
 */
const POLICY_PREVIEW = {
  kind: "Policy",
  people: [
    {
      userId: USER_ID,
      userName: "Dana Kim",
      reachedThrough: "Schedule Payments primary",
      reachedThroughCode: { code: "Schedule", name: "Payments primary" },
      methods: [
        {
          channel: "SMS",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
        },
        {
          channel: "Email",
          notifyAfterMinutes: 0,
          isVerified: false,
          canAcknowledge: true,
        },
      ],
      hasNoRule: false,
      isOptedOut: false,
      warnings: [EMAIL_NOT_VERIFIED],
      warningCodes: [
        {
          code: "MethodNotVerified",
          channel: "Email",
          message: EMAIL_NOT_VERIFIED,
        },
      ],
    },
    {
      userId: "40000000-0000-4000-8000-0000000000e2",
      userName: "Sam Rivera",
      reachedThrough: "Team Platform",
      reachedThroughCode: { code: "Team", name: "Platform" },
      methods: [
        {
          channel: "Email",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
          isFallback: true,
        },
      ],
      hasNoRule: true,
      isOptedOut: false,
      warnings: [NO_RULE_LISTED],
      warningCodes: [
        { code: "NoRuleFallsBackToListed", message: NO_RULE_LISTED },
      ],
    },
  ],
  notPaged: [LEE_AWAY],
  notPagedCodes: [
    {
      code: "AwayWithNobodyCovering",
      userName: "Lee Park",
      awayUntil: "2026-11-14T09:00:00.000Z",
      message: LEE_AWAY,
    },
  ],
  levelCount: 3,
  cost: policyCost(1, 0),
  walkLevels: [
    {
      order: 2,
      startsAfterMinutes: 2,
      people: [
        {
          userId: "40000000-0000-4000-8000-0000000000e3",
          userName: "Ravi Shah",
          reachedThrough: "Team Database",
          reachedThroughCode: { code: "Team", name: "Database" },
          methods: [
            {
              channel: "Call",
              notifyAfterMinutes: 0,
              isVerified: true,
              canAcknowledge: true,
            },
          ],
          hasNoRule: false,
          isOptedOut: false,
          warnings: [],
          warningCodes: [],
        },
      ],
      notPaged: [],
      notPagedCodes: [],
    },
    {
      order: 3,
      startsAfterMinutes: 4,
      people: [],
      notPaged: [LEVEL_3_EMPTY],
      notPagedCodes: [
        {
          code: "LevelNamesNobody",
          levelOrder: 3,
          message: LEVEL_3_EMPTY,
        },
      ],
    },
  ],
  walkUnreachedLevelCount: 0,
  walkCost: policyCost(1, 1),
};

/*
 * The same, as a server from before the codes and the walk sends it: no
 * method listed for a person with no rule, and no paid counts.
 */
const OLDER_POLICY_PREVIEW = {
  kind: POLICY_PREVIEW.kind,
  people: POLICY_PREVIEW.people.map((person) => {
    const older = { ...person };
    delete older.reachedThroughCode;
    delete older.warningCodes;

    if (older.hasNoRule) {
      older.methods = [];
      older.warnings = [NO_RULE];
    }

    return older;
  }),
  notPaged: POLICY_PREVIEW.notPaged,
  levelCount: POLICY_PREVIEW.levelCount,
  cost: {
    isPaid: POLICY_PREVIEW.cost.isPaid,
    smsCount: POLICY_PREVIEW.cost.smsCount,
    callCount: POLICY_PREVIEW.cost.callCount,
    whatsAppCount: POLICY_PREVIEW.cost.whatsAppCount,
    telegramCount: POLICY_PREVIEW.cost.telegramCount,
    ...(POLICY_PREVIEW.cost.estimatedCostInUSDCents === undefined
      ? {}
      : {
          estimatedCostInUSDCents: POLICY_PREVIEW.cost.estimatedCostInUSDCents,
        }),
  },
};

const STARTED_AT = new Date(Date.now() - 20 * 1000);

function delivery(fields) {
  return {
    id: fields.id,
    channel: fields.channel,
    status: fields.status,
    statusMessage: fields.statusMessage || "",
    canAcknowledge: fields.canAcknowledge !== false,
    sentAt: STARTED_AT.toISOString(),
    ...(fields.address ? { address: fields.address } : {}),
    ...(fields.fix ? { fix: fields.fix } : {}),
    ...(fields.acknowledgedAt ? { acknowledgedAt: fields.acknowledgedAt } : {}),
  };
}

function result() {
  const acknowledged = resultState === "acknowledged";
  const failed = resultState === "failed";

  return {
    executionLogId: RUN_ID,
    kind: view === "policy" ? "Policy" : "Self",
    ...(view === "policy"
      ? { policyId: POLICY_ID, policyName: "Payments primary" }
      : {}),
    recordKind: "Incident",
    severityName: "Critical",
    walksEscalation: false,
    status: acknowledged ? "Acknowledged" : "Paging",
    statusMessage: acknowledged
      ? "Test page acknowledged by Dana Kim (dana@example.com) by SMS after 14 seconds."
      : "Paging 1 person.",
    startedAt: STARTED_AT.toISOString(),
    endsAt: new Date(STARTED_AT.getTime() + 15 * 60 * 1000).toISOString(),
    ...(acknowledged
      ? {
          acknowledgedByName: "Dana Kim",
          acknowledgedChannel: "SMS",
          acknowledgedAfterSeconds: 14,
        }
      : {}),
    steps: [
      {
        id: "70000000-0000-4000-8000-0000000000e1",
        status: acknowledged ? "Acknowledged" : failed ? "Failed" : "Paged",
        statusMessage: "",
        userId: USER_ID,
        userName: "Dana Kim",
        ...(view === "policy"
          ? {
              levelOrder: 1,
              levelName: "First responders",
              scheduleName: "Payments primary",
            }
          : {}),
        deliveries: [
          delivery({
            id: "80000000-0000-4000-8000-0000000000e1",
            channel: "SMS",
            status: acknowledged ? "Acknowledged" : "Delivered",
            address: "+1 415 555 0100",
            ...(acknowledged
              ? {
                  acknowledgedAt: new Date(
                    STARTED_AT.getTime() + 14 * 1000,
                  ).toISOString(),
                }
              : {}),
          }),
          delivery({
            id: "80000000-0000-4000-8000-0000000000e2",
            channel: "Email",
            status: failed ? "Failed" : "Sent",
            address: "dana@example.com",
            ...(failed
              ? {
                  statusMessage:
                    "Email notification not sent because email dana@example.com is not verified.",
                  fix: "NotificationMethods",
                }
              : {}),
          }),
          delivery({
            id: "80000000-0000-4000-8000-0000000000e3",
            channel: "Push",
            status: "Sent",
            address: "Pixel 8",
            canAcknowledge: false,
          }),
        ],
      },
    ],
  };
}

API.post = async (request) => {
  const url = request.url.toString();

  window.__fixture.requests.push({ url: url, data: request.data });

  if (url.endsWith("/on-call-test-page/preview")) {
    return new HTTPResponse(
      200,
      view === "policy"
        ? isOlderServer
          ? OLDER_POLICY_PREVIEW
          : POLICY_PREVIEW
        : SELF_PREVIEW,
      {},
    );
  }

  if (
    url.endsWith("/on-call-test-page/page-person") ||
    url.endsWith("/on-call-test-page/page-policy")
  ) {
    return new HTTPResponse(200, { executionLogId: RUN_ID }, {});
  }

  return new HTTPResponse(200, {}, {});
};

API.get = async (request) => {
  const url = request.url.toString();

  if (url.endsWith(`/on-call-test-page/result/${RUN_ID}`)) {
    return new HTTPResponse(200, result(), {});
  }

  return new HTTPResponse(200, {}, {});
};

/*
 * The Dashboard looks every string up by its English text, so the
 * separators i18next reads in a key (the "." and ":" of a sentence) are
 * turned off, as the Dashboard's own setup does.
 */
await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
    ar: { translation: AR },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
followLanguageForDates(i18next);
document.documentElement.lang = language;
document.documentElement.dir = readsFromTheRight ? "rtl" : "ltr";

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  if (view === "policy") {
    return (
      <Page title="Payments primary" breadcrumbLinks={[]}>
        <div className="flex justify-end">
          <SendTestPageButton
            target={{
              kind: "policy",
              policyId: POLICY_ID,
              policyName: "Payments primary",
            }}
          />
        </div>
      </Page>
    );
  }

  return (
    <Page title="Notification Methods" breadcrumbLinks={[]}>
      <TestPageCard />
    </Page>
  );
}

const target = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;

if (window.location.pathname !== target) {
  window.history.replaceState(null, "", target + window.location.search);
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Routes>
      <PageRoute
        path="/dashboard/:projectId/user-settings/notification-methods"
        element={<Shell />}
      />
    </Routes>
  </BrowserRouter>,
);
