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
import InfrastructureResourceBinding from "../../../Server/Utils/Monitor/InfrastructureResourceBinding";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MonitorStepsValuesUtil from "../../../Utils/Monitor/MonitorStepsValuesUtil";
import { mcpWrittenMetricMonitorSteps } from "../../Helpers/McpWrittenMetricMonitor";
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
 * A MONITOR'S STEPS ARE STORED WITH VALUES ITS CHECKS READ.
 *
 * A Metrics monitor an AI created through the MCP server was stored with
 * its rolling time as "15 minutes" and its conditions as "GreaterThan" and
 * "LessThanOrEqual": every check read a window of no length and opened its
 * no-data alert, and its conditions could never match a value. The server
 * now stores a value written another way as the one it means, and refuses
 * one that means none - from any caller: the API, MCP, a workflow - on a
 * monitor and on a template (whose steps every monitor made or synced
 * from it takes).
 *
 * What a write is checked against is the steps it leaves: a write of no
 * steps - a rename, a label - is never refused for steps stored before.
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

// The MCP-written steps, with one of the alerting filter's values changed.
const withAlertingFilter: (
  changes: JSONObject,
  rollingTime?: unknown,
) => JSONObject = (changes: JSONObject, rollingTime?: unknown): JSONObject => {
  const steps: JSONObject = mcpWrittenMetricMonitorSteps(rollingTime);
  const step: JSONObject = (
    (steps["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
  const criteria: Array<JSONObject> = (
    (step["monitorCriteria"] as JSONObject)["value"] as JSONObject
  )["monitorCriteriaInstanceArray"] as Array<JSONObject>;
  const alerting: JSONObject = criteria[1]!["value"] as JSONObject;
  const filter: JSONObject = (alerting["filters"] as Array<JSONObject>)[0]!;

  Object.assign(filter, changes);

  return steps;
};

// A Kubernetes monitor's steps, with the rolling time asked for.
const kubernetesSteps: (rollingTime: unknown) => JSONObject = (
  rollingTime: unknown,
): JSONObject => {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
                      name: "Pods restarting",
                      filterCondition: "Any",
                      filters: [
                        {
                          checkOn: "Metric Value",
                          filterType: "Greater Than",
                          value: 3,
                          metricMonitorOptions: { metricAlias: "a" },
                        },
                      ],
                      incidents: [],
                      alerts: [],
                    },
                  },
                ],
              },
            },
            kubernetesMonitor: {
              clusterIdentifier: "prod-cluster",
              rollingTime: rollingTime as string,
              metricViewConfig: {
                queryConfigs: [
                  {
                    metricAliasData: { metricVariable: "a" },
                    metricQueryData: {
                      filterData: { metricName: "k8s.container.restarts" },
                    },
                  },
                ],
                formulaConfigs: [],
              },
            },
          },
        },
      ],
      defaultMonitorStatusId: OPERATIONAL_STATUS_ID.toString(),
    },
  };
};

const ROLLING_TIME_MEANS_NONE: RegExp =
  /^metricMonitor\.rollingTime "fortnight" is not a rolling time\. Use one of "Past 1 Minute", .* or "Past 365 Days" - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M"\.$/;

const CONDITION_MEANS_NONE: RegExp =
  /^Criteria "Shop web \| HTTP 5xx": filters\[0\]\.filterType "GreaterThn" is not a value OneUptime reads there\. Use one of "Equal To", .* or "Forecast Below"\.$/;

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

  // An infrastructure step's resource binding is pinned by its own suite.
  jest
    .spyOn(InfrastructureResourceBinding, "bindMonitorSteps")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createMonitor(data: {
  monitorType: MonitorType;
  monitorSteps: JSONObject;
  // As an API caller's body is read: parsed. A workflow may hand JSON.
  asJSON?: boolean;
}): Promise<OnCreate<Monitor>> {
  const monitor: Monitor = new Monitor();
  monitor.name = "Shop web | HTTP 5xx";
  monitor.monitorType = data.monitorType;
  monitor.monitorSteps = data.asJSON
    ? (data.monitorSteps as unknown as MonitorSteps)
    : MonitorSteps.fromJSON(data.monitorSteps);

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
  template.templateName = "Shop web | HTTP 5xx";
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

// The first step of steps as a write leaves them, and its criteria.
function firstStep(monitorSteps: unknown): {
  step: MonitorStep;
  criteria: Array<MonitorCriteriaInstance>;
} {
  const step: MonitorStep = MonitorSteps.fromJSON(
    monitorSteps as MonitorSteps | JSONObject,
  ).data!.monitorStepsInstanceArray[0]!;

  return {
    step,
    criteria: step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray,
  };
}

// What the write leaves stored: the steps as the database is handed them.
function storedStep(monitorSteps: unknown): JSONObject {
  const stored: JSONObject = (monitorSteps as MonitorSteps).toJSON();

  return (
    (stored["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
}

describe("a monitor written through the MCP server, with values written another way", () => {
  test("on create: is stored with the values they mean", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      monitorType: MonitorType.Metrics,
      monitorSteps: mcpWrittenMetricMonitorSteps(),
    });

    const stored: JSONObject = storedStep(result.createBy.data.monitorSteps);

    expect((stored["metricMonitor"] as JSONObject)["rollingTime"]).toBe(
      RollingTime.Past15Minutes,
    );

    const { criteria } = firstStep(result.createBy.data.monitorSteps);

    expect(criteria[0]!.data!.filters[0]!.filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
    expect(criteria[1]!.data!.filters[0]!.filterType).toBe(
      FilterType.GreaterThan,
    );
  });

  test("on create: steps handed as JSON are stored the same", async () => {
    const result: OnCreate<Monitor> = await createMonitor({
      monitorType: MonitorType.Metrics,
      monitorSteps: withAlertingFilter({ filterType: ">" }, "PT15M"),
      asJSON: true,
    });

    const { step, criteria } = firstStep(result.createBy.data.monitorSteps);

    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(criteria[1]!.data!.filters[0]!.filterType).toBe(
      FilterType.GreaterThan,
    );
  });

  test("on update: is stored with the values they mean", async () => {
    const result: OnUpdate<Monitor> = await updateMonitor({
      write: {
        monitorSteps: MonitorSteps.fromJSON(mcpWrittenMetricMonitorSteps()),
      },
      stored: {
        monitorType: MonitorType.Metrics,
        monitorSteps: mcpWrittenMetricMonitorSteps(RollingTime.Past5Minutes),
      },
    });

    const { step, criteria } = firstStep(result.updateBy.data.monitorSteps);

    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(criteria[1]!.data!.filterCondition).toBe(FilterCondition.Any);
    expect(criteria[1]!.data!.filters[0]!.filterType).toBe(
      FilterType.GreaterThan,
    );
  });
});

describe("a monitor is refused steps with values its checks cannot read", () => {
  test("on create: a rolling time that means none", async () => {
    const write: Promise<OnCreate<Monitor>> = createMonitor({
      monitorType: MonitorType.Metrics,
      monitorSteps: mcpWrittenMetricMonitorSteps("fortnight"),
    });

    await expect(write).rejects.toThrow(BadDataException);
    await expect(write).rejects.toThrow(ROLLING_TIME_MEANS_NONE);
  });

  test("on create: a condition that means none", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.Metrics,
        monitorSteps: withAlertingFilter({ filterType: "GreaterThn" }),
      }),
    ).rejects.toThrow(CONDITION_MEANS_NONE);
  });

  test("on create: a check, an aggregation or a no-data policy that means none", async () => {
    for (const [changes, path] of [
      [{ checkOn: "Metric Valu" }, "filters[0].checkOn"],
      [
        {
          metricMonitorOptions: {
            metricAlias: "m1",
            metricAggregationType: "Median",
          },
        },
        "filters[0].metricMonitorOptions.metricAggregationType",
      ],
      [
        { metricMonitorOptions: { metricAlias: "m1", onNoDataPolicy: "Page" } },
        "filters[0].metricMonitorOptions.onNoDataPolicy",
      ],
    ] as Array<[JSONObject, string]>) {
      await expect(
        createMonitor({
          monitorType: MonitorType.Metrics,
          monitorSteps: withAlertingFilter(changes),
        }),
      ).rejects.toThrow(`Criteria "Shop web | HTTP 5xx": ${path} `);
    }
  });

  test("on create: an infrastructure monitor's rolling time that means none", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.Kubernetes,
        monitorSteps: kubernetesSteps("fortnight"),
      }),
    ).rejects.toThrow(
      'kubernetesMonitor.rollingTime "fortnight" is not a rolling time',
    );

    const result: OnCreate<Monitor> = await createMonitor({
      monitorType: MonitorType.Kubernetes,
      monitorSteps: kubernetesSteps("last 15 minutes"),
    });

    expect(
      (
        storedStep(result.createBy.data.monitorSteps)[
          "kubernetesMonitor"
        ] as JSONObject
      )["rollingTime"],
    ).toBe(RollingTime.Past15Minutes);
  });

  test("on create: another type's settings are not its own, and are not read", async () => {
    await expect(
      createMonitor({
        monitorType: MonitorType.Kubernetes,
        monitorSteps: ((): JSONObject => {
          const steps: JSONObject = kubernetesSteps(RollingTime.Past5Minutes);
          const step: JSONObject = (
            (steps["value"] as JSONObject)[
              "monitorStepsInstanceArray"
            ] as Array<JSONObject>
          )[0]!["value"] as JSONObject;
          step["metricMonitor"] = {
            rollingTime: "fortnight",
            metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
          };
          return steps;
        })(),
      }),
    ).resolves.toBeDefined();
  });

  test("on update: steps sent with a rolling time that means none", async () => {
    await expect(
      updateMonitor({
        write: {
          monitorSteps: MonitorSteps.fromJSON(
            mcpWrittenMetricMonitorSteps("fortnight"),
          ),
        },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps(),
        },
      }),
    ).rejects.toThrow(ROLLING_TIME_MEANS_NONE);
  });

  test("on update: steps sent as JSON with a condition that means none", async () => {
    await expect(
      updateMonitor({
        write: {
          monitorSteps: withAlertingFilter({ filterType: "GreaterThn" }),
        },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps(),
        },
      }),
    ).rejects.toThrow(CONDITION_MEANS_NONE);
  });

  test("on update: steps stored that way before are refused once they are written again", async () => {
    await expect(
      updateMonitor({
        write: {
          monitorSteps: MonitorSteps.fromJSON(
            mcpWrittenMetricMonitorSteps("fortnight"),
          ),
        },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps("fortnight"),
        },
      }),
    ).rejects.toThrow(ROLLING_TIME_MEANS_NONE);
  });

  test("on update: the steps are read under the type the write leaves", async () => {
    // Turned into a Kubernetes monitor: its Kubernetes rolling time is read.
    await expect(
      updateMonitor({
        write: {
          monitorType: MonitorType.Kubernetes,
          monitorSteps: MonitorSteps.fromJSON(kubernetesSteps("fortnight")),
        },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps(),
        },
      }),
    ).rejects.toThrow(
      'kubernetesMonitor.rollingTime "fortnight" is not a rolling time',
    );

    // A write of steps alone: under the type stored.
    await expect(
      updateMonitor({
        write: {
          monitorSteps: MonitorSteps.fromJSON(kubernetesSteps("fortnight")),
        },
        stored: {
          monitorType: MonitorType.Kubernetes,
          monitorSteps: kubernetesSteps(RollingTime.Past5Minutes),
        },
      }),
    ).rejects.toThrow(
      'kubernetesMonitor.rollingTime "fortnight" is not a rolling time',
    );
  });

  test("on update: a write of no steps is never refused for steps stored before", async () => {
    await expect(
      updateMonitor({
        write: { name: "Shop web | HTTP 5xx (EU)" },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: withAlertingFilter(
            { filterType: "GreaterThn" },
            "fortnight",
          ),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("a monitor template is refused steps with values its checks cannot read", () => {
  test("on create", async () => {
    await expect(
      createTemplate({
        monitorType: MonitorType.Metrics,
        monitorSteps: mcpWrittenMetricMonitorSteps("fortnight"),
      }),
    ).rejects.toThrow(ROLLING_TIME_MEANS_NONE);

    await expect(
      createTemplate({
        monitorType: MonitorType.Metrics,
        monitorSteps: withAlertingFilter({ filterType: "GreaterThn" }),
      }),
    ).rejects.toThrow(CONDITION_MEANS_NONE);

    const result: OnCreate<MonitorTemplate> = await createTemplate({
      monitorType: MonitorType.Metrics,
      monitorSteps: mcpWrittenMetricMonitorSteps(),
    });

    expect(
      firstStep(result.createBy.data.monitorSteps).step.data!.metricMonitor!
        .rollingTime,
    ).toBe(RollingTime.Past15Minutes);
  });

  test("on update: the steps sent", async () => {
    await expect(
      updateTemplate({
        write: {
          monitorSteps: MonitorSteps.fromJSON(
            mcpWrittenMetricMonitorSteps("fortnight"),
          ),
        },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps(),
        },
      }),
    ).rejects.toThrow(ROLLING_TIME_MEANS_NONE);

    const result: OnUpdate<MonitorTemplate> = await updateTemplate({
      write: {
        monitorSteps: MonitorSteps.fromJSON(mcpWrittenMetricMonitorSteps()),
      },
      stored: {
        monitorType: MonitorType.Metrics,
        monitorSteps: mcpWrittenMetricMonitorSteps(RollingTime.Past1Hour),
      },
    });

    expect(
      firstStep(result.updateBy.data.monitorSteps).step.data!.metricMonitor!
        .rollingTime,
    ).toBe(RollingTime.Past15Minutes);
  });

  test("on update: a write of no steps is never refused for steps stored before", async () => {
    await expect(
      updateTemplate({
        write: { templateName: "Shop web | HTTP 5xx (EU)" },
        stored: {
          monitorType: MonitorType.Metrics,
          monitorSteps: mcpWrittenMetricMonitorSteps("fortnight"),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("MonitorStepsValuesUtil.getUnreadableValueError", () => {
  test("reads steps parsed or as JSON, and says nothing of none", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Metrics,
        monitorSteps: mcpWrittenMetricMonitorSteps("fortnight"),
      }),
    ).toMatch(ROLLING_TIME_MEANS_NONE);
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Metrics,
        monitorSteps: MonitorSteps.fromJSON(
          mcpWrittenMetricMonitorSteps("fortnight"),
        ),
      }),
    ).toMatch(ROLLING_TIME_MEANS_NONE);

    for (const monitorSteps of [undefined, null]) {
      expect(
        MonitorStepsValuesUtil.getUnreadableValueError({
          monitorType: MonitorType.Metrics,
          monitorSteps,
        }),
      ).toBeNull();
    }
  });

  test("says nothing of steps that cannot be read at all: their shape is refused where they are parsed", () => {
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Metrics,
        monitorSteps: { _type: "Something else" },
      }),
    ).toBeNull();
  });

  test("reads the criteria of every monitor type, the rolling time only of its own", () => {
    const steps: JSONObject = withAlertingFilter(
      { filterType: "GreaterThn" },
      "fortnight",
    );

    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.API,
        monitorSteps: steps,
      }),
    ).toMatch(CONDITION_MEANS_NONE);
    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Metrics,
        monitorSteps: steps,
      }),
    ).toMatch(ROLLING_TIME_MEANS_NONE);
  });

  test("reads every step, not only the first", () => {
    const steps: JSONObject = mcpWrittenMetricMonitorSteps();
    const second: JSONObject = (
      (mcpWrittenMetricMonitorSteps("fortnight")["value"] as JSONObject)[
        "monitorStepsInstanceArray"
      ] as Array<JSONObject>
    )[0]!;
    ((second["value"] as JSONObject)["id"] as unknown) =
      "7b2f2d5e-3c1a-4e0f-9a51-1f0e4c2b9d33";
    (
      (steps["value"] as JSONObject)[
        "monitorStepsInstanceArray"
      ] as Array<JSONObject>
    ).push(second);

    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.Metrics,
        monitorSteps: steps,
      }),
    ).toMatch(ROLLING_TIME_MEANS_NONE);
  });
});
