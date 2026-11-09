/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service, including
 * MonitorService, extends) imports it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
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
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { getAzureStoredMetricName } from "../../../Types/Cloud/CloudKeyMetrics";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
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
 * A Metrics monitor written by the API or the Terraform provider, whose
 * queries name no aggregation, on a Service Bus or Event Hubs namespace
 * (#6460). The worker reads a query with no aggregation with the average,
 * which since the namespace's metrics are split by queue (#6415) is the
 * average queue. The monitor form defaults such a query to the catalog's
 * aggregation; so do the write hooks, for every other writer: a count of
 * the namespace reads its Sum, and messages waiting too while the monitor
 * reads its window by the minute (up to 3 hours). An aggregation the
 * writer named is kept, and so is the average of every metric that does
 * not add up. Which queries take which aggregation is pinned in Common's
 * MetricQueryCloudAggregation suite; this pins that the hooks apply it to
 * what is stored, on create and on update, for monitors and templates.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const OFFLINE_STATUS_ID: string = "6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

const SHOP: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/shop";

const MESSAGES_IN: string = getAzureStoredMetricName(
  "IncomingMessages",
  "total",
);
const MESSAGES_WAITING: string = getAzureStoredMetricName(
  "ActiveMessages",
  "average",
);
const SEND_LATENCY: string = getAzureStoredMetricName(
  "ServerSendLatency",
  "average",
);

interface QuerySpec {
  variable: string;
  metricName: string;
  aggregationType?: AggregationType | undefined;
}

/*
 * A Metrics step as an API client writes it: the query's metric and the
 * namespace's filter, an aggregation only where the spec names one, and no
 * ids.
 */
function apiStepJSON(
  queries: Array<QuerySpec>,
  rollingTime: RollingTime,
  aggregatesWholeWindow: boolean = false,
): JSONObject {
  return {
    _type: "MonitorStep",
    value: {
      metricMonitor: {
        rollingTime,
        ...(aggregatesWholeWindow ? { aggregatesWholeWindow: true } : {}),
        metricViewConfig: {
          queryConfigs: queries.map((spec: QuerySpec): JSONObject => {
            return {
              metricAliasData: { metricVariable: spec.variable },
              metricQueryData: {
                filterData: {
                  metricName: spec.metricName,
                  attributes: { "azuremonitor.resource_id": SHOP },
                  ...(spec.aggregationType
                    ? { aggegationType: spec.aggregationType }
                    : {}),
                },
              },
            };
          }),
          formulaConfigs: [],
        },
      },
      monitorCriteria: {
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: [
            {
              _type: "MonitorCriteriaInstance",
              value: {
                name: "Backlog",
                filterCondition: "Any",
                filters: [
                  {
                    checkOn: "Metric Value",
                    filterType: "Greater Than",
                    value: 500,
                    metricMonitorOptions: {
                      metricAggregationType: "Average",
                      metricAlias: queries[0]?.variable,
                    },
                  },
                ],
                changeMonitorStatus: true,
                monitorStatusId: OFFLINE_STATUS_ID,
              },
            },
          ],
        },
      },
    },
  };
}

function apiStepsJSON(steps: Array<JSONObject>): JSONObject {
  return {
    _type: "MonitorSteps",
    value: { monitorStepsInstanceArray: steps },
  };
}

// What each query of each step reads with, as stored.
function aggregationsOf(monitorSteps: MonitorSteps): Array<Array<unknown>> {
  return monitorSteps.data!.monitorStepsInstanceArray.map(
    (step: MonitorStep): Array<unknown> => {
      return (
        step.data?.metricMonitor?.metricViewConfig.queryConfigs || []
      ).map((config: MetricQueryConfigData): unknown => {
        return config.metricQueryData.filterData.aggegationType;
      });
    },
  );
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

  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createMonitor(monitorSteps: JSONObject): Promise<MonitorSteps> {
  const monitor: Monitor = new Monitor();
  monitor.name = "shop backlog";
  monitor.monitorType = MonitorType.Metrics;
  monitor.monitorSteps = MonitorSteps.fromJSON(monitorSteps);

  const result: OnCreate<Monitor> = await (
    MonitorService as unknown as {
      onBeforeCreate: (c: CreateBy<Monitor>) => Promise<OnCreate<Monitor>>;
    }
  ).onBeforeCreate({ data: monitor, props: { tenantId: PROJECT_ID } });

  return stored(result.createBy.data.monitorSteps!);
}

async function updateMonitor(input: {
  monitorSteps: JSONObject;
  storedMonitorSteps: MonitorSteps | undefined;
  matchedRows?: number;
}): Promise<MonitorSteps> {
  storedRows = [];

  for (let index: number = 0; index < (input.matchedRows ?? 1); index++) {
    const row: Monitor = new Monitor();
    row.id = index === 0 ? MONITOR_ID : ObjectID.generate();
    row.projectId = PROJECT_ID;
    row.monitorType = MonitorType.Metrics;
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

  return stored(
    (result.updateBy.data as unknown as { monitorSteps: MonitorSteps })
      .monitorSteps,
  );
}

describe("a Metrics monitor written without an aggregation reads its namespace's total", () => {
  test("on create: a count reads its Sum, messages waiting over an hour too, a latency its average", async () => {
    const created: MonitorSteps = await createMonitor(
      apiStepsJSON([
        apiStepJSON(
          [
            { variable: "incoming", metricName: MESSAGES_IN },
            { variable: "waiting", metricName: MESSAGES_WAITING },
            { variable: "latency", metricName: SEND_LATENCY },
          ],
          RollingTime.Past1Hour,
        ),
      ]),
    );

    expect(aggregationsOf(created)).toEqual([
      [AggregationType.Sum, AggregationType.Sum, undefined],
    ]);
  });

  test("on create: past 3 hours messages waiting are left to the average, as no Sum of them is an amount held", async () => {
    const created: MonitorSteps = await createMonitor(
      apiStepsJSON([
        apiStepJSON(
          [
            { variable: "incoming", metricName: MESSAGES_IN },
            { variable: "waiting", metricName: MESSAGES_WAITING },
          ],
          RollingTime.Past6Hours,
        ),
        apiStepJSON(
          [
            { variable: "incoming", metricName: MESSAGES_IN },
            { variable: "waiting", metricName: MESSAGES_WAITING },
          ],
          RollingTime.Past15Minutes,
          true,
        ),
      ]),
    );

    expect(aggregationsOf(created)).toEqual([
      [AggregationType.Sum, undefined],
      [AggregationType.Sum, undefined],
    ]);
  });

  test("on create: an aggregation the writer named is kept, the average included", async () => {
    const created: MonitorSteps = await createMonitor(
      apiStepsJSON([
        apiStepJSON(
          [
            {
              variable: "incoming",
              metricName: MESSAGES_IN,
              aggregationType: AggregationType.Avg,
            },
            {
              variable: "waiting",
              metricName: MESSAGES_WAITING,
              aggregationType: AggregationType.Max,
            },
          ],
          RollingTime.Past15Minutes,
        ),
      ]),
    );

    expect(aggregationsOf(created)).toEqual([
      [AggregationType.Avg, AggregationType.Max],
    ]);
  });

  test("on update: a Terraform apply that resends the steps without one gets the same, and a second apply changes nothing", async () => {
    const sent: () => JSONObject = (): JSONObject => {
      return apiStepsJSON([
        apiStepJSON(
          [{ variable: "incoming", metricName: MESSAGES_IN }],
          RollingTime.Past15Minutes,
        ),
      ]);
    };
    const created: MonitorSteps = await createMonitor(sent());
    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: sent(),
      storedMonitorSteps: created,
    });

    expect(aggregationsOf(updated)).toEqual([[AggregationType.Sum]]);
    expect(updated.toJSON()).toEqual(created.toJSON());
  });

  test("on update: a monitor stored with the average, resent with none, reads the namespace's Sum", async () => {
    const before: MonitorSteps = await createMonitor(
      apiStepsJSON([
        apiStepJSON(
          [
            {
              variable: "incoming",
              metricName: MESSAGES_IN,
              aggregationType: AggregationType.Avg,
            },
          ],
          RollingTime.Past15Minutes,
        ),
      ]),
    );
    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: apiStepsJSON([
        apiStepJSON(
          [{ variable: "incoming", metricName: MESSAGES_IN }],
          RollingTime.Past15Minutes,
        ),
      ]),
      storedMonitorSteps: before,
    });

    expect(aggregationsOf(updated)).toEqual([[AggregationType.Sum]]);
  });

  test("on a bulk update over two monitors, too", async () => {
    const updated: MonitorSteps = await updateMonitor({
      monitorSteps: apiStepsJSON([
        apiStepJSON(
          [{ variable: "waiting", metricName: MESSAGES_WAITING }],
          RollingTime.Past3Hours,
        ),
      ]),
      storedMonitorSteps: undefined,
      matchedRows: 2,
    });

    expect(aggregationsOf(updated)).toEqual([[AggregationType.Sum]]);
  });

  test("an update that does not write monitorSteps writes none", async () => {
    const result: OnUpdate<Monitor> = await (
      MonitorService as unknown as {
        onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
      }
    ).onBeforeUpdate({
      query: { _id: MONITOR_ID.toString() } as never,
      data: { name: "renamed" } as never,
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    expect(
      (result.updateBy.data as unknown as Record<string, unknown>)[
        "monitorSteps"
      ],
    ).toBeUndefined();
  });
});

describe("a monitor template written without an aggregation, whose monitors take its steps", () => {
  test("on create and on update, as a monitor", async () => {
    const template: MonitorTemplate = new MonitorTemplate();
    template.templateName = "Namespace backlog";
    template.monitorType = MonitorType.Metrics;
    template.monitorSteps = MonitorSteps.fromJSON(
      apiStepsJSON([
        apiStepJSON(
          [
            { variable: "incoming", metricName: MESSAGES_IN },
            { variable: "latency", metricName: SEND_LATENCY },
          ],
          RollingTime.Past15Minutes,
        ),
      ]),
    );

    const created: OnCreate<MonitorTemplate> = await (
      MonitorTemplateService as unknown as {
        onBeforeCreate: (
          c: CreateBy<MonitorTemplate>,
        ) => Promise<OnCreate<MonitorTemplate>>;
      }
    ).onBeforeCreate({ data: template, props: { tenantId: PROJECT_ID } });
    const createdSteps: MonitorSteps = stored(
      created.createBy.data.monitorSteps!,
    );

    expect(aggregationsOf(createdSteps)).toEqual([
      [AggregationType.Sum, undefined],
    ]);

    const row: MonitorTemplate = new MonitorTemplate();
    row._id = MONITOR_ID.toString();
    row.projectId = PROJECT_ID;
    row.monitorType = MonitorType.Metrics;
    row.monitorSteps = createdSteps;
    storedRows = [row];

    const updated: OnUpdate<MonitorTemplate> = await (
      MonitorTemplateService as unknown as {
        onBeforeUpdate: (
          u: UpdateBy<MonitorTemplate>,
        ) => Promise<OnUpdate<MonitorTemplate>>;
      }
    ).onBeforeUpdate({
      query: { _id: MONITOR_ID.toString() } as never,
      data: {
        monitorSteps: MonitorSteps.fromJSON(
          apiStepsJSON([
            apiStepJSON(
              [{ variable: "waiting", metricName: MESSAGES_WAITING }],
              RollingTime.Past1Hour,
            ),
          ]),
        ),
      } as never,
      limit: 1,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    });

    expect(
      aggregationsOf(
        stored(
          (updated.updateBy.data as unknown as { monitorSteps: MonitorSteps })
            .monitorSteps,
        ),
      ),
    ).toEqual([[AggregationType.Sum]]);
  });
});
