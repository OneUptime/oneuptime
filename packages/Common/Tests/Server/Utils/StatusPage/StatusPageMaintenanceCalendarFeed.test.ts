import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import StatusPageAPI from "../../../../Server/API/StatusPageAPI";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OnCallCalendarFeedRateLimit, {
  OnCallCalendarFeedRateLimitOutcome,
} from "../../../../Server/Middleware/OnCallCalendarFeedRateLimit";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import MaintenanceCalendarFeedCache from "../../../../Server/Utils/ScheduledMaintenance/MaintenanceCalendarFeedCache";
import BlockedProjectStatusPages from "../../../../Server/Utils/StatusPage/BlockedProjectStatusPages";
import StatusPageMaintenanceCalendarFeed, {
  STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE,
  STATUS_PAGE_CALENDAR_NO_MAINTENANCE_REASON,
  STATUS_PAGE_CALENDAR_NOT_FOUND_MESSAGE,
  STATUS_PAGE_CALENDAR_PRIVATE_REASON,
  STATUS_PAGE_CALENDAR_SIGN_IN_MESSAGE,
  StatusPageCalendarPage,
} from "../../../../Server/Utils/StatusPage/StatusPageMaintenanceCalendarFeed";
import StatusPageOverviewCache from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { MAINTENANCE_CALENDAR_MAX_EVENTS } from "../../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import {
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
} from "../../../Types/Calendar/ICalendarConformance";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

/*
 * A status page's maintenance calendar, served the way the Frontend app
 * serves it (both addresses, the rate limiter in front), over a real Express
 * application.
 *
 * What it holds is what the page shows - it is read through the page's own
 * read (StatusPageAPI.readShownScheduledMaintenanceEvents), and each event
 * affects the page's resources by the names the page gives them, never a
 * monitor's own name. Who may read it is who may read the page, asked on
 * every request: a page that does not exist, is archived or belongs to a
 * blocked project is a 404 as the page is; a private page answers a calendar
 * app an empty calendar saying why; one event (?event=) a signed-out reader
 * of a private page cannot download.
 */

const PAGE_ID: ObjectID = new ObjectID("76000000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "76100000-0000-4000-8000-000000000001",
);
const DOMAIN: string = "status.acme.example";

const API_MONITOR_ID: string = "76200000-0000-4000-8000-000000000001";
const DB_MONITOR_ID: string = "76200000-0000-4000-8000-000000000002";
const GROUP_ID: string = "76300000-0000-4000-8000-000000000001";

const STATE_IDS: Record<string, string> = {
  Scheduled: "76400000-0000-4000-8000-000000000001",
  Ongoing: "76400000-0000-4000-8000-000000000002",
  Ended: "76400000-0000-4000-8000-000000000003",
  Completed: "76400000-0000-4000-8000-000000000004",
};

// "s:" and the first 16 hex characters of the page's SHA-256.
const PAGE_RATE_LIMIT_KEY_PATTERN: RegExp = /^s:[0-9a-f]{16}$/;

const UPCOMING_ID: string = "76500000-0000-4000-8000-000000000001";
const CALLED_OFF_ID: string = "76500000-0000-4000-8000-000000000002";
const NOT_SHOWN_ID: string = "76500000-0000-4000-8000-000000000009";

function state(name: string): ScheduledMaintenanceState {
  const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  model.id = new ObjectID(STATE_IDS[name]!);
  model.name = name;
  model.order = Object.keys(STATE_IDS).indexOf(name) + 1;
  model.isScheduledState = name === "Scheduled";
  model.isOngoingState = name === "Ongoing";
  model.isEndedState = name === "Ended";
  model.isResolvedState = name === "Completed";
  return model;
}

function monitor(id: string, name: string): Monitor {
  const model: Monitor = new Monitor();
  model.id = new ObjectID(id);
  model.name = name;
  return model;
}

function label(name: string): Label {
  const model: Label = new Label();
  model.name = name;
  return model;
}

function maintenance(data: {
  id: string;
  title: string;
  state: string;
  startsAt: string;
  endsAt: string;
  monitors?: Array<Monitor>;
  labels?: Array<Label>;
}): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();
  model.id = new ObjectID(data.id);
  model.title = data.title;
  model.description = "We move the **primary database** to new hardware.";
  model.startsAt = new Date(data.startsAt);
  model.endsAt = new Date(data.endsAt);
  model.createdAt = new Date("2026-10-01T09:00:00.000Z");
  model.updatedAt = new Date("2026-10-02T09:00:00.000Z");
  model.version = 1;
  model.currentScheduledMaintenanceState = state(data.state);
  model.monitors = data.monitors || [];
  model.labels = data.labels || [];
  return model;
}

function timelineRow(
  eventId: string,
  stateName: string,
  iso: string,
): ScheduledMaintenanceStateTimeline {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row.scheduledMaintenanceId = new ObjectID(eventId);
  row.scheduledMaintenanceStateId = new ObjectID(STATE_IDS[stateName]!);
  row.startsAt = new Date(iso);
  return row;
}

/*
 * The page's resources: the API monitor shown as "Core services: Public API"
 * and a monitor group holding the database monitor, "Data: Storage".
 */
function pageResources(): Array<StatusPageResource> {
  const core: StatusPageGroup = new StatusPageGroup();
  core.name = "Core services";
  const data: StatusPageGroup = new StatusPageGroup();
  data.name = "Data";

  const api: StatusPageResource = new StatusPageResource();
  api.monitorId = new ObjectID(API_MONITOR_ID);
  api.displayName = "Public API";
  api.statusPageGroup = core;

  const storage: StatusPageResource = new StatusPageResource();
  storage.monitorGroupId = new ObjectID(GROUP_ID);
  storage.displayName = "Storage";
  storage.statusPageGroup = data;

  return [api, storage];
}

// What the page's own read answers, as StatusPageAPI builds it.
function shownResponse(events: Array<ScheduledMaintenance>): JSONObject {
  const monitorsInGroup: Record<string, Array<ObjectID>> = {};
  monitorsInGroup[GROUP_ID] = [new ObjectID(DB_MONITOR_ID)];

  return {
    scheduledMaintenanceEvents: BaseModel.toJSONArray(
      events,
      ScheduledMaintenance,
    ),
    scheduledMaintenanceStates: BaseModel.toJSONArray(
      Object.keys(STATE_IDS).map(state),
      ScheduledMaintenanceState,
    ),
    scheduledMaintenanceStateTimelines: BaseModel.toJSONArray(
      [
        timelineRow(CALLED_OFF_ID, "Scheduled", "2026-10-01T09:00:00.000Z"),
        timelineRow(CALLED_OFF_ID, "Completed", "2026-10-03T09:00:00.000Z"),
      ],
      ScheduledMaintenanceStateTimeline,
    ),
    statusPageResources: BaseModel.toJSONArray(
      pageResources(),
      StatusPageResource,
    ),
    monitorsInGroup: JSONFunctions.serialize(monitorsInGroup as JSONObject),
  };
}

function pageEvents(): Array<ScheduledMaintenance> {
  return [
    maintenance({
      id: UPCOMING_ID,
      title: "Database upgrade",
      state: "Scheduled",
      startsAt: "2026-10-20T22:00:00.000Z",
      endsAt: "2026-10-21T01:00:00.000Z",
      monitors: [
        monitor(API_MONITOR_ID, "prod-api-eu-west-1 (internal)"),
        monitor(DB_MONITOR_ID, "pg-primary-07"),
      ],
      labels: [label("Database")],
    }),
    maintenance({
      id: CALLED_OFF_ID,
      title: "Network change",
      state: "Completed",
      startsAt: "2026-10-05T22:00:00.000Z",
      endsAt: "2026-10-06T01:00:00.000Z",
    }),
  ];
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl: string;
let cache: Map<string, string>;
let page: StatusPage;

let hasReadAccessSpy: SpyInstance<typeof StatusPageService.hasReadAccess>;
let readShownSpy: SpyInstance<
  typeof StatusPageAPI.readShownScheduledMaintenanceEvents
>;
let blockedSpy: SpyInstance<
  typeof BlockedProjectStatusPages.isStatusPageOfBlockedProject
>;
let generationSpy: SpyInstance<
  typeof StatusPageOverviewCache.getProjectGeneration
>;

function request(
  requestPath: string,
  headers?: Record<string, string>,
): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const clientRequest: http.ClientRequest = http.request(
        `${baseUrl}${requestPath}`,
        { method: "GET", headers: headers || {} },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );
      clientRequest.on("error", reject);
      clientRequest.end();
    },
  );
}

// The page's preview address under OneUptime.
function previewPath(query?: string): string {
  return `/status-page/${PAGE_ID.toString()}/maintenance.ics${query || ""}`;
}

// The page's own domain: the Host header names the page.
function onDomain(query?: string): Promise<HttpResult> {
  return request(`/maintenance.ics${query || ""}`, { Host: DOMAIN });
}

function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

beforeAll(async () => {
  const app: express.Express = express();

  // As packages/App/FeatureSet/Frontend/Index.ts mounts it.
  app.get(
    ["/maintenance.ics", "/status-page/:statusPageId/maintenance.ics"],
    StatusPageMaintenanceCalendarFeed.getRateLimitMiddleware() as unknown as express.RequestHandler,
    StatusPageMaintenanceCalendarFeed.getHandler() as unknown as express.RequestHandler,
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  MaintenanceCalendarFeedCache.clearInFlight();
  cache = new Map();

  page = new StatusPage();
  page.id = PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "acme-public";
  page.pageTitle = "Acme Status";
  page.isArchived = false;
  page.showScheduledMaintenanceEventsOnStatusPage = true;

  jest
    .spyOn(OnCallCalendarFeedRateLimit, "consume")
    .mockResolvedValue({ outcome: OnCallCalendarFeedRateLimitOutcome.Allowed });

  jest
    .spyOn(StatusPageService, "resolveStatusPageIdOrNull")
    .mockImplementation(async (idOrDomain: string) => {
      if (idOrDomain === DOMAIN || idOrDomain === PAGE_ID.toString()) {
        return PAGE_ID;
      }
      return null;
    });

  blockedSpy = jest
    .spyOn(BlockedProjectStatusPages, "isStatusPageOfBlockedProject")
    .mockResolvedValue(false);

  hasReadAccessSpy = jest
    .spyOn(StatusPageService, "hasReadAccess")
    .mockResolvedValue({ hasReadAccess: true });

  jest.spyOn(StatusPageService, "findOneBy").mockImplementation((async () => {
    return page;
  }) as never);

  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(`https://${DOMAIN}/`);

  readShownSpy = jest
    .spyOn(StatusPageAPI, "readShownScheduledMaintenanceEvents")
    .mockImplementation(
      async (data: {
        statusPageId: ObjectID;
        scheduledMaintenanceId: ObjectID | null;
      }): Promise<JSONObject> => {
        const events: Array<ScheduledMaintenance> = pageEvents().filter(
          (event: ScheduledMaintenance) => {
            return (
              !data.scheduledMaintenanceId ||
              event.id!.toString() === data.scheduledMaintenanceId.toString()
            );
          },
        );
        return shownResponse(events);
      },
    );

  generationSpy = jest
    .spyOn(StatusPageOverviewCache, "getProjectGeneration")
    .mockResolvedValue("g1");

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return cache.get(`${namespace}|${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cache.set(`${namespace}|${key}`, value);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a status page's maintenance calendar", () => {
  test("holds the events the page shows, named as the page names what they affect", async () => {
    const result: HttpResult = await request(previewPath());

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(result.headers["content-disposition"]).toBe(
      'inline; filename="maintenance.ics"',
    );
    expect(checkICalendarConformance(result.body).problems).toEqual([]);
    expect(readCalendarText(result.body, "X-WR-CALNAME")).toBe(
      "Acme Status · Maintenance",
    );

    const events: Array<ParsedEvent> = readEvents(result.body);

    expect(
      events.map((event: ParsedEvent) => {
        return event.summary;
      }),
    ).toEqual(["Network change", "Database upgrade"]);

    const upgrade: ParsedEvent = events[1]!;

    expect(upgrade.description).toContain(
      "Affects: Core services: Public API, Data: Storage",
    );
    expect(upgrade.description).not.toContain("prod-api-eu-west-1");
    expect(upgrade.description).not.toContain("pg-primary-07");
    expect(upgrade.description).not.toContain("Status pages:");
    expect(upgrade.description).toContain("primary database");
    expect(upgrade.description).not.toContain("**");
    expect(upgrade.url).toBe(
      `https://${DOMAIN}/scheduled-events/${UPCOMING_ID}`,
    );

    expect(readShownSpy).toHaveBeenCalledWith({
      statusPageId: PAGE_ID,
      scheduledMaintenanceId: null,
    });
  });

  test("an event the page shows as called off is STATUS:CANCELLED", async () => {
    const result: HttpResult = await request(previewPath());

    const networkChange: ParsedEvent = readEvents(result.body)[0]!;

    expect(
      networkChange.properties.find((property: { name: string }) => {
        return property.name === "STATUS";
      })?.value,
    ).toBe("CANCELLED");
  });

  test("the page's own domain serves the same calendar", async () => {
    const onPreview: HttpResult = await request(previewPath());
    const onItsDomain: HttpResult = await onDomain();

    expect(onItsDomain.status).toBe(200);
    expect(readEvents(onItsDomain.body)).toEqual(readEvents(onPreview.body));
  });

  test("is kept under the page and its project's generation: a record taken off the page is a new key at once", async () => {
    await request(previewPath());
    await flush();
    await request(previewPath());

    expect(readShownSpy).toHaveBeenCalledTimes(1);
    expect(Array.from(cache.keys())).toEqual([
      `maintenance-calendar|status-page:${PAGE_ID.toString()}:g1`,
    ]);
    expect(generationSpy).toHaveBeenCalledWith(PROJECT_ID);

    generationSpy.mockResolvedValue("g2");
    await flush();
    await request(previewPath());

    expect(readShownSpy).toHaveBeenCalledTimes(2);
  });

  test("who may read it is asked on every request, before the cache", async () => {
    await request(previewPath());
    await flush();
    await request(previewPath());

    expect(hasReadAccessSpy).toHaveBeenCalledTimes(2);
  });

  test.each([
    [
      "no such page",
      "/status-page/76000000-0000-4000-8000-0000000000ff/maintenance.ics",
    ],
    ["no page on this domain", "/maintenance.ics"],
  ])("%s is a 404, as the page is", async (_name: string, path: string) => {
    const result: HttpResult = await request(path, {
      Host: "elsewhere.example",
    });

    expect(result.status).toBe(404);
    expect(result.body).toBe(STATUS_PAGE_CALENDAR_NOT_FOUND_MESSAGE);
    expect(result.headers["x-robots-tag"]).toContain("noindex");
    expect(readShownSpy).not.toHaveBeenCalled();
  });

  test("a page of a blocked project is a 404, as the page is", async () => {
    blockedSpy.mockResolvedValue(true);

    const result: HttpResult = await request(previewPath());

    expect(result.status).toBe(404);
    expect(readShownSpy).not.toHaveBeenCalled();
  });

  test("an archived page is a 404, as the page is", async () => {
    page.isArchived = true;

    const result: HttpResult = await request(previewPath());

    expect(result.status).toBe(404);
    expect(readShownSpy).not.toHaveBeenCalled();
  });

  test("a page the access check cannot find is a 404", async () => {
    hasReadAccessSpy.mockResolvedValue({
      hasReadAccess: false,
      error: new NotFoundException("Status Page not found"),
    });

    expect((await request(previewPath())).status).toBe(404);
  });

  test.each([
    ["signed out of a private page", new NotAuthenticatedException("Sign in")],
    ["outside the page's IP allow list", new ForbiddenException("Not allowed")],
  ])(
    "a calendar app %s gets an empty calendar saying why, so it clears what it held",
    async (_name: string, error: Error) => {
      hasReadAccessSpy.mockResolvedValue({
        hasReadAccess: false,
        error: error as NotAuthenticatedException,
      });

      const result: HttpResult = await request(previewPath());

      expect(result.status).toBe(200);
      expect(result.body).not.toContain("BEGIN:VEVENT");
      expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
        STATUS_PAGE_CALENDAR_PRIVATE_REASON,
      );
      expect(readShownSpy).not.toHaveBeenCalled();
      expect(cache.size).toBe(0);
    },
  );

  test("a page that shows no scheduled maintenance answers an empty calendar", async () => {
    page.showScheduledMaintenanceEventsOnStatusPage = false;

    const result: HttpResult = await request(previewPath());

    expect(result.status).toBe(200);
    expect(result.body).not.toContain("BEGIN:VEVENT");
    expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
      STATUS_PAGE_CALENDAR_NO_MAINTENANCE_REASON,
    );
    expect(readShownSpy).not.toHaveBeenCalled();
  });
});

describe("one event of a status page, as a file (?event=)", () => {
  test("is the event alone, as a download", async () => {
    const result: HttpResult = await request(
      previewPath(`?event=${UPCOMING_ID}`),
    );

    expect(result.status).toBe(200);
    expect(result.headers["content-disposition"]).toBe(
      'attachment; filename="maintenance.ics"',
    );
    expect(checkICalendarConformance(result.body).problems).toEqual([]);

    const events: Array<ParsedEvent> = readEvents(result.body);

    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Database upgrade");
    expect(readShownSpy).toHaveBeenCalledWith({
      statusPageId: PAGE_ID,
      scheduledMaintenanceId: new ObjectID(UPCOMING_ID),
    });
  });

  test("an id written in capitals is the same event", async () => {
    const result: HttpResult = await request(
      previewPath(`?event=${UPCOMING_ID.toUpperCase()}`),
    );

    expect(result.status).toBe(200);
    expect(readEvents(result.body)[0]!.summary).toBe("Database upgrade");
  });

  test("an event the page does not show is a 404, never the whole calendar", async () => {
    const result: HttpResult = await request(
      previewPath(`?event=${NOT_SHOWN_ID}`),
    );

    expect(result.status).toBe(404);
    expect(result.body).toBe(STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE);
  });

  test.each(["not-an-id", "1;DROP", "../x"])(
    "a value that is not an event id (%s) is a 404, never the whole calendar",
    async (value: string) => {
      const result: HttpResult = await request(
        previewPath(`?event=${encodeURIComponent(value)}`),
      );

      expect(result.status).toBe(404);
      expect(result.body).not.toContain("BEGIN:VCALENDAR");
      expect(readShownSpy).not.toHaveBeenCalled();
    },
  );

  test("a reader the page would not let in cannot download it", async () => {
    hasReadAccessSpy.mockResolvedValue({
      hasReadAccess: false,
      error: new NotAuthenticatedException("Sign in"),
    });

    const result: HttpResult = await request(
      previewPath(`?event=${UPCOMING_ID}`),
    );

    expect(result.status).toBe(401);
    expect(result.body).toBe(STATUS_PAGE_CALENDAR_SIGN_IN_MESSAGE);
    expect(readShownSpy).not.toHaveBeenCalled();
  });

  test("on a page that shows no scheduled maintenance there is no event to download", async () => {
    page.showScheduledMaintenanceEventsOnStatusPage = false;

    const result: HttpResult = await request(
      previewPath(`?event=${UPCOMING_ID}`),
    );

    expect(result.status).toBe(404);
    expect(readShownSpy).not.toHaveBeenCalled();
  });
});

describe("StatusPageMaintenanceCalendarFeed helpers", () => {
  function fakeRequest(data: {
    statusPageId?: string;
    hostname?: string;
    event?: unknown;
  }): ExpressRequest {
    return {
      params: data.statusPageId ? { statusPageId: data.statusPageId } : {},
      hostname: data.hostname,
      query: data.event === undefined ? {} : { event: data.event },
    } as unknown as ExpressRequest;
  }

  test("the page a request names: the id in its path, else the domain it was made to", () => {
    expect(
      StatusPageMaintenanceCalendarFeed.getStatusPageIdOrDomain(
        fakeRequest({ statusPageId: PAGE_ID.toString(), hostname: DOMAIN }),
      ),
    ).toBe(PAGE_ID.toString());
    expect(
      StatusPageMaintenanceCalendarFeed.getStatusPageIdOrDomain(
        fakeRequest({ hostname: "Status.Acme.Example" }),
      ),
    ).toBe(DOMAIN);
  });

  test("?event= is undefined when absent, null when it is not an id", () => {
    expect(
      StatusPageMaintenanceCalendarFeed.readEventId(fakeRequest({})),
    ).toBeUndefined();
    expect(
      StatusPageMaintenanceCalendarFeed.readEventId(fakeRequest({ event: "" })),
    ).toBeUndefined();
    expect(
      StatusPageMaintenanceCalendarFeed.readEventId(
        fakeRequest({ event: "nope" }),
      ),
    ).toBeNull();
    expect(
      StatusPageMaintenanceCalendarFeed.readEventId(
        fakeRequest({ event: [UPCOMING_ID, NOT_SHOWN_ID] }),
      ),
    ).toEqual(new ObjectID(UPCOMING_ID));
  });

  test("the rate limit key is a short hash of the page, never the domain itself", () => {
    const key: string = StatusPageMaintenanceCalendarFeed.getRateLimitKey(
      fakeRequest({ hostname: DOMAIN }),
    );

    expect(key).toMatch(PAGE_RATE_LIMIT_KEY_PATTERN);
    expect(key).not.toContain("acme");
    expect(
      StatusPageMaintenanceCalendarFeed.getRateLimitKey(
        fakeRequest({ hostname: "STATUS.ACME.EXAMPLE" }),
      ),
    ).toBe(key);
    expect(
      StatusPageMaintenanceCalendarFeed.getRateLimitKey(
        fakeRequest({ hostname: "other.example" }),
      ),
    ).not.toBe(key);
    expect(
      StatusPageMaintenanceCalendarFeed.getRateLimitKey(fakeRequest({})),
    ).toBe("none");
  });

  test("a page whose project is not known is kept under the page alone", async () => {
    const unknownProject: StatusPageCalendarPage = {
      statusPageId: PAGE_ID,
      projectId: null,
      name: "Acme Status",
      showsMaintenance: true,
    };

    expect(
      await StatusPageMaintenanceCalendarFeed.getCacheKey(unknownProject),
    ).toBe(`status-page:${PAGE_ID.toString()}:none`);
  });

  test("buildEvents holds at most MAINTENANCE_CALENDAR_MAX_EVENTS, the ones furthest ahead left out", () => {
    const many: Array<ScheduledMaintenance> = [];

    for (
      let index: number = 0;
      index <= MAINTENANCE_CALENDAR_MAX_EVENTS;
      index++
    ) {
      const day: Date = new Date(
        Date.UTC(2026, 9, 20) + index * 60 * 60 * 1000,
      );

      many.push(
        maintenance({
          id: `76600000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          title: `Window ${index}`,
          state: "Scheduled",
          startsAt: day.toISOString(),
          endsAt: new Date(day.getTime() + 30 * 60 * 1000).toISOString(),
        }),
      );
    }

    const built: ReturnType<
      typeof StatusPageMaintenanceCalendarFeed.buildEvents
    > = StatusPageMaintenanceCalendarFeed.buildEvents({
      response: shownResponse(many.reverse()),
      statusPageUrl: `https://${DOMAIN}`,
    });

    expect(built.events).toHaveLength(MAINTENANCE_CALENDAR_MAX_EVENTS);
    expect(built.isTruncated).toBe(true);
    expect(built.events[0]!.title).toBe("Window 0");
    expect(built.events[built.events.length - 1]!.title).toBe(
      `Window ${MAINTENANCE_CALENDAR_MAX_EVENTS - 1}`,
    );
  });
});
