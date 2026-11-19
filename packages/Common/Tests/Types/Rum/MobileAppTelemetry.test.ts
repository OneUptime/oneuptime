import { describe, expect, test } from "@jest/globals";
import {
  APP_ANR_EVENT_NAME,
  APP_CRASH_EVENT_NAME,
  EVENT_NAME_ATTRIBUTE,
} from "../../../Types/Rum/MobileAppTelemetry";
import { LogEventNameAttributeKey } from "../../../Types/Log/LogEventName";
import {
  MOBILE_APP_FAULT_EVENT_NAMES,
  MobileAppFaultKind,
  getMobileAppFaultKind,
} from "../../../Utils/Telemetry/MobileAppFaults";

/*
 * The Rum module's copies of the names ingest reads a mobile app's events
 * by. A module in Common/{Utils,Types}/Rum imports nothing from the rest of
 * Common (the browser recorder inlines them), so MobileAppTelemetry writes
 * these out; these tests hold them to Types/Log/LogEventName and
 * Utils/Telemetry/MobileAppFaults, so a name changed in one cannot be
 * missing from the other, and the monitors Recommendations offer a mobile
 * app read the very events ingest files as crashes and ANRs.
 */
describe("a mobile app's event names", () => {
  test("reads events from the attribute log ingest stamps their name on", () => {
    expect(EVENT_NAME_ATTRIBUTE).toBe(LogEventNameAttributeKey);
  });

  test("names the crash event ingest files as a crash, the name current SDKs send", () => {
    expect(APP_CRASH_EVENT_NAME).toBe(
      MOBILE_APP_FAULT_EVENT_NAMES[MobileAppFaultKind.Crash][0],
    );
    expect(
      getMobileAppFaultKind({ [EVENT_NAME_ATTRIBUTE]: APP_CRASH_EVENT_NAME }),
    ).toBe(MobileAppFaultKind.Crash);
  });

  test("names the ANR event ingest files as an ANR", () => {
    expect(APP_ANR_EVENT_NAME).toBe(
      MOBILE_APP_FAULT_EVENT_NAMES[MobileAppFaultKind.Anr][0],
    );
    expect(
      getMobileAppFaultKind({ [EVENT_NAME_ATTRIBUTE]: APP_ANR_EVENT_NAME }),
    ).toBe(MobileAppFaultKind.Anr);
  });
});
