/*
 * The incident creation path pulls the native isolated-vm addon through
 * its template renderer (MonitorIncident → MonitorTemplateUtil → VMAPI →
 * VMRunner). Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment — so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The incident half of the series-resource-linking contract, driven
 * through the real incident creation path.
 *
 * Incidents were never affected by the alert bug — they already resolved
 * every host spelling through the shared SeriesResourceLabels key map,
 * including `oneuptime.host.name`. The first test pins that, so a future
 * refactor cannot quietly take it away.
 *
 * They did share three narrower gaps with alerts, and each of the next
 * three tests fails on the pre-fix code:
 *   - `oneuptime.service.name` was absent from the service key list even
 *     though ingest stamps it alongside `oneuptime.service.id`;
 *   - IoT fleet names were extracted into the refs and then dropped —
 *     nothing ever resolved them;
 *   - Docker Swarm clusters had no key at all, so a monitor grouped by
 *     the attribute the Swarm agent stamps linked nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "StarShip Green node performance CPU";
  return model;
}

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "CPU utilization > 90%";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "CPU utilization > 90%",
      description: "A node breached the CPU threshold.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-08-13T03:33:00.000Z"),
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function series(
  labels: JSONObject,
  fingerprint: string,
): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: "criteria-1",
    fingerprint: fingerprint,
    labels: labels,
    rootCause: "CPU is above 90%",
  };
}

function idsOn(
  relation: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (relation || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

/*
 * The nine-relation shape MonitorResourceContext resolves from the
 * monitor's own step config. Tests stub the util and hand back one of
 * these, spreading over it to name only the relations under test.
 */
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

describe("Incidents link the resources their series identifies", () => {
  let createdIncidents: Array<Incident> = [];

  let hostRows: Array<{ _id: string }> = [];
  let serviceRows: Array<{ _id: string }> = [];
  let kubernetesClusterRows: Array<{ _id: string }> = [];
  let dockerHostRows: Array<{ _id: string }> = [];
  let podmanHostRows: Array<{ _id: string }> = [];
  let proxmoxClusterRows: Array<{ _id: string }> = [];
  let cephClusterRows: Array<{ _id: string }> = [];
  let dockerSwarmClusterRows: Array<{ _id: string }> = [];
  let iotFleetRows: Array<{ _id: string }> = [];

  let resourceContext: SeriesResolvedResourceIds;

  beforeEach(() => {
    createdIncidents = [];

    hostRows = [];
    serviceRows = [];
    kubernetesClusterRows = [];
    dockerHostRows = [];
    podmanHostRows = [];
    proxmoxClusterRows = [];
    cephClusterRows = [];
    dockerSwarmClusterRows = [];
    iotFleetRows = [];

    resourceContext = emptyResourceContext();

    // No incident is already open for this monitor.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockImplementation(async () => {
        return resourceContext;
      });

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    jest.spyOn(HostService, "findBy").mockImplementation(async () => {
      return hostRows as never;
    });
    jest.spyOn(ServiceService, "findBy").mockImplementation(async () => {
      return serviceRows as never;
    });
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockImplementation(async () => {
        return kubernetesClusterRows as never;
      });
    jest.spyOn(DockerHostService, "findBy").mockImplementation(async () => {
      return dockerHostRows as never;
    });
    jest.spyOn(PodmanHostService, "findBy").mockImplementation(async () => {
      return podmanHostRows as never;
    });
    jest.spyOn(ProxmoxClusterService, "findBy").mockImplementation(async () => {
      return proxmoxClusterRows as never;
    });
    jest.spyOn(CephClusterService, "findBy").mockImplementation(async () => {
      return cephClusterRows as never;
    });
    jest
      .spyOn(DockerSwarmClusterService, "findBy")
      .mockImplementation(async () => {
        return dockerSwarmClusterRows as never;
      });
    jest.spyOn(IoTFleetService, "findBy").mockImplementation(async () => {
      return iotFleetRows as never;
    });

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        createdIncidents.push(incident);
        incident._id = new ObjectID(
          "66666666-6666-4666-8666-666666666666",
        ).toString();
        return incident;
      });

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("links the host when the series is grouped by oneuptime.host.name", async () => {
    /*
     * The spelling that broke alerts. Incidents always handled it — this
     * test exists to keep it that way.
     */
    hostRows = [{ _id: "host-prodgreen000002" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.hosts)).toEqual(["host-prodgreen000002"]);
  });

  it.each([
    ["resource.oneuptime.host.name"],
    ["oneuptime.host.name"],
    ["resource.host.name"],
    ["host.name"],
  ])("links the host from the %s spelling", async (key: string) => {
    hostRows = [{ _id: "host-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ [key]: "web-1" }, "fp-1")],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.hosts)).toEqual(["host-1"]);
  });

  it("links the service from the oneuptime-stamped service name", async () => {
    // Gap shared with alerts: the key was missing from the service list.
    serviceRows = [{ _id: "service-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.service.name": "checkout" }, "fp-1"),
      ],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.services)).toEqual(["service-1"]);
  });

  it("links the IoT fleet the series names", async () => {
    /*
     * Gap shared with alerts: iotFleetNames was extracted from the
     * labels and then never resolved by either creation path.
     */
    iotFleetRows = [{ _id: "fleet-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Fleet battery is low",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "iot.fleet.name": "warehouse-sensors" }, "fp-1"),
      ],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.iotFleets)).toEqual(["fleet-1"]);
  });

  it("links the docker swarm cluster the series names", async () => {
    // Gap shared with alerts: no swarm key existed in the map at all.
    dockerSwarmClusterRows = [{ _id: "swarm-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Swarm service is down",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "docker.swarm.cluster.name": "prod-swarm" }, "fp-1"),
      ],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.dockerSwarmClusters)).toEqual([
      "swarm-1",
    ]);
  });

  it("links every resource type one series names", async () => {
    hostRows = [{ _id: "host-1" }];
    serviceRows = [{ _id: "service-1" }];
    kubernetesClusterRows = [{ _id: "cluster-1" }];
    dockerHostRows = [{ _id: "docker-1" }];
    podmanHostRows = [{ _id: "podman-1" }];
    proxmoxClusterRows = [{ _id: "pve-1" }];
    cephClusterRows = [{ _id: "ceph-1" }];
    dockerSwarmClusterRows = [{ _id: "swarm-1" }];
    iotFleetRows = [{ _id: "fleet-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series(
          {
            "oneuptime.host.name": "web-1",
            "oneuptime.service.name": "checkout",
            "k8s.cluster.name": "prod",
            "oneuptime.docker.host.name": "docker-box",
            "oneuptime.podman.host.name": "podman-box",
            "proxmox.cluster.name": "pve",
            "ceph.cluster.name": "ceph",
            "docker.swarm.cluster.name": "swarm",
            "iot.fleet.name": "fleet",
          },
          "fp-1",
        ),
      ],
      props: {},
    });

    const incident: Incident = createdIncidents[0]!;

    expect(idsOn(incident.hosts)).toEqual(["host-1"]);
    expect(idsOn(incident.services)).toEqual(["service-1"]);
    expect(idsOn(incident.kubernetesClusters)).toEqual(["cluster-1"]);
    expect(idsOn(incident.dockerHosts)).toEqual(["docker-1"]);
    expect(idsOn(incident.podmanHosts)).toEqual(["podman-1"]);
    expect(idsOn(incident.proxmoxClusters)).toEqual(["pve-1"]);
    expect(idsOn(incident.cephClusters)).toEqual(["ceph-1"]);
    expect(idsOn(incident.dockerSwarmClusters)).toEqual(["swarm-1"]);
    expect(idsOn(incident.iotFleets)).toEqual(["fleet-1"]);
  });

  it("gives each series its own resource, with no cross-contamination", async () => {
    const hostByName: Record<string, string> = {
      prodgreen000002: "host-2",
      prodgreen000007: "host-7",
    };

    jest.spyOn(HostService, "findBy").mockImplementation((async (
      args: unknown,
    ): Promise<Array<{ _id: string | undefined }>> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      const includes: { values?: Array<string> } = query["hostIdentifier"] as {
        values?: Array<string>;
      };
      const name: string = String((includes.values || [])[0]);
      return [{ _id: hostByName[name] }];
    }) as never);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
        series({ "oneuptime.host.name": "prodgreen000007" }, "fp-2"),
      ],
      props: {},
    });

    expect(createdIncidents).toHaveLength(2);
    expect(idsOn(createdIncidents[0]!.hosts)).toEqual(["host-2"]);
    expect(idsOn(createdIncidents[1]!.hosts)).toEqual(["host-7"]);
  });

  it("links nothing from LABELS, and still opens the incident, for an ungrouped monitor", async () => {
    /*
     * A whole-monitor incident has no series, so the label path has
     * nothing to work with. It must not invent an identity from another
     * series, and it must still be created. (The step-config path can
     * still name a resource here — that is the test above; this one
     * pins that the label path alone contributes nothing.)
     */
    hostRows = [{ _id: "host-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.hosts).toBeUndefined();
    expect(HostService.findBy).not.toHaveBeenCalled();
  });

  it("merges the monitor's step-config cluster with the one the series names", async () => {
    proxmoxClusterRows = [{ _id: "pve-from-label" }];
    resourceContext = {
      ...emptyResourceContext(),
      proxmoxClusterIds: ["pve-from-step-config"],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ "proxmox.cluster.name": "pve" }, "fp-1")],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.proxmoxClusters).sort()).toEqual([
      "pve-from-label",
      "pve-from-step-config",
    ]);
  });

  it("links the service an ungrouped metric monitor is scoped to", async () => {
    /*
     * THE REPORTED BUG. The alert twin of this came from a Metrics monitor whose only
     * resource identity was the attribute filter
     * `oneuptime.service.name = app-plan-starship-online-production`.
     * It is ungrouped, so there are no series labels and the label path
     * links nothing — the incident's "Affected Resources" card read "No
     * resources affected" even though the monitor named the service.
     *
     * `matchesPerSeries` is deliberately omitted: that is what makes
     * this the ungrouped path.
     */
    resourceContext = {
      ...emptyResourceContext(),
      serviceIds: ["service-1"],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Memory is above 60%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.services)).toEqual(["service-1"]);
  });

  it("links the host an ungrouped host monitor is scoped to", async () => {
    // Same shape for the infra types: the step config names the host.
    resourceContext = {
      ...emptyResourceContext(),
      hostIds: ["host-1"],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.hosts)).toEqual(["host-1"]);
  });

  it("merges the step-config service with the one the series names", async () => {
    /*
     * A grouped monitor can resolve a service from its labels while the
     * step config names another. Neither may erase the other.
     */
    serviceRows = [{ _id: "service-from-label" }];
    resourceContext = {
      ...emptyResourceContext(),
      serviceIds: ["service-from-step-config"],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ "service.name": "checkout-api" }, "fp-1")],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.services).sort()).toEqual([
      "service-from-label",
      "service-from-step-config",
    ]);
  });

  it("dedupes a service both paths resolved", async () => {
    serviceRows = [{ _id: "service-1" }];
    resourceContext = {
      ...emptyResourceContext(),
      serviceIds: ["service-1"],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ "service.name": "checkout-api" }, "fp-1")],
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.services)).toEqual(["service-1"]);
  });

  it("attaches the step-config resources to EVERY incident of a grouped monitor", async () => {
    /*
     * One evaluation, two breaching series, one shared monitor config.
     * Both incidents are about the same service.
     */
    hostRows = [{ _id: "host-2" }];
    resourceContext = {
      ...emptyResourceContext(),
      serviceIds: ["service-1"],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "host.name": "node-a" }, "fp-1"),
        series({ "host.name": "node-b" }, "fp-2"),
      ],
      props: {},
    });

    expect(createdIncidents).toHaveLength(2);
    expect(idsOn(createdIncidents[0]!.services)).toEqual(["service-1"]);
    expect(idsOn(createdIncidents[1]!.services)).toEqual(["service-1"]);
  });

  it("still attaches the step-config cluster to an ungrouped incident", async () => {
    resourceContext = {
      ...emptyResourceContext(),
      proxmoxClusterIds: [],
      cephClusterIds: ["ceph-1"],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
    };

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Ceph health is in error",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(idsOn(createdIncidents[0]!.cephClusters)).toEqual(["ceph-1"]);
  });

  it("leaves the incident unlinked when the resource is not in this project", async () => {
    hostRows = [];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "elsewhere" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.hosts).toBeUndefined();
  });

  it("scopes the inventory lookup to the monitor's project", async () => {
    hostRows = [{ _id: "host-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ "oneuptime.host.name": "web-1" }, "fp-1")],
      props: {},
    });

    const call: { query: JSONObject } = (
      HostService.findBy as unknown as {
        mock: { calls: Array<Array<{ query: JSONObject }>> };
      }
    ).mock.calls[0]![0]!;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
  });

  it("keeps the raw series labels on the incident", async () => {
    hostRows = [{ _id: "host-1" }];

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdIncidents[0]!.seriesLabels).toEqual({
      "oneuptime.host.name": "prodgreen000002",
    });
  });
});
