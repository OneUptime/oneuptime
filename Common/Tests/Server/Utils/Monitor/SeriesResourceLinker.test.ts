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

import Alert from "../../../../Models/DatabaseModels/Alert";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../../Server/Services/HostService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import SeriesResourceLinker, {
  SeriesLinkableModel,
  SeriesResolvedResourceIds,
} from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
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
 * SeriesResourceLinker turns a breaching series' labels into the real
 * resources an alert/incident is about. It is the module behind the
 * "Affected Resources" card, the per-resource Activity tabs, the sidebar
 * badge counts, and resource-owner/label inheritance.
 *
 * The regression that motivated it: a metric monitor grouped by
 * `oneuptime.host.name` (the stamp ingest puts on EVERY host metric row)
 * opened alerts that linked no host at all, because the alert path only
 * ever read the two `host.name` spellings. Test 1 below is that bug.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

/*
 * Every findBy the linker can issue, keyed by the relation it feeds, so a
 * test can say "this one returns a row" and assert every other one was
 * never called.
 */
interface ResourceServiceUnderTest {
  relation: keyof SeriesLinkableModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  nameColumn: string;
}

const RESOURCE_SERVICES: Array<ResourceServiceUnderTest> = [
  { relation: "hosts", service: HostService, nameColumn: "hostIdentifier" },
  {
    relation: "dockerHosts",
    service: DockerHostService,
    nameColumn: "hostIdentifier",
  },
  {
    relation: "podmanHosts",
    service: PodmanHostService,
    nameColumn: "hostIdentifier",
  },
  {
    relation: "kubernetesClusters",
    service: KubernetesClusterService,
    nameColumn: "clusterIdentifier",
  },
  { relation: "services", service: ServiceService, nameColumn: "name" },
  {
    relation: "proxmoxClusters",
    service: ProxmoxClusterService,
    nameColumn: "name",
  },
  { relation: "cephClusters", service: CephClusterService, nameColumn: "name" },
  {
    relation: "dockerSwarmClusters",
    service: DockerSwarmClusterService,
    nameColumn: "name",
  },
  { relation: "iotFleets", service: IoTFleetService, nameColumn: "name" },
];

/*
 * Jest's spy typing fights the loosely-typed findBy signature the linker
 * deliberately abstracts over, so the captured spies are held loosely and
 * asserted through the helpers below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyLike = any;

const spies: Map<keyof SeriesLinkableModel, SpyLike> = new Map<
  keyof SeriesLinkableModel,
  SpyLike
>();

/*
 * Rows the fake findBy should return, per relation. A relation with no
 * entry resolves to [] — i.e. "the project has no such resource".
 */
let rowsByRelation: Map<keyof SeriesLinkableModel, Array<{ _id: string }>>;

/*
 * Every query object the linker passed, per relation, so tests can assert
 * on project scoping, the name column, and Includes contents.
 */
let queriesByRelation: Map<keyof SeriesLinkableModel, Array<JSONObject>>;

function relationQueries(
  relation: keyof SeriesLinkableModel,
): Array<JSONObject> {
  return queriesByRelation.get(relation) || [];
}

function callCount(relation: keyof SeriesLinkableModel): number {
  return spies.get(relation).mock.calls.length;
}

function idsOn(
  model: SeriesLinkableModel,
  relation: keyof SeriesLinkableModel,
): Array<string> {
  const items: Array<{ _id?: string | undefined }> | undefined = model[
    relation
  ] as Array<{ _id?: string | undefined }> | undefined;

  if (!items) {
    return [];
  }

  return items.map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

/*
 * Pull the values out of the Includes the linker built for a query, so a
 * test can assert on the exact identifiers it looked up.
 */
function includesValues(value: unknown): Array<string> {
  const includes: Includes = value as Includes;
  const values: Array<string | ObjectID | number> = (includes.values ||
    []) as Array<string | ObjectID | number>;

  return values.map((v: string | ObjectID | number): string => {
    return v.toString();
  });
}

function emptyResourceContext(): SeriesResolvedResourceIds {
  return {
    hostIds: [],
    dockerHostIds: [],
    podmanHostIds: [],
    kubernetesClusterIds: [],
    serviceIds: [],
    proxmoxClusterIds: [],
    cephClusterIds: [],
    dockerSwarmClusterIds: [],
    iotFleetIds: [],
  };
}

/*
 * Stand one resource service's findBy up as a fake that records the query
 * it was handed and answers with whatever the running test staged.
 */
function installFindBySpy(resource: ResourceServiceUnderTest): void {
  const spy: SpyLike = jest
    .spyOn(resource.service, "findBy")
    .mockImplementation((args: unknown): Promise<Array<{ _id: string }>> => {
      const call: { query?: JSONObject } = args as { query?: JSONObject };
      const recorded: Array<JSONObject> =
        queriesByRelation.get(resource.relation) || [];
      recorded.push(call.query || {});
      queriesByRelation.set(resource.relation, recorded);

      return Promise.resolve(rowsByRelation.get(resource.relation) || []);
    });

  spies.set(resource.relation, spy);
}

beforeEach(() => {
  rowsByRelation = new Map<keyof SeriesLinkableModel, Array<{ _id: string }>>();
  queriesByRelation = new Map<keyof SeriesLinkableModel, Array<JSONObject>>();
  spies.clear();

  for (const resource of RESOURCE_SERVICES) {
    installFindBySpy(resource);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SeriesResourceLinker.linkSeriesResourcesToModel", () => {
  test("links the host a series identifies by the oneuptime.host.name stamp", async () => {
    /*
     * THE REGRESSION. Ingest stamps `oneuptime.host.name` on every host
     * metric row, and the group-by dropdown offers it, so this is the
     * most common way a grouped host monitor identifies its series.
     */
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.name": "prodgreen000002" },
      projectId: PROJECT_ID,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
    expect(callCount("hosts")).toBe(1);

    const query: JSONObject = relationQueries("hosts")[0]!;
    expect(includesValues(query["hostIdentifier"])).toEqual([
      "prodgreen000002",
    ]);
  });

  test.each([
    ["resource.oneuptime.host.name"],
    ["oneuptime.host.name"],
    ["resource.host.name"],
    ["host.name"],
  ])("resolves the host from the %s spelling", async (key: string) => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { [key]: "web-1" },
      projectId: PROJECT_ID,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
    expect(
      includesValues(relationQueries("hosts")[0]!["hostIdentifier"]),
    ).toEqual(["web-1"]);
  });

  test("resolves a host id stamp through the _id column, not the name column", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.id": "host-1" },
      projectId: PROJECT_ID,
    });

    expect(callCount("hosts")).toBe(1);

    const query: JSONObject = relationQueries("hosts")[0]!;
    expect(includesValues(query["_id"])).toEqual(["host-1"]);
    expect(query["hostIdentifier"]).toBeUndefined();
    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
  });

  test("queries by id AND name when the series carries both, deduping the result", async () => {
    // Both lookups find the same row; the alert must link it once.
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: {
        "oneuptime.host.id": "host-1",
        "oneuptime.host.name": "web-1",
      },
      projectId: PROJECT_ID,
    });

    expect(callCount("hosts")).toBe(2);
    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
  });

  test("looks up every value of a multi-valued label in one query", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }, { _id: "host-2" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "host.name": ["web-1", "web-2"] },
      projectId: PROJECT_ID,
    });

    expect(callCount("hosts")).toBe(1);
    expect(
      includesValues(relationQueries("hosts")[0]!["hostIdentifier"]).sort(),
    ).toEqual(["web-1", "web-2"]);
    expect(idsOn(alert, "hosts").sort()).toEqual(["host-1", "host-2"]);
  });

  test.each([
    ["dockerHosts", "oneuptime.docker.host.name", "hostIdentifier"],
    ["podmanHosts", "oneuptime.podman.host.name", "hostIdentifier"],
    ["kubernetesClusters", "k8s.cluster.name", "clusterIdentifier"],
    ["services", "service.name", "name"],
    ["services", "oneuptime.service.name", "name"],
    ["proxmoxClusters", "proxmox.cluster.name", "name"],
    ["cephClusters", "ceph.cluster.name", "name"],
    ["dockerSwarmClusters", "docker.swarm.cluster.name", "name"],
    ["iotFleets", "iot.fleet.name", "name"],
  ])(
    "resolves %s from %s against the %s column",
    async (relation: string, labelKey: string, nameColumn: string) => {
      const typedRelation: keyof SeriesLinkableModel =
        relation as keyof SeriesLinkableModel;

      rowsByRelation.set(typedRelation, [{ _id: "resource-1" }]);

      const alert: Alert = new Alert();

      await SeriesResourceLinker.linkSeriesResourcesToModel({
        model: alert,
        seriesLabels: { [labelKey]: "the-resource" },
        projectId: PROJECT_ID,
      });

      expect(idsOn(alert, typedRelation)).toEqual(["resource-1"]);

      const query: JSONObject = relationQueries(typedRelation)[0]!;
      expect(includesValues(query[nameColumn])).toEqual(["the-resource"]);
    },
  );

  test.each([[MonitorType.Docker], [MonitorType.Podman]])(
    "a %s monitor's host.name label links no Host",
    async (monitorType: MonitorType) => {
      /*
       * The container agents stamp the box their containers run on under
       * the generic `resource.host.name`, which the label key map hands
       * to Host. On a Docker/Podman monitor that value names a
       * DockerHost / PodmanHost row, so honouring the map would attach an
       * unrelated Host and surface the event on that host's Activity tab.
       * The step-config path (MonitorStepResourceIdentity) links the
       * right model instead.
       */
      rowsByRelation.set("hosts", [{ _id: "host-1" }]);

      const alert: Alert = new Alert();

      await SeriesResourceLinker.linkSeriesResourcesToModel({
        model: alert,
        seriesLabels: { "host.name": "docker-prod-01" },
        projectId: PROJECT_ID,
        monitorType: monitorType,
      });

      expect(alert.hosts).toBeUndefined();
      expect(HostService.findBy).not.toHaveBeenCalled();
    },
  );

  test("a host.name label still links a Host for every other monitor type", async () => {
    // The suppression must be scoped to the two container types only.
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "host.name": "prod-01" },
      projectId: PROJECT_ID,
      monitorType: MonitorType.Host,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
  });

  test("a Docker monitor still links the docker host its labels name", async () => {
    /*
     * Suppression must drop ONLY the host refs — the DockerHost the
     * series actually identifies has to survive.
     */
    rowsByRelation.set("dockerHosts", [{ _id: "docker-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: {
        "host.name": "docker-prod-01",
        "oneuptime.docker.host.name": "docker-prod-01",
      },
      projectId: PROJECT_ID,
      monitorType: MonitorType.Docker,
    });

    expect(alert.hosts).toBeUndefined();
    expect(idsOn(alert, "dockerHosts")).toEqual(["docker-1"]);
  });

  test("a bare host name never resolves a docker or podman host", async () => {
    /*
     * Docker/Podman hosts are deliberately addressed only by their own
     * `oneuptime.*.host.name` stamps. Reading raw host.name for them
     * would attach a container host to an alert about a bare-metal box
     * that merely shares its name.
     */
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "host.name": "shared-name" },
      projectId: PROJECT_ID,
    });

    expect(callCount("dockerHosts")).toBe(0);
    expect(callCount("podmanHosts")).toBe(0);
    expect(alert.dockerHosts).toBeUndefined();
    expect(alert.podmanHosts).toBeUndefined();
  });

  test("links every resource type a single series identifies", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);
    rowsByRelation.set("kubernetesClusters", [{ _id: "cluster-1" }]);
    rowsByRelation.set("services", [{ _id: "service-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: {
        "oneuptime.host.name": "web-1",
        "k8s.cluster.name": "prod",
        "service.name": "checkout",
      },
      projectId: PROJECT_ID,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
    expect(idsOn(alert, "kubernetesClusters")).toEqual(["cluster-1"]);
    expect(idsOn(alert, "services")).toEqual(["service-1"]);
  });

  test("issues no query at all for labels that identify nothing", async () => {
    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "unrelated.label": "x", "http.status_code": "500" },
      projectId: PROJECT_ID,
    });

    for (const resource of RESOURCE_SERVICES) {
      expect(callCount(resource.relation)).toBe(0);
      expect(alert[resource.relation]).toBeUndefined();
    }
  });

  test("issues no query for an empty label set", async () => {
    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: {},
      projectId: PROJECT_ID,
    });

    for (const resource of RESOURCE_SERVICES) {
      expect(callCount(resource.relation)).toBe(0);
    }
  });

  test("scopes every lookup to the passed project", async () => {
    /*
     * Tenant isolation. These lookups run with isRoot, which bypasses
     * row-level access control, so the project scope is the only thing
     * stopping a stale or hostile id stamp from pulling in another
     * tenant's row.
     */
    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: {
        "oneuptime.host.id": "host-1",
        "oneuptime.host.name": "web-1",
        "oneuptime.docker.host.name": "docker-1",
        "oneuptime.podman.host.name": "podman-1",
        "k8s.cluster.name": "k8s-1",
        "service.name": "svc-1",
        "proxmox.cluster.name": "pve-1",
        "ceph.cluster.name": "ceph-1",
        "docker.swarm.cluster.name": "swarm-1",
        "iot.fleet.name": "fleet-1",
      },
      projectId: PROJECT_ID,
    });

    let assertedQueries: number = 0;

    for (const resource of RESOURCE_SERVICES) {
      const queries: Array<JSONObject> = relationQueries(resource.relation);
      expect(queries.length).toBeGreaterThan(0);

      for (const query of queries) {
        expect(query["projectId"]).toBe(PROJECT_ID);
        assertedQueries++;
      }
    }

    // 9 types, and hosts get an extra query for the id stamp.
    expect(assertedQueries).toBe(10);
  });

  test("does not link a resource that belongs to another project", async () => {
    /*
     * The service is queried with the alert's own project, so a row from
     * elsewhere simply is not returned — the relation stays unset rather
     * than linking across the tenant boundary.
     */
    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.name": "web-1" },
      projectId: OTHER_PROJECT_ID,
    });

    expect(relationQueries("hosts")[0]!["projectId"]).toBe(OTHER_PROJECT_ID);
    expect(alert.hosts).toBeUndefined();
  });

  test("leaves the relation unset when the resource no longer exists", async () => {
    // findBy returns [] — the host was deleted, or never discovered.
    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.name": "ghost-host" },
      projectId: PROJECT_ID,
    });

    expect(callCount("hosts")).toBe(1);
    expect(alert.hosts).toBeUndefined();
  });

  test("preserves resources already attached to the model", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-2" }]);

    const alert: Alert = new Alert();
    const preExisting: Host = new Host();
    preExisting._id = "host-1";
    alert.hosts = [preExisting];

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.name": "web-2" },
      projectId: PROJECT_ID,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1", "host-2"]);
  });

  test("does not attach the same resource twice", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);

    const alert: Alert = new Alert();
    const preExisting: Host = new Host();
    preExisting._id = "host-1";
    alert.hosts = [preExisting];

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "oneuptime.host.name": "web-1" },
      projectId: PROJECT_ID,
    });

    expect(idsOn(alert, "hosts")).toEqual(["host-1"]);
  });

  test("links an incident exactly as it links an alert", async () => {
    /*
     * The whole point of the shared util: the two creation paths must
     * not drift apart again.
     */
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);
    rowsByRelation.set("services", [{ _id: "service-1" }]);

    const labels: JSONObject = {
      "oneuptime.host.name": "web-1",
      "service.name": "checkout",
    };

    const alert: Alert = new Alert();
    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: labels,
      projectId: PROJECT_ID,
    });

    const incident: Incident = new Incident();
    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: incident,
      seriesLabels: labels,
      projectId: PROJECT_ID,
    });

    expect(idsOn(incident, "hosts")).toEqual(idsOn(alert, "hosts"));
    expect(idsOn(incident, "services")).toEqual(idsOn(alert, "services"));
  });
});

describe("SeriesResourceLinker.resolveResourcesFromSeriesLabels", () => {
  test("returns ids per type without touching a model", async () => {
    rowsByRelation.set("hosts", [{ _id: "host-1" }]);
    rowsByRelation.set("iotFleets", [{ _id: "fleet-1" }]);

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourcesFromSeriesLabels({
        seriesLabels: {
          "oneuptime.host.name": "web-1",
          "iot.fleet.name": "fleet-a",
        },
        projectId: PROJECT_ID,
      });

    expect(resolved.hostIds).toEqual(["host-1"]);
    expect(resolved.iotFleetIds).toEqual(["fleet-1"]);
    expect(resolved.serviceIds).toEqual([]);
    expect(resolved.dockerHostIds).toEqual([]);
    expect(resolved.podmanHostIds).toEqual([]);
    expect(resolved.kubernetesClusterIds).toEqual([]);
    expect(resolved.proxmoxClusterIds).toEqual([]);
    expect(resolved.cephClusterIds).toEqual([]);
    expect(resolved.dockerSwarmClusterIds).toEqual([]);
  });
});

describe("SeriesResourceLinker.attachResolvedResources", () => {
  test("attaches the monitor-step resources", () => {
    const alert: Alert = new Alert();

    SeriesResourceLinker.attachResolvedResources({
      model: alert,
      resolved: {
        ...emptyResourceContext(),
        proxmoxClusterIds: ["pve-1"],
        cephClusterIds: ["ceph-1"],
        dockerSwarmClusterIds: ["swarm-1"],
        iotFleetIds: ["fleet-1"],
      },
    });

    expect(idsOn(alert, "proxmoxClusters")).toEqual(["pve-1"]);
    expect(idsOn(alert, "cephClusters")).toEqual(["ceph-1"]);
    expect(idsOn(alert, "dockerSwarmClusters")).toEqual(["swarm-1"]);
    expect(idsOn(alert, "iotFleets")).toEqual(["fleet-1"]);
  });

  test("merges with the label path instead of overwriting it", async () => {
    /*
     * The alert path used to ASSIGN the step-config clusters, which was
     * only safe while its label path could not resolve them. Now that it
     * can, an overwrite would silently drop the cluster the series
     * itself named.
     */
    rowsByRelation.set("proxmoxClusters", [{ _id: "pve-from-label" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "proxmox.cluster.name": "pve-a" },
      projectId: PROJECT_ID,
    });

    SeriesResourceLinker.attachResolvedResources({
      model: alert,
      resolved: {
        ...emptyResourceContext(),
        proxmoxClusterIds: ["pve-from-step-config"],
      },
    });

    expect(idsOn(alert, "proxmoxClusters")).toEqual([
      "pve-from-label",
      "pve-from-step-config",
    ]);
  });

  test("dedupes a cluster both paths resolved", async () => {
    rowsByRelation.set("cephClusters", [{ _id: "ceph-1" }]);

    const alert: Alert = new Alert();

    await SeriesResourceLinker.linkSeriesResourcesToModel({
      model: alert,
      seriesLabels: { "ceph.cluster.name": "ceph-a" },
      projectId: PROJECT_ID,
    });

    SeriesResourceLinker.attachResolvedResources({
      model: alert,
      resolved: {
        ...emptyResourceContext(),
        cephClusterIds: ["ceph-1"],
      },
    });

    expect(idsOn(alert, "cephClusters")).toEqual(["ceph-1"]);
  });

  test("leaves every relation untouched when the monitor names no resource", () => {
    const alert: Alert = new Alert();

    SeriesResourceLinker.attachResolvedResources({
      model: alert,
      resolved: emptyResourceContext(),
    });

    expect(alert.proxmoxClusters).toBeUndefined();
    expect(alert.cephClusters).toBeUndefined();
    expect(alert.dockerSwarmClusters).toBeUndefined();
    expect(alert.iotFleets).toBeUndefined();
  });

  test("attaches to an incident the same way", () => {
    const incident: Incident = new Incident();

    SeriesResourceLinker.attachResolvedResources({
      model: incident,
      resolved: {
        ...emptyResourceContext(),
        dockerSwarmClusterIds: ["swarm-1"],
      },
    });

    expect(idsOn(incident, "dockerSwarmClusters")).toEqual(["swarm-1"]);
  });
});
