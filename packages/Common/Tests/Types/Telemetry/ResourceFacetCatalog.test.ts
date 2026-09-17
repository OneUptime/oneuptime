import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
  getResourceFacetDefinition,
  getResourceFacetLabelMap,
  getResourceFacetServiceTypeMap,
  isCatalogResourceFacetKey,
} from "../../../Types/Telemetry/ResourceFacetCatalog";

/*
 * The catalog is the single list every resource facet table is derived from
 * — the facet keys the explorers request, the ServiceType each aggregation
 * service counts under, the keys the server lists from Postgres and the keys
 * a selection is parsed for. A wrong row here is wrong everywhere at once,
 * so its contents are pinned explicitly rather than re-derived.
 */

type CatalogRow = [
  facetKey: string,
  serviceType: ServiceType,
  label: string,
  pluralLabel: string,
  icon: IconProp,
];

// Catalog (= sidebar) order.
const EXPECTED_CATALOG: Array<CatalogRow> = [
  ["hostId", ServiceType.Host, "Host", "Hosts", IconProp.Server],
  [
    "dockerHostId",
    ServiceType.DockerHost,
    "Docker Host",
    "Docker Hosts",
    IconProp.Docker,
  ],
  [
    "podmanHostId",
    ServiceType.PodmanHost,
    "Podman Host",
    "Podman Hosts",
    IconProp.Podman,
  ],
  [
    "kubernetesClusterId",
    ServiceType.KubernetesCluster,
    "Kubernetes Cluster",
    "Kubernetes Clusters",
    IconProp.Kubernetes,
  ],
  [
    "dockerSwarmClusterId",
    ServiceType.DockerSwarmCluster,
    "Docker Swarm Cluster",
    "Docker Swarm Clusters",
    IconProp.DockerSwarm,
  ],
  [
    "proxmoxClusterId",
    ServiceType.ProxmoxCluster,
    "Proxmox Cluster",
    "Proxmox Clusters",
    IconProp.Proxmox,
  ],
  [
    "vmwareVCenterId",
    ServiceType.VMwareVCenter,
    "vCenter",
    "vCenters",
    IconProp.VMware,
  ],
  [
    "cephClusterId",
    ServiceType.CephCluster,
    "Ceph Cluster",
    "Ceph Clusters",
    IconProp.Ceph,
  ],
  [
    "serverlessFunctionId",
    ServiceType.ServerlessFunction,
    "Serverless Function",
    "Serverless Functions",
    IconProp.Bolt,
  ],
  [
    "cloudResourceId",
    ServiceType.CloudResource,
    "Cloud Resource",
    "Cloud Resources",
    IconProp.Cloud,
  ],
  [
    "rumApplicationId",
    ServiceType.RealUserMonitor,
    "RUM Application",
    "RUM Applications",
    IconProp.Globe,
  ],
  [
    "iotFleetId",
    ServiceType.IoTDevice,
    "IoT Fleet",
    "IoT Fleets",
    IconProp.IoT,
  ],
];

const EXPECTED_KEYS: Array<string> = EXPECTED_CATALOG.map(
  (row: CatalogRow): string => {
    return row[0];
  },
);

describe("ResourceFacetCatalog", () => {
  describe("contents", () => {
    test("lists exactly the twelve non-Service resource types, in sidebar order", () => {
      expect(RESOURCE_FACET_CATALOG).toHaveLength(12);
      expect([...RESOURCE_FACET_CATALOG_KEYS]).toEqual(EXPECTED_KEYS);
    });

    test.each(EXPECTED_CATALOG)(
      "%s is counted as %s, labelled %s / %s with the %s icon",
      (
        facetKey: string,
        serviceType: ServiceType,
        label: string,
        pluralLabel: string,
        icon: IconProp,
      ) => {
        expect(getResourceFacetDefinition(facetKey)).toEqual({
          facetKey,
          serviceType,
          label,
          pluralLabel,
          icon,
        });
      },
    );

    test("RESOURCE_FACET_CATALOG_KEYS mirrors the catalog entry by entry", () => {
      expect([...RESOURCE_FACET_CATALOG_KEYS]).toEqual(
        RESOURCE_FACET_CATALOG.map(
          (definition: ResourceFacetDefinition): string => {
            return definition.facetKey;
          },
        ),
      );
    });
  });

  describe("invariants", () => {
    test("facet keys are unique", () => {
      expect(new Set(RESOURCE_FACET_CATALOG_KEYS).size).toBe(
        RESOURCE_FACET_CATALOG_KEYS.length,
      );
    });

    test.each(EXPECTED_KEYS)(
      "%s is a lowerCamelCase id key ending in Id",
      (facetKey: string) => {
        expect(facetKey).toMatch(/^[a-z][A-Za-z0-9]*Id$/);
      },
    );

    test("no entry reuses a Service facet key or a ClickHouse column", () => {
      for (const reserved of [
        "primaryEntityId",
        "serviceId",
        "traceId",
        "spanId",
        "parentSpanId",
      ]) {
        expect(RESOURCE_FACET_CATALOG_KEYS).not.toContain(reserved);
      }
    });

    test("no entry is counted as a Service", () => {
      for (const definition of RESOURCE_FACET_CATALOG) {
        expect(definition.serviceType).not.toBe(ServiceType.OpenTelemetry);
        expect(definition.serviceType).not.toBe(ServiceType.Unknown);
        expect(Object.values(ServiceType)).toContain(definition.serviceType);
      }
    });

    test("every entry counts under its own ServiceType, so no two facets share rows", () => {
      const serviceTypes: Array<ServiceType> = RESOURCE_FACET_CATALOG.map(
        (definition: ResourceFacetDefinition): ServiceType => {
          return definition.serviceType;
        },
      );

      expect(new Set(serviceTypes).size).toBe(serviceTypes.length);
    });

    test("IoT fleets count under IoTDevice — ingest stamps the fleet id with that type", () => {
      expect(getResourceFacetDefinition("iotFleetId")?.serviceType).toBe(
        ServiceType.IoTDevice,
      );
    });

    test("RUM applications count under RealUserMonitor", () => {
      expect(getResourceFacetDefinition("rumApplicationId")?.serviceType).toBe(
        ServiceType.RealUserMonitor,
      );
    });

    test("labels and plural labels are non-blank, trimmed and distinct", () => {
      const labels: Array<string> = [];
      const pluralLabels: Array<string> = [];

      for (const definition of RESOURCE_FACET_CATALOG) {
        expect(definition.label.trim()).toBe(definition.label);
        expect(definition.label.length).toBeGreaterThan(0);
        expect(definition.pluralLabel.trim()).toBe(definition.pluralLabel);
        expect(definition.pluralLabel.length).toBeGreaterThan(0);
        expect(definition.pluralLabel).not.toBe(definition.label);

        labels.push(definition.label);
        pluralLabels.push(definition.pluralLabel);
      }

      expect(new Set(labels).size).toBe(labels.length);
      expect(new Set(pluralLabels).size).toBe(pluralLabels.length);
    });

    test("every entry has a real icon", () => {
      for (const definition of RESOURCE_FACET_CATALOG) {
        expect(definition.icon).toBeDefined();
        expect(Object.values(IconProp)).toContain(definition.icon);
      }
    });
  });

  describe("lookups", () => {
    test.each(EXPECTED_KEYS)("%s is a catalog key", (facetKey: string) => {
      expect(isCatalogResourceFacetKey(facetKey)).toBe(true);
      expect(getResourceFacetDefinition(facetKey)?.facetKey).toBe(facetKey);
    });

    test.each([
      "primaryEntityId",
      "serviceId",
      "severityText",
      "statusCode",
      "",
      "HostId",
      "hostid",
      " hostId",
      "hostId ",
      "resource.host.name",
      "constructor",
      "toString",
      "__proto__",
      "iotDeviceId",
    ])("%j is not a catalog key", (facetKey: string) => {
      expect(isCatalogResourceFacetKey(facetKey)).toBe(false);
      expect(getResourceFacetDefinition(facetKey)).toBeUndefined();
    });
  });

  describe("derived tables", () => {
    test("getResourceFacetServiceTypeMap maps every key to its ServiceType, in catalog order", () => {
      const map: Map<string, ServiceType> = getResourceFacetServiceTypeMap();

      expect(Array.from(map.entries())).toEqual(
        EXPECTED_CATALOG.map((row: CatalogRow): [string, ServiceType] => {
          return [row[0], row[1]];
        }),
      );
    });

    test("getResourceFacetServiceTypeMap returns a fresh map each call, so a caller cannot corrupt another's", () => {
      const first: Map<string, ServiceType> = getResourceFacetServiceTypeMap();
      first.delete("hostId");
      first.set("bogusId", ServiceType.Host);

      const second: Map<string, ServiceType> = getResourceFacetServiceTypeMap();

      expect(second.get("hostId")).toBe(ServiceType.Host);
      expect(second.has("bogusId")).toBe(false);
    });

    test("getResourceFacetLabelMap maps every key to its singular label", () => {
      expect(getResourceFacetLabelMap()).toEqual(
        Object.fromEntries(
          EXPECTED_CATALOG.map((row: CatalogRow): [string, string] => {
            return [row[0], row[2]];
          }),
        ),
      );
    });

    test("getResourceFacetLabelMap returns a fresh record each call", () => {
      const first: Record<string, string> = getResourceFacetLabelMap();
      first["hostId"] = "Mutated";

      expect(getResourceFacetLabelMap()["hostId"]).toBe("Host");
    });
  });
});
