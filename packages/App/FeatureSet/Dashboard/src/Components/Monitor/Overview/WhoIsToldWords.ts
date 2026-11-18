import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { CHANNEL_NAMES } from "../../OnCallTestPage/OnCallTestPageWords";
import Route from "Common/Types/API/Route";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldDeclaration,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldHeadline,
  WhoIsToldMonitorGroup,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerMatch,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPagingState,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldRule,
  WhoIsToldServerChannel,
  WhoIsToldStatusPage,
  getReachablePeople,
  getWhoIsToldHeadline,
  getWhoIsToldPagingState,
} from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  composedValue,
  formatList,
  PluralTemplate,
  TemplateValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { recordNameInSentence } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * "WHEN THIS GOES DOWN" IN THE READER'S WORDS (Types/Monitor/WhoIsTold).
 *
 * The server says what happens as data; every sentence the card shows is
 * one whole sentence looked up here, with the project's own names - a
 * status, a severity, a policy, a person - set into it. The server's
 * English sentence of a break is what other readers of the API (Setup
 * health, #6812) show; the card writes its own, in the reader's language.
 */

// The most people named in a sentence; more are counted.
export const WHO_IS_TOLD_MAX_NAMED_PEOPLE: number = 3;

/*
 * What happens first: the status it sets, and what it opens, its severity
 * in brackets - a new project's severities are named "Critical Incident"
 * and the rest, so "opens a {{severity}} incident" read "opens a Critical
 * Incident incident" on every monitor's page (#7368), as the Website down
 * summary had read before it took the brackets.
 */
export const OPENS_SENTENCES: Readonly<
  Record<"statusAndIncident" | "statusAndAlert" | "incident" | "alert", string>
> = {
  statusAndIncident: translationKey(
    "OneUptime marks it {{status}} and opens an incident ({{severity}}).",
  ),
  statusAndAlert: translationKey(
    "OneUptime marks it {{status}} and opens an alert ({{severity}}).",
  ),
  incident: translationKey("OneUptime opens an incident ({{severity}})."),
  alert: translationKey("OneUptime opens an alert ({{severity}})."),
};

// The chain's Opens row: what the criteria opens, its severity in brackets.
export const OPENS_CHAIN_LINES: Readonly<Record<"incident" | "alert", string>> =
  {
    incident: translationKey("An incident ({{severity}})"),
    alert: translationKey("An alert ({{severity}})"),
  };

/*
 * An event's severity as a value of these sentences, by its kind's list
 * (Common/Utils/DefaultRecordNames): a severity a project starts with -
 * "Critical Incident", "High" - in the reader's words, one the project
 * named itself as written.
 */
export function getWhoIsToldSeverityValue(
  event: Pick<WhoIsToldEvent, "kind" | "severityName">,
): TemplateValue {
  return recordNameInSentence(
    event.kind === OnCallTestPageRecordKind.Alert
      ? StateListType.AlertSeverity
      : StateListType.IncidentSeverity,
    event.severityName,
  );
}

/*
 * The status a criteria sets, as a value of these sentences: "Offline" in
 * the reader's words, a status the project named itself as written.
 */
export function getWhoIsToldStatusValue(statusName: string): TemplateValue {
  return recordNameInSentence(StateListType.MonitorStatus, statusName);
}

// Who it emails as owners.
const OWNER_SENTENCES: Readonly<
  Record<WhoIsToldOwnersSource, { named: string; unnamed: string }>
> = {
  [WhoIsToldOwnersSource.Named]: {
    named: translationKey("It emails its owners ({{names}})."),
    unnamed: translationKey("It emails its owners."),
  },
  [WhoIsToldOwnersSource.OwnerRules]: {
    named: translationKey(
      "It emails the owners added by owner rules ({{names}}).",
    ),
    unnamed: translationKey("It emails the owners added by owner rules."),
  },
  [WhoIsToldOwnersSource.ProjectOwners]: {
    named: translationKey("It emails the Project Owners ({{names}})."),
    unnamed: translationKey("It emails the Project Owners."),
  },
  [WhoIsToldOwnersSource.MonitorOwners]: {
    named: translationKey("It emails the monitor's owners ({{names}})."),
    unnamed: translationKey("It emails the monitor's owners."),
  },
};

/*
 * AN OWNER THE PAGE REACHES FIRST (#8860). The owners' Created email leaves
 * out everyone the record's on-call page reached already (#7987), so an
 * owner a policy's first level pages at once is told once, by the page:
 * "It emails its owners (Ben Ito). Ana Lopez is paged, so isn't emailed as
 * an owner too." - or this sentence alone, when the page reaches every
 * owner (a new project's one person, its owner, on call). Who is so is the
 * server's (getWhoIsToldOwnersAsTold), matched by user id.
 */
export const PAGED_OWNERS_SENTENCES: Readonly<{
  owners: PluralTemplate;
  projectOwners: PluralTemplate;
}> = {
  owners: {
    one: "{{names}} is paged, so isn't emailed as an owner too.",
    other: "{{names}} are paged, so aren't emailed as owners too.",
  },
  // The Project Owners stand in for a record with no owners.
  projectOwners: {
    one: "{{names}} is paged, so isn't emailed as a Project Owner too.",
    other: "{{names}} are paged, so aren't emailed as Project Owners too.",
  },
};

const PAGES_PEOPLE_SENTENCE: string = translationKey(
  "It pages {{people}} through {{policies}}.",
);

const PAGES_MANY_SENTENCE: PluralTemplate = {
  one: "It pages {{count}} person through {{policies}}.",
  other: "It pages {{count}} people through {{policies}}.",
};

const PAGING_HIDDEN_SENTENCE: string = translationKey(
  "It pages the people on call through an on-call policy you can't see.",
);

const PAGING_UNREACHABLE_SENTENCE: string = translationKey(
  "Its on-call policies reach nobody who can be paged right now.",
);

const NOBODY_PAGED_SENTENCE: string = translationKey("Nobody is paged.");

const STATUS_ONLY_SENTENCE: string = translationKey(
  "OneUptime marks it {{status}}. It opens no incident or alert, so nobody is paged.",
);

const MORE_CRITERIA_SENTENCE: PluralTemplate = {
  one: "{{count}} more criteria opens an incident or alert.",
  other: "{{count}} more criteria open incidents or alerts.",
};

// A break, by kind, in the reader's words.
export const BREAK_SENTENCES: Readonly<{
  nothingHappens: string;
  nobodyPagedIncidents: string;
  nobodyPagedAlerts: string;
  nobodyPagedNoPolicy: string;
  onlyIncidentsHaveRules: string;
  policyHasNoLevels: string;
  hiddenPolicyHasNoLevels: string;
  policyReachesNobody: string;
  hiddenPolicyReachesNobody: string;
  personProblems: Readonly<Record<WhoIsToldPersonProblem, string>>;
  channelOff: string;
  noBalance: string;
  serverCannotSend: Readonly<Record<WhoIsToldServerChannel, string>>;
}> = {
  nothingHappens: translationKey(
    "No criteria of this monitor changes its status or opens an incident or an alert, so nobody is told when it goes down.",
  ),
  nobodyPagedIncidents: translationKey(
    "Nobody is paged: no on-call rule matches incidents from this monitor.",
  ),
  nobodyPagedAlerts: translationKey(
    "Nobody is paged: no on-call rule matches alerts from this monitor.",
  ),
  /*
   * A project with no on-call policy yet: Set Up Paging opens the on-call
   * guided setup, which makes one, rather than rules with nothing to page
   * (#7369).
   */
  nobodyPagedNoPolicy: translationKey(
    "Nobody is paged: this project has no on-call policy yet.",
  ),
  onlyIncidentsHaveRules: translationKey(
    "Nobody is paged for this monitor's alerts: only incidents have on-call rules.",
  ),
  policyHasNoLevels: translationKey(
    "On-call policy {{policy}} has no escalation rules, so it pages nobody.",
  ),
  hiddenPolicyHasNoLevels: translationKey(
    "An on-call policy has no escalation rules, so it pages nobody.",
  ),
  policyReachesNobody: translationKey(
    "On-call policy {{policy}} reaches nobody right now: nobody is on call in its first escalation rule.",
  ),
  hiddenPolicyReachesNobody: translationKey(
    "An on-call policy reaches nobody right now: nobody is on call in its first escalation rule.",
  ),
  personProblems: {
    [WhoIsToldPersonProblem.OptedOut]: translationKey(
      "{{name}} opted out of pages of this severity.",
    ),
    [WhoIsToldPersonProblem.NoRuleNoFallback]: translationKey(
      "{{name}} has no on-call rule for this severity, and this project doesn't fall back to verified methods.",
    ),
    [WhoIsToldPersonProblem.NoVerifiedMethod]: translationKey(
      "{{name}} has no verified notification method.",
    ),
    [WhoIsToldPersonProblem.ChannelsOff]: translationKey(
      "{{name}} is reached only by channels that are off in this project.",
    ),
  },
  channelOff: translationKey(
    "{{channel}} is off in this project, so pages that use it are not sent.",
  ),
  noBalance: translationKey(
    "This project has no balance left for SMS and calls, so they are not sent.",
  ),
  serverCannotSend: {
    [WhoIsToldServerChannel.Email]: translationKey(
      "This server can't send email yet, so nobody is emailed.",
    ),
    [WhoIsToldServerChannel.SMS]: translationKey(
      "This server can't send SMS yet, so SMS pages are not sent.",
    ),
    [WhoIsToldServerChannel.Call]: translationKey(
      "This server can't make phone calls yet, so call pages are not sent.",
    ),
  },
};

/*
 * Said after the channels of somebody no rule of theirs covers the severity
 * for: those channels are what the project's fallback picks of their
 * methods, not every one they verified (#7528).
 */
export const FALLBACK_CHANNELS_NOTE: string = translationKey(
  "Picked by the fallback: no on-call rule of theirs covers this severity",
);

/*
 * A PRIVATE RECORD (#7213). A privacy rule - or the criteria - makes an
 * incident or alert private as it is created: it shows on no status page,
 * tells no subscriber, and only its owners, the Project Owners and the
 * Project Admins can see it. A reader who will not be able to see it is
 * told only that it opens, and that it is private.
 */
export const PRIVATE_WORDS: Readonly<{
  hiddenSentence: string;
  byCriteria: string;
  byRules: PluralTemplate;
  whoCanSee: string;
  offStatusPages: string;
}> = {
  // The card's first words, and the chain, for a record the reader can't see.
  hiddenSentence: translationKey(
    "It's private, so you can't see who it tells.",
  ),
  byCriteria: translationKey("The criteria makes it private."),
  byRules: {
    one: "Privacy rule {{rules}} makes it private.",
    other: "Privacy rules {{rules}} make it private.",
  },
  whoCanSee: translationKey(
    "Only its owners, Project Owners and Project Admins can see it.",
  ),
  // The status pages that show the monitor show no private incident.
  offStatusPages: translationKey("None: it's private"),
};

/*
 * THE INCIDENT AN ALERT BECOMES (#7216): the first alert incident rule that
 * matches the alert declares an incident from it - right away, or once the
 * alert has stayed open for the rule's wait - and that incident is told as
 * any incident is. One whole sentence for each: a rule the reader can't see
 * is said as such, never by an empty name.
 */
export const DECLARES_WORDS: Readonly<{
  now: string;
  nowHiddenRule: string;
  afterWait: PluralTemplate;
  afterWaitHiddenRule: PluralTemplate;
}> = {
  now: translationKey(
    "Alert incident rule {{rule}} declares an incident ({{severity}}) from it right away.",
  ),
  nowHiddenRule: translationKey(
    "An alert incident rule you can't see declares an incident ({{severity}}) from it right away.",
  ),
  afterWait: {
    one: "If it's still open after {{count}} minute, alert incident rule {{rule}} declares an incident ({{severity}}) from it.",
    other:
      "If it's still open after {{count}} minutes, alert incident rule {{rule}} declares an incident ({{severity}}) from it.",
  },
  afterWaitHiddenRule: {
    one: "If it's still open after {{count}} minute, an alert incident rule you can't see declares an incident ({{severity}}) from it.",
    other:
      "If it's still open after {{count}} minutes, an alert incident rule you can't see declares an incident ({{severity}}) from it.",
  },
};

/*
 * THE LABEL RULES THAT CHANGE WHO IS PAGED (#7212): label rules run before
 * on-call rules, so an on-call rule can match a label one of them adds. The
 * chain names them only when they change which on-call rules page.
 */
export const LABEL_RULES_NOTE: string = translationKey(
  "Their labels change which on-call rules page it.",
);

/*
 * THE OWNERS THAT MAKE AN ON-CALL RULE MATCH (#9407): an alert on-call
 * rule's Alert Owner condition matches on who owns the alert - whom its
 * criteria names, the network device's owners and whom its owner rules add
 * - so the chain says which owner made the rule match, as it names a label
 * rule whose label did. A rule the reader can't see is said as such.
 */
export const OWNER_MATCH_WORDS: Readonly<{
  sentence: string;
  hiddenRuleSentence: string;
}> = {
  sentence: translationKey("It's owned by {{owners}}, so {{rule}} matches."),
  hiddenRuleSentence: translationKey(
    "It's owned by {{owners}}, so a rule you can't see matches.",
  ),
};

// One owner match's sentence, the rule named as the event's rules name it.
export function getOwnerMatchSentence(data: {
  match: WhoIsToldOwnerMatch;
  rules: ReadonlyArray<WhoIsToldRule>;
  translator: Translator;
}): string {
  const ruleName: string =
    data.rules.find((rule: WhoIsToldRule): boolean => {
      return rule.id === data.match.ruleId;
    })?.name || "";
  const owners: TemplateValue = composedValue(
    (sentence: Translator): string => {
      return formatList(data.match.ownerNames, sentence);
    },
  );

  return ruleName
    ? data.translator.translateTemplate(
        OWNER_MATCH_WORDS.sentence,
        { owners: owners, rule: ruleName },
        { setsValuesApart: true },
      )
    : data.translator.translateTemplate(
        OWNER_MATCH_WORDS.hiddenRuleSentence,
        { owners: owners },
        { setsValuesApart: true },
      );
}

/*
 * A status page that shows the monitor through a monitor group (#7214): the
 * group is what to edit, so it is named. A group the reader can't see keeps
 * its place without its name.
 */
export const STATUS_PAGE_THROUGH_GROUPS: string = translationKey(
  "{{page}} (through {{groups}})",
);
export const HIDDEN_MONITOR_GROUP: string = translationKey(
  "a group you can't see",
);

/*
 * OWNERS NO CREATED EMAIL REACHES (#7572): why each is not emailed, and
 * where they are named - the criteria, the network device the monitor
 * watches, or an owner rule. A person who is not a member of the project
 * is never named, nor a team of another project; a team of the project is.
 */
export const OWNER_NOT_EMAILED_WORDS: Readonly<{
  problems: Readonly<Record<WhoIsToldOwnerProblem, string>>;
  addedBy: Readonly<{
    criteria: string;
    networkDevice: string;
    ownerRule: string;
    hiddenOwnerRule: string;
  }>;
  listLabel: string;
}> = {
  problems: {
    [WhoIsToldOwnerProblem.NotInProject]: translationKey(
      "Someone named as an owner isn't a member of this project, so isn't emailed.",
    ),
    [WhoIsToldOwnerProblem.TeamHasNobodyInProject]: translationKey(
      "Team {{team}} has nobody in it who is a member of this project, so nobody is emailed through it.",
    ),
    [WhoIsToldOwnerProblem.TeamOfAnotherProject]: translationKey(
      "A team of another project is named as an owner, so nobody is emailed through it.",
    ),
  },
  addedBy: {
    criteria: translationKey("Named in the criteria."),
    networkDevice: translationKey(
      "An owner of the network device this monitor watches.",
    ),
    ownerRule: translationKey("Added by owner rule {{rule}}."),
    hiddenOwnerRule: translationKey("Added by an owner rule you can't see."),
  },
  listLabel: translationKey("Owners who aren't emailed"),
};

// "Ana Lopez", or "Someone" when the name is not known.
function nameOr(name: string | undefined, translator: Translator): string {
  return name || translator.translateText("Someone") || "Someone";
}

// A channel's name in the reader's words.
export function getChannelName(
  channel: OnCallPageChannel,
  translator: Translator,
): string {
  const name: string = CHANNEL_NAMES[channel] || channel;
  return translator.translateText(name) || name;
}

// One break, as one sentence in the reader's language.
export function getBreakSentence(
  brk: WhoIsToldBreak,
  translator: Translator,
): string {
  switch (brk.kind) {
    case WhoIsToldBreakKind.NothingHappens:
      return translator.translateTemplate(BREAK_SENTENCES.nothingHappens);
    case WhoIsToldBreakKind.NobodyPaged:
      if (brk.fix === WhoIsToldFix.OnCallGuidedSetup) {
        return translator.translateTemplate(
          BREAK_SENTENCES.nobodyPagedNoPolicy,
        );
      }

      return translator.translateTemplate(
        brk.recordKind === OnCallTestPageRecordKind.Alert
          ? BREAK_SENTENCES.nobodyPagedAlerts
          : BREAK_SENTENCES.nobodyPagedIncidents,
      );
    case WhoIsToldBreakKind.OnlyIncidentsHaveRules:
      return translator.translateTemplate(
        BREAK_SENTENCES.onlyIncidentsHaveRules,
      );
    case WhoIsToldBreakKind.PolicyHasNoLevels:
      return brk.policyName
        ? translator.translateTemplate(BREAK_SENTENCES.policyHasNoLevels, {
            policy: brk.policyName,
          })
        : translator.translateTemplate(BREAK_SENTENCES.hiddenPolicyHasNoLevels);
    case WhoIsToldBreakKind.PolicyReachesNobody:
      return brk.policyName
        ? translator.translateTemplate(BREAK_SENTENCES.policyReachesNobody, {
            policy: brk.policyName,
          })
        : translator.translateTemplate(
            BREAK_SENTENCES.hiddenPolicyReachesNobody,
          );
    case WhoIsToldBreakKind.PersonUnreachable:
      return translator.translateTemplate(
        BREAK_SENTENCES.personProblems[
          brk.problem || WhoIsToldPersonProblem.NoVerifiedMethod
        ],
        { name: nameOr(brk.userName, translator) },
      );
    case WhoIsToldBreakKind.ChannelOff:
      return translator.translateTemplate(BREAK_SENTENCES.channelOff, {
        channel: composedValue((sentence: Translator): string => {
          return getChannelName(
            (brk.channel as OnCallPageChannel) || OnCallPageChannel.SMS,
            sentence,
          );
        }),
      });
    case WhoIsToldBreakKind.NoBalance:
      return translator.translateTemplate(BREAK_SENTENCES.noBalance);
    case WhoIsToldBreakKind.ServerCannotSend:
      return translator.translateTemplate(
        BREAK_SENTENCES.serverCannotSend[
          (brk.channel as WhoIsToldServerChannel) ||
            WhoIsToldServerChannel.Email
        ],
      );
  }

  return brk.message;
}

// Where a break is put right, and the link's words.
export interface WhoIsToldFixLink {
  route: Route;
  text: string;
}

const FIX_WORDS: Readonly<Record<WhoIsToldFix, string>> = {
  [WhoIsToldFix.MonitorCriteria]: translationKey("Open Criteria"),
  [WhoIsToldFix.IncidentOnCallRules]: translationKey("Set Up Paging"),
  [WhoIsToldFix.AlertOnCallRules]: translationKey("Set Up Paging"),
  [WhoIsToldFix.OnCallGuidedSetup]: translationKey("Set Up Paging"),
  [WhoIsToldFix.OnCallPolicy]: translationKey("Open On-Call Policy"),
  [WhoIsToldFix.OnCallReadiness]: translationKey("Open Readiness"),
  [WhoIsToldFix.ProjectNotificationSettings]: translationKey(
    "Open Notification Channels",
  ),
  [WhoIsToldFix.ProjectBilling]: translationKey("Open Billing"),
  [WhoIsToldFix.ServerSettings]: translationKey("Open Admin Dashboard"),
};

const FIX_PAGES: Readonly<Partial<Record<WhoIsToldFix, PageMap>>> = {
  [WhoIsToldFix.MonitorCriteria]: PageMap.MONITOR_VIEW_CRITERIA,
  [WhoIsToldFix.IncidentOnCallRules]: PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
  [WhoIsToldFix.AlertOnCallRules]: PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
  /*
   * No policy yet: the on-call guided setup makes the project's first, with
   * the rules that page it for every new incident and alert (#7369).
   */
  [WhoIsToldFix.OnCallGuidedSetup]: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
  [WhoIsToldFix.OnCallPolicy]: PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
  [WhoIsToldFix.OnCallReadiness]: PageMap.ON_CALL_DUTY_READINESS,
  [WhoIsToldFix.ProjectNotificationSettings]:
    PageMap.SETTINGS_NOTIFICATION_SETTINGS,
  [WhoIsToldFix.ProjectBilling]: PageMap.SETTINGS_BILLING,
};

/*
 * The page of the Dashboard that puts a break right. The server's settings
 * are the Admin Dashboard's (the card links them for the server's admins
 * only); a policy the caller may not read gets the policies list. A monitor
 * not created yet (monitorId null, #7055) has no Criteria page: its
 * criteria are the form the card is on.
 */
export function getFixLink(data: {
  brk: WhoIsToldBreak;
  monitorId: ObjectID | null;
  translator: Translator;
}): WhoIsToldFixLink | null {
  let pageMap: PageMap | undefined = FIX_PAGES[data.brk.fix];

  if (!pageMap) {
    return null;
  }

  let modelId: ObjectID | undefined = undefined;

  if (data.brk.fix === WhoIsToldFix.MonitorCriteria) {
    if (!data.monitorId) {
      return null;
    }

    modelId = data.monitorId;
  }

  if (data.brk.fix === WhoIsToldFix.OnCallPolicy) {
    if (data.brk.policyId && data.brk.policyName) {
      modelId = new ObjectID(data.brk.policyId);
    } else {
      pageMap = PageMap.ON_CALL_DUTY_POLICIES;
    }
  }

  const route: Route = RouteMap[pageMap] as Route;
  const text: string = FIX_WORDS[data.brk.fix];

  return {
    route: modelId
      ? RouteUtil.populateRouteParams(route, { modelId: modelId })
      : RouteUtil.populateRouteParams(route),
    text: data.translator.translateText(text) || text,
  };
}

export const ADMIN_DASHBOARD_FIX_WORDS: string =
  FIX_WORDS[WhoIsToldFix.ServerSettings];

// The words of the link that puts a fix's break right, in English (the docs name them).
export function getFixWords(fix: WhoIsToldFix): string {
  return FIX_WORDS[fix];
}

// "Ana Lopez and Ben Ito", in the sentence's language.
function nameList(
  names: ReadonlyArray<string>,
  translator: Translator,
): string {
  return formatNameList(names, "and", translator);
}

function getOwnersSentence(
  owners: WhoIsToldOwners,
  translator: Translator,
): string {
  const names: Array<string> = [...owners.userNames, ...owners.teamNames].slice(
    0,
    WHO_IS_TOLD_MAX_NAMED_PEOPLE,
  );
  const more: number =
    owners.userNames.length + owners.teamNames.length - names.length;
  const sentences: { named: string; unnamed: string } =
    OWNER_SENTENCES[owners.source];

  if (names.length === 0) {
    return translator.translateTemplate(sentences.unnamed);
  }

  return translator.translateTemplate(sentences.named, {
    names: composedValue((sentence: Translator): string => {
      return more > 0
        ? nameList(
            [
              ...names,
              sentence.translatePlural(
                { one: "{{count}} more", other: "{{count}} more" },
                more,
              ),
            ],
            sentence,
          )
        : nameList(names, sentence);
    }),
  });
}

/*
 * The owners the page reaches first, as one sentence (#8860): "Ana Lopez
 * is paged, so isn't emailed as an owner too." - the first few by name,
 * the rest counted. Null when the page reaches no owner first, or the
 * server does not say.
 */
export function getPagedOwnersSentence(
  owners: WhoIsToldOwners,
  translator: Translator,
): string | null {
  const paged: Array<string> = (owners.pagedOwners || []).map(
    (owner: { name: string }): string => {
      return nameOr(owner.name, translator);
    },
  );

  if (paged.length === 0) {
    return null;
  }

  const names: Array<string> = paged.slice(0, WHO_IS_TOLD_MAX_NAMED_PEOPLE);
  const more: number = paged.length - names.length;

  return translator.translatePlural(
    owners.source === WhoIsToldOwnersSource.ProjectOwners
      ? PAGED_OWNERS_SENTENCES.projectOwners
      : PAGED_OWNERS_SENTENCES.owners,
    paged.length,
    {
      names: composedValue((sentence: Translator): string => {
        return more > 0
          ? nameList(
              [
                ...names,
                sentence.translatePlural(
                  { one: "{{count}} more", other: "{{count}} more" },
                  more,
                ),
              ],
              sentence,
            )
          : nameList(names, sentence);
      }),
    },
  );
}

/*
 * Who what opens emails, and who it does not as the page reaches them
 * first (#8860): the owners' sentence - left out when the page reaches
 * every owner, as the email then reaches nobody - then the paged one's.
 */
export function getOwnersSentences(
  owners: WhoIsToldOwners,
  translator: Translator,
): Array<string> {
  const paged: string | null = getPagedOwnersSentence(owners, translator);
  const isAnybodyStillEmailed: boolean =
    owners.userNames.length + owners.teamNames.length > 0;

  if (!paged) {
    return [getOwnersSentence(owners, translator)];
  }

  return isAnybodyStillEmailed
    ? [getOwnersSentence(owners, translator), paged]
    : [paged];
}

// The policies' names a sentence says, the readable ones.
function policyNames(policies: ReadonlyArray<WhoIsToldPolicy>): Array<string> {
  return policies
    .filter((policy: WhoIsToldPolicy): boolean => {
      return !policy.isHidden && Boolean(policy.name);
    })
    .map((policy: WhoIsToldPolicy): string => {
      return policy.name;
    });
}

function getPagingSentence(
  event: WhoIsToldEvent,
  translator: Translator,
): string {
  const state: WhoIsToldPagingState = getWhoIsToldPagingState(event);

  if (state === WhoIsToldPagingState.Nobody) {
    return translator.translateTemplate(NOBODY_PAGED_SENTENCE);
  }

  if (state === WhoIsToldPagingState.Hidden) {
    return translator.translateTemplate(PAGING_HIDDEN_SENTENCE);
  }

  if (state === WhoIsToldPagingState.Unreachable) {
    return translator.translateTemplate(PAGING_UNREACHABLE_SENTENCE);
  }

  const people: Array<WhoIsToldPerson> = getReachablePeople(event.policies);
  const names: Array<string> = policyNames(event.policies);
  const policies: ReturnType<typeof composedValue> = composedValue(
    (sentence: Translator): string => {
      return nameList(names, sentence);
    },
  );

  if (people.length > WHO_IS_TOLD_MAX_NAMED_PEOPLE) {
    return translator.translatePlural(PAGES_MANY_SENTENCE, people.length, {
      policies: policies,
    });
  }

  return translator.translateTemplate(PAGES_PEOPLE_SENTENCE, {
    people: composedValue((sentence: Translator): string => {
      return nameList(
        people.map((person: WhoIsToldPerson): string => {
          return nameOr(person.name, sentence);
        }),
        sentence,
      );
    }),
    policies: policies,
  });
}

/*
 * The sentence of the incident an alert incident rule declares from an
 * alert (#7216): the rule, how long the alert must stay open first, and
 * the incident's severity.
 */
export function getDeclaresSentence(
  declaration: WhoIsToldDeclaration,
  translator: Translator,
): string {
  const severity: TemplateValue = getWhoIsToldSeverityValue(
    declaration.incident,
  );
  const isRuleHidden: boolean = !declaration.rule.name;

  if (declaration.waitInMinutes > 0) {
    return translator.translatePlural(
      isRuleHidden
        ? DECLARES_WORDS.afterWaitHiddenRule
        : DECLARES_WORDS.afterWait,
      declaration.waitInMinutes,
      {
        severity: severity,
        ...(isRuleHidden ? {} : { rule: declaration.rule.name }),
      },
      { setsValuesApart: true },
    );
  }

  return translator.translateTemplate(
    isRuleHidden ? DECLARES_WORDS.nowHiddenRule : DECLARES_WORDS.now,
    {
      severity: severity,
      ...(isRuleHidden ? {} : { rule: declaration.rule.name }),
    },
    { setsValuesApart: true },
  );
}

/*
 * Who what opens tells, after what opens is said: its owners and who it
 * pages - or, for a private record the reader can't see, only that it is
 * private (#7213). An alert an incident rule turns into an incident says
 * that next, and who the incident pages (#7216); its own "Nobody is
 * paged." is left out then, as nothing stops the incident's page.
 */
function getToldSentences(
  event: WhoIsToldEvent,
  translator: Translator,
): Array<string> {
  if (event.isHidden) {
    return [translator.translateTemplate(PRIVATE_WORDS.hiddenSentence)];
  }

  const sentences: Array<string> = getOwnersSentences(event.owners, translator);

  if (!event.declares) {
    return [...sentences, getPagingSentence(event, translator)];
  }

  if (getWhoIsToldPagingState(event) !== WhoIsToldPagingState.Nobody) {
    sentences.push(getPagingSentence(event, translator));
  }

  const incident: WhoIsToldEvent = event.declares.incident;

  sentences.push(getDeclaresSentence(event.declares, translator));
  sentences.push(
    incident.isHidden
      ? translator.translateTemplate(PRIVATE_WORDS.hiddenSentence)
      : getPagingSentence(incident, translator),
  );

  return sentences;
}

/*
 * Who is told, without what opens (#7055): the owners and paging sentences
 * of what the card's first words describe, for a summary that says what
 * opens in a row of its own (the website guided setup's). Empty when no
 * criteria opens anything.
 */
export function getWhoIsToldToldSentences(
  result: Pick<WhoIsToldResult, "criteria">,
  translator: Translator,
): Array<string> {
  const headline: WhoIsToldHeadline | null = getWhoIsToldHeadline(result);

  if (!headline || !headline.event) {
    return [];
  }

  return getToldSentences(headline.event, translator);
}

/*
 * Why a private record is private, and who can see it, for the chain's
 * Private row (#7213): the privacy rules by name - one the reader can't
 * see as such - or the criteria. A record the reader can't see says only
 * that they can't see who it tells.
 */
export function getPrivateSentences(
  event: WhoIsToldEvent,
  translator: Translator,
): Array<string> {
  const rules: Array<WhoIsToldRule> = event.privacyRules || [];
  const sentences: Array<string> = [];

  if (rules.length > 0) {
    sentences.push(
      translator.translatePlural(PRIVATE_WORDS.byRules, rules.length, {
        rules: composedValue((sentence: Translator): string => {
          return nameList(
            rules.map((rule: WhoIsToldRule): string => {
              return (
                rule.name ||
                sentence.translateText("A rule you can't see") ||
                "A rule you can't see"
              );
            }),
            sentence,
          );
        }),
      }),
    );
  } else if (!event.isHidden) {
    sentences.push(translator.translateTemplate(PRIVATE_WORDS.byCriteria));
  }

  sentences.push(
    translator.translateTemplate(
      event.isHidden ? PRIVATE_WORDS.hiddenSentence : PRIVATE_WORDS.whoCanSee,
    ),
  );

  return sentences;
}

/*
 * A status page as the chain names it: "Payments Status (through
 * Checkout)" when it shows the monitor through a monitor group (#7214), a
 * group the reader can't see as such; a page they can't see as such.
 */
export function getStatusPageText(
  page: WhoIsToldStatusPage,
  translator: Translator,
): string {
  const name: string =
    page.name ||
    translator.translateText("A status page you can't see") ||
    "A status page you can't see";
  const groups: Array<WhoIsToldMonitorGroup> = page.groups || [];

  if (groups.length === 0) {
    return name;
  }

  return translator.translateTemplate(
    STATUS_PAGE_THROUGH_GROUPS,
    {
      page: name,
      groups: composedValue((sentence: Translator): string => {
        return formatList(
          groups.map((group: WhoIsToldMonitorGroup): string => {
            return (
              group.name ||
              sentence.translateText(HIDDEN_MONITOR_GROUP) ||
              HIDDEN_MONITOR_GROUP
            );
          }),
          sentence,
        );
      }),
    },
    { setsValuesApart: true },
  );
}

// An owner no Created email reaches, with what the chain says it of (#7572).
export interface WhoIsToldOwnerNotEmailed {
  owner: WhoIsToldOwnerNotReached;
  // Of the incident or the alert that names them: whose owner rules to open.
  recordKind: OnCallTestPageRecordKind;
}

/*
 * Every owner no Created email reaches, of everything the chain opens that
 * the reader may see - each once, though two criteria name them.
 */
export function getOwnersNotEmailed(
  result: Pick<WhoIsToldResult, "criteria">,
): Array<WhoIsToldOwnerNotEmailed> {
  const items: Array<WhoIsToldOwnerNotEmailed> = [];
  const seen: Set<string> = new Set<string>();

  const add: (event: WhoIsToldEvent) => void = (
    event: WhoIsToldEvent,
  ): void => {
    if (event.isHidden) {
      return;
    }

    for (const owner of event.owners.notReached || []) {
      const key: string = [
        owner.kind,
        owner.id,
        owner.problem,
        owner.addedBy,
        owner.rule?.id || "",
        owner.addedBy === WhoIsToldOwnerAddedBy.OwnerRule ? event.kind : "",
      ].join("|");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push({ owner: owner, recordKind: event.kind });
    }
  };

  for (const item of result.criteria) {
    for (const event of item.events) {
      add(event);

      if (event.declares) {
        add(event.declares.incident);
      }
    }
  }

  return items;
}

// Why an owner isn't emailed, then where they are named: two sentences.
export function getOwnerNotEmailedSentences(
  item: WhoIsToldOwnerNotEmailed,
  translator: Translator,
): Array<string> {
  const owner: WhoIsToldOwnerNotReached = item.owner;
  const why: string =
    owner.problem === WhoIsToldOwnerProblem.TeamHasNobodyInProject
      ? translator.translateTemplate(
          OWNER_NOT_EMAILED_WORDS.problems[owner.problem],
          { team: owner.name || "" },
          { setsValuesApart: true },
        )
      : translator.translateTemplate(
          OWNER_NOT_EMAILED_WORDS.problems[owner.problem],
        );

  let where: string;

  switch (owner.addedBy) {
    case WhoIsToldOwnerAddedBy.Criteria:
      where = translator.translateTemplate(
        OWNER_NOT_EMAILED_WORDS.addedBy.criteria,
      );
      break;
    case WhoIsToldOwnerAddedBy.NetworkDevice:
      where = translator.translateTemplate(
        OWNER_NOT_EMAILED_WORDS.addedBy.networkDevice,
      );
      break;
    default:
      where = owner.rule?.name
        ? translator.translateTemplate(
            OWNER_NOT_EMAILED_WORDS.addedBy.ownerRule,
            { rule: owner.rule.name },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            OWNER_NOT_EMAILED_WORDS.addedBy.hiddenOwnerRule,
          );
  }

  return [why, where];
}

// The words of each place an owner who isn't emailed is put right.
export const OWNER_FIX_WORDS: Readonly<{
  criteria: string;
  networkDevice: string;
  ownerRules: string;
  team: string;
}> = {
  criteria: FIX_WORDS[WhoIsToldFix.MonitorCriteria],
  networkDevice: translationKey("Open Network Device"),
  ownerRules: translationKey("Open Owner Rules"),
  team: translationKey("Open Team"),
};

// Where an owner who isn't emailed is put right, as the analytics name it.
export enum WhoIsToldOwnerFix {
  MonitorCriteria = "MonitorCriteria",
  NetworkDevice = "NetworkDevice",
  OwnerRules = "OwnerRules",
  Team = "Team",
}

export interface WhoIsToldOwnerFixLink extends WhoIsToldFixLink {
  fix: WhoIsToldOwnerFix;
}

/*
 * The page that puts an owner who isn't emailed right: a team of the
 * project with nobody in it, its members; else where they are named - the
 * monitor's criteria (none for a monitor not created yet: the criteria are
 * on the page), the network device's owners, or the owner rules of the
 * incident or alert. Null when there is no such page to open.
 */
export function getOwnerNotEmailedFixLink(data: {
  item: WhoIsToldOwnerNotEmailed;
  monitorId: ObjectID | null;
  translator: Translator;
}): WhoIsToldOwnerFixLink | null {
  const owner: WhoIsToldOwnerNotReached = data.item.owner;
  const link: (
    fix: WhoIsToldOwnerFix,
    pageMap: PageMap,
    text: string,
    modelId?: ObjectID | undefined,
  ) => WhoIsToldOwnerFixLink = (
    fix: WhoIsToldOwnerFix,
    pageMap: PageMap,
    text: string,
    modelId?: ObjectID | undefined,
  ): WhoIsToldOwnerFixLink => {
    const route: Route = RouteMap[pageMap] as Route;

    return {
      fix: fix,
      route: modelId
        ? RouteUtil.populateRouteParams(route, { modelId: modelId })
        : RouteUtil.populateRouteParams(route),
      text: data.translator.translateText(text) || text,
    };
  };

  if (
    owner.problem === WhoIsToldOwnerProblem.TeamHasNobodyInProject &&
    ObjectID.isValidUUID(owner.id)
  ) {
    return link(
      WhoIsToldOwnerFix.Team,
      PageMap.TEAM_VIEW_MEMBERS,
      OWNER_FIX_WORDS.team,
      new ObjectID(owner.id),
    );
  }

  switch (owner.addedBy) {
    case WhoIsToldOwnerAddedBy.Criteria:
      return data.monitorId
        ? link(
            WhoIsToldOwnerFix.MonitorCriteria,
            PageMap.MONITOR_VIEW_CRITERIA,
            OWNER_FIX_WORDS.criteria,
            data.monitorId,
          )
        : null;
    case WhoIsToldOwnerAddedBy.NetworkDevice:
      return owner.networkDeviceId &&
        ObjectID.isValidUUID(owner.networkDeviceId)
        ? link(
            WhoIsToldOwnerFix.NetworkDevice,
            PageMap.NETWORK_DEVICE_VIEW_OWNERS,
            OWNER_FIX_WORDS.networkDevice,
            new ObjectID(owner.networkDeviceId),
          )
        : null;
    case WhoIsToldOwnerAddedBy.OwnerRule:
      return link(
        WhoIsToldOwnerFix.OwnerRules,
        data.item.recordKind === OnCallTestPageRecordKind.Alert
          ? PageMap.ALERTS_SETTINGS_OWNER_RULES
          : PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
        OWNER_FIX_WORDS.ownerRules,
      );
  }

  return null;
}

/*
 * THE CARD'S FIRST WORDS: what happens when the monitor goes down, and who
 * is told, in two or three sentences. About the first criteria that opens
 * an incident or an alert (getWhoIsToldHeadline); with none, about the
 * first that changes the status. Empty when no criteria does anything -
 * the break says so.
 */
export function getWhoIsToldSentences(
  result: Pick<WhoIsToldResult, "criteria">,
  translator: Translator,
): Array<string> {
  const headline: WhoIsToldHeadline | null = getWhoIsToldHeadline(result);

  if (!headline || !headline.event) {
    const statusOnly: WhoIsToldResult["criteria"][number] | undefined =
      result.criteria.find(
        (item: WhoIsToldResult["criteria"][number]): boolean => {
          return Boolean(item.statusName);
        },
      );

    if (!statusOnly || !statusOnly.statusName) {
      return [];
    }

    const sentences: Array<string> = [
      translator.translateTemplate(
        STATUS_ONLY_SENTENCE,
        { status: getWhoIsToldStatusValue(statusOnly.statusName) },
        { setsValuesApart: true },
      ),
    ];

    if (statusOnly.statusOwners) {
      sentences.push(getOwnersSentence(statusOnly.statusOwners, translator));
    }

    return sentences;
  }

  const event: WhoIsToldEvent = headline.event;
  const isAlert: boolean = event.kind === OnCallTestPageRecordKind.Alert;
  const status: string | undefined = headline.criteria.statusName;

  let opens: string = isAlert
    ? OPENS_SENTENCES.alert
    : OPENS_SENTENCES.incident;

  if (status) {
    opens = isAlert
      ? OPENS_SENTENCES.statusAndAlert
      : OPENS_SENTENCES.statusAndIncident;
  }

  const sentences: Array<string> = [
    translator.translateTemplate(
      opens,
      {
        severity: getWhoIsToldSeverityValue(event),
        ...(status ? { status: getWhoIsToldStatusValue(status) } : {}),
      },
      // A Latin name stays in order on a right-to-left page.
      { setsValuesApart: true },
    ),
    ...getToldSentences(event, translator),
  ];

  const more: number = result.criteria.filter(
    (item: WhoIsToldResult["criteria"][number]): boolean => {
      return item.events.length > 0 && item.id !== headline.criteria.id;
    },
  ).length;

  if (more > 0) {
    sentences.push(translator.translatePlural(MORE_CRITERIA_SENTENCE, more));
  }

  return sentences;
}

/*
 * The card's first words as one paragraph, run together the way the
 * reader's script writes them: a space after each sentence, but none after
 * a full-width stop (Japanese, Chinese). "" when no criteria does anything.
 */
export function getWhoIsToldSummary(
  result: Pick<WhoIsToldResult, "criteria">,
  translator: Translator,
): string {
  return joinSentences(getWhoIsToldSentences(result, translator));
}
