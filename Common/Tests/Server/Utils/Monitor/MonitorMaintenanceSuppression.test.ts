import MonitorMaintenanceSuppression, {
  MaintainedResourceKeys,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import { JSONObject } from "../../../../Types/JSON";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";

function emptyMaintained(): MaintainedResourceKeys {
  return {
    hosts: { ids: new Set<string>(), names: new Set<string>() },
    dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
    podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
    kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
    proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
    cephClusters: { ids: new Set<string>(), names: new Set<string>() },
    iotFleets: { ids: new Set<string>(), names: new Set<string>() },
    services: { ids: new Set<string>(), names: new Set<string>() },
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
