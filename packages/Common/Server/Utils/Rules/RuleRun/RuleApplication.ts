import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/Database/Select";

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
