import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import UserSettingsOnCallCalendarFeed from "../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallCalendarFeed";
import OnCallDutyCalendarFeeds from "../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/CalendarFeeds";
import ScheduleSubscribeCard from "../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import FA from "../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import RU from "../../App/FeatureSet/Dashboard/src/Locales/ru.json";
import UserOnCallCalendarFeed from "Common/Models/DatabaseModels/UserOnCallCalendarFeed";
import OnCallDutyPolicyScheduleCalendarFeed from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "Common/Models/DatabaseModels/ProjectOnCallCalendarFeed";
import UserOnCallShiftReminder from "Common/Models/DatabaseModels/UserOnCallShiftReminder";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { buildUpcomingShifts } from "./UpcomingShiftsFixture";

/*
 * The fixture page: the real calendar-feed pages, with the API answered from
 * an in-page store (window.__calendarFeedFixture) that the specs read -
 * every request and every copy to the clipboard - and drive.
 *
 *   ?page=     personal (default: User Settings > Calendar Feed) | schedule
 *              (a schedule's "Subscribe to this schedule" cards) | project
 *              (On-Call Duty > Calendar Feeds)
 *   ?state=    the personal link: google (default: in use, last read by
 *              Google Calendar) | apple | outlook | other | new (made a
 *              minute ago, never read) | stale (made three days ago, never
 *              read) | disabled | regenerate (the stored link cannot be
 *              read) | truncated | rotated (a previous link is winding down)
 *              | warnings (HOST and HTTP_PROTOCOL) | private (HOST is a
 *              private address) | empty (no
 *              link yet) | unsupported (an older API: 404) | error (the
 *              first read fails with a 500, Try again reads an active link)
 *   ?shared=   the schedule's or the project's shared link: active (default)
 *              | empty | disabled | regenerate
 *   ?role=     owner (default) | viewer (may read a shared link, not
 *              publish or change it)
 *   ?shifts=   what /my-shifts answers the Upcoming shifts card with: mixed
 *              (default) | daily | weekdays | dst | long | empty |
 *              truncated | truncated-empty | error (UpcomingShiftsFixture.js
 *              says what each one holds)
 *   ?shiftsDelay=   how many milliseconds /my-shifts takes to answer
 *   ?billing=on&plan=free   OneUptime Cloud below the Growth plan
 *   ?theme=dark   ?lang=de|ja|fa|ru
 */

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "personal";
const scenario = params.get("state") || "google";
const sharedScenario = params.get("shared") || "active";
const role = params.get("role") || "owner";
const shiftsScenario = params.get("shifts") || "mixed";
const language = ["de", "ja", "fa", "ru"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

/*
 * Persian is drawn left to right, as the Dashboard draws every language:
 * its page sets no direction (Dashboard/views/index.ejs), so neither does
 * the fixture.
 */

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
    fa: { translation: FA },
    ru: { translation: RU },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SCHEDULE_ID = "30000000-0000-4000-8000-000000000001";
const PERSONAL_FEED_ID = "40000000-0000-4000-8000-000000000001";
const SCHEDULE_FEED_ID = "40000000-0000-4000-8000-000000000002";
const PROJECT_FEED_ID = "40000000-0000-4000-8000-000000000003";

const ORIGIN = "https://oneuptime.example.com";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The page reads the real clock; the store is built from it, once.
const NOW = Date.now();

function ago(milliseconds) {
  return new Date(NOW - milliseconds).toISOString();
}

function later(milliseconds) {
  return new Date(NOW + milliseconds).toISOString();
}

let tokenSequence = 0;

/*
 * A 43-character token like the server's, different every time one is minted:
 * drawn from the suites' one seeded generator, seeded by the feed and the mint.
 */
function mintToken(seed) {
  tokenSequence++;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const random = seededRandom(seed * 1000003 + tokenSequence);
  let token = "";
  for (let i = 0; i < 43; i++) {
    token += alphabet[random(alphabet.length)];
  }
  return token;
}

const project = new Project();
project._id = PROJECT_ID;
project.name = "SYSNETIX DEMO";
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ProjectUtil.getCurrentPlan = () => {
  return params.get("plan") === "free" ? PlanType.Free : PlanType.Growth;
};
UserUtil.getUserId = () => {
  return new ObjectID(USER_ID);
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

const ROLES = {
  owner: [Permission.ProjectOwner, Permission.CurrentUser],
  viewer: [Permission.Viewer, Permission.CurrentUser],
};
const granted = ROLES[role] || ROLES.owner;

PermissionUtil.getAllPermissions = () => {
  return granted;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: granted.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

Navigation.getLastParamAsObjectID = () => {
  return new ObjectID(SCHEDULE_ID);
};

// The tenant header every Dashboard request carries.
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

function feedUrl(kind, token) {
  const file = { user: "shifts.ics", schedule: "schedule.ics" }[kind];
  return `${ORIGIN}/api/on-call-calendar/${kind}/${token}/${file || "project.ics"}`;
}

/*
 * A feed's status as the server words it (OnCallCalendarAPI's FeedStatus),
 * for one of the scenarios above.
 */
function personalStatus(name) {
  if (name === "empty" || name === "unsupported") {
    return absentStatus();
  }

  const token = mintToken(1);
  const status = {
    exists: true,
    feedId: PERSONAL_FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    token: token,
    tokenHint: token.slice(-4),
    rotatedAt: ago(30 * DAY),
    previousTokenExpiresAt: null,
    lastFetchedAt: ago(7 * MINUTE),
    lastFetchedClient: "Google Calendar",
    fetchCount: 143,
    lastRenderTruncated: false,
    settings: { includeCoveringShifts: true, pastDays: 2, futureDays: 90 },
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
  };

  switch (name) {
    case "apple":
      Object.assign(status, {
        lastFetchedAt: ago(3 * MINUTE),
        lastFetchedClient: "Apple Calendar",
        fetchCount: 1288,
      });
      break;
    case "outlook":
      Object.assign(status, {
        lastFetchedAt: ago(2 * HOUR),
        lastFetchedClient: "Microsoft Outlook",
        fetchCount: 61,
      });
      break;
    case "other":
      Object.assign(status, {
        lastFetchedAt: ago(26 * HOUR),
        lastFetchedClient: "Other",
        fetchCount: 1,
      });
      break;
    case "new":
      Object.assign(status, {
        rotatedAt: ago(MINUTE),
        lastFetchedAt: null,
        lastFetchedClient: null,
        fetchCount: 0,
      });
      break;
    case "stale":
      Object.assign(status, {
        rotatedAt: ago(3 * DAY),
        lastFetchedAt: null,
        lastFetchedClient: null,
        fetchCount: 0,
      });
      break;
    case "disabled":
      Object.assign(status, {
        isEnabled: false,
        lastFetchedAt: ago(2 * DAY),
      });
      break;
    case "regenerate":
      Object.assign(status, {
        needsRegeneration: true,
        token: null,
        lastFetchedAt: ago(4 * HOUR),
      });
      break;
    case "truncated":
      Object.assign(status, { lastRenderTruncated: true });
      break;
    case "rotated":
      Object.assign(status, {
        rotatedAt: ago(10 * MINUTE),
        previousTokenExpiresAt: later(30 * DAY - 10 * MINUTE),
        lastFetchedAt: null,
        lastFetchedClient: null,
        fetchCount: 0,
      });
      break;
    case "warnings":
      Object.assign(status, {
        hostWarning:
          "HOST is not set to a public address, so calendar apps outside this machine cannot reach this link. Set HOST to the address your team uses to open OneUptime.",
        protocolWarning:
          "HTTP_PROTOCOL is http, so this link travels unencrypted. Anyone who can see the traffic can read the link and the shifts it serves; serve OneUptime over https to fix this.",
      });
      break;
    case "private":
      Object.assign(status, {
        privateHost: "oneuptime.internal",
        lastFetchedAt: ago(20 * MINUTE),
        lastFetchedClient: "Apple Calendar",
      });
      break;
    default:
      break;
  }

  return status;
}

function absentStatus() {
  return {
    exists: false,
    feedId: null,
    isEnabled: false,
    needsRegeneration: false,
    token: null,
    tokenHint: null,
    rotatedAt: null,
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
  };
}

function sharedStatus(name, feedId, seed) {
  if (name === "empty") {
    return absentStatus();
  }

  const token = mintToken(seed);

  return {
    exists: true,
    feedId: feedId,
    isEnabled: name !== "disabled",
    needsRegeneration: name === "regenerate",
    token: name === "regenerate" ? null : token,
    tokenHint: token.slice(-4),
    rotatedAt: ago(12 * DAY),
    previousTokenExpiresAt: null,
    lastFetchedAt: ago(40 * MINUTE),
    lastFetchedClient: "Microsoft Outlook",
    fetchCount: 977,
    lastRenderTruncated: false,
    settings: {
      includeCoverageGaps: true,
      minimumGapMinutes: 30,
      pastDays: 2,
      futureDays: 90,
      rotateWhenMemberLeaves: true,
    },
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
  };
}

const store = {
  personal: personalStatus(scenario),
  schedule: sharedStatus(sharedScenario, SCHEDULE_FEED_ID, 2),
  project: sharedStatus(sharedScenario, PROJECT_FEED_ID, 3),
  reminders: [
    { _id: "50000000-0000-4000-8000-000000000001", minutesBeforeShift: 60 },
  ],
};

const state = {
  // Every request the page made: method, path and body.
  requests: [],
  // Every text the page put on the clipboard.
  copied: [],
  // How many status reads still fail before one answers.
  failuresLeft: scenario === "error" ? 1 : 0,
  // How long a status read takes to answer, as a slow network would.
  readDelayMilliseconds: 0,
  // The Upcoming shifts card's answer: which scenario, and how it answers.
  shiftsScenario: shiftsScenario,
  shiftsFailuresLeft: shiftsScenario === "error" ? 1 : 0,
  shiftsDelayMilliseconds: Number(params.get("shiftsDelay") || 0),
};

window.__calendarFeedFixture = {
  state: state,
  store: store,
  // What the personal link's status read answers next.
  setPersonal: (name) => {
    store.personal = personalStatus(name);
  },
  // Every status read from now on answers after this long.
  setReadDelay: (milliseconds) => {
    state.readDelayMilliseconds = milliseconds;
  },
  // What /my-shifts answers next, and after how long.
  setShifts: (name) => {
    state.shiftsScenario = name;
  },
  setShiftsDelay: (milliseconds) => {
    state.shiftsDelayMilliseconds = milliseconds;
  },
};

/*
 * The clipboard, recorded: the page copies the secret link without showing
 * it, and the specs check exactly what was copied.
 */
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text) => {
      state.copied.push(text);
    },
  },
});

function toWire(status, kind) {
  const { token, ...rest } = status;
  return {
    ...rest,
    urls: token
      ? {
          https: feedUrl(kind, token),
          // What an API from before the Google fix sends; the page rebuilds both.
          webcal: feedUrl(kind, token).replace("https:", "webcals:"),
          googleAdd: "",
        }
      : null,
  };
}

function rotate(status, kind, feedId, seed) {
  const token = mintToken(seed);
  return {
    ...status,
    exists: true,
    feedId: feedId,
    isEnabled: status.exists ? status.isEnabled : true,
    needsRegeneration: false,
    token: token,
    tokenHint: token.slice(-4),
    rotatedAt: new Date().toISOString(),
    previousTokenExpiresAt: status.exists ? later(30 * DAY) : null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
  };
}

/*
 * The Upcoming shifts card's answer, built from the clock the page reads
 * at the moment it asks: a spec that fixes the browser's clock gets the
 * same rows every time.
 */
function myShiftsAnswer() {
  if (state.shiftsFailuresLeft > 0) {
    state.shiftsFailuresLeft--;
    return new HTTPErrorResponse(
      500,
      { message: "The shift service is not responding." },
      {},
    );
  }

  const name = state.shiftsScenario;

  return new HTTPResponse(
    200,
    {
      shifts: buildUpcomingShifts(name, {
        now: new Date(),
        projectId: PROJECT_ID,
        projectName: "SYSNETIX DEMO",
        scheduleId: SCHEDULE_ID,
        userId: USER_ID,
      }),
      truncated: name === "truncated" || name === "truncated-empty",
      generatedAt: new Date().toISOString(),
    },
    {},
  );
}

function answer(path) {
  if (path.endsWith("/on-call-calendar/feed/current")) {
    if (scenario === "unsupported") {
      return new HTTPErrorResponse(404, { message: "Not found" }, {});
    }
    // ?state=error: the first read fails; Try again reads an active link.
    if (state.failuresLeft > 0) {
      state.failuresLeft--;
      return new HTTPErrorResponse(
        500,
        { message: "The calendar feed service is not responding." },
        {},
      );
    }
    return new HTTPResponse(200, toWire(store.personal, "user"), {});
  }

  if (path.endsWith(`/schedule-feed/${SCHEDULE_ID}/current`)) {
    return new HTTPResponse(200, toWire(store.schedule, "schedule"), {});
  }

  if (path.endsWith("/project-feed/current")) {
    return new HTTPResponse(200, toWire(store.project, "project"), {});
  }

  if (path.endsWith("/on-call-calendar/my-shifts")) {
    return myShiftsAnswer();
  }

  return new HTTPErrorResponse(404, { message: `No route for ${path}` }, {});
}

API.get = async (options) => {
  const url = new URL(options.url.toString());
  const path = url.pathname;
  state.requests.push({
    method: "GET",
    path: path,
    query: Object.fromEntries(url.searchParams.entries()),
  });
  if (state.readDelayMilliseconds > 0 && path.endsWith("/current")) {
    await new Promise((resolve) => {
      setTimeout(resolve, state.readDelayMilliseconds);
    });
  }
  if (state.shiftsDelayMilliseconds > 0 && path.endsWith("/my-shifts")) {
    await new Promise((resolve) => {
      setTimeout(resolve, state.shiftsDelayMilliseconds);
    });
  }
  return answer(path);
};

API.post = async (options) => {
  const path = new URL(options.url.toString()).pathname;
  state.requests.push({ method: "POST", path: path, body: options.data });

  if (path.endsWith("/on-call-calendar/feed/rotate")) {
    store.personal = rotate(store.personal, "user", PERSONAL_FEED_ID, 11);
    return new HTTPResponse(200, toWire(store.personal, "user"), {});
  }

  if (path.endsWith(`/schedule-feed/${SCHEDULE_ID}/publish`)) {
    store.schedule = rotate(store.schedule, "schedule", SCHEDULE_FEED_ID, 12);
    store.schedule.previousTokenExpiresAt = null;
    return new HTTPResponse(200, toWire(store.schedule, "schedule"), {});
  }

  if (path.endsWith(`/schedule-feed/${SCHEDULE_ID}/rotate`)) {
    store.schedule = rotate(store.schedule, "schedule", SCHEDULE_FEED_ID, 13);
    return new HTTPResponse(200, toWire(store.schedule, "schedule"), {});
  }

  if (path.endsWith("/project-feed/publish")) {
    store.project = rotate(store.project, "project", PROJECT_FEED_ID, 14);
    store.project.previousTokenExpiresAt = null;
    return new HTTPResponse(200, toWire(store.project, "project"), {});
  }

  if (path.endsWith("/project-feed/rotate")) {
    store.project = rotate(store.project, "project", PROJECT_FEED_ID, 15);
    return new HTTPResponse(200, toWire(store.project, "project"), {});
  }

  return new HTTPErrorResponse(404, { message: `No route for ${path}` }, {});
};

function storeKeyOf(modelType) {
  if (modelType === UserOnCallCalendarFeed) {
    return "personal";
  }
  if (modelType === OnCallDutyPolicyScheduleCalendarFeed) {
    return "schedule";
  }
  if (modelType === ProjectOnCallCalendarFeed) {
    return "project";
  }
  return null;
}

ModelAPI.updateById = async (args) => {
  const key = storeKeyOf(args.modelType);
  state.requests.push({
    method: "PUT",
    model: key,
    id: args.id.toString(),
    data: { ...args.data },
  });
  if (key) {
    const { isEnabled, ...settings } = args.data;
    if (typeof isEnabled === "boolean") {
      store[key].isEnabled = isEnabled;
    }
    store[key].settings = { ...store[key].settings, ...settings };
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (args) => {
  const key = storeKeyOf(args.modelType);
  state.requests.push({ method: "DELETE", model: key, id: args.id.toString() });
  if (args.modelType === UserOnCallShiftReminder) {
    store.reminders = store.reminders.filter((reminder) => {
      return reminder._id !== args.id.toString();
    });
  } else if (key) {
    store[key] = absentStatus();
  }
};

ModelAPI.getItem = async (args) => {
  const key = storeKeyOf(args.modelType);
  if (!key || !store[key].exists) {
    return null;
  }
  const item = new args.modelType();
  item._id = store[key].feedId;
  Object.assign(item, store[key].settings);
  return item;
};

ModelAPI.getList = async (args) => {
  if (args.modelType === UserOnCallShiftReminder) {
    const data = store.reminders.map((reminder) => {
      const item = new UserOnCallShiftReminder();
      item._id = reminder._id;
      item.minutesBeforeShift = reminder.minutesBeforeShift;
      return item;
    });
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.create = async (args) => {
  if (args.modelType === UserOnCallShiftReminder) {
    store.reminders.push({
      _id: `50000000-0000-4000-8000-00000000000${store.reminders.length + 2}`,
      minutesBeforeShift: args.model.minutesBeforeShift,
    });
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.count = async () => {
  return 0;
};

/*
 * The Dashboard's frame around a page with a side menu (Page.tsx): its
 * padding and the side menu's width, so a card is as wide here as it is in
 * the product - about 940px of card at 1280px, the whole screen less 32px
 * on a phone.
 */
function Frame(props) {
  return (
    <div className="mb-auto mt-5 max-w-full px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col md:flex-row md:gap-4 lg:gap-5">
        <div
          className="max-md:hidden md:block w-56 lg:w-64 flex-shrink-0"
          data-testid="fixture-side-menu"
        >
          <div className="h-64 rounded-xl border border-dashed border-gray-200" />
        </div>
        <div
          className="flex-1 min-w-0 space-y-6 pb-10"
          data-testid="fixture-page"
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  if (page === "schedule") {
    return (
      <Frame>
        <ScheduleSubscribeCard
          scheduleId={new ObjectID(SCHEDULE_ID)}
          scheduleTimezone="Europe/Berlin"
        />
      </Frame>
    );
  }

  if (page === "project") {
    return (
      <Frame>
        <OnCallDutyCalendarFeeds />
      </Frame>
    );
  }

  return (
    <Frame>
      <UserSettingsOnCallCalendarFeed />
    </Frame>
  );
}

/*
 * The pages' links are built from the project in the URL, as they are in
 * the product: /dashboard/<project>/user-settings/calendar-feed.
 */
if (!window.location.pathname.startsWith("/dashboard/")) {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/user-settings/calendar-feed${window.location.search}`,
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
