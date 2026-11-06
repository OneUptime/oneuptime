/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service used below
 * extends) imports it. Nothing password-related is under test here, so the
 * module is replaced WITH A FACTORY - an automock would still require (and
 * type-check) the real file.
 */
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

import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import HostService from "../../../../Server/Services/HostService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import MonitorMaintenanceSuppression, {
  MaintainedResourceKeys,
  MonitorMaintenanceSuppressionResult,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorStepResourceIdentity from "../../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import { CloudResourceKind } from "../../../../Types/Cloud/CloudResourceKind";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  CloudAppAlertTemplate,
  getAllCloudAppAlertTemplates,
} from "../../../../Types/Monitor/CloudAppAlertTemplates";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A team moves its ECS cluster to new instance types on a Saturday morning,
 * and holds the App Platforms environment the cluster's apps run in -
 * aws_ecs, account 123456789012, us-east-1 - in a scheduled maintenance
 * event while it does. Its apps' monitors, which each app's Recommendations
 * tab made - failed operations, error bursts, traffic that stops, slow
 * requests - must open nothing for the hour the tasks restart and their
 * requests fail.
 *
 * Those monitors name no row of any kind in their configuration: they read
 * the app's own spans and request durations through the filter its Traces
 * tab uses, the environment's platform, account and Region and the app's
 * own attributes (CloudAppAlertTemplates). So the environment is matched by
 * that filter: a monitor whose every query reads nothing but one held
 * environment's telemetry creates no incident or alert while it is held;
 * its status still follows what it reads, and the event's end lets it alert
 * again. Monitors of the apps of another environment keep alerting, and so
 * does a monitor one of whose queries reads outside the held environment.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const CHECKOUT_ENVIRONMENT: string = "71000000-0000-4000-8000-000000000001";
const BILLING_ENVIRONMENT: string = "71000000-0000-4000-8000-000000000002";
const RUN_ENVIRONMENT: string = "71000000-0000-4000-8000-000000000003";
const ORDERS_DB: string = "c0000000-0000-4000-8000-00000000000a";

// The environment checkout-api runs in, as its row holds it.
const CHECKOUT_SCOPE: Dictionary<string> = {
  "resource.cloud.platform": "aws_ecs",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "us-east-1",
};

// Another ECS environment: the same account, another Region.
const BILLING_SCOPE: Dictionary<string> = {
  "resource.cloud.platform": "aws_ecs",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

// What checkout-api's telemetry is told apart by: its environment's and its own.
const CHECKOUT_API_FILTER: Dictionary<string> = {
  ...CHECKOUT_SCOPE,
  "resource.aws.ecs.task.family": "checkout-api",
  "resource.aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:123456789012:cluster/production",
};

const INVENTORY_FILTER: Dictionary<string> = {
  ...CHECKOUT_SCOPE,
  "resource.aws.ecs.task.family": "inventory",
  "resource.aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:123456789012:cluster/production",
};

const BILLING_API_FILTER: Dictionary<string> = {
  ...BILLING_SCOPE,
  "resource.aws.ecs.task.family": "billing-api",
};

const APP_TEMPLATES: Array<CloudAppAlertTemplate> =
  getAllCloudAppAlertTemplates();

function emptyMaintained(): MaintainedResourceKeys {
  return {
    hosts: { ids: new Set<string>(), names: new Set<string>() },
    dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
    podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
    kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
    proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
    openStackClouds: { ids: new Set<string>(), names: new Set<string>() },
    vmwareVCenters: { ids: new Set<string>(), names: new Set<string>() },
    cephClusters: { ids: new Set<string>(), names: new Set<string>() },
    storageArrays: { ids: new Set<string>(), names: new Set<string>() },
    dockerSwarmClusters: { ids: new Set<string>(), names: new Set<string>() },
    iotFleets: { ids: new Set<string>(), names: new Set<string>() },
    services: { ids: new Set<string>(), names: new Set<string>() },
    databaseServers: { ids: new Set<string>(), names: new Set<string>() },
    cloudResources: { ids: new Set<string>(), names: new Set<string>() },
  };
}

function monitorWithSteps(
  monitorType: MonitorType,
  steps: Array<MonitorStep>,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  monitor.projectId = PROJECT_ID;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return monitor;
}

// The monitor an app's Recommendations tab makes from one of its templates.
function appMonitor(
  template: CloudAppAlertTemplate,
  filter: Dictionary<string>,
): Monitor {
  return monitorWithSteps(template.monitorType, [
    template.getMonitorStep({
      cloudAppId: "75000000-0000-4000-8000-000000000001",
      telemetryFilters: filter,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "checkout-api",
    }),
  ]);
}

// A Logs monitor made from a log list filtered by these attributes.
function logsMonitor(attributes: Dictionary<string>): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    logMonitor: {
      ...MonitorStepLogMonitorUtil.getDefault(),
      attributes: attributes,
    },
  } as MonitorStep["data"];

  return monitorWithSteps(MonitorType.Logs, [step]);
}

// A Metrics monitor whose queries each read with one of these filters.
function metricsMonitor(filters: Array<Dictionary<string>>): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    metricMonitor: {
      metricViewConfig: {
        queryConfigs: filters.map(
          (attributes: Dictionary<string>, index: number) => {
            return {
              metricAliasData: { metricVariable: `q${index}` },
              metricQueryData: {
                filterData: {
                  metricName: "http.server.request.duration",
                  attributes: { ...attributes },
                },
              },
            };
          },
        ),
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  return monitorWithSteps(MonitorType.Metrics, [step]);
}

interface HeldRow {
  _id: string;
  kind?: CloudResourceKind | undefined;
  scope?: Dictionary<string> | undefined;
}

// An event in progress holding these cloud rows, as the server reads it.
function ongoingEvent(rows: Array<HeldRow>): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = "e0000000-0000-4000-8000-000000000001";
  event.cloudResources = rows.map((row: HeldRow): CloudResource => {
    const resource: CloudResource = new CloudResource();
    resource._id = row._id;
    resource.cloudResourceKind = row.kind || CloudResourceKind.Environment;

    if (row.scope?.["resource.cloud.platform"]) {
      resource.cloudPlatform = row.scope["resource.cloud.platform"];
    }

    if (row.scope?.["resource.cloud.account.id"]) {
      resource.cloudAccountId = row.scope["resource.cloud.account.id"];
    }

    if (row.scope?.["resource.cloud.region"]) {
      resource.cloudRegion = row.scope["resource.cloud.region"];
    }

    return resource;
  });
  return event;
}

const CHECKOUT_HELD: HeldRow = {
  _id: CHECKOUT_ENVIRONMENT,
  scope: CHECKOUT_SCOPE,
};

describe("the environment each query of a monitor reads", () => {
  test.each(
    APP_TEMPLATES.map((template: CloudAppAlertTemplate) => {
      return [template.id, template];
    }),
  )(
    "the app's recommended monitor %s reads its environment, in its one query",
    (_id: string, template: CloudAppAlertTemplate) => {
      expect(
        MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
          appMonitor(template, CHECKOUT_API_FILTER),
        ),
      ).toEqual(["aws_ecs|123456789012|us-east-1"]);
    },
  );

  test("a Logs monitor built from an environment's Logs tab reads it", () => {
    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
        logsMonitor(CHECKOUT_SCOPE),
      ),
    ).toEqual(["aws_ecs|123456789012|us-east-1"]);
  });

  test("each query of a Metrics monitor says its own, and one that pins no platform reads none", () => {
    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
        metricsMonitor([
          CHECKOUT_API_FILTER,
          BILLING_API_FILTER,
          { "resource.service.name": "checkout-api" },
        ]),
      ),
    ).toEqual([
      "aws_ecs|123456789012|us-east-1",
      "aws_ecs|123456789012|eu-west-1",
      null,
    ]);
  });

  test("a query is read by the monitor's own type: a leftover sub-config of another kind is never queried", () => {
    const monitor: Monitor = appMonitor(
      APP_TEMPLATES.find((template: CloudAppAlertTemplate): boolean => {
        return template.monitorType === MonitorType.Traces;
      })!,
      CHECKOUT_API_FILTER,
    );

    // A Logs query of another environment, left on the step by an older form.
    monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.logMonitor =
      {
        ...MonitorStepLogMonitorUtil.getDefault(),
        attributes: { ...BILLING_SCOPE },
      };

    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(monitor),
    ).toEqual(["aws_ecs|123456789012|us-east-1"]);
  });

  test("a monitor of any other kind makes no such query", () => {
    const step: MonitorStep = new MonitorStep();
    step.data = {
      ...step.data,
      logMonitor: {
        ...MonitorStepLogMonitorUtil.getDefault(),
        attributes: { ...CHECKOUT_SCOPE },
      },
    } as MonitorStep["data"];

    for (const monitorType of [
      MonitorType.Host,
      MonitorType.Website,
      MonitorType.Exceptions,
    ]) {
      expect(
        MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
          monitorWithSteps(monitorType, [step]),
        ),
      ).toEqual([]);
    }
  });

  test("a monitor with no steps, or steps with no data, makes no query", () => {
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Traces;

    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(monitor),
    ).toEqual([]);

    const empty: MonitorStep = new MonitorStep();
    empty.data = undefined;

    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
        monitorWithSteps(MonitorType.Traces, [empty]),
      ),
    ).toEqual([]);
  });

  test("an unreadable query list reads as none, never throwing out of an evaluation", () => {
    const step: MonitorStep = new MonitorStep();
    step.data = {
      ...step.data,
      metricMonitor: {
        metricViewConfig: { queryConfigs: "not a list", formulaConfigs: [] },
      },
    } as unknown as MonitorStep["data"];

    expect(
      MonitorStepResourceIdentity.getCloudEnvironmentKeysOfQueries(
        monitorWithSteps(MonitorType.Metrics, [step]),
      ),
    ).toEqual([]);
  });
});

describe("MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds (pure)", () => {
  function held(entries: Array<[string, string]>): MaintainedResourceKeys {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudEnvironments = new Map<string, string>(entries);
    return maintained;
  }

  test("a monitor whose one query reads a held environment is silenced by it", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs|123456789012|us-east-1"],
        maintained: held([
          ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
        ]),
      }),
    ).toEqual([CHECKOUT_ENVIRONMENT]);
  });

  test("maintenance on another environment silences nothing", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs|123456789012|eu-west-1"],
        maintained: held([
          ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
        ]),
      }),
    ).toEqual([]);
  });

  test("every query must read a held environment: one that reads outside keeps the monitor alerting", () => {
    const maintained: MaintainedResourceKeys = held([
      ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
    ]);

    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: [
          "aws_ecs|123456789012|us-east-1",
          "aws_ecs|123456789012|eu-west-1",
        ],
        maintained: maintained,
      }),
    ).toEqual([]);
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs|123456789012|us-east-1", null],
        maintained: maintained,
      }),
    ).toEqual([]);
  });

  test("queries of two environments are silenced once both are held, by both, each once", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: [
          "aws_ecs|123456789012|us-east-1",
          "aws_ecs|123456789012|eu-west-1",
          "aws_ecs|123456789012|us-east-1",
        ],
        maintained: held([
          ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
          ["aws_ecs|123456789012|eu-west-1", BILLING_ENVIRONMENT],
        ]),
      }),
    ).toEqual([CHECKOUT_ENVIRONMENT, BILLING_ENVIRONMENT]);
  });

  test("a monitor with no query, or no environment held, is never silenced by one", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: [],
        maintained: held([
          ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
        ]),
      }),
    ).toEqual([]);
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs|123456789012|us-east-1"],
        maintained: emptyMaintained(),
      }),
    ).toEqual([]);
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs|123456789012|us-east-1"],
        maintained: held([]),
      }),
    ).toEqual([]);
  });

  test("a query that pins only the platform reads every account's environments: an environment with an account does not hold it", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingCloudEnvironmentIds({
        queryEnvironmentKeys: ["aws_ecs||"],
        maintained: held([
          ["aws_ecs|123456789012|us-east-1", CHECKOUT_ENVIRONMENT],
        ]),
      }),
    ).toEqual([]);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyLike = any;

describe("MonitorMaintenanceSuppression.getMaintenanceSuppression, for an environment's apps", () => {
  let events: Array<ScheduledMaintenance>;
  let inProgressStateIds: Array<ObjectID>;
  let maintenanceSpy: SpyLike;
  let cloudResourceSpy: SpyLike;

  beforeEach(() => {
    events = [];
    inProgressStateIds = [new ObjectID("44444444-4444-4444-8444-444444444441")];

    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getInProgressScheduledMaintenanceStateIds",
      )
      .mockImplementation((): Promise<never> => {
        return Promise.resolve(inProgressStateIds as never);
      });

    maintenanceSpy = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((): Promise<never> => {
        // An event is in progress only while its state is one that is.
        return Promise.resolve(
          (inProgressStateIds.length > 0 ? events : []) as never,
        );
      });

    cloudResourceSpy = jest
      .spyOn(CloudResourceService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve([] as never);
      });

    jest
      .spyOn(DatabaseServerService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve([] as never);
      });

    jest
      .spyOn(DataStoreService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve([] as never);
      });

    jest.spyOn(HostService, "findBy").mockImplementation((): Promise<never> => {
      return Promise.resolve([] as never);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(
    APP_TEMPLATES.map((template: CloudAppAlertTemplate) => {
      return [template.id, template];
    }),
  )(
    "the app's recommended monitor %s is silenced while its environment is held",
    async (_id: string, template: CloudAppAlertTemplate) => {
      events = [ongoingEvent([CHECKOUT_HELD])];

      const result: MonitorMaintenanceSuppressionResult =
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: appMonitor(template, CHECKOUT_API_FILTER),
        });

      expect(result.suppressingCloudEnvironmentIds).toEqual([
        CHECKOUT_ENVIRONMENT,
      ]);
      expect(result.suppressingCloudResourceIds).toBeUndefined();
      expect(result.suppressingDatabaseServerIds).toEqual([]);
      expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
        true,
      );
    },
  );

  test("every app of the held environment is silenced, each by its own monitors", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    for (const filter of [CHECKOUT_API_FILTER, INVENTORY_FILTER]) {
      for (const template of APP_TEMPLATES) {
        expect(
          MonitorMaintenanceSuppression.isMonitorSuppressed(
            await MonitorMaintenanceSuppression.getMaintenanceSuppression({
              monitor: appMonitor(template, filter),
            }),
          ),
        ).toBe(true);
      }
    }
  });

  test("the apps of another environment keep alerting", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    for (const template of APP_TEMPLATES) {
      const result: MonitorMaintenanceSuppressionResult =
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: appMonitor(template, BILLING_API_FILTER),
        });

      expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
        false,
      );
      expect(result.suppressingCloudEnvironmentIds).toBeUndefined();
    }
  });

  test("the event's end releases them: the same monitor alerts again", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];
    const monitor: Monitor = appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER);

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(true);

    // The event moves to Ended: no state of the project holds it in progress.
    inProgressStateIds = [];

    const after: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitor,
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(after)).toBe(
      false,
    );
    expect(after.suppressingCloudEnvironmentIds).toBeUndefined();
  });

  test("an event that holds the environment no more releases them too", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];
    const monitor: Monitor = appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER);

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(true);

    // Someone takes the environment off the event's Affected Resources.
    events = [ongoingEvent([])];

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(false);
  });

  test("an environment's own monitors - its Logs tab's, its Traces tab's - are held with it", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: logsMonitor(CHECKOUT_SCOPE),
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([CHECKOUT_ENVIRONMENT]);
    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: metricsMonitor([CHECKOUT_SCOPE, CHECKOUT_API_FILTER]),
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([CHECKOUT_ENVIRONMENT]);
  });

  test("a chart of two environments, one of them held, keeps alerting; with both held it is silenced by both", async () => {
    const monitor: Monitor = metricsMonitor([
      CHECKOUT_API_FILTER,
      BILLING_API_FILTER,
    ]);

    events = [ongoingEvent([CHECKOUT_HELD])];

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(false);

    events = [
      ongoingEvent([
        CHECKOUT_HELD,
        { _id: BILLING_ENVIRONMENT, scope: BILLING_SCOPE },
      ]),
    ];

    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([CHECKOUT_ENVIRONMENT, BILLING_ENVIRONMENT]);
  });

  test("two events each holding one of them hold both", async () => {
    const second: ScheduledMaintenance = ongoingEvent([
      { _id: BILLING_ENVIRONMENT, scope: BILLING_SCOPE },
    ]);
    second._id = "e0000000-0000-4000-8000-000000000002";
    events = [ongoingEvent([CHECKOUT_HELD]), second];

    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: metricsMonitor([CHECKOUT_API_FILTER, BILLING_API_FILTER]),
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([CHECKOUT_ENVIRONMENT, BILLING_ENVIRONMENT]);
  });

  test("a query that reads every account's apps in the Region is not the held environment's", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: logsMonitor({
          "resource.cloud.platform": "aws_ecs",
          "resource.cloud.region": "us-east-1",
        }),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("an environment ingest found without an account holds the queries that read it, and no account's", async () => {
    // Some detectors report no account: the environment is keyed without one.
    events = [
      ongoingEvent([
        {
          _id: RUN_ENVIRONMENT,
          scope: {
            "resource.cloud.platform": "aws_ecs",
            "resource.cloud.region": "us-east-1",
          },
        },
      ]),
    ];

    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: logsMonitor({
            "resource.cloud.platform": "aws_ecs",
            "resource.cloud.region": "us-east-1",
            "resource.service.name": "worker",
          }),
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([RUN_ENVIRONMENT]);

    // An app of the environment that has an account is not that one's.
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
        }),
      ),
    ).toBe(false);
  });

  test("a cloud resource of a connected account is never read as an environment", async () => {
    // Its row could hold the same three columns; its kind says it is not an environment.
    events = [
      ongoingEvent([
        {
          _id: ORDERS_DB,
          kind: CloudResourceKind.Resource,
          scope: CHECKOUT_SCOPE,
        },
      ]),
    ];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("an environment made by hand, with no platform yet, holds no app's monitors", async () => {
    events = [
      ongoingEvent([
        {
          _id: CHECKOUT_ENVIRONMENT,
          scope: {
            "resource.cloud.account.id": "123456789012",
            "resource.cloud.region": "us-east-1",
          },
        },
      ]),
    ];

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
        }),
      ),
    ).toBe(false);
  });

  test("an environment's id held in capitals is said in lower case", async () => {
    events = [
      ongoingEvent([
        { _id: CHECKOUT_ENVIRONMENT.toUpperCase(), scope: CHECKOUT_SCOPE },
      ]),
    ];

    expect(
      (
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
        })
      ).suppressingCloudEnvironmentIds,
    ).toEqual([CHECKOUT_ENVIRONMENT]);
  });

  test("reads the events' cloud rows with their kind and the three columns their telemetry is keyed by", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    await MonitorMaintenanceSuppression.getMaintenanceSuppression({
      monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
    });

    expect(maintenanceSpy).toHaveBeenCalledTimes(1);

    const call: JSONObject = maintenanceSpy.mock.calls[0][0] as JSONObject;

    expect((call["select"] as JSONObject)["cloudResources"]).toEqual({
      _id: true,
      cloudResourceKind: true,
      cloudPlatform: true,
      cloudAccountId: true,
      cloudRegion: true,
    });
    expect((call["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect((call["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("an app's monitor costs no lookup of any row: its filter is its environment's identity", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    await MonitorMaintenanceSuppression.getMaintenanceSuppression({
      monitor: appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER),
    });

    expect(cloudResourceSpy).not.toHaveBeenCalled();
  });

  test("costs no query at all for a monitor one of whose queries reads no environment", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: metricsMonitor([
          CHECKOUT_API_FILTER,
          { "resource.service.name": "checkout-api" },
        ]),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(maintenanceSpy).not.toHaveBeenCalled();
  });

  test("an unreadable step costs nothing and silences nothing", async () => {
    events = [ongoingEvent([CHECKOUT_HELD])];

    const monitor: Monitor = appMonitor(APP_TEMPLATES[0]!, CHECKOUT_API_FILTER);
    jest
      .spyOn(MonitorStepResourceIdentity, "getCloudEnvironmentKeysOfQueries")
      .mockImplementation((): Array<string | null> => {
        throw new Error("unreadable step");
      });

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitor,
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });
});

describe("what the evaluation summary says silenced an app's monitor", () => {
  function criteria(): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      ...instance.data!,
      id: "criteria-1",
      createIncidents: true,
      createAlerts: true,
    };
    return instance;
  }

  test("names the environment, and that status and resolving go on", () => {
    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: new Date(),
      criteriaResults: [],
      events: [],
    };

    MonitorMaintenanceSuppression.recordMonitorSuppressed({
      evaluationSummary: evaluationSummary,
      criteriaInstance: criteria(),
      suppression: {
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingCloudEnvironmentIds: [CHECKOUT_ENVIRONMENT],
      },
    });

    expect(
      evaluationSummary.events.map((event: MonitorEvaluationEvent) => {
        return event.type;
      }),
    ).toEqual(["incident-skipped", "alert-skipped"]);

    for (const event of evaluationSummary.events) {
      expect(event.title).toMatch(/scheduled maintenance/i);
      expect(event.message).toContain(
        `the environment ${CHECKOUT_ENVIRONMENT} this monitor watches is under an active scheduled maintenance window`,
      );
      expect(event.message).toMatch(/still/i);
    }
  });

  test.each([
    [
      { environments: [CHECKOUT_ENVIRONMENT], cloud: [] },
      `the environment ${CHECKOUT_ENVIRONMENT} this monitor watches is`,
    ],
    [
      {
        environments: [CHECKOUT_ENVIRONMENT, BILLING_ENVIRONMENT],
        cloud: [],
      },
      `the environments ${CHECKOUT_ENVIRONMENT}, ${BILLING_ENVIRONMENT} this monitor watches are`,
    ],
    [
      { environments: [CHECKOUT_ENVIRONMENT], cloud: [ORDERS_DB] },
      `the environment ${CHECKOUT_ENVIRONMENT} and the cloud resource ${ORDERS_DB} this monitor watches are`,
    ],
  ])(
    "%j reads as %s",
    (
      input: { environments: Array<string>; cloud: Array<string> },
      expected: string,
    ) => {
      expect(
        MonitorMaintenanceSuppression.describeSuppressingResources({
          suppressedSeriesFingerprints: new Set<string>(),
          suppressingDatabaseServerIds: [],
          suppressingCloudEnvironmentIds: input.environments,
          ...(input.cloud.length > 0
            ? { suppressingCloudResourceIds: input.cloud }
            : {}),
        }),
      ).toBe(expected);
    },
  );

  test("an environment alone silences the monitor; none does not", () => {
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingCloudEnvironmentIds: [CHECKOUT_ENVIRONMENT],
      }),
    ).toBe(true);
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingCloudEnvironmentIds: [],
      }),
    ).toBe(false);
  });
});
