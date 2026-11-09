import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Select from "../../../Types/Database/Select";
import OnBehalfOfProps from "../../AuditLog/OnBehalfOfProps";

/*
 * The contract between a rule engine and a rule run.
 *
 * Every label, owner and privacy rule engine already knows how to apply its
 * project's rules to one freshly created resource. A rule run needs exactly
 * that, applied to a resource that already exists and restricted to the one
 * rule being run - so each engine exposes the same evaluation behind a second
 * entry point instead of the run re-implementing matching, inheritance and
 * feed items next to it.
 */

// What applying rules to one resource did.
export interface RuleApplicationResult {
  // At least one of the given rules matched the resource.
  matched: boolean;
  // The resource was changed: a label attached, an owner added, made private.
  updated: boolean;
  // How many labels or owners were added (1 for a resource made private).
  itemsAdded: number;
  // Applying threw. The engine has already logged why.
  failed: boolean;
}

export interface ApplyRulesToExistingResourceData<TResource, TRule> {
  resource: TResource;
  rules: Array<TRule>;
  /*
   * Owner rules only. When false, owners are added silently even if the rule
   * asks for notifications - a manual run over hundreds of resources must not
   * turn into hundreds of emails unless the person running it opted in.
   */
  allowOwnerNotification: boolean;
  /*
   * Who ran the rule. What the run changes is theirs in the audit log: a
   * label rule's labels are recorded by them (RuleAddedLabels), and the
   * owners an owner rule adds and the records a privacy rule makes private
   * are written on their behalf (RuleRunWriteProps). Unset, the changes are
   * OneUptime's own, as a rule applied on create is.
   */
  props?: DatabaseCommonInteractionProps | undefined;
}

export interface RuleRunEngine<
  TResource extends BaseModel,
  TRule extends BaseModel,
> {
  // Everything evaluation reads off a rule.
  readonly ruleSelect: Select<TRule>;
  /*
   * Everything evaluation reads off the resource object it is handed. The
   * create hook passes the freshly created row; a run reads these columns so
   * that the resource it passes carries the same information.
   */
  readonly resourceSelectForRuleRun: Select<TResource>;
  applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<TResource, TRule>,
  ): Promise<RuleApplicationResult>;
}

export class RuleApplicationResultUtil {
  public static noMatch(): RuleApplicationResult {
    return { matched: false, updated: false, itemsAdded: 0, failed: false };
  }

  // Matched, but the resource already had everything the rules add.
  public static alreadyApplied(): RuleApplicationResult {
    return { matched: true, updated: false, itemsAdded: 0, failed: false };
  }

  public static updated(itemsAdded: number): RuleApplicationResult {
    return {
      matched: true,
      updated: itemsAdded > 0,
      itemsAdded: itemsAdded,
      failed: false,
    };
  }

  /*
   * Counted as matched: the run reports failures as "could not be updated",
   * and a resource whose evaluation threw is one it tried to update.
   */
  public static failed(): RuleApplicationResult {
    return { matched: true, updated: false, itemsAdded: 0, failed: true };
  }
}

/*
 * THE PROPS A RULE'S WRITES ARE MADE WITH (issues #6300, #6323, #6324).
 *
 * A rule writes as OneUptime, root: who may run it is asked once, at the
 * route (RuleRunPermission, and the network rules' own checks), and a rule
 * applied as a record is created asks nothing. Plain root, though, is
 * OneUptime's own change in the audit log: the owners an owner rule's Run
 * now added, the records a privacy rule's Run now made private, the devices
 * and monitors an auto import rule's Run now created and the monitors a
 * status page or SLO monitor rule's Run now put on its page or SLO read as
 * System's, kept only when the project stores system events, and said
 * nobody ran the rule.
 *
 * So the writes of a run carry who ran it (OnBehalfOfProps: still root,
 * with no project on the request, and the person's identity - their user,
 * the API key or MCP client they acted through - and none of their
 * permissions), and the entries are theirs. With nobody named - a rule
 * applied as a record is created or changed, a rule's sync after it is
 * saved, the automatic import of new scan results - they stay OneUptime's
 * own, a system event. HookFreeWritesAreRecorded.test.ts holds every rule
 * engine's Run now to writing with these.
 */
export class RuleRunWriteProps {
  public static get(
    props?: DatabaseCommonInteractionProps | undefined,
  ): DatabaseCommonInteractionProps {
    return props ? OnBehalfOfProps.get(props) : { isRoot: true };
  }

  /*
   * The same, for a write its service takes only inside a project:
   * MonitorService creates a monitor in the project on the request, and
   * refuses one with none. The project is the rule's own, never the
   * request's, and it grants nothing - a root write in a project is still
   * root. It does make the write one made in that project, which drops any
   * other person the record names (UserAttribution); the person on these
   * props is still its creator, as DatabaseService stamps them. So use it
   * only where the service needs the project, for records that name nobody
   * else.
   */
  public static getInProject(
    props: DatabaseCommonInteractionProps | undefined,
    projectId: ObjectID,
  ): DatabaseCommonInteractionProps {
    return { ...RuleRunWriteProps.get(props), tenantId: projectId };
  }
}
