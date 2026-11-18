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
  /*
   * OWNERS THE PAGE REACHES FIRST (#8860). The owners' "created" email of a
   * new incident or alert leaves out everyone its on-call page has reached
   * already (OwnersReachedByAPage, #7987): someone who is both an owner and
   * on call is told once, by the page. These are the owners a readable
   * policy's first level pages at once - so the email leaves them out - by
   * id and name; userNames and teamNames are then the owners it still
   * reaches. Set as the answer is handed to its reader
   * (getWhoIsToldOwnersAsTold): what a policy they may not read pages is
   * not theirs to learn. Absent from an older server's answer, and from a
   * status change's owners, whom the change is told to all the same.
   */
  pagedOwners?: Array<WhoIsToldPagedOwner> | undefined;
  /*
   * Everyone the Created email is addressed to, person by person - the
   * resolver's, from which the reader's pagedOwners are worked out. Taken
   * out before the answer leaves the server (getWhoIsToldOwnersAsTold), so
   * nobody learns who a team's members are from it.
   */
  recipients?: Array<WhoIsToldOwnerRecipient> | undefined;
  /*
   * OWNERS THE CREATED EMAIL NEVER REACHES (#7572): somebody named as an
   * owner who is not a member of the project, a team of the project with
   * nobody in it who is, and a team of another project - each with why,
   * and what named it, so the set-up can be put right. They are not in
   * userNames or teamNames. Absent from an older server's answer, and from
   * a status change's owners.
   */
  notReached?: Array<WhoIsToldOwnerNotReached> | undefined;
}

// Whom an owner is: a person or a team.
export enum WhoIsToldOwnerKind {
  User = "User",
  Team = "Team",
}

// Why the Created email never reaches an owner (#7572).
export enum WhoIsToldOwnerProblem {
  // A person who left the project, or never accepted its invitation.
  NotInProject = "NotInProject",
  // A team of the project with nobody in it who is a member of the project.
  TeamHasNobodyInProject = "TeamHasNobodyInProject",
  // A team of another project: it reaches nobody here.
  TeamOfAnotherProject = "TeamOfAnotherProject",
}

// What named an owner: the place to change it.
export enum WhoIsToldOwnerAddedBy {
  Criteria = "Criteria",
  NetworkDevice = "NetworkDevice",
  OwnerRule = "OwnerRule",
}

export interface WhoIsToldOwnerNotReached {
  kind: WhoIsToldOwnerKind;
  id: string;
  /*
   * A team of the project, by name. Empty for a person who is not a member
   * - the project does not name them - and for another project's team.
   */
  name: string;
  problem: WhoIsToldOwnerProblem;
  addedBy: WhoIsToldOwnerAddedBy;
  // The owner rule that adds them; its name empty while the reader may not read it.
  rule?: WhoIsToldRule | undefined;
  // The network device whose owner they are.
  networkDeviceId?: string | undefined;
}

// One person an owners' Created email is addressed to (#8860).
export interface WhoIsToldOwnerRecipient {
  userId: string;
  name: string;
  /*
   * Named as an owner themselves - or a Project Owner standing in for
   * owners - rather than only as a member of an owner team.
   */
  isNamed: boolean;
  // The owner teams the email reaches them through, by name.
  teamNames: Array<string>;
}

// An owner the page reaches first, whom the Created email leaves out (#8860).
export interface WhoIsToldPagedOwner {
  userId: string;
  name: string;
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
   * No rule of theirs covers the severity, so a page goes to what the
   * project's fallback picks of their methods (#7528): every free verified
   * one, or else one paid one, or else a webhook - never every verified
   * method. `channels` are what it picks.
   */
  isFallback: boolean;
  isReachable: boolean;
  problem?: WhoIsToldPersonProblem | undefined;
  /*
   * The channels their page's first notifications go out by as it starts
   * (#8860): a rule of theirs for the severity that notifies after no
   * minutes, on a verified method of a channel the project has on - or,
   * with no rule, what the fallback picks, which it sends at once. Empty
   * when their first notification waits. Absent from an older server's
   * answer.
   */
  channelsAtOnce?: Array<OnCallPageChannel> | undefined;
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
  /*
   * Its run pages its first level as what opens is created (#8860): the
   * criteria names it, which pages right away, or an on-call rule that runs
   * it pages right away now (OnCallRulePagingHold). False when every rule
   * that runs it holds its runs - for working hours, or for OneUptime AI.
   * Absent from an older server's answer.
   */
  pagesAtOnce?: boolean | undefined;
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

// A monitor group a status page shows the monitor through.
export interface WhoIsToldMonitorGroup {
  id: string;
  // Empty while the caller may not read the group.
  name: string;
}

// A status page an incident from the monitor shows on.
export interface WhoIsToldStatusPage {
  id: string;
  // Empty while the caller may not read the status page.
  name: string;
  /*
   * The monitor groups the page shows the monitor through (#7214), so the
   * chain says which group to edit. Empty when the page lists the monitor
   * itself - then that is what people change first, whatever groups it is
   * in too. Absent from an older server's answer.
   */
  groups?: Array<WhoIsToldMonitorGroup> | undefined;
}

/*
 * The incident an alert incident rule declares from an alert (#7216): the
 * first enabled rule that matches the alert decides, right away or once the
 * alert has stayed open for its wait, and the incident it declares is told
 * as any incident is - its own owners, owner rules, on-call rules, policies
 * and status pages.
 */
export interface WhoIsToldDeclaration {
  // The alert incident rule; its name empty while the reader may not read it.
  rule: WhoIsToldRule;
  // How long the alert must stay open first; 0 when it declares right away.
  waitInMinutes: number;
  incident: WhoIsToldEvent;
}

// One incident or alert a criteria opens.
export interface WhoIsToldEvent {
  kind: OnCallTestPageRecordKind;
  /*
   * The criteria's incident or alert template it is opened from, and the
   * severity it opens at: what a fire drill of it tests (#7012). Absent from
   * an older server's answer.
   */
  id?: string | undefined;
  severityId?: string | undefined;
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
   * criteria keeps off status pages, or that is private.
   */
  statusPages: Array<WhoIsToldStatusPage>;
  /*
   * PRIVATE (#7213): the criteria makes it private, or a privacy rule does
   * (privacyRules). A private incident shows on no status page and tells
   * no subscriber; only its owners, Project Owners and Project Admins may
   * read it. Absent from an older server's answer.
   */
  isPrivate?: boolean | undefined;
  /*
   * The privacy rules that make it private, as its feed will name them;
   * empty when the criteria makes it private. A rule the reader may not
   * read keeps its place without its name.
   */
  privacyRules?: Array<WhoIsToldRule> | undefined;
  /*
   * It is private while status pages show the monitor: they would show it
   * otherwise, so the chain says why they don't.
   */
  isPrivateOffStatusPages?: boolean | undefined;
  /*
   * The label rules whose labels change which on-call rules page it
   * (#7212): label rules run before on-call rules, and an on-call rule may
   * match a label one adds. Left out when they change nothing that pages.
   */
  labelRules?: Array<WhoIsToldRule> | undefined;
  /*
   * THE OWNERS THAT MAKE AN ON-CALL RULE MATCH (#9407): an alert on-call
   * rule with an Alert Owner condition ("is any of Payments") matches on who
   * owns the alert - the people and teams its criteria names, the network
   * device's owners and whom its owner rules add, all in before its on-call
   * rules run. Each of `rules` whose condition picks one of its owners, with
   * those owners by name. Left out when no rule does, and from an older
   * server's answer.
   */
  ownerMatches?: Array<WhoIsToldOwnerMatch> | undefined;
  // An alert an alert incident rule turns into an incident (#7216).
  declares?: WhoIsToldDeclaration | undefined;
  /*
   * PRIVATE, AND NOT THE READER'S TO SEE (#7213): a private record the
   * reader could not read once it exists - they are none of its owners,
   * nor in a team of them, nor a Project Owner or Project Admin. They are
   * told what it is and that it is private, and nothing of whom it tells:
   * its title, owners, rules, policies and what it declares are taken out.
   */
  isHidden?: boolean | undefined;
  /*
   * The ids of its owners as the record will have them - the people and
   * the project's teams - for working out who may read it once it is
   * private. Taken out before the answer leaves the server (redactWhoIsTold).
   */
  ownerIds?: WhoIsToldOwnerIds | undefined;
}

/*
 * An on-call rule its owners make match (#9407): the rule, as the event's
 * `rules` names it (its name there, as the reader may read it), and the
 * owners its Alert Owner condition picks, by name.
 */
export interface WhoIsToldOwnerMatch {
  ruleId: string;
  ownerNames: Array<string>;
}

// Who will own a record, by id (resolver only).
export interface WhoIsToldOwnerIds {
  userIds: Array<string>;
  teamIds: Array<string>;
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
  /*
   * The project has no on-call policy yet, so an on-call rule would have
   * nothing to page: the on-call guided setup makes the first policy, with
   * the on-call rules that run it for every new incident and alert (#7369).
   */
  OnCallGuidedSetup = "OnCallGuidedSetup",
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

/*
 * What the breaks of a monitor's chain are worked out from besides the
 * chain itself (getWhoIsToldBreaks): kept with the resolver's answer so a
 * reader's breaks can be worked out again without what they may not see,
 * and taken out before the answer leaves the server (redactWhoIsTold).
 */
export interface WhoIsToldProjectFacts {
  projectHasIncidentOnCallRules: boolean;
  projectHasAlertOnCallRules: boolean;
  projectHasOnCallPolicies: boolean;
}

export interface WhoIsToldResult {
  monitorId: string;
  monitorName: string;
  // When the answer was worked out, as an ISO date: it is cached a minute.
  checkedAt: string;
  criteria: Array<WhoIsToldCriteria>;
  channels: WhoIsToldChannels;
  breaks: Array<WhoIsToldBreak>;
  // The resolver's own (WhoIsToldProjectFacts); never sent.
  facts?: WhoIsToldProjectFacts | undefined;
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
 * with none, unless the project turned the fallback off or they opted out
 * of the severity, through what the fallback picks of their methods
 * (UserNotificationRuleService.executeFallbackNotification): every free
 * verified one, or else one paid one, or else a webhook (#7528). Listing
 * every verified method there said a person with an email, a number and a
 * phone was texted and called too, when a page only emails them. A channel
 * the project switched off sends nothing.
 */
export function getWhoIsToldPersonReach(data: {
  // The verified and unverified methods their rules for the severity use.
  ruleMethods: ReadonlyArray<{
    channel: OnCallPageChannel;
    isVerified: boolean;
  }>;
  hasNoRule: boolean;
  isOptedOut: boolean;
  /*
   * What the fallback picks of their methods, in the order it sends them
   * (UserNotificationRuleService.getFallbackRules): what a page goes to
   * when no rule of theirs covers the severity.
   */
  fallbackChannels: ReadonlyArray<OnCallPageChannel>;
  /*
   * Every method of theirs that is verified, whatever rule uses it: when
   * the fallback picks nothing, a verified method on a channel the project
   * switched off says which switch would let it page them.
   */
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

  const candidates: ReadonlyArray<OnCallPageChannel> = data.hasNoRule
    ? data.fallbackChannels
    : data.ruleMethods
        .filter((method: { isVerified: boolean }): boolean => {
          return method.isVerified;
        })
        .map((method: { channel: OnCallPageChannel }): OnCallPageChannel => {
          return method.channel;
        });

  const verified: Array<OnCallPageChannel> = eachOnce(candidates);

  if (verified.length === 0) {
    /*
     * The fallback picks nothing, while a method of theirs is verified on
     * a channel the project switched off (a text number, with SMS off):
     * the fallback skips a paid channel that is off, and would page them
     * by it once it is on. That switch is the break, as it is for a rule.
     */
    const switchedOff: Array<OnCallPageChannel> = data.hasNoRule
      ? eachOnce(data.verifiedChannels).filter(
          (channel: OnCallPageChannel): boolean => {
            return data.channelsOff.includes(channel);
          },
        )
      : [];

    if (switchedOff.length > 0) {
      return {
        channels: switchedOff,
        isFallback: true,
        isReachable: false,
        problem: WhoIsToldPersonProblem.ChannelsOff,
      };
    }

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

// Each channel once, in the order first met.
function eachOnce(
  channels: ReadonlyArray<OnCallPageChannel>,
): Array<OnCallPageChannel> {
  const once: Array<OnCallPageChannel> = [];

  for (const channel of channels) {
    if (!once.includes(channel)) {
      once.push(channel);
    }
  }

  return once;
}

// "incidents" or "alerts", in a sentence.
function recordsWord(kind: OnCallTestPageRecordKind | undefined): string {
  return kind === OnCallTestPageRecordKind.Alert ? "alerts" : "incidents";
}

/*
 * WHY A PERSON CAN'T BE PAGED, in a clause after their name: "Ana Lopez has
 * no verified notification method". The words the monitor's "When this goes
 * down" card says it in (the Dashboard's WhoIsToldWords, "{{name}} has no
 * verified notification method."), so the server's break sentence, Ask AI's
 * who_is_told (#7525) and the card say each reason alike -
 * MonitorWhoIsToldAskAiAgreement holds the three to it. A Record, so a new
 * problem does not compile until it is worded here.
 */
export const WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES: Readonly<
  Record<WhoIsToldPersonProblem, string>
> = {
  [WhoIsToldPersonProblem.OptedOut]: "opted out of pages of this severity",
  [WhoIsToldPersonProblem.NoRuleNoFallback]:
    "has no on-call rule for this severity, and this project doesn't fall back to verified methods",
  [WhoIsToldPersonProblem.NoVerifiedMethod]:
    "has no verified notification method",
  [WhoIsToldPersonProblem.ChannelsOff]:
    "is reached only by channels that are off in this project",
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
      return brk.fix === WhoIsToldFix.OnCallGuidedSetup
        ? "Nobody is paged: this project has no on-call policy yet. Set up paging to make one that pages someone for every new incident and alert."
        : `Nobody is paged: no on-call rule matches ${recordsWord(brk.recordKind)} from this monitor, and its criteria names no on-call policy. Add an on-call rule for ${recordsWord(brk.recordKind)}.`;
    case WhoIsToldBreakKind.OnlyIncidentsHaveRules:
      return "Nobody is paged for this monitor's alerts: only incidents have on-call rules. Add an on-call rule for alerts, or have the criteria open an incident.";
    case WhoIsToldBreakKind.PolicyHasNoLevels:
      return `${policy} has no escalation rules, so it pages nobody. Add people, a team or a schedule to it.`;
    case WhoIsToldBreakKind.PolicyReachesNobody:
      return `${policy} reaches nobody right now: its first escalation rule has nobody on call. Add people to it, or put someone on its schedule.`;
    case WhoIsToldBreakKind.PersonUnreachable:
      return `${brk.userName || "Someone this policy pages"} ${
        WHO_IS_TOLD_PERSON_PROBLEM_CLAUSES[
          brk.problem || WhoIsToldPersonProblem.NoVerifiedMethod
        ]
      }, so a page won't reach them.`;
    case WhoIsToldBreakKind.ChannelOff: {
      /*
       * A channel costs money, so its switch is billing: a Project Owner, a
       * Billing Admin or someone with Manage Billing flips it, never a
       * Project Admin (Utils/Project/NotificationChannels, whose words
       * these are). "phone call" starts the sentence: "Phone call is off".
       */
      const channel: string = brk.channel
        ? getOnCallPageChannelName(brk.channel as OnCallPageChannel)
        : "a channel";

      return `${channel.charAt(0).toUpperCase()}${channel.slice(1)} is off in this project, so pages that use it are not sent. A Project Owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notifications > Notification Channels.`;
    }
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

/*
 * Every incident and alert of the chain, in the order a reader meets them:
 * each criteria's, and after an alert the incident an alert incident rule
 * declares from it (#7216). One a reader may not see (skip) is left out,
 * and so is what it declares.
 */
function getChainEvents(
  criteria: ReadonlyArray<WhoIsToldCriteria>,
  skip?: ((event: WhoIsToldEvent) => boolean) | undefined,
): Array<WhoIsToldEvent> {
  const events: Array<WhoIsToldEvent> = [];

  for (const item of criteria) {
    for (const event of item.events) {
      if (skip && skip(event)) {
        continue;
      }

      events.push(event);

      const declared: WhoIsToldEvent | undefined = event.declares?.incident;

      if (declared && !(skip && skip(declared))) {
        events.push(declared);
      }
    }
  }

  return events;
}

// Every channel some person's page would use.
function getChannelsInUse(
  events: ReadonlyArray<WhoIsToldEvent>,
): Set<OnCallPageChannel> {
  const used: Set<OnCallPageChannel> = new Set<OnCallPageChannel>();

  for (const event of events) {
    for (const policy of event.policies) {
      for (const person of policy.people) {
        for (const channel of person.channels) {
          used.add(channel);
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
 * that has no rules at all. `projectHasOnCallPolicies` tells a project with
 * no on-call policy yet - whose fix is the on-call guided setup, which
 * makes the first one with the rules that run it - from one whose rules
 * leave this monitor out (#7369): an on-call rule needs a policy to page.
 *
 * An alert an alert incident rule turns into an incident that pages
 * somebody is no break, though it pages nobody itself: the project meant
 * its alerts to become incidents (#7216); the incident's own policies and
 * people are its breaks. `isHidden` leaves out what a reader may not see -
 * a private record that is not theirs (#7213): nothing it would page is
 * their break. It still counts as something the monitor does.
 *
 * An owner no Created email reaches (WhoIsToldOwners.notReached, #7572) is
 * no break: the email still goes out, to the owners it reaches or to the
 * Project Owners, so nothing stops who is told. The card says it with who
 * is emailed, and Setup health lists it as worth fixing (#9371).
 */
export function getWhoIsToldBreaks(data: {
  criteria: ReadonlyArray<WhoIsToldCriteria>;
  channels: WhoIsToldChannels;
  projectHasIncidentOnCallRules: boolean;
  projectHasAlertOnCallRules: boolean;
  projectHasOnCallPolicies: boolean;
  isHidden?: ((event: WhoIsToldEvent) => boolean) | undefined;
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

  const events: Array<WhoIsToldEvent> = getChainEvents(
    data.criteria,
    data.isHidden,
  );

  for (const event of events) {
    /*
     * The incident an alert becomes: its own policies are its breaks, and
     * an alert whose incident pages somebody is not "nobody is paged".
     */
    const declaredIncidentPages: boolean = Boolean(
      event.declares &&
        event.declares.incident.policies.length > 0 &&
        !(data.isHidden && data.isHidden(event.declares.incident)),
    );

    if (event.policies.length === 0) {
      // Declared from an alert: the alert's break says nobody is paged.
      const isDeclaredIncident: boolean = events.some(
        (other: WhoIsToldEvent): boolean => {
          return other.declares?.incident === event;
        },
      );

      if (isDeclaredIncident || declaredIncidentPages) {
        continue;
      }

      if (!data.projectHasOnCallPolicies) {
        /*
         * No policy at all: whatever rules the project has page nothing,
         * so the first policy is what is missing (#7369).
         */
        add({
          kind: WhoIsToldBreakKind.NobodyPaged,
          fix: WhoIsToldFix.OnCallGuidedSetup,
          recordKind: event.kind,
        });
      } else if (
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

  // The project's switches, for a channel some page would use.
  const offChannels: Array<OnCallPageChannel> = getChannelsSwitchedOff(
    data.channels,
  );

  const wanted: Set<OnCallPageChannel> = new Set<OnCallPageChannel>();

  for (const event of events) {
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

  for (const channel of offChannels) {
    if (wanted.has(channel)) {
      add({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: channel,
      });
    }
  }

  const used: Set<OnCallPageChannel> = getChannelsInUse(events);

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

/*
 * Whether a notification by this channel goes out now, as the breaks above
 * judge it: not by a channel the project switched off, not by email, SMS or
 * a call a self-hosted server cannot send yet (unless the project's own
 * Twilio sends SMS and calls), and on OneUptime Cloud not by one paid from a
 * balance that is empty with no auto-recharge. A notification that fails
 * never reached anybody (isOnCallPageNotificationOut).
 */
export function canWhoIsToldChannelSendNow(
  channel: OnCallPageChannel,
  channels: WhoIsToldChannels,
): boolean {
  if (getChannelsSwitchedOff(channels).includes(channel)) {
    return false;
  }

  const hasNoBalance: boolean =
    channels.isBillingEnabled &&
    !channels.isAutoRechargeOn &&
    (channels.balanceInUSDCents || 0) <= 0;

  switch (channel) {
    case OnCallPageChannel.Email:
      return channels.serverCanSendEmail !== false;
    case OnCallPageChannel.SMS:
      return (
        channels.hasOwnTwilioForSms ||
        (channels.serverCanSendSms !== false && !hasNoBalance)
      );
    case OnCallPageChannel.Call:
      return (
        channels.hasOwnTwilioForCalls ||
        (channels.serverCanCall !== false && !hasNoBalance)
      );
    case OnCallPageChannel.WhatsApp:
    case OnCallPageChannel.Telegram:
      return !hasNoBalance;
    default:
      return true;
  }
}

/*
 * Whether a policy's first level pages this person as what opens is
 * created, by a notification that goes out then (#8860): the policy pages
 * at once, they can be reached, and one of their first notifications goes
 * out at once by a channel that sends now.
 */
export function isWhoIsToldPersonPagedAtOnce(data: {
  policy: Pick<WhoIsToldPolicy, "isHidden" | "pagesAtOnce">;
  person: Pick<WhoIsToldPerson, "isReachable" | "channelsAtOnce">;
  channels: WhoIsToldChannels;
}): boolean {
  if (data.policy.isHidden || data.policy.pagesAtOnce !== true) {
    return false;
  }

  if (!data.person.isReachable) {
    return false;
  }

  return (data.person.channelsAtOnce || []).some(
    (channel: OnCallPageChannel): boolean => {
      return canWhoIsToldChannelSendNow(channel, data.channels);
    },
  );
}

/*
 * WHO AN INCIDENT'S OR AN ALERT'S CREATED EMAIL TELLS, AS ITS READER SEES IT
 * (#8860).
 *
 * The owners' "created" email leaves out each owner its on-call page has
 * reached already (OwnersReachedByAPage, #7987): one with a notification of
 * the page that went out by the time the email is sent, about a minute
 * after the record is created. So an owner a policy's first level pages at
 * once (isWhoIsToldPersonPagedAtOnce) - matched by user id, through a team
 * as well as by name - is told once, by the page. Their name moves from the
 * owners the email reaches to pagedOwners; an owner team stays among them
 * while it has a member the email still reaches.
 *
 * Only what the job will in fact leave out is: a page held for working
 * hours or for OneUptime AI, a person who cannot be reached, whose first
 * notification waits, or who is only on a later level, is still emailed as
 * an owner, as is anybody when nothing says otherwise. A policy the reader
 * may not read (isHidden) says nothing of whom it pages: an owner only it
 * pages is said to be emailed, as before. The email's recipients
 * themselves are taken out of the answer either way.
 */
export function getWhoIsToldOwnersAsTold(data: {
  owners: WhoIsToldOwners;
  policies: ReadonlyArray<WhoIsToldPolicy>;
  channels: WhoIsToldChannels;
}): WhoIsToldOwners {
  const { recipients, ...owners } = data.owners;

  if (!recipients) {
    return owners;
  }

  const pagedAtOnce: Set<string> = new Set<string>();

  for (const policy of data.policies) {
    for (const person of policy.people) {
      if (
        isWhoIsToldPersonPagedAtOnce({
          policy: policy,
          person: person,
          channels: data.channels,
        })
      ) {
        pagedAtOnce.add(person.userId.toLowerCase());
      }
    }
  }

  const isPagedAtOnce: (recipient: WhoIsToldOwnerRecipient) => boolean = (
    recipient: WhoIsToldOwnerRecipient,
  ): boolean => {
    return pagedAtOnce.has(recipient.userId.toLowerCase());
  };

  const pagedOwners: Array<WhoIsToldPagedOwner> = recipients
    .filter(isPagedAtOnce)
    .map((recipient: WhoIsToldOwnerRecipient): WhoIsToldPagedOwner => {
      return { userId: recipient.userId, name: recipient.name };
    });

  if (pagedOwners.length === 0) {
    return owners;
  }

  const pagedNames: Set<string> = new Set<string>(
    recipients
      .filter((recipient: WhoIsToldOwnerRecipient): boolean => {
        return recipient.isNamed && isPagedAtOnce(recipient);
      })
      .map((recipient: WhoIsToldOwnerRecipient): string => {
        return recipient.name;
      }),
  );

  // A name the email still reaches under it - another owner of that name - stays.
  const stillEmailedNames: Set<string> = new Set<string>(
    recipients
      .filter((recipient: WhoIsToldOwnerRecipient): boolean => {
        return recipient.isNamed && !isPagedAtOnce(recipient);
      })
      .map((recipient: WhoIsToldOwnerRecipient): string => {
        return recipient.name;
      }),
  );

  return {
    ...owners,
    userNames: owners.userNames.filter((name: string): boolean => {
      return !pagedNames.has(name) || stillEmailedNames.has(name);
    }),
    // A team stays while the email reaches a member of it - or lists none of them.
    teamNames: owners.teamNames.filter((teamName: string): boolean => {
      const members: Array<WhoIsToldOwnerRecipient> = recipients.filter(
        (recipient: WhoIsToldOwnerRecipient): boolean => {
          return recipient.teamNames.includes(teamName);
        },
      );

      return (
        members.length === 0 ||
        members.some((recipient: WhoIsToldOwnerRecipient): boolean => {
          return !isPagedAtOnce(recipient);
        })
      );
    }),
    pagedOwners: pagedOwners,
  };
}

/*
 * Whether a record the criteria would open is hidden from a reader (#7213):
 * it is private, and not theirs to see once it exists (canReadPrivateEvent:
 * one of its owners, in a team of them, or a Project Owner or Project
 * Admin). Without canReadPrivateEvent no private record is theirs. The card
 * (redactWhoIsTold) and Setup health (#9370) ask it the same way.
 */
export function isWhoIsToldEventHidden(
  event: WhoIsToldEvent,
  canReadPrivateEvent?: ((event: WhoIsToldEvent) => boolean) | undefined,
): boolean {
  return (
    event.isPrivate === true &&
    !(canReadPrivateEvent ? canReadPrivateEvent(event) : false)
  );
}

/*
 * A CHAIN'S BREAKS AS ONE READER IS TOLD THEM: worked out again without the
 * records hidden from them - a private record that is not theirs raises no
 * break of theirs (#7213) - from the resolver's own facts
 * (WhoIsToldProjectFacts); the resolver's own breaks when it kept none.
 * What a monitor's card says (redactWhoIsTold), and what Setup health lists
 * for the same reader (#9370), so the two never disagree.
 */
export function getWhoIsToldBreaksForReader(data: {
  result: Pick<WhoIsToldResult, "criteria" | "channels" | "breaks" | "facts">;
  isHidden: (event: WhoIsToldEvent) => boolean;
}): Array<WhoIsToldBreak> {
  const facts: WhoIsToldProjectFacts | undefined = data.result.facts;

  if (!facts) {
    return data.result.breaks;
  }

  return getWhoIsToldBreaks({
    criteria: data.result.criteria,
    channels: data.result.channels,
    projectHasIncidentOnCallRules: facts.projectHasIncidentOnCallRules,
    projectHasAlertOnCallRules: facts.projectHasAlertOnCallRules,
    projectHasOnCallPolicies: facts.projectHasOnCallPolicies,
    isHidden: data.isHidden,
  });
}

// Whether any record a chain would open is hidden from the reader.
export function hasWhoIsToldHiddenEvent(
  result: Pick<WhoIsToldResult, "criteria">,
  isHidden: (event: WhoIsToldEvent) => boolean,
): boolean {
  return result.criteria.some((item: WhoIsToldCriteria): boolean => {
    return item.events.some((event: WhoIsToldEvent): boolean => {
      return (
        isHidden(event) ||
        Boolean(event.declares && isHidden(event.declares.incident))
      );
    });
  });
}

// A rule or status page as it is, when the caller may read it; else nameless.
function withNameIfReadable<T extends { id: string; name: string }>(
  item: T,
  readableIds: ReadonlySet<string>,
): T {
  return readableIds.has(item.id) ? item : { ...item, name: "" };
}

/*
 * What a reader is told of a private record that is not theirs to see
 * (#7213): what opens - its kind and severity, which the criteria they may
 * read says - and that it is private, by the privacy rules that make it so
 * as far as they may read them. Nothing of whom it tells, nor its title.
 */
function getHiddenEvent(data: {
  event: WhoIsToldEvent;
  readablePrivacyRuleIds: ReadonlySet<string>;
}): WhoIsToldEvent {
  return {
    kind: data.event.kind,
    title: "",
    severityName: data.event.severityName,
    owners: {
      source: WhoIsToldOwnersSource.Named,
      userNames: [],
      teamNames: [],
    },
    ownerRules: [],
    rules: [],
    policies: [],
    statusPages: [],
    isPrivate: true,
    privacyRules: (data.event.privacyRules || []).map(
      (rule: WhoIsToldRule): WhoIsToldRule => {
        return withNameIfReadable(rule, data.readablePrivacyRuleIds);
      },
    ),
    isHidden: true,
  };
}

/*
 * THE ANSWER AS ONE CALLER MAY SEE IT. Somebody who may read the monitor
 * but not a policy is told paging is set up, and nothing of who: the
 * policy's name, people and gaps are taken away, and so are the names in
 * its breaks. An on-call rule, an owner rule, a privacy, label or alert
 * incident rule, a status page or a monitor group they may not read keeps
 * its place without its name. Who an incident's or an alert's Created
 * email tells is worked out from the policies as they read them
 * (getWhoIsToldOwnersAsTold, #8860).
 *
 * A PRIVATE RECORD THAT IS NOT THEIRS TO SEE (#7213) - canReadPrivateEvent
 * says whether they will be able to read it once it exists: one of its
 * owners, in a team of them, or a Project Owner or Project Admin - says
 * only that it opens, and that it is private; nothing it would tell, and
 * no break it would raise. Without canReadPrivateEvent no private record
 * is theirs. The breaks are worked out again without such records, from
 * the resolver's own facts (WhoIsToldProjectFacts), which, with every
 * record's owner ids, never leave the server.
 */
export function redactWhoIsTold(data: {
  result: WhoIsToldResult;
  readablePolicyIds: ReadonlySet<string>;
  // The on-call rules (incident and alert) the caller may read.
  readableRuleIds: ReadonlySet<string>;
  // The owner rules (incident and alert) the caller may read.
  readableOwnerRuleIds: ReadonlySet<string>;
  readableStatusPageIds: ReadonlySet<string>;
  readableMonitorGroupIds?: ReadonlySet<string> | undefined;
  // The privacy rules (incident and alert) the caller may read.
  readablePrivacyRuleIds?: ReadonlySet<string> | undefined;
  // The label rules (incident and alert) the caller may read.
  readableLabelRuleIds?: ReadonlySet<string> | undefined;
  readableAlertIncidentRuleIds?: ReadonlySet<string> | undefined;
  canReadPrivateEvent?: ((event: WhoIsToldEvent) => boolean) | undefined;
}): WhoIsToldResult {
  const none: ReadonlySet<string> = new Set<string>();
  const readableMonitorGroupIds: ReadonlySet<string> =
    data.readableMonitorGroupIds || none;
  const readablePrivacyRuleIds: ReadonlySet<string> =
    data.readablePrivacyRuleIds || none;
  const readableLabelRuleIds: ReadonlySet<string> =
    data.readableLabelRuleIds || none;
  const readableAlertIncidentRuleIds: ReadonlySet<string> =
    data.readableAlertIncidentRuleIds || none;

  const isReadable: (policyId: string | undefined) => boolean = (
    policyId: string | undefined,
  ): boolean => {
    return !policyId || data.readablePolicyIds.has(policyId);
  };

  const isHidden: (event: WhoIsToldEvent) => boolean = (
    event: WhoIsToldEvent,
  ): boolean => {
    return isWhoIsToldEventHidden(event, data.canReadPrivateEvent);
  };

  const redactPolicy: (policy: WhoIsToldPolicy) => WhoIsToldPolicy = (
    policy: WhoIsToldPolicy,
  ): WhoIsToldPolicy => {
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
  };

  const redactRules: (
    rules: Array<WhoIsToldRule> | undefined,
    readableIds: ReadonlySet<string>,
  ) => Array<WhoIsToldRule> | undefined = (
    rules: Array<WhoIsToldRule> | undefined,
    readableIds: ReadonlySet<string>,
  ): Array<WhoIsToldRule> | undefined => {
    return rules
      ? rules.map((rule: WhoIsToldRule): WhoIsToldRule => {
          return withNameIfReadable(rule, readableIds);
        })
      : undefined;
  };

  const redactEvent: (event: WhoIsToldEvent) => WhoIsToldEvent = (
    event: WhoIsToldEvent,
  ): WhoIsToldEvent => {
    if (isHidden(event)) {
      return getHiddenEvent({
        event: event,
        readablePrivacyRuleIds: readablePrivacyRuleIds,
      });
    }

    // Who will own it is the resolver's to know, never sent.
    const { declares, ...shown } = event;
    delete shown.ownerIds;
    const policies: Array<WhoIsToldPolicy> = event.policies.map(redactPolicy);
    const owners: WhoIsToldOwners = getWhoIsToldOwnersAsTold({
      owners: event.owners,
      policies: policies,
      channels: data.result.channels,
    });

    if (owners.notReached) {
      owners.notReached = owners.notReached.map(
        (owner: WhoIsToldOwnerNotReached): WhoIsToldOwnerNotReached => {
          return owner.rule
            ? {
                ...owner,
                rule: withNameIfReadable(owner.rule, data.readableOwnerRuleIds),
              }
            : owner;
        },
      );
    }

    const redacted: WhoIsToldEvent = {
      ...shown,
      owners: owners,
      ownerRules: event.ownerRules.map((rule: WhoIsToldRule): WhoIsToldRule => {
        return withNameIfReadable(rule, data.readableOwnerRuleIds);
      }),
      rules: event.rules.map((rule: WhoIsToldRule): WhoIsToldRule => {
        return withNameIfReadable(rule, data.readableRuleIds);
      }),
      statusPages: event.statusPages.map(
        (page: WhoIsToldStatusPage): WhoIsToldStatusPage => {
          const named: WhoIsToldStatusPage = withNameIfReadable(
            page,
            data.readableStatusPageIds,
          );

          return page.groups
            ? {
                ...named,
                groups: page.groups.map(
                  (group: WhoIsToldMonitorGroup): WhoIsToldMonitorGroup => {
                    return withNameIfReadable(group, readableMonitorGroupIds);
                  },
                ),
              }
            : named;
        },
      ),
      policies: policies,
    };

    const privacyRules: Array<WhoIsToldRule> | undefined = redactRules(
      event.privacyRules,
      readablePrivacyRuleIds,
    );

    if (privacyRules) {
      redacted.privacyRules = privacyRules;
    }

    const labelRules: Array<WhoIsToldRule> | undefined = redactRules(
      event.labelRules,
      readableLabelRuleIds,
    );

    if (labelRules) {
      redacted.labelRules = labelRules;
    }

    if (declares) {
      redacted.declares = {
        rule: withNameIfReadable(declares.rule, readableAlertIncidentRuleIds),
        waitInMinutes: declares.waitInMinutes,
        incident: redactEvent(declares.incident),
      };
    }

    return redacted;
  };

  /*
   * The reader's breaks: worked out again without what is hidden from them,
   * when the resolver kept what that needs; else the resolver's own.
   */
  const { facts, ...result } = data.result;

  const breaks: Array<WhoIsToldBreak> = getWhoIsToldBreaksForReader({
    result: { ...result, facts: facts },
    isHidden: isHidden,
  });

  return {
    ...result,
    criteria: data.result.criteria.map(
      (item: WhoIsToldCriteria): WhoIsToldCriteria => {
        return {
          ...item,
          events: item.events.map(redactEvent),
        };
      },
    ),
    breaks: breaks
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
