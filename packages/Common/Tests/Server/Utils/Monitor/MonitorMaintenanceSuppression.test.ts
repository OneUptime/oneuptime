import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import MonitorMaintenanceSuppression, {
  MaintainedResourceKeys,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";

function emptyMaintained(): MaintainedResourceKeys {
  return {
    hosts: { ids: new Set<string>(), names: new Set<string>() },
    dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
    podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
    kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
    proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
    vmwareVCenters: { ids: new Set<string>(), names: new Set<string>() },
    cephClusters: { ids: new Set<string>(), names: new Set<string>() },
    dockerSwarmClusters: { ids: new Set<string>(), names: new Set<string>() },
    iotFleets: { ids: new Set<string>(), names: new Set<string>() },
    services: { ids: new Set<string>(), names: new Set<string>() },
    databaseServers: { ids: new Set<string>(), names: new Set<string>() },
  };
}

function series(
  fingerprint: string,
  labels: JSONObject,
): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: "criteria-1",
    fingerprint,
    labels,
    rootCause: "breached",
  };
}

describe("SeriesResourceLabels", () => {
  describe("collectLabelValues", () => {
    it("returns a string-valued label", () => {
      expect(
        SeriesResourceLabels.collectLabelValues({ "host.name": "h1" }, [
          "host.name",
        ]),
      ).toEqual(["h1"]);
    });

    it("flattens multi-valued labels and dedupes across keys", () => {
      expect(
        SeriesResourceLabels.collectLabelValues(
          { "host.name": ["h1", "h2"], "resource.host.name": "h2" },
          ["host.name", "resource.host.name"],
        ).sort(),
      ).toEqual(["h1", "h2"]);
    });

    it("ignores empty strings and non-string values", () => {
      expect(
        SeriesResourceLabels.collectLabelValues(
          { "host.name": "", other: 5 as unknown as string },
          ["host.name", "other"],
        ),
      ).toEqual([]);
    });
  });

  describe("extractResourceRefs", () => {
    it("maps host name (prefixed and unprefixed) and id keys", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.host.name": "h1",
          "oneuptime.host.id": "host-id-1",
        },
      );
      expect(refs.hostNames).toEqual(["h1"]);
      expect(refs.hostIds).toEqual(["host-id-1"]);
    });

    it("does NOT treat host.name as a docker host (docker keys are distinct)", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "host.name": "h1",
        },
      );
      expect(refs.dockerHostNames).toEqual([]);
      expect(refs.hostNames).toEqual(["h1"]);
    });

    it("maps docker host, kubernetes cluster, and service keys", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "oneuptime.docker.host.name": "d1",
          "k8s.cluster.name": "c1",
          "service.name": "s1",
        },
      );
      expect(refs.dockerHostNames).toEqual(["d1"]);
      expect(refs.kubernetesClusterNames).toEqual(["c1"]);
      expect(refs.serviceNames).toEqual(["s1"]);
    });

    it("maps proxmox and ceph cluster name keys (prefixed and unprefixed)", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.proxmox.cluster.name": "pve-1",
          "ceph.cluster.name": "ceph-1",
        },
      );
      expect(refs.proxmoxClusterNames).toEqual(["pve-1"]);
      expect(refs.cephClusterNames).toEqual(["ceph-1"]);
    });

    it("maps vmware vcenter name keys (prefixed and unprefixed)", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.vmware.vcenter.name": "vcsa-1",
        },
      );
      expect(refs.vmwareVCenterNames).toEqual(["vcsa-1"]);

      const refsUnprefixed: SeriesResourceRefs =
        SeriesResourceLabels.extractResourceRefs({
          "vmware.vcenter.name": "vcsa-2",
        });
      expect(refsUnprefixed.vmwareVCenterNames).toEqual(["vcsa-2"]);
    });

    it("does not read a vSphere object attribute as the vCenter identity", () => {
      /*
       * The shipped VMware templates group by `resource.vcenter.host.name`
       * / `resource.vcenter.vm.name`; those name an ESXi host or a VM,
       * not the vCenter, and must never resolve to a VMwareVCenter row.
       */
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.vcenter.host.name": "esx-01",
          "resource.vcenter.vm.name": "web-01",
          "resource.vcenter.cluster.name": "prod-cluster",
        },
      );
      expect(refs.vmwareVCenterNames).toEqual([]);
    });

    it("maps iot fleet name keys (prefixed and unprefixed)", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.iot.fleet.name": "fleet-1",
        },
      );
      expect(refs.iotFleetNames).toEqual(["fleet-1"]);

      const refsUnprefixed: SeriesResourceRefs =
        SeriesResourceLabels.extractResourceRefs({
          "iot.fleet.name": "fleet-2",
        });
      expect(refsUnprefixed.iotFleetNames).toEqual(["fleet-2"]);
    });

    it("maps database server id keys (prefixed and unprefixed)", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "resource.oneuptime.database.server.id":
            "d0000000-0000-4000-8000-000000000001",
          "oneuptime.database.server.id":
            "d0000000-0000-4000-8000-000000000002",
        },
      );
      expect(refs.databaseServerIds.sort()).toEqual([
        "d0000000-0000-4000-8000-000000000001",
        "d0000000-0000-4000-8000-000000000002",
      ]);
      // A database stamp names no host, service or cluster.
      expect(refs.hostIds).toEqual([]);
      expect(refs.hostNames).toEqual([]);
      expect(refs.serviceNames).toEqual([]);
    });

    it("never reads the database display-name stamp as an identity", () => {
      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        {
          "oneuptime.database.server.name": "PostgreSQL db.prod:5432",
          "resource.oneuptime.database.server.name": "PostgreSQL db.prod:5432",
        },
      );
      expect(refs.databaseServerIds).toEqual([]);
      expect(
        Object.values(refs).every((values: Array<string>): boolean => {
          return values.length === 0;
        }),
      ).toBe(true);
    });
  });
});

describe("MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources", () => {
  it("suppresses only the series whose host is under maintenance", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.hosts.names.add("prod-db-01");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpA", { "resource.host.name": "prod-db-01" }),
            series("fpB", { "resource.host.name": "prod-web-02" }),
          ],
          maintained,
        },
      );

    expect(Array.from(result)).toEqual(["fpA"]);
  });

  it("matches a host by its OneUptime id stamp as well as by name", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.hosts.ids.add("host-uuid-1");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpA", { "oneuptime.host.id": "host-uuid-1" }),
            series("fpB", { "oneuptime.host.id": "host-uuid-2" }),
          ],
          maintained,
        },
      );

    expect(Array.from(result)).toEqual(["fpA"]);
  });

  it("suppresses across docker host, kubernetes cluster, and service resource types", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.dockerHosts.names.add("docker-1");
    maintained.kubernetesClusters.names.add("cluster-1");
    maintained.services.names.add("payments");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpDocker", { "oneuptime.docker.host.name": "docker-1" }),
            series("fpCluster", { "k8s.cluster.name": "cluster-1" }),
            series("fpService", { "service.name": "payments" }),
            series("fpClear", { "service.name": "billing" }),
          ],
          maintained,
        },
      );

    expect(Array.from(result).sort()).toEqual([
      "fpCluster",
      "fpDocker",
      "fpService",
    ]);
  });

  it("suppresses an IoT series whose fleet is under maintenance", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.iotFleets.names.add("warehouse-sensors");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpFleet", {
              "resource.iot.fleet.name": "warehouse-sensors",
            }),
            series("fpClear", { "resource.iot.fleet.name": "office-sensors" }),
          ],
          maintained,
        },
      );

    expect(Array.from(result)).toEqual(["fpFleet"]);
  });

  /*
   * Linking and suppression read the same key map on purpose. Once a
   * series carrying `docker.swarm.cluster.name` could be LINKED to a
   * Swarm cluster, a maintenance window on that cluster had to silence
   * it too — otherwise the alert it raises mid-window shows up on the
   * very cluster the window covers.
   */
  it("suppresses a swarm series whose cluster is under maintenance", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.dockerSwarmClusters.names.add("prod-swarm");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpSwarm", {
              "resource.docker.swarm.cluster.name": "prod-swarm",
            }),
            series("fpClear", {
              "resource.docker.swarm.cluster.name": "staging-swarm",
            }),
          ],
          maintained,
        },
      );

    expect(Array.from(result)).toEqual(["fpSwarm"]);
  });

  it("suppresses a vmware series whose vCenter is under maintenance", () => {
    /*
     * Same contract for vCenters: a user-built monitor grouped by
     * `vmware.vcenter.name` must go quiet while the vCenter is attached
     * to an ongoing maintenance window. The shipped templates group by
     * host / VM / datastore instead and rely on the step-config path.
     */
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.vmwareVCenters.names.add("vcsa-prod");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpVCenter", {
              "resource.vmware.vcenter.name": "vcsa-prod",
            }),
            series("fpClear", {
              "resource.vmware.vcenter.name": "vcsa-staging",
            }),
          ],
          maintained,
        },
      );

    expect(Array.from(result)).toEqual(["fpVCenter"]);
  });

  it("suppresses only the series whose database is under maintenance", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add("d0000000-0000-4000-8000-000000000001");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpDb", {
              "oneuptime.database.server.id":
                "d0000000-0000-4000-8000-000000000001",
            }),
            series("fpDbPrefixed", {
              "resource.oneuptime.database.server.id":
                "d0000000-0000-4000-8000-000000000001",
            }),
            series("fpOther", {
              "oneuptime.database.server.id":
                "d0000000-0000-4000-8000-000000000002",
            }),
          ],
          maintained,
        },
      );

    expect(Array.from(result).sort()).toEqual(["fpDb", "fpDbPrefixed"]);
  });

  it("does not suppress a database series that carries only the display name", () => {
    /*
     * The name set is never filled for databases, and a name label is
     * never read — the display name is not unique across clusters.
     */
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add("d0000000-0000-4000-8000-000000000001");
    maintained.databaseServers.names.add("PostgreSQL db.prod:5432");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpName", {
              "oneuptime.database.server.name": "PostgreSQL db.prod:5432",
            }),
          ],
          maintained,
        },
      );

    expect(result.size).toBe(0);
  });

  it("does not let a database id match a host with the same id string", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add("5a000000-0000-4000-8000-000000000001");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpHost", {
              "oneuptime.host.id": "5a000000-0000-4000-8000-000000000001",
            }),
          ],
          maintained,
        },
      );

    expect(result.size).toBe(0);
  });

  it("does not cross-match resource types that happen to share a name", () => {
    /*
     * A service named the same string as the breaching host must not
     * suppress the host's series.
     */
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.services.names.add("prod-db-01");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpHost", { "resource.host.name": "prod-db-01" }),
          ],
          maintained,
        },
      );

    expect(result.size).toBe(0);
  });

  it("returns an empty set when nothing is under maintenance", () => {
    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("fpA", { "resource.host.name": "prod-db-01" }),
          ],
          maintained: emptyMaintained(),
        },
      );

    expect(result.size).toBe(0);
  });

  it("skips series with no fingerprint without throwing", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.hosts.names.add("prod-db-01");

    const result: Set<string> =
      MonitorMaintenanceSuppression.getSuppressedFingerprintsForMaintainedResources(
        {
          matchesPerSeries: [
            series("", { "resource.host.name": "prod-db-01" }),
          ],
          maintained,
        },
      );

    expect(result.size).toBe(0);
  });
});

describe("MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints — databases", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function ongoingEventWithDatabases(ids: Array<string>): ScheduledMaintenance {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = "event-1";
    event.databaseServers = ids.map((id: string): DatabaseServer => {
      const databaseServer: DatabaseServer = new DatabaseServer();
      databaseServer._id = id;
      databaseServer.name = `PostgreSQL ${id}:5432`;
      return databaseServer;
    });
    return event;
  }

  it("selects the databases of ongoing events and suppresses their series", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([
        ongoingEventWithDatabases(["d0000000-0000-4000-8000-000000000001"]),
      ]);

    const result: Set<string> =
      await MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints({
        projectId: PROJECT_ID,
        matchesPerSeries: [
          series("fpDb", {
            "oneuptime.database.server.id":
              "d0000000-0000-4000-8000-000000000001",
          }),
          series("fpOther", {
            "oneuptime.database.server.id":
              "d0000000-0000-4000-8000-000000000002",
          }),
        ],
      });

    expect(Array.from(result)).toEqual(["fpDb"]);

    const args: {
      query: { projectId: ObjectID };
      select: { databaseServers?: unknown };
    } = findBy.mock.calls[0]![0] as {
      query: { projectId: ObjectID };
      select: { databaseServers?: unknown };
    };
    expect(args.query.projectId).toBe(PROJECT_ID);
    // Only the id is read — the display name is never an identity.
    expect(args.select.databaseServers).toEqual({ _id: true });
  });

  it("does not suppress by the database name even when the event holds one", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([
        ongoingEventWithDatabases(["d0000000-0000-4000-8000-000000000001"]),
      ]);

    const result: Set<string> =
      await MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints({
        projectId: PROJECT_ID,
        matchesPerSeries: [
          series("fpName", {
            "oneuptime.database.server.name":
              "PostgreSQL d0000000-0000-4000-8000-000000000001:5432",
          }),
        ],
      });

    expect(result.size).toBe(0);
  });

  it("skips the maintenance query entirely when there are no per-series matches", async () => {
    const findBy: jest.SpyInstance = jest.spyOn(
      ScheduledMaintenanceService,
      "findBy",
    );

    const result: Set<string> =
      await MonitorMaintenanceSuppression.getSuppressedSeriesFingerprints({
        projectId: PROJECT_ID,
        matchesPerSeries: [],
      });

    expect(result.size).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });
});
