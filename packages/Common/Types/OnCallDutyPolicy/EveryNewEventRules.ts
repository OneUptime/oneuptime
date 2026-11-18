import ColumnLength from "../Database/ColumnLength";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import { readRequestedReaderLanguage } from "../ReaderLanguage";
import {
  composedValue,
  createTranslator,
  translationKey,
  Translator,
} from "../Translator";

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
 * alert" - on to start with; a later policy is offered it off
 * (getEveryNewEventRulesOfferKind, #7371). The choice travels with the create as misc
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

/*
 * THE TWO RULES ARE NAMED IN THE LANGUAGE OF THE PERSON WHO MADE THEM
 * (#7995).
 *
 * Their names and descriptions are records the project's people then see
 * and edit in their lists, so they start in the language of whoever made
 * the policy, as a new monitor's criteria do (#7247): the Dashboard's
 * translator in the guided setups, and on the server the language the
 * create says it was made in (EVERY_NEW_EVENT_RULES_LANGUAGE_KEY), else the
 * person's saved one, else English (OnCallDutyPolicyService.create, with
 * ServerTranslation's getRecordWordsTranslator). Once saved they are the
 * project's own text: nothing renames a rule made before.
 *
 * No translator is English, byte for byte as the names always were. The
 * Dashboard's extractor reads this file as a "keys" root, and the server's
 * locale set copies the Dashboard's wording of its sentences
 * (Scripts/I18n/ServerLocales' DASHBOARD_SHARED_TEXT_SOURCES): after
 * changing one, translate it in the Dashboard's files and run
 * `npm run i18n:server-sync` from the repository's root.
 */

/*
 * The language a policy's create says its two rules are worded in: one of
 * the codes OneUptime writes in, sent beside
 * PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY by whoever asks for the rules.
 */
export const EVERY_NEW_EVENT_RULES_LANGUAGE_KEY: string =
  "everyNewEventRulesLanguage";

/*
 * The language a create's misc data names for its rules, when it names one
 * OneUptime writes in exactly; undefined for nothing, or for anything else
 * (readRequestedReaderLanguage) - the caller then decides.
 */
export const readEveryNewEventRulesLanguage: (
  miscDataProps: JSONObject | null | undefined,
) => string | undefined = (
  miscDataProps: JSONObject | null | undefined,
): string | undefined => {
  if (
    !miscDataProps ||
    typeof miscDataProps !== "object" ||
    Array.isArray(miscDataProps)
  ) {
    return undefined;
  }

  return readRequestedReaderLanguage(
    miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY],
  );
};

// What the two rules are called, and the longest name a rule column holds.
export const RULE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

// Each rule's name, a whole sentence with the policy's name in it.
export const EVERY_NEW_INCIDENT_RULE_NAME: string = translationKey(
  "Page {{policy}} for every incident",
);

export const EVERY_NEW_ALERT_RULE_NAME: string = translationKey(
  "Page {{policy}} for every alert",
);

// What a rule calls a policy with no name.
export const UNNAMED_POLICY_IN_RULE_NAME: string = translationKey(
  "the new on-call policy",
);

const ELLIPSIS: string = "…";

const WHITESPACE_RUN: RegExp = /\s+/g;

// What stands for the policy's name while the words around it are counted.
const NAME_MARKER: string = "x";

/*
 * "Page <policy> for every <what>", in the translator's language, cut to
 * fit a rule's name column: the policy's name gives way, ending in "…", so
 * the words around it stay whole in every language. A policy with no name
 * is "the new on-call policy", in the sentence's language.
 */
const getRuleName: (data: {
  policyName: string | undefined | null;
  template: string;
  translator?: Translator | undefined;
}) => string = (data: {
  policyName: string | undefined | null;
  template: string;
  translator?: Translator | undefined;
}): string => {
  const translator: Translator = data.translator || createTranslator(undefined);
  const name: string = (data.policyName || "")
    .replace(WHITESPACE_RUN, " ")
    .trim();

  if (!name) {
    return translator.translateTemplate(data.template, {
      policy: composedValue((sentence: Translator): string => {
        return (
          sentence.translateText(UNNAMED_POLICY_IN_RULE_NAME) ||
          UNNAMED_POLICY_IN_RULE_NAME
        );
      }),
    });
  }

  // The words around the name, as the sentence's language writes them.
  const around: number =
    Array.from(
      translator.translateTemplate(data.template, { policy: NAME_MARKER }),
    ).length - NAME_MARKER.length;
  const room: number = Math.max(
    ELLIPSIS.length + 1,
    RULE_NAME_MAX_LENGTH - around,
  );

  const shown: string =
    Array.from(name).length <= room
      ? name
      : `${Array.from(name)
          .slice(0, room - ELLIPSIS.length)
          .join("")
          .trimEnd()}${ELLIPSIS}`;

  return translator.translateTemplate(data.template, { policy: shown });
};

export const getEveryNewIncidentRuleName: (
  policyName: string | undefined | null,
  translator?: Translator | undefined,
) => string = (
  policyName: string | undefined | null,
  translator?: Translator | undefined,
): string => {
  return getRuleName({
    policyName: policyName,
    template: EVERY_NEW_INCIDENT_RULE_NAME,
    translator: translator,
  });
};

export const getEveryNewAlertRuleName: (
  policyName: string | undefined | null,
  translator?: Translator | undefined,
) => string = (
  policyName: string | undefined | null,
  translator?: Translator | undefined,
): string => {
  return getRuleName({
    policyName: policyName,
    template: EVERY_NEW_ALERT_RULE_NAME,
    translator: translator,
  });
};

// Each rule's description: what it does, and where it came from.
export const EVERY_NEW_INCIDENT_RULE_DESCRIPTION: string = translationKey(
  "Pages this on-call policy for every new incident. Added when the policy was created.",
);

export const EVERY_NEW_ALERT_RULE_DESCRIPTION: string = translationKey(
  "Pages this on-call policy for every new alert. Added when the policy was created.",
);

// A description in the translator's language; English without one.
const getRuleDescription: (
  description: string,
  translator?: Translator | undefined,
) => string = (
  description: string,
  translator?: Translator | undefined,
): string => {
  return (translator?.translateText(description) || description) as string;
};

export const getEveryNewIncidentRuleDescription: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return getRuleDescription(EVERY_NEW_INCIDENT_RULE_DESCRIPTION, translator);
};

export const getEveryNewAlertRuleDescription: (
  translator?: Translator | undefined,
) => string = (translator?: Translator | undefined): string => {
  return getRuleDescription(EVERY_NEW_ALERT_RULE_DESCRIPTION, translator);
};

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

/*
 * HOW CREATE ON-CALL POLICY OFFERS THE CHOICE (#7371).
 *
 * A project's first policy is offered it on (shouldOfferEveryNewEventRules).
 * A later one was offered nothing: the switch was hidden and nothing took
 * its place, so a newcomer who made the website setup's policy first and
 * then followed the manual path saved a second policy that paged nobody,
 * and the dialog never said so. A later policy is offered it too, off to
 * start with - two policies paged for every new incident and alert is a
 * choice to make, not a default - with the sentence that says a policy
 * pages nobody until a rule or a monitor triggers it.
 *
 *   - FirstPolicy: no on-call policy and no on-call rule yet; offered on.
 *   - LaterPolicy: the project has a policy (archived ones count) or an
 *     on-call rule of either kind; offered off.
 *   - None: the person may not add on-call rules, or the counts are not
 *     known (still loading, or a read that failed): nothing is offered.
 */
export enum EveryNewEventRulesOfferKind {
  FirstPolicy = "FirstPolicy",
  LaterPolicy = "LaterPolicy",
  None = "None",
}

export const getEveryNewEventRulesOfferKind: (
  facts: EveryNewEventRulesOfferFacts,
) => EveryNewEventRulesOfferKind = (
  facts: EveryNewEventRulesOfferFacts,
): EveryNewEventRulesOfferKind => {
  if (!facts.mayAddRules) {
    return EveryNewEventRulesOfferKind.None;
  }

  if (shouldOfferEveryNewEventRules(facts)) {
    return EveryNewEventRulesOfferKind.FirstPolicy;
  }

  // One count is enough to know the project pages through something already.
  if (
    (facts.policyCount || 0) > 0 ||
    (facts.incidentRuleCount || 0) > 0 ||
    (facts.alertRuleCount || 0) > 0
  ) {
    return EveryNewEventRulesOfferKind.LaterPolicy;
  }

  return EveryNewEventRulesOfferKind.None;
};

/*
 * Whether the switch starts on: for a first policy, and while the counts
 * are still on their way - a new project's counts can answer after the
 * dialog opened, and its switch then joins it on. Only a policy known to
 * be a later one starts off.
 */
export const doesEveryNewEventRulesOfferStartOn: (
  kind: EveryNewEventRulesOfferKind,
) => boolean = (kind: EveryNewEventRulesOfferKind): boolean => {
  return kind !== EveryNewEventRulesOfferKind.LaterPolicy;
};
