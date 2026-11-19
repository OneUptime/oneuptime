import {
  CustomRoleSummary,
  loadCustomRoleGrants,
  loadCustomRoles,
} from "./CustomRoleOptions";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WorkflowRunAs,
} from "Common/Types/Workflow/WorkflowRunAs";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { canCurrentUserGiveWorkflowRunAs } from "Common/UI/Components/Workflow/WorkflowRunAsGate";
import {
  getLockedReason,
  getWorkflowEditGate,
} from "Common/UI/Components/Workflow/WorkflowRunGate";
import { TeamPermissionGrant } from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS (#9767), what the Delete
 * dialog reads and sends. React-free.
 *
 * Deleted, the role would leave its workflows running nothing until someone
 * chose what they run as - so the server refuses a delete that does not
 * say what they run as instead, and switches them as the role goes
 * (WorkflowsOfDeletedRoles). The dialog lists the workflows the reader may
 * read, each a link to its Run As, says they would stop, and asks what they
 * run as from now on: Default - picked to begin with - or another custom
 * role the reader could give a team, as Change Run As offers it. Someone
 * who may not edit workflows may not delete the role: the dialog says so,
 * and who can.
 */

// The choice for the default permissions; any other value is a role's id.
export const WORKFLOWS_RUN_AS_DEFAULT_CHOICE: string = WorkflowRunAs.Default;

export const CustomRoleDeleteWorkflowsCopy: {
  readonly heading: PluralTemplate;
  readonly more: PluralTemplate;
  readonly wouldStop: string;
  readonly choiceLabel: string;
  readonly defaultOption: string;
  readonly defaultOptionDescription: string;
  readonly rolesHint: string;
  readonly blocked: string;
} = {
  heading: {
    one: "{{count}} workflow runs as this role",
    other: "{{count}} workflows run as this role",
  },
  more: {
    one: "and {{count}} more workflow",
    other: "and {{count}} more workflows",
  },
  wouldStop: translationKey(
    "Deleting the role would stop them until someone changes what they run as, so choose what they run as from now on.",
  ),
  choiceLabel: translationKey("Run them as"),
  defaultOption: translationKey("Default permissions"),
  defaultOptionDescription: translationKey(
    "What a Project Admin can do, except change who has access, read stored credentials or see private incidents.",
  ),
  rolesHint: translationKey(
    "Only the roles you could give a team yourself are listed.",
  ),
  blocked: translationKey(
    "You can't change what these workflows run as, so you can't delete this role yet. Someone who can edit them can choose what they run as in each workflow's Settings, or delete the role.",
  ),
};

// How many workflows the dialog names before it counts the rest.
export const NAMED_WORKFLOWS_LIMIT: number = 5;

// A workflow that runs as the role, as the reader may read it.
export interface WorkflowRunningAsRole {
  id: string;
  name: string;
}

export interface CustomRoleDeleteWorkflows {
  // The workflows that run as the role, by name: those the reader may read.
  workflows: Array<WorkflowRunningAsRole>;
  // The project's other custom roles the reader could give a workflow.
  roles: Array<CustomRoleSummary>;
  // Whether the reader may edit workflows, and so say what they run as.
  canEditWorkflows: boolean;
}

/*
 * What a delete of the role must say first: the workflows that run as it,
 * as far as the reader may read them - none when they may read none, and
 * the server, which reads them all, then says how many - and what they
 * could run as instead.
 */
// Whether the reader could give a workflow a role holding these grants.
export type CanGiveRoleFunction = (
  roleGrants: Array<TeamPermissionGrant>,
) => boolean;

const canCurrentUserGiveRole: CanGiveRoleFunction = (
  roleGrants: Array<TeamPermissionGrant>,
): boolean => {
  return canCurrentUserGiveWorkflowRunAs({
    runAs: WorkflowRunAs.CustomRole,
    roleGrants: roleGrants,
  });
};

export const loadCustomRoleDeleteWorkflows: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  canEditWorkflows?: boolean | undefined;
  canGiveRole?: CanGiveRoleFunction | undefined;
}) => Promise<CustomRoleDeleteWorkflows> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  canEditWorkflows?: boolean | undefined;
  canGiveRole?: CanGiveRoleFunction | undefined;
}): Promise<CustomRoleDeleteWorkflows> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
  const canEditWorkflows: boolean =
    data.canEditWorkflows ?? !getLockedReason(getWorkflowEditGate());

  let workflows: Array<WorkflowRunningAsRole> = [];

  try {
    const found: ListResult<Workflow> = await modelAPI.getList<Workflow>({
      modelType: Workflow,
      query: {
        projectId: data.projectId,
        runAsCustomRoleId: data.customRoleId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        name: SortOrder.Ascending,
      },
    });

    workflows = found.data
      .map((workflow: Workflow): WorkflowRunningAsRole => {
        return {
          id: workflow.id?.toString() || "",
          name: workflow.name || "",
        };
      })
      .filter((workflow: WorkflowRunningAsRole): boolean => {
        return Boolean(workflow.id);
      });
  } catch {
    // The workflows are not the reader's to read: the server names them.
    workflows = [];
  }

  if (workflows.length === 0 || !canEditWorkflows) {
    return { workflows, roles: [], canEditWorkflows };
  }

  return {
    workflows,
    roles: await loadGivableOtherRoles({
      customRoleId: data.customRoleId,
      projectId: data.projectId,
      modelAPI: modelAPI,
      canGiveRole: data.canGiveRole || canCurrentUserGiveRole,
    }),
    canEditWorkflows,
  };
};

/*
 * The project's custom roles but the one being deleted that the reader
 * could give a workflow - what Change Run As offers them. None when the
 * roles are not theirs to read: Default is still offered.
 */
const loadGivableOtherRoles: (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI: typeof ModelAPI;
  canGiveRole: CanGiveRoleFunction;
}) => Promise<Array<CustomRoleSummary>> = async (data: {
  customRoleId: ObjectID;
  projectId: ObjectID;
  modelAPI: typeof ModelAPI;
  canGiveRole: CanGiveRoleFunction;
}): Promise<Array<CustomRoleSummary>> => {
  try {
    const roles: Array<CustomRoleSummary> = await loadCustomRoles({
      projectId: data.projectId,
      modelAPI: data.modelAPI,
    });
    const grants: Map<
      string,
      Array<TeamPermissionGrant>
    > = await loadCustomRoleGrants({
      projectId: data.projectId,
      modelAPI: data.modelAPI,
    });

    return roles.filter((role: CustomRoleSummary): boolean => {
      const roleId: string = role.id.toLowerCase();

      return (
        roleId !== data.customRoleId.toString().toLowerCase() &&
        data.canGiveRole(grantsOf(grants, roleId))
      );
    });
  } catch {
    return [];
  }
};

const grantsOf: (
  grants: Map<string, Array<TeamPermissionGrant>>,
  roleId: string,
) => Array<TeamPermissionGrant> = (
  grants: Map<string, Array<TeamPermissionGrant>>,
  roleId: string,
): Array<TeamPermissionGrant> => {
  for (const [id, roleGrants] of grants) {
    if (id.toLowerCase() === roleId) {
      return roleGrants;
    }
  }

  return [];
};

/*
 * Why a role's own page locks its Delete for a reader who may not edit the
 * workflows that run as it: how many there are, and why the role can't be
 * deleted yet - the dialog's two sentences, as Delete's tooltip says them.
 */
export const getCustomRoleDeleteBlockedReason: (
  translator: Translator,
  workflowCount: number,
) => string = (translator: Translator, workflowCount: number): string => {
  return [
    translator.translatePlural(
      CustomRoleDeleteWorkflowsCopy.heading,
      workflowCount,
    ),
    translator.translateText(CustomRoleDeleteWorkflowsCopy.blocked) ||
      CustomRoleDeleteWorkflowsCopy.blocked,
  ].join(". ");
};

/*
 * What the reader may pick: the default permissions first - what most
 * people want, and picked to begin with - then the other roles by name.
 */
export const getCustomRoleDeleteChoiceOptions: (
  roles: Array<CustomRoleSummary>,
) => Array<DropdownOption> = (
  roles: Array<CustomRoleSummary>,
): Array<DropdownOption> => {
  return [
    {
      label: CustomRoleDeleteWorkflowsCopy.defaultOption,
      value: WORKFLOWS_RUN_AS_DEFAULT_CHOICE,
      description: CustomRoleDeleteWorkflowsCopy.defaultOptionDescription,
    },
    ...roles.map((role: CustomRoleSummary): DropdownOption => {
      return {
        label: role.name,
        value: role.id,
        // A role's name as it was typed, never looked up.
        isUserContent: true,
      };
    }),
  ];
};

/*
 * What the delete sends with the role's id (the server's
 * DeleteOneBy.miscDataProps): what the workflows run as instead. None for
 * a role no workflow the reader may read runs as - the delete it always was.
 */
export const getCustomRoleDeleteMiscDataProps: (
  choice: string | null | undefined,
) => JSONObject | undefined = (
  choice: string | null | undefined,
): JSONObject | undefined => {
  if (!choice) {
    return undefined;
  }

  if (choice === WORKFLOWS_RUN_AS_DEFAULT_CHOICE) {
    return { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default };
  }

  return {
    [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
    [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: choice,
  };
};
