import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
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

/*
 * An on-call rule, read with the policies it runs: their ids, and whether
 * each is archived.
 */
export interface OnCallRuleWithPolicies {
  onCallDutyPolicies?:
    | ReadonlyArray<
        | {
            id?: unknown;
            _id?: unknown;
            isArchived?: boolean | null | undefined;
          }
        | null
        | undefined
      >
    | null
    | undefined;
}

/*
 * Whether an on-call rule pages anyone: it runs at least one policy in
 * service. An archived policy pages no one (#8234), so a rule whose only
 * policies are archived - or that runs none - leaves its incidents and
 * alerts unpaged, and does not count as the project paging people already
 * (#8433), as WhoIsToldService and Setup Health judge a project. A policy
 * whose isArchived was not read counts as in service, as the server does.
 */
export const doesRuleRunPolicyInService: (
  rule: OnCallRuleWithPolicies | null | undefined,
) => boolean = (rule: OnCallRuleWithPolicies | null | undefined): boolean => {
  return (rule?.onCallDutyPolicies || []).some(
    (
      policy:
        | {
            id?: unknown;
            _id?: unknown;
            isArchived?: boolean | null | undefined;
          }
        | null
        | undefined,
    ): boolean => {
      return Boolean(policy && (policy.id || policy._id) && !policy.isArchived);
    },
  );
};

// How many of these on-call rules page anyone (doesRuleRunPolicyInService).
export const countRulesRunningPolicyInService: (
  rules: ReadonlyArray<OnCallRuleWithPolicies | null | undefined>,
) => number = (
  rules: ReadonlyArray<OnCallRuleWithPolicies | null | undefined>,
): number => {
  return rules.filter(doesRuleRunPolicyInService).length;
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

/*
 * WHAT IF NOBODY ANSWERS: A POLICY'S LEVELS AND REPEATS, ONE COPY (#7244).
 *
 * The guided on-call setup (#6805, OnCallSetupApi) and Ask AI's
 * set_up_paging and add_to_on_call_policy (SetupTools) write them alike:
 *
 *   - someone else after a wait: the level before waits that long
 *     (buildLevelWait, on its escalation rule), and a new escalation rule
 *     pages the people and teams picked (buildOnCallPolicyLevel) - which
 *     OneUptime Cloud's Free plan allows once per policy;
 *   - the same people again: the first level waits that long, and the
 *     policy starts over, up to this many more times (buildPolicyRepeat);
 *   - more people on a level the policy has (buildLevelMembers), as
 *     "Who else is on call?" adds them.
 *
 * Pure: the Dashboard writes them through the model API, the server
 * through the services, as the person either way.
 */

// The minutes a level waits for an acknowledgement: from 1 to a day.
export const MAX_LEVEL_WAIT_IN_MINUTES: number = 24 * 60;

// How many more times a policy starts over: from 1 to 10.
export const MAX_POLICY_REPEAT_TIMES: number = 10;

// A wait as a level takes it, or null when it is not one.
export const readLevelWaitInMinutes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  const minutes: number = Number(value);

  return Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= MAX_LEVEL_WAIT_IN_MINUTES
    ? minutes
    : null;
};

// How many more times a policy starts over, or null when it is not a count it takes.
export const readPolicyRepeatTimes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  const times: number = Number(value);

  return Number.isInteger(times) &&
    times >= 1 &&
    times <= MAX_POLICY_REPEAT_TIMES
    ? times
    : null;
};

// A new level of a policy, and who it pages (read by its create).
export interface OnCallPolicyLevelCreate {
  rule: OnCallDutyPolicyEscalationRule;
  /*
   * Who it pages (users, teams: lists of ids): read by
   * OnCallDutyPolicyEscalationRuleService.create, which adds them.
   */
  miscDataProps: JSONObject;
}

/*
 * A new level of the policy, its last, paging the people and teams picked
 * after the default wait of a new escalation rule (its own wait is the one
 * before the level after it). The project is the request's, as the model
 * API and the service set it; the server names it after its level.
 */
export const buildOnCallPolicyLevel: (data: {
  policyId: ObjectID;
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
  projectId?: ObjectID | undefined;
}) => OnCallPolicyLevelCreate = (data: {
  policyId: ObjectID;
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
  projectId?: ObjectID | undefined;
}): OnCallPolicyLevelCreate => {
  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();

  if (data.projectId) {
    rule.projectId = data.projectId;
  }

  rule.onCallDutyPolicyId = data.policyId;
  rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

  return {
    rule: rule,
    miscDataProps: { users: [...data.userIds], teams: [...data.teamIds] },
  };
};

// How long a level waits before the next one is paged: its rule's update.
export const buildLevelWait: (waitInMinutes: number) => {
  escalateAfterInMinutes: number;
} = (waitInMinutes: number): { escalateAfterInMinutes: number } => {
  return { escalateAfterInMinutes: waitInMinutes };
};

// The policy starting over while nobody acknowledges: its update.
export const buildPolicyRepeat: (times: number) => {
  repeatPolicyIfNoOneAcknowledges: boolean;
  repeatPolicyIfNoOneAcknowledgesNoOfTimes: number;
} = (
  times: number,
): {
  repeatPolicyIfNoOneAcknowledges: boolean;
  repeatPolicyIfNoOneAcknowledgesNoOfTimes: number;
} => {
  return {
    repeatPolicyIfNoOneAcknowledges: true,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
  };
};

// People and teams added to a level the policy has: one row each.
export interface OnCallPolicyLevelMembers {
  users: Array<OnCallDutyPolicyEscalationRuleUser>;
  teams: Array<OnCallDutyPolicyEscalationRuleTeam>;
}

export const buildLevelMembers: (data: {
  projectId: ObjectID;
  policyId: ObjectID;
  ruleId: ObjectID;
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
}) => OnCallPolicyLevelMembers = (data: {
  projectId: ObjectID;
  policyId: ObjectID;
  ruleId: ObjectID;
  userIds: ReadonlyArray<string>;
  teamIds: ReadonlyArray<string>;
}): OnCallPolicyLevelMembers => {
  return {
    users: data.userIds.map(
      (userId: string): OnCallDutyPolicyEscalationRuleUser => {
        const row: OnCallDutyPolicyEscalationRuleUser =
          new OnCallDutyPolicyEscalationRuleUser();
        row.projectId = data.projectId;
        row.onCallDutyPolicyId = data.policyId;
        row.onCallDutyPolicyEscalationRuleId = data.ruleId;
        row.userId = new ObjectID(userId);
        return row;
      },
    ),
    teams: data.teamIds.map(
      (teamId: string): OnCallDutyPolicyEscalationRuleTeam => {
        const row: OnCallDutyPolicyEscalationRuleTeam =
          new OnCallDutyPolicyEscalationRuleTeam();
        row.projectId = data.projectId;
        row.onCallDutyPolicyId = data.policyId;
        row.onCallDutyPolicyEscalationRuleId = data.ruleId;
        row.teamId = new ObjectID(teamId);
        return row;
      },
    ),
  };
};

/*
 * WHY A GUIDED SETUP'S OWN POLICY NO LONGER SERVES IT. The on-call and the
 * website-down setups keep the policy they set up in the browser, and read
 * it again before a step that needs it moves on, and when the page opens.
 * Deleted - in another tab, or by a teammate - it is gone (#7516, #8235).
 * Archived, it is still there, but pages no one: incidents and alerts that
 * use it skip it (#8432). Either way the run forgets it and sets up who is
 * paged again, saying which of the two happened.
 */
export enum SetupPolicyGone {
  Deleted = "deleted",
  Archived = "archived",
}

/*
 * Why the run's policy, as just read, no longer serves it: Deleted when it
 * read as null (gone, or no longer readable by this person), Archived when
 * it was archived since. Null while it is in service.
 */
export const getSetupPolicyGone: (
  policy: { isArchived?: boolean | null | undefined } | null | undefined,
) => SetupPolicyGone | null = (
  policy: { isArchived?: boolean | null | undefined } | null | undefined,
): SetupPolicyGone | null => {
  if (!policy) {
    return SetupPolicyGone.Deleted;
  }

  if (policy.isArchived) {
    return SetupPolicyGone.Archived;
  }

  return null;
};

// Whether the run's policy, as just read, still serves the run.
export const isSetupPolicyInService: <
  T extends { isArchived?: boolean | null | undefined },
>(
  policy: T | null | undefined,
) => policy is T = <T extends { isArchived?: boolean | null | undefined }>(
  policy: T | null | undefined,
): policy is T => {
  return getSetupPolicyGone(policy) === null;
};
