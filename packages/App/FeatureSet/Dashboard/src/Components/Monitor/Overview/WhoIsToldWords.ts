import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import { CHANNEL_NAMES } from "../../OnCallTestPage/OnCallTestPageWords";
import Route from "Common/Types/API/Route";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldHeadline,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPagingState,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
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
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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

// What happens first: the status it sets, and what it opens.
const OPENS_SENTENCES: Readonly<
  Record<"statusAndIncident" | "statusAndAlert" | "incident" | "alert", string>
> = {
  statusAndIncident: translationKey(
    "OneUptime marks it {{status}} and opens a {{severity}} incident.",
  ),
  statusAndAlert: translationKey(
    "OneUptime marks it {{status}} and opens a {{severity}} alert.",
  ),
  incident: translationKey("OneUptime opens a {{severity}} incident."),
  alert: translationKey("OneUptime opens a {{severity}} alert."),
};

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
    named: translationKey("It emails the project's owners ({{names}})."),
    unnamed: translationKey("It emails the project's owners."),
  },
  [WhoIsToldOwnersSource.MonitorOwners]: {
    named: translationKey("It emails the monitor's owners ({{names}})."),
    unnamed: translationKey("It emails the monitor's owners."),
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
  [WhoIsToldFix.OnCallPolicy]: PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
  [WhoIsToldFix.OnCallReadiness]: PageMap.ON_CALL_DUTY_READINESS,
  [WhoIsToldFix.ProjectNotificationSettings]:
    PageMap.SETTINGS_NOTIFICATION_SETTINGS,
  [WhoIsToldFix.ProjectBilling]: PageMap.SETTINGS_BILLING,
};

/*
 * The page of the Dashboard that puts a break right. The server's settings
 * are the Admin Dashboard's (the card links them for the server's admins
 * only); a policy the caller may not read gets the policies list.
 */
export function getFixLink(data: {
  brk: WhoIsToldBreak;
  monitorId: ObjectID;
  translator: Translator;
}): WhoIsToldFixLink | null {
  let pageMap: PageMap | undefined = FIX_PAGES[data.brk.fix];

  if (!pageMap) {
    return null;
  }

  let modelId: ObjectID | undefined = undefined;

  if (data.brk.fix === WhoIsToldFix.MonitorCriteria) {
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
      translator.translateTemplate(STATUS_ONLY_SENTENCE, {
        status: statusOnly.statusName,
      }),
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
    translator.translateTemplate(opens, {
      severity: event.severityName,
      ...(status ? { status: status } : {}),
    }),
    getOwnersSentence(event.owners, translator),
    getPagingSentence(event, translator),
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
