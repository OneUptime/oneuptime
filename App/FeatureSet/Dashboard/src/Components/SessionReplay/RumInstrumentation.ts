/*
 * "Session replay works, but every other tile on the Overview reads zero."
 *
 * That is a real and entirely reasonable configuration - the replay snippet
 * and the OpenTelemetry browser SDK are two separate installs, and replay does
 * not need the SDK - but it looks exactly like a broken application: page
 * views, error rate, p95 duration and clients all sit at zero or a dash with
 * nothing saying why. It is what issue #3527 reported alongside the recording
 * faults, and the reporter had no way to tell the two apart.
 *
 * A pure function rather than an inline expression on the page so the
 * condition can be tested for the cases that matter, several of which are
 * about NOT showing a banner.
 */

export interface RumInstrumentationSignals {
  /*
   * Written by the replay ingest path when a chunk is accepted. Its presence
   * is the whole "replay is reporting" half of the question.
   */
  sessionReplayLastChunkReceivedAt?: Date | string | null | undefined;

  /*
   * All three are written ONLY by the OTel ingest path, harvested from the
   * resource attributes the browser SDK sends (browser.*, telemetry.sdk.*).
   * The replay paths never touch them - replay's own liveness write carries no
   * metadata precisely so this signal stays clean - so all three being empty
   * means the SDK has never reported for this application.
   */
  clientType?: string | null | undefined;
  sdkLanguage?: string | null | undefined;
  agentVersion?: string | null | undefined;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

/*
 * Deliberately NOT "no spans in the selected time range", which would fire on
 * any quiet hour and turn the banner into noise the moment somebody narrowed
 * the time picker. This answer is a property of the INSTALL, so it does not
 * change with the range, and it goes away by itself the first time the SDK
 * reports.
 */
export default function isReplayOnlyInstrumented(
  app: RumInstrumentationSignals | null | undefined,
): boolean {
  if (!app) {
    return false;
  }

  if (!isPresent(app.sessionReplayLastChunkReceivedAt)) {
    return false;
  }

  return (
    !isPresent(app.clientType) &&
    !isPresent(app.sdkLanguage) &&
    !isPresent(app.agentVersion)
  );
}
