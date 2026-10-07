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

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import logger from "../../../../Server/Utils/Logger";
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
import type { Mock, SpyInstance } from "jest-mock";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";

/*
 * A monitor can say what it watches (Monitor > Overview > Linked
 * Resources). A website or API monitor's own configuration names no
 * cluster, host or service, so before this an incident it raised - "the
 * site is down" - was linked to nothing: OneUptime AI's investigation
 * could not run kubectl, and the cluster's AI fix never started.
 *
 * Contract under test:
 *   - every incident and alert a monitor creates carries what the monitor
 *     is linked to, merged with what its configuration and series name,
 *     without duplicates;
 *   - the links are read only when a record is really being created, and
 *     at most once per evaluation however many records it opens - a
 *     monitor that stays down keeps evaluating;
 *   - a failed read links nothing and still creates the record: this runs
 *     in the probe and telemetry workers, where a throw retries the job;
 *   - the read goes through LinkedAffectedResources (one query per
 *     relation, project-checked) and maps every linked type onto the
 *     resolved-ids shape the linker merges.
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
const CLUSTER_ID: string = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const OTHER_CLUSTER_ID: string = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const SERVICE_ID: string = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";

function websiteMonitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Website;
  model.name = "Checkout website";
  return model;
}

function criteriaInstance(options?: {
  createIncidents?: boolean;
  createAlerts?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Website is down";
  instance.data!.createIncidents = options?.createIncidents ?? true;
  instance.data!.createAlerts = options?.createAlerts ?? true;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Checkout website is down",
      description: "The website returned 502.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Checkout website is down",
      description: "The website returned 502.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-10-05T03:33:00.000Z"),
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function series(fingerprint: string): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: "criteria-1",
    fingerprint: fingerprint,
    labels: { region: fingerprint } as JSONObject,
    rootCause: "The website returned 502",
  };
}

function idsOn(
  relation: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (relation || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

function resolved(
  overrides: Partial<SeriesResolvedResourceIds> = {},
): SeriesResolvedResourceIds {
  return { ...MonitorResourceContextUtil.emptyContext(), ...overrides };
}

describe("Incidents and alerts inherit what their monitor is linked to", () => {
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];
  let stepContext: SeriesResolvedResourceIds;
  let linkedContext: SeriesResolvedResourceIds;
  let readLinks: SpyInstance<
    typeof MonitorResourceContextUtil.resolveLinkedResourcesForMonitor
  >;

  beforeEach(() => {
    /*
     * The project's incident and alert states: open records are read by
     * the states that are not resolved (Common/Utils/ResolvedState).
     */
    mockProjectStates();
    createdIncidents = [];
    createdAlerts = [];
    stepContext = resolved();
    linkedContext = resolved();

    // No incident or alert is already open for this monitor.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockImplementation(async () => {
        return stepContext;
      });

    readLinks = jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockImplementation(async () => {
        return linkedContext;
      });

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

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

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function evaluateIncidents(options?: {
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
    createIncidents?: boolean;
  }): Promise<void> {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: options?.createIncidents ?? true,
      }),
      monitor: websiteMonitor(),
      dataToProcess: dataToProcess,
      rootCause: "The website returned 502",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: options?.matchesPerSeries,
      props: {},
    });
  }

  async function evaluateAlerts(options?: {
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
    createAlerts?: boolean;
  }): Promise<void> {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createAlerts: options?.createAlerts ?? true,
      }),
      monitor: websiteMonitor(),
      dataToProcess: dataToProcess,
      rootCause: "The website returned 502",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      matchesPerSeries: options?.matchesPerSeries,
      props: {},
    });
  }

  it("links a website monitor's incident to the cluster and service the monitor is linked to", async () => {
    linkedContext = resolved({
      kubernetesClusterIds: [CLUSTER_ID],
      serviceIds: [SERVICE_ID],
    });

    await evaluateIncidents();

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.kubernetesClusters)).toEqual([
      CLUSTER_ID,
    ]);
    expect(idsOn(createdIncidents[0]!.services)).toEqual([SERVICE_ID]);
    expect(readLinks).toHaveBeenCalledTimes(1);
    expect(readLinks.mock.calls[0]![0].monitor.id?.toString()).toBe(
      MONITOR_ID.toString(),
    );
  });

  it("links every resource type a monitor can be linked to", async () => {
    linkedContext = resolved({
      hostIds: ["h-1"],
      kubernetesClusterIds: ["k-1"],
      dockerHostIds: ["d-1"],
      podmanHostIds: ["p-1"],
      proxmoxClusterIds: ["px-1"],
      vmwareVCenterIds: ["v-1"],
      cephClusterIds: ["ceph-1"],
      storageArrayIds: ["array-1"],
      dockerSwarmClusterIds: ["sw-1"],
      iotFleetIds: ["iot-1"],
      databaseServerIds: ["db-1"],
      serviceIds: ["svc-1"],
    });

    await evaluateIncidents();

    const incident: Incident = createdIncidents[0]!;
    expect(idsOn(incident.hosts)).toEqual(["h-1"]);
    expect(idsOn(incident.kubernetesClusters)).toEqual(["k-1"]);
    expect(idsOn(incident.dockerHosts)).toEqual(["d-1"]);
    expect(idsOn(incident.podmanHosts)).toEqual(["p-1"]);
    expect(idsOn(incident.proxmoxClusters)).toEqual(["px-1"]);
    expect(idsOn(incident.vmwareVCenters)).toEqual(["v-1"]);
    expect(idsOn(incident.cephClusters)).toEqual(["ceph-1"]);
    expect(idsOn(incident.storageArrays)).toEqual(["array-1"]);
    expect(idsOn(incident.dockerSwarmClusters)).toEqual(["sw-1"]);
    expect(idsOn(incident.iotFleets)).toEqual(["iot-1"]);
    expect(idsOn(incident.databaseServers)).toEqual(["db-1"]);
    expect(idsOn(incident.services)).toEqual(["svc-1"]);
  });

  it("merges the links with the monitor's config resources, without duplicates", async () => {
    stepContext = resolved({ kubernetesClusterIds: [CLUSTER_ID] });
    linkedContext = resolved({
      kubernetesClusterIds: [CLUSTER_ID, OTHER_CLUSTER_ID],
    });

    await evaluateIncidents();

    expect(idsOn(createdIncidents[0]!.kubernetesClusters)).toEqual([
      CLUSTER_ID,
      OTHER_CLUSTER_ID,
    ]);
  });

  it("reads the links once per evaluation, however many incidents it opens", async () => {
    linkedContext = resolved({ kubernetesClusterIds: [CLUSTER_ID] });

    await evaluateIncidents({
      matchesPerSeries: [series("eu"), series("us")],
    });

    expect(createdIncidents).toHaveLength(2);
    expect(readLinks).toHaveBeenCalledTimes(1);

    for (const incident of createdIncidents) {
      expect(idsOn(incident.kubernetesClusters)).toEqual([CLUSTER_ID]);
    }
  });

  it("does not read the links when the criteria creates no incident", async () => {
    await evaluateIncidents({ createIncidents: false });

    expect(createdIncidents).toHaveLength(0);
    expect(readLinks).not.toHaveBeenCalled();
  });

  it("does not read the links when a grouped evaluation has no breaching series", async () => {
    await evaluateIncidents({ matchesPerSeries: [] });

    expect(createdIncidents).toHaveLength(0);
    expect(readLinks).not.toHaveBeenCalled();
  });

  it("still creates the incident, unlinked, when reading the links fails", async () => {
    readLinks.mockRestore();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(LinkedAffectedResources, "readForMonitors")
      .mockRejectedValue(new Error("database is down"));

    await evaluateIncidents();

    expect(createdIncidents).toHaveLength(1);
    expect(idsOn(createdIncidents[0]!.kubernetesClusters)).toEqual([]);
  });

  it("links a website monitor's alert to what the monitor is linked to", async () => {
    linkedContext = resolved({
      kubernetesClusterIds: [CLUSTER_ID],
      databaseServerIds: ["db-1"],
    });

    await evaluateAlerts();

    expect(createdAlerts).toHaveLength(1);
    expect(idsOn(createdAlerts[0]!.kubernetesClusters)).toEqual([CLUSTER_ID]);
    expect(idsOn(createdAlerts[0]!.databaseServers)).toEqual(["db-1"]);
  });

  it("reads an alert evaluation's links once, however many alerts it opens", async () => {
    linkedContext = resolved({ kubernetesClusterIds: [CLUSTER_ID] });

    await evaluateAlerts({ matchesPerSeries: [series("eu"), series("us")] });

    expect(createdAlerts).toHaveLength(2);
    expect(readLinks).toHaveBeenCalledTimes(1);

    for (const alert of createdAlerts) {
      expect(idsOn(alert.kubernetesClusters)).toEqual([CLUSTER_ID]);
    }
  });

  it("does not read the links when the criteria creates no alert", async () => {
    await evaluateAlerts({ createAlerts: false });

    expect(createdAlerts).toHaveLength(0);
    expect(readLinks).not.toHaveBeenCalled();
  });
});

describe("MonitorResourceContextUtil.resolveLinkedResourcesForMonitor", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function linked(
    type: LinkedAffectedResourceType,
    id: string,
  ): LinkedAffectedResource {
    return { type, id, name: `${type} ${id}` };
  }

  it("maps every kind of linked resource onto its resolved list", async () => {
    const read: SpyInstance<typeof LinkedAffectedResources.readForMonitors> =
      jest
        .spyOn(LinkedAffectedResources, "readForMonitors")
        .mockResolvedValue([
          linked(LinkedAffectedResourceType.Host, "h-1"),
          linked(LinkedAffectedResourceType.KubernetesCluster, "k-1"),
          linked(LinkedAffectedResourceType.DockerHost, "d-1"),
          linked(LinkedAffectedResourceType.PodmanHost, "p-1"),
          linked(LinkedAffectedResourceType.ProxmoxCluster, "px-1"),
          linked(LinkedAffectedResourceType.VMwareVCenter, "v-1"),
          linked(LinkedAffectedResourceType.CephCluster, "ceph-1"),
          linked(LinkedAffectedResourceType.StorageArray, "array-1"),
          linked(LinkedAffectedResourceType.DockerSwarmCluster, "sw-1"),
          linked(LinkedAffectedResourceType.IoTFleet, "iot-1"),
          linked(LinkedAffectedResourceType.DatabaseServer, "db-1"),
          linked(LinkedAffectedResourceType.Service, "svc-1"),
        ]);

    const result: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: websiteMonitor(),
      });

    expect(result).toEqual({
      hostIds: ["h-1"],
      kubernetesClusterIds: ["k-1"],
      dockerHostIds: ["d-1"],
      podmanHostIds: ["p-1"],
      proxmoxClusterIds: ["px-1"],
      vmwareVCenterIds: ["v-1"],
      cephClusterIds: ["ceph-1"],
      storageArrayIds: ["array-1"],
      dockerSwarmClusterIds: ["sw-1"],
      iotFleetIds: ["iot-1"],
      databaseServerIds: ["db-1"],
      serviceIds: ["svc-1"],
    });

    // One read, of this monitor, in its own project, through the monitors.
    expect(read).toHaveBeenCalledTimes(1);
    const args: Parameters<typeof LinkedAffectedResources.readForMonitors>[0] =
      read.mock.calls[0]![0];
    expect(args.service).toBe(MonitorService);
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      args.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  it("lists a resource once even if it is read twice", async () => {
    jest
      .spyOn(LinkedAffectedResources, "readForMonitors")
      .mockResolvedValue([
        linked(LinkedAffectedResourceType.KubernetesCluster, "k-1"),
        linked(LinkedAffectedResourceType.KubernetesCluster, "k-1"),
      ]);

    const result: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: websiteMonitor(),
      });

    expect(result.kubernetesClusterIds).toEqual(["k-1"]);
  });

  it("ignores linked kinds a monitor-made record cannot hold (monitors, SLOs, network sites)", async () => {
    jest
      .spyOn(LinkedAffectedResources, "readForMonitors")
      .mockResolvedValue([
        linked(LinkedAffectedResourceType.Monitor, "m-1"),
        linked(LinkedAffectedResourceType.ServiceLevelObjective, "slo-1"),
        linked(LinkedAffectedResourceType.NetworkSite, "site-1"),
      ]);

    const result: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: websiteMonitor(),
      });

    expect(result).toEqual(MonitorResourceContextUtil.emptyContext());
  });

  it("reads nothing for a monitor without an id or a project", async () => {
    const read: SpyInstance<typeof LinkedAffectedResources.readForMonitors> =
      jest.spyOn(LinkedAffectedResources, "readForMonitors");

    const withoutProject: Monitor = websiteMonitor();
    delete withoutProject.projectId;
    const withoutId: Monitor = websiteMonitor();
    delete withoutId._id;

    expect(
      await MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: withoutProject,
      }),
    ).toEqual(MonitorResourceContextUtil.emptyContext());
    expect(
      await MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: withoutId,
      }),
    ).toEqual(MonitorResourceContextUtil.emptyContext());
    expect(read).not.toHaveBeenCalled();
  });

  it("returns an empty context instead of throwing when the read fails", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(LinkedAffectedResources, "readForMonitors")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
        monitor: websiteMonitor(),
      }),
    ).resolves.toEqual(MonitorResourceContextUtil.emptyContext());
  });
});

describe("LinkedAffectedResources.readForMonitors", () => {
  it("reads each of a monitor's relations on its own, in the project, and keeps only its project's rows", async () => {
    const calls: Array<JSONObject> = [];

    const reader: { findAllBy: (args: unknown) => Promise<Array<Monitor>> } = {
      findAllBy: async (args: unknown): Promise<Array<Monitor>> => {
        calls.push(args as JSONObject);
        const select: JSONObject = (args as { select: JSONObject }).select;

        if (select["kubernetesClusters"]) {
          return [
            {
              _id: MONITOR_ID.toString(),
              projectId: PROJECT_ID,
              kubernetesClusters: [
                { _id: CLUSTER_ID, name: "prod-east", projectId: PROJECT_ID },
                {
                  _id: OTHER_CLUSTER_ID,
                  name: "someone-elses",
                  projectId: new ObjectID(
                    "99999999-9999-4999-8999-999999999999",
                  ),
                },
              ],
            } as unknown as Monitor,
          ];
        }

        if (select["services"]) {
          return [
            {
              _id: MONITOR_ID.toString(),
              projectId: PROJECT_ID,
              services: [
                { _id: SERVICE_ID, name: "checkout", projectId: PROJECT_ID },
              ],
            } as unknown as Monitor,
          ];
        }

        return [];
      },
    };

    const resources: Array<LinkedAffectedResource> =
      await LinkedAffectedResources.readForMonitors({
        service: reader as never,
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_ID],
      });

    expect(resources).toEqual([
      {
        type: LinkedAffectedResourceType.KubernetesCluster,
        id: CLUSTER_ID,
        name: "prod-east",
      },
      {
        type: LinkedAffectedResourceType.Service,
        id: SERVICE_ID,
        name: "checkout",
      },
    ]);

    // One query per relation a monitor has: the twelve linkable kinds.
    const columns: Array<string> = calls.map((call: JSONObject): string => {
      return Object.keys(call["select"] as JSONObject).find((key: string) => {
        return key !== "_id" && key !== "projectId";
      })!;
    });
    expect(columns.sort()).toEqual(
      [
        "cephClusters",
        "databaseServers",
        "dockerHosts",
        "dockerSwarmClusters",
        "hosts",
        "iotFleets",
        "kubernetesClusters",
        "podmanHosts",
        "proxmoxClusters",
        "services",
        "storageArrays",
        "vmwareVCenters",
      ].sort(),
    );

    for (const call of calls) {
      expect(String((call["query"] as JSONObject)["projectId"])).toBe(
        PROJECT_ID.toString(),
      );
      expect((call["props"] as JSONObject)["isRoot"]).toBe(true);
    }
  });

  it("reads nothing for no monitors", async () => {
    const findAllBy: Mock<() => Promise<Array<Monitor>>> = jest.fn(
      async (): Promise<Array<Monitor>> => {
        return [];
      },
    );

    await expect(
      LinkedAffectedResources.readForMonitors({
        service: { findAllBy } as never,
        projectId: PROJECT_ID,
        monitorIds: [],
      }),
    ).resolves.toEqual([]);
    expect(findAllBy).not.toHaveBeenCalled();
  });
});
