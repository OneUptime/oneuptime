/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
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

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import { JSONObject } from "../../../../Types/JSON";
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
 * MonitorResourceContext turns a monitor's own step config into the real
 * resource rows its incidents and alerts should be attached to. It is
 * what makes an UNGROUPED monitor link anything at all — the series-label
 * path only fires for grouped criteria, and most monitors are ungrouped.
 *
 * The regression it fixes: an alert from a metric monitor scoped to one
 * service showed "No resources affected", because the only thing naming
 * that service was an attribute filter nobody read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function monitorWith(
  monitorType: MonitorType,
  stepData: JSONObject,
  options?: { projectId?: ObjectID | undefined },
): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.monitorType = monitorType;

  if (!options || options.projectId !== undefined) {
    model.projectId = options?.projectId ?? PROJECT_ID;
  }

  const step: MonitorStep = new MonitorStep();
  step.data = { ...step.data, ...stepData } as MonitorStep["data"];

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = { monitorStepsInstanceArray: [step] };
  model.monitorSteps = steps;

  return model;
}

function metricViewConfigWith(attributes: JSONObject): JSONObject {
  return {
    queryConfigs: [
      {
        metricQueryData: {
          filterData: { metricName: "some.metric", attributes: attributes },
        },
      },
    ],
    formulaConfigs: [],
  };
}

/*
 * A TypeORM Raw() FindOperator as it appears in a captured query. Its
 * SQL generator is a function on `.value` — invisible to JSON — so the
 * only inspectable part is the bound-parameter bag.
 */
interface RawOperator {
  type?: string | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

/*
 * The query each service's findBy was handed, so a test can assert the
 * lookup was project-scoped and root-privileged rather than only
 * checking the ids that came back.
 */
let capturedQueries: Array<{ service: string; query: JSONObject }> = [];

function stubService(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  rows: Array<{ _id: string }>,
): void {
  jest
    .spyOn(service, "findBy")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(async (args: any) => {
      capturedQueries.push({ service: name, query: args.query as JSONObject });
      return rows;
    });
}

describe("MonitorResourceContext", () => {
  beforeEach(() => {
    capturedQueries = [];

    stubService("host", HostService, []);
    stubService("dockerHost", DockerHostService, []);
    stubService("kubernetesCluster", KubernetesClusterService, []);
    stubService("service", ServiceService, []);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("resolves the service a metric monitor's filter names", async () => {
    stubService("service", ServiceService, [{ _id: SERVICE_ID }]);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Metrics, {
          metricMonitor: {
            metricViewConfig: metricViewConfigWith({
              "oneuptime.service.name": "app-plan-starship-online-production",
            }),
          },
        }),
      });

    expect(resolved.serviceIds).toEqual([SERVICE_ID]);
  });

  test("resolves the services a log monitor's telemetryServiceIds name", async () => {
    stubService("service", ServiceService, [{ _id: SERVICE_ID }]);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Logs, {
          logMonitor: { telemetryServiceIds: [new ObjectID(SERVICE_ID)] },
        }),
      });

    expect(resolved.serviceIds).toEqual([SERVICE_ID]);

    // Looked up by primary key, not by name.
    const serviceQuery: JSONObject | undefined = capturedQueries.find(
      (entry: { service: string }): boolean => {
        return entry.service === "service";
      },
    )?.query;

    expect(serviceQuery?.["_id"]).toBeDefined();
    expect(serviceQuery?.["name"]).toBeUndefined();
  });

  test("resolves the host a host monitor names", async () => {
    stubService("host", HostService, [{ _id: "host-1" }]);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Host, {
          hostMonitor: { hostIdentifier: "prod-01" },
        }),
      });

    expect(resolved.hostIds).toEqual(["host-1"]);
  });

  test("resolves the cluster a kubernetes monitor names", async () => {
    stubService("kubernetesCluster", KubernetesClusterService, [
      { _id: "k8s-1" },
    ]);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Kubernetes, {
          kubernetesMonitor: { clusterIdentifier: "prod-cluster" },
        }),
      });

    expect(resolved.kubernetesClusterIds).toEqual(["k8s-1"]);
  });

  test("matches a name case-insensitively", async () => {
    /*
     * The identifier was typed by a user into the monitor form; the row's
     * name was stamped by an agent at ingest. They legitimately differ by
     * case, so the lookup must not be an exact-match Includes().
     */
    stubService("host", HostService, [{ _id: "host-1" }]);

    await MonitorResourceContextUtil.resolveResourceContextForMonitor({
      monitor: monitorWith(MonitorType.Host, {
        hostMonitor: { hostIdentifier: "PROD-01" },
      }),
    });

    const hostQuery: JSONObject | undefined = capturedQueries.find(
      (entry: { service: string }): boolean => {
        return entry.service === "host";
      },
    )?.query;

    const identifierClause: RawOperator | undefined = hostQuery?.[
      "hostIdentifier"
    ] as RawOperator | undefined;

    /*
     * A TypeORM Raw() operator, not a plain Includes: the SQL generator
     * lives on `.value` (a function, invisible to JSON) and the
     * identifiers are BOUND under a per-call random key in
     * `.objectLiteralParameters`. Asserting on the bound value proves
     * two things at once — the comparison is case-folded (the value was
     * lowercased on the way in), and the identifier is parameterized
     * rather than interpolated into the SQL.
     */
    expect(identifierClause?.type).toBe("raw");

    expect(
      Object.values(identifierClause?.objectLiteralParameters || {}),
    ).toEqual([["prod-01"]]);
  });

  test("scopes every lookup to the monitor's project", async () => {
    stubService("host", HostService, [{ _id: "host-1" }]);

    await MonitorResourceContextUtil.resolveResourceContextForMonitor({
      monitor: monitorWith(MonitorType.Host, {
        hostMonitor: { hostIdentifier: "prod-01" },
      }),
    });

    expect(capturedQueries.length).toBeGreaterThan(0);

    for (const entry of capturedQueries) {
      expect(String(entry.query["projectId"])).toBe(PROJECT_ID.toString());
    }
  });

  test("costs zero round-trips when the monitor names no resource", async () => {
    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Website, {}),
      });

    expect(resolved).toEqual(MonitorResourceContextUtil.emptyContext());
    expect(capturedQueries).toHaveLength(0);
  });

  test("returns empty without a lookup when the monitor has no project", async () => {
    const model: Monitor = monitorWith(
      MonitorType.Host,
      { hostMonitor: { hostIdentifier: "prod-01" } },
      { projectId: undefined },
    );

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: model,
      });

    expect(resolved).toEqual(MonitorResourceContextUtil.emptyContext());
    expect(capturedQueries).toHaveLength(0);
  });

  test("returns empty instead of throwing when a lookup fails", async () => {
    /*
     * This runs inside the probe / telemetry queue workers. A throw here
     * would fail the whole job and retry forever, so a lookup failure
     * must degrade to "no resources linked", never block creation.
     */
    jest
      .spyOn(SeriesResourceLinker, "resolveResourceRefs")
      .mockRejectedValue(new Error("database is down"));

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Host, {
          hostMonitor: { hostIdentifier: "prod-01" },
        }),
      });

    expect(resolved).toEqual(MonitorResourceContextUtil.emptyContext());
  });

  test("links nothing when the named resource is in another project", async () => {
    // The project-scoped query simply returns no row.
    stubService("host", HostService, []);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Host, {
          hostMonitor: { hostIdentifier: "someone-elses-host" },
        }),
      });

    expect(resolved.hostIds).toEqual([]);
  });

  test("a docker monitor resolves a DockerHost and never a Host", async () => {
    stubService("dockerHost", DockerHostService, [{ _id: "docker-1" }]);
    stubService("host", HostService, [{ _id: "host-should-not-be-used" }]);

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: monitorWith(MonitorType.Docker, {
          dockerMonitor: {
            hostIdentifier: "docker-prod-01",
            metricViewConfig: metricViewConfigWith({
              "resource.host.name": "docker-prod-01",
            }),
          },
        }),
      });

    expect(resolved.dockerHostIds).toEqual(["docker-1"]);
    expect(resolved.hostIds).toEqual([]);
    expect(HostService.findBy).not.toHaveBeenCalled();
  });
});
