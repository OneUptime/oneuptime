/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service extends)
 * imports it. Nothing password-related is under test here.
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
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import BrowserType from "../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "../../../Types/ObjectID";
import {
  SYNTHETIC_STEP_NO_BROWSER_MESSAGE,
  SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE,
} from "../../../Utils/Monitor/SyntheticMonitorStepsUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * A Synthetic monitor step that lists no browser or no screen size runs
 * nothing and never fails. The Dashboard refuses one before it sends it;
 * the server now refuses one too, from any caller - the API, Terraform, MCP
 * or a workflow - on a monitor and on a template (whose steps every monitor
 * made or synced from it takes).
 *
 * What a write is checked against is the steps and the type it leaves: the
 * steps it sends, else the stored ones, under the type it sends, else the
 * stored one. A write of neither - a rename, a label - is never refused for
 * steps stored before this check existed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

function syntheticStepsJSON(lists: {
  browserTypes?: Array<string>;
  screenSizeTypes?: Array<string>;
}): JSONObject {
  const value: JSONObject = {
    id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
    customCode: "await page.goto('https://shop.example.com');",
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: [
          {
            _type: "MonitorCriteriaInstance",
            value: {
              id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
              name: "Check if the journey fails",
              filterCondition: "Any",
              filters: [{ checkOn: "Error", filterType: "Is Not Empty" }],
              incidents: [],
              alerts: [],
            },
          },
        ],
      },
    },
  };

  if (lists.browserTypes) {
    value["browserTypes"] = lists.browserTypes;
  }

  if (lists.screenSizeTypes) {
    value["screenSizeTypes"] = lists.screenSizeTypes;
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [{ _type: "MonitorStep", value: value }],
      defaultMonitorStatusId: OPERATIONAL_STATUS_ID.toString(),
    },
  };
}

const RUNS: JSONObject = syntheticStepsJSON({
  browserTypes: [BrowserType.Chromium],
  screenSizeTypes: [ScreenSizeType.Desktop],
});
const NO_BROWSER: JSONObject = syntheticStepsJSON({
  browserTypes: [],
  screenSizeTypes: [ScreenSizeType.Desktop],
});
const NO_SCREEN_SIZE: JSONObject = syntheticStepsJSON({
  browserTypes: [BrowserType.Firefox],
});

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
  stubRowsCallerMayWrite(MonitorTemplateService, () => {
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

async function createMonitor(data: {
  monitorType: MonitorType;
  monitorSteps: JSONObject;
}): Promise<OnCreate<Monitor>> {
  const monitor: Monitor = new Monitor();
  monitor.name = "Checkout journey";
  monitor.monitorType = data.monitorType;
  monitor.monitorSteps = MonitorSteps.fromJSON(data.monitorSteps);

  return await (
    MonitorService as unknown as {
      onBeforeCreate: (c: CreateBy<Monitor>) => Promise<OnCreate<Monitor>>;
    }
  ).onBeforeCreate({ data: monitor, props: { tenantId: PROJECT_ID } });
}

async function updateMonitor(data: {
  write: Record<string, unknown>;
  stored: { monitorType: MonitorType; monitorSteps: JSONObject };
}): Promise<OnUpdate<Monitor>> {
  const row: Monitor = new Monitor();
  row.id = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorType = data.stored.monitorType;
  row.monitorSteps = MonitorSteps.fromJSON(data.stored.monitorSteps);
  storedRows = [row];

  const updateBy: UpdateBy<Monitor> = {
    query: { _id: MONITOR_ID.toString() } as never,
    data: data.write as never,
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

async function createTemplate(data: {
  monitorType: MonitorType;
  monitorSteps: JSONObject;
}): Promise<OnCreate<MonitorTemplate>> {
  const template: MonitorTemplate = new MonitorTemplate();
  template.templateName = "Checkout journey";
  template.monitorType = data.monitorType;
  template.monitorSteps = MonitorSteps.fromJSON(data.monitorSteps);

  return await (
    MonitorTemplateService as unknown as {
      onBeforeCreate: (
        c: CreateBy<MonitorTemplate>,
      ) => Promise<OnCreate<MonitorTemplate>>;
    }
  ).onBeforeCreate({ data: template, props: { tenantId: PROJECT_ID } });
}

async function updateTemplate(data: {
  write: Record<string, unknown>;
  stored: { monitorType: MonitorType; monitorSteps: JSONObject };
}): Promise<OnUpdate<MonitorTemplate>> {
  const row: MonitorTemplate = new MonitorTemplate();
  row.id = MONITOR_ID;
  row.projectId = PROJECT_ID;
  row.monitorType = data.stored.monitorType;
  row.monitorSteps = MonitorSteps.fromJSON(data.stored.monitorSteps);
  storedRows = [row];

  return await (
    MonitorTemplateService as unknown as {
      onBeforeUpdate: (
        u: UpdateBy<MonitorTemplate>,
      ) => Promise<OnUpdate<MonitorTemplate>>;
    }
  ).onBeforeUpdate({
    query: { _id: MONITOR_ID.toString() } as never,
    data: data.write as never,
    limit: 1,
    skip: 0,
    props: { tenantId: PROJECT_ID },
  });
}

describe("a Synthetic monitor is refused steps that run nothing", () => {
  test("on create: no browser", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: NO_BROWSER,
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test("on create: no screen size", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: NO_SCREEN_SIZE,
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE);
  });

  test("on create: a step that runs somewhere is kept as sent", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      monitorType: MonitorType.SyntheticMonitor,
      monitorSteps: RUNS,
    });
    const step: { browserTypes?: unknown; screenSizeTypes?: unknown } = result
      .createBy.data.monitorSteps!.data!.monitorStepsInstanceArray[0]!
      .data! as never;

    expect(step.browserTypes).toEqual([BrowserType.Chromium]);
    expect(step.screenSizeTypes).toEqual([ScreenSizeType.Desktop]);
  });

  test("on create: another type's steps need no browser", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.CustomJavaScriptCode,
        monitorSteps: NO_BROWSER,
      }),
    ).resolves.toBeDefined();
  });

  test("on update: steps sent without a browser are refused", async () => {
    await expect(
      updateMonitor({
        write: { monitorSteps: MonitorSteps.fromJSON(NO_BROWSER) },
        stored: {
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: RUNS,
        },
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test("on update: steps sent that run somewhere repair a monitor stored without", async () => {
    await expect(
      updateMonitor({
        write: { monitorSteps: MonitorSteps.fromJSON(RUNS) },
        stored: {
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: NO_SCREEN_SIZE,
        },
      }),
    ).resolves.toBeDefined();
  });

  test("on update: a rename is never refused for steps stored before the check", async () => {
    await expect(
      updateMonitor({
        write: { name: "Checkout journey (EU)" },
        stored: {
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: NO_BROWSER,
        },
      }),
    ).resolves.toBeDefined();
  });

  test("on update: turning a monitor Synthetic over steps that run nothing is refused", async () => {
    await expect(
      updateMonitor({
        write: { monitorType: MonitorType.SyntheticMonitor },
        stored: {
          monitorType: MonitorType.CustomJavaScriptCode,
          monitorSteps: NO_BROWSER,
        },
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test("on update: another type's steps need no browser", async () => {
    await expect(
      updateMonitor({
        write: { monitorSteps: MonitorSteps.fromJSON(NO_BROWSER) },
        stored: {
          monitorType: MonitorType.CustomJavaScriptCode,
          monitorSteps: RUNS,
        },
      }),
    ).resolves.toBeDefined();
  });

  /*
   * Turning a Synthetic monitor into another type leaves steps nothing runs
   * in a browser: nothing to judge, and no monitor is read for it.
   */
  test("on update: turning a Synthetic monitor into another type is never refused, and reads no monitor", async () => {
    // The findBy stub of beforeEach, which every read of a monitor goes through.
    const findBy: {
      mock: { calls: Array<Array<FindByArgs>> };
      mockClear: () => void;
    } = (
      DatabaseService.prototype as unknown as {
        findBy: {
          mock: { calls: Array<Array<FindByArgs>> };
          mockClear: () => void;
        };
      }
    ).findBy;
    findBy.mockClear();

    await expect(
      updateMonitor({
        write: { monitorType: MonitorType.Manual },
        stored: {
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: NO_BROWSER,
        },
      }),
    ).resolves.toBeDefined();

    expect(
      findBy.mock.calls.filter((call: Array<FindByArgs>): boolean => {
        return Boolean(call[0]?.select?.["monitorSteps"]);
      }),
    ).toHaveLength(0);
  });
});

describe("a Synthetic monitor template is refused steps that run nothing", () => {
  test("on create", async () => {
    await expect(
      createTemplate({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: NO_SCREEN_SIZE,
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE);

    await expect(
      createTemplate({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: RUNS,
      }),
    ).resolves.toBeDefined();
  });

  test("on update: the steps sent", async () => {
    await expect(
      updateTemplate({
        write: { monitorSteps: MonitorSteps.fromJSON(NO_BROWSER) },
        stored: {
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: RUNS,
        },
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test("on update: a type sent over stored steps that run nothing", async () => {
    await expect(
      updateTemplate({
        write: { monitorType: MonitorType.SyntheticMonitor },
        stored: {
          monitorType: MonitorType.CustomJavaScriptCode,
          monitorSteps: NO_SCREEN_SIZE,
        },
      }),
    ).rejects.toThrow(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE);
  });

  test("on update: another type's template needs no browser", async () => {
    await expect(
      updateTemplate({
        write: { monitorSteps: MonitorSteps.fromJSON(NO_BROWSER) },
        stored: {
          monitorType: MonitorType.CustomJavaScriptCode,
          monitorSteps: RUNS,
        },
      }),
    ).resolves.toBeDefined();
  });
});
