import UserNotificationStatus from "../UserNotification/UserNotificationStatus";

/*
 * The moments that say a project is getting value from OneUptime (issue
 * #6830): its activation milestones.
 *
 * Each is kept once per project, as the moment it first became true - a row
 * of ProjectMilestone, written by ProjectMilestoneService.reach() on the
 * server, where the thing happens - and is sent once to product analytics as
 * `activation/<milestone>` (getActivationMilestoneEventName), where product
 * analytics runs at all: OneUptime Cloud. A self-hosted server keeps its rows
 * to itself.
 *
 * A value is the stored string and the second half of the event's name: one
 * name for the moment in the database, in the code and in the funnel
 * (Docs/analytics/activation.md). Never rename one - the rows already kept
 * and the events already sent keep the old name - and never reuse one for
 * another moment. A new milestone is a new value here, a line in
 * ACTIVATION_MILESTONE_DETAILS, a call to reach() where it happens, and a
 * row in Docs/analytics/activation.md: the table needs no migration.
 *
 * Pure types: the Dashboard, the Admin Dashboard and the server read them.
 */
enum ActivationMilestone {
  // The first monitor of the project was created (any type, by anyone).
  FirstMonitorCreated = "first_monitor_created",

  /*
   * A monitor's check result was stored for the first time: a probe's
   * result, an incoming request or heartbeat, a server or email monitor's
   * report. Only a result that passed every refusal (archived, disabled,
   * blocked, a probe not assigned) is stored.
   */
  FirstCheckResultReceived = "first_check_result_received",

  /*
   * An on-call page reached a member: OneUptime sent it through one of
   * their notification methods - any channel - and the provider accepted it.
   */
  FirstNotificationDelivered = "first_notification_delivered",

  // A member acknowledged a test page (issue #6811 sends those).
  FirstTestPageAcknowledged = "first_test_page_acknowledged",

  /*
   * A person acknowledged an incident or an alert, by the product's one rule
   * (Common/Utils/AcknowledgedState): moved it to the acknowledged state, a
   * state after it, or a resolved one.
   */
  FirstIncidentOrAlertAcknowledged = "first_incident_or_alert_acknowledged",

  // A second person accepted to be in the project.
  SecondMemberJoined = "second_member_joined",

  // A status page shows a monitor, or a monitor group, for the first time.
  FirstStatusPageMonitorAdded = "first_status_page_monitor_added",

  // A status page has its first subscriber who can be sent updates.
  FirstStatusPageSubscriberAdded = "first_status_page_subscriber_added",

  /*
   * An on-call policy ran for the first time: an incident, an alert, an
   * episode or a person started it. A policy that exists but nothing runs
   * does not count.
   */
  FirstOnCallPolicyExecuted = "first_on_call_policy_executed",

  /*
   * The first telemetry of each kind ClickHouse accepted for the project
   * (the per-kind marks issue #6534 reads too).
   */
  FirstLogsReceived = "first_logs_received",
  FirstTracesReceived = "first_traces_received",
  FirstMetricsReceived = "first_metrics_received",
  FirstExceptionsReceived = "first_exceptions_received",
  FirstProfilesReceived = "first_profiles_received",
}

export default ActivationMilestone;

// The area every milestone's event is filed under (`area/thing_happened`).
export const ACTIVATION_EVENT_AREA: string = "activation";

export const getActivationMilestoneEventName: (
  milestone: ActivationMilestone,
) => string = (milestone: ActivationMilestone): string => {
  return `${ACTIVATION_EVENT_AREA}/${milestone}`;
};

export interface ActivationMilestoneDetail {
  milestone: ActivationMilestone;
  // What it means, in a few words, for a list of milestones.
  title: string;
  // What a project that has not reached it is missing, in a few words.
  missingText: string;
}

/*
 * Every milestone, in the order a project usually meets them: the order a
 * list shows them in. The Admin Dashboard's project view reads the words.
 */
export const ACTIVATION_MILESTONE_DETAILS: ReadonlyArray<ActivationMilestoneDetail> =
  [
    {
      milestone: ActivationMilestone.FirstMonitorCreated,
      title: "First monitor created",
      missingText: "No monitor yet",
    },
    {
      milestone: ActivationMilestone.FirstCheckResultReceived,
      title: "First check result received",
      missingText: "No check result yet",
    },
    {
      milestone: ActivationMilestone.FirstNotificationDelivered,
      title: "First on-call page delivered",
      missingText: "Nobody reachable yet",
    },
    {
      milestone: ActivationMilestone.FirstTestPageAcknowledged,
      title: "First test page acknowledged",
      missingText: "No test page acknowledged yet",
    },
    {
      milestone: ActivationMilestone.FirstIncidentOrAlertAcknowledged,
      title: "First incident or alert acknowledged",
      missingText: "Nothing acknowledged yet",
    },
    {
      milestone: ActivationMilestone.SecondMemberJoined,
      title: "Second person joined",
      missingText: "Only one person",
    },
    {
      milestone: ActivationMilestone.FirstStatusPageMonitorAdded,
      title: "First status page that shows a monitor",
      missingText: "No status page with a monitor yet",
    },
    {
      milestone: ActivationMilestone.FirstStatusPageSubscriberAdded,
      title: "First status page subscriber",
      missingText: "No status page subscriber yet",
    },
    {
      milestone: ActivationMilestone.FirstOnCallPolicyExecuted,
      title: "First on-call policy run",
      missingText: "No on-call policy has run yet",
    },
    {
      milestone: ActivationMilestone.FirstLogsReceived,
      title: "First logs received",
      missingText: "No logs yet",
    },
    {
      milestone: ActivationMilestone.FirstTracesReceived,
      title: "First traces received",
      missingText: "No traces yet",
    },
    {
      milestone: ActivationMilestone.FirstMetricsReceived,
      title: "First metrics received",
      missingText: "No metrics yet",
    },
    {
      milestone: ActivationMilestone.FirstExceptionsReceived,
      title: "First exceptions received",
      missingText: "No exceptions yet",
    },
    {
      milestone: ActivationMilestone.FirstProfilesReceived,
      title: "First profiles received",
      missingText: "No profiles yet",
    },
  ];

export const ALL_ACTIVATION_MILESTONES: ReadonlyArray<ActivationMilestone> =
  ACTIVATION_MILESTONE_DETAILS.map(
    (detail: ActivationMilestoneDetail): ActivationMilestone => {
      return detail.milestone;
    },
  );

export const isActivationMilestone: (
  value: unknown,
) => value is ActivationMilestone = (
  value: unknown,
): value is ActivationMilestone => {
  return (
    typeof value === "string" &&
    (ALL_ACTIVATION_MILESTONES as ReadonlyArray<string>).includes(value)
  );
};

export const getActivationMilestoneDetail: (
  milestone: ActivationMilestone,
) => ActivationMilestoneDetail = (
  milestone: ActivationMilestone,
): ActivationMilestoneDetail => {
  return ACTIVATION_MILESTONE_DETAILS.find(
    (detail: ActivationMilestoneDetail): boolean => {
      return detail.milestone === milestone;
    },
  )!;
};

/*
 * The steps the first hour is measured by, in order: a project that has
 * these can tell its team when something breaks. The first one a project
 * has not reached is where it is stuck (getActivationStuckAt) - what the
 * Admin Dashboard's project list says, and the funnel's main path
 * (Docs/analytics/activation.md).
 *
 * The test page (#6811) and the status page come after these in the funnel,
 * but a project that never wants either is not stuck without them, so they
 * are not steps here.
 */
export const ACTIVATION_SETUP_STEPS: ReadonlyArray<ActivationMilestone> = [
  ActivationMilestone.FirstMonitorCreated,
  ActivationMilestone.FirstCheckResultReceived,
  ActivationMilestone.FirstNotificationDelivered,
];

// The first setup step the project has not reached, or null when it has all.
export const getActivationStuckAt: (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
) => ActivationMilestone | null = (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
): ActivationMilestone | null => {
  const reachedSet: Set<ActivationMilestone> =
    reached instanceof Set ? reached : new Set(reached);

  for (const step of ACTIVATION_SETUP_STEPS) {
    if (!reachedSet.has(step)) {
      return step;
    }
  }

  return null;
};

// What a list of projects says about one: where it is stuck, or that it is set up.
export interface ActivationSetupSummary {
  stuckAt: ActivationMilestone | null;
  isSetUp: boolean;
  text: string;
}

export const ACTIVATION_SET_UP_TEXT: string = "Set up";

export const getActivationSetupSummary: (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
) => ActivationSetupSummary = (
  reached: ReadonlyArray<ActivationMilestone> | Set<ActivationMilestone>,
): ActivationSetupSummary => {
  const stuckAt: ActivationMilestone | null = getActivationStuckAt(reached);

  return {
    stuckAt: stuckAt,
    isSetUp: stuckAt === null,
    text: stuckAt
      ? getActivationMilestoneDetail(stuckAt).missingText
      : ACTIVATION_SET_UP_TEXT,
  };
};

/*
 * The telemetry milestone of each kind ClickHouse stores it as. Every table
 * the fan-in writer fills for a kind is listed: a profile is stored in two.
 */
export enum ActivationTelemetryKind {
  Logs = "logs",
  Traces = "traces",
  Metrics = "metrics",
  Exceptions = "exceptions",
  Profiles = "profiles",
}

export const ACTIVATION_MILESTONE_OF_TELEMETRY_KIND: Readonly<
  Record<ActivationTelemetryKind, ActivationMilestone>
> = {
  [ActivationTelemetryKind.Logs]: ActivationMilestone.FirstLogsReceived,
  [ActivationTelemetryKind.Traces]: ActivationMilestone.FirstTracesReceived,
  [ActivationTelemetryKind.Metrics]: ActivationMilestone.FirstMetricsReceived,
  [ActivationTelemetryKind.Exceptions]:
    ActivationMilestone.FirstExceptionsReceived,
  [ActivationTelemetryKind.Profiles]:
    ActivationMilestone.FirstProfilesReceived,
};

/*
 * The statuses of an on-call notification that say it reached its person:
 * its provider accepted it (Sent), they answered it (Acknowledged), passed
 * the page on from it (Passed On), or a call rang and was not picked up
 * (Not Answered). Not one still Sending, an Error or one Skipped.
 * FirstNotificationDelivered is reached on the first of these.
 */
export const DELIVERED_NOTIFICATION_STATUSES: ReadonlyArray<UserNotificationStatus> =
  [
    UserNotificationStatus.Sent,
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.NotAnswered,
  ];

export const isNotificationDeliveredStatus: (
  status: UserNotificationStatus | string | null | undefined,
) => boolean = (
  status: UserNotificationStatus | string | null | undefined,
): boolean => {
  return (
    typeof status === "string" &&
    (DELIVERED_NOTIFICATION_STATUSES as ReadonlyArray<string>).includes(status)
  );
};
