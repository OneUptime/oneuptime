import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleLayerService, {
  Service as OnCallDutyPolicyScheduleLayerServiceType,
} from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ScheduleLayerChanges from "../../../Server/Utils/OnCall/ScheduleLayerChanges";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
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
 * THE LAYER API, WITH EITHER SPELLING OF THE RESTRICTION TYPE (#11269),
 * OVER HTTP.
 *
 * The issue's own request - POST /api/on-call-duty-schedule-layer with
 * "restrictionType": "None" - was answered 200, and the layer stored with
 * the key the engine never read, so the layer put nobody on call. Through
 * the real API router, the real layer service and its hooks, over an
 * in-memory table:
 *
 *   - either spelling is taken, and stored under restrictionType alone;
 *   - every read answers both, for clients and Terraform configurations of
 *     either;
 *   - a write that names no type, or one the engine does not know, or two
 *     that disagree, or a Daily window of "09:00", or a rotation of
 *     "Weekly", is refused with a 400 that names the key - and nothing is
 *     written;
 *   - an update whose two spellings disagree, from a client that read the
 *     layer and changed the spelling it knows, takes the one it changed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11269000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "11269000-0000-4000-8000-000000000002",
);
const LAYER_ID: string = "11269000-0000-4000-8000-000000000003";

const ROUTE: string = "/api/on-call-duty-schedule-layer";

function dateTime(iso: string): JSONObject {
  return { _type: ObjectType.DateTime, value: iso };
}

function restriction(value: JSONObject): JSONObject {
  return { _type: ObjectType.RestrictionTimes, value: value };
}

const WEEKLY_ROTATION: JSONObject = {
  _type: ObjectType.Recurring,
  value: {
    intervalType: "Week",
    intervalCount: { _type: ObjectType.PositiveNumber, value: 1 },
  },
};

const NIGHTS: JSONObject = {
  startTime: dateTime("2026-01-05T16:00:00.000Z"),
  endTime: dateTime("2026-01-06T06:00:00.000Z"),
};

// The issue's request, as its curl sent it.
function issueLayer(restrictionTimes: JSONObject): JSONObject {
  return {
    name: "Primary rotation",
    onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
    startsAt: dateTime("2026-11-23T08:00:00.000Z"),
    handOffTime: dateTime("2026-11-30T08:00:00.000Z"),
    rotation: WEEKLY_ROTATION,
    restrictionTimes: restrictionTimes,
  };
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let layers: InMemoryTable;

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

// The restriction a stored row holds, as written to the table.
function storedValue(row: StoredRow): JSONObject {
  const stored: unknown = row["restrictionTimes"];
  const json: JSONObject =
    stored instanceof RestrictionTimes
      ? stored.toDatabaseJSON()
      : (stored as JSONObject);
  return json["value"] as JSONObject;
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
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
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

  // The schedule is the project's: pinned by ProjectReferenceCheck's suites.
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

  layers = useInMemoryTable(
    OnCallDutyPolicyScheduleLayerService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: LAYER_ID,
        projectId: PROJECT_ID.toString(),
        onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
        name: "Nights",
        order: 1,
        startsAt: new Date("2026-11-23T08:00:00.000Z"),
        handOffTime: new Date("2026-11-30T08:00:00.000Z"),
        rotation: WEEKLY_ROTATION,
        /*
         * As stored before #11269 - the older spelling alone - and as the
         * column's transformer hands it to the service, as TypeORM does.
         */
        restrictionTimes: (
          RestrictionTimes.getDatabaseTransformer() as unknown as {
            from: (value: JSONObject) => RestrictionTimes;
          }
        ).from(
          restriction({
            restictionType: "None",
            dayRestrictionTimes: null,
            weeklyRestrictionTimes: [],
          }),
        ),
      },
    ],
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(data: JSONObject): Promise<SentRequest> {
  return await server.request("POST", ROUTE, { data: data });
}

async function update(data: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `${ROUTE}/${LAYER_ID}`, { data: data });
}

describe("POST /api/on-call-duty-schedule-layer", () => {
  test("REGRESSION #11269: the issue's request, with restrictionType, is stored as None, under restrictionType", async () => {
    const sent: SentRequest = await create(
      issueLayer(
        restriction({
          restrictionType: "None",
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [],
        }),
      ),
    );

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(layers.inserts).toHaveLength(1);

    const value: JSONObject = storedValue(layers.inserts[0]!);
    expect(value["restrictionType"]).toBe(RestrictionType.None);
    expect("restictionType" in value).toBe(false);

    // What the engine reads from the row: None - not "no type", which paged nobody.
    expect(
      RestrictionTimes.fromJSON(
        layers.inserts[0]!["restrictionTimes"] as JSONObject,
      ).restrictionType,
    ).toBe(RestrictionType.None);
  });

  test("the older spelling is taken as it always was, and stored under the name", async () => {
    const sent: SentRequest = await create(
      issueLayer(
        restriction({ restictionType: "Daily", dayRestrictionTimes: NIGHTS }),
      ),
    );

    expect(sent.status).toBe(200);
    const value: JSONObject = storedValue(layers.inserts[0]!);
    expect(value["restrictionType"]).toBe(RestrictionType.Daily);
    expect("restictionType" in value).toBe(false);
  });

  test("the answer to a create carries both spellings", async () => {
    const sent: SentRequest = await create(
      issueLayer(
        restriction({ restrictionType: "Daily", dayRestrictionTimes: NIGHTS }),
      ),
    );

    const answered: JSONObject = (((sent.answer as JSONObject)[
      "restrictionTimes"
    ] as JSONObject) || {})["value"] as JSONObject;

    expect(answered["restrictionType"]).toBe(RestrictionType.Daily);
    expect(answered["restictionType"]).toBe(RestrictionType.Daily);
  });

  test("no restriction times at all: on call around the clock, as before (#4995)", async () => {
    const data: JSONObject = issueLayer({});
    delete data["restrictionTimes"];

    const sent: SentRequest = await create(data);

    expect(sent.status).toBe(200);
    expect(storedValue(layers.inserts[0]!)["restrictionType"]).toBe(
      RestrictionType.None,
    );
  });

  const refused: Array<{ name: string; data: JSONObject; refusal: string }> = [
    {
      name: "no type, the type under another key",
      data: issueLayer(
        restriction({ restriction_type: "None", dayRestrictionTimes: null }),
      ),
      refusal: "restrictionTimes.value.restrictionType is missing",
    },
    {
      name: "a type the engine does not know",
      data: issueLayer(restriction({ restrictionType: "Always" })),
      refusal:
        'restrictionTimes.value.restrictionType is "Always", which is not a restriction type',
    },
    {
      name: "two spellings that disagree",
      data: issueLayer(
        restriction({
          restrictionType: "Daily",
          restictionType: "None",
          dayRestrictionTimes: NIGHTS,
        }),
      ),
      refusal: 'restrictionType is "Daily" and restictionType is "None"',
    },
    {
      name: "a Daily window of times of day alone",
      data: issueLayer(
        restriction({
          restrictionType: "Daily",
          dayRestrictionTimes: { startTime: "09:00", endTime: "17:00" },
        }),
      ),
      refusal: 'dayRestrictionTimes.startTime is "09:00"',
    },
    {
      name: "a Daily restriction with no window",
      data: issueLayer(restriction({ restrictionType: "Daily" })),
      refusal: "A Daily restriction needs",
    },
    {
      name: 'a rotation of "Weekly"',
      data: {
        ...issueLayer(restriction({ restrictionType: "None" })),
        rotation: {
          _type: ObjectType.Recurring,
          value: { intervalType: "Weekly", intervalCount: 1 },
        },
      },
      refusal: 'rotation.value.intervalType is "Weekly"',
    },
  ];

  for (const refusal of refused) {
    test(`refused, naming the key, and nothing written: ${refusal.name}`, async () => {
      const sent: SentRequest = await create(refusal.data);

      expect(sent.status).toBe(400);
      expect(refusalOf(sent)).toContain(refusal.refusal);
      expect(layers.inserts).toHaveLength(0);
    });
  }
});

describe("PUT /api/on-call-duty-schedule-layer/:id", () => {
  test("the natural spelling changes the layer's type, stored under its name", async () => {
    const sent: SentRequest = await update({
      restrictionTimes: restriction({
        restrictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
      }),
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });

    const value: JSONObject = storedValue(layers.get(LAYER_ID)!);
    expect(value["restrictionType"]).toBe(RestrictionType.Daily);
    expect("restictionType" in value).toBe(false);
  });

  test("a client that read the layer and changed the older spelling: its change is taken", async () => {
    // It read both "None" and changed restictionType to Daily.
    const sent: SentRequest = await update({
      restrictionTimes: restriction({
        restrictionType: "None",
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
      }),
    });

    expect(sent.status).toBe(200);
    expect(storedValue(layers.get(LAYER_ID)!)["restrictionType"]).toBe(
      RestrictionType.Daily,
    );
  });

  test("a client that read the layer and changed restrictionType: its change is taken", async () => {
    const sent: SentRequest = await update({
      restrictionTimes: restriction({
        restrictionType: "Daily",
        restictionType: "None",
        dayRestrictionTimes: NIGHTS,
      }),
    });

    expect(sent.status).toBe(200);
    expect(storedValue(layers.get(LAYER_ID)!)["restrictionType"]).toBe(
      RestrictionType.Daily,
    );
  });

  test("two spellings, neither the layer's type: refused, and the layer kept as it was", async () => {
    const sent: SentRequest = await update({
      restrictionTimes: restriction({
        restrictionType: "Daily",
        restictionType: "Weekly",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [],
      }),
    });

    expect(sent.status).toBe(400);
    expect(refusalOf(sent)).toContain("Send restrictionType alone");
    expect(storedValue(layers.get(LAYER_ID)!)["restrictionType"]).toBe(
      RestrictionType.None,
    );
    expect(layers.updates).toHaveLength(0);
  });

  test("an update that changes neither rotation nor restriction reads neither", async () => {
    const sent: SentRequest = await update({ name: "Nights, renamed" });

    expect(sent.status).toBe(200);
    expect(layers.get(LAYER_ID)!["name"]).toBe("Nights, renamed");
  });
});

describe("reading a layer", () => {
  test("a layer stored with the older spelling is read with both", async () => {
    const sent: SentRequest = await server.request(
      "POST",
      `${ROUTE}/get-list`,
      {
        query: {},
        select: { _id: true, restrictionTimes: true },
        limit: 10,
        skip: 0,
      },
    );

    expect(sent.status).toBe(200);
    const data: Array<JSONObject> = ((sent.answer as JSONObject)["data"] ||
      []) as Array<JSONObject>;
    const value: JSONObject = (data[0]!["restrictionTimes"] as JSONObject)[
      "value"
    ] as JSONObject;

    expect(value["restrictionType"]).toBe(RestrictionType.None);
    expect(value["restictionType"]).toBe(RestrictionType.None);
  });
});
