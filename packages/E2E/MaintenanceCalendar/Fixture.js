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
import ScheduledMaintenancesPage from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents";
import {
  ScheduledMaintenanceView,
  scheduledMaintenanceViewChoice,
} from "../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceViewChoice";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceCalendarFeed from "Common/Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * The fixture page: the real Scheduled Maintenance > Events page, with the
 * API answered from an in-page store (window.__maintenanceCalendarFixture)
 * the specs read - every request, every copy to the clipboard - and drive.
 *
 *   ?view=     list (default) | calendar: the view the page opens on, as a
 *              reader's earlier choice leaves it (ScheduledMaintenanceViewChoice)
 *   ?events=   month (default: October 2026, see EVENTS) | none | many (60
 *              events on the 22nd, past what a cell shows) | error (the first
 *              read of the calendar fails, Try again reads the month)
 *   ?feed=     the team's calendar link: active (default) | empty (none yet)
 *              | disabled | regenerate (the stored link cannot be read) |
 *              restricted (the reader may see only some events) | warnings
 *   ?role=     owner (default) | viewer (may read events and copy the link,
 *              may not create events or change the link)
 *   ?theme=dark   ?lang=de|ja
 *
 * The specs fix the browser's clock at 2026-10-15 10:20 UTC (Thursday), so
 * the calendar opens on October 2026 with the 15th as today.
 */

const params = new URLSearchParams(window.location.search);
const eventsScenario = params.get("events") || "month";
const feedScenario = params.get("feed") || "active";
const role = params.get("role") || "owner";
const language = ["de", "ja"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

if (params.get("view") === "calendar") {
  scheduledMaintenanceViewChoice.write(ScheduledMaintenanceView.Calendar);
} else if (params.get("view") === "list") {
  scheduledMaintenanceViewChoice.write(ScheduledMaintenanceView.List);
}

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    ja: { translation: JA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});
document.documentElement.lang = language;

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const FEED_ID = "40000000-0000-4000-8000-000000000009";
const ORIGIN = "https://oneuptime.example.com";

// The project's four seeded states, as a new project has them.
const STATES = [
  {
    _id: "20000000-0000-4000-8000-000000000001",
    name: "Scheduled",
    color: "#000000",
    order: 1,
    isScheduledState: true,
  },
  {
    _id: "20000000-0000-4000-8000-000000000002",
    name: "Ongoing",
    color: "#ffbf53",
    order: 2,
    isOngoingState: true,
  },
  {
    _id: "20000000-0000-4000-8000-000000000003",
    name: "Ended",
    color: "#4a4a4a",
    order: 3,
    isEndedState: true,
  },
  {
    _id: "20000000-0000-4000-8000-000000000004",
    name: "Completed",
    color: "#2ab57d",
    order: 4,
    isResolvedState: true,
  },
];

function stateNamed(name) {
  return STATES.find((state) => {
    return state.name === name;
  });
}

function eventId(index) {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/*
 * October 2026, in UTC: one event in progress today, one coming up next
 * week across midnight, one over three days, one done early in the month,
 * one that started in September and ended in October, a busy 22nd, and one
 * in November for the next month.
 */
function monthEvents() {
  const events = [
    {
      title: "Network switch firmware",
      startsAt: "2026-10-15T09:00:00.000Z",
      endsAt: "2026-10-15T11:00:00.000Z",
      state: "Ongoing",
    },
    {
      title: "Database upgrade",
      startsAt: "2026-10-20T22:00:00.000Z",
      endsAt: "2026-10-21T01:00:00.000Z",
      state: "Scheduled",
    },
    {
      title: "Storage migration",
      startsAt: "2026-10-27T08:00:00.000Z",
      endsAt: "2026-10-29T18:00:00.000Z",
      state: "Scheduled",
    },
    {
      title: "Old cluster retirement",
      startsAt: "2026-10-02T14:00:00.000Z",
      endsAt: "2026-10-02T16:00:00.000Z",
      state: "Completed",
    },
    {
      title: "Certificate rotation",
      startsAt: "2026-09-30T22:00:00.000Z",
      endsAt: "2026-10-01T02:00:00.000Z",
      state: "Ended",
    },
    {
      title: "Kernel update",
      startsAt: "2026-11-03T06:00:00.000Z",
      endsAt: "2026-11-03T07:00:00.000Z",
      state: "Scheduled",
    },
  ];

  const busyCount = eventsScenario === "many" ? 60 : 4;

  for (let index = 0; index < busyCount; index++) {
    const hour = 8 + (index % 12);
    events.push({
      title: `Patch window ${index + 1}`,
      startsAt: `2026-10-22T${String(hour).padStart(2, "0")}:00:00.000Z`,
      endsAt: `2026-10-22T${String(hour).padStart(2, "0")}:45:00.000Z`,
      state: "Scheduled",
    });
  }

  return events.map((event, index) => {
    return {
      _id: eventId(index + 1),
      title: event.title,
      description: "",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      scheduledMaintenanceNumber: index + 1,
      scheduledMaintenanceNumberWithPrefix: `SM-${index + 1}`,
      state: stateNamed(event.state),
    };
  });
}

// The links' tokens, in the order they are minted: 43 characters, as the server's.
const TOKENS = [
  "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd0",
  "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp-_OoNnMmLlK",
  "Mn0pQrStUvWxYz-_0123456789AbCdEfGhIjKlMnOpQ",
  "Qq1Ww2Ee3Rr4Tt5Yy6Uu7Ii8Oo9Pp0-_AaSsDdFfGgH",
];

const store = {
  events: eventsScenario === "none" ? [] : monthEvents(),
  feed: feedStatus(feedScenario),
};

const state = {
  // Every request the page made: what it asked for and how.
  requests: [],
  // Every text the page put on the clipboard.
  copied: [],
  // How many calendar reads still fail before one answers.
  calendarFailuresLeft: eventsScenario === "error" ? 1 : 0,
  // How long a calendar read takes, as a slow network would.
  calendarDelayMilliseconds: Number(params.get("delay") || 0),
  // A published link holds the first token; the next one minted is the second.
  tokenSequence: store.feed.exists ? 1 : 0,
};

function nextToken() {
  const token = TOKENS[state.tokenSequence % TOKENS.length];
  state.tokenSequence++;
  return token;
}

function ago(milliseconds) {
  return new Date(Date.now() - milliseconds).toISOString();
}

function feedStatus(name) {
  const base = {
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
    settings: { pastDays: 90, futureDays: 365 },
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
  };

  if (name === "empty" || name === "restricted") {
    return base;
  }

  const token = TOKENS[0];

  return {
    ...base,
    exists: true,
    feedId: FEED_ID,
    isEnabled: name !== "disabled",
    needsRegeneration: name === "regenerate",
    token: name === "regenerate" ? null : token,
    tokenHint: token.slice(-4),
    rotatedAt: ago(12 * 24 * 60 * 60 * 1000),
    lastFetchedAt: ago(40 * 60 * 1000),
    lastFetchedClient: "Google Calendar",
    fetchCount: 211,
    hostWarning:
      name === "warnings"
        ? "HOST is not set to a public address, so calendar apps outside this machine cannot reach this link. Set HOST to the address your team uses to open OneUptime."
        : null,
    protocolWarning:
      name === "warnings"
        ? "HTTP_PROTOCOL is http, so this link travels unencrypted. Anyone who can see the traffic can read the link and the maintenance events it serves; serve OneUptime over https to fix this."
        : null,
  };
}

window.__maintenanceCalendarFixture = {
  state: state,
  store: store,
  // Every calendar read from now on answers after this long.
  setCalendarDelay: (milliseconds) => {
    state.calendarDelayMilliseconds = milliseconds;
  },
};

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text) => {
      state.copied.push(text);
    },
  },
});

const project = new Project();
project._id = PROJECT_ID;
project.name = "Acme Production";
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
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

const granted =
  role === "viewer"
    ? [Permission.Viewer, Permission.CurrentUser]
    : [Permission.ProjectOwner, Permission.CurrentUser];

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
  return {
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  };
};

ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

function toModel(event) {
  const model = new ScheduledMaintenance();
  model._id = event._id;
  model.title = event.title;
  model.description = event.description;
  model.startsAt = new Date(event.startsAt);
  model.endsAt = new Date(event.endsAt);
  model.scheduledMaintenanceNumber = event.scheduledMaintenanceNumber;
  model.scheduledMaintenanceNumberWithPrefix =
    event.scheduledMaintenanceNumberWithPrefix;
  const currentState = new ScheduledMaintenanceState();
  currentState._id = event.state._id;
  currentState.name = event.state.name;
  currentState.color = new Color(event.state.color);
  model.currentScheduledMaintenanceState = currentState;
  model.monitors = [];
  model.statusPages = [];
  model.labels = [];
  return model;
}

function toStateModel(item) {
  const model = new ScheduledMaintenanceState();
  model._id = item._id;
  model.name = item.name;
  model.color = new Color(item.color);
  model.order = item.order;
  model.isScheduledState = Boolean(item.isScheduledState);
  model.isOngoingState = Boolean(item.isOngoingState);
  model.isEndedState = Boolean(item.isEndedState);
  model.isResolvedState = Boolean(item.isResolvedState);
  return model;
}

/*
 * The calendar's range query (MaintenanceCalendarView.getRangeQuery):
 * events that start before the range ends and end after it starts.
 */
function inRange(event, query) {
  const startsAt = query && query.startsAt;
  const endsAt = query && query.endsAt;

  if (startsAt instanceof LessThanOrEqual) {
    if (
      new Date(event.startsAt).getTime() > new Date(startsAt.value).getTime()
    ) {
      return false;
    }
  }

  if (endsAt instanceof GreaterThanOrEqual) {
    if (new Date(event.endsAt).getTime() < new Date(endsAt.value).getTime()) {
      return false;
    }
  }

  return true;
}

function describeQuery(query) {
  const described = {};

  for (const [key, value] of Object.entries(query || {})) {
    if (value instanceof LessThanOrEqual) {
      described[key] = { lessThanOrEqual: new Date(value.value).toISOString() };
    } else if (value instanceof GreaterThanOrEqual) {
      described[key] = {
        greaterThanOrEqual: new Date(value.value).toISOString(),
      };
    } else {
      described[key] = value === undefined ? null : String(value);
    }
  }

  return described;
}

ModelAPI.getList = async (options) => {
  const tableName = new options.modelType().tableName;

  if (tableName === "ScheduledMaintenance") {
    const isCalendarRead = Boolean(
      options.query && options.query.startsAt instanceof LessThanOrEqual,
    );

    state.requests.push({
      kind: isCalendarRead ? "calendar" : "list",
      query: describeQuery(options.query),
      limit: options.limit,
    });

    if (isCalendarRead) {
      if (state.calendarDelayMilliseconds > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, state.calendarDelayMilliseconds);
        });
      }

      if (state.calendarFailuresLeft > 0) {
        state.calendarFailuresLeft--;
        throw new HTTPErrorResponse(
          500,
          { message: "The maintenance service is not responding." },
          {},
        );
      }
    }

    const matching = store.events
      .filter((event) => {
        return inRange(event, options.query);
      })
      .sort((first, second) => {
        const direction =
          options.sort && options.sort.startsAt === SortOrder.Descending
            ? -1
            : 1;
        return (
          direction *
          (new Date(first.startsAt).getTime() -
            new Date(second.startsAt).getTime())
        );
      });

    const skip = Number(options.skip || 0);
    const limit = Number(options.limit || 10);

    return {
      data: matching.slice(skip, skip + limit).map(toModel),
      count: matching.length,
      skip: skip,
      limit: limit,
    };
  }

  if (tableName === "ScheduledMaintenanceState") {
    const data = STATES.map(toStateModel);
    return { data: data, count: data.length, skip: 0, limit: options.limit };
  }

  state.requests.push({ kind: "other", tableName: tableName });

  return { data: [], count: 0, skip: 0, limit: options.limit };
};

ModelAPI.getCount = async (options) => {
  const tableName = new options.modelType().tableName;

  if (tableName === "ScheduledMaintenance") {
    return store.events.length;
  }

  return 0;
};

ModelAPI.count = ModelAPI.getCount;

ModelAPI.getItem = async () => {
  return null;
};

ModelAPI.updateById = async (args) => {
  state.requests.push({
    kind: "update",
    tableName: new args.modelType().tableName,
    id: args.id.toString(),
    data: { ...args.data },
  });

  if (
    args.modelType === ScheduledMaintenanceCalendarFeed &&
    typeof args.data.isEnabled === "boolean"
  ) {
    store.feed.isEnabled = args.data.isEnabled;
  }

  return new HTTPResponse(200, {}, {});
};

function feedUrl(token) {
  return `${ORIGIN}/api/scheduled-maintenance-calendar/project/${token}/maintenance.ics`;
}

function toWire(status) {
  const { token, ...rest } = status;
  return {
    ...rest,
    urls: token
      ? {
          https: feedUrl(token),
          webcal: feedUrl(token).replace("https:", "webcal:"),
          googleAdd: "",
        }
      : null,
  };
}

function minted(status, isRotation) {
  const token = nextToken();
  return {
    ...status,
    exists: true,
    feedId: FEED_ID,
    isEnabled: status.exists ? status.isEnabled : true,
    needsRegeneration: false,
    token: token,
    tokenHint: token.slice(-4),
    rotatedAt: new Date().toISOString(),
    previousTokenExpiresAt: isRotation
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
  };
}

API.get = async (options) => {
  const path = new URL(options.url.toString()).pathname;
  state.requests.push({ kind: "api", method: "GET", path: path });

  if (path.endsWith("/scheduled-maintenance-calendar/project-feed/current")) {
    /*
     * A reader held to some of the project's events: a 200 with the reason,
     * as the server answers (never a 403, which the Dashboard answers by
     * leaving for its Forbidden page).
     */
    if (feedScenario === "restricted") {
      return new HTTPResponse(
        200,
        {
          ...toWire(store.feed),
          refusedReason:
            "You can see only some of this project's scheduled maintenance events, so its calendar link, which shows every event, is not yours to use. Ask a project admin for access to every event.",
        },
        {},
      );
    }

    return new HTTPResponse(200, toWire(store.feed), {});
  }

  return new HTTPErrorResponse(404, { message: `No route for ${path}` }, {});
};

API.post = async (options) => {
  const path = new URL(options.url.toString()).pathname;
  state.requests.push({
    kind: "api",
    method: "POST",
    path: path,
    body: options.data,
  });

  if (path.endsWith("/scheduled-maintenance-calendar/project-feed/publish")) {
    store.feed = minted(store.feed, false);
    return new HTTPResponse(200, toWire(store.feed), {});
  }

  if (path.endsWith("/scheduled-maintenance-calendar/project-feed/rotate")) {
    store.feed = minted(store.feed, true);
    return new HTTPResponse(200, toWire(store.feed), {});
  }

  return new HTTPResponse(200, { data: [], count: 0 }, {});
};

/*
 * The Dashboard's frame around a page with a side menu (Page.tsx): its
 * padding and the side menu's width, so a card is as wide here as it is in
 * the product.
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

  if (window.location.pathname.includes("/scheduled-maintenance-events/")) {
    // Where a block or the + took the reader: the page's address says it.
    return (
      <Frame>
        <div data-testid="fixture-navigated">{window.location.pathname}</div>
      </Frame>
    );
  }

  return (
    <Frame>
      <ScheduledMaintenancesPage
        pageRoute={Navigation.getCurrentRoute()}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </Frame>
  );
}

if (!window.location.pathname.startsWith("/dashboard/")) {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/scheduled-maintenance-events${window.location.search}`,
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
