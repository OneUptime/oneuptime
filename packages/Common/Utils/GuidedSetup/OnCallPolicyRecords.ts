import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import { JSONObject } from "../../Types/JSON";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "../../Types/OnCallDutyPolicy/EveryNewEventRules";

/*
 * WHO IS TOLD, AND THE ON-CALL POLICY A GUIDED SETUP MAKES FOR IT.
 *
 * The website guided setup (#6804) and Ask AI (#6829,
 * Server/Utils/AI/Toolbox/SetupTools) decide who is told the same way, and
 * make the same policy when they make one:
 *
 *   - a project with no on-call policy and no on-call rule yet gets one,
 *     "Default on-call policy", paging the people and teams picked first
 *     (FirstResponders) - "You", to start with - with the two catch-all
 *     on-call rules that run it for every new incident and alert
 *     (EveryNewEventRules);
 *   - a project that pages people already keeps its own policies and rules:
 *     they decide, and nothing is made beside them, so nobody gets a second
 *     policy paging for every incident;
 *   - somebody who may not set paging up is told as the monitor's owner,
 *     by email.
 *
 * Pure: the Dashboard creates the policy through the model API
 * (WebsiteDownApi), the server through OnCallDutyPolicyService (SetupTools),
 * as the person either way. OnCallDutyPolicyService.create reads the misc
 * data below and adds the first escalation rule and the two rules.
 */

// The name of the policy a guided setup makes when the project has none.
export const GUIDED_SETUP_POLICY_NAME: string = "Default on-call policy";

export enum WhoIsToldMode {
  // No on-call policy or rule yet: the setup makes one, paging who is picked.
  CreatePolicy = "create_policy",
  // The project pages people already: its own policies and rules decide.
  ExistingPolicy = "existing_policy",
  // Paging cannot be set up by this person: told as the monitor's owner.
  OwnerEmailOnly = "owner_email_only",
}

export interface WhoIsToldFacts {
  // Counts of the project's on-call policies and rules; null when unknown.
  policyCount: number | null;
  incidentRuleCount: number | null;
  alertRuleCount: number | null;
  mayCreatePolicy: boolean;
  mayAddEscalationRules: boolean;
  mayAddRules: boolean;
}

// Facts whose policies and rules were counted.
export interface CountedWhoIsToldFacts extends WhoIsToldFacts {
  policyCount: number;
  incidentRuleCount: number;
  alertRuleCount: number;
}

/*
 * Whether the project's on-call policies and rules could be counted: when
 * they could not, nothing says the project has none, so no policy is made
 * on that read (#7059).
 */
export const areWhoIsToldCountsKnown: (
  facts: WhoIsToldFacts,
) => facts is CountedWhoIsToldFacts = (
  facts: WhoIsToldFacts,
): facts is CountedWhoIsToldFacts => {
  return (
    facts.policyCount !== null &&
    facts.incidentRuleCount !== null &&
    facts.alertRuleCount !== null
  );
};

export const getWhoIsToldMode: (facts: WhoIsToldFacts) => WhoIsToldMode = (
  facts: WhoIsToldFacts,
): WhoIsToldMode => {
  if (!areWhoIsToldCountsKnown(facts)) {
    return WhoIsToldMode.OwnerEmailOnly;
  }

  if (
    facts.policyCount > 0 ||
    facts.incidentRuleCount > 0 ||
    facts.alertRuleCount > 0
  ) {
    return WhoIsToldMode.ExistingPolicy;
  }

  if (
    facts.mayCreatePolicy &&
    facts.mayAddEscalationRules &&
    facts.mayAddRules
  ) {
    return WhoIsToldMode.CreatePolicy;
  }

  return WhoIsToldMode.OwnerEmailOnly;
};

// The project's first on-call policy, and what its create carries.
export interface FirstOnCallPolicyCreate {
  policy: OnCallDutyPolicy;
  /*
   * Who it pages first (users, teams: lists of ids) and that it is paged
   * for every new incident and alert: read by OnCallDutyPolicyService.create.
   */
  miscDataProps: JSONObject;
}

/*
 * The project's first on-call policy, paging the people and teams picked
 * first, with an incident and an alert on-call rule that run it for every
 * new incident and alert. The project is the request's: the model API and
 * the service both set it from the caller's tenant.
 */
export const buildFirstOnCallPolicy: (data: {
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
}) => FirstOnCallPolicyCreate = (data: {
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
}): FirstOnCallPolicyCreate => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = GUIDED_SETUP_POLICY_NAME;

  return {
    policy: policy,
    miscDataProps: {
      users: [...data.userIds],
      teams: [...data.teamIds],
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
    },
  };
};
