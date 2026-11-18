import { GuidedSetupStepProgress } from "../GuidedSetupProgress";
import { WhoIsToldMode } from "../WebsiteDown/WebsiteDownSetup";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import { Translator, translationKey } from "Common/Types/Translator";

/*
 * GUIDED SETUP: SEND LOGS, METRICS AND TRACES, THEN GET ALERTED ON THEM
 * (issue #6806), drawn in GuidedSetupFrame like the website-down setup
 * (#6804). One setup for the three signals: the same OpenTelemetry SDK
 * sends all of them, and each product keeps its own first-run dialog.
 *
 *   1. Send your first data: the setup guide every telemetry product has
 *      (a method, an ingestion key, install and configure), unchanged, and
 *      the wait the first-run dialog has, until a service reports. A
 *      project that has a reporting service already can pick it instead.
 *      Data that arrives naming no service says so, and how to name one
 *      (#7888): only a service finishes the step, as step 2 alerts on it.
 *   2. Get alerted: monitors from the Service catalog for the service that
 *      reported, each for data it sends (#7146) - failing requests (Error
 *      Burst) for traces, slow ones (High Request Latency, p95) for
 *      metrics, unhandled exceptions for traces or logs, and a spike in
 *      error logs for logs - all ticked, created in one click, each opening
 *      an ALERT: for the team, never on a status page. The step says who is
 *      told, and that a monitor can be switched to an incident when
 *      customers should see it. "Not now" ends the setup too.
 *
 * Then the summary, read from the records, with what to do next.
 *
 * React-free, so the tests read the rules and words without a page;
 * TelemetrySetupApi.ts reads and writes the records.
 */

export const TELEMETRY_SETUP: string = "telemetry";

export enum TelemetrySetupStep {
  Send = "send",
  Alert = "alert",
}

export const TELEMETRY_SETUP_STEPS: ReadonlyArray<TelemetrySetupStep> = [
  TelemetrySetupStep.Send,
  TelemetrySetupStep.Alert,
];

/*
 * The monitors offered, by their Service catalog template ids
 * (Common/Types/Monitor/ServiceAlertTemplates), in this order: one for
 * each thing a newcomer asks first - is it failing, is it slow, is it
 * throwing - and a spike in its error logs. Each applies to every service,
 * whatever its runtime, and reads one kind of data: a monitor of data the
 * service never sends never fires, and the team believes it is covered
 * (#7146). So each is offered once the project's first data of a kind it
 * reads has arrived (`readsFirstDataOf`, the activation milestones):
 *
 *   - Error Burst counts error spans: traces;
 *   - High Request Latency reads http.server.request.duration: metrics;
 *   - Unhandled Exceptions counts exceptions, which come with traces and
 *     with logs;
 *   - Error Log Spike counts error logs: logs.
 *
 * The project's first data stands for the service's: a new project's first
 * service is the only one that sent anything, and a busy project, which has
 * every kind, is offered all four, as before. A project whose first data is
 * not known (none kept, or the read failed) is offered the three the setup
 * always offered.
 */
export interface TelemetryRecommendedTemplate {
  templateId: string;
  readsFirstDataOf: ReadonlyArray<ActivationMilestone>;
}

export const TELEMETRY_RECOMMENDED_TEMPLATES: ReadonlyArray<TelemetryRecommendedTemplate> =
  [
    {
      templateId: "service-error-burst",
      readsFirstDataOf: [ActivationMilestone.FirstTracesReceived],
    },
    {
      templateId: "service-latency-p95",
      readsFirstDataOf: [ActivationMilestone.FirstMetricsReceived],
    },
    {
      templateId: "service-unhandled-exceptions",
      readsFirstDataOf: [
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstLogsReceived,
      ],
    },
    {
      templateId: "service-error-log-spike",
      readsFirstDataOf: [ActivationMilestone.FirstLogsReceived],
    },
  ];

// What a project whose first data is not known is offered.
export const TELEMETRY_RECOMMENDED_TEMPLATE_IDS: ReadonlyArray<string> = [
  "service-error-burst",
  "service-latency-p95",
  "service-unhandled-exceptions",
];

// The first-data marks the offer is read from, each once.
export const TELEMETRY_RECOMMENDATION_MILESTONES: ReadonlyArray<ActivationMilestone> =
  Array.from(
    new Set<ActivationMilestone>(
      TELEMETRY_RECOMMENDED_TEMPLATES.flatMap(
        (
          template: TelemetryRecommendedTemplate,
        ): ReadonlyArray<ActivationMilestone> => {
          return template.readsFirstDataOf;
        },
      ),
    ),
  );

/*
 * The template ids offered, in the setup's order, for the project's first
 * data (null: not known).
 */
export const getTelemetryRecommendedTemplateIds: (
  reached: ReadonlyArray<ActivationMilestone> | null | undefined,
) => Array<string> = (
  reached: ReadonlyArray<ActivationMilestone> | null | undefined,
): Array<string> => {
  const offered: Array<string> = TELEMETRY_RECOMMENDED_TEMPLATES.filter(
    (template: TelemetryRecommendedTemplate): boolean => {
      return template.readsFirstDataOf.some(
        (milestone: ActivationMilestone): boolean => {
          return (reached || []).includes(milestone);
        },
      );
    },
  ).map((template: TelemetryRecommendedTemplate): string => {
    return template.templateId;
  });

  return offered.length > 0 ? offered : [...TELEMETRY_RECOMMENDED_TEMPLATE_IDS];
};

export const TELEMETRY_SETUP_COPY: {
  pageTitle: string;
  pageDescription: string;
  sendOutcome: string;
  alertOutcome: string;
  sendTitle: string;
  sendHelp: string;
  waitTitle: string;
  existingTitle: string;
  existingHelp: string;
  useService: string;
  alertTitle: string;
  alertHelp: string;
  alertsNotIncidents: string;
  whoExisting: string;
  whoOwners: string;
  whoPageSomeone: string;
  alreadyWatched: string;
  allWatched: string;
  cannotCreateMonitors: string;
  nothingPicked: string;
  notNow: string;
  continueButton: string;
  summaryTitle: string;
  summarySends: string;
  summaryWatchedBy: string;
  summaryNotWatched: string;
  summaryWhoIsTold: string;
  summaryNext: string;
  nextLogs: string;
  nextTraces: string;
  nextMetrics: string;
  nextRecommendations: string;
  startOver: string;
} = {
  pageTitle: translationKey("Send logs, metrics and traces, then get alerted"),
  pageDescription: translationKey(
    "Guided setup: send your app's first telemetry and get alerted on it, on this page.",
  ),
  /*
   * What each step sets up, beside the steps (GuidedSetupFrame, #8897): the
   * outcome the person is working towards, ticked as each step is done.
   */
  sendOutcome: translationKey(
    "Your app sends its logs, metrics and traces to OneUptime.",
  ),
  alertOutcome: translationKey(
    "Recommended monitors alert you when that data shows a problem.",
  ),
  sendTitle: translationKey("Send your first data"),
  sendHelp: translationKey(
    "Pick how your app sends data, then follow the steps. OpenTelemetry sends logs, metrics and traces with one setup.",
  ),
  waitTitle: translationKey("Wait for the first data"),
  existingTitle: translationKey("Already sending data?"),
  existingHelp: translationKey("Pick a service that has reported:"),
  useService: translationKey("Use {{service}}"),
  alertTitle: translationKey("Get alerted"),
  alertHelp: translationKey(
    "Recommended monitors for {{service}}. They read the data it sends, and are created in one click.",
  ),
  alertsNotIncidents: translationKey(
    "These open alerts, for your team: alerts never appear on a status page. Switch a monitor to an incident if customers should see it.",
  ),
  whoExisting: translationKey(
    "Your on-call policies and rules decide who is paged for each alert.",
  ),
  whoOwners: translationKey(
    "This project has no on-call policy yet, so its owners are emailed about each alert.",
  ),
  whoPageSomeone: translationKey("Page someone instead"),
  alreadyWatched: translationKey("Already watched"),
  allWatched: translationKey(
    "{{service}} is already watched by these monitors.",
  ),
  cannotCreateMonitors: translationKey(
    "Creating monitors needs permission you do not have in this project. Ask a Project Admin to add them, or to give you the permission.",
  ),
  nothingPicked: translationKey(
    "Pick at least one monitor, or choose Not now.",
  ),
  notNow: translationKey("Not now"),
  continueButton: translationKey("Continue"),
  summaryTitle: translationKey("{{service}} is sending data"),
  summarySends: translationKey("Sends"),
  summaryWatchedBy: translationKey("Watched by"),
  summaryNotWatched: translationKey(
    "No monitor yet. Add one from the service's recommendations when you are ready.",
  ),
  summaryWhoIsTold: translationKey("Who is told"),
  summaryNext: translationKey("What's next"),
  nextLogs: translationKey("View its logs"),
  nextTraces: translationKey("View its traces"),
  nextMetrics: translationKey("View its metrics"),
  nextRecommendations: translationKey("More recommended monitors"),
  startOver: translationKey("Set up another service"),
};

/*
 * THE RUN: what this pass through the setup made, as GuidedSetupRunStore
 * keeps it.
 */
export enum TelemetrySetupRunValue {
  ServiceId = "serviceId",
  // The monitors this run created, by id, comma-separated.
  MonitorIds = "monitorIds",
  // "Not now" on step 2.
  AlertSkipped = "alertSkipped",
  // Step 2 confirmed with every recommended monitor there already.
  AlertConfirmed = "alertConfirmed",
}

export const joinMonitorIds: (ids: ReadonlyArray<string>) => string = (
  ids: ReadonlyArray<string>,
): string => {
  return ids.filter(Boolean).join(",");
};

export const splitMonitorIds: (
  value: string | boolean | undefined,
) => Array<string> = (value: string | boolean | undefined): Array<string> => {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((id: string): string => {
      return id.trim();
    })
    .filter(Boolean);
};

// What the records say about each step, read when the page opens.
export interface TelemetrySetupProgressFacts {
  // The run's service exists and has reported.
  hasReportingService: boolean;
  // The run's monitors that still exist.
  monitorCount: number;
  isAlertSkipped: boolean;
  isAlertConfirmed: boolean;
}

export const isAlertDone: (facts: TelemetrySetupProgressFacts) => boolean = (
  facts: TelemetrySetupProgressFacts,
): boolean => {
  return (
    facts.hasReportingService &&
    (facts.monitorCount > 0 || facts.isAlertSkipped || facts.isAlertConfirmed)
  );
};

export const getTelemetrySetupProgress: (
  facts: TelemetrySetupProgressFacts,
) => Array<GuidedSetupStepProgress> = (
  facts: TelemetrySetupProgressFacts,
): Array<GuidedSetupStepProgress> => {
  return [
    { key: TelemetrySetupStep.Send, isDone: facts.hasReportingService },
    { key: TelemetrySetupStep.Alert, isDone: isAlertDone(facts) },
  ];
};

/*
 * The end: data arrived, and it is watched - or the person said "not now",
 * which is an answer too (the issue's "or with the person saying not now").
 */
export const isTelemetrySetupFinished: (
  facts: TelemetrySetupProgressFacts,
) => boolean = (facts: TelemetrySetupProgressFacts): boolean => {
  return isAlertDone(facts);
};

/*
 * THE MONITORS PICKED: every recommended one that is not there already, to
 * start with.
 */
export const getInitialPick: (data: {
  recommendationIds: ReadonlyArray<string>;
  coveredIds: ReadonlyArray<string>;
}) => Array<string> = (data: {
  recommendationIds: ReadonlyArray<string>;
  coveredIds: ReadonlyArray<string>;
}): Array<string> => {
  return data.recommendationIds.filter((id: string): boolean => {
    return !data.coveredIds.includes(id);
  });
};

// Step 2's line once it is done.
export const getAlertDoneLine: (data: {
  translator: Translator;
  serviceName: string;
  monitorCount: number;
  isSkipped: boolean;
}) => string = (data: {
  translator: Translator;
  serviceName: string;
  monitorCount: number;
  isSkipped: boolean;
}): string => {
  if (data.monitorCount > 0) {
    return data.translator.translatePlural(
      {
        one: "{{count}} monitor watches {{service}}.",
        other: "{{count}} monitors watch {{service}}.",
      },
      data.monitorCount,
      { service: data.serviceName },
    );
  }

  if (data.isSkipped) {
    return data.translator.translateText("Not now") || "";
  }

  return data.translator.translateTemplate(TELEMETRY_SETUP_COPY.allWatched, {
    service: data.serviceName,
  });
};

// Who is told about the alerts these monitors open.
export const describeWhoIsToldAboutAlerts: (data: {
  translator: Translator;
  mode: WhoIsToldMode;
}) => string = (data: {
  translator: Translator;
  mode: WhoIsToldMode;
}): string => {
  return (
    data.translator.translateText(
      data.mode === WhoIsToldMode.ExistingPolicy
        ? TELEMETRY_SETUP_COPY.whoExisting
        : TELEMETRY_SETUP_COPY.whoOwners,
    ) || ""
  );
};
