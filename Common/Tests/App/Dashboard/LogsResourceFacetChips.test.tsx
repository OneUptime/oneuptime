import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "We only have some resources added to the list": a Proxmox cluster,
 * vCenter, Ceph cluster, Docker Swarm cluster, serverless function, cloud
 * resource, RUM application or IoT fleet chip in the Logs explorer used to
 * read its raw facet key and a UUID ("proxmoxClusterId: 0195…").
 *
 * This renders the real chip component with chips built the way the
 * Dashboard LogsViewer builds them (catalog-derived chip key labels) and
 * then named the way the shared LogsViewer names them (one resolver request
 * with per-facet table hints, then enrichLogsActiveFilters), against a
 * mocked ModelAPI — so what is asserted is the text a person reads and the
 * tables that were actually queried. The wiring of these calls inside the
 * viewers is pinned by App/Tests/Dashboard/LogsResourceFacetsWiring.test.ts.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import { getLogsFacetChipDisplayKey } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import {
  LogsEntityLookupMaps,
  LogsEntityResolutionRequest,
  collectLogsEntityIdsToResolve,
  enrichLogsActiveFilters,
} from "../../../UI/Components/LogsViewer/LogsEntityNames";
import {
  ActiveFilter,
  FacetData,
} from "../../../UI/Components/LogsViewer/types";
import useTelemetryEntityNames from "../../../UI/Utils/Telemetry/UseTelemetryEntityNames";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000031";

interface CatalogCase {
  definition: ResourceFacetDefinition;
  id: string;
  name: string;
}

// The table each catalog type's ids live in (TELEMETRY_ENTITY_TYPES).
const MODEL_NAME_BY_FACET_KEY: Record<string, string> = {
  hostId: "Host",
  dockerHostId: "DockerHost",
  podmanHostId: "PodmanHost",
  kubernetesClusterId: "KubernetesCluster",
  dockerSwarmClusterId: "DockerSwarmCluster",
  proxmoxClusterId: "ProxmoxCluster",
  vmwareVCenterId: "VMwareVCenter",
  cephClusterId: "CephCluster",
  serverlessFunctionId: "ServerlessFunction",
  cloudResourceId: "CloudResource",
  rumApplicationId: "RumApplication",
  iotFleetId: "IoTFleet",
};

const CASES: Array<CatalogCase> = RESOURCE_FACET_CATALOG.map(
  (definition: ResourceFacetDefinition, index: number): CatalogCase => {
    const suffix: string = String(index + 1).padStart(12, "0");
    return {
      definition,
      id: `c0ffee00-0000-4000-8000-${suffix}`,
      name: `prod-resource-${index + 1}`,
    };
  },
);

const caseFor: (facetKey: string) => CatalogCase = (
  facetKey: string,
): CatalogCase => {
  const found: CatalogCase | undefined = CASES.find((entry: CatalogCase) => {
    return entry.definition.facetKey === facetKey;
  });
  expect(found).toBeDefined();
  return found!;
};

interface GetListArgs {
  modelType: { name: string };
}

const queriedModels: () => Array<string> = (): Array<string> => {
  return getListMock.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as GetListArgs).modelType.name;
  });
};

// The viewer preloads nothing in this harness: every name is the resolver's.
const NO_PRELOADED_MAPS: LogsEntityLookupMaps = { serviceMap: {} };

interface HarnessProps {
  appliedFacetFilters: Map<string, Set<string>>;
  facetData?: FacetData | undefined;
  onRemove?: ((facetKey: string, value: string) => void) | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  // Dashboard LogsViewer: one chip per applied value, keyed by facet label.
  const chips: Array<ActiveFilter> = React.useMemo(() => {
    const filters: Array<ActiveFilter> = [];
    for (const [facetKey, values] of props.appliedFacetFilters.entries()) {
      for (const value of values) {
        filters.push({
          facetKey,
          value,
          displayKey: getLogsFacetChipDisplayKey(facetKey),
          displayValue: value,
        });
      }
    }
    return filters;
  }, [props.appliedFacetFilters]);

  // Shared LogsViewer: one resolver request, then enrichment.
  const request: LogsEntityResolutionRequest = React.useMemo(() => {
    return collectLogsEntityIdsToResolve({
      filters: chips,
      facetData: props.facetData,
      maps: NO_PRELOADED_MAPS,
    });
  }, [chips, props.facetData]);

  const nameMap: TelemetryEntityNameMap = useTelemetryEntityNames(request.ids, {
    typeHints: request.typeHints,
  });

  return (
    <ActiveFilterChips
      filters={enrichLogsActiveFilters(chips, NO_PRELOADED_MAPS, nameMap)}
      onRemove={(facetKey: string, value: string) => {
        props.onRemove?.(facetKey, value);
      }}
      onClearAll={() => {}}
    />
  );
};

const chipText: () => string = (): string => {
  return document.body.textContent || "";
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  getListMock.mockImplementation((args: GetListArgs) => {
    /*
     * Each table holds its own catalog row; the resolver itself drops rows
     * it did not ask for.
     */
    return Promise.resolve({
      data: CASES.filter((entry: CatalogCase) => {
        return (
          MODEL_NAME_BY_FACET_KEY[entry.definition.facetKey] ===
          args.modelType.name
        );
      }).map((entry: CatalogCase) => {
        return { id: new ObjectID(entry.id), name: entry.name };
      }),
      count: 0,
    });
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("logs explorer resource chips (rendered)", () => {
  test.each(
    CASES.map((entry: CatalogCase): [string, CatalogCase] => {
      return [entry.definition.facetKey, entry];
    }),
  )(
    "a %s chip reads '<Type>: <name>' and queries only its own table",
    async (_facetKey: string, entry: CatalogCase) => {
      render(
        <Harness
          appliedFacetFilters={
            new Map([[entry.definition.facetKey, new Set([entry.id])]])
          }
        />,
      );

      // The key is right before the name lands — no raw facet key.
      expect(
        screen.getByText(`${entry.definition.label}:`),
      ).toBeInTheDocument();
      expect(chipText()).not.toContain(entry.definition.facetKey);

      await waitFor(() => {
        expect(screen.getByText(entry.name)).toBeInTheDocument();
      });

      expect(chipText()).not.toContain(entry.id);
      expect(queriedModels()).toEqual([
        MODEL_NAME_BY_FACET_KEY[entry.definition.facetKey],
      ]);
    },
  );

  test("chips for every catalog type are named in one pass, each from its own table", async () => {
    render(
      <Harness
        appliedFacetFilters={
          new Map(
            CASES.map((entry: CatalogCase): [string, Set<string>] => {
              return [entry.definition.facetKey, new Set([entry.id])];
            }),
          )
        }
      />,
    );

    await waitFor(() => {
      for (const entry of CASES) {
        expect(screen.getByText(entry.name)).toBeInTheDocument();
      }
    });

    for (const entry of CASES) {
      expect(
        screen.getByText(`${entry.definition.label}:`),
      ).toBeInTheDocument();
      expect(chipText()).not.toContain(entry.id);
    }

    // Straight to each table; the Service-first probe never ran.
    expect([...queriedModels()].sort()).toEqual(
      Object.values(MODEL_NAME_BY_FACET_KEY).sort(),
    );
    expect(queriedModels()).not.toContain("Service");
  });

  test("removing a named new-type chip still hands the viewer the id", async () => {
    const removed: Array<[string, string]> = [];
    const proxmox: CatalogCase = caseFor("proxmoxClusterId");

    render(
      <Harness
        appliedFacetFilters={
          new Map([
            ["proxmoxClusterId", new Set([proxmox.id])],
            ["severityText", new Set(["Error"])],
          ])
        }
        onRemove={(facetKey: string, value: string) => {
          removed.push([facetKey, value]);
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(proxmox.name)).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByTitle(`Remove Proxmox Cluster: ${proxmox.name}`),
    );

    expect(removed).toEqual([["proxmoxClusterId", proxmox.id]]);
  });

  test("a new-type chip the resolver cannot name keeps its label and shows the id", async () => {
    const unknownId: string = "c0ffee00-0000-4000-8000-00000000ffff";

    render(
      <Harness
        appliedFacetFilters={new Map([["cephClusterId", new Set([unknownId])]])}
      />,
    );

    /*
     * The hinted table is asked first; a miss there falls through to the
     * general pass (Service first, then the rest), which ends with the
     * last table in the resolution order.
     */
    await waitFor(() => {
      expect(queriedModels()).toContain("ScheduledMaintenance");
    });

    expect(queriedModels()[0]).toBe("CephCluster");
    expect(
      queriedModels().filter((model: string): boolean => {
        return model === "CephCluster";
      }),
    ).toHaveLength(1);
    expect(screen.getByText("Ceph Cluster:")).toBeInTheDocument();
    expect(screen.getByText(unknownId)).toBeInTheDocument();
  });

  test("sidebar rows for a new type ride the same request as the chips", async () => {
    const iot: CatalogCase = caseFor("iotFleetId");
    const rum: CatalogCase = caseFor("rumApplicationId");

    render(
      <Harness
        appliedFacetFilters={new Map([["iotFleetId", new Set([iot.id])]])}
        facetData={{
          rumApplicationId: [{ value: rum.id, count: 0 }],
          iotFleetId: [{ value: iot.id, count: 4 }],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(iot.name)).toBeInTheDocument();
    });

    expect(screen.getByText("IoT Fleet:")).toBeInTheDocument();
    expect([...queriedModels()].sort()).toEqual(["IoTFleet", "RumApplication"]);
  });
});
