/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service, including
 * MonitorService, extends) imports it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
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
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
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

/*
 * What a monitor written by the Terraform provider goes through on the way to
 * the database. The provider sends monitorSteps with no ids at all; the hooks
 * must give it ids on create, and keep those ids on every later update that
 * resends the steps - the customer report behind this was "No check has
 * completed yet" on a monitor whose probes reported every minute, and
 * incidents that never auto-resolved.
 */

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OFFLINE_STATUS_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// monitorSteps exactly as the provider's MonitorStepsToAPI sends them.
function terraformMonitorStepsJSON(): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            monitorDestination: {
              _type: "URL",
              value: "https://npr.example.com/health",
            },
            requestType: "GET",
            retryCount: 2,
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      name: "Check if NPR is offline",
                      filterCondition: "Any",
                      filters: [{ checkOn: "Is Online", filterType: "False" }],
                      changeMonitorStatus: true,
                      monitorStatusId: OFFLINE_STATUS_ID,
                      createIncidents: true,
                      incidents: [
                        {
                          title: "NPR is offline",
                          description: "NPR is currently offline.",
                          autoResolveIncident: true,
                        },
                      ],
                    },
                  },
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      name: "Check if NPR is online",
                      filterCondition: "All",
                      filters: [{ checkOn: "Is Online", filterType: "True" }],
                      changeMonitorStatus: true,
                      monitorStatusId: OPERATIONAL_STATUS_ID.toString(),
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

interface IdSnapshot {
  stepId: string;
  criteriaIds: Array<string>;
  incidentTemplateId: string;
}

function idsOf(monitorSteps: MonitorSteps): IdSnapshot {
  const step: MonitorStep = monitorSteps.data!.monitorStepsInstanceArray[0]!;
  const criteria: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    stepId: step.data!.id,
    criteriaIds: criteria.map((item: MonitorCriteriaInstance) => {
      return item.data!.id;
    }),
    incidentTemplateId: criteria[0]!.data!.incidents[0]!.id,
  };
}

// A round trip through the database column, as the next request reads it.
function stored(monitorSteps: MonitorSteps): MonitorSteps {
  return MonitorSteps.fromJSON(
    JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject,
  );
}

type FindByArgs = {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
};

let storedRows: Array<DatabaseBaseModel> = [];
let findBySpy: SpyLike;
let operationalLookupSpy: SpyLike;

beforeEach(() => {
  storedRows = [];

  findBySpy = jest
    .spyOn(
      DatabaseService.prototype as unknown as {
        findBy: (args: FindByArgs) => Promise<Array<DatabaseBaseModel>>;
      },
      "findBy",
    )
    .mockImplementation(() => {
      return Promise.resolve(storedRows);
    }) as unknown as SpyLike;

  /*
   * The read of the rows the caller's update may write, which the update
   * path makes before the hooks: the rows stored.
   */
  stubRowsCallerMayWrite(MonitorService, () => {
    return storedRows;
  });
  stubRowsCallerMayWrite(MonitorTemplateService, () => {
    return storedRows;
  });

  // The status a new monitor starts in (MonitorService.onBeforeCreate).
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation(async (): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status.id = OPERATIONAL_STATUS_ID;
      return status;
    });

  operationalLookupSpy = jest
    .spyOn(MonitorStatusService, "findDefaultOperationalStatusId")
    .mockResolvedValue(OPERATIONAL_STATUS_ID) as unknown as SpyLike;

  // Reference ownership is pinned by its own suite.
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createMonitor(monitorSteps: JSONObject): Promise<MonitorSteps> {
  const monitor: Monitor = new Monitor();
  monitor.name = "Brightstar NPR";
  monitor.monitorType = MonitorType.Website;
  monitor.monitorSteps = MonitorSteps.fromJSON(monitorSteps);

  const createBy: CreateBy<Monitor> = {
    data: monitor,
    props: { tenantId: PROJECT_ID },
  };

  const result: OnCreate<Monitor> = await (
    MonitorService as unknown as {
      onBeforeCreate: (c: CreateBy<Monitor>) => Promise<OnCreate<Monitor>>;
    }
  ).onBeforeCreate(createBy);

  return result.createBy.data.monitorSteps!;
}

async function updateMonitor(input: {
  monitorSteps: JSONObject;
  storedMonitorSteps: MonitorSteps | undefined;
  matchedRows?: number;
}): Promise<MonitorSteps> {
  const rowCount: number = input.matchedRows ?? 1;
  storedRows = [];

  for (let index: number = 0; index < rowCount; index++) {
    const row: Monitor = new Monitor();
    row.id = index === 0 ? MONITOR_ID : ObjectID.generate();
    row.projectId = PROJECT_ID;
    row.monitorType = MonitorType.Website;
    if (input.storedMonitorSteps) {
      row.monitorSteps = stored(input.storedMonitorSteps);
    }
    storedRows.push(row);
  }

  const updateBy: UpdateBy<Monitor> = {
    query: { _id: MONITOR_ID.toString() } as never,
    // As BaseAPI.updateItem hands it over: the wire JSON, deserialized.
    data: {
      monitorSteps: MonitorSteps.fromJSON(input.monitorSteps),
    } as never,
    limit: 1,
    skip: 0,
    props: { tenantId: PROJECT_ID },
  };

  const result: OnUpdate<Monitor> = await (
    MonitorService as unknown as {
      onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
    }
  ).onBeforeUpdate(updateBy);

  return (result.updateBy.data as unknown as { monitorSteps: MonitorSteps })
    .monitorSteps;
}

describe("MonitorService gives the ids inside monitorSteps", () => {
  test("on create: the step, every criteria and every template get an id", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );
    const ids: IdSnapshot = idsOf(created);

    expect(ids.stepId).toMatch(UUID_PATTERN);
    expect(ids.incidentTemplateId).toMatch(UUID_PATTERN);
    for (const id of ids.criteriaIds) {
      expect(id).toMatch(UUID_PATTERN);
    }
  });

  test("on create: a probe files its results under a real step id", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );

    expect(created.data!.monitorStepsInstanceArray[0]!.id.toString()).not.toBe(
      "",
    );
  });

  test("on create: steps without a default status get the operational one", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );

    expect(created.data!.defaultMonitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
  });

  test("on update: a terraform apply that resends the steps keeps every id", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );
    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: terraformMonitorStepsJSON(),
      storedMonitorSteps: created,
    });

    expect(idsOf(updated)).toEqual(idsOf(created));
  });

  test("on update: the stored default status is kept", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );
    created.data!.defaultMonitorStatusId = new ObjectID(OFFLINE_STATUS_ID);

    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: terraformMonitorStepsJSON(),
      storedMonitorSteps: created,
    });

    expect(updated.data!.defaultMonitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(operationalLookupSpy.mock.calls).toHaveLength(0);
  });

  test("on update: a monitor stored without ids (written before this fix) gets them", async () => {
    const legacy: MonitorSteps = MonitorSteps.fromJSON(
      terraformMonitorStepsJSON(),
    );
    legacy.data!.monitorStepsInstanceArray[0]!.data!.id =
      undefined as unknown as string;

    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: terraformMonitorStepsJSON(),
      storedMonitorSteps: legacy,
    });
    const ids: IdSnapshot = idsOf(updated);

    expect(ids.stepId).toMatch(UUID_PATTERN);
    expect(ids.incidentTemplateId).toMatch(UUID_PATTERN);
    expect(updated.data!.defaultMonitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
  });

  test("on update: a failed default-status lookup leaves the default unset, not the write failed", async () => {
    jest
      .spyOn(MonitorStatusService, "findDefaultOperationalStatusId")
      .mockRejectedValue(new Error("Database not connected"));

    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: terraformMonitorStepsJSON(),
      storedMonitorSteps: MonitorSteps.fromJSON(terraformMonitorStepsJSON()),
    });

    expect(operationalLookupSpy.mock.calls).toHaveLength(1);
    expect(updated.data!.defaultMonitorStatusId).toBeUndefined();
    expect(idsOf(updated).stepId).toMatch(UUID_PATTERN);
  });

  test("on a bulk update: missing ids are filled, without borrowing any one monitor's", async () => {
    const created: MonitorSteps = await createMonitor(
      terraformMonitorStepsJSON(),
    );
    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: terraformMonitorStepsJSON(),
      storedMonitorSteps: created,
      matchedRows: 2,
    });
    const ids: IdSnapshot = idsOf(updated);

    expect(ids.stepId).toMatch(UUID_PATTERN);
    expect(ids.stepId).not.toBe(idsOf(created).stepId);
  });

  test("an update that does not write monitorSteps leaves them alone", async () => {
    storedRows = [];

    const updateBy: UpdateBy<Monitor> = {
      query: { _id: MONITOR_ID.toString() } as never,
      data: { minimumProbeAgreement: 1 } as never,
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    };

    const result: OnUpdate<Monitor> = await (
      MonitorService as unknown as {
        onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
      }
    ).onBeforeUpdate(updateBy);

    expect(
      (result.updateBy.data as unknown as Record<string, unknown>)[
        "monitorSteps"
      ],
    ).toBeUndefined();
    expect(findBySpy.mock.calls).toHaveLength(0);
  });
});

describe("MonitorTemplateService gives the ids inside monitorSteps", () => {
  async function createTemplate(
    monitorSteps: JSONObject,
  ): Promise<MonitorSteps> {
    const template: MonitorTemplate = new MonitorTemplate();
    template.templateName = "NPR template";
    template.monitorType = MonitorType.Website;
    template.monitorSteps = MonitorSteps.fromJSON(monitorSteps);

    const result: OnCreate<MonitorTemplate> = await (
      MonitorTemplateService as unknown as {
        onBeforeCreate: (
          c: CreateBy<MonitorTemplate>,
        ) => Promise<OnCreate<MonitorTemplate>>;
      }
    ).onBeforeCreate({
      data: template,
      props: { tenantId: PROJECT_ID },
    });

    return result.createBy.data.monitorSteps!;
  }

  test("on create and on a resend, as for a monitor", async () => {
    const created: MonitorSteps = await createTemplate(
      terraformMonitorStepsJSON(),
    );

    expect(idsOf(created).stepId).toMatch(UUID_PATTERN);
    expect(created.data!.defaultMonitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );

    const row: MonitorTemplate = new MonitorTemplate();
    row._id = MONITOR_ID.toString();
    row.projectId = PROJECT_ID;
    row.monitorType = MonitorType.Website;
    row.monitorSteps = stored(created);
    storedRows = [row];

    const result: OnUpdate<MonitorTemplate> = await (
      MonitorTemplateService as unknown as {
        onBeforeUpdate: (
          u: UpdateBy<MonitorTemplate>,
        ) => Promise<OnUpdate<MonitorTemplate>>;
      }
    ).onBeforeUpdate({
      query: { _id: MONITOR_ID.toString() } as never,
      data: {
        monitorSteps: MonitorSteps.fromJSON(terraformMonitorStepsJSON()),
      } as never,
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    const updated: MonitorSteps = (
      result.updateBy.data as unknown as { monitorSteps: MonitorSteps }
    ).monitorSteps;

    expect(idsOf(updated)).toEqual(idsOf(created));
  });
});
