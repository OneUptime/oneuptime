import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "./NotificationRuleCondition";
import IncidentNotificationRule from "./NotificationRuleTypes/IncidentNotificationRule";

/*
 * WHICH CHANGES OF AN SLO A RULE POSTS (#6596).
 *
 * An SLO's rules post two kinds of change: of its error budget policy -
 * entered a tier, recovered, left every tier, deployments frozen or allowed
 * again - and of its status - became At Risk, budget exhausted, healthy
 * again. Each kind has a condition of its own (Error Budget Policy Change,
 * SLO Status Change), and the conditions pick the kinds a rule posts:
 *
 *   - a rule with neither posts the policy's changes, as every SLO rule
 *     always has: a rule saved before status changes were posted goes on
 *     posting exactly what it did, and never starts posting status changes
 *     its team did not choose;
 *   - a rule with an SLO Status Change condition posts status changes, and
 *     the policy's only when it has an Error Budget Policy Change
 *     condition too.
 *
 * And a change condition is about its own kind: a message of the other kind
 * is matched without it, so a rule that picks both posts each kind its
 * condition picks, whether its conditions must all match or any one.
 */
export enum SloRuleChangeKind {
  ErrorBudgetPolicy = "ErrorBudgetPolicy",
  Status = "Status",
}

// The condition that picks each kind of change.
const CHECK_ON_OF_KIND: Readonly<
  Record<SloRuleChangeKind, NotificationRuleConditionCheckOn>
> = {
  [SloRuleChangeKind.ErrorBudgetPolicy]:
    NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
  [SloRuleChangeKind.Status]: NotificationRuleConditionCheckOn.SloStatusChange,
};

type IsPickingFunction = (
  filters: ReadonlyArray<NotificationRuleCondition>,
  kind: SloRuleChangeKind,
) => boolean;

// Whether the conditions hold one, with something in it, for this kind.
const isPicking: IsPickingFunction = (
  filters: ReadonlyArray<NotificationRuleCondition>,
  kind: SloRuleChangeKind,
): boolean => {
  return filters.some((filter: NotificationRuleCondition): boolean => {
    return (
      filter?.checkOn === CHECK_ON_OF_KIND[kind] &&
      !NotificationRuleConditionUtil.isEmptyCondition(filter)
    );
  });
};

export default class SloRuleChanges {
  // The kinds of change a rule with these conditions posts.
  public static getKinds(
    filters: ReadonlyArray<NotificationRuleCondition> | null | undefined,
  ): Array<SloRuleChangeKind> {
    const conditions: ReadonlyArray<NotificationRuleCondition> = filters || [];
    const picksPolicy: boolean = isPicking(
      conditions,
      SloRuleChangeKind.ErrorBudgetPolicy,
    );
    const picksStatus: boolean = isPicking(
      conditions,
      SloRuleChangeKind.Status,
    );

    if (!picksStatus) {
      return [SloRuleChangeKind.ErrorBudgetPolicy];
    }

    return picksPolicy
      ? [SloRuleChangeKind.ErrorBudgetPolicy, SloRuleChangeKind.Status]
      : [SloRuleChangeKind.Status];
  }

  public static isPosting(
    filters: ReadonlyArray<NotificationRuleCondition> | null | undefined,
    kind: SloRuleChangeKind,
  ): boolean {
    return this.getKinds(filters).includes(kind);
  }

  /*
   * The rule as it is matched against a change of this kind: without the
   * other kind's condition, or null when it does not post this kind at all.
   */
  public static getRuleForKind(
    rule: IncidentNotificationRule | null | undefined,
    kind: SloRuleChangeKind,
  ): IncidentNotificationRule | null {
    if (!rule) {
      return null;
    }

    const filters: Array<NotificationRuleCondition> = rule.filters || [];

    if (!this.isPosting(filters, kind)) {
      return null;
    }

    const otherKind: SloRuleChangeKind =
      kind === SloRuleChangeKind.Status
        ? SloRuleChangeKind.ErrorBudgetPolicy
        : SloRuleChangeKind.Status;

    return {
      ...rule,
      filters: filters.filter((filter: NotificationRuleCondition): boolean => {
        return filter?.checkOn !== CHECK_ON_OF_KIND[otherKind];
      }),
    };
  }
}
