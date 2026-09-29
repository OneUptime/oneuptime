import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The traces explorer offers a facet for every resource type
 * ---------------------------------------------------------------------------
 *
 * The sidebar used to list Host, Docker Host, Podman Host and Kubernetes
 * Cluster only — every other resource type the platform ingests (Proxmox,
 * vCenter, Ceph, Docker Swarm, Serverless, Cloud, RUM, IoT) had no facet,
 * and the four it had stayed on screen reading "No values found" in a
 * project with none of them.
 *
 * The REAL TracesViewer is mounted with the TelemetryViewer shell replaced by
 * a probe that records the props it is handed, against mocked APIs. What is
 * pinned is what reaches the shell and the server: the facet keys requested,
 * the facet configs (titles, icons, order, the fold-away flag), the chip a
 * sidebar click produces, and the filter that chip compiles to.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Host from "../../../Models/DatabaseModels/Host";
import Service from "../../../Models/DatabaseModels/Service";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
} from "../../../UI/Components/TelemetryViewer/types";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const PROXMOX_CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";
const VCENTER_ID: string = "55555555-5555-4555-8555-555555555555";

/*
 * A distinct id per catalog type, so a selection that leaked into the wrong
 * facet's group would show up as the wrong id under the wrong key.
 */
const idForIndex: (index: number) => string = (index: number): string => {
  const hex: string = (index + 10).toString(16).padStart(2, "0");
  return `aaaaaaaa-00${hex}-4000-8000-0000000000${hex}`;
};

const RESOURCE_IDS: Record<string, string> = {};
RESOURCE_FACET_CATALOG.forEach(
  (definition: ResourceFacetDefinition, index: number): void => {
    RESOURCE_IDS[definition.facetKey] = idForIndex(index);
  },
);

// When set, what the facets endpoint answers.
let facetsResponse: Record<string, Array<FacetValue>> | null = null;

type PostArgs = { url: { toString: () => string }; data: any };

type LastViewerPropsFunction = () => any;

const lastViewerProps: LastViewerPropsFunction = (): any => {
  const calls: Array<Array<any>> = viewerProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

const postsTo: (path: string) => Array<any> = (path: string): Array<any> => {
  return apiPostMock.mock.calls
    .map((call: Array<any>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return String(args.url).includes(path);
    })
    .map((args: PostArgs): any => {
      return args.data;
    });
};

const lastSpanListQuery: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const calls: Array<Array<any>> = analyticsGetListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { query: Record<string, unknown> })
    .query;
};

// The order TelemetryFacetSidebar lists sections in.
const sortLikeSidebar: (configs: Array<FacetConfig>) => Array<FacetConfig> = (
  configs: Array<FacetConfig>,
): Array<FacetConfig> => {
  return [...configs].sort((a: FacetConfig, b: FacetConfig): number => {
    const priorityA: number = a.priority ?? 100;
    const priorityB: number = b.priority ?? 100;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.title.localeCompare(b.title);
  });
};

const facetConfigFor: (key: string) => FacetConfig | undefined = (
  key: string,
): FacetConfig | undefined => {
  return (lastViewerProps().facetConfigs as Array<FacetConfig>).find(
    (config: FacetConfig): boolean => {
      return config.key === key;
    },
  );
};

const chipFor: (facetKey: string, value: string) => ActiveFilter | undefined = (
  facetKey: string,
  value: string,
): ActiveFilter | undefined => {
  return (lastViewerProps().activeFilters as Array<ActiveFilter>).find(
    (chip: ActiveFilter): boolean => {
      return chip.facetKey === facetKey && chip.value === value;
    },
  );
};

const buildService: () => Service = (): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(SERVICE_ID);
  service.name = "checkout-api";
  return service;
};

const buildHost: () => Host = (): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(HOST_ID);
  host.name = "web-01";
  return host;
};

// Every catalog type answers with one named value.
const facetsForEveryResourceType: () => Record<
  string,
  Array<FacetValue>
> = (): Record<string, Array<FacetValue>> => {
  const facets: Record<string, Array<FacetValue>> = {};
  for (const definition of RESOURCE_FACET_CATALOG) {
    facets[definition.facetKey] = [
      {
        value: RESOURCE_IDS[definition.facetKey]!,
        count: 0,
        displayName: `${definition.label} one`,
      },
    ];
  }
  return facets;
};

const renderViewer: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    render(<TracesViewer />);
  });
};

const waitForFacetData: (key: string) => Promise<void> = async (
  key: string,
): Promise<void> => {
  await waitFor(() => {
    const facetData: FacetData = lastViewerProps().facetData as FacetData;
    expect((facetData[key] || []).length).toBeGreaterThan(0);
  });
};

const includeFromSidebar: (
  facetKey: string,
  value: string,
) => Promise<void> = async (facetKey: string, value: string): Promise<void> => {
  await act(async (): Promise<void> => {
    (lastViewerProps().onFacetInclude as (k: string, v: string) => void)(
      facetKey,
      value,
    );
  });
};

describe("TracesViewer — a facet for every resource type", () => {
  beforeEach(() => {
    facetsResponse = null;
    TelemetryEntityNameResolver.clearCache();
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockImplementation(async (args: any) => {
      const hasIdQuery: boolean = Boolean(args?.query?._id);
      if (!hasIdQuery && args.modelType === Service) {
        return { data: [buildService()], count: 1 };
      }
      if (!hasIdQuery && args.modelType === Host) {
        return { data: [buildHost()], count: 1 };
      }
      return { data: [], count: 0 };
    });
    apiPostMock.mockImplementation(async (args: any) => {
      if (
        facetsResponse &&
        String((args as PostArgs).url).includes("/telemetry/traces/facets")
      ) {
        return { data: { facets: facetsResponse } };
      }
      return { data: {} };
    });
    analyticsGetListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  test("the facets request asks for Service, every catalog resource type, then the span facets", async () => {
    await renderViewer();

    await waitFor(() => {
      expect(postsTo("/telemetry/traces/facets").length).toBeGreaterThan(0);
    });

    const facetKeys: Array<string> = postsTo("/telemetry/traces/facets")[0]
      .facetKeys as Array<string>;

    expect(facetKeys).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "statusCode",
      "kind",
      "isRootSpan",
      "hasException",
      "name",
      "resource.service.instance.id",
      "resource.host.name",
    ]);

    // The types beyond the original four (Databases included) are all asked for.
    for (const key of [
      "dockerSwarmClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "cephClusterId",
      "serverlessFunctionId",
      "cloudResourceId",
      "rumApplicationId",
      "iotFleetId",
      "databaseServerId",
    ]) {
      expect(facetKeys).toContain(key);
    }
    expect(new Set(facetKeys).size).toBe(facetKeys.length);
  });

  test("the sidebar lists Service, then every resource type in catalog order, then the span facets", async () => {
    await renderViewer();

    const configs: Array<FacetConfig> = lastViewerProps()
      .facetConfigs as Array<FacetConfig>;

    expect(
      sortLikeSidebar(configs).map((config: FacetConfig): string => {
        return config.key;
      }),
    ).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "statusCode",
      "spanType",
      "hasException",
      "kind",
      "name",
      "resource.service.instance.id",
      "resource.host.name",
    ]);
  });

  test("every resource facet is titled and iconed from the catalog, searchable, and folds away while empty", async () => {
    await renderViewer();

    const servicePriority: number =
      facetConfigFor("primaryEntityId")!.priority!;
    const statusPriority: number = facetConfigFor("statusCode")!.priority!;

    for (const definition of RESOURCE_FACET_CATALOG) {
      const config: FacetConfig | undefined = facetConfigFor(
        definition.facetKey,
      );

      expect(config).toBeDefined();
      expect(config).toMatchObject({
        title: definition.label,
        icon: definition.icon,
        serverSearchable: true,
        hideWhenEmpty: true,
        emptyStateNoun: definition.pluralLabel,
      });
      expect(config!.priority).toBeGreaterThan(servicePriority);
      expect(config!.priority).toBeLessThan(statusPriority);
    }
  });

  test("Service is always shown, with its icon; only resource facets fold away", async () => {
    await renderViewer();

    const service: FacetConfig = facetConfigFor("primaryEntityId")!;
    expect(service.title).toBe("Service");
    expect(service.icon).toBe(IconProp.SquareStack);
    expect(service.serverSearchable).toBe(true);
    expect(service.hideWhenEmpty).toBeFalsy();

    for (const config of lastViewerProps().facetConfigs as Array<FacetConfig>) {
      const isCatalogFacet: boolean = RESOURCE_FACET_CATALOG_KEYS.includes(
        config.key,
      );
      expect(Boolean(config.hideWhenEmpty)).toBe(isCatalogFacet);
    }
  });

  test("the preloaded Host list still names Host facet values", async () => {
    await renderViewer();

    await waitFor(() => {
      expect(facetConfigFor("hostId")!.valueDisplayMap).toEqual({
        [HOST_ID]: "web-01",
      });
    });

    // Types without a preloaded list lean on the server's displayName.
    expect(facetConfigFor("proxmoxClusterId")!.valueDisplayMap).toBeUndefined();
  });

  test("REGRESSION: a Proxmox cluster picked in the sidebar reads 'Proxmox Cluster: <name>' and filters by resourceFilters", async () => {
    facetsResponse = {
      proxmoxClusterId: [
        { value: PROXMOX_CLUSTER_ID, count: 0, displayName: "pve-prod" },
      ],
    };

    await renderViewer();
    await waitForFacetData("proxmoxClusterId");

    await includeFromSidebar("proxmoxClusterId", PROXMOX_CLUSTER_ID);

    await waitFor(() => {
      expect(chipFor("proxmoxClusterId", PROXMOX_CLUSTER_ID)).toMatchObject({
        displayKey: "Proxmox Cluster",
        displayValue: "pve-prod",
      });
    });

    await waitFor(() => {
      expect(lastSpanListQuery()["resourceFilters"]).toEqual({
        proxmoxClusterId: [PROXMOX_CLUSTER_ID],
      });
    });

    const query: Record<string, unknown> = lastSpanListQuery();
    // Never a filter on a Span column that does not exist.
    expect(query).not.toHaveProperty("proxmoxClusterId");
    // Nor folded into the Service id filter.
    expect(query).not.toHaveProperty("primaryEntityId");

    // The chart and the facet counts read the same selection.
    await waitFor(() => {
      const facetPosts: Array<any> = postsTo("/telemetry/traces/facets");
      expect(facetPosts[facetPosts.length - 1].resourceFilters).toEqual({
        proxmoxClusterId: [PROXMOX_CLUSTER_ID],
      });
    });
    const histogramPosts: Array<any> = postsTo("/telemetry/traces/histogram");
    const histogramPayload: any = histogramPosts[histogramPosts.length - 1];
    expect(histogramPayload.resourceFilters).toEqual({
      proxmoxClusterId: [PROXMOX_CLUSTER_ID],
    });
    expect(histogramPayload.serviceIds).toBeUndefined();
    expect(histogramPayload).not.toHaveProperty("proxmoxClusterId");
  });

  test("a value in every resource facet becomes one resourceFilters group per type, each chip named", async () => {
    facetsResponse = facetsForEveryResourceType();

    await renderViewer();
    await waitForFacetData("iotFleetId");

    for (const definition of RESOURCE_FACET_CATALOG) {
      await includeFromSidebar(
        definition.facetKey,
        RESOURCE_IDS[definition.facetKey]!,
      );
    }

    const expectedFilters: Record<string, Array<string>> = {};
    for (const definition of RESOURCE_FACET_CATALOG) {
      expectedFilters[definition.facetKey] = [
        RESOURCE_IDS[definition.facetKey]!,
      ];
    }

    await waitFor(() => {
      expect(lastSpanListQuery()["resourceFilters"]).toEqual(expectedFilters);
    });

    const query: Record<string, unknown> = lastSpanListQuery();
    for (const definition of RESOURCE_FACET_CATALOG) {
      expect(query).not.toHaveProperty(definition.facetKey);

      expect(
        chipFor(definition.facetKey, RESOURCE_IDS[definition.facetKey]!),
      ).toMatchObject({
        displayKey: definition.label,
        displayValue: `${definition.label} one`,
      });
    }
    expect(query).not.toHaveProperty("primaryEntityId");
  });

  test("a Service picked in the sidebar still filters primaryEntityId, not resourceFilters", async () => {
    facetsResponse = {
      primaryEntityId: [{ value: SERVICE_ID, count: 4 }],
    };

    await renderViewer();
    await waitForFacetData("primaryEntityId");

    await includeFromSidebar("primaryEntityId", SERVICE_ID);

    await waitFor(() => {
      expect(String(lastSpanListQuery()["primaryEntityId"])).toBe(SERVICE_ID);
    });
    expect(lastSpanListQuery()).not.toHaveProperty("resourceFilters");
    expect(chipFor("primaryEntityId", SERVICE_ID)).toMatchObject({
      displayKey: "Service",
      displayValue: "checkout-api",
    });
  });

  test("a URL-restored vCenter chip reads 'vCenter' at once and gains its name when the facets land", async () => {
    window.history.replaceState(
      {},
      "",
      `/?filters=${encodeURIComponent(
        JSON.stringify([["vmwareVCenterId", VCENTER_ID]]),
      )}`,
    );

    let releaseFacets: () => void = (): void => {};
    const facetsGate: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        releaseFacets = resolve;
      },
    );
    apiPostMock.mockImplementation(async (args: any) => {
      if (String((args as PostArgs).url).includes("/telemetry/traces/facets")) {
        await facetsGate;
        return {
          data: {
            facets: {
              vmwareVCenterId: [
                { value: VCENTER_ID, count: 2, displayName: "vc-eu-01" },
              ],
            },
          },
        };
      }
      return { data: {} };
    });

    await renderViewer();

    // The key is the catalog label from the first render, not the raw key.
    expect(chipFor("vmwareVCenterId", VCENTER_ID)).toMatchObject({
      displayKey: "vCenter",
      displayValue: VCENTER_ID,
    });

    await act(async (): Promise<void> => {
      releaseFacets();
    });

    await waitFor(() => {
      expect(chipFor("vmwareVCenterId", VCENTER_ID)?.displayValue).toBe(
        "vc-eu-01",
      );
    });

    // Filtering is by the id throughout.
    await waitFor(() => {
      expect(lastSpanListQuery()["resourceFilters"]).toEqual({
        vmwareVCenterId: [VCENTER_ID],
      });
    });
  });
});
