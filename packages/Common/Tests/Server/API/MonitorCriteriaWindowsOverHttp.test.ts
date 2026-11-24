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

jest.mock("isolated-vm", () => {
  return {};
});

import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import InfrastructureResourceBinding from "../../../Server/Utils/Monitor/InfrastructureResourceBinding";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
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

/*
 * #10355 over HTTP: a monitor's criteria with a window that counts its
 * checks, a percentile, a recovery condition of its own and active hours,
 * written through PUT /api/monitor/:id as the Dashboard and the API send
 * them, and read back through the monitor's own read - for who may edit a
 * monitor, refused for who may only read one, and refused for values no
 * check reads. The routes are the server's own; the rows are in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10355000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "10355000-0000-4000-8000-0000000000a1";
const OPERATIONAL_STATUS_ID: string = "10355000-0000-4000-8000-0000000000b1";
const DEGRADED_STATUS_ID: string = "10355000-0000-4000-8000-0000000000b2";

// The status the server refuses a write it cannot read with (BadDataException).
const BAD_DATA: number = 400;

const FLAPPING: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 60,
    evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
    countFilterType: FilterType.GreaterThan,
    countValue: 5,
  },
};

const SLOW_P95: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 300,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 10,
    evaluateOverTimeType: EvaluateOverTimeType.Percentile,
    percentile: 95,
  },
};

const STEADY_FOR_AN_HOUR: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 60,
    evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
    countFilterType: FilterType.LessThanOrEqualTo,
    countValue: 1,
  },
};

const OFFICE_HOURS: JSONObject = WorkingHours.fromSimpleHours({
  days: [0, 1, 2, 3, 4],
  from: "08:00",
  to: "18:00",
  timezone: "Europe/Oslo",
}).toJSON();

function unstableCriteria(
  overrides: Partial<NonNullable<MonitorCriteriaInstance["data"]>> = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: "access-point-unstable",
    monitorStatusId: new ObjectID(DEGRADED_STATUS_ID),
    filterCondition: FilterCondition.Any,
    filters: [FLAPPING, SLOW_P95],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Access point is unstable",
    description: "",
    recoveryFilters: [STEADY_FOR_AN_HOUR],
    recoveryFilterCondition: FilterCondition.All,
    activeHours: OFFICE_HOURS,
    activeHoursTimezone: "Europe/Oslo",
    ...overrides,
  };

  return instance;
}

// A Ping monitor's steps, as the Dashboard sends them: one step, one criteria.
function stepsWith(criteria: MonitorCriteriaInstance): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "step-1",
            monitorDestination: "10.0.0.20",
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [criteria.toJSON()],
              },
            },
          },
        },
      ],
      defaultMonitorStatusId: {
        _type: "ObjectID",
        value: OPERATIONAL_STATUS_ID,
      },
    },
  };
}

const STORED_STEPS: JSONObject = stepsWith(
  unstableCriteria({
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
      },
    ],
    recoveryFilters: undefined,
    recoveryFilterCondition: undefined,
    activeHours: undefined,
    activeHoursTimezone: undefined,
  }),
);

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let monitors: InMemoryTable;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

async function writeSteps(monitorSteps: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `/api/monitor/${MONITOR_ID}`, {
    data: { monitorSteps: monitorSteps },
  });
}

// The criteria the monitor's own read answers, as the Dashboard parses them.
async function readCriteria(): Promise<{
  sent: SentRequest;
  criteria: MonitorCriteriaInstance | undefined;
}> {
  const sent: SentRequest = await server.request(
    "POST",
    "/api/monitor/get-list",
    {
      query: { _id: { _type: "Includes", value: [MONITOR_ID] } },
      select: { _id: true, monitorType: true, monitorSteps: true },
      limit: 1,
      skip: 0,
    },
  );
  const data: Array<JSONObject> = ((sent.answer as JSONObject)?.["data"] ||
    []) as Array<JSONObject>;
  const stored: unknown = data[0]?.["monitorSteps"];

  if (!stored) {
    return { sent: sent, criteria: undefined };
  }

  const steps: MonitorSteps = MonitorSteps.fromJSON(stored as JSONObject);

  return {
    sent: sent,
    criteria:
      steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
        .monitorCriteriaInstanceArray[0],
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([new MonitorAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectMember]);

  stubProjectDirectory({});
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  monitors = useInMemoryTable(
    MonitorService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: MONITOR_ID,
        projectId: PROJECT_ID.toString(),
        name: "Office access point",
        monitorType: MonitorType.Ping,
        isArchived: false,
        labels: [],
        monitorSteps: STORED_STEPS,
      },
    ],
    { answersOnlySelectedColumns: true },
  );

  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation(async (): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status.id = new ObjectID(OPERATIONAL_STATUS_ID);
      return status;
    });

  // Reference ownership is pinned by its own suite.
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);

  // An infrastructure step's resource binding is pinned by its own suite.
  jest
    .spyOn(InfrastructureResourceBinding, "bindMonitorSteps")
    .mockResolvedValue(false);

  // What a write of steps sets off after it is stored has suites of its own.
  jest
    .spyOn(MonitorProbeService, "pruneStaleLastMonitoringLogEntries")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT /api/monitor/:id, then the monitor's own read", () => {
  test("a member's write keeps every count, percentile, recovery condition and active hours as sent", async () => {
    const written: SentRequest = await writeSteps(
      stepsWith(unstableCriteria()),
    );

    expect({ status: written.status, refusal: refusalOf(written) }).toEqual({
      status: 200,
      refusal: "",
    });

    const { sent, criteria } = await readCriteria();

    expect(sent.status).toBe(200);
    expect(criteria?.data?.filters).toEqual([FLAPPING, SLOW_P95]);
    expect(criteria?.data?.recoveryFilters).toEqual([STEADY_FOR_AN_HOUR]);
    expect(criteria?.data?.recoveryFilterCondition).toBe(FilterCondition.All);
    expect(criteria?.data?.activeHoursTimezone).toBe("Europe/Oslo");
    expect(
      WorkingHours.toSimpleHours({
        hours: criteria?.data?.activeHours,
        timezone: "Europe/Oslo",
      }),
    ).toEqual({ days: [0, 1, 2, 3, 4], from: "08:00", to: "18:00" });
    expect(MonitorCriteriaInstance.hasRecoveryCondition(criteria?.data)).toBe(
      true,
    );
  });

  test("a count sent as an API caller writes it, its number a digit string, is read as a number", async () => {
    const written: SentRequest = await writeSteps(
      stepsWith(
        unstableCriteria({
          filters: [
            {
              ...FLAPPING,
              evaluateOverTimeOptions: {
                ...FLAPPING.evaluateOverTimeOptions!,
                evaluateOverTimeType: "flapping" as EvaluateOverTimeType,
                countValue: "5" as unknown as number,
              },
            },
          ],
        }),
      ),
    );

    expect(written.status).toBe(200);

    const { criteria } = await readCriteria();

    expect(criteria?.data?.filters[0]?.evaluateOverTimeOptions).toEqual(
      FLAPPING.evaluateOverTimeOptions,
    );
  });

  test("a viewer's write is refused, and the steps stay as they were", async () => {
    caller = callerWith([Permission.Viewer]);

    const written: SentRequest = await writeSteps(
      stepsWith(unstableCriteria()),
    );

    expect(written.status).not.toBe(200);
    expect(refusalOf(written)).not.toBe("");

    caller = callerWith([Permission.ProjectMember]);

    const { criteria } = await readCriteria();

    expect(criteria?.data?.recoveryFilters).toBeUndefined();
    expect(criteria?.data?.activeHours).toBeUndefined();
    expect(monitors.rows.length).toBe(1);
  });

  test("a viewer reads the criteria a member wrote", async () => {
    await writeSteps(stepsWith(unstableCriteria()));

    caller = callerWith([Permission.Viewer]);

    const { sent, criteria } = await readCriteria();

    expect(sent.status).toBe(200);
    expect(criteria?.data?.recoveryFilters).toEqual([STEADY_FOR_AN_HOUR]);
  });

  test.each([
    [
      "a percentile of 100 or more",
      unstableCriteria({
        filters: [
          {
            ...SLOW_P95,
            evaluateOverTimeOptions: {
              ...SLOW_P95.evaluateOverTimeOptions!,
              percentile: 150,
            },
          },
        ],
      }),
      /percentile/i,
    ],
    [
      "a count compared by a condition that is not a comparison",
      unstableCriteria({
        filters: [
          {
            ...FLAPPING,
            evaluateOverTimeOptions: {
              ...FLAPPING.evaluateOverTimeOptions!,
              countFilterType: FilterType.Contains,
            },
          },
        ],
      }),
      /Contains/,
    ],
    [
      "a recovery filter with a condition that means none",
      unstableCriteria({
        recoveryFilters: [
          { ...STEADY_FOR_AN_HOUR, filterType: "kinda" as FilterType },
        ],
      }),
      /recoveryFilters\[0\]\.filterType "kinda"/,
    ],
    [
      "active hours in a time zone nobody knows",
      unstableCriteria({ activeHoursTimezone: "Atlantis/Lost_City" }),
      /time zone/,
    ],
  ])(
    "refuses %s, and keeps the steps stored",
    async (_name: string, criteria: MonitorCriteriaInstance, says: RegExp) => {
      const written: SentRequest = await writeSteps(stepsWith(criteria));

      expect(written.status).toBe(BAD_DATA);
      expect(refusalOf(written)).toMatch(says);

      const { criteria: stored } = await readCriteria();

      expect(stored?.data?.recoveryFilters).toBeUndefined();
      expect(stored?.data?.filters).toEqual([
        { checkOn: CheckOn.IsOnline, filterType: FilterType.False },
      ]);
    },
  );
});
