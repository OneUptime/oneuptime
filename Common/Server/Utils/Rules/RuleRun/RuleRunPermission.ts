import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import Permission, { UserPermission } from "../../../../Types/Permission";
import {
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../../../Types/Rules/RuleRun";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Types/Database/Permissions/TablePermission";
import RuleRunRegistry, { RuleRunDefinition } from "./RuleRunRegistry";

/*
 * Who may press "Run now".
 *
 * A run executes as root, so this is the whole access check, and it has to
 * cover everything the run writes - not just the rule:
 *
 *   - the rule itself (update), since running is a way of using it;
 *   - the resources it changes (update), or a role allowed to author rules but
 *     not to touch, say, incidents could edit every incident through a rule;
 *   - for owner rules, the owner rows it creates (create).
 *
 * Every required set is read off the models' own @TableAccessControl, so an
 * ACL edit cannot drift from what a run enforces, and every check also honours
 * a team's block list the way a normal API write does.
 *
 * A grant limited to specific labels is not enough: a run reaches every
 * resource in the project, not just the labelled ones.
 */

function unscopedGrants(
  props: DatabaseCommonInteractionProps,
): Array<Permission> {
  /*
   * Read through getUserPermissions(Allow) rather than off the raw props:
   * those entries hold grants and denials together, so mapping them directly
   * would count a team's explicit block as a grant.
   */
  return DatabaseCommonInteractionPropsUtil.getUserPermissions(
    props,
    PermissionType.Allow,
  )
    .filter((userPermission: UserPermission): boolean => {
      return !userPermission.labelIds || userPermission.labelIds.length === 0;
    })
    .map((userPermission: UserPermission): Permission => {
      return userPermission.permission;
    });
}

function requirePermission(data: {
  props: DatabaseCommonInteractionProps;
  grants: Array<Permission>;
  modelType: DatabaseBaseModelType;
  requestType: DatabaseRequestType.Create | DatabaseRequestType.Update;
  message: string;
}): void {
  const model: DatabaseBaseModel = new data.modelType();
  const required: Array<Permission> =
    (data.requestType === DatabaseRequestType.Create
      ? model.getCreatePermissions()
      : model.getUpdatePermissions()) || [];

  if (
    !data.grants.some((permission: Permission): boolean => {
      return required.includes(permission);
    })
  ) {
    throw new NotAuthorizedException(data.message);
  }

  TablePermission.checkTableLevelBlockPermissions(
    data.modelType,
    data.props,
    data.requestType,
  );
}

export default class RuleRunPermission {
  public static assertCanRun(data: {
    props: DatabaseCommonInteractionProps;
    ruleType: RuleRunType;
  }): void {
    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      data.ruleType,
    );

    // A status page monitor rule re-syncs its page and has no resource walk.
    const isStatusPageSync: boolean =
      data.ruleType === RuleRunType.StatusPageMonitorRule;

    if (!definition && !isStatusPageSync) {
      throw new BadDataException("This rule cannot be run.");
    }

    // Mirrors the BaseAPI write path's own bypass.
    if (data.props.isMasterAdmin) {
      return;
    }

    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      data.ruleType,
    );
    const grants: Array<Permission> = unscopedGrants(data.props);

    requirePermission({
      props: data.props,
      grants: grants,
      modelType: definition ? definition.ruleModelType : StatusPageMonitorRule,
      requestType: DatabaseRequestType.Update,
      message:
        "You do not have permission to edit this rule, which running it requires.",
    });

    if (!definition) {
      return;
    }

    requirePermission({
      props: data.props,
      grants: grants,
      modelType: definition.resourceModelType,
      requestType: DatabaseRequestType.Update,
      message: `You do not have permission to edit every ${meta.resourceSingular} in this project, which running this rule does.`,
    });

    for (const ownerModelType of definition.ownerModelTypes || []) {
      requirePermission({
        props: data.props,
        grants: grants,
        modelType: ownerModelType,
        requestType: DatabaseRequestType.Create,
        message: `You do not have permission to add owners to ${meta.resourcePlural}, which running this rule does.`,
      });
    }
  }
}
