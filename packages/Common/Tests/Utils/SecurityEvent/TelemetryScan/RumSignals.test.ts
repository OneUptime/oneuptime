import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  RUM_ATTRIBUTES,
  RUM_COUNTRY_WINDOW_IN_MINUTES,
  RumScanSession,
  buildUserInTwoCountriesEvent,
  findClosestCountryChange,
  readCountries,
} from "../../../../Utils/SecurityEvent/TelemetryScan/RumSignals";

/*
 * One signed-in user in two countries within the hour, from session
 * replays. The user is named by the identity key only, never by a name or
 * an email, and the event opens on the latest session.
 */

const USER_KEY: string =
  "9f2c4d1b7a0e4c55b8d1e6f2a3c4b5d6e7f8091a2b3c4d5e6f708192a3b4c5d6";

function session(
  sessionId: string,
  countryCode: string,
  startTime: string,
  extra: Partial<RumScanSession> = {},
): RumScanSession {
  return {
    sessionId,
    rumApplicationId: "0192f1a0-0000-7000-8000-00000000r001",
    countryCode,
    startTime: new Date(startTime),
    browserName: "Chrome",
    osName: "macOS",
    ...extra,
  };
}

describe("a user in two countries", () => {
  test("is two sessions in different countries less than an hour apart", () => {
    const event: NormalizedSecurityEvent = buildUserInTwoCountriesEvent({
      userKey: USER_KEY,
      sessions: [
        session("s1", "us", "2026-10-27T10:00:00.000Z"),
        session("s2", "RU", "2026-10-27T10:20:00.000Z", {
          browserName: "Firefox",
          osName: "Linux",
        }),
      ],
    })!;

    expect(event.message).toBe(
      "One signed-in user used the app from US and then RU, 20 minutes apart",
    );
    expect(event.className).toBe("Authentication");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.productName).toBe("OneUptime Session Replay");
    expect(event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE]).toBe(
      SecurityTelemetrySignal.UserInTwoCountries,
    );
    expect(event.attributes[RUM_ATTRIBUTES.countries]).toBe("RU,US");
    expect(event.attributes[RUM_ATTRIBUTES.sessionIds]).toBe("s1,s2");
    expect(event.attributes[RUM_ATTRIBUTES.userKey]).toBe(USER_KEY);
    expect(event.attributes[RUM_ATTRIBUTES.browsers]).toBe(
      "Chrome on macOS, Firefox on Linux",
    );
    // The event opens on the latest session.
    expect(event.sessionId).toBe("s2");
    expect(event.time).toEqual(new Date("2026-10-27T10:20:00.000Z"));
    // Correlated by the key; no name or email is ever stored.
    expect(event.principalUser).toBe("");
    expect(event.observables).toContain(USER_KEY);
    expect(event.mitreTechniques).toEqual(["T1078"]);
  });

  test("is once a day for the same countries", () => {
    const morning: NormalizedSecurityEvent = buildUserInTwoCountriesEvent({
      userKey: USER_KEY,
      sessions: [
        session("s1", "US", "2026-10-27T08:00:00.000Z"),
        session("s2", "RU", "2026-10-27T08:10:00.000Z"),
      ],
    })!;
    const evening: NormalizedSecurityEvent = buildUserInTwoCountriesEvent({
      userKey: USER_KEY,
      sessions: [
        session("s3", "RU", "2026-10-27T20:00:00.000Z"),
        session("s4", "US", "2026-10-27T20:30:00.000Z"),
      ],
    })!;

    expect(morning.eventUid).toBe(evening.eventUid);
    expect(morning.eventUid).toBe(
      `rum:user-in-two-countries:${USER_KEY}:RU-US:2026-10-27`,
    );
  });

  test("two trips are not this: sessions further apart than the window", () => {
    expect(
      buildUserInTwoCountriesEvent({
        userKey: USER_KEY,
        sessions: [
          session("s1", "US", "2026-10-27T08:00:00.000Z"),
          session(
            "s2",
            "GB",
            new Date(
              new Date("2026-10-27T08:00:00.000Z").getTime() +
                (RUM_COUNTRY_WINDOW_IN_MINUTES + 1) * 60 * 1000,
            ).toISOString(),
          ),
        ],
      }),
    ).toBeNull();
  });

  test("one country, or no user key, is no event", () => {
    expect(
      buildUserInTwoCountriesEvent({
        userKey: USER_KEY,
        sessions: [
          session("s1", "US", "2026-10-27T08:00:00.000Z"),
          session("s2", "us", "2026-10-27T08:05:00.000Z"),
        ],
      }),
    ).toBeNull();
    expect(
      buildUserInTwoCountriesEvent({
        userKey: "",
        sessions: [
          session("s1", "US", "2026-10-27T08:00:00.000Z"),
          session("s2", "RU", "2026-10-27T08:05:00.000Z"),
        ],
      }),
    ).toBeNull();
  });

  test("the closest pair of countries is the one said", () => {
    expect(
      findClosestCountryChange([
        session("a", "US", "2026-10-27T08:00:00.000Z"),
        session("b", "DE", "2026-10-27T08:50:00.000Z"),
        session("c", "US", "2026-10-27T08:55:00.000Z"),
      ]),
    ).toEqual(
      expect.objectContaining({
        from: expect.objectContaining({ sessionId: "b" }),
        to: expect.objectContaining({ sessionId: "c" }),
        minutes: 5,
      }),
    );
  });

  test("a country is two letters, upper-cased, each once", () => {
    expect(
      readCountries([
        session("a", "us", "2026-10-27T08:00:00.000Z"),
        session("b", "US", "2026-10-27T08:01:00.000Z"),
        session("c", "", "2026-10-27T08:02:00.000Z"),
        session("d", "unknown", "2026-10-27T08:03:00.000Z"),
        session("e", "de", "2026-10-27T08:04:00.000Z"),
      ]),
    ).toEqual(["DE", "US"]);
  });
});
