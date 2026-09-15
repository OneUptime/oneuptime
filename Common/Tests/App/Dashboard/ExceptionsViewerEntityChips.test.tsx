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
 * The exceptions explorer names the entity behind every scope chip
 * ---------------------------------------------------------------------------
 *
 * A RUM application's exceptions tab passes the RumApplication id as
 * `primaryEntityId`, and the explorer used to label that locked chip from its
 * Service list only: "Service: 84858d6c-…". The same happened to incident /
 * alert stored-query chips and URL-restored chips for hosts, clusters and the
 * projectId "Unknown Service" bucket.
 *
 * The real viewer is rendered with TelemetryViewer mocked to capture the
 * chips it is handed, and ModelAPI faked so each table answers only for its
 * own ids — which also lets the tests pin that the ids used for FILTERING
 * never changed.
 */

type CapturedChip = {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
  readOnly?: boolean | undefined;
};

type CapturedViewerProps = {
  activeFilters?: Array<CapturedChip>;
};

let capturedViewerProps: CapturedViewerProps | null = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: CapturedViewerProps) => {
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
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUM_APP_ID: string = "84858d6c-2222-4222-8222-222222222222";

type ModelType = { new (): unknown };

interface GetListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
}

interface FakeRow {
  id: ObjectID;
  [field: string]: unknown;
}

/*
 * Rows only the RESOLVER can find (`_id` queries). The viewer's own sidebar
 * lists (no `_id`) hold just the one Service, so any other name on a chip
 * had to come from the resolver.
 */
const RESOLVABLE: Array<[ModelType, FakeRow]> = [
  [RumApplication, { id: new ObjectID(RUM_APP_ID), name: "checkout-web" }],
  [Host, { id: new ObjectID(HOST_ID), name: "web-01" }],
  [KubernetesCluster, { id: new ObjectID(CLUSTER_ID), name: "prod-eu" }],
  [Service, { id: new ObjectID(SERVICE_ID), name: "checkout-api" }],
];

/*
 * When set, RUM application lookups wait for it — lets a test observe the
 * chip BEFORE the name lands, which a resolved-immediately fake would race.
 */
let rumLookupGate: Promise<void> | null = null;

/*
 * When set, the viewer's own sidebar Service list waits for it — lets a test
 * observe what is looked up BEFORE the resource lists have loaded.
 */
let resourceListGate: Promise<void> | null = null;

// Rows the viewer's own sidebar Host list returns (empty by default).
let sidebarHosts: Array<Host> = [];

// When set, what the facets endpoint answers.
let facetsResponse: Record<string, unknown> | null = null;

// A Service only the server facet names (past the client list's cap).
const FACET_ONLY_SERVICE_ID: string = "99999999-9999-4999-8999-999999999999";

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
      if (resourceListGate) {
        await resourceListGate;
      }
      const service: Service = new Service();
      service.id = new ObjectID(SERVICE_ID);
      service.name = "checkout-api";
      return { data: [service], count: 1 };
    }
    if (args.modelType === Host) {
      return { data: sidebarHosts, count: sidebarHosts.length };
    }
    return { data: [], count: 0 };
  }

  if (args.modelType === RumApplication && rumLookupGate) {
    await rumLookupGate;
  }

  const ids: Array<string> = idsOf(idQuery);
  const data: Array<FakeRow> = RESOLVABLE.filter(
    (entry: [ModelType, FakeRow]): boolean => {
      return (
        entry[0] === args.modelType && ids.includes(entry[1].id.toString())
      );
    },
  ).map((entry: [ModelType, FakeRow]): FakeRow => {
    return entry[1];
  });
  return { data, count: data.length };
};

type ResolverRequest = { modelType: ModelType; ids: Array<string> };

const resolverRequests: () => Array<ResolverRequest> =
  (): Array<ResolverRequest> => {
    return getListMock.mock.calls
      .map((call: Array<unknown>): GetListArgs => {
        return call[0] as GetListArgs;
      })
      .filter((args: GetListArgs): boolean => {
        return args.query["_id"] instanceof Includes;
      })
      .map((args: GetListArgs): ResolverRequest => {
        return {
          modelType: args.modelType,
          ids: idsOf(args.query["_id"] as Includes),
        };
      });
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

const chipFor: (facetKey: string, value: string) => CapturedChip | undefined = (
  facetKey: string,
  value: string,
): CapturedChip | undefined => {
  return (capturedViewerProps?.activeFilters || []).find(
    (candidate: CapturedChip): boolean => {
      return candidate.facetKey === facetKey && candidate.value === value;
    },
  );
};

// Let effects released by a state change run their lookups.
const flush: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

const closeResourceListGate: () => () => void = (): (() => void) => {
  let release: () => void = (): void => {};
  resourceListGate = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return (): void => {
    release();
  };
};

const makeSidebarHost: () => Host = (): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(HOST_ID);
  host.name = "web-01";
  return host;
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

describe("ExceptionsViewer — entity chip names", () => {
  beforeEach(() => {
    capturedViewerProps = null;
    rumLookupGate = null;
    resourceListGate = null;
    sidebarHosts = [];
    facetsResponse = null;
    TelemetryEntityNameResolver.clearCache();
    getListMock.mockReset();
    getListMock.mockImplementation((...args: Array<any>) => {
      return fakeGetList(args[0] as GetListArgs);
    });
    postMock.mockReset();
    postMock.mockImplementation((...args: Array<any>) => {
      const url: string = String((args[0] as { url?: unknown })?.url || "");
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

  test("REGRESSION: a RUM application scope chip reads 'RUM Application: checkout-web'", async () => {
    let releaseRumLookup: () => void = (): void => {};
    rumLookupGate = new Promise<void>((resolve: () => void): void => {
      releaseRumLookup = resolve;
    });

    await renderViewer({
      primaryEntityId: new ObjectID(RUM_APP_ID),
      scopeEntityType: ServiceType.RealUserMonitor,
      disableUrlSync: true,
    });

    // The key is right before any lookup lands.
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayKey).toBe(
      "RUM Application",
    );
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
      RUM_APP_ID,
    );

    await act(async (): Promise<void> => {
      releaseRumLookup();
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
        "checkout-web",
      );
    });

    const scopeChip: CapturedChip = chipFor("primaryEntityId", RUM_APP_ID)!;
    expect(scopeChip.displayKey).toBe("RUM Application");
    expect(scopeChip.readOnly).toBe(true);

    // The hint sent the lookup straight to the RUM table.
    expect(resolverRequests()).toEqual([
      { modelType: RumApplication, ids: [RUM_APP_ID] },
    ]);

    // Filtering is unchanged: the list query still carries the raw id.
    const queries: Array<Record<string, unknown>> = exceptionListQueries();
    expect(queries.length).toBeGreaterThan(0);
    expect(String(queries[queries.length - 1]!["primaryEntityId"])).toBe(
      RUM_APP_ID,
    );
  });

  test("without scopeEntityType the chip adopts the resolved type once known", async () => {
    let releaseRumLookup: () => void = (): void => {};
    rumLookupGate = new Promise<void>((resolve: () => void): void => {
      releaseRumLookup = resolve;
    });

    await renderViewer({
      primaryEntityId: new ObjectID(RUM_APP_ID),
      disableUrlSync: true,
    });

    // Unknown table, name not in yet: the generic default.
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayKey).toBe("Service");
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
      RUM_APP_ID,
    );

    await act(async (): Promise<void> => {
      releaseRumLookup();
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayKey).toBe(
        "RUM Application",
      );
    });
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
      "checkout-web",
    );
  });

  test("a Service page is unchanged: 'Service: checkout-api'", async () => {
    await renderViewer({
      primaryEntityId: new ObjectID(SERVICE_ID),
      scopeEntityType: ServiceType.OpenTelemetry,
      disableUrlSync: true,
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", SERVICE_ID)?.displayValue).toBe(
        "checkout-api",
      );
    });
    expect(chipFor("primaryEntityId", SERVICE_ID)?.displayKey).toBe("Service");
  });

  test("the projectId bucket reads 'Service: Unknown Service'", async () => {
    await renderViewer({
      primaryEntityId: PROJECT_ID,
      disableUrlSync: true,
    });

    await waitFor(() => {
      expect(
        chipFor("primaryEntityId", PROJECT_ID.toString())?.displayValue,
      ).toBe("Unknown Service");
    });
    expect(chipFor("primaryEntityId", PROJECT_ID.toString())?.displayKey).toBe(
      "Service",
    );
  });

  test("REGRESSION: an incident's stored primaryEntityId chip is named", async () => {
    await renderViewer({
      exceptionInstanceQuery: {
        primaryEntityId: RUM_APP_ID,
      } as never,
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
        "checkout-web",
      );
    });
    const chip: CapturedChip = chipFor("primaryEntityId", RUM_APP_ID)!;
    expect(chip.displayKey).toBe("RUM Application");
    expect(chip.readOnly).toBe(true);
  });

  test("URL-restored chips for a host and a cluster are named", async () => {
    const filters: string = JSON.stringify([
      ["primaryEntityId", HOST_ID],
      ["kubernetesClusterId", CLUSTER_ID],
    ]);
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(filters)}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(chipFor("primaryEntityId", HOST_ID)?.displayValue).toBe("web-01");
    });
    expect(chipFor("primaryEntityId", HOST_ID)?.displayKey).toBe("Host");

    await waitFor(() => {
      expect(chipFor("kubernetesClusterId", CLUSTER_ID)?.displayValue).toBe(
        "prod-eu",
      );
    });
    expect(chipFor("kubernetesClusterId", CLUSTER_ID)?.displayKey).toBe(
      "Kubernetes Cluster",
    );

    // Both chips were resolved in the same pass.
    const cluster: Array<ResolverRequest> = resolverRequests().filter(
      (request: ResolverRequest): boolean => {
        return request.modelType === KubernetesCluster;
      },
    );
    expect(cluster.length).toBeGreaterThan(0);
    expect(cluster[0]!.ids).toContain(CLUSTER_ID);
  });

  test('a legacy ?filters=[["serviceId", …]] chip is named too', async () => {
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(JSON.stringify([["serviceId", RUM_APP_ID]]))}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(chipFor("serviceId", RUM_APP_ID)?.displayValue).toBe(
        "checkout-web",
      );
    });
    expect(chipFor("serviceId", RUM_APP_ID)?.displayKey).toBe(
      "RUM Application",
    );
  });

  test("REGRESSION: a Service page whose Service is already listed issues no name lookup", async () => {
    await renderViewer({
      primaryEntityId: new ObjectID(SERVICE_ID),
      scopeEntityType: ServiceType.OpenTelemetry,
      disableUrlSync: true,
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", SERVICE_ID)?.displayValue).toBe(
        "checkout-api",
      );
    });
    await flush();

    expect(resolverRequests()).toHaveLength(0);
  });

  test("a scope typed as a non-Service entity is named while the resource lists are still loading", async () => {
    const releaseLists: () => void = closeResourceListGate();

    await renderViewer({
      primaryEntityId: new ObjectID(RUM_APP_ID),
      scopeEntityType: ServiceType.RealUserMonitor,
      disableUrlSync: true,
    });

    // The Service list is still pending, yet the name lands.
    await waitFor(() => {
      expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
        "checkout-web",
      );
    });
    expect(resolverRequests()).toEqual([
      { modelType: RumApplication, ids: [RUM_APP_ID] },
    ]);

    await act(async (): Promise<void> => {
      releaseLists();
    });
    await flush();

    // The lists landing does not look it up again, and the name stays.
    expect(resolverRequests()).toHaveLength(1);
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
      "checkout-web",
    );
    expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayKey).toBe(
      "RUM Application",
    );
  });

  test("URL chips wait for the resource lists, then only the ids they cannot name are looked up", async () => {
    const releaseLists: () => void = closeResourceListGate();
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(
        JSON.stringify([
          ["primaryEntityId", SERVICE_ID],
          ["primaryEntityId", RUM_APP_ID],
        ]),
      )}`,
    );

    await renderViewer({});
    await flush();

    // Nothing is looked up while every id still looks unnamed.
    expect(resolverRequests()).toHaveLength(0);

    await act(async (): Promise<void> => {
      releaseLists();
    });

    await waitFor(() => {
      expect(chipFor("primaryEntityId", RUM_APP_ID)?.displayValue).toBe(
        "checkout-web",
      );
    });
    expect(chipFor("primaryEntityId", SERVICE_ID)?.displayValue).toBe(
      "checkout-api",
    );
    expect(chipFor("primaryEntityId", SERVICE_ID)?.displayKey).toBe("Service");

    expect(resolverRequests().length).toBeGreaterThan(0);
    for (const request of resolverRequests()) {
      expect(request.ids).not.toContain(SERVICE_ID);
    }
  });

  test("a hostId chip the Host list names is not looked up", async () => {
    sidebarHosts = [makeSidebarHost()];
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(JSON.stringify([["hostId", HOST_ID]]))}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(chipFor("hostId", HOST_ID)?.displayValue).toBe("web-01");
    });
    await flush();

    expect(chipFor("hostId", HOST_ID)?.displayKey).toBe("Host");
    expect(resolverRequests()).toHaveLength(0);
  });

  test("the same Host id under primaryEntityId is still resolved (its facet lists Services only)", async () => {
    sidebarHosts = [makeSidebarHost()];
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(
        JSON.stringify([["primaryEntityId", HOST_ID]]),
      )}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(chipFor("primaryEntityId", HOST_ID)?.displayKey).toBe("Host");
    });
    expect(chipFor("primaryEntityId", HOST_ID)?.displayValue).toBe("web-01");
  });

  test("a chip the server facet already names is not looked up", async () => {
    const releaseLists: () => void = closeResourceListGate();
    facetsResponse = {
      primaryEntityId: [
        { value: FACET_ONLY_SERVICE_ID, count: 1, displayName: "billing-api" },
      ],
    };
    window.history.pushState(
      {},
      "",
      `/?filters=${encodeURIComponent(
        JSON.stringify([["primaryEntityId", FACET_ONLY_SERVICE_ID]]),
      )}`,
    );

    await renderViewer({});

    await waitFor(() => {
      expect(
        chipFor("primaryEntityId", FACET_ONLY_SERVICE_ID)?.displayValue,
      ).toBe("billing-api");
    });

    await act(async (): Promise<void> => {
      releaseLists();
    });
    await flush();

    for (const request of resolverRequests()) {
      expect(request.ids).not.toContain(FACET_ONLY_SERVICE_ID);
    }
    expect(chipFor("primaryEntityId", FACET_ONLY_SERVICE_ID)?.displayKey).toBe(
      "Service",
    );
  });

  test("REGRESSION: a stored scope attribute chip reads 'Host', not 'resource.host.name'", async () => {
    await renderViewer({
      exceptionInstanceQuery: {
        attributes: { "resource.host.name": "web-01" },
      } as never,
    });

    await waitFor(() => {
      expect(chipFor("attributes.resource.host.name", "web-01")).toBeDefined();
    });
    const attributeChip: CapturedChip = chipFor(
      "attributes.resource.host.name",
      "web-01",
    )!;
    expect(attributeChip.displayKey).toBe("Host");
    expect(attributeChip.displayValue).toBe("web-01");
    expect(attributeChip.readOnly).toBe(true);
  });

  test("with no entity chips no name lookup is issued", async () => {
    await renderViewer({ disableUrlSync: true });

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(resolverRequests()).toHaveLength(0);
  });
});
