import {
  OnCallPageChannel,
  getOnCallPageChannelName,
} from "../OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageNotPaged,
  OnCallTestPageReachedThrough,
  OnCallTestPageRecordKind,
} from "../OnCallDutyPolicy/OnCallTestPage";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN, AND WHERE THE CHAIN BREAKS (#6810).
 *
 * "What happens when this goes down?" is the first question anybody asks of
 * a monitor, and its answer is spread over six kinds of record on five
 * pages: the monitor's criteria (which status, which incident or alert, of
 * which severity, which owners and policies), the incident and alert
 * on-call rules, each policy's escalation levels, the schedules, each
 * person's own on-call rules and verified methods, and the project's and
 * the server's channels. Nobody could check their own setup, and they found
 * the gap during an outage.
 *
 * The resolver (Server/Services/WhoIsToldService) reads them all for one
 * monitor, without sending or changing anything, and answers with this
 * shape: for every criteria that changes the monitor's status or opens an
 * incident or an alert, what it does, who it emails as owners (with the
 * owner rules that add them), which on-call rules match what it opens (the
 * rule engines' own matching, on the title it would get), and for each
 * policy those rules or the criteria run, who its first level reaches right
 * now and by what. With the breaks: each place the chain
 * stops short of a person, in a sentence that says what to change, and
 * which page changes it.
 *
 * The monitor's overview draws it as "When this goes down"; Setup health
 * (#6812), the Welcome checklist's "who is told" step (#6803) and an invited
 * member's card (#6807) read the same answer. A test page's result
 * (OnCallTestPage) is the same chain as it happened.
 *
 * Pure, with no server or browser APIs: the server builds the chain, and
 * the breaks and the sentences are worked out here, where a test can hand
 * them any chain.
 */

/*
 * Who an incident or alert emails as its owners: everyone it is given as an
 * owner - whom its criteria names, the owners of the network device its
 * monitor watches, and whom the project's owner rules add - or, when that is
 * nobody, the project's owners.
 */
export enum WhoIsToldOwnersSource {
  /*
   * The criteria names owners for what it opens, or the network device the
   * monitor watches has owners - and owner rules may add more.
   */
  Named = "Named",
  // Nobody is named: only the project's owner rules add owners.
  OwnerRules = "OwnerRules",
  // Nobody is named or added by a rule: the project's owners are emailed instead.
  ProjectOwners = "ProjectOwners",
  // Status only: the monitor's own owners are emailed of the change.
  MonitorOwners = "MonitorOwners",
}

export interface WhoIsToldOwners {
  source: WhoIsToldOwnersSource;
  // The people, by name.
  userNames: Array<string>;
  // The teams, by name: each of their members is emailed.
  teamNames: Array<string>;
}

// Why a person a policy reaches cannot be told by a page of this severity.
export enum WhoIsToldPersonProblem {
  // They opted out of pages of this severity.
  OptedOut = "OptedOut",
  // No rule of theirs covers the severity, and the project does not fall back.
  NoRuleNoFallback = "NoRuleNoFallback",
  // No method a page would use is verified.
  NoVerifiedMethod = "NoVerifiedMethod",
  // Every method a page would use is switched off in the project.
  ChannelsOff = "ChannelsOff",
}

// One person a policy's first level reaches right now.
export interface WhoIsToldPerson {
  userId: string;
  name: string;
  // Why them: "Team Platform", "Schedule Primary", "Covering for Ana".
  reachedThrough?: string | undefined;
  /*
   * The same, as a code with the name it names (#7261), for the card to
   * word in the reader's language as the test page's dialog does
   * (OnCallTestPageWords). reachedThrough is its English, for a Dashboard
   * that does not know the code.
   */
  reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
  // The channels a page of this severity reaches them by, in order.
  channels: Array<OnCallPageChannel>;
  /*
   * A page falls back to every verified method of theirs, as no rule of
   * theirs covers the severity.
   */
  isFallback: boolean;
  isReachable: boolean;
  problem?: WhoIsToldPersonProblem | undefined;
}

// One on-call policy what opens runs.
export interface WhoIsToldPolicy {
  id: string;
  // Empty while the caller may not read the policy.
  name: string;
  /*
   * The caller may not read this policy: they are told paging is set up,
   * and nothing about who.
   */
  isHidden: boolean;
  // The criteria names it for what it opens.
  isNamedByCriteria: boolean;
  // The ids of the on-call rules that run it.
  ruleIds: Array<string>;
  // How many escalation levels it has.
  levelCount: number;
  // Who its first level reaches right now.
  people: Array<WhoIsToldPerson>;
  // Targets of its first level that reach nobody, and why (in English).
  notPaged: Array<string>;
  /*
   * The same, one code each with the names and the date it names (#7261),
   * in notPaged's order: what the card words in the reader's language.
   * Left out by a server from before them, whose English then shows.
   */
  notPagedCodes?: Array<OnCallTestPageNotPaged> | undefined;
}

// An on-call or owner rule that matches what opens.
export interface WhoIsToldRule {
  id: string;
  // Empty while the caller may not read the rule.
  name: string;
}

// A status page an incident from the monitor shows on.
export interface WhoIsToldStatusPage {
  id: string;
  // Empty while the caller may not read the status page.
  name: string;
}

// One incident or alert a criteria opens.
export interface WhoIsToldEvent {
  kind: OnCallTestPageRecordKind;
  /*
   * Its title: the criteria's template with what is known of the monitor
   * before a check put in ({{monitorName}} and the like). A value only a
   * check reports is left as written. The rules are matched on it.
   */
  title: string;
  severityName: string;
  owners: WhoIsToldOwners;
  // The owner rules that add owners to it, in the order they are evaluated.
  ownerRules: Array<WhoIsToldRule>;
  // The on-call rules that match it and page a policy.
  rules: Array<WhoIsToldRule>;
  policies: Array<WhoIsToldPolicy>;
  /*
   * The status pages its incident shows on, where subscribers are told:
   * each page that lists the monitor, directly or through a monitor group,
   * shows incidents and is not archived - and not one that shows only the
   * incidents limited to it, which an incident a monitor opens never is.
   * Empty for an alert, which is never public, and for an incident the
   * criteria keeps off status pages or makes private.
   */
  statusPages: Array<WhoIsToldStatusPage>;
}

// One criteria of the monitor, in the order they are checked.
export interface WhoIsToldCriteria {
  id: string;
  name: string;
  // The status it sets, when it changes the monitor's status.
  statusName?: string | undefined;
  statusColor?: string | undefined;
  // Who is emailed of the status change.
  statusOwners?: WhoIsToldOwners | undefined;
  events: Array<WhoIsToldEvent>;
}

// The channels everything above goes out by.
export interface WhoIsToldChannels {
  // OneUptime Cloud: SMS and calls are paid from the project's balance.
  isBillingEnabled: boolean;
  isSmsOn: boolean;
  isCallOn: boolean;
  isWhatsAppOn: boolean;
  isTelegramOn: boolean;
  // The project sends SMS and calls through its own Twilio account.
  hasOwnTwilioForSms: boolean;
  hasOwnTwilioForCalls: boolean;
  // OneUptime Cloud: the balance SMS and calls are paid from, in US cents.
  balanceInUSDCents?: number | undefined;
  isAutoRechargeOn?: boolean | undefined;
  /*
   * Self-hosted: whether the server can send each kind. Null where it is
   * not known or not asked (OneUptime Cloud).
   */
  serverCanSendEmail: boolean | null;
  serverCanSendSms: boolean | null;
  serverCanCall: boolean | null;
}

// A place the chain stops short of a person.
export enum WhoIsToldBreakKind {
  // No criteria opens an incident or an alert, or changes the status.
  NothingHappens = "NothingHappens",
  // What a criteria opens runs no policy: no rule matches, none is named.
  NobodyPaged = "NobodyPaged",
  // An alert runs no policy, while incidents have on-call rules.
  OnlyIncidentsHaveRules = "OnlyIncidentsHaveRules",
  // A policy has no escalation levels.
  PolicyHasNoLevels = "PolicyHasNoLevels",
  // A policy's first level reaches nobody right now.
  PolicyReachesNobody = "PolicyReachesNobody",
  // A person the first level reaches can't be told.
  PersonUnreachable = "PersonUnreachable",
  // SMS or calls are switched off in the project while pages use them.
  ChannelOff = "ChannelOff",
  // OneUptime Cloud: nothing left to pay for SMS and calls.
  NoBalance = "NoBalance",
  // Self-hosted: the server can't send email, SMS or calls yet.
  ServerCannotSend = "ServerCannotSend",
}

// The page that puts a break right.
export enum WhoIsToldFix {
  MonitorCriteria = "MonitorCriteria",
  IncidentOnCallRules = "IncidentOnCallRules",
  AlertOnCallRules = "AlertOnCallRules",
  OnCallPolicy = "OnCallPolicy",
  OnCallReadiness = "OnCallReadiness",
  ProjectNotificationSettings = "ProjectNotificationSettings",
  ProjectBilling = "ProjectBilling",
  // Self-hosted: the Admin Dashboard's settings, for the server's admins.
  ServerSettings = "ServerSettings",
}

// What a server-side break is about, by channel.
export enum WhoIsToldServerChannel {
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
}

export interface WhoIsToldBreak {
  kind: WhoIsToldBreakKind;
  // The sentence, in English: what is wrong and what to change.
  message: string;
  fix: WhoIsToldFix;
  recordKind?: OnCallTestPageRecordKind | undefined;
  policyId?: string | undefined;
  // Absent while the caller may not read the policy.
  policyName?: string | undefined;
  userId?: string | undefined;
  userName?: string | undefined;
  problem?: WhoIsToldPersonProblem | undefined;
  channel?: OnCallPageChannel | WhoIsToldServerChannel | undefined;
}

export interface WhoIsToldResult {
  monitorId: string;
  monitorName: string;
  // When the answer was worked out, as an ISO date: it is cached a minute.
  checkedAt: string;
  criteria: Array<WhoIsToldCriteria>;
  channels: WhoIsToldChannels;
  breaks: Array<WhoIsToldBreak>;
}

// How long the server keeps an answer before working it out again.
export const WHO_IS_TOLD_CACHE_TTL_IN_MS: number = 60 * 1000;

/*
 * The channels a project can switch off, with the switch's column of the
 * channels above.
 */
const SWITCHABLE_CHANNELS: ReadonlyArray<{
  channel: OnCallPageChannel;
  isOn: (channels: WhoIsToldChannels) => boolean;
}> = [
  {
    channel: OnCallPageChannel.SMS,
    isOn: (channels: WhoIsToldChannels): boolean => {
      return channels.isSmsOn;
    },
  },
  {
    channel: OnCallPageChannel.Call,
    isOn: (channels: WhoIsToldChannels): boolean => {
      return channels.isCallOn;
    },
  },
  {
    channel: OnCallPageChannel.WhatsApp,
    isOn: (channels: WhoIsToldChannels): boolean => {
      return channels.isWhatsAppOn;
    },
  },
  {
    channel: OnCallPageChannel.Telegram,
    isOn: (channels: WhoIsToldChannels): boolean => {
      return channels.isTelegramOn;
    },
  },
];

// The channels the project has switched off.
export function getChannelsSwitchedOff(
  channels: WhoIsToldChannels,
): Array<OnCallPageChannel> {
  return SWITCHABLE_CHANNELS.filter(
    (entry: {
      channel: OnCallPageChannel;
      isOn: (channels: WhoIsToldChannels) => boolean;
    }): boolean => {
      return !entry.isOn(channels);
    },
  ).map(
    (entry: {
      channel: OnCallPageChannel;
      isOn: (channels: WhoIsToldChannels) => boolean;
    }): OnCallPageChannel => {
      return entry.channel;
    },
  );
}

/*
 * HOW A PAGE OF ONE SEVERITY REACHES ONE PERSON - as the real page does
 * (UserOnCallLogService): through their rules for that kind and severity;
 * with none, through every verified method of theirs, unless the project
 * turned that fallback off or they opted out of the severity. A channel the
 * project switched off sends nothing.
 */
export function getWhoIsToldPersonReach(data: {
  // The verified and unverified methods their rules for the severity use.
  ruleMethods: ReadonlyArray<{
    channel: OnCallPageChannel;
    isVerified: boolean;
  }>;
  hasNoRule: boolean;
  isOptedOut: boolean;
  // Every method of theirs that is verified, whatever rule uses it.
  verifiedChannels: ReadonlyArray<OnCallPageChannel>;
  isFallbackEnabled: boolean;
  channelsOff: ReadonlyArray<OnCallPageChannel>;
}): Pick<
  WhoIsToldPerson,
  "channels" | "isFallback" | "isReachable" | "problem"
> {
  if (data.hasNoRule && data.isOptedOut) {
    return {
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.OptedOut,
    };
  }

  if (data.hasNoRule && !data.isFallbackEnabled) {
    return {
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoRuleNoFallback,
    };
  }

  const verified: Array<OnCallPageChannel> = [];

  const candidates: ReadonlyArray<OnCallPageChannel> = data.hasNoRule
    ? data.verifiedChannels
    : data.ruleMethods
        .filter((method: { isVerified: boolean }): boolean => {
          return method.isVerified;
        })
        .map((method: { channel: OnCallPageChannel }): OnCallPageChannel => {
          return method.channel;
        });

  for (const channel of candidates) {
    if (!verified.includes(channel)) {
      verified.push(channel);
    }
  }

  if (verified.length === 0) {
    return {
      channels: [],
      isFallback: data.hasNoRule,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
    };
  }

  const channels: Array<OnCallPageChannel> = verified.filter(
    (channel: OnCallPageChannel): boolean => {
      return !data.channelsOff.includes(channel);
    },
  );

  if (channels.length === 0) {
    return {
      channels: verified,
      isFallback: data.hasNoRule,
      isReachable: false,
      problem: WhoIsToldPersonProblem.ChannelsOff,
    };
  }

  return {
    channels: channels,
    isFallback: data.hasNoRule,
    isReachable: true,
  };
}

// "incidents" or "alerts", in a sentence.
function recordsWord(kind: OnCallTestPageRecordKind | undefined): string {
  return kind === OnCallTestPageRecordKind.Alert ? "alerts" : "incidents";
}

// What a person's problem means, in a clause.
const PERSON_PROBLEM_CLAUSES: Readonly<Record<WhoIsToldPersonProblem, string>> =
  {
    [WhoIsToldPersonProblem.OptedOut]: "opted out of pages of this severity",
    [WhoIsToldPersonProblem.NoRuleNoFallback]:
      "has no on-call rule for this severity, and this project does not fall back to verified methods",
    [WhoIsToldPersonProblem.NoVerifiedMethod]:
      "has no verified notification method",
    [WhoIsToldPersonProblem.ChannelsOff]:
      "is reached only by channels switched off in this project",
  };

/*
 * A break's sentence, from what it is about. A name the caller may not read
 * is left out ("An on-call policy ..."), so redacting a break is taking its
 * names away and writing it again.
 */
export function getWhoIsToldBreakMessage(
  brk: Omit<WhoIsToldBreak, "message">,
): string {
  const policy: string = brk.policyName
    ? `On-call policy ${brk.policyName}`
    : "An on-call policy";

  switch (brk.kind) {
    case WhoIsToldBreakKind.NothingHappens:
      return "No criteria of this monitor changes its status or opens an incident or an alert, so nobody is told when it goes down. Add one on the Criteria page.";
    case WhoIsToldBreakKind.NobodyPaged:
      return `Nobody is paged: no on-call rule matches ${recordsWord(brk.recordKind)} from this monitor, and its criteria names no on-call policy. Add an on-call rule for ${recordsWord(brk.recordKind)}.`;
    case WhoIsToldBreakKind.OnlyIncidentsHaveRules:
      return "Nobody is paged for this monitor's alerts: only incidents have on-call rules. Add an on-call rule for alerts, or have the criteria open an incident.";
    case WhoIsToldBreakKind.PolicyHasNoLevels:
      return `${policy} has no escalation rules, so it pages nobody. Add people, a team or a schedule to it.`;
    case WhoIsToldBreakKind.PolicyReachesNobody:
      return `${policy} reaches nobody right now: its first escalation rule has nobody on call. Add people to it, or put someone on its schedule.`;
    case WhoIsToldBreakKind.PersonUnreachable:
      return `${brk.userName || "Someone this policy pages"} ${
        PERSON_PROBLEM_CLAUSES[
          brk.problem || WhoIsToldPersonProblem.NoVerifiedMethod
        ]
      }, so a page won't reach them.`;
    case WhoIsToldBreakKind.ChannelOff:
      return `${brk.channel ? getOnCallPageChannelName(brk.channel as OnCallPageChannel) : "A channel"} is off in this project, so pages that use it are not sent. A project owner or admin turns it on in Notification Channels.`;
    case WhoIsToldBreakKind.NoBalance:
      return "This project has no balance left for SMS and calls, so they are not sent. Add balance, or turn on auto-recharge, in Billing.";
    case WhoIsToldBreakKind.ServerCannotSend:
      return brk.channel === WhoIsToldServerChannel.Email
        ? "This server can't send email yet, so owners are not emailed and email pages are not sent. An admin of the server sets up email in the Admin Dashboard."
        : brk.channel === WhoIsToldServerChannel.Call
          ? "This server can't make phone calls yet, so call pages are not sent. An admin of the server sets up Twilio in the Admin Dashboard."
          : "This server can't send SMS yet, so SMS pages are not sent. An admin of the server sets up Twilio in the Admin Dashboard.";
  }
}

// A break with its sentence written.
export function makeWhoIsToldBreak(
  brk: Omit<WhoIsToldBreak, "message">,
): WhoIsToldBreak {
  const made: WhoIsToldBreak = { ...brk, message: "" };

  for (const key of Object.keys(made) as Array<keyof WhoIsToldBreak>) {
    if (made[key] === undefined) {
      delete made[key];
    }
  }

  made.message = getWhoIsToldBreakMessage(made);

  return made;
}

// What makes two breaks the same one, said once.
function getBreakKey(brk: Omit<WhoIsToldBreak, "message">): string {
  return [
    brk.kind,
    brk.recordKind || "",
    brk.policyId || "",
    brk.userId || "",
    brk.channel || "",
  ].join("|");
}

// Every channel some person's page would use.
function getChannelsInUse(
  criteria: ReadonlyArray<WhoIsToldCriteria>,
): Set<OnCallPageChannel> {
  const used: Set<OnCallPageChannel> = new Set<OnCallPageChannel>();

  for (const item of criteria) {
    for (const event of item.events) {
      for (const policy of event.policies) {
        for (const person of policy.people) {
          for (const channel of person.channels) {
            used.add(channel);
          }
        }
      }
    }
  }

  return used;
}

/*
 * EVERY BREAK IN A MONITOR'S CHAIN, each once, in the order a reader meets
 * them: what the criteria do, then each policy, its people, then the
 * project's and the server's channels.
 *
 * `projectHasIncidentOnCallRules` tells a monitor that opens alerts while
 * only incidents have on-call rules (the most common silent break) from one
 * that has no rules at all.
 */
export function getWhoIsToldBreaks(data: {
  criteria: ReadonlyArray<WhoIsToldCriteria>;
  channels: WhoIsToldChannels;
  projectHasIncidentOnCallRules: boolean;
  projectHasAlertOnCallRules: boolean;
}): Array<WhoIsToldBreak> {
  const breaks: Array<WhoIsToldBreak> = [];
  const seen: Set<string> = new Set<string>();

  const add: (brk: Omit<WhoIsToldBreak, "message">) => void = (
    brk: Omit<WhoIsToldBreak, "message">,
  ): void => {
    const key: string = getBreakKey(brk);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    breaks.push(makeWhoIsToldBreak(brk));
  };

  const doesAnything: boolean = data.criteria.some(
    (item: WhoIsToldCriteria): boolean => {
      return Boolean(item.statusName) || item.events.length > 0;
    },
  );

  if (!doesAnything) {
    add({
      kind: WhoIsToldBreakKind.NothingHappens,
      fix: WhoIsToldFix.MonitorCriteria,
    });
  }

  for (const item of data.criteria) {
    for (const event of item.events) {
      if (event.policies.length === 0) {
        if (
          event.kind === OnCallTestPageRecordKind.Alert &&
          data.projectHasIncidentOnCallRules &&
          !data.projectHasAlertOnCallRules
        ) {
          add({
            kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
            fix: WhoIsToldFix.AlertOnCallRules,
            recordKind: event.kind,
          });
        } else {
          add({
            kind: WhoIsToldBreakKind.NobodyPaged,
            fix:
              event.kind === OnCallTestPageRecordKind.Alert
                ? WhoIsToldFix.AlertOnCallRules
                : WhoIsToldFix.IncidentOnCallRules,
            recordKind: event.kind,
          });
        }

        continue;
      }

      for (const policy of event.policies) {
        // What the caller may not read, they are not told the inside of.
        if (policy.isHidden) {
          continue;
        }

        if (policy.levelCount === 0) {
          add({
            kind: WhoIsToldBreakKind.PolicyHasNoLevels,
            fix: WhoIsToldFix.OnCallPolicy,
            policyId: policy.id,
            policyName: policy.name || undefined,
          });
          continue;
        }

        if (policy.people.length === 0) {
          add({
            kind: WhoIsToldBreakKind.PolicyReachesNobody,
            fix: WhoIsToldFix.OnCallPolicy,
            policyId: policy.id,
            policyName: policy.name || undefined,
          });
          continue;
        }

        for (const person of policy.people) {
          if (person.isReachable) {
            continue;
          }

          /*
           * A person whose only channels are off is the switch's break,
           * told once below, not theirs.
           */
          if (person.problem === WhoIsToldPersonProblem.ChannelsOff) {
            continue;
          }

          add({
            kind: WhoIsToldBreakKind.PersonUnreachable,
            fix: WhoIsToldFix.OnCallReadiness,
            policyId: policy.id,
            policyName: policy.name || undefined,
            userId: person.userId,
            userName: person.name || undefined,
            problem: person.problem,
          });
        }
      }
    }
  }

  // The project's switches, for a channel some page would use.
  const offChannels: Array<OnCallPageChannel> = getChannelsSwitchedOff(
    data.channels,
  );

  const wanted: Set<OnCallPageChannel> = new Set<OnCallPageChannel>();

  for (const item of data.criteria) {
    for (const event of item.events) {
      for (const policy of event.policies) {
        for (const person of policy.people) {
          if (person.problem === WhoIsToldPersonProblem.ChannelsOff) {
            for (const channel of person.channels) {
              wanted.add(channel);
            }
          }
        }
      }
    }
  }

  for (const channel of offChannels) {
    if (wanted.has(channel)) {
      add({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: channel,
      });
    }
  }

  const used: Set<OnCallPageChannel> = getChannelsInUse(data.criteria);

  // OneUptime Cloud: SMS and calls paid from an empty balance.
  if (data.channels.isBillingEnabled) {
    const paysForSms: boolean =
      used.has(OnCallPageChannel.SMS) && !data.channels.hasOwnTwilioForSms;
    const paysForCalls: boolean =
      used.has(OnCallPageChannel.Call) && !data.channels.hasOwnTwilioForCalls;
    const paysForOthers: boolean =
      used.has(OnCallPageChannel.WhatsApp) ||
      used.has(OnCallPageChannel.Telegram);

    if (
      (paysForSms || paysForCalls || paysForOthers) &&
      !data.channels.isAutoRechargeOn &&
      (data.channels.balanceInUSDCents || 0) <= 0
    ) {
      add({
        kind: WhoIsToldBreakKind.NoBalance,
        fix: WhoIsToldFix.ProjectBilling,
      });
    }
  }

  // Self-hosted: what the server can't send yet.
  const emailsAnybody: boolean =
    doesAnything || used.has(OnCallPageChannel.Email);

  if (data.channels.serverCanSendEmail === false && emailsAnybody) {
    add({
      kind: WhoIsToldBreakKind.ServerCannotSend,
      fix: WhoIsToldFix.ServerSettings,
      channel: WhoIsToldServerChannel.Email,
    });
  }

  if (
    data.channels.serverCanSendSms === false &&
    used.has(OnCallPageChannel.SMS) &&
    !data.channels.hasOwnTwilioForSms
  ) {
    add({
      kind: WhoIsToldBreakKind.ServerCannotSend,
      fix: WhoIsToldFix.ServerSettings,
      channel: WhoIsToldServerChannel.SMS,
    });
  }

  if (
    data.channels.serverCanCall === false &&
    used.has(OnCallPageChannel.Call) &&
    !data.channels.hasOwnTwilioForCalls
  ) {
    add({
      kind: WhoIsToldBreakKind.ServerCannotSend,
      fix: WhoIsToldFix.ServerSettings,
      channel: WhoIsToldServerChannel.Call,
    });
  }

  return breaks;
}

// A rule or status page as it is, when the caller may read it; else nameless.
function withNameIfReadable<T extends { id: string; name: string }>(
  item: T,
  readableIds: ReadonlySet<string>,
): T {
  return readableIds.has(item.id) ? item : { ...item, name: "" };
}

/*
 * THE ANSWER AS ONE CALLER MAY SEE IT. Somebody who may read the monitor
 * but not a policy is told paging is set up, and nothing of who: the
 * policy's name, people and gaps are taken away, and so are the names in
 * its breaks. An on-call rule, an owner rule or a status page they may not
 * read keeps its place without its name.
 */
export function redactWhoIsTold(data: {
  result: WhoIsToldResult;
  readablePolicyIds: ReadonlySet<string>;
  // The on-call rules (incident and alert) the caller may read.
  readableRuleIds: ReadonlySet<string>;
  // The owner rules (incident and alert) the caller may read.
  readableOwnerRuleIds: ReadonlySet<string>;
  readableStatusPageIds: ReadonlySet<string>;
}): WhoIsToldResult {
  const isReadable: (policyId: string | undefined) => boolean = (
    policyId: string | undefined,
  ): boolean => {
    return !policyId || data.readablePolicyIds.has(policyId);
  };

  return {
    ...data.result,
    criteria: data.result.criteria.map(
      (item: WhoIsToldCriteria): WhoIsToldCriteria => {
        return {
          ...item,
          events: item.events.map((event: WhoIsToldEvent): WhoIsToldEvent => {
            return {
              ...event,
              ownerRules: event.ownerRules.map(
                (rule: WhoIsToldRule): WhoIsToldRule => {
                  return withNameIfReadable(rule, data.readableOwnerRuleIds);
                },
              ),
              rules: event.rules.map((rule: WhoIsToldRule): WhoIsToldRule => {
                return withNameIfReadable(rule, data.readableRuleIds);
              }),
              statusPages: event.statusPages.map(
                (page: WhoIsToldStatusPage): WhoIsToldStatusPage => {
                  return withNameIfReadable(page, data.readableStatusPageIds);
                },
              ),
              policies: event.policies.map(
                (policy: WhoIsToldPolicy): WhoIsToldPolicy => {
                  if (isReadable(policy.id)) {
                    return policy;
                  }

                  return {
                    id: policy.id,
                    name: "",
                    isHidden: true,
                    isNamedByCriteria: policy.isNamedByCriteria,
                    ruleIds: policy.ruleIds,
                    levelCount: 0,
                    people: [],
                    notPaged: [],
                    notPagedCodes: [],
                  };
                },
              ),
            };
          }),
        };
      },
    ),
    breaks: data.result.breaks
      .filter((brk: WhoIsToldBreak): boolean => {
        // Who a hidden policy pages is not the caller's to read.
        return !(
          brk.kind === WhoIsToldBreakKind.PersonUnreachable &&
          !isReadable(brk.policyId)
        );
      })
      .map((brk: WhoIsToldBreak): WhoIsToldBreak => {
        if (isReadable(brk.policyId)) {
          return brk;
        }

        return makeWhoIsToldBreak({
          ...brk,
          message: undefined,
          policyName: undefined,
        } as Omit<WhoIsToldBreak, "message">);
      }),
  };
}

// The criteria and incident or alert the card's sentences are about.
export interface WhoIsToldHeadline {
  criteria: WhoIsToldCriteria;
  event?: WhoIsToldEvent | undefined;
}

/*
 * What "When this goes down" describes first: the first criteria checked
 * that opens an incident or an alert, or failing that the first that
 * changes the status to something - criteria are checked in order and the
 * first that matches wins (MonitorCriteria), and the one that opens
 * something is the one people mean by "goes down".
 */
export function getWhoIsToldHeadline(
  result: Pick<WhoIsToldResult, "criteria">,
): WhoIsToldHeadline | null {
  for (const item of result.criteria) {
    if (item.events.length > 0) {
      return { criteria: item, event: item.events[0] };
    }
  }

  return null;
}

// The people a set of policies reaches, each once, reachable ones only.
export function getReachablePeople(
  policies: ReadonlyArray<WhoIsToldPolicy>,
): Array<WhoIsToldPerson> {
  const people: Array<WhoIsToldPerson> = [];
  const seen: Set<string> = new Set<string>();

  for (const policy of policies) {
    for (const person of policy.people) {
      if (!person.isReachable || seen.has(person.userId)) {
        continue;
      }

      seen.add(person.userId);
      people.push(person);
    }
  }

  return people;
}

// How paging stands for what opens: the card's third sentence.
export enum WhoIsToldPagingState {
  // It pages these people.
  Pages = "Pages",
  // No policy runs.
  Nobody = "Nobody",
  // Policies run, and the caller may read none of them.
  Hidden = "Hidden",
  // Policies run, and nobody they reach can be told.
  Unreachable = "Unreachable",
}

export function getWhoIsToldPagingState(
  event: Pick<WhoIsToldEvent, "policies">,
): WhoIsToldPagingState {
  if (event.policies.length === 0) {
    return WhoIsToldPagingState.Nobody;
  }

  if (
    event.policies.every((policy: WhoIsToldPolicy): boolean => {
      return policy.isHidden;
    })
  ) {
    return WhoIsToldPagingState.Hidden;
  }

  return getReachablePeople(event.policies).length > 0
    ? WhoIsToldPagingState.Pages
    : WhoIsToldPagingState.Unreachable;
}
