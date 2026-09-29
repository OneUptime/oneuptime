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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The profiles table names every source it lists
 * ---------------------------------------------------------------------------
 *
 * A profile's primaryEntityId is a Service id only when primaryEntityType
 * says so. The table used to name Services and Hosts from its own lists and
 * print everything else — a RUM application, a Kubernetes cluster — as a
 * type label over "84858d6c…" (a RUM application read "Unknown source"), and
 * the Profiler overview's `?serviceId=` deep link chip showed an 8-character
 * id prefix. These tests render the real component with the table mocked to
 * capture its props, feed it a page of profiles through onFetchSuccess, and
 * render the captured Source cells.
 */

type CapturedColumn = {
  title: string;
  getElement?: ((item: Profile) => React.ReactElement) | undefined;
};

type CapturedTableProps = {
  columns?: Array<CapturedColumn>;
  onFetchSuccess?: ((data: Array<Profile>, count: number) => void) | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;
// How many times ProfileTable has rendered the (mocked) table.
let tableRenderCount: number = 0;

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      tableRenderCount += 1;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so getListMock is still unassigned when the factory runs.
 */
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

import ProfileTable from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable";
import Profile from "../../../Models/AnalyticsModels/Profile";
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
const RUM_APP_ID: string = "84858d6c-2222-4222-8222-222222222222";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MISSING_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type ModelType = { new (): unknown };

interface GetListArgs {
  modelType: ModelType;
  query: { projectId: ObjectID; _id?: Includes | undefined };
}

interface FakeRow {
  id: ObjectID;
  [field: string]: unknown;
}

/*
 * Rows the resolver can find, per table. The plain Service / Host list loads
 * (no `_id` in the query) are answered separately below.
 */
const RESOLVABLE: Array<[ModelType, FakeRow]> = [
  [RumApplication, { id: new ObjectID(RUM_APP_ID), name: "checkout-web" }],
  [KubernetesCluster, { id: new ObjectID(CLUSTER_ID), name: "prod-eu" }],
];

const makeService: () => Service = (): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(SERVICE_ID);
  service.name = "checkout-api";
  return service;
};

const makeHost: () => Host = (): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(HOST_ID);
  host.name = "web-01";
  return host;
};

const fakeGetList: (args: GetListArgs) => Promise<{
  data: Array<unknown>;
  count: number;
}> = async (
  args: GetListArgs,
): Promise<{ data: Array<unknown>; count: number }> => {
  if (!args.query._id) {
    if (args.modelType === Service) {
      return { data: [makeService()], count: 1 };
    }
    if (args.modelType === Host) {
      return { data: [makeHost()], count: 1 };
    }
    return { data: [], count: 0 };
  }

  const ids: Array<string> = (
    args.query._id.values as Array<string | ObjectID>
  ).map((value: string | ObjectID): string => {
    return value.toString();
  });

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
        return Boolean(args.query._id);
      })
      .map((args: GetListArgs): ResolverRequest => {
        return {
          modelType: args.modelType,
          ids: (args.query._id!.values as Array<string | ObjectID>).map(
            (value: string | ObjectID): string => {
              return value.toString();
            },
          ),
        };
      });
  };

const makeProfile: (
  entityId: string,
  entityType: ServiceType | undefined,
) => Profile = (
  entityId: string,
  entityType: ServiceType | undefined,
): Profile => {
  const profile: Profile = new Profile();
  profile.primaryEntityId = new ObjectID(entityId);
  profile.primaryEntityType = entityType;
  return profile;
};

const sourceColumn: () => CapturedColumn = (): CapturedColumn => {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Source";
    },
  );
  expect(column).toBeDefined();
  return column!;
};

// Text of the Source cell as the LATEST render of the table would draw it.
const sourceCellText: (profile: Profile) => string = (
  profile: Profile,
): string => {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>{sourceColumn().getElement!(profile)}</MemoryRouter>,
  );
  const text: string = view.container.textContent || "";
  view.unmount();
  return text;
};

const renderTable: () => Promise<ReturnType<typeof render>> = async (): Promise<
  ReturnType<typeof render>
> => {
  let view: ReturnType<typeof render> | null = null;
  await act(async (): Promise<void> => {
    view = render(
      <MemoryRouter>
        <ProfileTable />
      </MemoryRouter>,
    );
  });
  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
  return view!;
};

const deliverPage: (profiles: Array<Profile>) => Promise<void> = async (
  profiles: Array<Profile>,
): Promise<void> => {
  await act(async (): Promise<void> => {
    capturedTableProps!.onFetchSuccess!(profiles, profiles.length);
  });
};

describe("ProfileTable — entity names", () => {
  beforeEach(() => {
    capturedTableProps = null;
    tableRenderCount = 0;
    TelemetryEntityNameResolver.clearCache();
    getListMock.mockReset();
    getListMock.mockImplementation((...args: Array<any>) => {
      return fakeGetList(args[0] as GetListArgs);
    });
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  test("REGRESSION: a RUM application source shows its name and type", async () => {
    await renderTable();

    const rum: Profile = makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor);

    // Before the page arrives the cell degrades to type label + short id.
    expect(sourceCellText(rum)).toContain("RUM Application");
    expect(sourceCellText(rum)).toContain("84858d6c…");
    expect(sourceCellText(rum)).not.toContain("Unknown source");

    await deliverPage([rum]);

    await waitFor(() => {
      expect(sourceCellText(rum)).toContain("checkout-web");
    });
    expect(sourceCellText(rum)).toContain("RUM Application");
    expect(sourceCellText(rum)).not.toContain("84858d6c…");
  });

  test("every unnamed source on the page resolves in one type-hinted pass", async () => {
    await renderTable();

    const page: Array<Profile> = [
      makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor),
      makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor),
      makeProfile(CLUSTER_ID, ServiceType.KubernetesCluster),
      makeProfile(SERVICE_ID, ServiceType.OpenTelemetry),
      makeProfile(HOST_ID, ServiceType.Host),
    ];

    await deliverPage(page);

    await waitFor(() => {
      expect(sourceCellText(page[2]!)).toContain("prod-eu");
    });
    expect(sourceCellText(page[2]!)).toContain("Kubernetes Cluster");
    expect(sourceCellText(page[0]!)).toContain("checkout-web");

    // Service and Host rows still come from the loaded lists.
    expect(sourceCellText(page[3]!)).toContain("checkout-api");
    expect(sourceCellText(page[4]!)).toContain("web-01");
    expect(sourceCellText(page[4]!)).toContain("Host");

    /*
     * Hinted ids go straight to their tables: one RumApplication and one
     * KubernetesCluster request, no Service-first probe, and the Service /
     * Host ids the page already names are not looked up at all.
     */
    const requests: Array<ResolverRequest> = resolverRequests();
    expect(requests).toHaveLength(2);
    expect(
      requests.map((request: ResolverRequest): ModelType => {
        return request.modelType;
      }),
    ).toEqual(expect.arrayContaining([RumApplication, KubernetesCluster]));
    for (const request of requests) {
      expect(request.ids).not.toContain(SERVICE_ID);
      expect(request.ids).not.toContain(HOST_ID);
    }
  });

  test("a refetch of the same sources keeps state, so the table does not re-render", async () => {
    await renderTable();

    const page: Array<Profile> = [
      makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor),
    ];

    await deliverPage(page);
    await waitFor(() => {
      expect(sourceCellText(page[0]!)).toContain("checkout-web");
    });
    // Let the name landing settle before counting.
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    });
    const rendersAfterFirstPage: number = tableRenderCount;
    const requestsAfterFirstPage: number = resolverRequests().length;

    /*
     * A refetch hands back new Profile objects for the same sources. The
     * refs-key guard in handleProfilesFetched keeps the previous state, so
     * React bails out and the table is not rendered again. (The resolver
     * lookup count alone cannot catch a broken guard: the hook dedupes an
     * identical id set by key regardless.)
     */
    await deliverPage([makeProfile(RUM_APP_ID, ServiceType.RealUserMonitor)]);

    expect(tableRenderCount).toBe(rendersAfterFirstPage);
    expect(resolverRequests()).toHaveLength(requestsAfterFirstPage);

    // The counter does see a page with different sources.
    await deliverPage([makeProfile(CLUSTER_ID, ServiceType.KubernetesCluster)]);
    expect(tableRenderCount).toBeGreaterThan(rendersAfterFirstPage);
  });

  test("an unresolvable source keeps the type label and short id; an unknown type says so", async () => {
    await renderTable();

    const typed: Profile = makeProfile(
      MISSING_ID,
      ServiceType.ServerlessFunction,
    );
    const untyped: Profile = makeProfile(MISSING_ID, undefined);

    await deliverPage([typed]);
    await waitFor(() => {
      expect(resolverRequests().length).toBeGreaterThan(0);
    });

    expect(sourceCellText(typed)).toContain("Serverless Function");
    expect(sourceCellText(typed)).toContain("eeeeeeee…");
    expect(sourceCellText(untyped)).toContain("Unknown source");
  });

  test("REGRESSION: the ?serviceId= chip names a non-Service source instead of an id prefix", async () => {
    window.history.pushState({}, "", `/?serviceId=${RUM_APP_ID}`);

    const view: ReturnType<typeof render> = await renderTable();

    await waitFor(() => {
      expect(view.container.textContent).toContain("checkout-web");
    });
    expect(view.container.textContent).toContain("RUM Application");
    expect(view.container.textContent).not.toContain("84858d6c…");
  });

  test("the ?serviceId= chip for a loaded Service is named without a lookup", async () => {
    window.history.pushState({}, "", `/?serviceId=${SERVICE_ID}`);

    const view: ReturnType<typeof render> = await renderTable();

    expect(view.container.textContent).toContain("Service");
    expect(view.container.textContent).toContain("checkout-api");
    expect(resolverRequests()).toHaveLength(0);
  });

  test("REGRESSION: the ?serviceId= chip for a loaded Host reads 'Host: web-01' without a lookup", async () => {
    window.history.pushState({}, "", `/?serviceId=${HOST_ID}`);

    const view: ReturnType<typeof render> = await renderTable();

    await waitFor(() => {
      expect(view.container.textContent).toContain("web-01");
    });
    expect(view.container.textContent).toContain("Host");
    expect(view.container.textContent).not.toContain("bbbbbbbb…");
    expect(view.container.textContent).not.toContain("Service");
    expect(resolverRequests()).toHaveLength(0);
  });

  test("the ?serviceId= chip degrades to the short id when nothing names it", async () => {
    window.history.pushState({}, "", `/?serviceId=${MISSING_ID}`);

    const view: ReturnType<typeof render> = await renderTable();

    await waitFor(() => {
      expect(resolverRequests().length).toBeGreaterThan(0);
    });
    expect(view.container.textContent).toContain("Service");
    expect(view.container.textContent).toContain("eeeeeeee…");
  });
});
