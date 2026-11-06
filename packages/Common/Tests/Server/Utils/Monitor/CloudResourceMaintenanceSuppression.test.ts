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
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import Host from "../../../../Models/DatabaseModels/Host";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import HostService from "../../../../Server/Services/HostService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import MonitorMaintenanceSuppression, {
  MaintainedResourceKeys,
  MonitorMaintenanceSuppressionResult,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStepResourceIdentity from "../../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import { SeriesResourceRefs } from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import { AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE } from "../../../../Types/Cloud/CloudMonitoredResource";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  CloudAlertTemplate,
  getCloudAlertTemplate,
} from "../../../../Types/Monitor/CloudAlertTemplates";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
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
 * A team holds orders-db - an RDS instance its cloud connection lists - in
 * a scheduled maintenance event while AWS upgrades it. Its storage and CPU
 * monitors, which its Recommendations tab made, must open nothing for the
 * hour the instance restarts and its metrics stop.
 *
 * A cloud resource's monitors are ungrouped and filtered on the attributes
 * its metrics are stored with (a namespace, dimensions, an account and a
 * Region) - no row's id - so the per-series half of maintenance suppression
 * never sees them. They name the resource in each query's event scope
 * (eventScope.cloudResourceId), and that is what the whole-monitor half
 * reads: while EVERY resource a monitor names is under maintenance, it
 * creates no incident or alert; its status still follows what it reads,
 * and the event's end lets it alert again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const ORDERS_DB: string = "c0000000-0000-4000-8000-00000000000a";
const CHECKOUT_FUNCTION: string = "c0000000-0000-4000-8000-00000000000b";
const WEB_LB: string = "c0000000-0000-4000-8000-00000000000c";
const BILLING_DATABASE_SERVER: string = "d0000000-0000-4000-8000-00000000000b";
const WEB_HOST: string = "40000000-0000-4000-8000-000000000001";

const RDS_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/RDS",
  "Dimensions.DBInstanceIdentifier": "orders-db",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

const LAMBDA_ATTRIBUTES: Dictionary<string> = {
  [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: "AWS/Lambda",
  "Dimensions.FunctionName": "checkout",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "eu-west-1",
};

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

function resolved(
  overrides: Partial<SeriesResolvedResourceIds>,
): SeriesResolvedResourceIds {
  return {
    ...MonitorResourceContextUtil.emptyContext(),
    ...overrides,
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

// The monitor a cloud resource's Recommendations tab creates.
function templateMonitor(data: {
  templateId: string;
  cloudResourceId: string;
  attributes: Dictionary<string>;
}): Monitor {
  const cloudTemplate: CloudAlertTemplate = getCloudAlertTemplate(
    data.templateId,
  )!;

  return monitorWithSteps(cloudTemplate.monitorType, [
    cloudTemplate.getMonitorStep({
      cloudResourceId: data.cloudResourceId,
      telemetryAttributes: data.attributes,
      allocatedStorageGiB: 100,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "orders-db",
    }),
  ]);
}

/*
 * A monitor made from a chart on the resource's Metrics tab: a Metrics step
 * whose query names the resource in its event scope, and possibly others
 * beside it.
 */
function metricsTabMonitor(
  eventScopes: Array<JSONObject | undefined>,
): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    metricMonitor: {
      metricViewConfig: {
        queryConfigs: eventScopes.map(
          (eventScope: JSONObject | undefined, index: number) => {
            return {
              metricAliasData: { metricVariable: `q${index}` },
              metricQueryData: {
                filterData: {
                  metricName: "amazonaws.com/aws/rds/cpuutilization",
                  attributes: { ...RDS_ATTRIBUTES },
                },
              },
              ...(eventScope ? { eventScope: eventScope } : {}),
            };
          },
        ),
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  return monitorWithSteps(MonitorType.Metrics, [step]);
}

function ongoingEvent(input: {
  cloudResourceIds?: Array<string>;
  databaseServerIds?: Array<string>;
  hostIds?: Array<string>;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = "e0000000-0000-4000-8000-000000000001";
  event.cloudResources = (input.cloudResourceIds || []).map(
    (id: string): CloudResource => {
      const resource: CloudResource = new CloudResource();
      resource._id = id;
      return resource;
    },
  );
  event.databaseServers = (input.databaseServerIds || []).map(
    (id: string): DatabaseServer => {
      const databaseServer: DatabaseServer = new DatabaseServer();
      databaseServer._id = id;
      return databaseServer;
    },
  );
  event.hosts = (input.hostIds || []).map((id: string): Host => {
    const host: Host = new Host();
    host._id = id;
    host.hostIdentifier = "web-1";
    return host;
  });
  return event;
}

describe("a monitor names the cloud resource its queries are scoped to", () => {
  function refsOf(monitor: Monitor): SeriesResourceRefs {
    return MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
      monitor: monitor,
    });
  }

  test("a recommended monitor names its resource, by its row's id", () => {
    const refs: SeriesResourceRefs = refsOf(
      templateMonitor({
        templateId: "cloud-aws-rds-high-cpu",
        cloudResourceId: ORDERS_DB,
        attributes: RDS_ATTRIBUTES,
      }),
    );

    expect(refs.cloudResourceIds).toEqual([ORDERS_DB]);
    // Its metric filter names no row of any other kind.
    expect(
      MonitorStepResourceIdentity.isEmpty({ ...refs, cloudResourceIds: [] }),
    ).toBe(true);
  });

  test("a share's queries each name it: one resource, however many queries", () => {
    const refs: SeriesResourceRefs = refsOf(
      templateMonitor({
        templateId: "cloud-aws-lambda-errors",
        cloudResourceId: CHECKOUT_FUNCTION,
        attributes: LAMBDA_ATTRIBUTES,
      }),
    );

    expect(Array.from(new Set(refs.cloudResourceIds))).toEqual([
      CHECKOUT_FUNCTION,
    ]);
  });

  test("an id in capitals is read as the row's lower-case id", () => {
    expect(
      refsOf(metricsTabMonitor([{ cloudResourceId: ORDERS_DB.toUpperCase() }]))
        .cloudResourceIds,
    ).toEqual([ORDERS_DB]);
  });

  test("anything but a uuid in the event scope names nothing", () => {
    for (const value of ["orders-db", "", "  ", 42, null, ["x"], { a: 1 }]) {
      expect(
        refsOf(metricsTabMonitor([{ cloudResourceId: value as never }]))
          .cloudResourceIds,
      ).toEqual([]);
    }

    expect(refsOf(metricsTabMonitor([undefined])).cloudResourceIds).toEqual([]);
  });

  test("a chart of two resources names both", () => {
    expect(
      refsOf(
        metricsTabMonitor([
          { cloudResourceId: ORDERS_DB },
          { cloudResourceId: WEB_LB },
        ]),
      ).cloudResourceIds.sort(),
    ).toEqual([ORDERS_DB, WEB_LB].sort());
  });

  test("series labels never name a cloud resource: no cloud metric carries a stamp", () => {
    expect(MonitorStepResourceIdentity.emptyRefs().cloudResourceIds).toEqual(
      [],
    );
  });
});

describe("MonitorMaintenanceSuppression.getSuppressingResourceIds (pure)", () => {
  test("a monitor naming one cloud resource under maintenance is silenced by it", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudResources.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({ cloudResourceIds: [ORDERS_DB] }),
        maintained: maintained,
      }),
    ).toEqual({ databaseServerIds: [], cloudResourceIds: [ORDERS_DB] });
  });

  test("maintenance on ANOTHER cloud resource silences nothing", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudResources.ids.add(WEB_LB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({ cloudResourceIds: [ORDERS_DB] }),
        maintained: maintained,
      }),
    ).toEqual({ databaseServerIds: [], cloudResourceIds: [] });
  });

  test("a monitor naming two cloud resources is silenced only while BOTH are held", () => {
    // An ungrouped monitor cannot say which of the two breached.
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudResources.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({ cloudResourceIds: [ORDERS_DB, WEB_LB] }),
        maintained: maintained,
      }).cloudResourceIds,
    ).toEqual([]);

    maintained.cloudResources.ids.add(WEB_LB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({ cloudResourceIds: [ORDERS_DB, WEB_LB] }),
        maintained: maintained,
      }).cloudResourceIds,
    ).toEqual([ORDERS_DB, WEB_LB]);
  });

  test("a host the monitor also names must be held too", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudResources.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({
          cloudResourceIds: [ORDERS_DB],
          hostIds: [WEB_HOST],
        }),
        maintained: maintained,
      }).cloudResourceIds,
    ).toEqual([]);

    maintained.hosts.ids.add(WEB_HOST);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({
          cloudResourceIds: [ORDERS_DB],
          hostIds: [WEB_HOST],
        }),
        maintained: maintained,
      }).cloudResourceIds,
    ).toEqual([ORDERS_DB]);
  });

  test("a database and a cloud resource named together are silenced by both, once both are held", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.cloudResources.ids.add(ORDERS_DB);

    const both: SeriesResolvedResourceIds = resolved({
      cloudResourceIds: [ORDERS_DB],
      databaseServerIds: [BILLING_DATABASE_SERVER],
    });

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: both,
        maintained: maintained,
      }),
    ).toEqual({ databaseServerIds: [], cloudResourceIds: [] });
    // The database half keeps its own answer: nothing, while one is not held.
    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: both,
        maintained: maintained,
      }),
    ).toEqual([]);

    maintained.databaseServers.ids.add(BILLING_DATABASE_SERVER);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: both,
        maintained: maintained,
      }),
    ).toEqual({
      databaseServerIds: [BILLING_DATABASE_SERVER],
      cloudResourceIds: [ORDERS_DB],
    });
  });

  test("a monitor naming neither a database nor a cloud resource is left to the per-series rules", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.hosts.ids.add(WEB_HOST);

    expect(
      MonitorMaintenanceSuppression.getSuppressingResourceIds({
        resolved: resolved({ hostIds: [WEB_HOST] }),
        maintained: maintained,
      }),
    ).toEqual({ databaseServerIds: [], cloudResourceIds: [] });
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyLike = any;

describe("MonitorMaintenanceSuppression.getMaintenanceSuppression, for a cloud resource", () => {
  let events: Array<ScheduledMaintenance>;
  let inProgressStateIds: Array<ObjectID>;
  let cloudResourceRows: Array<{ _id: string }>;
  let maintenanceSpy: SpyLike;
  let cloudResourceSpy: SpyLike;

  beforeEach(() => {
    events = [];
    inProgressStateIds = [new ObjectID("44444444-4444-4444-8444-444444444441")];
    cloudResourceRows = [];

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
        return Promise.resolve(cloudResourceRows as never);
      });

    jest
      .spyOn(DatabaseServerService, "findBy")
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

  test.each([
    ["cloud-aws-rds-high-cpu", RDS_ATTRIBUTES],
    ["cloud-aws-rds-low-storage", RDS_ATTRIBUTES],
    ["cloud-aws-lambda-errors", LAMBDA_ATTRIBUTES],
    ["cloud-aws-lambda-throttles", LAMBDA_ATTRIBUTES],
  ])(
    "the recommended monitor %s is silenced while its resource is held",
    async (templateId: string, attributes: Dictionary<string>) => {
      events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
      cloudResourceRows = [{ _id: ORDERS_DB }];

      const result: MonitorMaintenanceSuppressionResult =
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: templateMonitor({
            templateId: templateId,
            cloudResourceId: ORDERS_DB,
            attributes: attributes,
          }),
        });

      expect(result.suppressingCloudResourceIds).toEqual([ORDERS_DB]);
      expect(result.suppressingDatabaseServerIds).toEqual([]);
      expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
        true,
      );
    },
  );

  test("the event's end releases it: the same monitor alerts again", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    const monitor: Monitor = templateMonitor({
      templateId: "cloud-aws-rds-high-cpu",
      cloudResourceId: ORDERS_DB,
      attributes: RDS_ATTRIBUTES,
    });

    const during: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitor,
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(during)).toBe(
      true,
    );

    // The event moves to Ended: no state of the project holds it in progress.
    inProgressStateIds = [];

    const after: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitor,
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(after)).toBe(
      false,
    );
    expect(after.suppressingCloudResourceIds).toBeUndefined();
  });

  test("an event that holds the resource no more releases it too", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    const monitor: Monitor = templateMonitor({
      templateId: "cloud-aws-rds-high-cpu",
      cloudResourceId: ORDERS_DB,
      attributes: RDS_ATTRIBUTES,
    });

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(true);

    // Someone takes the resource off the event's Affected Resources.
    events = [ongoingEvent({ cloudResourceIds: [] })];

    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed(
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: monitor,
        }),
      ),
    ).toBe(false);
  });

  test("an event held in capitals still matches the monitor's lower-case id", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB.toUpperCase()] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor({
          templateId: "cloud-aws-rds-high-cpu",
          cloudResourceId: ORDERS_DB,
          attributes: RDS_ATTRIBUTES,
        }),
      });

    expect(result.suppressingCloudResourceIds).toEqual([ORDERS_DB]);
  });

  test("a monitor made from the resource's Metrics tab is silenced the same way", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: metricsTabMonitor([{ cloudResourceId: ORDERS_DB }]),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      true,
    );
  });

  test("maintenance on another resource leaves the monitor alerting", async () => {
    events = [ongoingEvent({ cloudResourceIds: [WEB_LB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor({
          templateId: "cloud-aws-rds-high-cpu",
          cloudResourceId: ORDERS_DB,
          attributes: RDS_ATTRIBUTES,
        }),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("a chart of two resources, one of them held, keeps alerting", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }, { _id: WEB_LB }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: metricsTabMonitor([
          { cloudResourceId: ORDERS_DB },
          { cloudResourceId: WEB_LB },
        ]),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("a resource that no longer resolves in this project silences nothing", async () => {
    // Deleted, or an id pasted from another project's resource.
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor({
          templateId: "cloud-aws-rds-high-cpu",
          cloudResourceId: ORDERS_DB,
          attributes: RDS_ATTRIBUTES,
        }),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("resolves its resources project-scoped, by id, as root", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    await MonitorMaintenanceSuppression.getMaintenanceSuppression({
      monitor: templateMonitor({
        templateId: "cloud-aws-rds-high-cpu",
        cloudResourceId: ORDERS_DB,
        attributes: RDS_ATTRIBUTES,
      }),
    });

    expect(cloudResourceSpy).toHaveBeenCalledTimes(1);

    const call: JSONObject = cloudResourceSpy.mock.calls[0][0] as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(
      (query["_id"] as unknown as { values: Array<string> }).values,
    ).toEqual([ORDERS_DB]);
    expect((call["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("reads the events' cloud resources by id, beside the other kinds", async () => {
    events = [ongoingEvent({ cloudResourceIds: [ORDERS_DB] })];
    cloudResourceRows = [{ _id: ORDERS_DB }];

    await MonitorMaintenanceSuppression.getMaintenanceSuppression({
      monitor: templateMonitor({
        templateId: "cloud-aws-rds-high-cpu",
        cloudResourceId: ORDERS_DB,
        attributes: RDS_ATTRIBUTES,
      }),
    });

    const select: JSONObject = (maintenanceSpy.mock.calls[0][0] as JSONObject)[
      "select"
    ] as JSONObject;

    expect(select["cloudResources"]).toEqual({ _id: true });
    expect(select["databaseServers"]).toEqual({ _id: true });
  });

  test("skips resolving the monitor's resources while no database or cloud resource is held", async () => {
    events = [ongoingEvent({ hostIds: [WEB_HOST] })];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor({
          templateId: "cloud-aws-rds-high-cpu",
          cloudResourceId: ORDERS_DB,
          attributes: RDS_ATTRIBUTES,
        }),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(maintenanceSpy).toHaveBeenCalledTimes(1);
    expect(cloudResourceSpy).not.toHaveBeenCalled();
  });

  test("costs no query at all for a monitor that names no cloud resource and has no series", async () => {
    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: metricsTabMonitor([undefined]),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(maintenanceSpy).not.toHaveBeenCalled();
    expect(cloudResourceSpy).not.toHaveBeenCalled();
  });
});

describe("what the evaluation summary says silenced a cloud resource's monitor", () => {
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

  test("names the cloud resource, and that status and resolving go on", () => {
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
        suppressingCloudResourceIds: [ORDERS_DB],
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
        `the cloud resource ${ORDERS_DB} this monitor watches is under an active scheduled maintenance window`,
      );
      expect(event.message).toMatch(/still/i);
    }
  });

  test.each([
    [
      { cloud: [ORDERS_DB], databases: [] },
      `the cloud resource ${ORDERS_DB} this monitor watches is`,
    ],
    [
      { cloud: [ORDERS_DB, WEB_LB], databases: [] },
      `the cloud resources ${ORDERS_DB}, ${WEB_LB} this monitor watches are`,
    ],
    [
      { cloud: [ORDERS_DB], databases: [BILLING_DATABASE_SERVER] },
      `the cloud resource ${ORDERS_DB} and the database ${BILLING_DATABASE_SERVER} this monitor watches are`,
    ],
    [
      { cloud: [], databases: [BILLING_DATABASE_SERVER] },
      `the database ${BILLING_DATABASE_SERVER} this monitor watches is`,
    ],
  ])(
    "%j reads as %s",
    (
      input: { cloud: Array<string>; databases: Array<string> },
      expected: string,
    ) => {
      expect(
        MonitorMaintenanceSuppression.describeSuppressingResources({
          suppressedSeriesFingerprints: new Set<string>(),
          suppressingDatabaseServerIds: input.databases,
          ...(input.cloud.length > 0
            ? { suppressingCloudResourceIds: input.cloud }
            : {}),
        }),
      ).toBe(expected);
    },
  );

  test("a store Data Observability watches is said as a database, as before", () => {
    expect(
      MonitorMaintenanceSuppression.describeSuppressingResources({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingDataStoreIds: [BILLING_DATABASE_SERVER],
      }),
    ).toBe(`the database ${BILLING_DATABASE_SERVER} this monitor watches is`);
  });

  test("a cloud resource alone silences the monitor; nothing does not", () => {
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingCloudResourceIds: [ORDERS_DB],
      }),
    ).toBe(true);
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
        suppressingCloudResourceIds: [],
      }),
    ).toBe(false);
  });
});
