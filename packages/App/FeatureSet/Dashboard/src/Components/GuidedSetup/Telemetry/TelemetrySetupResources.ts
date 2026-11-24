import { TelemetrySetupStep } from "./TelemetrySetup";
import { GuidedSetupResourceRow } from "../GuidedSetupResources";
import Route from "Common/Types/API/Route";
import { GuidedSetupResourceStatus } from "Common/Types/GuidedSetup/GuidedSetupRun";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE TELEMETRY SETUP MAKES, AS IT MAKES IT (#10276). Step 1 waits for
 * the app's first data, which makes its service; step 2 makes the monitors
 * picked from the recommendations. The setup's panel lists them under their
 * steps, as the website and on-call setups list theirs: the service waiting
 * for data, then receiving it, with Open; each monitor picked waiting for
 * Create, being made, made with Open, or refused with the server's reason
 * and Try again - which makes only what is still missing, never a second
 * copy of a monitor that was made.
 *
 * Everything here is read from the page's records and the run's (the
 * service and the monitors it keeps, #7253), so a reload or another device
 * draws the same panel. React-free, so the tests read it without a page.
 */

export const TELEMETRY_RESOURCE_COPY: {
  service: string;
  monitor: string;
  receivingData: string;
} = {
  service: translationKey("Service"),
  monitor: translationKey("Monitor"),
  // The service's word once its first data is in.
  receivingData: translationKey("Receiving data"),
};

// A word the code chooses for each row: the panel keys them.
export const TELEMETRY_RESOURCE_KEYS: {
  service: string;
  monitor: (monitorId: string) => string;
  picked: (recommendationId: string) => string;
  refused: (index: number) => string;
} = {
  service: "service",
  monitor: (monitorId: string): string => {
    return `monitor-${monitorId}`;
  },
  picked: (recommendationId: string): string => {
    return `picked-${recommendationId}`;
  },
  refused: (index: number): string => {
    return `refused-${index}`;
  },
};

export interface TelemetrySetupRowFacts {
  // The service step 1 found sending data, once there is one.
  service: { id: string; name: string } | null;
  serviceRoute?: Route | undefined;
  // The monitors this run made that still exist.
  monitors: ReadonlyArray<{ id: string; name: string; route?: Route }>;
  /*
   * The recommendations picked and not made yet, named in the reader's
   * words.
   */
  picked: ReadonlyArray<{ recommendationId: string; name: string }>;
  // The monitors the server refused at the last Create, by name, with why.
  refused: ReadonlyArray<{ name: string; message: string }>;
  // Create's request is out.
  isSaving: boolean;
  // Step 2 was put off with Not now.
  isSkipped: boolean;
  // Create again: only what is still missing.
  onRetry: () => void;
}

// Step 1's row: the service, waiting for its first data, then receiving it.
export const getTelemetrySendRows: (
  facts: TelemetrySetupRowFacts,
) => Array<GuidedSetupResourceRow> = (
  facts: TelemetrySetupRowFacts,
): Array<GuidedSetupResourceRow> => {
  return [
    {
      key: TELEMETRY_RESOURCE_KEYS.service,
      stepKey: TelemetrySetupStep.Send,
      kind: TELEMETRY_RESOURCE_COPY.service,
      name: facts.service?.name || undefined,
      status: facts.service
        ? GuidedSetupResourceStatus.Created
        : GuidedSetupResourceStatus.Waiting,
      statusText: facts.service
        ? TELEMETRY_RESOURCE_COPY.receivingData
        : undefined,
      route: facts.service ? facts.serviceRoute : undefined,
    },
  ];
};

/*
 * Step 2's rows: the monitors made, then the ones picked - waiting for
 * Create, being made while it runs - or, after a Create the server refused
 * some of, those, with why and Try again.
 */
export const getTelemetryAlertRows: (
  facts: TelemetrySetupRowFacts,
) => Array<GuidedSetupResourceRow> = (
  facts: TelemetrySetupRowFacts,
): Array<GuidedSetupResourceRow> => {
  const made: Array<GuidedSetupResourceRow> = facts.monitors.map(
    (monitor: {
      id: string;
      name: string;
      route?: Route;
    }): GuidedSetupResourceRow => {
      return {
        key: TELEMETRY_RESOURCE_KEYS.monitor(monitor.id),
        stepKey: TelemetrySetupStep.Alert,
        kind: TELEMETRY_RESOURCE_COPY.monitor,
        name: monitor.name || undefined,
        status: GuidedSetupResourceStatus.Created,
        route: monitor.route,
      };
    },
  );

  if (facts.refused.length > 0 && !facts.isSaving) {
    return [
      ...made,
      ...facts.refused.map(
        (
          refusal: { name: string; message: string },
          index: number,
        ): GuidedSetupResourceRow => {
          return {
            key: TELEMETRY_RESOURCE_KEYS.refused(index),
            stepKey: TelemetrySetupStep.Alert,
            kind: TELEMETRY_RESOURCE_COPY.monitor,
            name: refusal.name || undefined,
            status: GuidedSetupResourceStatus.Failed,
            error: refusal.message,
            onRetry: facts.onRetry,
          };
        },
      ),
    ];
  }

  // Picked and not made: being made while Create runs, else to come.
  const status: GuidedSetupResourceStatus = facts.isSaving
    ? GuidedSetupResourceStatus.Creating
    : facts.isSkipped
      ? GuidedSetupResourceStatus.Skipped
      : GuidedSetupResourceStatus.Waiting;

  return [
    ...made,
    ...facts.picked.map(
      (pick: {
        recommendationId: string;
        name: string;
      }): GuidedSetupResourceRow => {
        return {
          key: TELEMETRY_RESOURCE_KEYS.picked(pick.recommendationId),
          stepKey: TelemetrySetupStep.Alert,
          kind: TELEMETRY_RESOURCE_COPY.monitor,
          name: pick.name || undefined,
          status: status,
        };
      },
    ),
  ];
};
