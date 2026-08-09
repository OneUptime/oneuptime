import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the Resources tab of a status page with a very large
 * group hierarchy (issue #3042).
 *
 * The tab used to render one ModelTable per group, eagerly. A ModelTable
 * fetches the moment it mounts and offers no way to defer that, so a status
 * page with 1506 groups mounted 1506 tables and fired 1506 list requests as
 * soon as the tab opened. The reporter watched the browser tab climb past a
 * gigabyte, go blank, and then fail with "Network Error".
 *
 * So the invariant this file exists to hold is a counting one, and it is about
 * requests rather than pixels:
 *
 *   - opening the tab costs a fixed number of requests, whatever the hierarchy
 *     size,
 *   - a closed group fetches nothing and mounts nothing - including its sub
 *     groups, which is what stops a deep tree from unfolding all at once,
 *   - opening one group fetches exactly that group,
 *   - and closing it again unmounts it, so memory does not only ever grow.
 *
 * ModelAPI is mocked at the module boundary and every call is recorded, so
 * "did not fetch" is asserted directly rather than inferred from the DOM.
 */

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162001";
const STATUS_PAGE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162002";

jest.mock("Common/UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      /*
       * Referenced from inside the function body rather than captured when the
       * factory runs: jest.mock is hoisted above the imports, so ObjectID is
       * only bound by the time anything actually calls this.
       */
      getLastParamAsObjectID: () => {
        return new ObjectID(STATUS_PAGE_ID);
      },
      getCurrentRoute: () => {
        return {
          toString: () => {
            return "/";
          },
        };
      },
      navigate: jest.fn(),
      getQueryStringByName: () => {
        return null;
      },
      setQueryStringByName: jest.fn(),
      getCurrentPath: () => {
        return "/";
      },
    },
  };
});

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID(PROJECT_ID);
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

/*
 * The real table is four thousand lines of chrome that this suite has no
 * assertions about. What matters is the one behaviour that caused the bug:
 * mounting one issues a list request for the query it was handed. The stub
 * reproduces exactly that, so "1506 tables mounted" shows up as 1506 recorded
 * requests rather than as a jsdom timeout.
 */
jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      id: string;
      modelType: unknown;
      query: Record<string, unknown>;
      onFetchSuccess?: (data: Array<unknown>, totalCount: number) => void;
    }) => {
      React.useEffect(() => {
        ModelAPI.getList({
          modelType: props.modelType as any,
          query: props.query as any,
          limit: 10,
          skip: 0,
          select: {},
          sort: {},
        })
          .then((result: any) => {
            /*
             * The real table reports what the server said it matched, and that
             * is how the tree keeps its counts honest without re-reading the
             * whole status page.
             */
            props.onFetchSuccess?.(result.data, result.count);
            return undefined;
          })
          /* The real table renders the failure rather than throwing it. */
          .catch(() => {
            return undefined;
          });
      }, []);

      return React.createElement(
        "div",
        { "data-testid": `mounted-model-table-${props.id}` },
        props.id,
      );
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      count: jest.fn(),
      deleteItem: jest.fn(),
    },
  };
});

import StatusPageResources from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;

interface GetListCall {
  modelType: unknown;
  query: Record<string, unknown>;
}

type GroupSpec = {
  id: string;
  name: string;
  parentId?: string | undefined;
  order?: number | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
};

type MakeGroupFunction = (spec: GroupSpec) => StatusPageGroup;

const makeGroup: MakeGroupFunction = (spec: GroupSpec): StatusPageGroup => {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = spec.id;
  group.name = spec.name;
  group.order = spec.order === undefined ? 1 : spec.order;

  if (spec.parentId) {
    group.parentStatusPageGroupId = new ObjectID(spec.parentId);
  }

  if (spec.viewMode) {
    group.viewMode = spec.viewMode;
  }

  return group;
};

type MakeResourceFunction = (
  id: string,
  statusPageGroupId?: string | undefined,
) => StatusPageResource;

const makeResource: MakeResourceFunction = (
  id: string,
  statusPageGroupId?: string | undefined,
): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = id;

  if (statusPageGroupId) {
    resource.statusPageGroupId = new ObjectID(statusPageGroupId);
  }

  return resource;
};

/*
 * Corporate > Region 1000 > Market 1001, plus a grid group. Small enough to
 * read, deep enough that "a closed group does not render its sub groups"
 * is observable.
 */
const CORPORATE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163001";
const REGION_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163002";
const MARKET_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163003";
const GRID_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163004";

type BuildHierarchyFunction = () => Array<StatusPageGroup>;

const buildHierarchy: BuildHierarchyFunction = (): Array<StatusPageGroup> => {
  const grid: StatusPageGroup = makeGroup({
    id: GRID_ID,
    name: "Grid Group",
    order: 2,
    viewMode: StatusPageGroupViewMode.Grid,
  });
  grid.rowAxisValues = "Auth, API";
  grid.columnAxisValues = "US-East, EU-West";
  grid.rowAxisLabel = "Service";
  grid.columnAxisLabel = "Region";

  return [
    makeGroup({ id: CORPORATE_ID, name: "Corporate", order: 1 }),
    makeGroup({
      id: REGION_ID,
      name: "Region 1000",
      parentId: CORPORATE_ID,
      order: 1,
    }),
    makeGroup({
      id: MARKET_ID,
      name: "Market 1001",
      parentId: REGION_ID,
      order: 1,
    }),
    grid,
  ];
};

type SetUpApiFunction = (data: {
  groups: Array<StatusPageGroup>;
  resources?: Array<StatusPageResource> | undefined;
  resourceTotalCount?: number | undefined;
}) => Array<GetListCall>;

const setUpApi: SetUpApiFunction = (data: {
  groups: Array<StatusPageGroup>;
  resources?: Array<StatusPageResource> | undefined;
  resourceTotalCount?: number | undefined;
}): Array<GetListCall> => {
  const calls: Array<GetListCall> = [];
  const resources: Array<StatusPageResource> = data.resources || [];

  mockGetList.mockImplementation(async (callData: any): Promise<any> => {
    calls.push({ modelType: callData.modelType, query: callData.query || {} });

    if (callData.modelType === StatusPageGroup) {
      return {
        data: data.groups,
        count: data.groups.length,
        skip: 0,
        limit: data.groups.length,
      };
    }

    const isGroupScoped: boolean = Object.prototype.hasOwnProperty.call(
      callData.query || {},
      "statusPageGroupId",
    );

    if (!isGroupScoped) {
      return {
        data: resources,
        count:
          data.resourceTotalCount === undefined
            ? resources.length
            : data.resourceTotalCount,
        skip: 0,
        limit: resources.length,
      };
    }

    const wantedGroupId: string | null = callData.query.statusPageGroupId
      ? callData.query.statusPageGroupId.toString()
      : null;

    const inGroup: Array<StatusPageResource> = resources.filter(
      (resource: StatusPageResource) => {
        return (
          (resource.statusPageGroupId?.toString() || null) === wantedGroupId
        );
      },
    );

    return {
      data: inGroup,
      count: inGroup.length,
      skip: 0,
      limit: inGroup.length,
    };
  });

  return calls;
};

type ResourceCallsFunction = (calls: Array<GetListCall>) => Array<GetListCall>;

const resourceCalls: ResourceCallsFunction = (
  calls: Array<GetListCall>,
): Array<GetListCall> => {
  return calls.filter((call: GetListCall) => {
    return call.modelType === StatusPageResource;
  });
};

/*
 * The per-group fetches - everything except the one pass over all resources
 * that builds the count badges, which deliberately does not filter by group.
 */
type GroupScopedResourceCallsFunction = (
  calls: Array<GetListCall>,
) => Array<GetListCall>;

const groupScopedResourceCalls: GroupScopedResourceCallsFunction = (
  calls: Array<GetListCall>,
): Array<GetListCall> => {
  return resourceCalls(calls).filter((call: GetListCall) => {
    return Object.prototype.hasOwnProperty.call(
      call.query,
      "statusPageGroupId",
    );
  });
};

type RenderPageFunction = () => ReturnType<typeof render>;

const renderPage: RenderPageFunction = (): ReturnType<typeof render> => {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  project.name = "Test Project";

  return render(
    <StatusPageResources
      pageRoute={new Route("/dashboard/status-pages")}
      currentProject={project}
      hasPaymentMethod={true}
    />,
  );
};

/*
 * The page settles over three commits - groups arrive, the tree renders, and
 * the sections that are open on load mount their tables. React 18 flushes a
 * passive effect at the next act boundary rather than with the commit that
 * scheduled it, so a "how many requests were made" assertion taken the instant
 * a group name appears would be reading a half finished page. This drains the
 * queue so those assertions describe the settled state.
 */
type FlushEffectsFunction = () => Promise<void>;

const flushEffects: FlushEffectsFunction = async (): Promise<void> => {
  // One boundary per commit in that chain, with room to spare.
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

type HeadersFunction = () => Array<HTMLElement>;

const headers: HeadersFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("status-page-resource-group-header");
};

type HeaderByNameFunction = (name: string) => HTMLElement;

const headerByName: HeaderByNameFunction = (name: string): HTMLElement => {
  const found: HTMLElement | undefined = headers().find(
    (header: HTMLElement) => {
      return (header.textContent || "").includes(name);
    },
  );

  if (!found) {
    throw new Error(`No group row called ${name} is on screen`);
  }

  return found;
};

describe("Status Page > Resources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  describe("opening the tab", () => {
    test("draws every top level group", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.getByText("Grid Group")).toBeInTheDocument();
    });

    /*
     * The bug, stated as a count. Everything nested stays out of the DOM until
     * its parent is opened, so a hierarchy four levels deep still costs one row
     * per top level group.
     */
    test("does not draw the sub groups of a closed group", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.queryByText("Region 1000")).not.toBeInTheDocument();
      expect(screen.queryByText("Market 1001")).not.toBeInTheDocument();
    });

    test("every group row starts closed", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      for (const header of headers()) {
        if ((header.textContent || "").includes("Uncategorized")) {
          continue;
        }

        expect(header).toHaveAttribute("aria-expanded", "false");
      }
    });

    test("fetches no group's resources", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      /*
       * The only group scoped request is the Uncategorized bucket's, which is
       * the one section that opens by default - it is where a monitor with no
       * group lands, and there is exactly one of it however many groups exist.
       */
      await waitFor(() => {
        expect(groupScopedResourceCalls(calls)).toHaveLength(1);
      });
      await flushEffects();

      expect(groupScopedResourceCalls(calls)).toHaveLength(1);
      expect(
        groupScopedResourceCalls(calls)[0]!.query["statusPageGroupId"],
      ).toBeNull();
    });

    test("reads the groups once and the resource counts once", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(
        calls.filter((call: GetListCall) => {
          return call.modelType === StatusPageGroup;
        }),
      ).toHaveLength(1);

      const countCalls: Array<GetListCall> = resourceCalls(calls).filter(
        (call: GetListCall) => {
          return !Object.prototype.hasOwnProperty.call(
            call.query,
            "statusPageGroupId",
          );
        },
      );

      expect(countCalls).toHaveLength(1);
    });
  });

  describe("the hierarchy from the bug report", () => {
    type BuildLargeHierarchyFunction = () => Array<StatusPageGroup>;

    const buildLargeHierarchy: BuildLargeHierarchyFunction =
      (): Array<StatusPageGroup> => {
        const groups: Array<StatusPageGroup> = [
          makeGroup({ id: CORPORATE_ID, name: "Corporate Units", order: 0 }),
        ];

        for (let i: number = 0; i < 1505; i++) {
          groups.push(
            makeGroup({
              id: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
              name: `Region ${i}`,
              parentId: CORPORATE_ID,
              order: i,
            }),
          );
        }

        return groups;
      };

    /*
     * 1506 groups, the number in the report. Before the rewrite this was 1506
     * tables and 1506 requests; now every one of those groups hangs off a
     * single closed row.
     */
    test("1506 groups cost one group request, one count request and one row", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildLargeHierarchy(),
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate Units")).toBeInTheDocument();
      });
      await flushEffects();

      await waitFor(() => {
        expect(groupScopedResourceCalls(calls)).toHaveLength(1);
      });
      await flushEffects();

      expect(calls).toHaveLength(3);
      expect(groupScopedResourceCalls(calls)).toHaveLength(1);

      // Uncategorized plus the one top level group. Nothing else is drawn.
      expect(headers()).toHaveLength(2);
    });

    /*
     * The other shape that can blow up: a page whose groups are all at the top
     * level, where closing hides nothing. Rows are drawn a page at a time
     * instead.
     */
    test("1500 top level groups are drawn a page at a time", async () => {
      const groups: Array<StatusPageGroup> = [];

      for (let i: number = 0; i < 1500; i++) {
        groups.push(
          makeGroup({
            id: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
            name: `Region ${i}`,
            order: i,
          }),
        );
      }

      const calls: Array<GetListCall> = setUpApi({ groups: groups });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Region 0")).toBeInTheDocument();
      });
      await flushEffects();

      expect(groupScopedResourceCalls(calls)).toHaveLength(1);
      expect(headers().length).toBeLessThan(1500);
      expect(
        screen.getByTestId("status-page-resource-group-show-more"),
      ).toBeInTheDocument();
    });

    test("show more draws the next page of rows without fetching a group", async () => {
      const groups: Array<StatusPageGroup> = [];

      for (let i: number = 0; i < 120; i++) {
        groups.push(
          makeGroup({
            id: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
            name: `Region ${i}`,
            order: i,
          }),
        );
      }

      const calls: Array<GetListCall> = setUpApi({ groups: groups });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Region 0")).toBeInTheDocument();
      });
      await flushEffects();

      const before: number = headers().length;

      fireEvent.click(
        screen
          .getByTestId("status-page-resource-group-show-more")
          .querySelector("button")!,
      );

      await waitFor(() => {
        expect(headers().length).toBeGreaterThan(before);
      });

      expect(groupScopedResourceCalls(calls)).toHaveLength(1);
    });
  });

  describe("opening a group", () => {
    test("fetches that group's resources and only that group's", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(groupScopedResourceCalls(calls)).toHaveLength(2);
      });

      expect(
        groupScopedResourceCalls(calls)[1]!.query[
          "statusPageGroupId"
        ]!.toString(),
      ).toBe(CORPORATE_ID);
    });

    test("reveals its sub groups, still closed", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(screen.getByText("Region 1000")).toBeInTheDocument();
      });

      expect(headerByName("Region 1000")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // Still one level at a time: Region's own sub group stays out of the DOM.
      expect(screen.queryByText("Market 1001")).not.toBeInTheDocument();
    });

    test("opens one level at a time all the way down", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));
      await waitFor(() => {
        expect(screen.getByText("Region 1000")).toBeInTheDocument();
      });

      fireEvent.click(headerByName("Region 1000"));
      await waitFor(() => {
        expect(screen.getByText("Market 1001")).toBeInTheDocument();
      });

      // Uncategorized + Corporate + Region 1000. Market is open by nobody.
      expect(groupScopedResourceCalls(calls)).toHaveLength(3);
    });

    /*
     * Closing has to unmount rather than hide. A hidden table is still a
     * mounted table, and a page that only ever accumulates them is the memory
     * curve from the report.
     */
    test("closing it again takes its table back out of the page", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(
          screen.getByTestId(
            `mounted-model-table-status-page-resources-${CORPORATE_ID}`,
          ),
        ).toBeInTheDocument();
      });

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(
          screen.queryByTestId(
            `mounted-model-table-status-page-resources-${CORPORATE_ID}`,
          ),
        ).not.toBeInTheDocument();
      });

      expect(screen.queryByText("Region 1000")).not.toBeInTheDocument();
    });

    test("a grid group opens into its matrix rather than a table", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Grid Group")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Grid Group"));

      // One "add monitor" affordance per cell of a 2x2 grid.
      await waitFor(() => {
        expect(screen.getAllByTestId("grid-cell-add-monitor")).toHaveLength(4);
      });

      expect(
        screen.getByTestId("status-page-resource-grid-panel"),
      ).toBeInTheDocument();
    });
  });

  describe("the counts on a closed row", () => {
    test("report everything in the group's subtree, not just its own", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource("r1", MARKET_ID),
          makeResource("r2", MARKET_ID),
          makeResource("r3", REGION_ID),
          makeResource("r4"),
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(headerByName("Corporate").textContent).toContain("3 resources");
    });

    test("the uncategorized row reports the resources with no group", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource("r1"), makeResource("r2", MARKET_ID)],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Uncategorized")).toBeInTheDocument();
      });
      await flushEffects();

      expect(headerByName("Uncategorized").textContent).toContain("1 resource");
    });

    /*
     * A count derived from a truncated list is a lower bound. Rendering it as
     * a count would tell an operator a group is empty when it is not.
     */
    test("say nothing when the resource list came back truncated", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource("r1", MARKET_ID)],
        resourceTotalCount: 12000,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(headerByName("Corporate").textContent).not.toContain("resource");
    });

    test("still draw the tree when the count request fails outright", async () => {
      mockGetList.mockImplementation(async (callData: any): Promise<any> => {
        if (callData.modelType === StatusPageGroup) {
          return {
            data: buildHierarchy(),
            count: 4,
            skip: 0,
            limit: 4,
          };
        }

        throw new Error("Network Error");
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.queryByText("Network Error")).not.toBeInTheDocument();
    });
  });

  describe("searching for a group", () => {
    test("finds a group buried deep in the hierarchy without opening it", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        { target: { value: "market" } },
      );

      await waitFor(() => {
        expect(screen.getByText("Market 1001")).toBeInTheDocument();
      });

      expect(groupScopedResourceCalls(calls)).toHaveLength(1);
    });

    test("shows where each result lives in the hierarchy", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        { target: { value: "market" } },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("status-page-resource-group-path"),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByTestId("status-page-resource-group-path").textContent,
      ).toBe("Corporate › Region 1000 › Market 1001");
    });

    test("says so when nothing matches", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        { target: { value: "nothing called this" } },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("status-page-resource-group-search-empty"),
        ).toBeInTheDocument();
      });
    });

    test("a result can be opened straight from the search", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        { target: { value: "market" } },
      );

      await waitFor(() => {
        expect(screen.getByText("Market 1001")).toBeInTheDocument();
      });

      fireEvent.click(headerByName("Market 1001"));

      await waitFor(() => {
        expect(groupScopedResourceCalls(calls)).toHaveLength(2);
      });

      expect(
        groupScopedResourceCalls(calls)[1]!.query[
          "statusPageGroupId"
        ]!.toString(),
      ).toBe(MARKET_ID);
    });
  });

  describe("keeping the counts honest after a change", () => {
    /*
     * The page reads every resource on the status page exactly once, on load.
     * After that the counts are kept up to date by the open groups themselves,
     * because re-reading a ten thousand row list after every create and delete
     * is a megabyte of JSON per edit - and it races with itself when two edits
     * land close together.
     */
    test("an open group's own fetch corrects its row, with no second page wide read", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource("r1", CORPORATE_ID),
          makeResource("r2", CORPORATE_ID),
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(headerByName("Corporate").textContent).toContain("2 resources");

      const pageWideReadsBefore: number =
        resourceCalls(calls).length - groupScopedResourceCalls(calls).length;

      /*
       * The group now holds one resource, which is what its table will report
       * the next time it fetches.
       */
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource("r1", CORPORATE_ID)],
      });

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(headerByName("Corporate").textContent).toContain("1 resource");
      });

      expect(
        resourceCalls(calls).length - groupScopedResourceCalls(calls).length,
      ).toBe(pageWideReadsBefore);
    });
  });

  describe("switching between the tree and the search", () => {
    /*
     * Search is a different view of the same groups, so it gets its own
     * expansion state. Sharing one would mean a single keystroke unmounts every
     * open group and immediately remounts whichever of them matched - one list
     * request per open group, per keystroke.
     */
    test("typing does not re-open, or re-fetch, the groups that were open", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(groupScopedResourceCalls(calls)).toHaveLength(2);
      });
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "corporate" },
        },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("status-page-resource-group-path"),
        ).toBeInTheDocument();
      });
      await flushEffects();

      expect(headerByName("Corporate")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(groupScopedResourceCalls(calls)).toHaveLength(2);
    });

    test("clearing the search puts the tree back the way it was", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(screen.getByText("Region 1000")).toBeInTheDocument();
      });

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "corporate" },
        },
      );
      await flushEffects();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "" },
        },
      );

      await waitFor(() => {
        expect(screen.getByText("Region 1000")).toBeInTheDocument();
      });
    });

    /*
     * The flat result list never renders a match's children, and the sub group
     * badge is the same one the tree uses to mean "open this to see them".
     */
    test("a search result does not promise sub groups it cannot show", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(
        screen.getByTestId("status-page-resource-group-sub-group-count"),
      ).toBeInTheDocument();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "corporate" },
        },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("status-page-resource-group-path"),
        ).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId("status-page-resource-group-sub-group-count"),
      ).not.toBeInTheDocument();
    });
  });

  describe("expand all", () => {
    test("is offered for a hierarchy small enough to be safe", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.getByTestId("expand-all-groups")).toBeInTheDocument();
    });

    /*
     * The guard rail. "Expand all" mounts a table and fires a request per
     * group, so offering it at 1506 groups would put the original bug back
     * behind a button.
     */
    test("is withheld at the scale that broke the page", async () => {
      const groups: Array<StatusPageGroup> = [];

      for (let i: number = 0; i < 200; i++) {
        groups.push(
          makeGroup({
            id: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
            name: `Region ${i}`,
            order: i,
          }),
        );
      }

      setUpApi({ groups: groups });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Region 0")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.queryByTestId("expand-all-groups")).not.toBeInTheDocument();
    });

    /*
     * Uncategorized opens by default and holds a mounted, fetching table, so a
     * "Collapse All" that sits disabled next to it - or leaves it open - is not
     * telling the truth about what it does.
     */
    test("collapse all is offered while only the uncategorized section is open", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      expect(screen.getByTestId("collapse-all-groups")).not.toBeDisabled();
    });

    test("collapse all closes the uncategorized section too", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Uncategorized")).toBeInTheDocument();
      });
      await flushEffects();

      expect(
        screen.getByTestId("ungrouped-status-page-resource-panel"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("collapse-all-groups"));

      await waitFor(() => {
        expect(
          screen.queryByTestId("ungrouped-status-page-resource-panel"),
        ).not.toBeInTheDocument();
      });

      expect(screen.getByTestId("collapse-all-groups")).toBeDisabled();
    });

    test("collapse all closes everything that was opened", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText("Corporate")).toBeInTheDocument();
      });
      await flushEffects();

      fireEvent.click(headerByName("Corporate"));

      await waitFor(() => {
        expect(screen.getByText("Region 1000")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("collapse-all-groups"));

      await waitFor(() => {
        expect(screen.queryByText("Region 1000")).not.toBeInTheDocument();
      });

      expect(headerByName("Corporate")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });

  describe("a status page with no groups at all", () => {
    test("is a single flat list, with none of the tree chrome", async () => {
      const calls: Array<GetListCall> = setUpApi({ groups: [] });

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByTestId("ungrouped-status-page-resource-panel"),
        ).toBeInTheDocument();
      });
      await flushEffects();

      expect(
        screen.queryByTestId("status-page-resource-group-search"),
      ).not.toBeInTheDocument();
      expect(groupScopedResourceCalls(calls)).toHaveLength(1);
    });
  });
});
