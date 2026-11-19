import { isRolePermissionGivenToApiKeys } from "../../../Types/Team/CustomRoleCopyPlan";
import Permission from "../../../Types/Permission";
import {
  WorkflowRunAs,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import GrantablePermission, {
  PermissionRows,
  TeamPermissionGrant,
  canGrantPermission,
  canGrantTeamPermission,
} from "../../Utils/GrantablePermission";
import {
  Translator,
  getGlobalTranslator,
  translationKey,
} from "../../Utils/TranslateTemplate";

/*
 * WHAT THE SIGNED-IN PERSON MAY DO WITH A WORKFLOW'S RUN AS (#9695), the
 * dashboard's copy of the server's rule (Server/Utils/Workflow
 * /WorkflowRunAsAuthority), for the choices it offers and the buttons it
 * locks:
 *
 *   - Default is anyone's who may edit the workflow;
 *   - Project Owner is a Project Owner's, with nothing blocking it;
 *   - a custom role is given by who could give each of its permissions to a
 *     team - every one but those limited to what someone owns, which give a
 *     workflow nothing - at its scope and labels.
 *
 * And the same question decides who may change a workflow that runs as more
 * than Default, or run it by hand. Only the person's own permissions in the
 * project count, as on the server: a master admin's pass gives a workflow
 * nothing. Never looser than the server - what this says yes to, it
 * accepts; a no locks a button with the server's own words, and the server
 * still decides.
 */

/*
 * The server's refusals, word for word (Types/Workflow/WorkflowRunAs), so a
 * locked button says what a press would have been told.
 */
export const WorkflowRunAsCopy: {
  readonly ownerChangeRefused: string;
  readonly ownerRunRefused: string;
  readonly roleChangeRefused: string;
  readonly roleRunRefused: string;
} = {
  ownerChangeRefused: translationKey(
    "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
  ),
  ownerRunRefused: translationKey(
    "This workflow runs as Project Owner, so only Project Owners can run it by hand.",
  ),
  roleChangeRefused: translationKey(
    'This workflow runs as the custom role "{{roleName}}", so only people who have every permission in "{{roleName}}" can change it. You can still turn it off.',
  ),
  roleRunRefused: translationKey(
    'This workflow runs as the custom role "{{roleName}}", so only people who have every permission in "{{roleName}}" can run it by hand.',
  ),
};

// What a workflow runs as, as the dashboard read it.
export interface WorkflowRunAsState {
  runAs: unknown;
  // The custom role's name and permissions, for CustomRole.
  roleName?: string | undefined;
  roleGrants?: ReadonlyArray<TeamPermissionGrant> | undefined;
}

/*
 * Whether someone holding `rows` may give a workflow `runAs` - or, the same
 * question, act on one that runs as it. A Run As that cannot be read is
 * held to Project Owner, as the server holds it. A custom role whose
 * permissions are not known (gone, or unreadable) asks nothing: the server
 * decides.
 */
export const canGiveWorkflowRunAs: (data: {
  state: WorkflowRunAsState;
  rows: PermissionRows;
}) => boolean = (data: {
  state: WorkflowRunAsState;
  rows: PermissionRows;
}): boolean => {
  const runAs: WorkflowRunAs =
    readWorkflowRunAs(data.state.runAs) || WorkflowRunAs.ProjectOwner;

  if (runAs === WorkflowRunAs.Default) {
    return true;
  }

  if (runAs === WorkflowRunAs.ProjectOwner) {
    return canGrantPermission({
      permission: Permission.ProjectOwner,
      rows: data.rows,
    });
  }

  return (data.state.roleGrants || [])
    .filter((grant: TeamPermissionGrant): boolean => {
      return isRolePermissionGivenToApiKeys(grant.scope);
    })
    .every((grant: TeamPermissionGrant): boolean => {
      return canGrantTeamPermission({ grant: grant, rows: data.rows });
    });
};

// canGiveWorkflowRunAs, for the signed-in person's own permissions.
export const canCurrentUserGiveWorkflowRunAs: (
  state: WorkflowRunAsState,
) => boolean = (state: WorkflowRunAsState): boolean => {
  return canGiveWorkflowRunAs({
    state: state,
    rows: GrantablePermission.getCurrentUserPermissionRows(),
  });
};

// Why a workflow's changes, and its runs by hand, are locked for someone.
export interface WorkflowRunAsLockedReasons {
  change?: string | undefined;
  run?: string | undefined;
}

/*
 * The reasons a workflow is locked for someone who may not act on what it
 * runs as, in the reader's language: none when it runs as Default, or when
 * they may.
 */
export const getWorkflowRunAsLockedReasons: (data: {
  state: WorkflowRunAsState;
  mayAct: boolean;
  translator?: Translator | undefined;
}) => WorkflowRunAsLockedReasons = (data: {
  state: WorkflowRunAsState;
  mayAct: boolean;
  translator?: Translator | undefined;
}): WorkflowRunAsLockedReasons => {
  const runAs: WorkflowRunAs =
    readWorkflowRunAs(data.state.runAs) || WorkflowRunAs.ProjectOwner;

  if (data.mayAct || runAs === WorkflowRunAs.Default) {
    return {};
  }

  const translator: Translator = data.translator || getGlobalTranslator();

  if (runAs === WorkflowRunAs.CustomRole) {
    const roleName: string = data.state.roleName || "";

    return {
      change: translator.translateTemplate(
        WorkflowRunAsCopy.roleChangeRefused,
        { roleName: roleName },
      ),
      run: translator.translateTemplate(WorkflowRunAsCopy.roleRunRefused, {
        roleName: roleName,
      }),
    };
  }

  return {
    change: translator.translateText(WorkflowRunAsCopy.ownerChangeRefused),
    run: translator.translateText(WorkflowRunAsCopy.ownerRunRefused),
  };
};
