import { buildResourceFacetConfigs } from "../../../UI/Components/TelemetryViewer/ResourceFacetConfigs";
import { FacetConfig } from "../../../UI/Components/TelemetryViewer/types";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, test } from "@jest/globals";

/*
 * buildResourceFacetConfigs is how the Traces and Exceptions explorers get a
 * facet section for every resource type in the catalog, instead of the four
 * they used to wire by hand. These pin the shape each config must have for
 * the sidebar to fold it away while empty and search it on the server.
 */

describe("buildResourceFacetConfigs", () => {
  test("returns one config per catalog entry, in catalog order", () => {
    const configs: Array<FacetConfig> = buildResourceFacetConfigs({
      basePriority: 2,
    });

    expect(
      configs.map((config: FacetConfig): string => {
        return config.key;
      }),
    ).toEqual([...RESOURCE_FACET_CATALOG_KEYS]);
    expect(configs).toHaveLength(12);
  });

  test("covers every resource type, not only the original four", () => {
    const keys: Array<string> = buildResourceFacetConfigs({
      basePriority: 2,
    }).map((config: FacetConfig): string => {
      return config.key;
    });

    for (const key of [
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
      "dockerSwarmClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "cephClusterId",
      "serverlessFunctionId",
      "cloudResourceId",
      "rumApplicationId",
      "iotFleetId",
    ]) {
      expect(keys).toContain(key);
    }
  });

  test("titles, icons and empty-state nouns come from the catalog", () => {
    const configs: Array<FacetConfig> = buildResourceFacetConfigs({
      basePriority: 2,
    });

    RESOURCE_FACET_CATALOG.forEach(
      (definition: ResourceFacetDefinition, index: number) => {
        const config: FacetConfig = configs[index]!;
        expect(config.title).toBe(definition.label);
        expect(config.icon).toBe(definition.icon);
        expect(config.emptyStateNoun).toBe(definition.pluralLabel);
      },
    );

    expect(configs[1]!.title).toBe("Docker Host");
    expect(configs[1]!.icon).toBe(IconProp.Docker);
    expect(configs[1]!.emptyStateNoun).toBe("Docker Hosts");
  });

  test("every config is server-searchable and hides while empty", () => {
    for (const config of buildResourceFacetConfigs({ basePriority: 2 })) {
      expect(config.serverSearchable).toBe(true);
      expect(config.hideWhenEmpty).toBe(true);
    }
  });

  test.each([0, 1.5, 2, 5, 100])(
    "priorities start at basePriority %p, strictly increase, and stay below the next whole step",
    (basePriority: number) => {
      const priorities: Array<number> = buildResourceFacetConfigs({
        basePriority: basePriority,
      }).map((config: FacetConfig): number => {
        return config.priority as number;
      });

      expect(priorities[0]).toBe(basePriority);

      for (let index: number = 1; index < priorities.length; index++) {
        expect(priorities[index]!).toBeGreaterThan(priorities[index - 1]!);
      }

      for (const priority of priorities) {
        expect(priority).toBeGreaterThanOrEqual(basePriority);
        expect(priority).toBeLessThan(basePriority + 1);
      }
    },
  );

  test("sorting by priority keeps catalog order when mixed with neighbour facets", () => {
    const configs: Array<FacetConfig> = [
      { key: "statusCode", title: "Status", priority: 3 },
      ...buildResourceFacetConfigs({ basePriority: 2 }),
      { key: "primaryEntityId", title: "Service", priority: 1 },
    ];

    const sorted: Array<string> = [...configs]
      .sort((a: FacetConfig, b: FacetConfig): number => {
        return (a.priority ?? 100) - (b.priority ?? 100);
      })
      .map((config: FacetConfig): string => {
        return config.key;
      });

    expect(sorted).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "statusCode",
    ]);
  });

  test("valueDisplayMaps pass through per key and default to undefined", () => {
    const hostNames: Record<string, string> = { h1: "web-1" };
    const clusterNames: Record<string, string> = { c1: "prod" };

    const configs: Array<FacetConfig> = buildResourceFacetConfigs({
      basePriority: 2,
      valueDisplayMaps: {
        hostId: hostNames,
        kubernetesClusterId: clusterNames,
        notAResource: { x: "y" },
      },
    });

    const byKey: Map<string, FacetConfig> = new Map<string, FacetConfig>(
      configs.map((config: FacetConfig): [string, FacetConfig] => {
        return [config.key, config];
      }),
    );

    expect(byKey.get("hostId")!.valueDisplayMap).toBe(hostNames);
    expect(byKey.get("kubernetesClusterId")!.valueDisplayMap).toBe(
      clusterNames,
    );
    expect(byKey.get("proxmoxClusterId")!.valueDisplayMap).toBeUndefined();
    expect(byKey.has("notAResource")).toBe(false);
  });

  test("no valueDisplayMaps leaves every map undefined", () => {
    for (const config of buildResourceFacetConfigs({ basePriority: 2 })) {
      expect(config.valueDisplayMap).toBeUndefined();
      expect(config.valueColorMap).toBeUndefined();
    }
  });

  test("each call returns fresh objects", () => {
    const first: Array<FacetConfig> = buildResourceFacetConfigs({
      basePriority: 2,
    });
    const second: Array<FacetConfig> = buildResourceFacetConfigs({
      basePriority: 2,
    });

    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
  });
});
