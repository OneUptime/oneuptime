import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService, {
  Service as OnCallDutyPolicyScheduleLayerServiceType,
} from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleService, {
  Service as OnCallDutyPolicyScheduleServiceType,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ScheduleLayerChanges from "../../../Server/Utils/OnCall/ScheduleLayerChanges";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
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
import moment from "moment-timezone";

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * A WEEKLY WINDOW IS ON CALL ON THE DAYS IT NAMES (#11455), OVER HTTP.
 *
 * Through the real API router, the real layer and schedule services and
 * their hooks, over in-memory tables:
 *
 *   - an API or Terraform write whose window names Monday with a time on a
 *     Wednesday is refused with a 400 that names the window - it used to be
 *     taken, and the layer was on call on Wednesdays and on no Monday;
 *   - a write dated on its days, Terraform's documented example among
 *     them, is taken as it is; a day left out is filled in from its time;
 *   - a schedule's time zone, changed, keeps every time of its layers on
 *     the clock, and a Save Layer after it - the Dashboard sends every
 *     window back - is taken;
 *   - a layer stored with windows whose days a change of zone moved, before
 *     this, still saves: a window sent back as it is stored is not judged.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11455000-0000-4000-8000-000000000001",
);
const WARSAW_SCHEDULE_ID: string = "11455000-0000-4000-8000-000000000002";
const NEW_YORK_SCHEDULE_ID: string = "11455000-0000-4000-8000-000000000003";
const NO_ZONE_SCHEDULE_ID: string = "11455000-0000-4000-8000-000000000004";
const UTC_SCHEDULE_ID: string = "11455000-0000-4000-8000-000000000005";

// On call Monday 09:00 to 17:00, in Warsaw, dated on a Monday.
const WARSAW_LAYER_ID: string = "11455000-0000-4000-8000-000000000011";
// A second layer of the same schedule: nights, every day.
const WARSAW_NIGHTS_LAYER_ID: string = "11455000-0000-4000-8000-000000000012";
/*
 * Set up as Monday 01:00 to 09:00 in Warsaw, and its schedule's zone
 * changed to New York before #11455: read there, it starts on Sunday 19:00.
 */
const DRIFTED_LAYER_ID: string = "11455000-0000-4000-8000-000000000013";
// A layer in another schedule, which a change of Warsaw's zone leaves alone.
const NEW_YORK_LAYER_ID: string = "11455000-0000-4000-8000-000000000014";

const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";

const LAYER_ROUTE: string = "/api/on-call-duty-schedule-layer";
const SCHEDULE_ROUTE: string = "/api/on-call-duty-policy-schedule";

function dateTime(iso: string): JSONObject {
  return { _type: ObjectType.DateTime, value: iso };
}

function wall(text: string, zone: string): string {
  return moment.tz(text, "YYYY-MM-DD HH:mm", zone).toDate().toISOString();
}

function clockOf(value: unknown, zone: string): string {
  const time: Date | null = RestrictionTimes.readMoment(value);
  return time ? moment.tz(time, zone).format("dddd HH:mm") : "(none)";
}

function restriction(value: JSONObject): JSONObject {
  return { _type: ObjectType.RestrictionTimes, value: value };
}

function weeklyValue(windows: Array<JSONObject>): JSONObject {
  return {
    restrictionType: "Weekly",
    dayRestrictionTimes: null,
    weeklyRestrictionTimes: windows,
  };
}

function windowOf(data: {
  startDay?: string | null;
  endDay?: string | null;
  startTime: string;
  endTime: string;
}): JSONObject {
  const window: JSONObject = {
    startTime: dateTime(data.startTime),
    endTime: dateTime(data.endTime),
  };

  if (data.startDay !== undefined) {
    window["startDay"] = data.startDay;
  }

  if (data.endDay !== undefined) {
    window["endDay"] = data.endDay;
  }

  return window;
}

const WEEKLY_ROTATION: JSONObject = {
  _type: ObjectType.Recurring,
  value: {
    intervalType: "Week",
    intervalCount: { _type: ObjectType.PositiveNumber, value: 1 },
  },
};

function layerWrite(
  scheduleId: string,
  restrictionTimes: JSONObject,
): JSONObject {
  return {
    name: "Business hours",
    onCallDutyPolicyScheduleId: scheduleId,
    startsAt: dateTime("2026-01-05T08:00:00.000Z"),
    handOffTime: dateTime("2026-01-12T08:00:00.000Z"),
    rotation: WEEKLY_ROTATION,
    restrictionTimes: restrictionTimes,
  };
}

// A restriction as the column's transformer hands it to the service.
function storedRestriction(value: JSONObject): RestrictionTimes {
  return (
    RestrictionTimes.getDatabaseTransformer() as unknown as {
      from: (value: JSONObject) => RestrictionTimes;
    }
  ).from(restriction(value));
}

// A stored row's restriction, as written to the table.
function storedValue(row: StoredRow): JSONObject {
  const stored: unknown = row["restrictionTimes"];
  const json: JSONObject =
    stored instanceof RestrictionTimes
      ? stored.toDatabaseJSON()
      : (stored as JSONObject);
  return json["value"] as JSONObject;
}

function storedWindows(row: StoredRow): Array<JSONObject> {
  return (storedValue(row)["weeklyRestrictionTimes"] ||
    []) as Array<JSONObject>;
}

const MONDAY_WARSAW: JSONObject = windowOf({
  startDay: "Monday",
  endDay: "Monday",
  startTime: wall("2026-01-05 09:00", WARSAW),
  endTime: wall("2026-01-05 17:00", WARSAW),
});

const DRIFTED_WINDOW: JSONObject = windowOf({
  startDay: "Monday",
  endDay: "Monday",
  startTime: wall("2026-01-05 01:00", WARSAW),
  endTime: wall("2026-01-05 09:00", WARSAW),
});

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let layers: InMemoryTable;
let schedules: InMemoryTable;
let rosterRefreshes: Array<string>;

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<
      OnCallDutyPolicyScheduleLayer,
      OnCallDutyPolicyScheduleLayerServiceType
    >(
      OnCallDutyPolicyScheduleLayer,
      OnCallDutyPolicyScheduleLayerService,
    ).getRouter(),
    new BaseAPI<OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleServiceType>(
      OnCallDutyPolicySchedule,
      OnCallDutyPolicyScheduleService,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  rosterRefreshes = [];
  caller = {
    ...customDomainCaller({
      permissions: [Permission.ProjectAdmin],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  stubProjectDirectory({});
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);

  // Who is on call is worked out after the write, by suites of its own.
  jest
    .spyOn(ScheduleLayerChanges, "afterLayersWritten")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockImplementation((async (scheduleId: ObjectID): Promise<void> => {
      rosterRefreshes.push(scheduleId.toString());
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined as never);

  schedules = useInMemoryTable(
    OnCallDutyPolicyScheduleService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: WARSAW_SCHEDULE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Warsaw on-call",
        timezone: WARSAW,
      },
      {
        _id: NEW_YORK_SCHEDULE_ID,
        projectId: PROJECT_ID.toString(),
        name: "New York on-call",
        timezone: NEW_YORK,
      },
      {
        _id: NO_ZONE_SCHEDULE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Legacy on-call",
        timezone: null,
      },
      {
        _id: UTC_SCHEDULE_ID,
        projectId: PROJECT_ID.toString(),
        name: "UTC on-call",
        timezone: "UTC",
      },
    ],
  );

  layers = useInMemoryTable(
    OnCallDutyPolicyScheduleLayerService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: WARSAW_LAYER_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyScheduleId: WARSAW_SCHEDULE_ID,
        name: "Mondays",
        order: 1,
        startsAt: new Date(wall("2026-01-05 09:00", WARSAW)),
        handOffTime: new Date(wall("2026-01-12 09:00", WARSAW)),
        rotation: WEEKLY_ROTATION,
        restrictionTimes: storedRestriction(weeklyValue([MONDAY_WARSAW])),
      },
      {
        _id: WARSAW_NIGHTS_LAYER_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyScheduleId: WARSAW_SCHEDULE_ID,
        name: "Nights",
        order: 2,
        startsAt: new Date(wall("2026-01-05 17:00", WARSAW)),
        handOffTime: new Date(wall("2026-01-06 17:00", WARSAW)),
        rotation: WEEKLY_ROTATION,
        restrictionTimes: storedRestriction({
          restrictionType: "Daily",
          dayRestrictionTimes: {
            startTime: dateTime(wall("2026-01-05 17:00", WARSAW)),
            endTime: dateTime(wall("2026-01-06 07:00", WARSAW)),
          },
          weeklyRestrictionTimes: [],
        }),
      },
      {
        _id: DRIFTED_LAYER_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyScheduleId: NEW_YORK_SCHEDULE_ID,
        name: "Early Mondays",
        order: 1,
        startsAt: new Date(wall("2026-01-05 01:00", WARSAW)),
        handOffTime: new Date(wall("2026-01-12 01:00", WARSAW)),
        rotation: WEEKLY_ROTATION,
        restrictionTimes: storedRestriction(weeklyValue([DRIFTED_WINDOW])),
      },
      {
        _id: NEW_YORK_LAYER_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyScheduleId: NEW_YORK_SCHEDULE_ID,
        name: "New York Mondays",
        order: 2,
        startsAt: new Date(wall("2026-01-05 09:00", NEW_YORK)),
        handOffTime: new Date(wall("2026-01-12 09:00", NEW_YORK)),
        rotation: WEEKLY_ROTATION,
        restrictionTimes: storedRestriction(
          weeklyValue([
            windowOf({
              startDay: "Monday",
              endDay: "Monday",
              startTime: wall("2026-01-05 09:00", NEW_YORK),
              endTime: wall("2026-01-05 17:00", NEW_YORK),
            }),
          ]),
        ),
      },
    ],
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createLayer(data: JSONObject): Promise<SentRequest> {
  return await server.request("POST", LAYER_ROUTE, { data: data });
}

async function updateLayer(id: string, data: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `${LAYER_ROUTE}/${id}`, { data: data });
}

async function updateSchedule(
  id: string,
  data: JSONObject,
): Promise<SentRequest> {
  return await server.request("PUT", `${SCHEDULE_ROUTE}/${id}`, {
    data: data,
  });
}

async function readLayer(id: string): Promise<JSONObject> {
  const sent: SentRequest = await server.request(
    "POST",
    `${LAYER_ROUTE}/get-list`,
    {
      query: { _id: id },
      select: {
        _id: true,
        name: true,
        startsAt: true,
        handOffTime: true,
        restrictionTimes: true,
      },
      limit: 10,
      skip: 0,
    },
  );

  expect(sent.status).toBe(200);
  return (((sent.answer as JSONObject)["data"] || []) as Array<JSONObject>)[0]!;
}

describe("POST /api/on-call-duty-schedule-layer: a weekly window's days", () => {
  test("REGRESSION #11455: Monday with a Wednesday-dated startTime is refused with a 400 that names the window, and nothing is written", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(
        WARSAW_SCHEDULE_ID,
        restriction(
          weeklyValue([
            windowOf({
              startDay: "Monday",
              endDay: "Monday",
              startTime: "2026-01-07T08:00:00.000Z",
              endTime: "2026-01-05T16:00:00.000Z",
            }),
          ]),
        ),
      ),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 400,
      refusal:
        "restrictionTimes.value.weeklyRestrictionTimes[0].startTime is 2026-01-07T08:00:00.000Z, a Wednesday in Europe/Warsaw, the schedule's time zone, but its startDay is Monday. A window is on call on the days it names: date its startTime on a Monday, such as 2026-01-05T08:00:00.000Z, or set its startDay to Wednesday.",
    });
    expect(layers.inserts).toHaveLength(0);
  });

  test("the same window dated on its Monday is taken, as it was sent", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(WARSAW_SCHEDULE_ID, restriction(weeklyValue([MONDAY_WARSAW]))),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(layers.inserts).toHaveLength(1);

    const [window]: Array<JSONObject> = storedWindows(layers.inserts[0]!);
    expect(window!["startDay"]).toBe("Monday");
    expect(clockOf(window!["startTime"], WARSAW)).toBe("Monday 09:00");
    expect(clockOf(window!["endTime"], WARSAW)).toBe("Monday 17:00");
  });

  test("an endTime on another day than its endDay is refused, naming the end", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(
        WARSAW_SCHEDULE_ID,
        restriction(
          weeklyValue([
            MONDAY_WARSAW,
            windowOf({
              startDay: "Friday",
              endDay: "Monday",
              startTime: wall("2026-01-09 17:00", WARSAW),
              endTime: wall("2026-01-13 08:00", WARSAW),
            }),
          ]),
        ),
      ),
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain(
      "weeklyRestrictionTimes[1].endTime is 2026-01-13T07:00:00.000Z, a Tuesday in Europe/Warsaw",
    );
    expect(layers.inserts).toHaveLength(0);
  });

  test("the schedule's own zone is the one read: Monday 23:30 UTC is refused as a Monday in Warsaw, taken as one in New York", async () => {
    const write: (scheduleId: string) => JSONObject = (
      scheduleId: string,
    ): JSONObject => {
      return layerWrite(
        scheduleId,
        restriction(
          weeklyValue([
            windowOf({
              startDay: "Monday",
              endDay: "Tuesday",
              startTime: "2026-01-05T23:30:00.000Z",
              endTime: "2026-01-06T13:00:00.000Z",
            }),
          ]),
        ),
      );
    };

    const inWarsaw: SentRequest = await createLayer(write(WARSAW_SCHEDULE_ID));
    expect(inWarsaw.status).toBe(400);
    expect(refusalOf(inWarsaw)).toContain("a Tuesday in Europe/Warsaw");

    const inNewYork: SentRequest = await createLayer(
      write(NEW_YORK_SCHEDULE_ID),
    );
    expect(inNewYork.status).toBe(200);
  });

  test("days left out are filled in from the times, and the answer carries them", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(
        WARSAW_SCHEDULE_ID,
        restriction(
          weeklyValue([
            windowOf({
              startTime: wall("2026-01-09 17:00", WARSAW),
              endTime: wall("2026-01-12 08:00", WARSAW),
            }),
          ]),
        ),
      ),
    );

    expect(sent.status).toBe(200);
    const [window]: Array<JSONObject> = storedWindows(layers.inserts[0]!);
    expect(window!["startDay"]).toBe(DayOfWeek.Friday);
    expect(window!["endDay"]).toBe(DayOfWeek.Monday);

    const answered: JSONObject = (
      (sent.answer as JSONObject)["restrictionTimes"] as JSONObject
    )["value"] as JSONObject;
    const answeredWindow: JSONObject = (
      answered["weeklyRestrictionTimes"] as Array<JSONObject>
    )[0]!;
    expect(answeredWindow["startDay"]).toBe(DayOfWeek.Friday);
    expect(answeredWindow["endDay"]).toBe(DayOfWeek.Monday);
  });

  test("a day that is not a day of the week is refused", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(
        WARSAW_SCHEDULE_ID,
        restriction(
          weeklyValue([
            windowOf({
              startDay: "monday",
              endDay: "Monday",
              startTime: wall("2026-01-05 09:00", WARSAW),
              endTime: wall("2026-01-05 17:00", WARSAW),
            }),
          ]),
        ),
      ),
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      'restrictionTimes.value.weeklyRestrictionTimes[0].startDay is "monday", which is not a day of the week. Write Monday, Tuesday, Wednesday, Thursday, Friday, Saturday or Sunday.',
    );
  });

  test("a schedule without a zone takes a time some zone puts on its day, and refuses one no zone does", async () => {
    // Monday 00:30 in Warsaw, dated there by the Dashboard: Sunday 23:30 UTC.
    const dashboardWrite: SentRequest = await createLayer(
      layerWrite(
        NO_ZONE_SCHEDULE_ID,
        restriction(
          weeklyValue([
            windowOf({
              startDay: "Monday",
              endDay: "Monday",
              startTime: "2026-01-04T23:30:00.000Z",
              endTime: "2026-01-05T07:00:00.000Z",
            }),
          ]),
        ),
      ),
    );
    expect(dashboardWrite.status).toBe(200);

    const datedWrong: SentRequest = await createLayer(
      layerWrite(
        NO_ZONE_SCHEDULE_ID,
        restriction(
          weeklyValue([
            windowOf({
              startDay: "Monday",
              endDay: "Monday",
              startTime: "2026-01-07T13:00:00.000Z",
              endTime: "2026-01-07T16:00:00.000Z",
            }),
          ]),
        ),
      ),
    );
    expect(datedWrong.status).toBe(400);
    expect(refusalOf(datedWrong)).toContain(
      "(the schedule has no time zone), and a Monday in no time zone",
    );
  });

  test("a Daily restriction is held to no days: its weekday never counted", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(
        WARSAW_SCHEDULE_ID,
        restriction({
          restrictionType: "Daily",
          dayRestrictionTimes: {
            startTime: dateTime("2026-01-07T16:00:00.000Z"),
            endTime: dateTime("2026-01-08T06:00:00.000Z"),
          },
        }),
      ),
    );

    expect(sent.status).toBe(200);
  });
});

describe("Terraform writes, as the provider sends them", () => {
  /*
   * The provider's documented example (DocumentationGenerator's
   * getOnCallScheduleLayerExample): one window a day, Monday to Friday,
   * each dated on its weekday, its type under restictionType.
   */
  const TERRAFORM_BUSINESS_HOURS: JSONObject = restriction({
    restictionType: "Weekly",
    weeklyRestrictionTimes: [
      ["Monday", "2026-01-05"],
      ["Tuesday", "2026-01-06"],
      ["Wednesday", "2026-01-07"],
      ["Thursday", "2026-01-08"],
      ["Friday", "2026-01-09"],
    ].map(([day, date]: Array<string>) => {
      return {
        startDay: day,
        endDay: day,
        startTime: { _type: "DateTime", value: `${date}T09:00:00Z` },
        endTime: { _type: "DateTime", value: `${date}T17:00:00Z` },
      };
    }),
  });

  test("the documented example is taken as it is, for the schedule in UTC it is written for", async () => {
    const sent: SentRequest = await createLayer(
      layerWrite(UTC_SCHEDULE_ID, TERRAFORM_BUSINESS_HOURS),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });

    const windows: Array<JSONObject> = storedWindows(layers.inserts[0]!);
    expect(
      windows.map((window: JSONObject) => {
        return [window["startDay"], clockOf(window["startTime"], "UTC")];
      }),
    ).toEqual([
      ["Monday", "Monday 09:00"],
      ["Tuesday", "Tuesday 09:00"],
      ["Wednesday", "Wednesday 09:00"],
      ["Thursday", "Thursday 09:00"],
      ["Friday", "Friday 09:00"],
    ]);
  });

  test("REGRESSION #11455: the example with every window dated on one Wednesday is refused at the first window - it paged only on Wednesdays", async () => {
    const value: JSONObject = TERRAFORM_BUSINESS_HOURS["value"] as JSONObject;
    const sent: SentRequest = await createLayer(
      layerWrite(
        UTC_SCHEDULE_ID,
        restriction({
          ...value,
          weeklyRestrictionTimes: (
            value["weeklyRestrictionTimes"] as Array<JSONObject>
          ).map((window: JSONObject) => {
            return {
              ...window,
              startTime: { _type: "DateTime", value: "2026-01-07T09:00:00Z" },
              endTime: { _type: "DateTime", value: "2026-01-07T17:00:00Z" },
            };
          }),
        }),
      ),
    );

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toBe(
      "restrictionTimes.value.weeklyRestrictionTimes[0].startTime is 2026-01-07T09:00:00.000Z, a Wednesday in UTC, the schedule's time zone, but its startDay is Monday. A window is on call on the days it names: date its startTime on a Monday, such as 2026-01-05T09:00:00.000Z, or set its startDay to Wednesday.",
    );
    expect(layers.inserts).toHaveLength(0);
  });

  test("a re-apply that sends the stored windows back is taken, and changes nothing", async () => {
    const created: SentRequest = await createLayer(
      layerWrite(UTC_SCHEDULE_ID, TERRAFORM_BUSINESS_HOURS),
    );
    expect(created.status).toBe(200);
    const id: string = String(
      ((created.answer as JSONObject)["_id"] as string) ||
        layers.inserts[0]!["_id"],
    );

    const reapplied: SentRequest = await updateLayer(id, {
      name: "Business hours, renamed",
      restrictionTimes: TERRAFORM_BUSINESS_HOURS,
    });

    expect({
      status: reapplied.status,
      refusal: refusalOf(reapplied),
    }).toEqual({ status: 200, refusal: "" });
    expect(
      storedWindows(layers.get(id)!).map((window: JSONObject) => {
        return window["startDay"];
      }),
    ).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  });
});

describe("PUT /api/on-call-duty-schedule-layer/:id: a weekly window's days", () => {
  test("a window changed to one dated on other days than it names is refused, and the layer kept as it was", async () => {
    const sent: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      restrictionTimes: restriction(
        weeklyValue([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: wall("2026-01-07 09:00", WARSAW),
            endTime: wall("2026-01-07 17:00", WARSAW),
          }),
        ]),
      ),
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain(
      "weeklyRestrictionTimes[0].startTime is 2026-01-07T08:00:00.000Z, a Wednesday in Europe/Warsaw",
    );
    expect(layers.updates).toHaveLength(0);
    expect(
      clockOf(
        storedWindows(layers.get(WARSAW_LAYER_ID)!)[0]!["startTime"],
        WARSAW,
      ),
    ).toBe("Monday 09:00");
  });

  test("a Save Layer that sends every window back as stored, with a new name, is taken - even for a layer whose window a change of zone moved before #11455", async () => {
    const sent: SentRequest = await updateLayer(DRIFTED_LAYER_ID, {
      name: "Early Mondays, renamed",
      restrictionTimes: restriction(weeklyValue([DRIFTED_WINDOW])),
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(layers.get(DRIFTED_LAYER_ID)!["name"]).toBe(
      "Early Mondays, renamed",
    );
    // Kept as it pages: from Sunday 19:00 in New York.
    expect(
      clockOf(
        storedWindows(layers.get(DRIFTED_LAYER_ID)!)[0]!["startTime"],
        NEW_YORK,
      ),
    ).toBe("Sunday 19:00");
  });

  test("the same window, touched and still dated on another day, is judged as any write is", async () => {
    const sent: SentRequest = await updateLayer(DRIFTED_LAYER_ID, {
      restrictionTimes: restriction(
        weeklyValue([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: wall("2026-01-05 01:30", WARSAW),
            endTime: wall("2026-01-05 09:00", WARSAW),
          }),
        ]),
      ),
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain("a Sunday in America/New_York");
  });

  test("the days the Dashboard saves it with - the days it pages on - are taken", async () => {
    const sent: SentRequest = await updateLayer(DRIFTED_LAYER_ID, {
      restrictionTimes: restriction(
        weeklyValue([{ ...DRIFTED_WINDOW, startDay: "Sunday" }]),
      ),
    });

    expect(sent.status).toBe(200);
    expect(storedWindows(layers.get(DRIFTED_LAYER_ID)!)[0]!["startDay"]).toBe(
      "Sunday",
    );
  });

  test("a client that read both spellings and changed one, with windows on their days, is taken", async () => {
    const sent: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      restrictionTimes: restriction({
        restrictionType: "Weekly",
        restictionType: "Weekly",
        weeklyRestrictionTimes: [
          windowOf({
            startDay: "Tuesday",
            endDay: "Tuesday",
            startTime: wall("2026-01-06 09:00", WARSAW),
            endTime: wall("2026-01-06 17:00", WARSAW),
          }),
        ],
      }),
    });

    expect(sent.status).toBe(200);
    expect(storedWindows(layers.get(WARSAW_LAYER_ID)!)[0]!["startDay"]).toBe(
      "Tuesday",
    );
  });

  test("an update that leaves the restriction out reads no schedule zone", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleService,
      "findBy",
    );

    const sent: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      name: "Mondays, renamed",
    });

    expect(sent.status).toBe(200);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("PUT /api/on-call-duty-policy-schedule/:id: a new time zone keeps every time on the clock", () => {
  test("Warsaw to New York: each layer's start, hand-off and hours read in New York as they read in Warsaw", async () => {
    const sent: SentRequest = await updateSchedule(WARSAW_SCHEDULE_ID, {
      timezone: NEW_YORK,
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(schedules.get(WARSAW_SCHEDULE_ID)!["timezone"]).toBe(NEW_YORK);

    const mondays: StoredRow = layers.get(WARSAW_LAYER_ID)!;
    expect(
      moment
        .tz(mondays["startsAt"] as Date, NEW_YORK)
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-01-05 09:00");
    expect(
      moment
        .tz(mondays["handOffTime"] as Date, NEW_YORK)
        .format("YYYY-MM-DD HH:mm"),
    ).toBe("2026-01-12 09:00");

    const [window]: Array<JSONObject> = storedWindows(mondays);
    expect(window!["startDay"]).toBe("Monday");
    expect(window!["endDay"]).toBe("Monday");
    expect(clockOf(window!["startTime"], NEW_YORK)).toBe("Monday 09:00");
    expect(clockOf(window!["endTime"], NEW_YORK)).toBe("Monday 17:00");

    const nights: StoredRow = layers.get(WARSAW_NIGHTS_LAYER_ID)!;
    const day: JSONObject = storedValue(nights)[
      "dayRestrictionTimes"
    ] as JSONObject;
    expect(storedValue(nights)["restrictionType"]).toBe(RestrictionType.Daily);
    expect(
      moment
        .tz(RestrictionTimes.readMoment(day["startTime"])!, NEW_YORK)
        .format("HH:mm"),
    ).toBe("17:00");
    expect(
      moment
        .tz(RestrictionTimes.readMoment(day["endTime"])!, NEW_YORK)
        .format("HH:mm"),
    ).toBe("07:00");

    // Who is on call worked out again, once, for the schedule moved.
    expect(rosterRefreshes).toEqual([WARSAW_SCHEDULE_ID]);
  });

  test("the other schedules' layers are left as they are", async () => {
    const before: Date = layers.get(NEW_YORK_LAYER_ID)!["startsAt"] as Date;

    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: NEW_YORK });

    expect((layers.get(NEW_YORK_LAYER_ID)!["startsAt"] as Date).getTime()).toBe(
      before.getTime(),
    );
    expect(
      layers.updates.every((update: { id: string }) => {
        return [WARSAW_LAYER_ID, WARSAW_NIGHTS_LAYER_ID].includes(
          update.id.toString().toLowerCase(),
        );
      }),
    ).toBe(true);
  });

  test("a Save Layer after the change - the layer read again and sent back - is taken, and changes no time", async () => {
    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: NEW_YORK });

    const read: JSONObject = await readLayer(WARSAW_LAYER_ID);
    const before: Array<JSONObject> = storedWindows(
      layers.get(WARSAW_LAYER_ID)!,
    );

    const saved: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      name: "Mondays",
      restrictionTimes: read["restrictionTimes"] as JSONObject,
    });

    expect({ status: saved.status, refusal: refusalOf(saved) }).toEqual({
      status: 200,
      refusal: "",
    });

    const after: Array<JSONObject> = storedWindows(
      layers.get(WARSAW_LAYER_ID)!,
    );
    expect(clockOf(after[0]!["startTime"], NEW_YORK)).toBe(
      clockOf(before[0]!["startTime"], NEW_YORK),
    );
    expect(clockOf(after[0]!["startTime"], NEW_YORK)).toBe("Monday 09:00");
  });

  test("a Save Layer from a page opened before the change, sending the old moments, is judged in the new zone", async () => {
    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: NEW_YORK });

    // Monday 09:00 in Warsaw is Monday 03:00 in New York: still a Monday.
    const stale: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      restrictionTimes: restriction(weeklyValue([MONDAY_WARSAW])),
    });
    expect(stale.status).toBe(200);

    // Monday 01:00 in Warsaw is Sunday 19:00 in New York: refused, named.
    const staleNearMidnight: SentRequest = await updateLayer(WARSAW_LAYER_ID, {
      restrictionTimes: restriction(weeklyValue([DRIFTED_WINDOW])),
    });
    expect(staleNearMidnight.status).toBe(400);
    expect(refusalOf(staleNearMidnight)).toContain(
      "a Sunday in America/New_York",
    );
  });

  test("a near-midnight window keeps its day: Monday 01:00 in New York, moved to Warsaw, stays Monday 01:00", async () => {
    await updateLayer(NEW_YORK_LAYER_ID, {
      restrictionTimes: restriction(
        weeklyValue([
          windowOf({
            startDay: "Monday",
            endDay: "Monday",
            startTime: wall("2026-01-05 01:00", NEW_YORK),
            endTime: wall("2026-01-05 23:30", NEW_YORK),
          }),
        ]),
      ),
    });

    const sent: SentRequest = await updateSchedule(NEW_YORK_SCHEDULE_ID, {
      timezone: WARSAW,
    });
    expect(sent.status).toBe(200);

    const [window]: Array<JSONObject> = storedWindows(
      layers.get(NEW_YORK_LAYER_ID)!,
    );
    expect(clockOf(window!["startTime"], WARSAW)).toBe("Monday 01:00");
    expect(clockOf(window!["endTime"], WARSAW)).toBe("Monday 23:30");
  });

  test("a schedule given its first zone keeps its moments", async () => {
    const before: Array<JSONObject> = [
      ...layers.rows.map((row: StoredRow): JSONObject => {
        return {
          id: String(row["_id"]),
          startsAt: (row["startsAt"] as Date).getTime(),
        };
      }),
    ];

    const sent: SentRequest = await updateSchedule(NO_ZONE_SCHEDULE_ID, {
      timezone: WARSAW,
    });

    expect(sent.status).toBe(200);
    expect(schedules.get(NO_ZONE_SCHEDULE_ID)!["timezone"]).toBe(WARSAW);
    expect(layers.updates).toHaveLength(0);
    expect(rosterRefreshes).toEqual([]);
    expect(
      layers.rows.map((row: StoredRow): JSONObject => {
        return {
          id: String(row["_id"]),
          startsAt: (row["startsAt"] as Date).getTime(),
        };
      }),
    ).toEqual(before);
  });

  test("a schedule's zone taken away keeps its moments", async () => {
    const sent: SentRequest = await updateSchedule(WARSAW_SCHEDULE_ID, {
      timezone: null,
    });

    expect(sent.status).toBe(200);
    expect(layers.updates).toHaveLength(0);
    expect(rosterRefreshes).toEqual([]);
  });

  test("the same zone under another name moves nothing", async () => {
    await updateSchedule(NEW_YORK_SCHEDULE_ID, {
      timezone: "US/Eastern",
    });

    expect(layers.updates).toHaveLength(0);
    expect(rosterRefreshes).toEqual([]);
  });

  test("a zone nobody knows moves nothing", async () => {
    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: "Mars/Olympus_Mons" });

    expect(layers.updates).toHaveLength(0);
  });

  test("an update that leaves the zone out moves nothing", async () => {
    const sent: SentRequest = await updateSchedule(WARSAW_SCHEDULE_ID, {
      description: "Our on-call",
    });

    expect(sent.status).toBe(200);
    expect(layers.updates).toHaveLength(0);
  });

  test("moved to New York and back to Warsaw, every time is where it began", async () => {
    const before: Array<string> = [WARSAW_LAYER_ID, WARSAW_NIGHTS_LAYER_ID].map(
      (id: string) => {
        const row: StoredRow = layers.get(id)!;
        return JSON.stringify({
          startsAt: (row["startsAt"] as Date).getTime(),
          handOffTime: (row["handOffTime"] as Date).getTime(),
          restriction: storedValue(row),
        });
      },
    );

    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: NEW_YORK });
    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: WARSAW });

    const after: Array<string> = [WARSAW_LAYER_ID, WARSAW_NIGHTS_LAYER_ID].map(
      (id: string) => {
        const row: StoredRow = layers.get(id)!;
        return JSON.stringify({
          startsAt: new Date(row["startsAt"] as Date).getTime(),
          handOffTime: new Date(row["handOffTime"] as Date).getTime(),
          restriction: storedValue(row),
        });
      },
    );

    expect(after).toEqual(before);
  });

  test("the moved windows are stored as the engine reads them: each on its days in the new zone", async () => {
    await updateSchedule(WARSAW_SCHEDULE_ID, { timezone: NEW_YORK });

    const moved: RestrictionTimes = RestrictionTimes.fromJSON(
      restriction(storedValue(layers.get(WARSAW_LAYER_ID)!)),
    );

    for (const window of moved.weeklyRestrictionTimes as Array<WeeklyResctriction>) {
      expect(
        moment
          .tz(RestrictionTimes.readMoment(window.startTime)!, NEW_YORK)
          .format("dddd"),
      ).toBe(window.startDay);
      expect(
        moment
          .tz(RestrictionTimes.readMoment(window.endTime)!, NEW_YORK)
          .format("dddd"),
      ).toBe(window.endDay);
    }
  });
});
