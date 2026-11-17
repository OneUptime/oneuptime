/*
 * A MONITOR IS REFUSED MORE STEPS THAN THE LIMIT, ON EVERY WRITE.
 *
 * A probe runs and reports every step of a monitor. The dashboard checks the
 * number of steps (MonitorSteps.getValidationError), but a request made
 * straight to the API never ran that check: one free project sent "Test
 * monitor" runs of up to 5,000 steps each, and the step reports held up
 * every project's probe results for hours. The server now refuses a monitor
 * whose steps are past MAX_MONITOR_STEPS when it is created and when its
 * steps are written, and leaves every other update alone.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
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

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    IsBillingEnabled: false,
  };
});

import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { MAX_MONITOR_STEPS } from "../../../Types/Monitor/MonitorStepLimit";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

// `count` Ping steps, as the API receives a monitor's steps.
function pingStepsJSON(count: number): JSONObject {
  const steps: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    steps.push({
      _type: "MonitorStep",
      value: {
        id: ObjectID.generate().toString(),
        monitorDestination: {
          _type: "Hostname",
          value: `host-${index}.example.com`,
        },
        monitorCriteria: {
          _type: "MonitorCriteria",
          value: { monitorCriteriaInstanceArray: [] },
        },
      },
    });
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: steps,
      defaultMonitorStatusId: OPERATIONAL_STATUS_ID.toString(),
    },
  };
}

type FindByArgs = {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
};

let storedRows: Array<DatabaseBaseModel> = [];

beforeEach(() => {
  storedRows = [];

  jest
    .spyOn(
      DatabaseService.prototype as unknown as {
        findBy: (args: FindByArgs) => Promise<Array<DatabaseBaseModel>>;
      },
      "findBy",
    )
    .mockImplementation(() => {
      return Promise.resolve(storedRows);
    });

  stubRowsCallerMayWrite(MonitorService, () => {
    return storedRows;
  });

  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation(async (): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status.id = OPERATIONAL_STATUS_ID;
      return status;
    });

  jest
    .spyOn(MonitorStatusService, "findDefaultOperationalStatusId")
    .mockResolvedValue(OPERATIONAL_STATUS_ID);

  jest
    .spyOn(MonitorStatusService, "findDefaultOperationalStatusIdOrNull")
    .mockResolvedValue(OPERATIONAL_STATUS_ID);

  // Reference ownership is pinned by its own suite.
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createMonitor(stepCount: number): Promise<OnCreate<Monitor>> {
  const monitor: Monitor = new Monitor();
  monitor.name = "Edge hosts";
  monitor.monitorType = MonitorType.Ping;
  monitor.monitorSteps = MonitorSteps.fromJSON(pingStepsJSON(stepCount));

  return await (
    MonitorService as unknown as {
      onBeforeCreate: (c: CreateBy<Monitor>) => Promise<OnCreate<Monitor>>;
    }
  ).onBeforeCreate({ data: monitor, props: { tenantId: PROJECT_ID } });
}

async function updateMonitor(
  write: Record<string, unknown>,
): Promise<OnUpdate<Monitor>> {
  const row: Monitor = new Monitor();
  row.id = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorType = MonitorType.Ping;
  row.monitorSteps = MonitorSteps.fromJSON(pingStepsJSON(1));
  storedRows = [row];

  const updateBy: UpdateBy<Monitor> = {
    query: { _id: MONITOR_ID.toString() } as never,
    data: write as never,
    limit: 1,
    skip: 0,
    props: { tenantId: PROJECT_ID },
  };

  return await (
    MonitorService as unknown as {
      onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
    }
  ).onBeforeUpdate(updateBy);
}

describe("a monitor is refused more steps than the limit", () => {
  test("on create", async () => {
    await expect(createMonitor(MAX_MONITOR_STEPS + 1)).rejects.toThrow(
      BadDataException,
    );
    await expect(createMonitor(5000)).rejects.toThrow(
      "at most 100 steps, and this one has 5000",
    );
  });

  test("on an update that writes its steps, as a MonitorSteps", async () => {
    await expect(
      updateMonitor({
        monitorSteps: MonitorSteps.fromJSON(
          pingStepsJSON(MAX_MONITOR_STEPS + 1),
        ),
      }),
    ).rejects.toThrow(`this one has ${MAX_MONITOR_STEPS + 1}`);
  });

  test("on an update that writes its steps as JSON, as the API may", async () => {
    await expect(
      updateMonitor({ monitorSteps: pingStepsJSON(MAX_MONITOR_STEPS + 1) }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("and nothing else changes", () => {
  test("a monitor up to the limit is created", async () => {
    await expect(createMonitor(MAX_MONITOR_STEPS)).resolves.toBeDefined();
  });

  test("its steps up to the limit are written", async () => {
    await expect(
      updateMonitor({
        monitorSteps: MonitorSteps.fromJSON(pingStepsJSON(MAX_MONITOR_STEPS)),
      }),
    ).resolves.toBeDefined();
  });

  test("an update that does not write its steps is not asked about them", async () => {
    await expect(updateMonitor({ name: "Renamed" })).resolves.toBeDefined();
  });
});
