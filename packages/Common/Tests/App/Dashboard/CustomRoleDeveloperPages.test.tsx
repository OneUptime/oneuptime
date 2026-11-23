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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * A CUSTOM ROLE'S DEVELOPER PAGES, AS PEOPLE OPEN THEM (#10139).
 *
 * #10031 wrote the API and CLI pages' Delete it step for a table whose
 * delete takes choices: a custom role that workflows run as is deleted only
 * by a delete that says what they run as instead. No page showed it: a
 * role's page had no menu of its own, and custom roles were not among the
 * resources with Developer pages. This mounts the real Teams routes, with
 * the role's real layout (its heading, its trail and its side menu) and the
 * real Developer page, against a fake ModelAPI, and opens a role's pages
 * the way a person does:
 *
 *   - its own page, under its own menu: Custom Role > Overview, and
 *     Developer folded beneath;
 *   - its API and CLI pages, whose Delete it step has its three tabs, each
 *     with what that way sends;
 *   - its Terraform page, which writes the role as it is - its name and
 *     description, never what OneUptime keeps (its permission count, its
 *     slug) - and adds a permission and a team beside it, as rows of their
 *     own;
 *   - its AI Assistants page, which says the MCP server has no tools for
 *     custom roles;
 *   - every page heads and names the role ("Custom Role - Incident
 *     Responder", Project > Teams > Roles > Incident Responder > API).
 */

const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const TEAM_ID: string = "10000001-0000-4000-8000-000000000001";
const USER_ID: string = "0aa1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getListMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

// This installation: a self-hosted OneUptime on 14.0.11.
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const ProtocolType: { HTTPS: unknown } = (
    jest.requireActual("../../../Types/API/Protocol") as {
      default: { HTTPS: unknown };
    }
  ).default;
  return {
    __esModule: true,
    ...actual,
    HOST: "oneuptime.acme.com",
    HTTP_PROTOCOL: ProtocolType.HTTPS,
    VERSION: "14.0.11",
  };
});

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TeamsRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/TeamsRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PAGE_RECORD_TITLE_TEST_IDS } from "../../../UI/Components/Page/Page";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import {
  activeLinkTitles,
  DESKTOP_WIDTH,
  goTo,
  isExpanded,
  linksIn,
  PROJECT_ID,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

const ROLE_URL: string = `/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const TAB_LABELS: Array<string> = [
  "No workflow runs as it",
  "Default permissions",
  "Another custom role",
];

function role(): CustomRole {
  const item: CustomRole = new CustomRole();
  item._id = ROLE_ID;
  item.name = "Incident Responder";
  item.description = "Declares, works and resolves incidents.";
  // What OneUptime keeps: read, never written into a configuration.
  item.slug = "incident-responder-8f2a1b3c";
  item.permissionCount = 3;
  return item;
}

function team(): Team {
  const item: Team = new Team();
  item._id = TEAM_ID;
  item.name = "Platform";
  return item;
}

interface ItemCall {
  modelType: DatabaseBaseModelType;
  id: ObjectID;
  select: JSONObject;
}

interface ListCall {
  modelType: DatabaseBaseModelType;
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

function tableOf(modelType: DatabaseBaseModelType): string {
  return new modelType().tableName || "";
}

function itemCalls(): Array<ItemCall> {
  return getItemMock.mock.calls.map((call: Array<unknown>): ItemCall => {
    return call[0] as ItemCall;
  });
}

function listCalls(): Array<ListCall> {
  return getListMock.mock.calls.map((call: Array<unknown>): ListCall => {
    return call[0] as ListCall;
  });
}

// Opens a page of the Teams routes, as the address bar does.
function visit(url: string): void {
  goTo(url);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteUtil.getRouteString(PageMap.TEAMS_ROOT)}
          element={<TeamsRoutes {...PAGE_PROPS} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// A Developer page, once the role is read and its guide is drawn.
async function openDeveloperPage(page: string): Promise<HTMLElement> {
  visit(`${ROLE_URL}/developer/${page}`);

  return await screen.findByTestId(
    "developer-docs-guide",
    {},
    { timeout: 10000 },
  );
}

function deleteStep(): HTMLElement {
  const step: HTMLElement | undefined = screen
    .getAllByTestId(/^setup-guide-step-\d+$/)
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes("Delete it");
    });

  expect(step).toBeDefined();

  return step!;
}

function tabLabels(container: HTMLElement): Array<string> {
  return within(container)
    .getAllByRole("tab")
    .map((tab: HTMLElement): string => {
      return tab.textContent || "";
    });
}

// The trail above the page, crumb by crumb, as it reads.
async function trail(lastCrumb: string): Promise<Array<string>> {
  const nav: HTMLElement = screen.getByRole("navigation", {
    name: "Breadcrumb",
  });

  await waitFor(() => {
    expect(nav).toHaveTextContent(lastCrumb);
  });

  return within(nav)
    .getAllByRole("listitem")
    .map((crumb: HTMLElement): string => {
      return (crumb.textContent || "").trim();
    });
}

async function heading(): Promise<HTMLElement> {
  return await screen.findByTestId(
    PAGE_RECORD_TITLE_TEST_IDS.heading,
    {},
    { timeout: 10000 },
  );
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
  getItemMock.mockReset();
  getListMock.mockReset();

  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    const call: ItemCall = args[0] as ItemCall;

    return tableOf(call.modelType) === "CustomRole" &&
      call.id.toString() === ROLE_ID
      ? role()
      : null;
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const call: ListCall = args[0] as ListCall;
    const data: Array<BaseModel> =
      tableOf(call.modelType) === "Team" ? [team()] : [];

    return { data, count: data.length, skip: 0, limit: call.limit };
  });

  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a custom role's own page", () => {
  test("is drawn under the role's own menu: Custom Role > Overview, then Developer, folded", async () => {
    visit(ROLE_URL);

    expect(await heading()).toHaveTextContent(
      "Custom Role - Incident Responder",
    );

    expect(sectionTitlesInOrder()).toEqual(["Custom Role", "Developer"]);
    expect(linksIn("Custom Role")).toEqual([
      { title: "Overview", href: ROLE_URL },
    ]);
    expect(activeLinkTitles()).toEqual(["Overview"]);
    expect(isExpanded("Developer")).toBe(false);

    // Not the Teams menu, which a role's page used to be drawn in.
    expect(screen.queryByText("All Teams")).toBeNull();
  });

  test("its trail names the role, and leads back to Roles", async () => {
    visit(ROLE_URL);

    expect(await trail("Incident Responder")).toEqual([
      "Project",
      "Teams",
      "Roles",
      "Incident Responder",
    ]);

    const roles: HTMLElement = within(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).getByRole("link", { name: "Roles" });

    expect(roles).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/teams/roles`,
    );
  });

  test("the Roles list keeps the Teams menu, as before", async () => {
    visit(`/dashboard/${PROJECT_ID}/teams/roles`);

    expect(
      await screen.findByText("All Teams", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(sectionTitlesInOrder()).not.toContain("Custom Role");
  });
});

describe("a custom role's API page", () => {
  test("opens from the role's menu, with Developer open and API marked", async () => {
    await openDeveloperPage("api");

    expect(isExpanded("Developer")).toBe(true);
    expect(activeLinkTitles()).toEqual(["API"]);
    expect(await heading()).toHaveTextContent(
      "Custom Role - Incident Responder",
    );
    expect(await trail("API")).toEqual([
      "Project",
      "Teams",
      "Roles",
      "Incident Responder",
      "API",
    ]);
  });

  test("reads the role by the page's address, with the fields its read example asks for", async () => {
    await openDeveloperPage("api");

    const read: ItemCall | undefined = itemCalls().find(
      (call: ItemCall): boolean => {
        return Boolean(call.select["permissionCount"]);
      },
    );

    expect(read).toBeDefined();
    expect(tableOf(read!.modelType)).toBe("CustomRole");
    expect(read!.id.toString()).toBe(ROLE_ID);
    expect(Object.keys(read!.select).sort()).toEqual(
      ["_id", "createdAt", "description", "name", "permissionCount"].sort(),
    );
    // Never the slug: what OneUptime keeps is read only where it is shown.
    expect(read!.select["slug"]).toBeUndefined();
  });

  test("ends with Delete it, which starts on the plain delete and has a tab for each way", async () => {
    await openDeveloperPage("api");

    const step: HTMLElement = deleteStep();

    expect(step).toHaveTextContent(
      "This deletes the custom role for good. If workflows run as it, say what they run as from now on, or OneUptime refuses the delete and names them. For another custom role, put its ID in place of <custom-role-id>.",
    );
    expect(tabLabels(step)).toEqual(TAB_LABELS);
    expect(
      within(step).getByRole("tab", { name: "No workflow runs as it" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(step.textContent).toContain(
      `curl -X DELETE https://oneuptime.acme.com/api/custom-role/${ROLE_ID}`,
    );
    expect(step.textContent).not.toContain("miscDataProps");
  });

  test("each tab of Delete it shows the request body of its way", async () => {
    await openDeveloperPage("api");

    const step: HTMLElement = deleteStep();

    fireEvent.click(
      within(step).getByRole("tab", { name: "Default permissions" }),
    );

    expect(
      within(step).getByRole("tab", { name: "Default permissions" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(step.textContent).toContain('"miscDataProps"');
    expect(step.textContent).toContain('"workflowsRunAs": "Default"');
    expect(step.textContent).not.toContain("workflowsRunAsCustomRoleId");

    fireEvent.click(
      within(step).getByRole("tab", { name: "Another custom role" }),
    );

    expect(step.textContent).toContain('"workflowsRunAs": "CustomRole"');
    expect(step.textContent).toContain(
      '"workflowsRunAsCustomRoleId": "<custom-role-id>"',
    );

    fireEvent.click(
      within(step).getByRole("tab", { name: "No workflow runs as it" }),
    );

    expect(step.textContent).not.toContain("miscDataProps");
  });

  test("its common tasks list and add the role's permissions, and find the workflows that run as it", async () => {
    await openDeveloperPage("api");

    const tasks: HTMLElement | undefined = screen
      .getAllByTestId("developer-docs-section")
      .find((section: HTMLElement): boolean => {
        return (section.textContent || "").includes("Common tasks");
      });

    expect(tasks).toBeDefined();
    expect(tabLabels(tasks!)).toEqual([
      "Its permissions",
      "Add a permission",
      "Workflows that run as it",
    ]);
    expect(tasks!.textContent).toContain(
      "https://oneuptime.acme.com/api/custom-role-permission/get-list",
    );

    fireEvent.click(
      within(tasks!).getByRole("tab", { name: "Add a permission" }),
    );

    expect(tasks!.textContent).toContain(
      "https://oneuptime.acme.com/api/custom-role-permission",
    );
    expect(tasks!.textContent).toContain(`"customRoleId": "${ROLE_ID}"`);
    expect(tasks!.textContent).toContain('"permission": "IncidentMember"');

    fireEvent.click(
      within(tasks!).getByRole("tab", { name: "Workflows that run as it" }),
    );

    expect(tasks!.textContent).toContain(
      "https://oneuptime.acme.com/api/workflow/get-list",
    );
    expect(tasks!.textContent).toContain(`"runAsCustomRoleId": "${ROLE_ID}"`);
  });
});

describe("a custom role's CLI page", () => {
  test("ends with Delete it, with the CLI's flags for each way", async () => {
    await openDeveloperPage("cli");

    expect(activeLinkTitles()).toEqual(["CLI"]);

    const step: HTMLElement = deleteStep();

    expect(tabLabels(step)).toEqual(TAB_LABELS);
    expect(step.textContent).toContain(
      `oneuptime custom-role delete ${ROLE_ID}`,
    );
    expect(step.textContent).not.toContain("--workflows-run-as");

    fireEvent.click(
      within(step).getByRole("tab", { name: "Default permissions" }),
    );

    expect(step.textContent).toContain("--workflows-run-as Default");
    expect(step.textContent).not.toContain("--workflows-run-as-custom-role-id");

    fireEvent.click(
      within(step).getByRole("tab", { name: "Another custom role" }),
    );

    expect(step.textContent).toContain("--workflows-run-as CustomRole");
    expect(step.textContent).toContain(
      "--workflows-run-as-custom-role-id '<custom-role-id>'",
    );
    expect(step.textContent).not.toContain("curl -X");
  });
});

describe("a custom role's Terraform page", () => {
  test("writes the role as it is: its name and description, never what OneUptime keeps", async () => {
    const guide: HTMLElement = await openDeveloperPage("terraform");

    expect(activeLinkTitles()).toEqual(["Terraform"]);
    expect(guide.textContent).toContain(
      'resource "oneuptime_custom_role" "incident_responder"',
    );
    expect(guide.textContent).toContain('name        = "Incident Responder"');
    expect(guide.textContent).toContain(
      'description = "Declares, works and resolves incidents."',
    );
    expect(guide.textContent).toContain(`id = "${ROLE_ID}"`);

    // The permission count and the slug are OneUptime's: no attribute.
    expect(guide.textContent).not.toContain("permission_count");
    expect(guide.textContent).not.toContain("slug");
    expect(guide.textContent).not.toContain("incident-responder-8f2a1b3c");
    // A role has no labels of its own to write.
    expect(guide.textContent).not.toMatch(/\blabels\s*=/);
  });

  test("fetches the role without what OneUptime keeps, and looks up the teams a recipe gives it to", async () => {
    await openDeveloperPage("terraform");

    const read: ItemCall | undefined = itemCalls().find(
      (call: ItemCall): boolean => {
        return Boolean(call.select["description"]);
      },
    );

    expect(read).toBeDefined();
    expect(read!.select["permissionCount"]).toBeUndefined();
    expect(read!.select["slug"]).toBeUndefined();

    expect(
      listCalls()
        .map((call: ListCall): string => {
          return tableOf(call.modelType);
        })
        .sort(),
    ).toEqual(["Team"]);
  });

  test("adds a permission and a team beside the role, each a resource of its own that refers to it", async () => {
    await openDeveloperPage("terraform");

    const section: HTMLElement | undefined = screen
      .getAllByTestId("developer-docs-section")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes("Build on it");
      });

    expect(section).toBeDefined();
    expect(tabLabels(section!)).toEqual([
      "Add a permission",
      "Give it to a team",
    ]);
    expect(section!.textContent).toContain(
      'resource "oneuptime_custom_role_permission" "incident_member"',
    );
    expect(section!.textContent).toContain(
      "custom_role_id = oneuptime_custom_role.incident_responder.id",
    );

    fireEvent.click(
      within(section!).getByRole("tab", { name: "Give it to a team" }),
    );

    expect(section!.textContent).toContain(
      'resource "oneuptime_team_custom_role" "team"',
    );
    expect(section!.textContent).toContain(
      `team_id        = "${TEAM_ID}" # Platform`,
    );
  });
});

describe("a custom role's AI Assistants page", () => {
  test("says the MCP server has no tools for custom roles, and works through the API", async () => {
    await openDeveloperPage("ai-assistants");

    expect(activeLinkTitles()).toEqual(["AI Assistants"]);
    expect(screen.getByTestId("developer-docs-notice")).toHaveTextContent(
      "OneUptime's MCP server does not have tools for custom roles yet.",
    );
    // It writes prompts from what the page knows: no lookups of the project.
    expect(listCalls()).toEqual([]);
  });
});

describe("a custom role that cannot be read", () => {
  test("its Developer page says so where the page would be, and shows no command", async () => {
    // Gone, or not the reader's to read: the server answers with nothing.
    getItemMock.mockResolvedValue(null);

    visit(`${ROLE_URL}/developer/api`);

    expect(
      await screen.findByText(
        /Cannot load custom role\./,
        {},
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("developer-docs-guide")).toBeNull();
    expect(screen.queryByText(/curl -X/)).toBeNull();
  });
});
