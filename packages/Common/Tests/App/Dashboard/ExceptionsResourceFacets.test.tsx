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
 * The exceptions explorer offers a facet for every resource type
 * ---------------------------------------------------------------------------
 *
 * The sidebar used to hard-code Host / Docker Host / Podman Host /
 * Kubernetes Cluster, so exceptions from a Proxmox cluster, a vCenter, a Ceph
 * cluster, a Swarm, a serverless function, a cloud resource, a RUM
 * application or an IoT fleet could not be narrowed from the sidebar at all
 * — and the four it had stayed on screen reading "No values found" in a
 * project with none of them.
 *
 * The real viewer is rendered with TelemetryViewer mocked to capture its
 * props, ModelAPI faked per table and API.post recorded, so what is pinned
 * is what reaches the shell and the server: the facet keys requested, the
 * facet configs, the chip a sidebar click produces, and the id filter it
 * compiles to (every resource facet filters the one `primaryEntityId`
 * column, see RESOURCE_FACET_KEYS in the viewer).
 */

type CapturedChip = {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
  readOnly?: boolean | undefined;
};

let capturedViewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      capturedViewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
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

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  RESOURCE_FACET_CATALOG,
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import {
  FacetConfig,
  FacetData,
  FacetValue,
} from "../../../UI/Components/TelemetryViewer/types";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROXMOX_CLUSTER_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const IOT_FLEET_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const idForIndex: (index: number) => string = (index: number): string => {
  const hex: string = (index + 10).toString(16).padStart(2, "0");
  return `bbbbbbbb-00${hex}-4000-8000-0000000000${hex}`;
};

const RESOURCE_IDS: Record<string, string> = {};
RESOURCE_FACET_CATALOG.forEach(
  (definition: ResourceFacetDefinition, index: number): void => {
    RESOURCE_IDS[definition.facetKey] = idForIndex(index);
  },
);

type ModelType = { new (): unknown };

interface GetListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
}

// When set, what the facets endpoint answers.
let facetsResponse: Record<string, Array<FacetValue>> | null = null;

// Rows only the name resolver (an `_id` query) can find.
const RESOLVABLE: Array<[ModelType, { id: ObjectID; name: string }]> = [
  [IoTFleet, { id: new ObjectID(IOT_FLEET_ID), name: "warehouse-sensors" }],
];

const idsOf: (includes: Includes) => Array<string> = (
  includes: Includes,
): Array<string> => {
  return (includes.values as Array<string | ObjectID>).map(
    (value: string | ObjectID): string => {
      return value.toString();
    },
  );
};

const fakeGetList: (
  args: GetListArgs,
) => Promise<{ data: Array<unknown>; count: number }> = async (
  args: GetListArgs,
): Promise<{ data: Array<unknown>; count: number }> => {
  const idQuery: unknown = args.query["_id"];

  if (!(idQuery instanceof Includes)) {
    if (args.modelType === Service) {
      const service: Service = new Service();
      service.id = new ObjectID(SERVICE_ID);
      service.name = "checkout-api";
      return { data: [service], count: 1 };
    }
    if (args.modelType === KubernetesCluster) {
      const cluster: KubernetesCluster = new KubernetesCluster();
      cluster.id = new ObjectID(CLUSTER_ID);
      cluster.name = "prod-eu";
      return { data: [cluster], count: 1 };
    }
    return { data: [], count: 0 };
  }

  const ids: Array<string> = idsOf(idQuery);
  const data: Array<unknown> = RESOLVABLE.filter(
    (entry: [ModelType, { id: ObjectID; name: string }]): boolean => {
      return (
        entry[0] === args.modelType && ids.includes(entry[1].id.toString())
      );
    },
  ).map((entry: [ModelType, { id: ObjectID; name: string }]): unknown => {
    return entry[1];
  });
  return { data, count: data.length };
};

type PostArgs = { url: { toString: () => string }; data: any };

const postsTo: (path: string) => Array<any> = (path: string): Array<any> => {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return String(args.url).includes(path);
    })
    .map((args: PostArgs): any => {
      return args.data;
    });
};

const lastPostTo: (path: string) => any = (path: string): any => {
  const posts: Array<any> = postsTo(path);
  return posts[posts.length - 1];
};

const exceptionListQueries: () => Array<Record<string, unknown>> = (): Array<
  Record<string, unknown>
> => {
  return getListMock.mock.calls
    .map((call: Array<unknown>): GetListArgs => {
      return call[0] as GetListArgs;
    })
    .filter((args: GetListArgs): boolean => {
      return args.modelType === TelemetryException;
    })
    .map((args: GetListArgs): Record<string, unknown> => {
      return args.query;
    });
};

const lastExceptionListQuery: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const queries: Array<Record<string, unknown>> = exceptionListQueries();
  expect(queries.length).toBeGreaterThan(0);
  return queries[queries.length - 1]!;
};

const idsIn: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (value instanceof Includes) {
    return idsOf(value).sort();
  }
  return value === undefined ? [] : [String(value)];
};

const facetConfigs: () => Array<FacetConfig> = (): Array<FacetConfig> => {
  return capturedViewerProps.facetConfigs as Array<FacetConfig>;
};

const facetConfigFor: (key: string) => FacetConfig | undefined = (
  key: string,
): FacetConfig | undefined => {
  return facetConfigs().find((config: FacetConfig): boolean => {
    return config.key === key;
  });
};

const chipFor: (facetKey: string, value: string) => CapturedChip | undefined = (
  facetKey: string,
  value: string,
): CapturedChip | undefined => {
  return (
    (capturedViewerProps?.activeFilters as Array<CapturedChip>) || []
  ).find((candidate: CapturedChip): boolean => {
    return candidate.facetKey === facetKey && candidate.value === value;
  });
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

const renderViewer: (
  props: React.ComponentProps<typeof ExceptionsViewer>,
) => Promise<void> = async (
  props: React.ComponentProps<typeof ExceptionsViewer>,
): Promise<void> => {
  await act(async (): Promise<void> => {
    render(<ExceptionsViewer {...props} />);
  });
  expect(capturedViewerProps).not.toBeNull();
};

const waitForFacetData: (key: string) => Promise<void> = async (
  key: string,
): Promise<void> => {
  await waitFor(() => {
    const facetData: FacetData = capturedViewerProps.facetData as FacetData;
    expect((facetData[key] || []).length).toBeGreaterThan(0);
  });
};

const includeFromSidebar: (
  facetKey: string,
  value: string,
) => Promise<void> = async (facetKey: string, value: string): Promise<void> => {
  await act(async (): Promise<void> => {
    (capturedViewerProps.onFacetInclude as (k: string, v: string) => void)(
      facetKey,
      value,
    );
  });
};

describe("ExceptionsViewer — a facet for every resource type", () => {
  beforeEach(() => {
    capturedViewerProps = null;
    facetsResponse = null;
    TelemetryEntityNameResolver.clearCache();
    getListMock.mockReset();
    getListMock.mockImplementation((...args: Array<any>) => {
      return fakeGetList(args[0] as GetListArgs);
    });
    postMock.mockReset();
    postMock.mockImplementation((...args: Array<any>) => {
      const url: string = String((args[0] as PostArgs)?.url || "");
      if (facetsResponse && url.includes("/telemetry/exceptions/facets")) {
        return Promise.resolve({ data: { facets: facetsResponse } });
      }
      return Promise.resolve({ data: {} });
    });
    analyticsGetListMock.mockReset();
    analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  test("the facets request asks for Service, every catalog resource type, then type and environment", async () => {
    await renderViewer({ disableUrlSync: true });

    await waitFor(() => {
      expect(postsTo("/telemetry/exceptions/facets").length).toBeGreaterThan(0);
    });

    const facetKeys: Array<string> = postsTo("/telemetry/exceptions/facets")[0]
      .facetKeys as Array<string>;

    expect(facetKeys).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "exceptionType",
      "environment",
    ]);
    expect(new Set(facetKeys).size).toBe(facetKeys.length);
  });

  test("the sidebar lists Service, every resource type in catalog order, then Exception Type, Environment, Error Class", async () => {
    await renderViewer({ disableUrlSync: true });

    expect(
      sortLikeSidebar(facetConfigs()).map((config: FacetConfig): string => {
        return config.key;
      }),
    ).toEqual([
      "primaryEntityId",
      ...RESOURCE_FACET_CATALOG_KEYS,
      "exceptionType",
      "environment",
      "errorClass",
    ]);
  });

  test("every resource facet is titled and iconed from the catalog, searchable, and folds away while empty", async () => {
    await renderViewer({ disableUrlSync: true });

    const servicePriority: number =
      facetConfigFor("primaryEntityId")!.priority!;
    const exceptionTypePriority: number =
      facetConfigFor("exceptionType")!.priority!;

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
      expect(config!.priority).toBeLessThan(exceptionTypePriority);
    }
  });

  test("Service is always shown, with its icon; nothing but resource facets folds away", async () => {
    await renderViewer({ disableUrlSync: true });

    expect(facetConfigFor("primaryEntityId")).toMatchObject({
      title: "Service",
      icon: IconProp.SquareStack,
      serverSearchable: true,
    });

    for (const config of facetConfigs()) {
      expect(Boolean(config.hideWhenEmpty)).toBe(
        RESOURCE_FACET_CATALOG_KEYS.includes(config.key),
      );
    }
  });

  test("the preloaded Kubernetes cluster list still names its facet values", async () => {
    await renderViewer({ disableUrlSync: true });

    await waitFor(() => {
      expect(facetConfigFor("kubernetesClusterId")!.valueDisplayMap).toEqual({
        [CLUSTER_ID]: "prod-eu",
      });
    });
    expect(facetConfigFor("cephClusterId")!.valueDisplayMap).toBeUndefined();
  });

  test("REGRESSION: a Proxmox cluster picked in the sidebar reads 'Proxmox Cluster: <name>' and filters the entity id", async () => {
    facetsResponse = {
      proxmoxClusterId: [
        { value: PROXMOX_CLUSTER_ID, count: 7, displayName: "pve-prod" },
      ],
    };

    await renderViewer({ disableUrlSync: true });
    await waitForFacetData("proxmoxClusterId");

    await includeFromSidebar("proxmoxClusterId", PROXMOX_CLUSTER_ID);

    await waitFor(() => {
      expect(chipFor("proxmoxClusterId", PROXMOX_CLUSTER_ID)).toMatchObject({
        displayKey: "Proxmox Cluster",
        displayValue: "pve-prod",
      });
    });

    await waitFor(() => {
      expect(idsIn(lastExceptionListQuery()["primaryEntityId"])).toEqual([
        PROXMOX_CLUSTER_ID,
      ]);
    });

    // Never compiled as a column that does not exist.
    expect(lastExceptionListQuery()).not.toHaveProperty("proxmoxClusterId");

    // The chart and the facet counts read the same selection.
    await waitFor(() => {
      expect(lastPostTo("/telemetry/exceptions/facets").serviceIds).toEqual([
        PROXMOX_CLUSTER_ID,
      ]);
    });
    await waitFor(() => {
      expect(lastPostTo("/telemetry/exceptions/histogram").serviceIds).toEqual([
        PROXMOX_CLUSTER_ID,
      ]);
    });
    expect(lastPostTo("/telemetry/exceptions/facets")).not.toHaveProperty(
      "proxmoxClusterId",
    );

    // A server-named value needs no extra name lookup.
    const resolverLookups: Array<unknown> = getListMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (call[0] as GetListArgs).query["_id"] instanceof Includes;
      },
    );
    expect(resolverLookups).toEqual([]);
  });

  test("values in every resource facet union into the one entity id filter, each chip named", async () => {
    const facets: Record<string, Array<FacetValue>> = {};
    for (const definition of RESOURCE_FACET_CATALOG) {
      facets[definition.facetKey] = [
        {
          value: RESOURCE_IDS[definition.facetKey]!,
          count: 1,
          displayName: `${definition.label} one`,
        },
      ];
    }
    facetsResponse = facets;

    await renderViewer({ disableUrlSync: true });
    await waitForFacetData("iotFleetId");

    for (const definition of RESOURCE_FACET_CATALOG) {
      await includeFromSidebar(
        definition.facetKey,
        RESOURCE_IDS[definition.facetKey]!,
      );
    }

    const allIds: Array<string> = Object.values(RESOURCE_IDS).sort();

    await waitFor(() => {
      expect(idsIn(lastExceptionListQuery()["primaryEntityId"])).toEqual(
        allIds,
      );
    });

    for (const definition of RESOURCE_FACET_CATALOG) {
      expect(lastExceptionListQuery()).not.toHaveProperty(definition.facetKey);
      expect(
        chipFor(definition.facetKey, RESOURCE_IDS[definition.facetKey]!),
      ).toMatchObject({
        displayKey: definition.label,
        displayValue: `${definition.label} one`,
      });
    }

    await waitFor(() => {
      expect(
        [
          ...(lastPostTo("/telemetry/exceptions/facets").serviceIds || []),
        ].sort(),
      ).toEqual(allIds);
    });
  });

  test("an exception type picked in the sidebar is still a column filter, not an entity id", async () => {
    facetsResponse = {
      exceptionType: [{ value: "TypeError", count: 3 }],
    };

    await renderViewer({ disableUrlSync: true });
    await waitForFacetData("exceptionType");

    await includeFromSidebar("exceptionType", "TypeError");

    await waitFor(() => {
      expect(lastPostTo("/telemetry/exceptions/facets").exceptionTypes).toEqual(
        ["TypeError"],
      );
    });
    expect(
      lastPostTo("/telemetry/exceptions/facets").serviceIds,
    ).toBeUndefined();
    expect(idsIn(lastExceptionListQuery()["primaryEntityId"])).toEqual([]);
  });

  test("a URL-restored IoT fleet chip is looked up in the IoT fleet table and reads 'IoT Fleet: <name>'", async () => {
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(
        JSON.stringify([["iotFleetId", IOT_FLEET_ID]]),
      )}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(chipFor("iotFleetId", IOT_FLEET_ID)).toMatchObject({
        displayKey: "IoT Fleet",
        displayValue: "warehouse-sensors",
      });
    });

    // The key hint sent the id straight to its own table.
    const lookups: Array<GetListArgs> = getListMock.mock.calls
      .map((call: Array<unknown>): GetListArgs => {
        return call[0] as GetListArgs;
      })
      .filter((args: GetListArgs): boolean => {
        return args.query["_id"] instanceof Includes;
      });
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups[0]!.modelType).toBe(IoTFleet);
    expect(idsOf(lookups[0]!.query["_id"] as Includes)).toEqual([IOT_FLEET_ID]);

    // And the list is filtered by the fleet id.
    await waitFor(() => {
      expect(idsIn(lastExceptionListQuery()["primaryEntityId"])).toEqual([
        IOT_FLEET_ID,
      ]);
    });
  });
});
