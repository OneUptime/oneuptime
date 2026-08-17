/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer (MonitorAlert → MonitorTemplateUtil → VMAPI →
 * VMRunner). Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment — so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
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
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorClusterContextUtil from "../../../../Server/Utils/Monitor/MonitorClusterContext";
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
 * End-to-end cover for the reported bug, driven through the real alert
 * creation path.
 *
 * A metric monitor grouped by `oneuptime.host.name` opened alerts titled
 * after the host — "StarShip Green node prodgreen000002 CPU utilization >
 * 90%" — whose Affected Resources card read "No resources affected",
 * because the alert path recognised only `resource.host.name` and
 * `host.name`. The host was in the inventory the whole time.
 *
 * These tests assert on what is handed to AlertService.create, with every
 * surrounding service stubbed, and pin alert/incident parity so the two
 * paths cannot drift apart again.
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
  instance.data!.createAlerts = true;
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "CPU utilization > 90%",
      description: "A node breached the CPU threshold.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
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

describe("Alerts link the resources their series identifies", () => {
  let createdAlerts: Array<Alert> = [];
  let createdIncidents: Array<Incident> = [];

  /*
   * Rows each resource lookup should return. Defaults to "nothing in the
   * project"; a test opts a type in by setting its entry.
   */
  let hostRows: Array<{ _id: string }> = [];
  let serviceRows: Array<{ _id: string }> = [];
  let kubernetesClusterRows: Array<{ _id: string }> = [];
  let dockerHostRows: Array<{ _id: string }> = [];
  let podmanHostRows: Array<{ _id: string }> = [];
  let proxmoxClusterRows: Array<{ _id: string }> = [];
  let cephClusterRows: Array<{ _id: string }> = [];
  let dockerSwarmClusterRows: Array<{ _id: string }> = [];
  let iotFleetRows: Array<{ _id: string }> = [];

  let clusterContext: {
    proxmoxClusterIds: Array<string>;
    cephClusterIds: Array<string>;
    dockerSwarmClusterIds: Array<string>;
    iotFleetIds: Array<string>;
  };

  beforeEach(() => {
    createdAlerts = [];
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

    clusterContext = {
      proxmoxClusterIds: [],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
    };

    // No alert / incident is already open for this monitor.
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(MonitorClusterContextUtil, "resolveClusterContextForMonitor")
      .mockImplementation(async () => {
        return clusterContext;
      });

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    /*
     * The inventory lookups the linker runs. Each returns whatever the
     * test staged, so the assertions are about which relation the ids
     * land on — not about the database.
     */
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
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Alert> => {
        const alert: Alert = (createBy as { data: Alert }).data;
        createdAlerts.push(alert);
        alert._id = new ObjectID(
          "77777777-7777-4777-8777-777777777777",
        ).toString();
        return alert;
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

    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("links the host when the series is grouped by oneuptime.host.name", async () => {
    // The exact shape of the reported alert.
    hostRows = [{ _id: "host-prodgreen000002" }];

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);
    expect(idsOn(createdAlerts[0]!.hosts)).toEqual(["host-prodgreen000002"]);
  });

  it("keeps the raw series labels on the alert", async () => {
    /*
     * The "Affected Resource" key/value card reads seriesLabels straight
     * off the alert; linking must not disturb it.
     */
    hostRows = [{ _id: "host-1" }];

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdAlerts[0]!.seriesLabels).toEqual({
      "oneuptime.host.name": "prodgreen000002",
    });
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

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
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

    const alert: Alert = createdAlerts[0]!;

    expect(idsOn(alert.hosts)).toEqual(["host-1"]);
    expect(idsOn(alert.services)).toEqual(["service-1"]);
    expect(idsOn(alert.kubernetesClusters)).toEqual(["cluster-1"]);
    expect(idsOn(alert.dockerHosts)).toEqual(["docker-1"]);
    expect(idsOn(alert.podmanHosts)).toEqual(["podman-1"]);
    expect(idsOn(alert.proxmoxClusters)).toEqual(["pve-1"]);
    expect(idsOn(alert.cephClusters)).toEqual(["ceph-1"]);
    expect(idsOn(alert.dockerSwarmClusters)).toEqual(["swarm-1"]);
    expect(idsOn(alert.iotFleets)).toEqual(["fleet-1"]);
  });

  it("gives each series its own resource, with no cross-contamination", async () => {
    /*
     * One evaluation, two breaching hosts, two alerts. Each must carry
     * only its own host — the loop reuses nothing between iterations.
     */
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

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "prodgreen000002" }, "fp-1"),
        series({ "oneuptime.host.name": "prodgreen000007" }, "fp-2"),
      ],
      props: {},
    });

    expect(createdAlerts).toHaveLength(2);
    expect(idsOn(createdAlerts[0]!.hosts)).toEqual(["host-2"]);
    expect(idsOn(createdAlerts[1]!.hosts)).toEqual(["host-7"]);
  });

  it("links nothing, and still opens the alert, for an ungrouped monitor", async () => {
    /*
     * A whole-monitor alert has no series and therefore no resource
     * identity. It must not inherit one, and it must still be created.
     */
    hostRows = [{ _id: "host-1" }];

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]!.hosts).toBeUndefined();
    expect(HostService.findBy).not.toHaveBeenCalled();
  });

  it("merges the monitor's step-config cluster with the one the series names", async () => {
    /*
     * The alert path used to ASSIGN the step-config clusters over
     * whatever was already there. With both paths now able to resolve a
     * Proxmox cluster, an assignment would drop one of them.
     */
    proxmoxClusterRows = [{ _id: "pve-from-label" }];
    clusterContext = {
      proxmoxClusterIds: ["pve-from-step-config"],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
    };

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series({ "proxmox.cluster.name": "pve" }, "fp-1")],
      props: {},
    });

    expect(idsOn(createdAlerts[0]!.proxmoxClusters).sort()).toEqual([
      "pve-from-label",
      "pve-from-step-config",
    ]);
  });

  it("still attaches the step-config cluster to an ungrouped alert", async () => {
    clusterContext = {
      proxmoxClusterIds: [],
      cephClusterIds: ["ceph-1"],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
    };

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Ceph health is in error",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(idsOn(createdAlerts[0]!.cephClusters)).toEqual(["ceph-1"]);
  });

  it("leaves the alert unlinked when the resource is not in this project", async () => {
    // The lookup is project-scoped, so an unknown host resolves to nothing.
    hostRows = [];

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [
        series({ "oneuptime.host.name": "elsewhere" }, "fp-1"),
      ],
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]!.hosts).toBeUndefined();
  });

  it("scopes the inventory lookup to the monitor's project", async () => {
    hostRows = [{ _id: "host-1" }];

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
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

  it("links an incident and an alert from the same series identically", async () => {
    /*
     * The parity that keeps the two creation paths honest. Before the
     * shared linker, the incident here linked the host and the alert did
     * not.
     */
    hostRows = [{ _id: "host-1" }];
    serviceRows = [{ _id: "service-1" }];

    const labels: JSONObject = {
      "oneuptime.host.name": "prodgreen000002",
      "oneuptime.service.name": "checkout",
    };

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series(labels, "fp-1")],
      props: {},
    });

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "CPU is above 90%",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: [series(labels, "fp-1")],
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);
    expect(createdIncidents).toHaveLength(1);

    expect(idsOn(createdAlerts[0]!.hosts)).toEqual(
      idsOn(createdIncidents[0]!.hosts),
    );
    expect(idsOn(createdAlerts[0]!.services)).toEqual(
      idsOn(createdIncidents[0]!.services),
    );
  });
});
