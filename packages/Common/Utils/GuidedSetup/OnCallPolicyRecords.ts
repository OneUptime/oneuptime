import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import { JSONObject } from "../../Types/JSON";
import {
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
} from "../../Types/OnCallDutyPolicy/EveryNewEventRules";
import {
  createTranslator,
  translationKey,
  Translator,
} from "../../Types/Translator";

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

/*
 * The name of the policy a guided setup makes when the project has none,
 * in English. The policy is named in the language of the person it is made
 * for (getFirstOnCallPolicyName).
 */
export const GUIDED_SETUP_POLICY_NAME: string = translationKey(
  "Default on-call policy",
);

/*
 * THE FIRST POLICY'S NAME, IN THE LANGUAGE OF THE PERSON IT IS MADE FOR
 * (#7995): the Dashboard's translator in the guided setups, the server's
 * for the language the person reads the Dashboard in when Ask AI sets
 * paging up (ServerTranslation's getRecordWordsTranslator), so both name it
 * "Standard-Bereitschaftsrichtlinie" for a reader of German. No translator
 * is English. Once saved, it is the project's own name, drawn as written.
 *
 * The Dashboard's extractor reads this file as a "keys" root, and the
 * server's locale set copies the Dashboard's wording of its sentences
 * (Scripts/I18n/ServerLocales' DASHBOARD_SHARED_TEXT_SOURCES): after
 * changing one, translate it in the Dashboard's files and run
 * `npm run i18n:server-sync` from the repository's root.
 */
export const getFirstOnCallPolicyName: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return (
    (translator || createTranslator(undefined)).translateText(
      GUIDED_SETUP_POLICY_NAME,
    ) || GUIDED_SETUP_POLICY_NAME
  );
};

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
 *
 * Named by `translator`, in English without one (getFirstOnCallPolicyName);
 * `language`, the language the person reads the Dashboard in, goes with the
 * create so the server words the two rules in it too
 * (EVERY_NEW_EVENT_RULES_LANGUAGE_KEY). Without one, the server words them
 * in the person's saved language.
 */
export const buildFirstOnCallPolicy: (data: {
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
  translator?: Translator | undefined;
  language?: string | undefined;
}) => FirstOnCallPolicyCreate = (data: {
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
  translator?: Translator | undefined;
  language?: string | undefined;
}): FirstOnCallPolicyCreate => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = getFirstOnCallPolicyName(data.translator);

  return {
    policy: policy,
    miscDataProps: {
      users: [...data.userIds],
      teams: [...data.teamIds],
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
      ...(data.language
        ? { [EVERY_NEW_EVENT_RULES_LANGUAGE_KEY]: data.language }
        : {}),
    },
  };
};
