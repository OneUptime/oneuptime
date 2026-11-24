import {
  MAX_CALL_SITE_PLACES,
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import DataSecurityAiInput, {
  DataSecurityAiCodeRequest,
} from "./DataSecurityAiInput";

/*
 * WHAT THE CODING AGENT IS ASKED TO STOP A SERVICE WRITING SENSITIVE DATA
 * TO ITS TELEMETRY (#10367), in OneUptime's own words.
 *
 * Data Security found each leak in the records the service sent and where
 * its code writes it (TelemetryLeakLocator), and decided how it is fixed
 * (decideTelemetryLeakFix): at the call site, while the leaks are written
 * in at most MAX_CALL_SITE_PLACES places; else one redaction step where
 * the service sets up its telemetry - always for the keys the project's
 * scrub rules mask at ingest already. The instruction says that, and the
 * input builder (DataSecurityAiInput.buildFixTelemetryLeaksRequest) adds
 * the leaks as data: never a value or a record.
 */

/*
 * The most a telemetry fix's request holds: it rides in the task's own
 * context (AIRun.taskContext.telemetryLeakFix), read back to at most
 * 20,000 characters, and the Runner's prompt wraps it.
 */
export const MAX_TELEMETRY_FIX_REQUEST_LENGTH: number = 16_000;

const CALL_SITE_STEPS: string = `For each leak whose "fix" is "CallSite", change the code at the places listed in "writtenAt" so the value is no longer sent: leave the attribute, the argument or the part of the message out, or replace the value with a masked or hashed form (a keyed one-way hash keeps it joinable). Find each place by its file and line, its function, its span or logger name, its log line's template (each <...> in it stands for a value) or its attribute key, which the code usually writes as a literal. Change only those places.`;

const REDACTION_STEP_STEPS: string = `For the leaks whose "fix" is "RedactionStep", do not edit each place that writes them. Add one redaction step where the service sets up its telemetry - a span processor, a log processor, a log formatter or the logger's configuration - that removes or masks the attribute keys in "redactionStep.keys", and the values of the data types in "redactionStep.dataTypesInText" in log lines and messages, before any record leaves the service, so every exporter and every log output gets the redacted record. Add a test that a record carrying such a value comes out of the step without it.`;

const TEST_STEP: string =
  "Where the repository has tests, add or update one that proves the value is no longer written.";

const SECRET_STEP: string =
  'A leak with "isSecret" is a secret that was written to telemetry: the change stops new copies only, and a person must rotate the secret. Say so in your summary, and never print or log the secret anywhere.';

const SUMMARY_STEP: string =
  "Finish with a summary for the pull request: what you changed and where, which leaks each change stops, and whether you added a redaction step or edited the call sites. Describe the code only: never quote a log line or a value.";

/*
 * What the agent is told to do, for the way the fix is made: the steps of
 * its strategy, a test, a secret's rotation, and its summary.
 */
export function getTelemetryLeakFixInstruction(data: {
  serviceName: string;
  strategy: TelemetryLeakFixStrategy;
  hasSecrets: boolean;
}): string {
  const steps: Array<string> = [
    `Stop the service ${data.serviceName ? `"${data.serviceName}"` : "below"} writing sensitive data to its telemetry - its logs, spans, exceptions, AI calls and metrics - in one change. OneUptime Data Security found each leak below in the records the service sent, and where its code writes it.`,
  ];

  if (data.strategy === TelemetryLeakFixStrategy.CallSites) {
    steps.push(
      `The leaks are written in at most ${MAX_CALL_SITE_PLACES} places: fix each where it is written.`,
      CALL_SITE_STEPS,
    );
  } else if (data.strategy === TelemetryLeakFixStrategy.RedactionStep) {
    steps.push(
      `The leaks are written in more than ${MAX_CALL_SITE_PLACES} places, or your scrub rules hide them at ingest already, so the code should do what ingest does: one redaction step fixes them all.`,
      REDACTION_STEP_STEPS,
    );
  } else {
    steps.push(
      "Fix the few leaks written in a handful of places where they are written, and add one redaction step for the keys your scrub rules hide at ingest already, so the code does what ingest does.",
      CALL_SITE_STEPS,
      REDACTION_STEP_STEPS,
    );
  }

  steps.push(TEST_STEP);

  if (data.hasSecrets) {
    steps.push(SECRET_STEP);
  }

  steps.push(SUMMARY_STEP, "Open a pull request.");

  return steps.join("\n\n");
}

/*
 * The request for the coding agent: the instruction, then the leaks as the
 * input builder writes them (#10365), held to
 * MAX_TELEMETRY_FIX_REQUEST_LENGTH.
 */
export function buildTelemetryLeakFixRequest(data: {
  serviceName: string;
  folder?: string | undefined;
  strategy: TelemetryLeakFixStrategy;
  placeCount: number;
  leaks: ReadonlyArray<TelemetryLeakFixLeak>;
  redactionKeys: ReadonlyArray<string>;
  redactionDataTypes: ReadonlyArray<string>;
  startFiles: ReadonlyArray<string>;
}): DataSecurityAiCodeRequest {
  return DataSecurityAiInput.buildFixTelemetryLeaksRequest({
    instruction: getTelemetryLeakFixInstruction({
      serviceName: data.serviceName,
      strategy: data.strategy,
      hasSecrets: data.leaks.some((leak: TelemetryLeakFixLeak): boolean => {
        return leak.isSecret;
      }),
    }),
    serviceName: data.serviceName,
    folder: data.folder,
    strategy: data.strategy,
    placeCount: data.placeCount,
    leaks: data.leaks,
    redactionKeys: data.redactionKeys,
    redactionDataTypes: data.redactionDataTypes,
    startFiles: data.startFiles,
    maxLength: MAX_TELEMETRY_FIX_REQUEST_LENGTH,
  });
}
