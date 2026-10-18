import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a project with no episodes yet sees on Incidents > Episodes and
 * Alerts > Episodes.
 *
 * The incident list offered Create Episode in its header and under its
 * empty state. The alert list did not: its button had no style, so the
 * table's header put it in the ⋯ menu as a rarely used action, and the empty
 * state - which repeats the header's main button - offered no way to make
 * one, under a sentence that said "you can create one yourself". Both lists
 * said "No episodes found." where every other list says "No X yet".
 *
 * Each list also used to have a "Documentation" page beside it in the side
 * menu: a manual drawn in the product. The docs are the one place for it
 * now, and each list links there: "View Documentation", under its empty
 * state and in its ⋯ menu, opening the docs page in a new tab.
 *
 * The real pages are rendered, with an empty project behind ModelAPI and a
 * project admin's permissions.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

// An empty project: every list is empty, every count is zero.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import IncidentEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Episodes";
import AlertEpisodesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Episodes";
import {
  ALERT_EPISODES_DOCS_PATH,
  INCIDENT_EPISODES_DOCS_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeDocsLinks";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

interface NavigateCall {
  to: string;
  openInNewTab: boolean;
}

let navigateCalls: Array<NavigateCall> = [];

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.HOME] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

interface EpisodeList {
  name: string;
  render: () => ReactElement;
  title: string;
  createPage: PageMap;
  docsPath: string;
}

const EPISODE_LISTS: Array<EpisodeList> = [
  {
    name: "Incident Episodes",
    render: (): ReactElement => {
      return <IncidentEpisodesPage {...pageProps} />;
    },
    title: "No incident episodes yet",
    createPage: PageMap.INCIDENT_EPISODE_CREATE,
    docsPath: INCIDENT_EPISODES_DOCS_PATH,
  },
  {
    name: "Alert Episodes",
    render: (): ReactElement => {
      return <AlertEpisodesPage {...pageProps} />;
    },
    title: "No alert episodes yet",
    createPage: PageMap.ALERT_EPISODE_CREATE,
    docsPath: ALERT_EPISODES_DOCS_PATH,
  },
];

function emptyStateButton(): HTMLElement | null {
  return screen.queryByTestId("empty-table-create-button");
}

function docsLink(): HTMLElement | null {
  return screen.queryByTestId("empty-table-docs-link");
}

function headerMainButton(): HTMLElement | null {
  return screen.queryByTestId("card-button");
}

function createPath(list: EpisodeList): string {
  return (RouteMap[list.createPage] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID);
}

async function renderEmpty(list: EpisodeList): Promise<void> {
  render(list.render());
  await screen.findByText(list.title, {}, { timeout: 10000 });
}

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [Permission.ProjectAdmin];
  navigateCalls = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/home`,
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown, options?: unknown): void => {
      navigateCalls.push({
        to: String(route),
        openInNewTab: Boolean(
          (options as { openInNewTab?: boolean } | undefined)?.openInNewTab,
        ),
      });
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(EPISODE_LISTS)("$name, empty", (list: EpisodeList) => {
  test("is headed by 'No X yet', like every other list", async () => {
    await renderEmpty(list);

    const title: HTMLElement = screen.getByText(list.title);

    expect(title.tagName).toBe("H3");
    expect(title.closest("[data-empty-state-kind]")).toHaveAttribute(
      "data-empty-state-kind",
      "empty",
    );
    expect(document.body.textContent || "").not.toContain("No episodes found");
  });

  test("draws Create Episode as the header's main button, not in the ⋯ menu", async () => {
    await renderEmpty(list);

    await waitFor(() => {
      expect(headerMainButton()).not.toBeNull();
    });
    expect(headerMainButton()).toHaveTextContent("Create Episode");
  });

  test("offers Create Episode under the empty state, and it opens the create page", async () => {
    await renderEmpty(list);
    await waitFor(() => {
      expect(emptyStateButton()).not.toBeNull();
    });

    expect(emptyStateButton()).toHaveTextContent("Create Episode");
    fireEvent.click(emptyStateButton()!);

    expect(navigateCalls).toEqual([
      { to: createPath(list), openInNewTab: false },
    ]);
  });

  test("links to the docs page about episodes, in a new tab", async () => {
    await renderEmpty(list);
    await waitFor(() => {
      expect(docsLink()).not.toBeNull();
    });

    expect(docsLink()).toHaveTextContent("View Documentation");
    fireEvent.click(docsLink()!);

    expect(navigateCalls).toEqual([{ to: list.docsPath, openInNewTab: true }]);
  });
});

describe("the empty-state Create Episode is gated like the header's", () => {
  test.each(EPISODE_LISTS)(
    "$name: a viewer sees it locked, and clicking it goes nowhere",
    async (list: EpisodeList) => {
      permissionsForTest = [Permission.Viewer];
      await renderEmpty(list);
      await waitFor(() => {
        expect(emptyStateButton()).not.toBeNull();
      });

      expect(emptyStateButton()).toBeDisabled();
      fireEvent.click(emptyStateButton()!);
      expect(navigateCalls).toEqual([]);
    },
  );
});

describe("the docs pages the lists link to", () => {
  test("are the episodes pages of the Incidents and the Alerts docs", () => {
    expect(INCIDENT_EPISODES_DOCS_PATH).toBe("/docs/incidents/episodes");
    expect(ALERT_EPISODES_DOCS_PATH).toBe("/docs/alerts/episodes");
  });
});
