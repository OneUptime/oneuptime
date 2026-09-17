import PageMap from "../../../Utils/PageMap";
import {
  READINESS_STATUS_NOT_REACHABLE,
  ReadinessCoverageCellWire,
  ReadinessDeliveryContext,
  ReadinessMethodWire,
  ResponderSourceValue,
  UserReadinessWire,
  getCoverageGaps,
  getPageForRuleType,
  getRuleTypeLabel,
  getSelfAddressedConsequence,
  getVerifiedMethods,
} from "../../OnCallPolicy/Readiness/ReadinessTypes";
import IconProp from "Common/Types/Icon/IconProp";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";

/*
 * What a person still has to do in User Settings, in the order that decides
 * whether they get woken up.
 *
 * WHY THIS EXISTS. User Settings is eleven destinations across seven side-menu
 * sections, and the relationship between them is invisible from any one of
 * them. A notification METHOD is an address. A notification RULE says which
 * address to use for which severity. A notification SETTING is a different
 * thing again - it governs the ownership mail about incidents you own, not the
 * page that wakes you at 3am - and it shares almost the same name. Somebody who
 * has added a phone number and switched on every toggle in Notification
 * Settings can still be paged by nobody, and nothing on either page says so.
 * This model turns that spread-out state into an ordered list of sentences,
 * each naming one thing to do and the page that does it.
 *
 * WHY IT IS PURE. Everything here is a function of a payload, with no fetching,
 * no React and no clock. That is what lets the interesting half - which steps
 * apply, which are complete, which are somebody else's job, and what each one
 * says - be tested exhaustively without mounting a page or standing up a
 * server. The component layer below it decides only how a step LOOKS.
 *
 * WHY IT DOES NOT COMPUTE READINESS ITSELF. The server already owns the answer
 * to "can this person be paged?" in OnCallReadinessService, and the admin-facing
 * readiness surfaces render exactly that. A checklist that recomputed it from
 * the browser would be a second opinion, and the two would disagree the first
 * time a project switch or a severity moved. So the paging half of this list is
 * derived from the SAME per-user readiness payload the admin sees, and only the
 * steps readiness knows nothing about - workspace links, incoming call numbers,
 * profile fields, the ownership-mail settings - are probed separately.
 */

/**
 * What the reader should do about a step.
 *
 * Four states rather than a boolean, because "not done" is three different
 * situations with three different next actions, and collapsing them produces a
 * list that either nags about things the reader cannot fix or hides things they
 * can:
 *
 *   Complete      - nothing to do.
 *   Incomplete    - the reader can fix this, here, now. The only actionable one.
 *   Blocked       - genuinely wrong, and NOT the reader's to fix. A project
 *                   admin has to move first. Rendering this as a task the
 *                   reader has failed to do is how a checklist loses its
 *                   audience.
 *   NotApplicable - does not apply to this person or this project at all (no
 *                   alert severities exist; the project has no Slack). Shown
 *                   greyed rather than hidden ONLY where its absence would
 *                   itself be surprising; otherwise the section drops it.
 */
export enum SetupStepStatus {
  Complete = "Complete",
  Incomplete = "Incomplete",
  Blocked = "Blocked",
  NotApplicable = "NotApplicable",
}

/**
 * How much it matters, which is the whole basis of the ordering.
 *
 * Required means a page can be lost. Recommended means the reader will be
 * surprised by something, but no page is dropped. Optional means convenience.
 * Only Required and Recommended count towards progress - an optional integration
 * dragging a progress bar down is how a bar stops meaning anything.
 */
export enum SetupStepImportance {
  Required = "Required",
  Recommended = "Recommended",
  Optional = "Optional",
}

export interface SetupStep {
  key: string;
  title: string;
  /** One sentence, second person, saying what this is for. */
  description: string;
  /**
   * The specific thing that is wrong right now - which severities have no rule,
   * which channels are unverified. Empty when the step is complete.
   *
   * Deliberately separate from `description`: the description is stable copy
   * that explains the concept, and this is the part that changes as the
   * reader fixes things. A single blended string would either lose the
   * explanation once there was a gap, or bury the gap inside the explanation.
   */
  detail: string;
  status: SetupStepStatus;
  importance: SetupStepImportance;
  icon: IconProp;
  iconBackgroundClassName: string;
  /**
   * Where this is fixed. Undefined only for Blocked steps, whose fix is not on
   * any page this reader can reach - a link to a page that will refuse them is
   * worse than no link.
   */
  pageMap?: PageMap | undefined;
  /** The affordance line, e.g. "Add a notification method". */
  actionTitle: string;
}

export interface SetupSection {
  key: string;
  title: string;
  description: string;
  steps: Array<SetupStep>;
}

/**
 * The overall verdict, which is NOT simply "are all the steps done".
 *
 * It is the readiness status restated for the person it belongs to, because
 * that is the one sentence worth putting at the top: whether pages reach them,
 * reach them degraded, or are being dropped on the floor right now.
 */
export enum SetupHeadlineStatus {
  Ready = "Ready",
  NeedsSetup = "NeedsSetup",
  NotReachable = "NotReachable",
  NotOnCall = "NotOnCall",
}

export interface SetupChecklist {
  sections: Array<SetupSection>;
  /** Steps that count towards progress: Required + Recommended, and applicable. */
  completedCount: number;
  totalCount: number;
  /**
   * Steps that are genuinely wrong but are an admin's to fix, and so are NOT in
   * the counts above.
   *
   * Surfaced separately because the alternative is a page that can read "4 of 4
   * steps done" directly beneath "Nothing can reach you yet" with no visible
   * explanation - which is exactly what happens to somebody whose only verified
   * method is on a channel the project has switched off. The bar is right and
   * the headline is right; this is the number that reconciles them.
   */
  blockedCount: number;
  isOnCallResponder: boolean;
  headlineStatus: SetupHeadlineStatus;
  headline: string;
  /** Second-person consequence sentence, or "" when there is nothing to warn about. */
  headlineConsequence: string;
}

/*
 * The probes below are all "isKnown plus the answer", never a bare boolean.
 *
 * A probe can fail for reasons that have nothing to do with the reader - a
 * permission they lack, a request that timed out - and the difference between
 * "you have not connected Slack" and "we could not check whether you connected
 * Slack" is the difference between a task and a lie. Every probe that comes
 * back unknown produces NO step rather than a step claiming the reader has not
 * done something. The one claim this checklist never makes on partial evidence
 * is the all-clear, and the same rule applies item by item.
 */

export interface OnCallShiftAlertProbe {
  isKnown: boolean;
  /** Any channel switched on for "when user is on-call roster". */
  hasAnyChannelEnabled: boolean;
}

export interface DeliverableSettingsProbe {
  isKnown: boolean;
  /**
   * Channel labels the reader has switched ON in Notification Settings but has
   * no verified method for, so those toggles deliver nothing. This is the most
   * common silent misconfiguration on that page: the switch turns green whether
   * or not there is an address behind it.
   */
  undeliverableChannels: Array<string>;
}

export interface IncomingCallProbe {
  isKnown: boolean;
  /** Whether this project routes inbound calls to responders at all. */
  hasPolicyInProject: boolean;
  hasVerifiedNumber: boolean;
}

export interface WorkspaceProbe {
  isKnown: boolean;
  /** Whether an admin has connected the workspace to the project at all. */
  isConnectedForProject: boolean;
  isConnectedForUser: boolean;
}

export interface CustomFieldProbe {
  isKnown: boolean;
  fieldCount: number;
  filledFieldCount: number;
}

export interface CalendarFeedProbe {
  isKnown: boolean;
  /** An enabled personal calendar link exists for this project. */
  hasEnabledLink: boolean;
}

export interface SetupChecklistInput {
  readiness: UserReadinessWire;
  /**
   * The project's on-call fallback switch. Required rather than defaulted,
   * because it decides whether a rule gap is a delayed page or a lost one, and
   * a checklist that guesses will reassure somebody whose pages are being
   * dropped.
   */
  isFallbackEnabled: boolean;
  /**
   * FALSE means the switch above could not be read, and the consequence
   * sentence is suppressed entirely rather than written from a default.
   *
   * The two possible sentences here are "those pages still reach you" and
   * "those pages are dropped", and there is no third phrasing that is true
   * either way. Guessing the reassuring one is the specific mistake that would
   * cost somebody a page; guessing the alarming one teaches them the warning is
   * noise. Saying nothing costs a sentence, and the steps below still name
   * every gap.
   */
  isFallbackKnown: boolean;
  onCallShiftAlerts: OnCallShiftAlertProbe;
  deliverableSettings: DeliverableSettingsProbe;
  incomingCall: IncomingCallProbe;
  slack: WorkspaceProbe;
  microsoftTeams: WorkspaceProbe;
  customFields: CustomFieldProbe;
  /**
   * Optional so that callers (and fixtures) written before calendar feeds
   * existed keep working; absent reads as unknown, which produces no step.
   */
  calendarFeed?: CalendarFeedProbe | undefined;
}

/*
 * The four severity-scoped rule types, in the order a reader meets them, with
 * the copy for each.
 *
 * Order is fixed here rather than taken from the payload for the same reason
 * the coverage matrix fixes its columns: a list that reshuffles between visits
 * cannot be learned, and this is a page people come back to.
 */
interface RuleTypeStepDefinition {
  key: string;
  ruleType: NotificationRuleType;
  title: string;
  description: string;
  icon: IconProp;
  iconBackgroundClassName: string;
}

const RULE_TYPE_STEPS: Array<RuleTypeStepDefinition> = [
  {
    key: "incident-rules",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    title: "Say how to reach you for incidents",
    description:
      "For each incident severity, choose which of your methods to try and how long to wait before the next one.",
    icon: IconProp.Alert,
    iconBackgroundClassName: "bg-rose-500",
  },
  {
    key: "incident-episode-rules",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    title: "Say how to reach you for incident episodes",
    description:
      "Episodes group related incidents. They page you separately, so they need their own rules.",
    icon: IconProp.Squares,
    iconBackgroundClassName: "bg-rose-400",
  },
  {
    key: "alert-rules",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    title: "Say how to reach you for alerts",
    description:
      "Alerts have their own severities and their own rules, separate from incidents.",
    icon: IconProp.ExclaimationCircle,
    iconBackgroundClassName: "bg-amber-500",
  },
  {
    key: "alert-episode-rules",
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    title: "Say how to reach you for alert episodes",
    description:
      "Episodes group related alerts. They page you separately, so they need their own rules.",
    icon: IconProp.Squares,
    iconBackgroundClassName: "bg-amber-400",
  },
];

type JoinWithAndFunction = (items: Array<string>) => string;

const joinWithAnd: JoinWithAndFunction = (items: Array<string>): string => {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0]!;
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

/*
 * At most this many severities are named before the sentence stops listing
 * them. A project with sixteen severities and a brand new responder produces a
 * gap line longer than the tile it sits in, and a line nobody finishes reading
 * conveys less than "12 severities" does.
 */
const MAX_NAMED_SEVERITIES: number = 3;

type DescribeGapsFunction = (gaps: Array<ReadinessCoverageCellWire>) => string;

const describeGapSeverities: DescribeGapsFunction = (
  gaps: Array<ReadinessCoverageCellWire>,
): string => {
  const names: Array<string> = gaps
    .map((gap: ReadinessCoverageCellWire): string => {
      return gap.severityName || "";
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (names.length === 0) {
    /*
     * A cell with no severity name is possible on the wire (the field is
     * optional), and counting is still truthful when naming is not.
     */
    return gaps.length === 1
      ? "1 severity has no rule."
      : `${gaps.length} severities have no rule.`;
  }

  if (names.length <= MAX_NAMED_SEVERITIES) {
    const subject: string = names.length === 1 ? "has" : "have";

    return `${joinWithAnd(names)} ${subject} no rule.`;
  }

  const shown: Array<string> = names.slice(0, MAX_NAMED_SEVERITIES);
  const remaining: number = names.length - MAX_NAMED_SEVERITIES;

  return `${shown.join(", ")} and ${remaining} more have no rule.`;
};

type CountMethodsFunction = (readiness: UserReadinessWire) => number;

const countUnverifiedMethods: CountMethodsFunction = (
  readiness: UserReadinessWire,
): number => {
  return readiness.methods.filter((method: ReadinessMethodWire): boolean => {
    return !method.isVerified;
  }).length;
};

type BuildStepsFunction = (input: SetupChecklistInput) => Array<SetupStep>;

/*
 * Section 1 - the steps that decide whether a page arrives at all.
 *
 * Ordered by how completely each failure loses the page: no method means
 * nothing can ever reach you; an unverified method looks configured and is not;
 * a verified method on a channel the project has switched off is the trap that
 * catches SMS-first users, because all four paid channels default to off on a
 * project and readiness will call them unreachable while their settings page
 * shows a green verified tick.
 */
const buildReachabilitySteps: BuildStepsFunction = (
  input: SetupChecklistInput,
): Array<SetupStep> => {
  const readiness: UserReadinessWire = input.readiness;
  const verifiedMethods: Array<ReadinessMethodWire> =
    getVerifiedMethods(readiness);
  const unverifiedCount: number = countUnverifiedMethods(readiness);
  const isNotReachable: boolean =
    readiness.status === READINESS_STATUS_NOT_REACHABLE;

  const steps: Array<SetupStep> = [];

  steps.push({
    key: "add-method",
    title: "Add a way for us to reach you",
    description:
      "An email address, phone number, push device or webhook. Without one, nothing OneUptime sends can arrive.",
    detail:
      readiness.methods.length > 0
        ? ""
        : "You have no notification methods on this project.",
    status:
      readiness.methods.length > 0
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
    importance: SetupStepImportance.Required,
    icon: IconProp.Bell,
    iconBackgroundClassName: "bg-indigo-500",
    pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    actionTitle: "Add a notification method",
  });

  /*
   * Only asked once something has been added. Telling somebody with no methods
   * at all to "verify your methods" is a second task for the same single
   * action, and it makes the list look longer than the work.
   */
  if (readiness.methods.length > 0) {
    steps.push({
      key: "verify-methods",
      title: "Verify every method you added",
      description:
        "An unverified method looks configured but is never used. Verification is what proves the address reaches you.",
      detail:
        unverifiedCount === 0
          ? ""
          : unverifiedCount === 1
            ? "1 method is still waiting to be verified."
            : `${unverifiedCount} methods are still waiting to be verified.`,
      status:
        unverifiedCount === 0
          ? SetupStepStatus.Complete
          : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Required,
      icon: IconProp.CheckCircle,
      iconBackgroundClassName: "bg-emerald-500",
      pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      actionTitle: "Verify your methods",
    });
  }

  /*
   * The channel trap, and the one step on this page whose fix belongs to
   * somebody else.
   *
   * A verified method on a channel the project has switched off is worth
   * nothing, and readiness reports exactly that shape: NotReachable while
   * verified methods exist. The reader cannot switch a project channel on, so
   * this carries no link - it names what to ask for instead.
   */
  if (verifiedMethods.length > 0) {
    const isChannelBlocked: boolean = isNotReachable;

    /*
     * The claim is deliberately "at least one", not "all of them".
     *
     * Readiness reports one bit here - NotReachable or not - which answers
     * whether ANY verified method is on a channel this project allows. It
     * cannot say whether a SECOND method is on a channel that is switched off,
     * because a user with a usable email and an unusable SMS looks identical on
     * the wire to a user with only the email. So the completed state promises
     * exactly what is known and no more; a title reading "your channels are
     * switched on" would be a claim about all of them, and false for that user.
     */
    steps.push({
      key: "channels-enabled",
      title: "At least one of your channels is usable here",
      description:
        "A project can switch off SMS, calls, WhatsApp and Telegram. A verified method on a channel that is off cannot be used.",
      detail: isChannelBlocked
        ? "Every method you have verified is on a channel this project has switched off. Ask a project admin to enable it, or add an email or push device instead."
        : "",
      status: isChannelBlocked
        ? SetupStepStatus.Blocked
        : SetupStepStatus.Complete,
      importance: SetupStepImportance.Required,
      icon: IconProp.Settings,
      /*
       * Undefined on purpose. Project notification settings are an admin
       * screen; linking a reader who will be refused there is worse than
       * telling them who to ask.
       */
      pageMap: isChannelBlocked
        ? undefined
        : PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      iconBackgroundClassName: "bg-slate-500",
      actionTitle: isChannelBlocked
        ? "Ask a project admin to enable this channel"
        : "Review your methods",
    });
  }

  return steps;
};

/*
 * Section 2 - one step per rule type, which is also one step per confusing page
 * in the side menu.
 *
 * These four pages are the ones people cannot tell apart, so each step says in
 * a sentence what its page is FOR before it says what is missing from it.
 */
const buildRuleSteps: BuildStepsFunction = (
  input: SetupChecklistInput,
): Array<SetupStep> => {
  const gaps: Array<ReadinessCoverageCellWire> = getCoverageGaps(
    input.readiness,
  );

  return RULE_TYPE_STEPS.map(
    (definition: RuleTypeStepDefinition): SetupStep => {
      const cellsForType: Array<ReadinessCoverageCellWire> =
        input.readiness.coverage.filter(
          (cell: ReadinessCoverageCellWire): boolean => {
            return cell.ruleType === definition.ruleType;
          },
        );

      const gapsForType: Array<ReadinessCoverageCellWire> = gaps.filter(
        (cell: ReadinessCoverageCellWire): boolean => {
          return cell.ruleType === definition.ruleType;
        },
      );

      /*
       * No cells at all means the project has no severities of this kind, so
       * there is nothing to configure and nothing to congratulate. Calling that
       * "done" would credit the reader for work that does not exist, and would
       * silently turn into a real gap the day an admin adds the first severity.
       */
      const status: SetupStepStatus =
        cellsForType.length === 0
          ? SetupStepStatus.NotApplicable
          : gapsForType.length === 0
            ? SetupStepStatus.Complete
            : SetupStepStatus.Incomplete;

      const detail: string =
        status === SetupStepStatus.NotApplicable
          ? `This project has no ${getRuleTypeLabel(
              definition.ruleType,
            ).toLowerCase()} severities yet.`
          : status === SetupStepStatus.Incomplete
            ? describeGapSeverities(gapsForType)
            : "";

      return {
        key: definition.key,
        title: definition.title,
        description: definition.description,
        detail: detail,
        status: status,
        importance: SetupStepImportance.Required,
        icon: definition.icon,
        iconBackgroundClassName: definition.iconBackgroundClassName,
        pageMap: getPageForRuleType(definition.ruleType),
        actionTitle: "Set up these rules",
      };
    },
  );
};

/*
 * Section 3 - the things that surprise people rather than drop pages.
 *
 * Both steps here exist because Notification SETTINGS and notification RULES
 * are different systems with almost the same name, and the settings page gives
 * no feedback about whether a switch it turned green can actually deliver.
 */
const buildAwarenessSteps: BuildStepsFunction = (
  input: SetupChecklistInput,
): Array<SetupStep> => {
  const steps: Array<SetupStep> = [];

  /*
   * Gated on being reached through a SCHEDULE, not merely on being a responder.
   *
   * The "you are now on call" notification is emitted by
   * OnCallDutyPolicyScheduleService when a schedule's roster rotates. Somebody
   * attached to a policy directly, or through a team, or by an override has no
   * roster to rotate, so that event never fires for them and this step would be
   * a switch about something that cannot happen - which is exactly the kind of
   * row that teaches people to stop reading the list.
   */
  const isOnCallBySchedule: boolean = input.readiness.reachedVia.some(
    (source: ResponderSourceValue): boolean => {
      return source === "Schedule";
    },
  );

  if (isOnCallBySchedule && input.onCallShiftAlerts.isKnown) {
    steps.push({
      key: "on-call-shift-alerts",
      title: "Know when your on-call shift starts",
      description:
        "Separate from being paged: this is the heads-up that your turn on the roster has begun.",
      detail: input.onCallShiftAlerts.hasAnyChannelEnabled
        ? ""
        : "No channel is switched on for the on-call roster notification, so your shift will start without telling you.",
      status: input.onCallShiftAlerts.hasAnyChannelEnabled
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Recommended,
      icon: IconProp.Clock,
      iconBackgroundClassName: "bg-sky-500",
      pageMap: PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS,
      actionTitle: "Open notification settings",
    });
  }

  if (input.deliverableSettings.isKnown) {
    const undeliverable: Array<string> =
      input.deliverableSettings.undeliverableChannels;

    steps.push({
      key: "deliverable-settings",
      title: "Your notification settings point at channels that work",
      description:
        "Switching a channel on in Notification Settings does nothing unless you have a verified method on that channel.",
      detail:
        undeliverable.length === 0
          ? ""
          : `You switched on ${joinWithAnd(
              undeliverable,
            )}, but have no verified method there, so those updates are not sent.`,
      status:
        undeliverable.length === 0
          ? SetupStepStatus.Complete
          : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Recommended,
      icon: IconProp.Info,
      iconBackgroundClassName: "bg-violet-500",
      pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      actionTitle: "Add the missing method",
    });
  }

  return steps;
};

/*
 * Section 4 - convenience, and everything whose applicability depends on what
 * the project has set up.
 *
 * Every step here is omitted entirely rather than shown as not-applicable when
 * its precondition fails. A reader in a project with no Slack has no use for a
 * greyed Slack row; a reader in a project with no custom fields has no use for
 * a greyed custom fields row. Section 2 is different - a missing alert severity
 * is worth seeing, because it explains why a page they expected does not exist.
 */
const buildOptionalSteps: BuildStepsFunction = (
  input: SetupChecklistInput,
): Array<SetupStep> => {
  const steps: Array<SetupStep> = [];

  if (input.incomingCall.isKnown && input.incomingCall.hasPolicyInProject) {
    steps.push({
      key: "incoming-call-number",
      title: "Add a number for inbound calls",
      description:
        "This project routes incoming phone calls to whoever is on call. Without a verified number, calls skip you.",
      detail: input.incomingCall.hasVerifiedNumber
        ? ""
        : "You have no verified incoming call number on this project.",
      status: input.incomingCall.hasVerifiedNumber
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Optional,
      icon: IconProp.Call,
      iconBackgroundClassName: "bg-teal-500",
      pageMap: PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS,
      actionTitle: "Add an incoming call number",
    });
  }

  if (input.slack.isKnown && input.slack.isConnectedForProject) {
    steps.push({
      key: "slack",
      title: "Connect your Slack account",
      description:
        "Acknowledge incidents and get messages from OneUptime as yourself, in Slack.",
      detail: input.slack.isConnectedForUser
        ? ""
        : "This project is connected to Slack, but your account is not linked yet.",
      status: input.slack.isConnectedForUser
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Optional,
      icon: IconProp.Slack,
      iconBackgroundClassName: "bg-fuchsia-500",
      pageMap: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
      actionTitle: "Connect Slack",
    });
  }

  if (
    input.microsoftTeams.isKnown &&
    input.microsoftTeams.isConnectedForProject
  ) {
    steps.push({
      key: "microsoft-teams",
      title: "Connect your Microsoft Teams account",
      description:
        "Acknowledge incidents and get messages from OneUptime as yourself, in Teams.",
      detail: input.microsoftTeams.isConnectedForUser
        ? ""
        : "This project is connected to Microsoft Teams, but your account is not linked yet.",
      status: input.microsoftTeams.isConnectedForUser
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Optional,
      icon: IconProp.MicrosoftTeams,
      iconBackgroundClassName: "bg-blue-500",
      pageMap: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      actionTitle: "Connect Microsoft Teams",
    });
  }

  /*
   * Only when the probe answered: an older API has no calendar feeds at all,
   * and a task pointing at a page that says "not supported" is a task nobody
   * can complete.
   */
  if (input.calendarFeed && input.calendarFeed.isKnown) {
    steps.push({
      key: "calendar-feed",
      title: "Add your on-call shifts to your calendar",
      description:
        "Subscribe to a private link from Google Calendar, Outlook or Apple Calendar so your shifts show up next to everything else.",
      detail: input.calendarFeed.hasEnabledLink
        ? ""
        : "You have not generated a calendar link for this project yet.",
      status: input.calendarFeed.hasEnabledLink
        ? SetupStepStatus.Complete
        : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Optional,
      icon: IconProp.Calendar,
      iconBackgroundClassName: "bg-indigo-500",
      pageMap: PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED,
      actionTitle: "Generate a calendar link",
    });
  }

  if (input.customFields.isKnown && input.customFields.fieldCount > 0) {
    const missing: number =
      input.customFields.fieldCount - input.customFields.filledFieldCount;

    steps.push({
      key: "custom-fields",
      title: "Fill in your profile fields",
      description:
        "Your project asks team members for a few extra details, like a desk phone or a timezone.",
      detail:
        missing <= 0
          ? ""
          : missing === 1
            ? "1 field is still empty."
            : `${missing} fields are still empty.`,
      status:
        missing <= 0 ? SetupStepStatus.Complete : SetupStepStatus.Incomplete,
      importance: SetupStepImportance.Optional,
      icon: IconProp.TableCells,
      iconBackgroundClassName: "bg-gray-500",
      pageMap: PageMap.USER_SETTINGS_CUSTOM_FIELDS,
      actionTitle: "Fill in your details",
    });
  }

  return steps;
};

type IsCountedFunction = (step: SetupStep) => boolean;

/*
 * Which steps the progress bar is allowed to speak for.
 *
 * Optional steps are excluded so that connecting Slack cannot make somebody
 * look ready when no page can reach them. Blocked and NotApplicable steps are
 * excluded because neither is work the reader can do, and a bar that can never
 * reach its end is a bar people stop reading.
 */
const isCountedTowardsProgress: IsCountedFunction = (
  step: SetupStep,
): boolean => {
  if (step.importance === SetupStepImportance.Optional) {
    return false;
  }

  return (
    step.status === SetupStepStatus.Complete ||
    step.status === SetupStepStatus.Incomplete
  );
};

type BuildChecklistFunction = (input: SetupChecklistInput) => SetupChecklist;

/**
 * The whole list, ordered, with its headline.
 *
 * Sections with no steps are dropped rather than rendered empty - an empty
 * "Optional" heading is a promise of content that is not there.
 */
export const buildSetupChecklist: BuildChecklistFunction = (
  input: SetupChecklistInput,
): SetupChecklist => {
  const isOnCallResponder: boolean = input.readiness.reachedVia.length > 0;

  const candidateSections: Array<SetupSection> = [
    {
      key: "reachability",
      title: "So we can reach you",
      description:
        "Where OneUptime sends things. Everything else on this page depends on getting this right first.",
      steps: buildReachabilitySteps(input),
    },
    {
      key: "paging",
      title: "How you want to be paged",
      description: isOnCallResponder
        ? "You are on call in this project. These four pages decide which of your methods is tried, and in what order, for each severity."
        : "You are not on an on-call policy in this project yet. Setting these up now means you are covered the day somebody adds you.",
      steps: buildRuleSteps(input),
    },
    {
      key: "awareness",
      title: "Staying informed",
      /*
       * "Updates about work you own" was the first draft and it was wrong: the
       * On-Call card on that page carries roster and policy-membership events,
       * which are about the reader's shifts rather than about anything they
       * own. The distinction that actually matters, and the one people get
       * wrong, is settings-versus-rules - so that is what this says.
       */
      description:
        "Notification settings are a different system from your on-call rules: they cover updates about your work and your shifts, not the page that wakes you when something fires.",
      steps: buildAwarenessSteps(input),
    },
    {
      key: "optional",
      title: "Nice to have",
      /*
       * Scoped to incidents and alerts on purpose. A blanket "these do not
       * affect whether you are reached" would be false the moment the
       * incoming-call row is in this section - an unset inbound number does
       * make a caller skip past this responder.
       */
      description:
        "Optional, and not counted in your progress. None of these change how an incident or alert pages you.",
      steps: buildOptionalSteps(input),
    },
  ];

  const sections: Array<SetupSection> = candidateSections.filter(
    (section: SetupSection): boolean => {
      return section.steps.length > 0;
    },
  );

  const countedSteps: Array<SetupStep> = sections
    .flatMap((section: SetupSection): Array<SetupStep> => {
      return section.steps;
    })
    .filter(isCountedTowardsProgress);

  const completedCount: number = countedSteps.filter(
    (step: SetupStep): boolean => {
      return step.status === SetupStepStatus.Complete;
    },
  ).length;

  const delivery: ReadinessDeliveryContext = {
    isFallbackEnabled: input.isFallbackEnabled,
  };

  const allSteps: Array<SetupStep> = sections.flatMap(
    (section: SetupSection): Array<SetupStep> => {
      return section.steps;
    },
  );

  const blockedCount: number = allSteps.filter((step: SetupStep): boolean => {
    return step.status === SetupStepStatus.Blocked;
  }).length;

  const headlineStatus: SetupHeadlineStatus = getHeadlineStatus({
    input: input,
    isOnCallResponder: isOnCallResponder,
    hasOutstandingCountedSteps: completedCount < countedSteps.length,
  });

  return {
    sections: sections,
    completedCount: completedCount,
    totalCount: countedSteps.length,
    blockedCount: blockedCount,
    isOnCallResponder: isOnCallResponder,
    headlineStatus: headlineStatus,
    headline: getHeadline(headlineStatus),
    /*
     * The consequence sentence is the server's own second-person copy, reused
     * rather than rewritten so that this page and the reminder email a project
     * admin can send describe the same situation in the same words.
     *
     * Three cases where it is suppressed rather than printed:
     *
     *   - the reader is ready, and "a rule for every severity and rule type" is
     *     a true sentence that still reads as a warning;
     *   - the fallback switch could not be read, so neither of the two possible
     *     endings is known to be true (see isFallbackKnown);
     *   - the reader is NOT ON CALL. Every branch of this sentence ends in what
     *     happens to "pages routed to you", and no pages are routed to somebody
     *     no policy reaches. Printing it anyway describes a consequence that
     *     cannot currently occur, which is the fastest way to teach a reader
     *     that this page overstates things. The steps below still name every
     *     gap, so nothing is hidden - only the tense is honest.
     */
    headlineConsequence:
      headlineStatus === SetupHeadlineStatus.Ready ||
      headlineStatus === SetupHeadlineStatus.NotOnCall ||
      !isOnCallResponder ||
      !input.isFallbackKnown
        ? ""
        : asSentence(getSelfAddressedConsequence(input.readiness, delivery)),
  };
};

type AsSentenceFunction = (clause: string) => string;

/*
 * getSelfAddressedConsequence returns a CLAUSE, not a sentence.
 *
 * Its own comment says so: every branch is written to complete "...you are a
 * responder on an on-call policy, but ", which is how the setup-reminder email
 * uses it, and so each one opens lower-case and carries no leading subject.
 * This surface has no such preamble - the headline above it is a heading, not
 * the first half of a sentence - so printed verbatim it would start a paragraph
 * with a small letter.
 *
 * Capitalising here rather than changing the shared helper is deliberate: the
 * email is the older caller and its sentence is correct as it stands, and a
 * helper that returned a capitalised clause would break it.
 */
const asSentence: AsSentenceFunction = (clause: string): string => {
  if (!clause) {
    return "";
  }

  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
};

type GetHeadlineStatusFunction = (params: {
  input: SetupChecklistInput;
  isOnCallResponder: boolean;
  hasOutstandingCountedSteps: boolean;
}) => SetupHeadlineStatus;

const getHeadlineStatus: GetHeadlineStatusFunction = (params: {
  input: SetupChecklistInput;
  isOnCallResponder: boolean;
  hasOutstandingCountedSteps: boolean;
}): SetupHeadlineStatus => {
  if (params.input.readiness.status === READINESS_STATUS_NOT_REACHABLE) {
    /*
     * Red regardless of whether they are on call today. Somebody unreachable
     * who gets added to a policy tomorrow is unreachable from that moment, and
     * this is the only screen that would have told them.
     */
    return SetupHeadlineStatus.NotReachable;
  }

  if (getCoverageGaps(params.input.readiness).length > 0) {
    return SetupHeadlineStatus.NeedsSetup;
  }

  /*
   * The headline speaks for the WHOLE list, not only for the paging half.
   *
   * Readiness can be Ready while a counted step is still outstanding - an
   * unverified spare method, a notification setting switched on for a channel
   * with no address behind it. "You are all set" printed directly above a row
   * the reader still has to do is the kind of small contradiction that costs a
   * surface its credibility, and it costs it on the first visit.
   */
  if (params.hasOutstandingCountedSteps) {
    return SetupHeadlineStatus.NeedsSetup;
  }

  if (!params.isOnCallResponder) {
    return SetupHeadlineStatus.NotOnCall;
  }

  return SetupHeadlineStatus.Ready;
};

type GetHeadlineFunction = (status: SetupHeadlineStatus) => string;

const getHeadline: GetHeadlineFunction = (
  status: SetupHeadlineStatus,
): string => {
  switch (status) {
    case SetupHeadlineStatus.NotReachable:
      return "Nothing can reach you yet";
    case SetupHeadlineStatus.NeedsSetup:
      return "A few things still need setting up";
    case SetupHeadlineStatus.NotOnCall:
      return "You are set up, and not on call right now";
    default:
      return "You are all set";
  }
};
