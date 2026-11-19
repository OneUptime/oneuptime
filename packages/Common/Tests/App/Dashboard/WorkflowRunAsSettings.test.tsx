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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import WorkflowSettings, {
  WORKFLOW_SETTINGS_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Settings";
import { WORKFLOW_RUN_AS_PLACE } from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowRunAsCard";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import User from "../../../Models/DatabaseModels/User";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { WorkflowRunAs } from "../../../Types/Workflow/WorkflowRunAs";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import UserUtil from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * WHAT A WORKFLOW RUNS AS, ON ITS SETTINGS PAGE (#9695).
 *
 * Under More settings, which most people never open: its folded header
 * names Run As, and says so when the workflow runs as more than Default;
 * a link to "#run-as" opens it at the card. The card says what the steps
 * can do and, for a raised workflow, whose permissions it runs with and who
 * may change it. Change Run As offers only what the signed-in person could
 * give a team themselves, warns before Project Owner, says the workflow
 * will run with their permissions, and is locked - in the server's words -
 * for someone who may not change a raised workflow. The page is rendered
 * for real; the network and the permission snapshot are stubbed.
 */

const WORKFLOW_ID: string = "c1c1c1c1-0000-4000-8000-000000000001";
const ROLE_ID: string = "c1c1c1c1-0000-4000-8000-0000000000c1";
const OTHER_ROLE_ID: string = "c1c1c1c1-0000-4000-8000-0000000000c2";
const PATH: string = `/dashboard/${PROJECT_ID}/workflows/${WORKFLOW_ID}/settings`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

const BASE: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

interface Stored {
  runAs?: WorkflowRunAs;
  roleId?: string;
  givenBy?: string;
}

let stored: Stored = {};

function grant(permissions: Array<Permission>): void {
  const all: Array<Permission> = [...BASE, ...permissions];

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(all);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: all.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

// Two custom roles: one holding Incident Member, one holding Project Admin.
function rolesAndPermissions(modelType: unknown): Array<BaseModel> {
  if (modelType === CustomRole) {
    return [
      [ROLE_ID, "Incident Responder"],
      [OTHER_ROLE_ID, "Almost Admin"],
    ].map(([id, name]: Array<string>): BaseModel => {
      const role: CustomRole = new CustomRole();
      role._id = id!;
      role.name = name!;
      role.permissionCount = 1;
      return role;
    });
  }

  if (modelType === CustomRolePermission) {
    return [
      [ROLE_ID, Permission.IncidentMember],
      [OTHER_ROLE_ID, Permission.ProjectAdmin],
    ].map(([roleId, permission]: Array<string>): BaseModel => {
      const row: CustomRolePermission = new CustomRolePermission();
      row.customRoleId = new ObjectID(roleId!);
      row.permission = permission as Permission;
      row.scope = PermissionScope.All;
      row.labels = [];
      return row;
    });
  }

  return [];
}

let updates: Array<Record<string, unknown>> = [];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  stored = {};
  updates = [];
  grant([Permission.WorkflowAdmin]);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(WORKFLOW_ID));

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (data: unknown): Promise<BaseModel> => {
      const options: { modelType: { new (): BaseModel }; id: ObjectID } =
        data as { modelType: { new (): BaseModel }; id: ObjectID };
      const item: BaseModel = new options.modelType();

      item._id = options.id ? options.id.toString() : WORKFLOW_ID;

      if (item instanceof Workflow) {
        item.runAs = stored.runAs || WorkflowRunAs.Default;

        if (stored.roleId) {
          item.runAsCustomRoleId = new ObjectID(stored.roleId);
        }

        if (stored.givenBy) {
          const user: User = new User();
          user.name = new Name(stored.givenBy);
          user.email = new Email("jane@example.com");
          item.runAsGivenByUser = user;
          item.runAsGivenAt = new Date("2026-11-19T10:00:00.000Z");
        }
      }

      return item;
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (data: unknown): Promise<ListResult<BaseModel>> => {
        const rows: Array<BaseModel> = rolesAndPermissions(
          (data as { modelType: unknown }).modelType,
        );

        return { data: rows, count: rows.length, skip: 0, limit: 100 };
      },
    );

  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);

  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      updates.push((data as { data: Record<string, unknown> }).data);
      return undefined as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function openPage(hash: string = ""): Promise<void> {
  goTo(`${PATH}${hash}`);

  render(
    <MemoryRouter initialEntries={[`${PATH}${hash}`]}>
      <WorkflowSettings {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await flush();
}

function moreSettings(): HTMLElement {
  return screen.getByTestId(WORKFLOW_SETTINGS_MORE_TEST_ID);
}

function header(): HTMLElement {
  return within(moreSettings()).getByRole("button", {
    name: new RegExp(MORE_SETTINGS_SECTION_TITLE),
  });
}

async function openTheDialog(): Promise<HTMLElement> {
  fireEvent.click(header());
  await flush();

  const change: HTMLElement = await screen.findByRole("button", {
    name: "Change Run As",
  });

  await waitFor(() => {
    expect(change).not.toBeDisabled();
  });

  fireEvent.click(change);
  await flush();

  return await screen.findByRole("dialog");
}

describe("folded under More settings", () => {
  test("its header names Run As, and says nothing more for a workflow that runs as Default", async () => {
    await openPage();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(header()).toHaveTextContent("Run As");
    expect(header()).not.toHaveTextContent("Project Owner");
  });

  test("says when the workflow runs as Project Owner", async () => {
    stored = { runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" };

    await openPage();

    await waitFor(() => {
      expect(header()).toHaveTextContent("Project Owner");
    });
  });

  test("a link to the card opens it there", async () => {
    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);

    await waitFor(() => {
      expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    expect(screen.getByTestId("workflow-run-as-card")).toBeInTheDocument();
  });
});

describe("the card", () => {
  test("of a workflow that runs as Default says what its steps can do", async () => {
    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);

    const card: HTMLElement = await screen.findByTestId("workflow-run-as-card");

    await waitFor(() => {
      expect(card).toHaveTextContent(
        "Its steps can do what a Project Admin can, except change who has access to the project",
      );
    });
    expect(
      within(card).getByTestId("workflow-run-as-current"),
    ).toHaveTextContent("Default");
  });

  test("of one that runs as Project Owner says whose permissions, and who may change it", async () => {
    stored = { runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" };
    grant([Permission.ProjectOwner]);

    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);

    const card: HTMLElement = await screen.findByTestId("workflow-run-as-card");

    await waitFor(() => {
      expect(card).toHaveTextContent(
        "It runs with the permissions of Jane Doe, who gave them",
      );
    });
    expect(card).toHaveTextContent(
      "Only Project Owners can change this workflow or run it by hand. Anyone who can edit it can still turn it off.",
    );
    expect(
      within(card).getByTestId("workflow-run-as-current"),
    ).toHaveTextContent("Project Owner");
  });

  test("is locked for a Workflow Admin when the workflow runs as Project Owner", async () => {
    stored = { runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" };

    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);
    await screen.findByTestId("workflow-run-as-card");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change Run As" }),
      ).toBeDisabled();
    });
  });

  /*
   * A deleted role takes its id with it (ON DELETE SET NULL): the runs stop,
   * and the server lets anyone who may edit the workflow choose again - so
   * the card says so, and leaves Change Run As open to a Workflow Admin.
   */
  test("of one whose custom role was deleted says it doesn't run, and who can choose again", async () => {
    stored = { runAs: WorkflowRunAs.CustomRole, givenBy: "Jane Doe" };

    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);

    const card: HTMLElement = await screen.findByTestId("workflow-run-as-card");

    await waitFor(() => {
      expect(card).toHaveTextContent(
        "The custom role this workflow runs as was deleted, so it doesn't run. Anyone who can edit it can choose what it runs as.",
      );
    });
    expect(card).not.toHaveTextContent("It runs with the permissions of");
    expect(card).not.toHaveTextContent("the custom role a custom role");
    expect(
      screen.getByRole("button", { name: "Change Run As" }),
    ).not.toBeDisabled();
  });

  test("of one whose custom role the viewer can't see by name says so without a name", async () => {
    stored = {
      runAs: WorkflowRunAs.CustomRole,
      roleId: "c1c1c1c1-0000-4000-8000-0000000000c9",
      givenBy: "Jane Doe",
    };

    await openPage(`#${WORKFLOW_RUN_AS_PLACE}`);

    const card: HTMLElement = await screen.findByTestId("workflow-run-as-card");

    await waitFor(() => {
      expect(card).toHaveTextContent(
        "Its steps can do exactly what one of the project's custom roles allows.",
      );
    });
    expect(card).toHaveTextContent(
      "Only people who have every permission in that role can change this workflow or run it by hand.",
    );
    expect(card).not.toHaveTextContent("the custom role a custom role");
  });
});

describe("Change Run As", () => {
  test("offers a Workflow Admin only Default, and says who Project Owner is for", async () => {
    await openPage();

    const dialog: HTMLElement = await openTheDialog();

    expect(dialog).toHaveTextContent("Default");
    expect(dialog).not.toHaveTextContent("Everything a Project Owner can do");
    expect(
      within(dialog).getByTestId("workflow-run-as-footer"),
    ).toHaveTextContent("Project Owner is offered to Project Owners only.");
  });

  test("offers a Project Owner Project Owner, warns before it, and saves it", async () => {
    grant([Permission.ProjectOwner]);

    await openPage();

    const dialog: HTMLElement = await openTheDialog();

    fireEvent.click(within(dialog).getByText("Project Owner"));
    await flush();

    expect(
      within(dialog).getByTestId("workflow-run-as-owner-warning"),
    ).toHaveTextContent(
      "Its steps will be able to do anything a Project Owner can",
    );
    expect(
      within(dialog).getByTestId("workflow-run-as-your-permissions"),
    ).toHaveTextContent("It runs with your permissions");
    // Raised, it gets new trigger keys (WorkflowService.giveNewTriggerKeys).
    expect(
      within(dialog).getByTestId("workflow-run-as-new-keys"),
    ).toHaveTextContent(
      "It also gets a new webhook URL and incoming email address, so anything that calls the old ones needs the new ones.",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updates).toHaveLength(1);
    });

    expect(updates[0]).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      runAsCustomRoleId: null,
    });
  });

  test("says nothing of new keys when Project Owner is chosen again, or Default", async () => {
    stored = { runAs: WorkflowRunAs.ProjectOwner, givenBy: "Jane Doe" };
    grant([Permission.ProjectOwner]);

    await openPage();

    const dialog: HTMLElement = await openTheDialog();

    fireEvent.click(within(dialog).getByText("Project Owner"));
    await flush();

    expect(
      within(dialog).queryByTestId("workflow-run-as-new-keys"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Default"));
    await flush();

    expect(
      within(dialog).queryByTestId("workflow-run-as-new-keys"),
    ).not.toBeInTheDocument();
  });

  test("offers a custom role only with the roles the person could give a team", async () => {
    grant([Permission.IncidentMember, Permission.WorkflowAdmin]);

    await openPage();

    const dialog: HTMLElement = await openTheDialog();

    expect(dialog).toHaveTextContent("A custom role");
    expect(dialog).not.toHaveTextContent("Everything a Project Owner can do");

    fireEvent.click(within(dialog).getByText("A custom role"));
    await flush();

    // The role picker lists Incident Responder, never Almost Admin.
    const picker: HTMLElement = await within(dialog).findByText("Custom Role");

    expect(picker).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("Almost Admin");
  });
});
