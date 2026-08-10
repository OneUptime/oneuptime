import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test - the Resources tab of a status page.
 *
 * Two things are being held here at once.
 *
 * The first is the counting invariant from issue #3042. The tab used to render
 * one ModelTable per group, eagerly; a status page with 1506 groups mounted
 * 1506 tables and fired 1506 list requests as soon as the tab opened, and the
 * reporter watched the browser climb past a gigabyte and then fail. The
 * explorer that replaced it loads exactly one group at a time, so the number of
 * requests is fixed no matter how large the hierarchy is - and, unlike the tree
 * that came before it, opening a branch in the navigator costs nothing at all,
 * because opening is not the same act as selecting.
 *
 * The second is that the group being edited is edited in one place: one header
 * naming it, one row of buttons acting on it, one list of its monitors in the
 * order visitors see them. There is no table card nested inside a row of
 * another tree any more, and no way for two groups to be half open at once.
 *
 * ModelAPI is mocked at the module boundary and every call is recorded, so "did
 * not fetch" is asserted directly rather than inferred from the DOM.
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

/*
 * Permissions come from two places: the model's own checks against the
 * permission list, and master admin. The permission list is mocked empty, so
 * this switch is what a test flips to look at the page as a viewer who may
 * read a status page but not restructure it.
 */
const mockIsMasterAdmin: jest.MockedFunction<any> = jest.fn(() => {
  return true;
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return mockIsMasterAdmin();
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
 * The resource form is a multi step ModelForm that fetches its own dropdown
 * options. Nothing in this suite is about the form's contents - only about
 * which modal a button opens - so it is reduced to its title.
 */
const mockModelFormModalProps: Array<any> = [];

jest.mock("Common/UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: { title: string }) => {
      /*
       * Recorded so a test can drive the callbacks a real submit would fire -
       * which is the only way to reach what the page does AFTER a group is
       * written, and that is the half of the merge worth proving.
       */
      mockModelFormModalProps.push(props);

      return React.createElement(
        "div",
        { "data-testid": "model-form-modal" },
        props.title,
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
      updateById: jest.fn(),
    },
  };
});

import StatusPageResources from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { MemoryRouter } from "react-router-dom";

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;
const mockUpdateById: jest.MockedFunction<any> =
  ModelAPI.updateById as unknown as jest.MockedFunction<any>;
const mockDeleteItem: jest.MockedFunction<any> =
  ModelAPI.deleteItem as unknown as jest.MockedFunction<any>;

interface GetListCall {
  modelType: unknown;
  query: Record<string, any>;
}

interface MakeGroupData {
  id: string;
  name: string;
  parentId?: string | undefined;
  order?: number | undefined;
  viewMode?: StatusPageGroupViewMode | undefined;
  /*
   * The three settings that change what a visitor sees and are otherwise only
   * visible three steps into the group form. The pane header is the only place
   * they surface now, so a fixture has to be able to carry them.
   */
  description?: string | undefined;
  isExpandedByDefault?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
}

type MakeGroupFunction = (data: MakeGroupData) => StatusPageGroup;

const makeGroup: MakeGroupFunction = (data: MakeGroupData): StatusPageGroup => {
  const group: StatusPageGroup = new StatusPageGroup();
  group._id = data.id;
  group.name = data.name;
  group.order = data.order === undefined ? 1 : data.order;

  if (data.parentId) {
    group.parentStatusPageGroupId = new ObjectID(data.parentId);
  }

  if (data.viewMode) {
    group.viewMode = data.viewMode;
  }

  if (data.description !== undefined) {
    group.description = data.description;
  }

  if (data.isExpandedByDefault !== undefined) {
    group.isExpandedByDefault = data.isExpandedByDefault;
  }

  if (data.showUptimePercent !== undefined) {
    group.showUptimePercent = data.showUptimePercent;
  }

  return group;
};

type MakeResourceFunction = (data: {
  id: string;
  groupId?: string | undefined;
  order?: number | undefined;
  monitorName?: string | undefined;
  displayName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}) => StatusPageResource;

const makeResource: MakeResourceFunction = (data: {
  id: string;
  groupId?: string | undefined;
  order?: number | undefined;
  monitorName?: string | undefined;
  displayName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = data.id;
  resource.order = data.order === undefined ? 1 : data.order;

  if (data.groupId) {
    resource.statusPageGroupId = new ObjectID(data.groupId);
  }

  if (data.monitorName) {
    const monitor: Monitor = new Monitor();
    monitor._id = `monitor-${data.id}`;
    monitor.name = data.monitorName;
    resource.monitor = monitor;
  }

  if (data.displayName) {
    resource.displayName = data.displayName;
  }

  if (data.rowAxisValue) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
};

/* Corporate › Region 1000 › Market 1001, plus a grid group beside them. */
const CORPORATE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163001";
const REGION_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163002";
const MARKET_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163003";
const GRID_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163004";

type BuildHierarchyFunction = () => Array<StatusPageGroup>;

const buildHierarchy: BuildHierarchyFunction = (): Array<StatusPageGroup> => {
  const grid: StatusPageGroup = makeGroup({
    id: GRID_ID,
    name: "Grid Group",
    order: 4,
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
      order: 2,
    }),
    makeGroup({
      id: MARKET_ID,
      name: "Market 1001",
      parentId: REGION_ID,
      order: 3,
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
      /*
       * A fresh array every time, the way a real response is. Handing back the
       * identical instance the page is already holding makes setGroups a no-op
       * that React drops, so a test that mutated the fixture would be reading
       * its own mutation rather than proving the page re-read anything.
       */
      return {
        data: [...data.groups],
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
        data: [...resources],
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

  mockUpdateById.mockImplementation(async (): Promise<any> => {
    return {};
  });

  mockDeleteItem.mockImplementation(async (): Promise<any> => {
    return {};
  });

  return calls;
};

type GroupCallsFunction = (calls: Array<GetListCall>) => Array<GetListCall>;

const groupCalls: GroupCallsFunction = (
  calls: Array<GetListCall>,
): Array<GetListCall> => {
  return calls.filter((call: GetListCall) => {
    return call.modelType === StatusPageGroup;
  });
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
 * The per-selection fetches - everything except the one pass over all resources
 * that builds the count badges, which deliberately does not filter by group.
 */
type ScopedResourceCallsFunction = (
  calls: Array<GetListCall>,
) => Array<GetListCall>;

const scopedResourceCalls: ScopedResourceCallsFunction = (
  calls: Array<GetListCall>,
): Array<GetListCall> => {
  return resourceCalls(calls).filter((call: GetListCall) => {
    return Object.prototype.hasOwnProperty.call(
      call.query,
      "statusPageGroupId",
    );
  });
};

type SelectedGroupIdsFunction = (calls: Array<GetListCall>) => Array<string>;

const selectedGroupIds: SelectedGroupIdsFunction = (
  calls: Array<GetListCall>,
): Array<string> => {
  return scopedResourceCalls(calls).map((call: GetListCall) => {
    return call.query["statusPageGroupId"]
      ? call.query["statusPageGroupId"].toString()
      : "ungrouped";
  });
};

type RenderPageFunction = () => ReturnType<typeof render>;

const renderPage: RenderPageFunction = (): ReturnType<typeof render> => {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  project.name = "Test Project";

  return render(
    <MemoryRouter>
      <StatusPageResources
        pageRoute={new Route("/dashboard/status-pages")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
};

/*
 * The page settles over several commits - groups and counts arrive, the initial
 * selection is chosen, and the pane fetches whatever it landed on. React 18
 * flushes a passive effect at the next act boundary rather than with the commit
 * that scheduled it, so a "how many requests were made" assertion taken the
 * instant a group name appears would be reading a half finished page.
 */
type FlushEffectsFunction = () => Promise<void>;

const flushEffects: FlushEffectsFunction = async (): Promise<void> => {
  for (let index: number = 0; index < 6; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

type NavigatorRowsFunction = () => Array<HTMLElement>;

const navigatorRows: NavigatorRowsFunction = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("status-page-resource-navigator-row");
};

type FindNavigatorRowFunction = (name: string) => HTMLElement | undefined;

/*
 * Group names show up twice once a group is selected - once in the navigator
 * and once as the pane's heading - so every assertion about the hierarchy is
 * made against the navigator's own rows rather than against the page.
 */
const findNavigatorRow: FindNavigatorRowFunction = (
  name: string,
): HTMLElement | undefined => {
  return navigatorRows().find((row: HTMLElement) => {
    return (row.textContent || "").includes(name);
  });
};

type NavigatorRowByNameFunction = (name: string) => HTMLElement;

const navigatorRowByName: NavigatorRowByNameFunction = (
  name: string,
): HTMLElement => {
  const found: HTMLElement | undefined = findNavigatorRow(name);

  if (!found) {
    throw new Error(`No navigator row called ${name} is on screen`);
  }

  return found;
};

type WaitForSettledFunction = () => Promise<void>;

/*
 * Nothing on this page is loading any more: not the groups, not the counts, and
 * not the selected group's resources. The pane mounts only once the initial
 * selection is chosen, and then fetches, so "the navigator has rows" is several
 * commits short of "the page is ready to be asserted against".
 */
const waitForSettled: WaitForSettledFunction = async (): Promise<void> => {
  await waitFor(
    () => {
      expect(screen.queryAllByTestId("component-loader").length).toBe(0);
    },
    /*
     * Longer than the default second: this suite renders hierarchies of
     * fifteen hundred groups, and a machine busy with the rest of the test run
     * takes its time over them.
     */
    { timeout: 15000 },
  );

  await flushEffects();
};

type WaitForExplorerFunction = () => Promise<void>;

/*
 * The tab settles over several commits: the groups arrive, the navigator is
 * drawn, the initial selection is chosen from the counts, and only then does
 * the pane mount and fetch. Every test starts from the settled page.
 */
const waitForExplorer: WaitForExplorerFunction = async (): Promise<void> => {
  await waitFor(
    () => {
      expect(navigatorRows().length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );

  await waitForSettled();
};

type SelectGroupFunction = (name: string) => Promise<void>;

/*
 * Selecting remounts the pane on the new group, which then fetches, so every
 * selection is followed by waiting for that fetch to land.
 */
const selectGroup: SelectGroupFunction = async (
  name: string,
): Promise<void> => {
  fireEvent.click(
    within(navigatorRowByName(name)).getByTestId(
      "status-page-resource-navigator-select",
    ),
  );

  await waitForSettled();
};

/* The id a group created during a test comes back with. */
const NEW_GROUP_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163099";

type LastFormModalFunction = () => any;

/*
 * The form that is currently open. Only one is ever mounted, so the last props
 * recorded are its props.
 */
const lastFormModal: LastFormModalFunction = (): any => {
  const props: any =
    mockModelFormModalProps[mockModelFormModalProps.length - 1];

  if (!props) {
    throw new Error("No form modal is open");
  }

  return props;
};

type OpenRowMenuFunction = (name: string) => Promise<void>;

/*
 * A navigator row's overflow menu. The cluster it lives in is revealed on hover
 * in a browser and is always in the DOM in jsdom, so the click is enough.
 */
const openRowMenu: OpenRowMenuFunction = async (
  name: string,
): Promise<void> => {
  fireEvent.click(
    within(navigatorRowByName(name)).getByTestId(
      "status-page-resource-navigator-more",
    ),
  );

  await flushEffects();
};

describe("Status Page > Resources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMasterAdmin.mockReturnValue(true);
    mockModelFormModalProps.length = 0;
    window.localStorage.clear();
  });

  describe("opening the tab", () => {
    test("costs the same handful of requests on a 1506 group status page", async () => {
      const groups: Array<StatusPageGroup> = [];

      for (let index: number = 0; index < 1506; index++) {
        groups.push(
          makeGroup({
            id: `0198c8ec-2a1d-7f0c-9e75-38419417${index
              .toString()
              .padStart(4, "0")}`,
            name: `Group ${index}`,
            order: index,
          }),
        );
      }

      const calls: Array<GetListCall> = setUpApi({ groups: groups });

      renderPage();

      await waitForExplorer();

      /*
       * The bug was 1506 of these. One is the whole point of the explorer: the
       * pane loads the selection, and there is only ever one selection.
       */
      expect(scopedResourceCalls(calls).length).toBe(1);
      /* Groups, the one pass for the counts, and the selection. */
      expect(calls.length).toBe(3);
      /*
       * Rendering fifteen hundred groups in jsdom is legitimately slower than
       * jest's five second default. The number this test exists to hold is the
       * request count, not the clock.
       */
    }, 60000);

    test("draws the hierarchy in the navigator", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      expect(navigatorRowByName("Region 1000")).toBeInTheDocument();
      expect(navigatorRowByName("Market 1001")).toBeInTheDocument();
      expect(navigatorRowByName("Grid Group")).toBeInTheDocument();
    });

    test("opens on the uncategorized bucket when there are resources in it", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "loose", monitorName: "Loose Monitor" }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Top of page");
      expect(selectedGroupIds(calls)).toEqual(["ungrouped"]);
      expect(screen.getByText("Loose Monitor")).toBeInTheDocument();
    });

    /*
     * An empty pane beside a full navigator reads as a page that failed to
     * load.
     */
    test("opens on the first group when nothing is uncategorized", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({
            id: "a",
            groupId: CORPORATE_ID,
            monitorName: "Corporate Monitor",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Corporate");
      expect(selectedGroupIds(calls)).toEqual([CORPORATE_ID]);
    });

    test("a status page with no groups is one flat list and no navigator", async () => {
      setUpApi({
        groups: [],
        resources: [makeResource({ id: "a", monitorName: "Only Monitor" })],
      });

      renderPage();

      await waitForSettled();

      expect(screen.getByText("Only Monitor")).toBeInTheDocument();

      expect(
        screen.queryByTestId("status-page-resource-navigator"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("All resources");
    });
  });

  describe("moving around the hierarchy", () => {
    test("selecting a group fetches that group and nothing else", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "loose", monitorName: "Loose Monitor" }),
          makeResource({
            id: "market",
            groupId: MARKET_ID,
            monitorName: "Market Monitor",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      const before: number = scopedResourceCalls(calls).length;

      await selectGroup("Market 1001");

      expect(screen.getByText("Market Monitor")).toBeInTheDocument();
      expect(scopedResourceCalls(calls).length).toBe(before + 1);
      expect(selectedGroupIds(calls).slice(-1)).toEqual([MARKET_ID]);
    });

    /*
     * The tree this replaced fetched a group the moment it was opened, so
     * looking inside a branch cost a request per group on the way down. Opening
     * and selecting are different acts now.
     */
    test("opening a branch in the navigator fetches nothing", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      const before: number = calls.length;

      /* Close Corporate, then open it again. */
      const disclosure: HTMLElement = within(
        navigatorRowByName("Corporate"),
      ).getByTestId("status-page-resource-navigator-disclosure");

      fireEvent.click(disclosure);
      await flushEffects();

      expect(findNavigatorRow("Region 1000")).toBeUndefined();

      fireEvent.click(
        within(navigatorRowByName("Corporate")).getByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      );
      await flushEffects();

      expect(navigatorRowByName("Region 1000")).toBeInTheDocument();
      expect(calls.length).toBe(before);
    });

    test("a nested group says where it sits, and the path is clickable", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      const breadcrumb: HTMLElement = screen.getByTestId(
        "status-page-resource-panel-breadcrumb",
      );

      const steps: Array<HTMLElement> = within(breadcrumb).getAllByTestId(
        "status-page-resource-panel-breadcrumb-step",
      );

      expect(
        steps.map((step: HTMLElement) => {
          return step.textContent;
        }),
      ).toEqual(["Corporate", "Region 1000"]);

      fireEvent.click(steps[0]!);
      await waitForSettled();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Corporate");
    });

    test("finds a group by name and leaves its ancestors as context", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "Market" },
        },
      );

      await flushEffects();

      expect(navigatorRowByName("Market 1001")).toBeInTheDocument();
      expect(findNavigatorRow("Grid Group")).toBeUndefined();
      /* Its ancestors stay so the match has somewhere to sit. */
      expect(navigatorRowByName("Corporate")).toBeInTheDocument();
    });

    test("says so when a search matches nothing", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      fireEvent.change(
        screen.getByTestId("status-page-resource-group-search"),
        {
          target: { value: "nothing matches this" },
        },
      );

      await flushEffects();

      expect(
        screen.getByTestId("status-page-resource-navigator-empty"),
      ).toBeInTheDocument();
    });
  });

  describe("the counts beside each group", () => {
    test("show what a group holds, and what is further down when it holds none", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "a", groupId: MARKET_ID }),
          makeResource({ id: "b", groupId: MARKET_ID }),
          makeResource({ id: "c", groupId: REGION_ID }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(
        within(navigatorRowByName("Market 1001")).getByTestId(
          "status-page-resource-navigator-count",
        ).textContent,
      ).toBe("2");

      /* Corporate holds nothing itself but three sit below it. */
      expect(
        within(navigatorRowByName("Corporate")).getByTestId(
          "status-page-resource-navigator-count",
        ).textContent,
      ).toBe("+3");
    });

    test("stay silent when the count pass came back truncated", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "a", groupId: MARKET_ID })],
        resourceTotalCount: 5000,
      });

      renderPage();

      await waitForExplorer();

      expect(
        screen.queryAllByTestId("status-page-resource-navigator-count").length,
      ).toBe(0);
    });
  });

  describe("the group's resources", () => {
    test("are listed by monitor, with the public name only when it differs", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({
            id: "a",
            monitorName: "High Node Disk Usage",
            displayName: "Disk",
          }),
          makeResource({
            id: "b",
            monitorName: "API",
            displayName: "API",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(screen.getByText("High Node Disk Usage")).toBeInTheDocument();

      expect(screen.queryAllByTestId("status-page-resource-row").length).toBe(
        2,
      );

      const displayNames: Array<HTMLElement> = screen.queryAllByTestId(
        "status-page-resource-row-display-name",
      );

      expect(displayNames.length).toBe(1);
      expect(displayNames[0]!.textContent).toContain("Disk");
    });

    test("offer somewhere to start when the group is empty", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      expect(screen.getByText("No monitors here yet")).toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-resource-panel-empty-add"),
      ).toBeInTheDocument();
    });

    test("filter down to what was typed, in the pane rather than the navigator", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "a", monitorName: "API" }),
          makeResource({ id: "b", monitorName: "Database" }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(screen.getByText("Database")).toBeInTheDocument();

      fireEvent.change(
        screen.getByTestId("status-page-resource-panel-search"),
        {
          target: { value: "data" },
        },
      );

      await flushEffects();

      expect(screen.queryAllByTestId("status-page-resource-row").length).toBe(
        1,
      );
      expect(screen.getByText("Database")).toBeInTheDocument();
    });

    test("a grid group opens into its matrix instead of a list", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "loose", monitorName: "Loose" }),
          makeResource({
            id: "grid-a",
            groupId: GRID_ID,
            monitorName: "Auth US",
            rowAxisValue: "Auth",
            columnAxisValue: "US-East",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Grid Group");

      expect(
        screen.getByTestId("status-page-resource-grid"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-list"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Auth US")).toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-resource-panel-grid-badge"),
      ).toBeInTheDocument();
    });
  });

  describe("changing a group", () => {
    test("moving a resource up writes the order of the one it displaced", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "a", order: 1, monitorName: "First" }),
          makeResource({ id: "b", order: 2, monitorName: "Second" }),
        ],
      });

      renderPage();

      await waitForExplorer();

      expect(screen.getByText("Second")).toBeInTheDocument();

      const secondRow: HTMLElement = screen
        .queryAllByTestId("status-page-resource-row")
        .find((row: HTMLElement) => {
          return (row.textContent || "").includes("Second");
        })!;

      fireEvent.click(
        within(secondRow).getByTestId("status-page-resource-row-more"),
      );

      await flushEffects();

      fireEvent.click(screen.getByText("Move up"));

      await waitFor(() => {
        expect(mockUpdateById).toHaveBeenCalled();
      });

      const updateCall: any = mockUpdateById.mock.calls[0]![0];

      expect(updateCall.id.toString()).toBe("b");
      expect(updateCall.data).toEqual({ order: 1 });
    });

    test("removing a resource asks first, then deletes and reloads the group", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "a", monitorName: "Doomed" })],
      });

      renderPage();

      await waitForExplorer();

      expect(screen.getByText("Doomed")).toBeInTheDocument();

      const before: number = scopedResourceCalls(calls).length;

      fireEvent.click(screen.getByTestId("status-page-resource-row-more"));
      await flushEffects();

      fireEvent.click(screen.getByText("Remove from status page"));
      await flushEffects();

      expect(
        screen.getByText("Remove resource from status page"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByText("Remove"));

      await waitFor(() => {
        expect(mockDeleteItem).toHaveBeenCalled();
      });

      /* The group reloads itself rather than the page re-reading everything. */
      await waitFor(() => {
        expect(scopedResourceCalls(calls).length).toBe(before + 1);
      });
    });

    test("the add button opens the resource form for the selected group", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      fireEvent.click(screen.getByTestId("status-page-resource-panel-add"));
      await flushEffects();

      expect(screen.getByTestId("model-form-modal").textContent).toBe(
        "Add a monitor to Market 1001",
      );
    });

    /*
     * The pane holds one group's worth of state - what is loading, which modal
     * is open, what a failed write said - and none of it means anything for the
     * next group.
     */
    test("a modal left open does not follow the operator to the next group", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      fireEvent.click(screen.getByTestId("status-page-resource-panel-add"));
      await flushEffects();

      expect(screen.getByTestId("model-form-modal")).toBeInTheDocument();

      await selectGroup("Market 1001");

      expect(screen.queryByTestId("model-form-modal")).not.toBeInTheDocument();
    });
  });

  describe("keeping the counts honest after a change", () => {
    test("a delete moves the group's badge without re-reading the status page", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({ id: "a", groupId: MARKET_ID, monitorName: "One" }),
          makeResource({ id: "b", groupId: MARKET_ID, monitorName: "Two" }),
        ],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      expect(
        within(navigatorRowByName("Market 1001")).getByTestId(
          "status-page-resource-navigator-count",
        ).textContent,
      ).toBe("2");

      const unscopedCallsBefore: number =
        resourceCalls(calls).length - scopedResourceCalls(calls).length;

      /* The next fetch of this group comes back with one fewer resource. */
      mockGetList.mockImplementation(async (callData: any): Promise<any> => {
        calls.push({
          modelType: callData.modelType,
          query: callData.query || {},
        });

        if (callData.modelType === StatusPageGroup) {
          return {
            data: buildHierarchy(),
            count: 4,
            skip: 0,
            limit: 4,
          };
        }

        return {
          data: [
            makeResource({
              id: "a",
              groupId: MARKET_ID,
              monitorName: "One",
            }),
          ],
          count: 1,
          skip: 0,
          limit: 1,
        };
      });

      fireEvent.click(
        screen
          .queryAllByTestId("status-page-resource-row-more")
          .slice(-1)[0] as HTMLElement,
      );
      await flushEffects();

      fireEvent.click(screen.getByText("Remove from status page"));
      await flushEffects();

      fireEvent.click(screen.getByText("Remove"));

      await waitFor(() => {
        expect(
          within(navigatorRowByName("Market 1001")).getByTestId(
            "status-page-resource-navigator-count",
          ).textContent,
        ).toBe("1");
      });

      /* Still exactly one unscoped pass over every resource: the one at load. */
      expect(
        resourceCalls(calls).length - scopedResourceCalls(calls).length,
      ).toBe(unscopedCallsBefore);
    });
  });

  /*
   * The half of this page that used to be Status Page > Groups. Every one of
   * these was previously reachable only by leaving the page you were working
   * on, doing the thing on another page, and coming back to it.
   */
  describe("changing the hierarchy without leaving the page", () => {
    test("a group is created from the page header, and the pane opens on it", async () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();
      const calls: Array<GetListCall> = setUpApi({ groups: groups });

      renderPage();

      await waitForExplorer();

      const groupReadsBefore: number = groupCalls(calls).length;

      fireEvent.click(screen.getByText("New Group"));
      await flushEffects();

      expect(screen.getByTestId("model-form-modal").textContent).toBe(
        "Create New Status Page Group",
      );

      const created: StatusPageGroup = makeGroup({
        id: NEW_GROUP_ID,
        name: "Brand New",
        order: 6,
      });

      /*
       * The refetch has to come back holding it, or the pane would open on a
       * group the page does not know about.
       */
      groups.push(created);

      await act(async () => {
        await lastFormModal().onSuccess(created);
      });

      await waitForSettled();

      expect(screen.queryByTestId("model-form-modal")).not.toBeInTheDocument();
      expect(groupCalls(calls).length).toBe(groupReadsBefore + 1);

      /* The hierarchy on screen is the one that was re-read, not the old one. */
      expect(findNavigatorRow("Brand New")).toBeDefined();

      /*
       * A group is created in order to put monitors in it, so the next thing
       * the operator wants is already on screen.
       */
      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Brand New");
      expect(selectedGroupIds(calls).slice(-1)).toEqual([NEW_GROUP_ID]);
    });

    /*
     * The parent picker offers every group the API would accept, including ones
     * whose rows are not currently drawn - so a group can be created several
     * levels inside a collapsed branch. Opening only its immediate parent
     * leaves it exactly as invisible as opening nothing.
     */
    test("a group created inside a collapsed branch is revealed all the way down", async () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();

      setUpApi({ groups: groups });

      renderPage();

      await waitForExplorer();

      /*
       * Closing the root takes its whole subtree off screen, so the group is
       * about to be created somewhere nobody can see.
       */
      fireEvent.click(
        within(navigatorRowByName("Corporate")).getByTestId(
          "status-page-resource-navigator-disclosure",
        ),
      );
      await flushEffects();

      expect(findNavigatorRow("Region 1000")).toBeUndefined();
      expect(findNavigatorRow("Market 1001")).toBeUndefined();

      fireEvent.click(screen.getByText("New Group"));
      await flushEffects();

      const nested: StatusPageGroup = makeGroup({
        id: NEW_GROUP_ID,
        name: "Deep Child",
        parentId: MARKET_ID,
        order: 9,
      });

      groups.push(nested);

      await act(async () => {
        await lastFormModal().onSuccess(nested);
      });

      await waitForSettled();

      expect(findNavigatorRow("Corporate")).toBeDefined();
      expect(findNavigatorRow("Region 1000")).toBeDefined();
      expect(findNavigatorRow("Market 1001")).toBeDefined();
      expect(findNavigatorRow("Deep Child")).toBeDefined();
    });

    /*
     * The parent is the group whose row was clicked. Without it pre-filled,
     * "add a sub group" is the create form with extra steps.
     */
    test("a sub group is created from the row of its parent, already nested", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      fireEvent.click(
        within(navigatorRowByName("Region 1000")).getByTestId(
          "status-page-resource-navigator-add-sub-group",
        ),
      );
      await flushEffects();

      expect(screen.getByTestId("model-form-modal")).toBeInTheDocument();
      expect(lastFormModal().initialValues).toEqual({
        parentStatusPageGroup: REGION_ID,
      });
    });

    test("a group is edited from its own row, in update mode", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      await openRowMenu("Market 1001");

      fireEvent.click(screen.getByText("Edit group"));
      await flushEffects();

      expect(screen.getByTestId("model-form-modal").textContent).toBe(
        "Edit Status Page Group",
      );
      expect(lastFormModal().modelIdToEdit.toString()).toBe(MARKET_ID);
    });

    /*
     * Re-reading the hierarchy after a group write must not blank the page: a
     * loader in place of the whole card would unmount the pane, which would
     * then re-read the selected group's resources for no reason at all.
     */
    test("re-reading the hierarchy leaves the pane where it was", async () => {
      const calls: Array<GetListCall> = setUpApi({
        groups: buildHierarchy(),
        resources: [
          makeResource({
            id: "market",
            groupId: MARKET_ID,
            monitorName: "Market Monitor",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      const scopedBefore: number = scopedResourceCalls(calls).length;

      await openRowMenu("Corporate");

      fireEvent.click(screen.getByText("Edit group"));
      await flushEffects();

      await act(async () => {
        await lastFormModal().onSuccess(
          makeGroup({ id: CORPORATE_ID, name: "Corporate", order: 1 }),
        );
      });

      await waitForSettled();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Market 1001");
      expect(screen.getByText("Market Monitor")).toBeInTheDocument();
      expect(scopedResourceCalls(calls).length).toBe(scopedBefore);
    });

    /*
     * `order` is one flat sequence across the whole status page and the service
     * renumbers everything between the two rows, so the write is "take the
     * place of the sibling above you" rather than an index.
     */
    test("moving a group writes the neighbouring sibling's order", async () => {
      setUpApi({
        groups: [
          makeGroup({ id: CORPORATE_ID, name: "Corporate", order: 1 }),
          makeGroup({ id: GRID_ID, name: "Second", order: 7 }),
        ],
      });

      renderPage();

      await waitForExplorer();

      await openRowMenu("Second");

      fireEvent.click(screen.getByText("Move up"));

      await waitFor(() => {
        expect(mockUpdateById).toHaveBeenCalled();
      });

      const update: any = mockUpdateById.mock.calls[0]![0];

      expect(update.id.toString()).toBe(GRID_ID);
      expect(update.data).toEqual({ order: 1 });
    });

    /*
     * Deleting a group takes its sub groups, the resources in them, and any
     * monitor rules pointing at them. Nothing on the row says so, so the
     * confirmation has to - and a pane still aimed at the deleted branch would
     * sit there fetching something that no longer exists.
     */
    test("deleting the selected group says what goes with it, then moves the pane out", async () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();

      setUpApi({
        groups: groups,
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      await selectGroup("Region 1000");

      await openRowMenu("Region 1000");

      fireEvent.click(screen.getByText("Delete group"));
      await flushEffects();

      const confirmation: string =
        screen.getByTestId("confirm-modal-description").textContent || "";

      expect(confirmation).toContain("1 group nested inside it");
      expect(confirmation).toContain("monitor rules");
      expect(confirmation).toContain("This cannot be undone.");

      /* What the refetch will return: the branch is gone. */
      groups.splice(
        0,
        groups.length,
        makeGroup({ id: CORPORATE_ID, name: "Corporate", order: 1 }),
      );

      fireEvent.click(screen.getByText("Delete"));

      await waitFor(() => {
        expect(mockDeleteItem).toHaveBeenCalled();
      });

      await waitForSettled();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Top of page");

      /* And the branch really is gone from the tree, not just from the pane. */
      expect(findNavigatorRow("Region 1000")).toBeUndefined();
      expect(findNavigatorRow("Market 1001")).toBeUndefined();
    });

    /*
     * The cascade moves numbers nobody counted - every resource in the deleted
     * group and in every group under it - so this is the one write on the page
     * where the badges have to be read again rather than adjusted.
     */
    test("a group delete re-reads the counts it could not have worked out", async () => {
      const groups: Array<StatusPageGroup> = buildHierarchy();
      const calls: Array<GetListCall> = setUpApi({
        groups: groups,
        resources: [
          makeResource({
            id: "market",
            groupId: MARKET_ID,
            monitorName: "Market Monitor",
          }),
        ],
      });

      renderPage();

      await waitForExplorer();

      const unscopedBefore: number =
        resourceCalls(calls).length - scopedResourceCalls(calls).length;

      await openRowMenu("Market 1001");

      fireEvent.click(screen.getByText("Delete group"));
      await flushEffects();

      fireEvent.click(screen.getByText("Delete"));

      await waitFor(() => {
        expect(mockDeleteItem).toHaveBeenCalled();
      });

      await waitForSettled();

      expect(
        resourceCalls(calls).length - scopedResourceCalls(calls).length,
      ).toBe(unscopedBefore + 1);
    });

    /*
     * The pane names exactly one group, and on a touch screen it is the only
     * place a group can be acted on - there is no hover to reveal a row's
     * cluster.
     */
    test("the pane offers the selected group's own actions too", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      fireEvent.click(screen.getByTestId("status-page-resource-panel-more"));
      await flushEffects();

      const labels: Array<string> = within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return item.textContent || "";
        });

      /*
       * Everything the tree's hover-revealed row cluster offers, because a
       * touch screen has no hover and this menu is the only way in.
       */
      expect(labels).toEqual([
        "Add multiple monitors",
        "Edit this group",
        "Add a sub group",
        "Move group up",
        "Move group down",
        "Show group ID",
        "Refresh",
        "Delete this group",
      ]);
    });

    /*
     * Offered but disabled rather than absent: a menu whose contents change
     * shape from group to group is a menu you have to read every time.
     */
    test("a move with no sibling that way is offered but disabled", async () => {
      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      await selectGroup("Region 1000");

      fireEvent.click(screen.getByTestId("status-page-resource-panel-more"));
      await flushEffects();

      const menu: HTMLElement = screen.getByRole("menu");

      /* The only group at its level, so neither direction is available. */
      expect(
        within(menu).getByText("Move group up").closest("button"),
      ).toBeDisabled();
      expect(
        within(menu).getByText("Move group down").closest("button"),
      ).toBeDisabled();
    });

    /*
     * The ungrouped bucket is a real place on a status page but it is not a
     * group, so nothing that acts on a group is offered while it is selected.
     */
    test("the ungrouped bucket is not offered group actions", async () => {
      setUpApi({
        groups: buildHierarchy(),
        resources: [makeResource({ id: "loose", monitorName: "Loose" })],
      });

      renderPage();

      await waitForExplorer();

      expect(
        screen.getByTestId("status-page-resource-panel-title").textContent,
      ).toBe("Top of page");

      fireEvent.click(screen.getByTestId("status-page-resource-panel-more"));
      await flushEffects();

      const labels: Array<string> = within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return item.textContent || "";
        });

      expect(labels).toEqual([
        "Add multiple monitors",
        "Create a group",
        "Refresh",
      ]);
    });

    /*
     * The pane is the whole group-management surface on a touch screen, so its
     * menu has to be gated exactly as the tree's row actions are. Everything
     * here would otherwise be an action that can only ever fail at the API.
     */
    test("a viewer who may not change the hierarchy is offered none of it", async () => {
      mockIsMasterAdmin.mockReturnValue(false);

      setUpApi({ groups: buildHierarchy() });

      renderPage();

      await waitForExplorer();

      await selectGroup("Market 1001");

      /* The hierarchy is still there to get around in, and still selectable. */
      expect(navigatorRows().length).toBeGreaterThan(0);
      expect(
        screen.queryAllByTestId("status-page-resource-navigator-add-sub-group")
          .length,
      ).toBe(0);

      await openRowMenu("Market 1001");

      /* Reading an id is not a write, so it survives; nothing else does. */
      expect(
        within(screen.getByRole("menu"))
          .getAllByRole("menuitem")
          .map((item: HTMLElement) => {
            return item.textContent || "";
          }),
      ).toEqual(["Show ID"]);

      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await flushEffects();

      fireEvent.click(screen.getByTestId("status-page-resource-panel-more"));
      await flushEffects();

      const labels: Array<string> = within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item: HTMLElement) => {
          return item.textContent || "";
        });

      expect(labels).toEqual(["Show group ID", "Refresh"]);
    });
  });

  /*
   * The settings that change what a visitor sees. They live three steps into
   * the group form, and the old Groups page badged them on every row; the pane
   * header is the only place they surface now, so this is the only thing
   * standing between an operator and a group that is quietly published
   * collapsed.
   */
  describe("what the pane says about the group itself", () => {
    const GROUP_WITH_SETTINGS: string = "0198c8ec-2a1d-7f0c-9e75-384194163020";
    const PLAIN_GROUP: string = "0198c8ec-2a1d-7f0c-9e75-384194163021";

    type SetUpSettingsFunction = () => void;

    const setUpSettings: SetUpSettingsFunction = (): void => {
      setUpApi({
        groups: [
          makeGroup({
            id: GROUP_WITH_SETTINGS,
            name: "Published Quietly",
            order: 1,
            description: "Only the on-call team looks at this one.",
            isExpandedByDefault: false,
            showUptimePercent: true,
          }),
          makeGroup({ id: PLAIN_GROUP, name: "Plain", order: 2 }),
        ],
      });
    };

    test("a group that is published collapsed, with uptime, and has a description says all three", async () => {
      setUpSettings();

      renderPage();

      await waitForExplorer();

      await selectGroup("Published Quietly");

      expect(
        screen.getByTestId("status-page-resource-panel-collapsed-by-default"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-resource-panel-uptime"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("status-page-resource-panel-description")
          .textContent,
      ).toBe("Only the on-call team looks at this one.");
    });

    test("a group with none of them says none of them", async () => {
      setUpSettings();

      renderPage();

      await waitForExplorer();

      await selectGroup("Plain");

      expect(
        screen.queryByTestId("status-page-resource-panel-collapsed-by-default"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-panel-uptime"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-resource-panel-description"),
      ).not.toBeInTheDocument();
    });

    /*
     * A grid group with no axes has nowhere to put a resource - the public page
     * drops anything whose axis values are not among the group's own - so the
     * add button is withdrawn. On its own that reads as a broken screen, so the
     * pane has to say why and hand over the control that fixes it.
     */
    test("a grid group with no axes explains itself and offers the way out", async () => {
      const grid: StatusPageGroup = makeGroup({
        id: GRID_ID,
        name: "Matrix",
        order: 1,
        viewMode: StatusPageGroupViewMode.Grid,
      });

      setUpApi({ groups: [grid] });

      renderPage();

      await waitForExplorer();

      await selectGroup("Matrix");

      expect(
        screen.getByTestId("status-page-resource-panel-grid-setup").textContent,
      ).toContain("no rows or columns");
      expect(
        screen.queryByTestId("status-page-resource-panel-add"),
      ).not.toBeInTheDocument();

      fireEvent.click(
        screen.getByTestId("status-page-resource-panel-grid-setup-edit"),
      );
      await flushEffects();

      expect(screen.getByTestId("model-form-modal").textContent).toBe(
        "Edit Status Page Group",
      );
    });
  });
});
