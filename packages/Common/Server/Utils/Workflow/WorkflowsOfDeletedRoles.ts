import WorkflowService from "../../Services/WorkflowService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import WorkflowRunAsAuthority from "./WorkflowRunAsAuthority";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_MISSING_MESSAGE,
  WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE,
  WorkflowRunAs,
  getCustomRoleDeleteWorkflowEditRefusedMessage,
  getCustomRoleDeleteWorkflowsMessage,
} from "../../../Types/Workflow/WorkflowRunAs";

/*
 * THE WORKFLOWS THAT RUN AS A CUSTOM ROLE BEING DELETED (#9767).
 *
 * A workflow that runs as a custom role runs nothing once the role is gone
 * (its runAsCustomRoleId is cleared with it, WorkflowRunAsAuthority
 * .resolveForRun), and nobody was told: the workflows just stopped. So a
 * delete of a role that workflows run as says what they run as instead -
 * Default, or another custom role - and they are switched as the role goes.
 * A delete that does not say is refused, naming them; the Dashboard's
 * Delete asks, and the API takes the choice in the delete's miscDataProps
 * (WORKFLOWS_RUN_AS_INSTEAD_KEY, WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY).
 *
 * Nothing here is a way around who may change a workflow:
 *
 *   - the deleter must be able to edit every one of the workflows (their
 *     own update permission, labels and owners: WorkflowService
 *     .findOneUpdatableById), or the delete is refused, naming the first
 *     they may not;
 *   - another custom role is given only by who could give it to a team -
 *     a person or a project API key, held to the grant ceiling
 *     (WorkflowRunAsAuthority.assertMayGive) - and they become the
 *     workflows' giver;
 *   - the switch is each workflow's own update, made with the deleter's
 *     props once the role is gone (apply): every check a change of Run As
 *     meets, new trigger keys for a workflow raised to another role, and an
 *     audit entry that names the deleter. With the role gone, the update
 *     asks nobody to hold it - as any editor may choose again once it is
 *     deleted today - so a deleter who could delete the role but holds less
 *     than it is not stopped from saying what its workflows run as.
 *
 * OneUptime's own deletes - a project deleted, a data migration - are its
 * business: they ask nothing, and leave the workflows as the key leaves
 * them.
 */

// What the workflows run as once their role is gone.
export interface WorkflowsRunAsInstead {
  runAs: WorkflowRunAs.Default | WorkflowRunAs.CustomRole;
  // The custom role, for CustomRole.
  customRoleId?: ObjectID | undefined;
}

// The switch a delete makes, read before it and made after it.
export interface WorkflowsOfDeletedRolesPlan {
  workflowIds: Array<ObjectID>;
  instead: WorkflowsRunAsInstead;
}

export default class WorkflowsOfDeletedRoles {
  /*
   * What a delete says its role's workflows run as instead, from its
   * miscDataProps: null when it says nothing, refused when it says
   * something that is none of the choices.
   */
  public static readInstead(
    miscDataProps: JSONObject | undefined | null,
  ): WorkflowsRunAsInstead | null {
    const value: JSONValue | undefined =
      miscDataProps?.[WORKFLOWS_RUN_AS_INSTEAD_KEY];

    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (value === WorkflowRunAs.Default) {
      return { runAs: WorkflowRunAs.Default };
    }

    if (value !== WorkflowRunAs.CustomRole) {
      throw new BadDataException(WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE);
    }

    const roleId: string = String(
      miscDataProps?.[WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY] || "",
    ).trim();

    if (!roleId || !ObjectID.isValidUUID(roleId)) {
      throw new BadDataException(WORKFLOWS_RUN_AS_INSTEAD_ROLE_MISSING_MESSAGE);
    }

    return {
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: new ObjectID(roleId),
    };
  }

  /*
   * Before `roles` are deleted: the workflows that run as them, and what
   * they run as instead - or null when none does. Refused, with the
   * workflows named, when the delete says nothing; refused when the
   * deleter may not edit one of them, or may not give the other role.
   */
  public static async plan(data: {
    roles: Array<CustomRole>;
    props: DatabaseCommonInteractionProps;
    miscDataProps?: JSONObject | undefined;
  }): Promise<WorkflowsOfDeletedRolesPlan | null> {
    if (data.props.isRoot) {
      return null;
    }

    const roleIds: Array<ObjectID> = data.roles
      .map((role: CustomRole): ObjectID | null => {
        return role.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (roleIds.length === 0) {
      return null;
    }

    // Every one, as OneUptime: the delete changes them all.
    const workflows: Array<Workflow> = await WorkflowService.findBy({
      query: {
        runAsCustomRoleId: QueryHelper.any(roleIds),
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const workflowIds: Array<ObjectID> = workflows
      .map((workflow: Workflow): ObjectID | null => {
        return workflow.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (workflowIds.length === 0) {
      return null;
    }

    // Their names, as far as the deleter may read them.
    const readableNames: Map<string, string> =
      await WorkflowsOfDeletedRoles.readNames({
        workflowIds: workflowIds,
        props: data.props,
      });

    const instead: WorkflowsRunAsInstead | null =
      WorkflowsOfDeletedRoles.readInstead(data.miscDataProps);

    if (!instead) {
      throw new BadDataException(
        getCustomRoleDeleteWorkflowsMessage({
          roleNames: data.roles.map((role: CustomRole): string => {
            return role.name || "";
          }),
          workflowNames: workflowIds
            .map((id: ObjectID): string => {
              return readableNames.get(id.toString().toLowerCase()) || "";
            })
            .filter((name: string): boolean => {
              return Boolean(name);
            }),
          workflowCount: workflowIds.length,
        }),
      );
    }

    if (instead.runAs === WorkflowRunAs.CustomRole) {
      const isBeingDeleted: boolean = roleIds.some(
        (roleId: ObjectID): boolean => {
          return (
            roleId.toString().toLowerCase() ===
            instead.customRoleId!.toString().toLowerCase()
          );
        },
      );

      if (isBeingDeleted) {
        throw new BadDataException(
          WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE,
        );
      }

      // Given only by who could give it to a team, in each workflow's project.
      for (const projectId of WorkflowsOfDeletedRoles.getProjectIds(
        workflows,
      )) {
        await WorkflowRunAsAuthority.assertMayGive({
          setting: {
            runAs: WorkflowRunAs.CustomRole,
            customRoleId: instead.customRoleId,
          },
          projectId: projectId,
          props: data.props,
        });
      }
    }

    // What they run as is theirs to change: the deleter must be able to.
    for (const workflowId of workflowIds) {
      if (
        !(await WorkflowsOfDeletedRoles.mayEdit({
          workflowId: workflowId,
          props: data.props,
        }))
      ) {
        throw new NotAuthorizedException(
          getCustomRoleDeleteWorkflowEditRefusedMessage({
            workflowName: readableNames.get(
              workflowId.toString().toLowerCase(),
            ),
          }),
        );
      }
    }

    return { workflowIds: workflowIds, instead: instead };
  }

  /*
   * Once the roles are gone: each workflow switched to what the delete
   * said, as the deleter's own update of it. A switch that fails leaves
   * its workflow as the delete left it - running nothing until someone
   * chooses again, as before this change - and is logged; the delete is
   * done either way.
   */
  public static async apply(data: {
    plan: WorkflowsOfDeletedRolesPlan | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!data.plan) {
      return;
    }

    for (const workflowId of data.plan.workflowIds) {
      try {
        await WorkflowService.updateOneById({
          id: workflowId,
          data: {
            runAs: data.plan.instead.runAs,
            runAsCustomRoleId: data.plan.instead.customRoleId || null,
          } as never,
          props: data.props,
        });
      } catch (error) {
        logger.error(
          `Could not switch workflow ${workflowId.toString()} to what it runs as once its custom role was deleted: ${error}`,
        );
      }
    }
  }

  // The workflows' names the deleter may read, by id; none when they may read none.
  private static async readNames(data: {
    workflowIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    try {
      const readable: Array<Workflow> = await WorkflowService.findBy({
        query: {
          _id: QueryHelper.any(data.workflowIds),
        },
        select: {
          _id: true,
          name: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: data.props,
      });

      for (const workflow of readable) {
        if (workflow.id && workflow.name) {
          names.set(workflow.id.toString().toLowerCase(), workflow.name);
        }
      }
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }
    }

    return names;
  }

  // Whether the deleter may edit the workflow: its update scope, as they hold it.
  private static async mayEdit(data: {
    workflowId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      const updatable: Workflow | null =
        await WorkflowService.findOneUpdatableById({
          id: data.workflowId,
          select: {
            _id: true,
          },
          props: data.props,
        });

      return Boolean(updatable);
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return false;
      }

      throw error;
    }
  }

  private static getProjectIds(workflows: Array<Workflow>): Array<ObjectID> {
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const workflow of workflows) {
      if (workflow.projectId) {
        projectIds.set(
          workflow.projectId.toString().toLowerCase(),
          workflow.projectId,
        );
      }
    }

    return Array.from(projectIds.values());
  }
}
