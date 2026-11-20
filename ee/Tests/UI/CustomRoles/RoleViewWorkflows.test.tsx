import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { Location, MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

/*
 * THE WORKFLOWS THAT RUN AS A CUSTOM ROLE, ON THE ROLE'S OWN PAGE (#9831),
 * rendered for real with only the network stubbed:
 *
 *   - Workflows that Run as this Role, under the API keys, lists every
 *     workflow that runs as the role, each a link to its Run As (its
 *     Settings, at #run-as), with a quiet Disabled or Archived beside one
 *     that runs nothing right now;
 *   - the Permissions card's line counts them with the teams and keys: a
 *     change to the role changes what their steps can do at once;
 *   - an empty card says how a workflow comes to run as the role, with the
 *     way to the Workflows page, and offers no button of its own;
 *   - someone who may not read the project's workflows sees no card, no
 *     count and no workflow's name, and the page asks no count of them;
 *   - on a page read from the right, each name reads the way its own words
 *     do, and its cell keeps the page's way, so the badge beside it stays
 *     after it (TableNameColumnsLineTextGuard).
 */

let licenseModeForTest: string = "editable";

(
  globalThis as unknown as { __licenseModeForTest: () => string }
).__licenseModeForTest = (): string => {
  return licenseModeForTest;
};

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __licenseModeForTest: () => string }
        ).__licenseModeForTest();
      },
    };
  },
);

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

// The reader's language: English, unless a test reads the page in another.
let mockLanguage: string | undefined = undefined;

jest.mock("Common/UI/Utils/Translation", () => {
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
        language: mockLanguage,
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0c000000-0000-4000-8000-000000000001";
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

import TeamRoleView from "../../../Dashboard/CustomRoles/RoleViewPage";
import { CUSTOM_ROLE_WORKFLOWS_TEST_ID } from "../../../Dashboard/CustomRoles/CustomRoleWorkflowsTable";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap from "@oneuptime/dashboard/Utils/RouteMap";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import TeamCustomRole from "Common/Models/DatabaseModels/TeamCustomRole";
import Team from "Common/Models/DatabaseModels/Team";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "Common/Tests/Spy";

const PROJECT_ID: string = "0c000000-0000-4000-8000-000000000001";
const ROLE_ID: string = "0c000000-0000-4000-8000-000000000002";
const RUNNING_ID: string = "0c000000-0000-4000-8000-0000000000e1";
const OFF_ID: string = "0c000000-0000-4000-8000-0000000000e2";
const ARCHIVED_ID: string = "0c000000-0000-4000-8000-0000000000e3";
const TEAM_ID: string = "0c000000-0000-4000-8000-0000000000f1";

const pageProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

// The workflows that run as the role, as the server lists them.
let workflowRows: Array<Workflow> = [];

// Whether the server lets the reader read the project's workflows.
let workflowsReadable: boolean = true;

// The teams given the role.
let teamRows: Array<TeamCustomRole> = [];

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function role(): CustomRole {
  const customRole: CustomRole = new CustomRole();
  customRole._id = ROLE_ID;
  customRole.name = "Incident Responder";
  customRole.description = "Declares, works and resolves incidents.";
  customRole.permissionCount = 2;
  return customRole;
}

function workflow(data: {
  id: string;
  name: string;
  isEnabled?: boolean;
  isArchived?: boolean;
}): Workflow {
  const row: Workflow = new Workflow();
  row._id = data.id;
  row.name = data.name;
  row.isEnabled = data.isEnabled ?? true;
  row.isArchived = data.isArchived ?? false;
  return row;
}

function teamGiven(): TeamCustomRole {
  const row: TeamCustomRole = new TeamCustomRole();
  row._id = "0c000000-0000-4000-8000-0000000000f2";
  row.teamId = new ObjectID(TEAM_ID);
  row.customRoleId = new ObjectID(ROLE_ID);
  const team: Team = new Team();
  team._id = TEAM_ID;
  team.name = "Platform On-Call";
  row.team = team;
  return row;
}

const WORKFLOW_READ_REFUSED: string =
  "You do not have permissions to read Workflow. You need one of these permissions: Project Owner, Project Admin, Read Workflow.";

beforeEach(() => {
  mockLanguage = undefined;
  licenseModeForTest = "editable";
  holding([Permission.ProjectOwner]);
  workflowsReadable = true;
  teamRows = [];
  workflowRows = [
    workflow({ id: RUNNING_ID, name: "Close stale incidents" }),
    workflow({ id: OFF_ID, name: "Nightly cleanup", isEnabled: false }),
    workflow({
      id: ARCHIVED_ID,
      name: "Old escalation sync",
      isEnabled: true,
      isArchived: true,
    }),
  ];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
  );

  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(ROLE_ID),
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});

  getItemMock.mockImplementation(async (): Promise<any> => {
    return role();
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const answer: (data: Array<unknown>) => any = (
      data: Array<unknown>,
    ): any => {
      return { data: data, count: data.length, skip: 0, limit: 50 };
    };

    if (params.modelType === Workflow) {
      if (!workflowsReadable) {
        throw new Error(WORKFLOW_READ_REFUSED);
      }

      return answer(workflowRows);
    }

    if (params.modelType === TeamCustomRole) {
      return answer(teamRows);
    }

    return answer([]);
  });

  countMock.mockImplementation(async (params: any): Promise<number> => {
    if (params.modelType === Workflow) {
      if (!workflowsReadable) {
        throw new Error(WORKFLOW_READ_REFUSED);
      }

      return workflowRows.length;
    }

    return 0;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  countMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter
      initialEntries={[`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`]}
    >
      <TeamRoleView {...pageProps} />
    </MemoryRouter>,
  );

  // The role has loaded: its description is on its details card.
  await screen.findByText(
    "Declares, works and resolves incidents.",
    {},
    { timeout: 10000 },
  );
}

async function workflowsCard(): Promise<HTMLElement> {
  return await screen.findByTestId(
    CUSTOM_ROLE_WORKFLOWS_TEST_ID,
    {},
    { timeout: 10000 },
  );
}

// Lets React finish the renders it scheduled outside act().
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });
  }
}

function callsFor(mock: MockFunction, modelType: unknown): Array<any> {
  return mock.mock.calls
    .map((args: Array<any>): any => {
      return args[0];
    })
    .filter((call: any): boolean => {
      return call.modelType === modelType;
    });
}

// The row of the table that names a workflow.
function rowOf(card: HTMLElement, name: string): HTMLElement {
  const link: HTMLElement = within(card).getByRole("link", { name: name });
  const row: HTMLElement | null = link.closest("tr");

  return (row || link.parentElement) as HTMLElement;
}

describe("a custom role's workflows", () => {
  test("lists the workflows that run as the role, each a link to its Run As", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();

    expect(
      within(card).getByText("Workflows that Run as this Role"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "The steps of these workflows can do exactly what this role allows.",
      ),
    ).toBeInTheDocument();

    for (const [name, id] of [
      ["Close stale incidents", RUNNING_ID],
      ["Nightly cleanup", OFF_ID],
      ["Old escalation sync", ARCHIVED_ID],
    ] as Array<[string, string]>) {
      const link: HTMLElement = await within(card).findByRole("link", {
        name: name,
      });

      // At the workflow's Run As card, where what it runs as is changed.
      expect(link.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/workflows/${id}/settings#run-as`,
      );
    }

    // Read by the role and the project, by name, with whether each runs.
    const read: any = callsFor(getListMock, Workflow).find((call: any) => {
      return Boolean(call.select?.name) && "isArchived" in call.select;
    });
    expect(read).toBeDefined();
    expect(read.query.runAsCustomRoleId.toString()).toBe(ROLE_ID);
    expect(read.query.projectId.toString()).toBe(PROJECT_ID);
    expect(read.select.isEnabled).toBe(true);
  });

  test("a workflow that runs nothing right now says so beside its name, quietly", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();
    await within(card).findByRole("link", { name: "Close stale incidents" });

    expect(
      within(rowOf(card, "Close stale incidents")).queryByTestId(
        "custom-role-workflow-state",
      ),
    ).toBeNull();
    expect(
      within(rowOf(card, "Nightly cleanup")).getByTestId(
        "custom-role-workflow-state",
      ),
    ).toHaveTextContent("Disabled");
    // Archived says so, whether or not it was on.
    expect(
      within(rowOf(card, "Old escalation sync")).getByTestId(
        "custom-role-workflow-state",
      ),
    ).toHaveTextContent("Archived");
  });

  test("is read only: nothing on the card changes what a workflow runs as", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();
    await within(card).findByRole("link", { name: "Close stale incidents" });

    for (const title of ["Create Workflow", "Delete", "Edit", "Remove"]) {
      expect(
        within(card)
          .queryAllByRole("button")
          .filter((button: HTMLElement): boolean => {
            return (button.textContent || "").trim() === title;
          }),
      ).toEqual([]);
    }
  });

  test("the Permissions card counts them: a change reaches their steps at once", async () => {
    await renderPage();

    expect(
      await screen.findByText(
        "What this role gives. 3 workflows run as this role. A change here changes what they can do at once.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();

    // Counted by the role and the project.
    const counted: any = callsFor(countMock, Workflow)[0];
    expect(counted.query.runAsCustomRoleId.toString()).toBe(ROLE_ID);
    expect(counted.query.projectId.toString()).toBe(PROJECT_ID);
  });

  test("the count follows the teams given the role", async () => {
    teamRows = [teamGiven()];
    workflowRows = [
      workflow({ id: RUNNING_ID, name: "Close stale incidents" }),
    ];

    await renderPage();

    expect(
      await screen.findByText(
        "What this role gives. Given to 1 team (0 people), and 1 workflow runs as it. A change here changes what they can do at once.",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
  });

  test("an empty card says how a workflow comes to run as the role, with the way to the Workflows page", async () => {
    workflowRows = [];

    await renderPage();
    const card: HTMLElement = await workflowsCard();

    expect(
      await within(card).findByText(
        "No workflow runs as this role yet",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        /and choose this role in its Settings, under Run As\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(card)
        .getByRole("link", { name: "Workflows" })
        .getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/workflows`);

    // Workflows are made on their own page: no button under the empty card.
    expect(within(card).queryByTestId("empty-table-create-button")).toBeNull();

    // Nothing runs as it: the Permissions card says only what it gives.
    expect(screen.getByText("What this role gives.")).toBeInTheDocument();
  });

  test("someone who may not read the project's workflows sees no workflows card, no count and no name", async () => {
    // May change roles and read teams, but not read workflows.
    holding([
      Permission.EditProjectTeamPermissions,
      Permission.ReadProjectTeam,
    ]);
    workflowsReadable = false;

    await renderPage();

    // The teams card has loaded: no team has the role.
    expect(
      await screen.findByText(
        "No team has this role yet",
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    await settle();

    expect(screen.queryByTestId(CUSTOM_ROLE_WORKFLOWS_TEST_ID)).toBeNull();
    expect(screen.queryByText("Workflows that Run as this Role")).toBeNull();

    // The workflows are not theirs to know about: no count, no name.
    expect(screen.getByText("What this role gives.")).toBeInTheDocument();
    expect(screen.queryByText(/\b\d+ workflows? runs?\b/)).toBeNull();
    for (const name of [
      "Close stale incidents",
      "Nightly cleanup",
      "Old escalation sync",
    ]) {
      expect(screen.queryByText(name)).toBeNull();
    }

    // And the page asks the server for no count of them.
    await waitFor(() => {
      expect(callsFor(countMock, Workflow)).toEqual([]);
    });
  });
});

/*
 * A workflow's name is the project's own words, whatever the page's
 * language; Archived and Disabled beside it are the page's. The column
 * says it draws its own lines (drawsItsOwnLines): the cell keeps the
 * page's way, so on a Persian page the badge stays after the name, at its
 * left, and the name reads its own way in an isolate (IsolatedText). Read
 * as one English line, the whole cell turned round, and the badge went to
 * the name's right, before it.
 */
describe("a custom role's workflows on a page read from the right", () => {
  const PERSIAN_NAME: string = "پاک‌سازی شبانه";

  beforeEach(() => {
    mockLanguage = "fa";
    workflowRows = [
      workflow({ id: RUNNING_ID, name: "Close stale incidents" }),
      workflow({
        id: OFF_ID,
        name: PERSIAN_NAME,
        isEnabled: false,
      }),
    ];
  });

  // The element that says the line's way, from the name's link up to its row.
  function directionsAbove(link: HTMLElement): Array<string> {
    const directions: Array<string> = [];
    let node: HTMLElement | null = link.parentElement;

    while (node && node.tagName !== "TR") {
      const direction: string | null = node.getAttribute("dir");

      if (direction) {
        directions.push(direction);
      }

      node = node.parentElement;
    }

    return directions;
  }

  test("an English name reads left to right, in its own isolate", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();
    const link: HTMLElement = await within(card).findByRole("link", {
      name: "Close stale incidents",
    });

    const isolate: HTMLElement | null = link.querySelector("bdi");

    expect(isolate).not.toBeNull();
    expect(isolate).toHaveTextContent("Close stale incidents");
    expect(isolate).toHaveAttribute("dir", "ltr");
  });

  test("a Persian name reads right to left, in its own isolate", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();
    const link: HTMLElement = await within(card).findByRole("link", {
      name: PERSIAN_NAME,
    });

    expect(link.querySelector("bdi")).toHaveAttribute("dir", "rtl");
  });

  test("the cell keeps the page's way, so the badge is not turned round with the name", async () => {
    await renderPage();
    const card: HTMLElement = await workflowsCard();

    for (const name of ["Close stale incidents", PERSIAN_NAME]) {
      const link: HTMLElement = await within(card).findByRole("link", {
        name: name,
      });

      // Nothing between the link and its row sets a way of its own.
      expect({ name, directions: directionsAbove(link) }).toEqual({
        name,
        directions: [],
      });
    }

    // The badge is the page's, beside the name, outside its isolate.
    const badge: HTMLElement = within(rowOf(card, PERSIAN_NAME)).getByTestId(
      "custom-role-workflow-state",
    );

    expect(badge).toHaveTextContent("Disabled");
    expect(badge.closest("bdi")).toBeNull();
  });
});
