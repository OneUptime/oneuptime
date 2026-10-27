import ColumnLength from "../Database/ColumnLength";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";

/*
 * A NEW PROJECT'S FIRST ON-CALL POLICY PAGES FOR EVERY INCIDENT AND ALERT.
 *
 * An on-call policy pages nobody until something runs it: an on-call rule
 * under Incidents or Alerts > Rules > On-Call Rules, a monitor's criteria, a
 * template, or someone by hand. Someone new followed the Home checklist's
 * "Set up an on-call policy", picked themselves under "Who gets paged
 * first?", saw the step ticked off - and was never paged, because no rule
 * named the policy. Paging it for every incident took a second trip, to a
 * folded Rules section of another product.
 *
 * Create On-Call Policy now offers, while the project has no on-call policy
 * and no on-call rule yet, "Page this policy for every new incident and
 * alert" - on to start with. The choice travels with the create as misc
 * data under PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY, and the server, once
 * the policy exists, adds two on-call rules naming it: one for incidents,
 * one for alerts, each matching everything (OnCallDutyPolicyService.create).
 * They are ordinary rules, listed and changed where every on-call rule is.
 *
 * React-free and server-safe: the server, the dashboard and their tests
 * read it.
 */

export const PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY: string =
  "pageForEveryNewIncidentAndAlert";

/**
 * Whether a policy create asks for the two rules, read from its misc data.
 *
 * Only `true` (or the text "true") asks. Nothing sent, null or false asks
 * nothing - an API caller, Terraform or an import gets the policy alone, as
 * before. Anything else is refused rather than read as no: a caller who
 * meant to page the policy must not get one that silently pages nobody.
 */
export const readPageForEveryNewIncidentAndAlert: (
  miscDataProps: JSONObject | null | undefined,
) => boolean = (miscDataProps: JSONObject | null | undefined): boolean => {
  if (
    !miscDataProps ||
    typeof miscDataProps !== "object" ||
    Array.isArray(miscDataProps)
  ) {
    return false;
  }

  const value: unknown =
    miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY];

  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (value === true) {
    return true;
  }

  if (typeof value === "string") {
    const text: string = value.trim().toLowerCase();

    if (text === "true") {
      return true;
    }

    if (text === "false" || text === "") {
      return false;
    }
  }

  throw new BadDataException(
    `${PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY} must be true or false.`,
  );
};

// What the two rules are called, and the longest name a rule column holds.
export const RULE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

const ELLIPSIS: string = "…";

const WHITESPACE_RUN: RegExp = /\s+/g;

/*
 * "Page <policy> for every <what>", cut to fit a rule's name column: the
 * policy's name gives way, ending in "…", so the words around it stay
 * whole. A policy with no name is "the new on-call policy".
 */
const getRuleName: (
  policyName: string | undefined | null,
  what: string,
) => string = (policyName: string | undefined | null, what: string): string => {
  const prefix: string = "Page ";
  const suffix: string = ` for every ${what}`;
  const name: string =
    (policyName || "").replace(WHITESPACE_RUN, " ").trim() ||
    "the new on-call policy";
  const room: number = RULE_NAME_MAX_LENGTH - prefix.length - suffix.length;

  const shown: string =
    Array.from(name).length <= room
      ? name
      : `${Array.from(name)
          .slice(0, room - ELLIPSIS.length)
          .join("")
          .trimEnd()}${ELLIPSIS}`;

  return `${prefix}${shown}${suffix}`;
};

export const getEveryNewIncidentRuleName: (
  policyName: string | undefined | null,
) => string = (policyName: string | undefined | null): string => {
  return getRuleName(policyName, "incident");
};

export const getEveryNewAlertRuleName: (
  policyName: string | undefined | null,
) => string = (policyName: string | undefined | null): string => {
  return getRuleName(policyName, "alert");
};

// Each rule's description: what it does, and where it came from.
export const EVERY_NEW_INCIDENT_RULE_DESCRIPTION: string =
  "Pages this on-call policy for every new incident. Added when the policy was created.";

export const EVERY_NEW_ALERT_RULE_DESCRIPTION: string =
  "Pages this on-call policy for every new alert. Added when the policy was created.";

/*
 * Whether Create On-Call Policy offers the choice: to someone who may add
 * on-call rules for incidents and alerts, while the project has no on-call
 * policy and no on-call rule of either kind - the project's first policy,
 * the one nothing else could be paging. Unknown counts (still loading, or a
 * read that failed) offer nothing.
 */
export interface EveryNewEventRulesOfferFacts {
  policyCount: number | null;
  incidentRuleCount: number | null;
  alertRuleCount: number | null;
  mayAddRules: boolean;
}

export const shouldOfferEveryNewEventRules: (
  facts: EveryNewEventRulesOfferFacts,
) => boolean = (facts: EveryNewEventRulesOfferFacts): boolean => {
  return (
    facts.mayAddRules &&
    facts.policyCount === 0 &&
    facts.incidentRuleCount === 0 &&
    facts.alertRuleCount === 0
  );
};
