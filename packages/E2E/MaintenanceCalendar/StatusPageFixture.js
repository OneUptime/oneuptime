import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import ScheduledEventList from "../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/List";
import ScheduledEventDetail from "../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail";
import API from "../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import i18n from "../../App/FeatureSet/StatusPage/src/Utils/i18n";
import "Common/UI/Styles/Theme.css";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * The status page's Scheduled Events list and an event's page, the real
 * ones, with the status page API answered from an in-page store
 * (window.__statusPageCalendarFixture) the specs read: every request, every
 * copy to the clipboard.
 *
 *   /status-page/<id>/scheduled-events          the list (Subscribe to calendar)
 *   /status-page/<id>/scheduled-events/<event>  an event (Add to calendar)
 *   /scheduled-events...                         the same on the page's own domain
 *   ?private=1    a private page (no Subscribe to calendar)
 *   ?lang=de|ja|fa   ?theme=dark
 */

const params = new URLSearchParams(window.location.search);

const id = (value) => {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

const PAGE_ID = id(1);
const MONITOR_ID = id(2);

const STATES = [
  { _id: id(10), name: "Scheduled", color: "#000000", order: 1, isScheduledState: true },
  { _id: id(11), name: "Ongoing", color: "#ffbf53", order: 2, isOngoingState: true },
  { _id: id(12), name: "Ended", color: "#4a4a4a", order: 3, isEndedState: true },
  { _id: id(13), name: "Completed", color: "#2ab57d", order: 4, isResolvedState: true },
].map((state) => {
  return Object.assign(new ScheduledMaintenanceState(), {
    ...state,
    color: new Color(state.color),
  });
});

const EVENTS = [
  {
    _id: id(100),
    title: "Database upgrade",
    description: "We move the primary database to new hardware.",
    startsAt: new Date("2026-10-20T22:00:00.000Z"),
    endsAt: new Date("2026-10-21T01:00:00.000Z"),
    state: STATES[0],
  },
  {
    _id: id(101),
    title: "Network switch firmware",
    description: "",
    startsAt: new Date("2026-10-15T09:00:00.000Z"),
    endsAt: new Date("2026-10-15T11:00:00.000Z"),
    state: STATES[1],
  },
].map((event) => {
  return Object.assign(new ScheduledMaintenance(), {
    _id: event._id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
    currentScheduledMaintenanceState: event.state,
    monitors: [Object.assign(new Monitor(), { _id: MONITOR_ID })],
  });
});

const TIMELINES = EVENTS.map((event, index) => {
  return Object.assign(new ScheduledMaintenanceStateTimeline(), {
    _id: id(200 + index),
    scheduledMaintenanceId: new ObjectID(event._id),
    scheduledMaintenanceState: event.currentScheduledMaintenanceState,
    startsAt: new Date("2026-10-10T09:00:00.000Z"),
    createdAt: new Date("2026-10-10T09:00:00.000Z"),
  });
});

const RESOURCES = [
  Object.assign(new StatusPageResource(), {
    _id: id(300),
    displayName: "API",
    monitorId: new ObjectID(MONITOR_ID),
    order: 1,
  }),
];

const state = { requests: [], copied: [] };
window.__statusPageCalendarFixture = state;

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text) => {
      state.copied.push(text);
    },
  },
});

function answer(events) {
  return new HTTPResponse(
    200,
    {
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStates: BaseModel.toJSONObjectArray(
        STATES,
        ScheduledMaintenanceState,
      ),
      scheduledMaintenanceEvents: BaseModel.toJSONObjectArray(
        events,
        ScheduledMaintenance,
      ),
      statusPageResources: BaseModel.toJSONObjectArray(
        RESOURCES,
        StatusPageResource,
      ),
      scheduledMaintenanceStateTimelines: BaseModel.toJSONObjectArray(
        TIMELINES,
        ScheduledMaintenanceStateTimeline,
      ),
      monitorsInGroup: {},
    },
    {},
  );
}

API.post = async (options) => {
  const path = new URL(options.url.toString(), window.location.origin)
    .pathname;
  state.requests.push(path);

  const prefix = `/scheduled-maintenance-events/${PAGE_ID}`;
  const at = path.indexOf(prefix);

  if (at === -1) {
    return new HTTPErrorResponse(404, { message: `No route for ${path}` }, {});
  }

  const rest = path.slice(at + prefix.length).split("/").filter(Boolean);

  if (rest.length === 0) {
    return answer(EVENTS);
  }

  return answer(
    EVENTS.filter((event) => {
      return event._id === rest[0];
    }),
  );
};

StatusPageUtil.setStatusPageId(new ObjectID(PAGE_ID));
StatusPageUtil.setIsPrivateStatusPage(params.get("private") === "1");
StatusPageUtil.checkIfUserHasLoggedIn = () => {};

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

if (["de", "ja", "fa"].includes(params.get("lang"))) {
  await i18n.changeLanguage(params.get("lang"));
}

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const segments = window.location.pathname.split("/").filter(Boolean);
  const eventsAt = segments.indexOf("scheduled-events");
  const eventId = eventsAt >= 0 ? segments[eventsAt + 1] : undefined;

  return (
    <main className="mx-auto max-w-5xl px-4 py-4 sm:px-8">
      {eventId ? (
        <ScheduledEventDetail
          pageRoute={new Route(window.location.pathname)}
          onLoadComplete={() => {}}
        />
      ) : (
        <ScheduledEventList
          pageRoute={new Route(window.location.pathname)}
          onLoadComplete={() => {}}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
