import { describe, expect, test } from "@jest/globals";
import {
  ALERT_PREFILL_PAYLOAD_KEYS,
  buildPrefillPayload,
  getLinkedResourcesOfMonitors,
  getLinkedResourcesToAdd,
  getPrefilledResourcesStillPresent,
  INCIDENT_PREFILL_PAYLOAD_KEYS,
  MONITOR_LINKED_RESOURCE_KEYS,
  MONITOR_LINKED_RESOURCE_TYPES,
  MONITOR_LINKED_RESOURCES_SELECT,
  MonitorLinkedResource,
  SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/MonitorLinkedResourcesPrefillRules";
import { AffectedResourcesPayload } from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";

/*
 * Prefilling a new incident's, alert's or maintenance event's Other
 * Affected Resources from what its monitors are linked to:
 *
 * - a monitor can be linked to exactly what an incident's Other Affected
 *   Resources offers, and each monitor is read with all of it, named;
 * - the linked resources are listed once each, in the order the monitors
 *   name them, and only those the form does not hold yet are added;
 * - the payload handed to the field keeps everything the form holds,
 *   network sites on a maintenance event included, adds the rest, and
 *   never touches the monitors - the other picker's;
 * - the payload a pick leaves in the anchor field for a moment is read as
 *   what the form holds;
 * - the line under the field names only what is still there.
 */

const CLUSTER_ID: string = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const OTHER_CLUSTER_ID: string = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const SERVICE_ID: string = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";
const HOST_ID: string = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SITE_ID: string = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";

function linked(
  key: MonitorLinkedResource["key"],
  id: string,
  name: string,
): MonitorLinkedResource {
  return { key, id, name };
}

describe("what a monitor can be linked to", () => {
  test("is an incident's Other Affected Resources, all read with their names", () => {
    expect(MONITOR_LINKED_RESOURCE_TYPES).toEqual([
      "Host",
      "KubernetesCluster",
      "DockerHost",
      "PodmanHost",
      "ProxmoxCluster",
      "VMwareVCenter",
      "CephCluster",
      "DockerSwarmCluster",
      "IoTFleet",
      "DatabaseServer",
      "Service",
    ]);

    for (const key of MONITOR_LINKED_RESOURCE_KEYS) {
      expect(MONITOR_LINKED_RESOURCES_SELECT[key]).toEqual({
        _id: true,
        name: true,
      });
    }
    expect(Object.keys(MONITOR_LINKED_RESOURCES_SELECT)).toHaveLength(
      MONITOR_LINKED_RESOURCE_KEYS.length + 1,
    );
  });

  test("each create form's field writes the linked kinds, and maintenance its network sites too", () => {
    expect(INCIDENT_PREFILL_PAYLOAD_KEYS).toEqual(MONITOR_LINKED_RESOURCE_KEYS);
    expect(ALERT_PREFILL_PAYLOAD_KEYS).toEqual(MONITOR_LINKED_RESOURCE_KEYS);
    expect(SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS).toEqual([
      ...MONITOR_LINKED_RESOURCE_KEYS,
      "networkSites",
    ]);
  });
});

describe("getLinkedResourcesOfMonitors", () => {
  test("lists each linked resource once, in the order the monitors name them", () => {
    expect(
      getLinkedResourcesOfMonitors([
        {
          _id: MONITOR_ID,
          kubernetesClusters: [{ _id: CLUSTER_ID, name: "prod-east" }],
          services: [{ _id: SERVICE_ID.toUpperCase(), name: "checkout" }],
        },
        {
          _id: "other-monitor",
          kubernetesClusters: [
            { _id: CLUSTER_ID, name: "prod-east" },
            { _id: OTHER_CLUSTER_ID, name: "prod-west" },
          ],
          hosts: [{ _id: HOST_ID }],
        },
      ]),
    ).toEqual([
      // The first monitor's, then the second's new ones.
      linked("kubernetesClusters", CLUSTER_ID, "prod-east"),
      linked("services", SERVICE_ID, "checkout"),
      linked("hosts", HOST_ID, ""),
      linked("kubernetesClusters", OTHER_CLUSTER_ID, "prod-west"),
    ]);
  });

  test("ignores what is not a linked resource row", () => {
    expect(
      getLinkedResourcesOfMonitors([
        null,
        "monitor",
        {
          kubernetesClusters: [null, { name: "no id" }, "id-only"],
          labels: [{ _id: "label-1", name: "production" }],
          services: "not a list",
        },
      ]),
    ).toEqual([]);
  });
});

describe("getLinkedResourcesToAdd", () => {
  test("adds only what the form does not hold, whatever shape it holds it in", () => {
    const toAdd: Array<MonitorLinkedResource> = getLinkedResourcesToAdd({
      values: {
        kubernetesClusters: [CLUSTER_ID.toUpperCase()],
        services: [{ _id: SERVICE_ID, name: "checkout" }],
      },
      linked: [
        linked("kubernetesClusters", CLUSTER_ID, "prod-east"),
        linked("kubernetesClusters", OTHER_CLUSTER_ID, "prod-west"),
        linked("services", SERVICE_ID, "checkout"),
        linked("hosts", HOST_ID, "web-1"),
      ],
    });

    expect(toAdd).toEqual([
      linked("kubernetesClusters", OTHER_CLUSTER_ID, "prod-west"),
      linked("hosts", HOST_ID, "web-1"),
    ]);
  });

  test("reads a pick's pending payload as what the form holds", () => {
    const pending: AffectedResourcesPayload = {
      __affectedResourcesPayload: true,
      monitors: undefined,
      hosts: [],
      kubernetesClusters: [CLUSTER_ID],
      dockerHosts: [],
      podmanHosts: [],
      proxmoxClusters: [],
      vmwareVCenters: [],
      cephClusters: [],
      dockerSwarmClusters: [],
      iotFleets: [],
      databaseServers: [],
      networkSites: undefined,
      services: [],
    };

    expect(
      getLinkedResourcesToAdd({
        values: { hosts: pending, kubernetesClusters: [] },
        linked: [linked("kubernetesClusters", CLUSTER_ID, "prod-east")],
      }),
    ).toEqual([]);
  });
});

describe("buildPrefillPayload", () => {
  test("keeps what the form holds, adds the rest, and leaves the monitors alone", () => {
    const payload: AffectedResourcesPayload = buildPrefillPayload({
      values: {
        monitors: [MONITOR_ID],
        kubernetesClusters: [{ _id: CLUSTER_ID, name: "prod-east" }],
        hosts: undefined,
      },
      toAdd: [
        linked("kubernetesClusters", OTHER_CLUSTER_ID, "prod-west"),
        linked("services", SERVICE_ID, "checkout"),
      ],
      payloadKeys: INCIDENT_PREFILL_PAYLOAD_KEYS,
    });

    expect(payload.__affectedResourcesPayload).toBe(true);
    expect(payload.monitors).toBeUndefined();
    expect(payload.kubernetesClusters).toEqual([CLUSTER_ID, OTHER_CLUSTER_ID]);
    expect(payload.services).toEqual([SERVICE_ID]);
    expect(payload.hosts).toEqual([]);
    expect(payload.databaseServers).toEqual([]);
    // Not a field the incident form writes.
    expect(payload.networkSites).toBeUndefined();
  });

  test("keeps a maintenance event's network sites", () => {
    const payload: AffectedResourcesPayload = buildPrefillPayload({
      values: { networkSites: [{ _id: SITE_ID }] },
      toAdd: [linked("kubernetesClusters", CLUSTER_ID, "prod-east")],
      payloadKeys: SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS,
    });

    expect(payload.networkSites).toEqual([SITE_ID]);
    expect(payload.kubernetesClusters).toEqual([CLUSTER_ID]);
  });

  test("never adds what the form already holds", () => {
    const payload: AffectedResourcesPayload = buildPrefillPayload({
      values: { kubernetesClusters: [CLUSTER_ID] },
      toAdd: [linked("kubernetesClusters", CLUSTER_ID, "prod-east")],
      payloadKeys: ALERT_PREFILL_PAYLOAD_KEYS,
    });

    expect(payload.kubernetesClusters).toEqual([CLUSTER_ID]);
  });
});

describe("getPrefilledResourcesStillPresent", () => {
  test("names only the added resources the form still holds", () => {
    const added: Array<MonitorLinkedResource> = [
      linked("kubernetesClusters", CLUSTER_ID, "prod-east"),
      linked("services", SERVICE_ID, "checkout"),
    ];

    expect(
      getPrefilledResourcesStillPresent({
        values: { kubernetesClusters: [CLUSTER_ID], services: [] },
        added,
      }),
    ).toEqual([linked("kubernetesClusters", CLUSTER_ID, "prod-east")]);
  });
});
