import React from "react";
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
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import ScheduledMaintenancesPage from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents";
import ScheduledMaintenanceCalendarPage from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Calendar";
import ScheduledMaintenanceCalendarSettings from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings";
import ScheduledMaintenanceSideMenu from "../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu";
import { PREVIOUS_VIEW_STORAGE_KEY } from "../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceView";
import { getHiddenCalendarsStorageKey } from "../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarOverlays";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ScheduledMaintenanceCalendarFeed from "Common/Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import Includes from "Common/Types/BaseDatabase/Includes";
import { normalizeExternalCalendarLink } from "Common/Types/ScheduledMaintenance/ExternalCalendar";
import { ModelAPIHttpResponse } from "Common/UI/Utils/ModelAPI/ModelAPI";
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
 * The fixture page: the real Scheduled Maintenance pages - All Events, the
 * Maintenance Calendar and Calendar Settings, beside the real side menu -
 * with the API answered from an in-page store (window.__maintenanceCalendarFixture)
 * the specs read - every request, every copy to the clipboard - and drive.
 *
 *   ?page=     calendar (default) | list | settings: the page it opens on
 *   ?previousView=   calendar | list: what the old List | Calendar switch
 *              left in the reader's browser (ScheduledMaintenanceView)
 *   ?external= the calendars from outside the project: none (default) |
 *              some (two shown, one off) | failing (one of them could not be
 *              read) | waiting (one never read yet) | many (520 events of
 *              theirs in October, past what one period asks for)
 *   ?hidden=   ids of external calendars the reader has hidden, by comma
 *   ?readNow=  fail: Read now is refused, as for a calendar read a moment ago
 *   ?events=   month (default: October 2026, see EVENTS) | none | many (60
 *              events on the 22nd, past what a cell shows) | error (the first
 *              read of the calendar fails, Try again reads the month)
 *   ?feed=     the team's calendar link: active (default) | empty (none yet)
 *              | disabled | regenerate (the stored link cannot be read) |
 *              restricted (the reader may see only some events) | warnings
 *   ?role=     owner (default) | viewer (may read events and copy the link,
 *              may not create events or change the link)
 *   ?publish=  later: "Database upgrade" shows on the Acme Status page, and
 *              only from 18 October, 09:00 UTC - its Publish on Status Page
 *              At (#5249) - so All Events says from when under its pages
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

const pageScenario = ["list", "settings"].includes(params.get("page"))
  ? params.get("page")
  : "calendar";
const externalScenario = params.get("external") || "none";
const readNowScenario = params.get("readNow") || "ok";
const publishScenario = params.get("publish") === "later" ? "later" : "now";

window.localStorage.removeItem(PREVIOUS_VIEW_STORAGE_KEY);

if (params.get("previousView")) {
  window.localStorage.setItem(
    PREVIOUS_VIEW_STORAGE_KEY,
    params.get("previousView"),
  );
}

if (params.get("hidden")) {
  window.localStorage.setItem(
    getHiddenCalendarsStorageKey("10000000-0000-4000-8000-000000000001"),
    JSON.stringify(params.get("hidden").split(",")),
  );
} else {
  window.localStorage.removeItem(
    getHiddenCalendarsStorageKey("10000000-0000-4000-8000-000000000001"),
  );
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
      // ?publish=later: kept off its status page until 18 October.
      ...(publishScenario === "later"
        ? {
            statusPages: [
              {
                _id: "60000000-0000-4000-8000-000000000001",
                name: "Acme Status",
              },
            ],
            publishOnStatusPageAt: "2026-10-18T09:00:00.000Z",
          }
        : {}),
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
      statusPages: event.statusPages || [],
      publishOnStatusPageAt: event.publishOnStatusPageAt || null,
    };
  });
}

/*
 * The calendars from outside the project (Calendar Settings): a holidays
 * calendar of all-day events, a change-freeze calendar of timed ones, and
 * another project's calendar that is turned off - whose events must never
 * be asked for. Their links are never in here: the server never returns one.
 */
const EXTERNAL_IDS = {
  holidays: "50000000-0000-4000-8000-000000000001",
  freezes: "50000000-0000-4000-8000-000000000002",
  payments: "50000000-0000-4000-8000-000000000003",
  fresh: "50000000-0000-4000-8000-000000000004",
};

function externalCalendars(scenario) {
  if (scenario === "none") {
    return [];
  }

  if (scenario === "waiting") {
    return [
      {
        _id: EXTERNAL_IDS.fresh,
        name: "Team offsite",
        color: "#0284c7",
        calendarHost: "p52-caldav.icloud.com",
        isEnabled: true,
        refreshIntervalInMinutes: 60,
        lastReadAt: null,
        lastReadError: null,
        lastReadHttpStatus: null,
        eventCount: 0,
        hasMoreEvents: false,
      },
    ];
  }

  return [
    {
      _id: EXTERNAL_IDS.holidays,
      name: "Public holidays",
      color: "#0d9488",
      calendarHost: "calendar.google.com",
      isEnabled: true,
      refreshIntervalInMinutes: 1440,
      lastReadAt: ago(20 * 60 * 1000),
      lastReadError: null,
      lastReadHttpStatus: null,
      eventCount: scenario === "many" ? 2000 : 3,
      hasMoreEvents: scenario === "many",
    },
    {
      _id: EXTERNAL_IDS.freezes,
      name: "Change freezes",
      color: "#d97706",
      calendarHost: "outlook.office365.com",
      isEnabled: true,
      refreshIntervalInMinutes: 60,
      lastReadAt:
        scenario === "failing" ? ago(26 * 60 * 60 * 1000) : ago(5 * 60 * 1000),
      lastReadError: scenario === "failing" ? "NotFound" : null,
      lastReadHttpStatus: scenario === "failing" ? 404 : null,
      eventCount: 3,
      hasMoreEvents: false,
    },
    {
      _id: EXTERNAL_IDS.payments,
      name: "Payments project",
      color: "#db2777",
      calendarHost: "oneuptime.example.com",
      isEnabled: false,
      refreshIntervalInMinutes: 60,
      lastReadAt: ago(3 * 24 * 60 * 60 * 1000),
      lastReadError: null,
      lastReadHttpStatus: null,
      eventCount: 1,
      hasMoreEvents: false,
    },
  ];
}

// Their events, in UTC: all-day holidays, and timed freezes.
function externalEvents(scenario) {
  if (scenario === "none" || scenario === "waiting") {
    return [];
  }

  const events = [
    {
      calendarId: EXTERNAL_IDS.holidays,
      title: "Founders' Day",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-06T00:00:00.000Z",
      isAllDay: true,
    },
    {
      calendarId: EXTERNAL_IDS.holidays,
      title: "Autumn break",
      startsAt: "2026-10-26T00:00:00.000Z",
      endsAt: "2026-10-28T00:00:00.000Z",
      isAllDay: true,
    },
    {
      calendarId: EXTERNAL_IDS.holidays,
      title: "St Andrew's Day",
      startsAt: "2026-11-30T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      isAllDay: true,
    },
    {
      calendarId: EXTERNAL_IDS.freezes,
      title: "Payments release window",
      startsAt: "2026-10-15T14:00:00.000Z",
      endsAt: "2026-10-15T16:00:00.000Z",
      isAllDay: false,
    },
    {
      calendarId: EXTERNAL_IDS.freezes,
      title: "Network team on site",
      startsAt: "2026-10-21T09:00:00.000Z",
      endsAt: "2026-10-21T10:30:00.000Z",
      isAllDay: false,
    },
    {
      calendarId: EXTERNAL_IDS.freezes,
      title: "Quarter-end change freeze",
      startsAt: "2026-10-29T00:00:00.000Z",
      endsAt: "2026-10-31T18:00:00.000Z",
      isAllDay: false,
    },
    {
      calendarId: EXTERNAL_IDS.payments,
      title: "Payments: database failover",
      startsAt: "2026-10-20T20:00:00.000Z",
      endsAt: "2026-10-20T22:00:00.000Z",
      isAllDay: false,
    },
  ];

  if (scenario === "many") {
    for (let index = 0; index < 520; index++) {
      const day = 1 + (index % 28);
      events.push({
        calendarId: EXTERNAL_IDS.holidays,
        title: `Shift ${index + 1}`,
        startsAt: `2026-10-${String(day).padStart(2, "0")}T0${index % 9}:00:00.000Z`,
        endsAt: `2026-10-${String(day).padStart(2, "0")}T0${(index % 9) + 1}:00:00.000Z`,
        isAllDay: false,
      });
    }
  }

  return events.map((event, index) => {
    return {
      _id: `51000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ...event,
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
  externalCalendars: externalCalendars(externalScenario),
  externalEvents: externalEvents(externalScenario),
  // The links the settings page wrote, by calendar id: never read back.
  externalLinks: {},
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
  model.statusPages = (event.statusPages || []).map((item) => {
    const statusPage = new StatusPage();
    statusPage._id = item._id;
    statusPage.name = item.name;
    return statusPage;
  });
  model.labels = [];
  model.isVisibleOnStatusPage = true;
  if (event.publishOnStatusPageAt) {
    model.publishOnStatusPageAt = new Date(event.publishOnStatusPageAt);
  }
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

  if (tableName === "ScheduledMaintenanceExternalCalendar") {
    state.requests.push({
      kind: "external-calendars",
      query: describeQuery(options.query),
      select: Object.keys(options.select || {}),
    });

    const matching = store.externalCalendars
      .filter((calendar) => {
        if (options.query && options.query.isEnabled === true) {
          return calendar.isEnabled;
        }
        return true;
      })
      .sort((first, second) => {
        return first.name.localeCompare(second.name);
      });

    const skip = Number(options.skip || 0);
    const limit = Number(options.limit || 10);

    return {
      data: matching.slice(skip, skip + limit).map(toExternalCalendarModel),
      count: matching.length,
      skip: skip,
      limit: limit,
    };
  }

  if (tableName === "ScheduledMaintenanceExternalCalendarEvent") {
    const ids =
      options.query &&
      options.query.scheduledMaintenanceExternalCalendarId instanceof Includes
        ? options.query.scheduledMaintenanceExternalCalendarId.values.map(
            (id) => {
              return id.toString();
            },
          )
        : [];

    state.requests.push({
      kind: "external-events",
      calendarIds: ids,
      query: describeQuery({
        startsAt: options.query && options.query.startsAt,
        endsAt: options.query && options.query.endsAt,
      }),
      limit: options.limit,
    });

    const matching = store.externalEvents.filter((event) => {
      return ids.includes(event.calendarId) && inRange(event, options.query);
    });

    const limit = Number(options.limit || 10);

    return {
      data: matching.slice(0, limit).map(toExternalEventModel),
      count: matching.length,
      skip: 0,
      limit: limit,
    };
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

ModelAPI.getItem = async (options) => {
  if (
    new options.modelType().tableName === "ScheduledMaintenanceExternalCalendar"
  ) {
    state.requests.push({
      kind: "external-calendar-item",
      select: Object.keys(options.select || {}),
    });

    const calendar = store.externalCalendars.find((item) => {
      return item._id === options.id.toString();
    });

    return calendar ? toExternalCalendarModel(calendar) : null;
  }

  return null;
};

ModelAPI.createOrUpdate = async (options) => {
  const tableName = new options.modelType().tableName;
  // What the form sends, as the API would receive it (a Color as its JSON).
  const json = options.modelType.toJSON(options.model, options.modelType);

  state.requests.push({
    kind: "save",
    tableName: tableName,
    formType: String(options.formType),
    data: JSON.parse(JSON.stringify(json)),
  });

  if (tableName !== "ScheduledMaintenanceExternalCalendar") {
    return new ModelAPIHttpResponse(200, json, {});
  }

  const link = normalizeExternalCalendarLink(
    options.model.calendarUrl ? options.model.calendarUrl.toString() : "",
  );

  const existing = options.model._id
    ? store.externalCalendars.find((item) => {
        return item._id === options.model._id.toString();
      })
    : null;

  if (existing) {
    existing.name = options.model.name || existing.name;
    if (options.model.color) {
      existing.color = options.model.color.toString();
    }
    if (options.model.refreshIntervalInMinutes) {
      existing.refreshIntervalInMinutes = Number(
        options.model.refreshIntervalInMinutes,
      );
    }
    return new ModelAPIHttpResponse(200, toExternalCalendarModel(existing), {});
  }

  const created = {
    _id: `52000000-0000-4000-8000-${String(store.externalCalendars.length + 1).padStart(12, "0")}`,
    name: options.model.name || "",
    color: options.model.color ? options.model.color.toString() : "#4f46e5",
    calendarHost: "url" in link ? link.host : "",
    isEnabled: true,
    refreshIntervalInMinutes: Number(
      options.model.refreshIntervalInMinutes || 60,
    ),
    lastReadAt: null,
    lastReadError: null,
    lastReadHttpStatus: null,
    eventCount: 0,
    hasMoreEvents: false,
  };

  store.externalCalendars.push(created);
  store.externalLinks[created._id] = "url" in link ? link.url : "";

  return new ModelAPIHttpResponse(200, toExternalCalendarModel(created), {});
};

ModelAPI.deleteItem = async (options) => {
  state.requests.push({
    kind: "delete",
    tableName: new options.modelType().tableName,
    id: options.id.toString(),
  });

  store.externalCalendars = store.externalCalendars.filter((item) => {
    return item._id !== options.id.toString();
  });
};

function toExternalCalendarModel(item) {
  const model = new ScheduledMaintenanceExternalCalendar();
  model._id = item._id;
  model.name = item.name;
  model.color = new Color(item.color);
  model.calendarHost = item.calendarHost;
  model.isEnabled = item.isEnabled;
  model.refreshIntervalInMinutes = item.refreshIntervalInMinutes;
  model.lastReadAt = item.lastReadAt ? new Date(item.lastReadAt) : undefined;
  model.lastReadError = item.lastReadError || undefined;
  model.lastReadHttpStatus = item.lastReadHttpStatus || undefined;
  model.eventCount = item.eventCount;
  model.hasMoreEvents = item.hasMoreEvents;
  return model;
}

function toExternalEventModel(item) {
  const model = new ScheduledMaintenanceExternalCalendarEvent();
  model._id = item._id;
  model.scheduledMaintenanceExternalCalendarId = new ObjectID(item.calendarId);
  model.title = item.title;
  model.startsAt = new Date(item.startsAt);
  model.endsAt = new Date(item.endsAt);
  model.isAllDay = item.isAllDay;
  return model;
}

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

  if (args.modelType === ScheduledMaintenanceExternalCalendar) {
    const calendar = store.externalCalendars.find((item) => {
      return item._id === args.id.toString();
    });

    if (calendar && typeof args.data.isEnabled === "boolean") {
      calendar.isEnabled = args.data.isEnabled;
    }

    if (calendar && typeof args.data.calendarUrl === "string") {
      const link = normalizeExternalCalendarLink(args.data.calendarUrl);

      if ("url" in link) {
        store.externalLinks[calendar._id] = link.url;
        calendar.calendarHost = link.host;
        calendar.lastReadAt = null;
        calendar.lastReadError = null;
        calendar.lastReadHttpStatus = null;
        calendar.eventCount = 0;
      }
    }
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

  if (path.endsWith("/read-now")) {
    if (readNowScenario === "fail") {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "This calendar was read a moment ago. Try again in a few seconds.",
        },
        {},
      );
    }

    const id = path.split("/").slice(-2)[0];
    const calendar = store.externalCalendars.find((item) => {
      return item._id === id;
    });

    if (calendar) {
      calendar.lastReadAt = new Date().toISOString();
      calendar.lastReadError = null;
      calendar.lastReadHttpStatus = null;
      calendar.eventCount =
        store.externalEvents.filter((event) => {
          return event.calendarId === id;
        }).length || 12;
    }

    return new HTTPResponse(200, calendar ? { _id: id } : {}, {});
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
          <ScheduledMaintenanceSideMenu project={project} />
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

const PAGE_PROPS = {
  currentProject: project,
  hasPaymentMethod: true,
};

/*
 * The pages by their real addresses, under the real route's project
 * parameter: All Events, the Maintenance Calendar and Calendar Settings.
 * Anything else under scheduled-maintenance-events is where a block, the +
 * or a link took the reader: the page's address says it.
 */
function Page() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const pathname = useLocation().pathname;
  const base = `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`;

  let page;

  if (pathname === base || pathname === `${base}/`) {
    page = (
      <ScheduledMaintenancesPage
        pageRoute={Navigation.getCurrentRoute()}
        {...PAGE_PROPS}
      />
    );
  } else if (pathname === `${base}/calendar`) {
    page = (
      <ScheduledMaintenanceCalendarPage
        pageRoute={Navigation.getCurrentRoute()}
        {...PAGE_PROPS}
      />
    );
  } else if (pathname === `${base}/settings/calendar`) {
    page = (
      <ScheduledMaintenanceCalendarSettings
        pageRoute={Navigation.getCurrentRoute()}
        {...PAGE_PROPS}
      />
    );
  } else {
    page = <div data-testid="fixture-navigated">{pathname}</div>;
  }

  return <Frame key={pathname}>{page}</Frame>;
}

function Shell() {
  return (
    <Routes>
      <Route path="/dashboard/:projectId/*" element={<Page />} />
    </Routes>
  );
}

if (!window.location.pathname.startsWith("/dashboard/")) {
  const suffix =
    pageScenario === "list"
      ? ""
      : pageScenario === "settings"
        ? "/settings/calendar"
        : "/calendar";

  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/scheduled-maintenance-events${suffix}${window.location.search}`,
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
