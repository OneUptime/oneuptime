/*
 * Every resource type the Traces / Exceptions sidebars offer has to be
 * understood by every table downstream of the sidebar: the query routing,
 * the chip-name lookups of all three explorers and the trace table headers.
 *
 * Those tables used to be copied by hand, four keys at a time, while the
 * sidebars were meant to list them all. This suite walks ResourceFacetCatalog
 * and checks each table covers each type the same way, so the next resource
 * type cannot be half-wired: on screen, but compiled as a nonexistent Span
 * column, or shown as "proxmoxClusterId: <uuid>".
 *
 * TelemetryEntityNames imports ModelAPI; it is mocked so nothing reaches the
 * network.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import IconProp from "Common/Types/Icon/IconProp";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "Common/Types/Telemetry/ResourceFacetCatalog";
import {
  collectResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  isResourceFacetKey,
  isServiceFacetKey,
  parseResourceEntityFacetSelections,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import { buildResourceFacetConfigs } from "Common/UI/Components/TelemetryViewer/ResourceFacetConfigs";
import { FacetConfig } from "Common/UI/Components/TelemetryViewer/types";
import { getTelemetryEntityTypeLabel } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import { EXCEPTION_TYPED_RESOURCE_FACET_TYPES } from "../../FeatureSet/Dashboard/src/Utils/ExceptionsEntityChipDisplay";
import {
  METRICS_TYPED_ENTITY_FACET_KEYS,
  getMetricsTypedEntityFacetType,
} from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";
import { dimensionLabel } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceTableData";

const RESOURCE_ID: string = "0195d6c1-0000-7000-8000-0000000000aa";

type CatalogRow = [string, ResourceFacetDefinition];

const CATALOG_ROWS: Array<CatalogRow> = RESOURCE_FACET_CATALOG.map(
  (definition: ResourceFacetDefinition): CatalogRow => {
    return [definition.facetKey, definition];
  },
);

/*
 * The four types both viewers preload a Postgres list for. The others are
 * named by the facet endpoint's displayName instead.
 */
const PRELOADED_KEYS: Array<string> = [
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
];

describe("the catalog the explorers are wired from", () => {
  test("lists all thirteen non-Service resource types, each once, in sidebar order", () => {
    expect([...RESOURCE_FACET_CATALOG_KEYS]).toEqual([
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
      "databaseServerId",
    ]);
    expect(new Set(RESOURCE_FACET_CATALOG_KEYS).size).toBe(
      RESOURCE_FACET_CATALOG_KEYS.length,
    );
  });

  test("never contains the Service facet, which the viewers always show", () => {
    for (const key of RESOURCE_FACET_CATALOG_KEYS) {
      expect(isServiceFacetKey(key)).toBe(false);
    }
    expect(RESOURCE_FACET_CATALOG_KEYS).not.toContain("primaryEntityId");
    expect(RESOURCE_FACET_CATALOG_KEYS).not.toContain("serviceId");
  });
});

describe.each(CATALOG_ROWS)(
  "%s is covered end to end",
  (facetKey: string, definition: ResourceFacetDefinition) => {
    test("Traces routes a selection to resourceFilters, never to a Span column", () => {
      expect(isResourceFacetKey(facetKey)).toBe(true);
      expect(isResourceEntityFacetKey(facetKey)).toBe(true);
      expect(
        collectResourceEntityFacetSelections([[facetKey, [RESOURCE_ID]]]),
      ).toEqual({ [facetKey]: [RESOURCE_ID] });
      // A saved view / request body carrying it survives the server parser.
      expect(
        parseResourceEntityFacetSelections({ [facetKey]: [RESOURCE_ID] }),
      ).toEqual({ [facetKey]: [RESOURCE_ID] });
    });

    test("the Exceptions chip lookup knows its table", () => {
      expect(EXCEPTION_TYPED_RESOURCE_FACET_TYPES[facetKey]).toBe(
        definition.serviceType,
      );
    });

    test("the Metrics chip lookup knows its table", () => {
      expect(METRICS_TYPED_ENTITY_FACET_KEYS[facetKey]).toBe(
        definition.serviceType,
      );
      expect(getMetricsTypedEntityFacetType(facetKey)).toBe(
        definition.serviceType,
      );
    });

    test("a chip keyed by entity type reads the same label as the sidebar title", () => {
      /*
       * Metrics labels typed chips by entity type; Traces / Exceptions by
       * facet title. Both have to say the same thing for the same chip.
       */
      expect(getTelemetryEntityTypeLabel(definition.serviceType)).toBe(
        definition.label,
      );
    });

    test("the trace table header is a name, not the raw key", () => {
      expect(dimensionLabel(facetKey)).not.toBe(facetKey);
      expect(dimensionLabel(facetKey).length).toBeGreaterThan(0);
    });
  },
);

describe("the resource facet configs the Traces and Exceptions sidebars render", () => {
  const hostNames: Record<string, string> = { [RESOURCE_ID]: "web-01" };
  const dockerHostNames: Record<string, string> = {};
  const podmanHostNames: Record<string, string> = {};
  const clusterNames: Record<string, string> = { [RESOURCE_ID]: "prod-eu" };

  // Exactly the call both viewers make.
  const CONFIGS: Array<FacetConfig> = buildResourceFacetConfigs({
    basePriority: 2,
    valueDisplayMaps: {
      hostId: hostNames,
      dockerHostId: dockerHostNames,
      podmanHostId: podmanHostNames,
      kubernetesClusterId: clusterNames,
    },
  });

  test("one config per catalog type, in catalog order", () => {
    expect(
      CONFIGS.map((config: FacetConfig): string => {
        return config.key;
      }),
    ).toEqual([...RESOURCE_FACET_CATALOG_KEYS]);
  });

  test.each(CATALOG_ROWS)(
    "%s is titled, iconed, searchable and folds away while empty",
    (facetKey: string, definition: ResourceFacetDefinition) => {
      const config: FacetConfig | undefined = CONFIGS.find(
        (candidate: FacetConfig): boolean => {
          return candidate.key === facetKey;
        },
      );

      expect(config).toBeDefined();
      expect(config!.title).toBe(definition.label);
      expect(config!.icon).toBe(definition.icon);
      expect(Object.values(IconProp)).toContain(config!.icon);
      expect(config!.serverSearchable).toBe(true);
      expect(config!.hideWhenEmpty).toBe(true);
      expect(config!.emptyStateNoun).toBe(definition.pluralLabel);
    },
  );

  test("sorts after Service (1) and before Status / Exception Type (6)", () => {
    for (const config of CONFIGS) {
      expect(config.priority).toBeGreaterThanOrEqual(2);
      expect(config.priority).toBeLessThan(3);
    }
    const priorities: Array<number> = CONFIGS.map(
      (config: FacetConfig): number => {
        return config.priority!;
      },
    );
    expect(
      [...priorities].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(priorities);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  test("the preloaded name maps reach their own facet only", () => {
    for (const config of CONFIGS) {
      if (config.key === "hostId") {
        expect(config.valueDisplayMap).toBe(hostNames);
      } else if (config.key === "kubernetesClusterId") {
        expect(config.valueDisplayMap).toBe(clusterNames);
      } else if (PRELOADED_KEYS.includes(config.key)) {
        expect(config.valueDisplayMap).toEqual({});
      } else {
        // Named by the facet endpoint's displayName instead.
        expect(config.valueDisplayMap).toBeUndefined();
      }
    }
  });
});
