import OnCallPageAs from "../../../Types/OnCallDutyPolicy/OnCallPageAs";
import { toOnCallPageAs } from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { OnCallRulePagingHold } from "./OnCallRulePagingHold";

/*
 * WHO A RECORD'S ON-CALL RULES PAGE, AND AS WHAT.
 *
 * Each on-call rule pages the people of its policies as responders, as rules
 * always have, or as observers (OnCallPageAs): kept informed while somebody
 * else responds, their answer acknowledging nothing (OnCallObserverPage). A
 * record that two rules page the same policy for pages it as responders
 * when either rule does: being asked to respond is never turned into only
 * being told.
 *
 * A record's on-call policies are the ones that respond to it. So a rule
 * engine adds the responder policies it matched to the record, as it always
 * has, and leaves the observer policies off it: the record's service pages
 * each of those by a run of its own that pages as observers. A policy the
 * record has already - named when it was created, by its monitor, by a
 * template, or added by a rule - responds to it, and is not paged again as
 * observers.
 *
 * The engine hands the record's service what its rules page
 * (OnCallRulesPaging): the responder policies it added, the observer
 * policies, and the holds of either that may not page yet
 * (OnCallRulePagingHold).
 */

// The column a rule engine reads to know what a rule pages as.
export const ON_CALL_RULE_PAGE_AS_SELECT: { pageAs: true } = { pageAs: true };

// What a rule says about what its policies page as (OnCallRuleBaseModel).
export interface OnCallRulePageAsSettings {
  pageAs?: OnCallPageAs | string | null | undefined;
}

// What a record's on-call rules page, as an engine hands it to the record's service.
export interface OnCallRulesPaging {
  /*
   * The responder policies the rules added to the record, by id: the ones
   * that respond to it now and did not before.
   */
  addedPolicyIds: Array<string>;
  /*
   * The policies the rules page as observers, by id - none of them the
   * record's own. Each is paged by a run of its own that pages as observers.
   */
  observerPolicyIds: Array<string>;
  /*
   * The holds of the policies above that may not page yet, by policy id: a
   * policy with none pages right away (OnCallRulePagingHold).
   */
  holds: Map<string, OnCallRulePagingHold>;
}

// Rules that page nobody, or could not be read.
export function getNoOnCallRulesPaging(): OnCallRulesPaging {
  return {
    addedPolicyIds: [],
    observerPolicyIds: [],
    holds: new Map<string, OnCallRulePagingHold>(),
  };
}

/*
 * The roles of one record's policies, as a rule engine goes through the
 * rules the record matched.
 */
export class OnCallRulePageRoles {
  private readonly respondingPolicyIds: Set<string> = new Set<string>();
  private readonly observingPolicyIds: Set<string> = new Set<string>();

  // A rule the record matched, and the policies it pages.
  public addRule(
    rule: OnCallRulePageAsSettings,
    policyIds: Array<string>,
  ): void {
    const pagesObservers: boolean =
      toOnCallPageAs(rule.pageAs) === OnCallPageAs.Observers;

    for (const policyId of policyIds) {
      if (!policyId) {
        continue;
      }

      if (pagesObservers) {
        this.observingPolicyIds.add(policyId);
      } else {
        this.respondingPolicyIds.add(policyId);
      }
    }
  }

  /*
   * Whether the rules page this policy only as observers: some rule pages it
   * as observers, and none as responders.
   */
  public isObserverOnly(policyId: string): boolean {
    return (
      this.observingPolicyIds.has(policyId) &&
      !this.respondingPolicyIds.has(policyId)
    );
  }
}

/*
 * What a record's matched policies come to, given the policies it has
 * already: the responder policies to add to it, and the observer policies
 * to page beside it - in the order the rules matched them.
 */
export function splitOnCallRulePolicies(data: {
  matchedPolicyIds: Array<string>;
  existingPolicyIds: Set<string>;
  roles: OnCallRulePageRoles;
}): { toAddPolicyIds: Array<string>; observerPolicyIds: Array<string> } {
  const toAddPolicyIds: Array<string> = [];
  const observerPolicyIds: Array<string> = [];

  for (const policyId of data.matchedPolicyIds) {
    // The record's own policy responds to it already.
    if (!policyId || data.existingPolicyIds.has(policyId)) {
      continue;
    }

    if (data.roles.isObserverOnly(policyId)) {
      observerPolicyIds.push(policyId);
      continue;
    }

    toAddPolicyIds.push(policyId);
  }

  return {
    toAddPolicyIds: toAddPolicyIds,
    observerPolicyIds: observerPolicyIds,
  };
}
