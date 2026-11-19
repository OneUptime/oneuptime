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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  CustomRoleDeleteWorkflows,
  CustomRoleDeleteWorkflowsCopy,
  NAMED_WORKFLOWS_LIMIT,
  WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
  getCustomRoleDeleteBlockedReason,
  getCustomRoleDeleteChoiceOptions,
  getCustomRoleDeleteMiscDataProps,
  loadCustomRoleDeleteWorkflows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleDeleteWorkflows";
import CustomRoleDeleteWorkflowsChoice, {
  getCustomRoleDeleteConfirmation,
  getWorkflowRunAsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomRole/CustomRoleDeleteWorkflowsChoice";
import { WORKFLOW_RUN_AS_PLACE } from "../../../../App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowRunAsCard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { DeleteConfirmation } from "../../../UI/Components/ModelTable/BaseModelTable";
import { TeamPermissionGrant } from "../../../UI/Utils/GrantablePermission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import UserUtil from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import getJestMockFunction, { MockFunction } from "../../MockType";

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
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS (#9767), as the Dashboard
 * asks it: the dialog lists the workflows that run as the role, each a link
 * to its Run As, says deleting the role would stop them, and asks what they
 * run as from now on - Default to begin with, or another role the reader
 * could give a team - which goes with the delete. A reader who may not
 * edit workflows is told they can't delete the role yet, and who can.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const ROLE_ID: string = "d1d1d1d1-0000-4000-8000-0000000000d1";
const OTHER_ROLE_ID: string = "d1d1d1d1-0000-4000-8000-0000000000d2";
const OWNER_LIKE_ROLE_ID: string = "d1d1d1d1-0000-4000-8000-0000000000d3";

const BASE: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

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

function workflow(id: string, name: string): Workflow {
  const row: Workflow = new Workflow();
  row._id = id;
  row.name = name;
  return row;
}

function workflowId(index: number): string {
  return `d1d1d1d1-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// The role being deleted, one any reader could give, one only an owner could.
function roleRows(modelType: unknown): Array<BaseModel> {
  if (modelType === CustomRole) {
    return [
      [ROLE_ID, "Incident Responder"],
      [OTHER_ROLE_ID, "On-Call Helper"],
      [OWNER_LIKE_ROLE_ID, "Almost Owner"],
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
      [OTHER_ROLE_ID, Permission.IncidentMember],
      [OWNER_LIKE_ROLE_ID, Permission.ProjectOwner],
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

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

// A ModelAPI answering each table from `workflows` and the roles above.
function fakeModelAPI(data: {
  workflows: Array<Workflow>;
  calls?: Array<ListCall>;
  refuseWorkflows?: boolean;
}): typeof ModelAPI {
  return {
    getList: async (call: ListCall): Promise<ListResult<BaseModel>> => {
      data.calls?.push(call);

      if (call.modelType === Workflow) {
        if (data.refuseWorkflows) {
          throw new Error("You do not have permissions to read Workflow.");
        }

        return {
          data: data.workflows,
          count: data.workflows.length,
          skip: 0,
          limit: 100,
        };
      }

      const rows: Array<BaseModel> = roleRows(call.modelType);
      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    },
  } as unknown as typeof ModelAPI;
}

// The reader could give a role holding nothing beyond Incident Member.
function canGiveIncidentMember(
  roleGrants: Array<TeamPermissionGrant>,
): boolean {
  return roleGrants.every((roleGrant: TeamPermissionGrant): boolean => {
    return roleGrant.permission === Permission.IncidentMember;
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function renderInRouter(element: ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

function found(
  count: number,
  overrides: Partial<CustomRoleDeleteWorkflows> = {},
): CustomRoleDeleteWorkflows {
  return {
    workflows: Array.from({ length: count }, (_: unknown, index: number) => {
      return { id: workflowId(index + 1), name: `Workflow ${index + 1}` };
    }),
    roles: [{ id: OTHER_ROLE_ID, name: "On-Call Helper" } as never],
    canEditWorkflows: true,
    ...overrides,
  };
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  goTo(`/dashboard/${PROJECT_ID}/settings/roles`);
  grant([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the delete sends", () => {
  test("Default says the workflows run with the default permissions", () => {
    expect(
      getCustomRoleDeleteMiscDataProps(WORKFLOWS_RUN_AS_DEFAULT_CHOICE),
    ).toEqual({ [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default });
  });

  test("a role says which", () => {
    expect(getCustomRoleDeleteMiscDataProps(OTHER_ROLE_ID)).toEqual({
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
      [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
    });
  });

  test("nothing chosen sends nothing: the delete it always was", () => {
    expect(getCustomRoleDeleteMiscDataProps(undefined)).toBeUndefined();
    expect(getCustomRoleDeleteMiscDataProps(null)).toBeUndefined();
    expect(getCustomRoleDeleteMiscDataProps("")).toBeUndefined();
  });

  test("the keys are the ones the server reads", () => {
    expect(WORKFLOWS_RUN_AS_INSTEAD_KEY).toBe("workflowsRunAs");
    expect(WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY).toBe(
      "workflowsRunAsCustomRoleId",
    );
  });
});

describe("what the reader may pick", () => {
  test("Default comes first, with what it lets the steps do, then the roles by their typed names", () => {
    const options: Array<DropdownOption> = getCustomRoleDeleteChoiceOptions([
      { id: OTHER_ROLE_ID, name: "On-Call Helper" } as never,
    ]);

    expect(
      options.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([WORKFLOWS_RUN_AS_DEFAULT_CHOICE, OTHER_ROLE_ID]);
    expect(options[0]!.label).toBe("Default permissions");
    expect(options[0]!.description).toBe(
      CustomRoleDeleteWorkflowsCopy.defaultOptionDescription,
    );
    expect(options[1]!.label).toBe("On-Call Helper");
    expect(options[1]!.isUserContent).toBe(true);
  });

  test("with no role to offer, Default is still offered", () => {
    expect(
      getCustomRoleDeleteChoiceOptions([]).map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([WORKFLOWS_RUN_AS_DEFAULT_CHOICE]);
  });
});

describe("what is read before the dialog opens", () => {
  test("the workflows that run as the role, by name, in this project", async () => {
    const calls: Array<ListCall> = [];

    const loaded: CustomRoleDeleteWorkflows =
      await loadCustomRoleDeleteWorkflows({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        modelAPI: fakeModelAPI({
          workflows: [
            workflow(workflowId(1), "Close stale incidents"),
            workflow(workflowId(2), "Page the lead"),
          ],
          calls,
        }),
        canEditWorkflows: true,
        canGiveRole: canGiveIncidentMember,
      });

    const workflowCall: ListCall | undefined = calls.find((call: ListCall) => {
      return call.modelType === Workflow;
    });

    expect(workflowCall!.query["projectId"]!.toString()).toBe(PROJECT_ID);
    expect(workflowCall!.query["runAsCustomRoleId"]!.toString()).toBe(ROLE_ID);
    expect(workflowCall!.sort).toEqual({ name: SortOrder.Ascending });
    expect(loaded.workflows).toEqual([
      { id: workflowId(1), name: "Close stale incidents" },
      { id: workflowId(2), name: "Page the lead" },
    ]);
    expect(loaded.canEditWorkflows).toBe(true);
  });

  test("offers only the other roles the reader could give, never the one being deleted", async () => {
    const loaded: CustomRoleDeleteWorkflows =
      await loadCustomRoleDeleteWorkflows({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        modelAPI: fakeModelAPI({
          workflows: [workflow(workflowId(1), "Close stale incidents")],
        }),
        canEditWorkflows: true,
        canGiveRole: canGiveIncidentMember,
      });

    expect(
      loaded.roles.map((role: { id: string }) => {
        return role.id.toLowerCase();
      }),
    ).toEqual([OTHER_ROLE_ID]);
  });

  test("a reader who may not read workflows is told nothing here: the server names them", async () => {
    const loaded: CustomRoleDeleteWorkflows =
      await loadCustomRoleDeleteWorkflows({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        modelAPI: fakeModelAPI({ workflows: [], refuseWorkflows: true }),
        canEditWorkflows: true,
        canGiveRole: canGiveIncidentMember,
      });

    expect(loaded.workflows).toEqual([]);
    expect(loaded.roles).toEqual([]);
  });

  test("no roles are read for a reader who may not edit workflows", async () => {
    const calls: Array<ListCall> = [];

    const loaded: CustomRoleDeleteWorkflows =
      await loadCustomRoleDeleteWorkflows({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        modelAPI: fakeModelAPI({
          workflows: [workflow(workflowId(1), "Close stale incidents")],
          calls,
        }),
        canEditWorkflows: false,
      });

    expect(loaded.workflows).toHaveLength(1);
    expect(loaded.canEditWorkflows).toBe(false);
    expect(loaded.roles).toEqual([]);
    expect(
      calls.map((call: ListCall) => {
        return call.modelType;
      }),
    ).toEqual([Workflow]);
  });

  test("a role nothing runs as reads no roles either", async () => {
    const calls: Array<ListCall> = [];

    const loaded: CustomRoleDeleteWorkflows =
      await loadCustomRoleDeleteWorkflows({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        modelAPI: fakeModelAPI({ workflows: [], calls }),
        canEditWorkflows: true,
      });

    expect(loaded.workflows).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("the dialog's list and choice", () => {
  test("says how many run as the role, and links each to its Run As", async () => {
    renderInRouter(<CustomRoleDeleteWorkflowsChoice found={found(2)} />);
    await flush();

    const box: HTMLElement = screen.getByTestId("custom-role-delete-workflows");

    expect(box).toHaveTextContent("2 workflows run as this role");
    expect(box).toHaveTextContent(
      "Deleting the role would stop them until someone changes what they run as, so choose what they run as from now on.",
    );

    const links: Array<HTMLElement> = within(
      screen.getByTestId("custom-role-delete-workflows-list"),
    ).getAllByRole("link");

    expect(
      links.map((link: HTMLElement) => {
        return link.textContent;
      }),
    ).toEqual(["Workflow 1", "Workflow 2"]);
    expect(links[0]!.getAttribute("href")).toContain(
      `/workflows/${workflowId(1)}/settings#${WORKFLOW_RUN_AS_PLACE}`,
    );
  });

  test("one workflow is said in the singular", async () => {
    renderInRouter(<CustomRoleDeleteWorkflowsChoice found={found(1)} />);
    await flush();

    expect(
      screen.getByTestId("custom-role-delete-workflows"),
    ).toHaveTextContent("1 workflow runs as this role");
  });

  test(`names ${NAMED_WORKFLOWS_LIMIT}, and counts the rest`, async () => {
    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice
        found={found(NAMED_WORKFLOWS_LIMIT + 2)}
      />,
    );
    await flush();

    const list: HTMLElement = screen.getByTestId(
      "custom-role-delete-workflows-list",
    );

    expect(within(list).getAllByRole("link")).toHaveLength(
      NAMED_WORKFLOWS_LIMIT,
    );
    expect(list).toHaveTextContent("and 2 more workflows");
  });

  test("one more is said in the singular", async () => {
    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice
        found={found(NAMED_WORKFLOWS_LIMIT + 1)}
      />,
    );
    await flush();

    expect(
      screen.getByTestId("custom-role-delete-workflows-list"),
    ).toHaveTextContent("and 1 more workflow");
  });

  test("Default is picked to begin with, and said so as it opens", async () => {
    const onChoiceChange: MockFunction = getJestMockFunction();

    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice
        found={found(1)}
        onChoiceChange={onChoiceChange as never}
      />,
    );
    await flush();

    expect(screen.getByLabelText("Run them as")).toBeInTheDocument();
    expect(
      screen.getByTestId("custom-role-delete-workflows"),
    ).toHaveTextContent("Default permissions");
    expect(onChoiceChange).toHaveBeenCalledWith(
      WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
    );
    expect(
      screen.getByText(
        "Only the roles you could give a team yourself are listed.",
      ),
    ).toBeInTheDocument();
  });

  test("picking a role says which", async () => {
    const onChoiceChange: MockFunction = getJestMockFunction();

    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice
        found={found(1)}
        onChoiceChange={onChoiceChange as never}
      />,
    );
    await flush();

    openMenu();
    fireEvent.click(screen.getByText("On-Call Helper"));
    await flush();

    expect(onChoiceChange).toHaveBeenLastCalledWith(OTHER_ROLE_ID);
  });

  test("with no role to offer, says nothing of roles", async () => {
    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice found={found(1, { roles: [] })} />,
    );
    await flush();

    expect(
      screen.queryByText(
        "Only the roles you could give a team yourself are listed.",
      ),
    ).toBeNull();
  });

  test("blocked, says why and who can, and offers no choice", async () => {
    renderInRouter(
      <CustomRoleDeleteWorkflowsChoice found={found(2)} isBlocked={true} />,
    );
    await flush();

    const box: HTMLElement = screen.getByTestId("custom-role-delete-workflows");

    expect(box).toHaveTextContent(CustomRoleDeleteWorkflowsCopy.blocked);
    expect(box).not.toHaveTextContent("Deleting the role would stop them");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(within(box).getAllByRole("link")).toHaveLength(2);
  });

  test("draws nothing when no workflow runs as the role", async () => {
    renderInRouter(<CustomRoleDeleteWorkflowsChoice found={found(0)} />);
    await flush();

    expect(screen.queryByTestId("custom-role-delete-workflows")).toBeNull();
  });

  test("a workflow's Run As is its Settings, opened at the card", () => {
    expect(getWorkflowRunAsRoute(workflowId(7)).toString()).toContain(
      `/workflows/${workflowId(7)}/settings#${WORKFLOW_RUN_AS_PLACE}`,
    );
  });
});

describe("the role's own page, locked", () => {
  test("says how many, why, and who can", () => {
    expect(getCustomRoleDeleteBlockedReason(ENGLISH, 3)).toBe(
      "3 workflows run as this role. You can't change what these workflows run as, so you can't delete this role yet. Someone who can edit them can choose what they run as in each workflow's Settings, or delete the role.",
    );
    expect(getCustomRoleDeleteBlockedReason(ENGLISH, 1)).toMatch(
      /^1 workflow runs as this role\. /,
    );
  });
});

describe("a list's Delete of the role", () => {
  const question: ReactElement = <span>Delete Incident Responder?</span>;

  function listWorkflows(workflows: Array<Workflow>): void {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(
        async (data: unknown): Promise<ListResult<BaseModel>> => {
          const modelType: unknown = (data as { modelType: unknown }).modelType;
          const rows: Array<BaseModel> =
            modelType === Workflow ? workflows : roleRows(modelType);

          return { data: rows, count: rows.length, skip: 0, limit: 100 };
        },
      );
  }

  test("asks as before when no workflow runs as the role", async () => {
    listWorkflows([]);

    const confirmation: DeleteConfirmation =
      await getCustomRoleDeleteConfirmation({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        question,
      });

    expect(confirmation).toEqual({ description: question });
  });

  test("lists them under the question, and sends Default unless another is picked", async () => {
    listWorkflows([workflow(workflowId(1), "Close stale incidents")]);

    const confirmation: DeleteConfirmation =
      await getCustomRoleDeleteConfirmation({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        question,
      });

    expect(confirmation.description).toBe(question);
    expect(confirmation.isDeleteBlocked).toBeFalsy();
    expect(confirmation.getMiscDataProps!()).toEqual({
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
    });

    renderInRouter(<>{confirmation.details}</>);
    await flush();

    expect(screen.getByRole("link")).toHaveTextContent("Close stale incidents");

    openMenu();
    fireEvent.click(screen.getByText("On-Call Helper"));
    await flush();

    expect(confirmation.getMiscDataProps!()).toEqual({
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
      [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
    });
  });

  test("is a notice, with no Delete, for a reader who may not edit workflows", async () => {
    grant([Permission.ProjectMember, Permission.ReadWorkflow]);
    listWorkflows([workflow(workflowId(1), "Close stale incidents")]);

    const confirmation: DeleteConfirmation =
      await getCustomRoleDeleteConfirmation({
        customRoleId: new ObjectID(ROLE_ID),
        projectId: new ObjectID(PROJECT_ID),
        question,
      });

    expect(confirmation.isDeleteBlocked).toBe(true);
    expect(confirmation.getMiscDataProps).toBeUndefined();

    renderInRouter(<>{confirmation.description}</>);
    await flush();

    expect(
      screen.getByTestId("custom-role-delete-workflows"),
    ).toHaveTextContent(CustomRoleDeleteWorkflowsCopy.blocked);
    expect(screen.getByRole("link")).toHaveTextContent("Close stale incidents");
  });
});
