import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjectiveMonitorRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import HeldPermissionsUtil from "../../../../Types/HeldPermissions";
import Permission from "../../../../Types/Permission";
import {
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../../../Types/Rules/RuleRun";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Types/Database/Permissions/TablePermission";
import CallerPermission from "../../Permission/CallerPermission";
import RuleRunRegistry, {
  RuleRunDefinition,
  SyncRuleRunType,
} from "./RuleRunRegistry";

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
 * A grant limited to specific labels, or to owned resources, is not enough: a
 * run reaches every resource in the project (or, for an SLO monitor rule, any
 * SLO's rules), not just the labelled or owned ones.
 */

/*
 * Monitor rules that keep one status page or SLO in step with the monitors
 * they match. Saving such a rule already runs the same sync as root, so
 * running it needs exactly what saving it needs: edit on the rule. A Record,
 * so a new self-syncing rule type without a model here is a compile error.
 */
const SYNC_RULE_MODEL_TYPES: Record<SyncRuleRunType, DatabaseBaseModelType> = {
  [RuleRunType.StatusPageMonitorRule]: StatusPageMonitorRule,
  [RuleRunType.ServiceLevelObjectiveMonitorRule]:
    ServiceLevelObjectiveMonitorRule,
};

/*
 * The caller must hold one of the model's permissions for the operation by a
 * grant that reaches the whole project - the rule every permission check
 * follows (CallerPermission), counting only project-wide grants: an
 * Owned-scoped grant reaches only what the user or their team owns - for an
 * SLO monitor rule, the rules of SLOs they own (@OwnedThrough) - and a run
 * looks the rule up as root, so counting it would let them run any SLO's
 * rule. A grant limited to labels reaches only labelled records. Roles that
 * cannot be scoped (ProjectOwner, ProjectAdmin, ...) count whatever scope is
 * stored on them, exactly as OwnedScopePermission treats them. An
 * operational resource accepts its *AllOperationalResources wildcard, granted
 * the same way, as the CRUD path does.
 *
 * Then no block with no labels on the model's list, refused with the message
 * that names it (checkTableLevelBlockPermissions), as a normal API write is.
 */
function requirePermission(data: {
  props: DatabaseCommonInteractionProps;
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
    !CallerPermission.isGrantedAny(data.props, required, {
      projectWideOnly: true,
      wildcard: HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: data.requestType,
      }),
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

    /*
     * A status page or SLO monitor rule re-syncs its page or SLO and has no
     * resource walk, so it has no definition - only a rule model to check.
     */
    const ruleModelType: DatabaseBaseModelType | null = definition
      ? definition.ruleModelType
      : RuleRunRegistry.isSyncRuleRunType(data.ruleType)
        ? SYNC_RULE_MODEL_TYPES[data.ruleType]
        : null;

    if (!ruleModelType) {
      throw new BadDataException("This rule cannot be run.");
    }

    // Mirrors the BaseAPI write path's own bypass.
    if (data.props.isMasterAdmin) {
      return;
    }

    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      data.ruleType,
    );

    requirePermission({
      props: data.props,
      modelType: ruleModelType,
      requestType: DatabaseRequestType.Update,
      message:
        "You do not have permission to edit this rule, which running it requires.",
    });

    if (!definition) {
      return;
    }

    requirePermission({
      props: data.props,
      modelType: definition.resourceModelType,
      requestType: DatabaseRequestType.Update,
      message: `You do not have permission to edit every ${meta.resourceSingular} in this project, which running this rule does.`,
    });

    for (const ownerModelType of definition.ownerModelTypes || []) {
      requirePermission({
        props: data.props,
        modelType: ownerModelType,
        requestType: DatabaseRequestType.Create,
        message: `You do not have permission to add owners to ${meta.resourcePlural}, which running this rule does.`,
      });
    }
  }
}
