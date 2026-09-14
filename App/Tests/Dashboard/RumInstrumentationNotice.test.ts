import { describe, expect, test } from "@jest/globals";
import isReplayOnlyInstrumented from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RumInstrumentation";

/*
 * The "session replay is reporting, the RUM SDK is not" banner on the RUM
 * application Overview.
 *
 * From github.com/OneUptime/oneuptime/issues/3527: the reporter had session
 * replay working and every other tile on the page reading zero, with nothing
 * anywhere saying that page views, error rate, p95 and clients come from a
 * SECOND install they had not done. Two separate faults looked like one broken
 * feature.
 *
 * Half of these cases are about NOT showing the banner. A diagnostic that
 * appears on a healthy application is worse than none, because the next real
 * one is ignored.
 */
describe("isReplayOnlyInstrumented", () => {
  const REPLAY_SEEN: Date = new Date("2026-09-01T09:54:00.000Z");

  test("fires when replay is arriving and the SDK has never reported", () => {
    expect(
      isReplayOnlyInstrumented({
        sessionReplayLastChunkReceivedAt: REPLAY_SEEN,
      }),
    ).toBe(true);
  });

  /*
   * The reporter's exact row: replay chunks accepted hours ago, and a Client
   * Type column rendering an em dash.
   */
  test("fires when the SDK columns are empty strings, not just absent", () => {
    expect(
      isReplayOnlyInstrumented({
        sessionReplayLastChunkReceivedAt: REPLAY_SEEN,
        clientType: "",
        sdkLanguage: "   ",
        agentVersion: "",
      }),
    ).toBe(true);
  });

  test("accepts the date as the ISO string an API response carries", () => {
    expect(
      isReplayOnlyInstrumented({
        sessionReplayLastChunkReceivedAt: "2026-09-01T09:54:00.000Z",
      }),
    ).toBe(true);
  });

  /*
   * An application with the SDK installed is fully instrumented; zeroes there
   * mean a quiet time range, which the banner must not misdiagnose.
   */
  for (const field of ["clientType", "sdkLanguage", "agentVersion"] as const) {
    test(`stays silent when ${field} says the SDK has reported`, () => {
      expect(
        isReplayOnlyInstrumented({
          sessionReplayLastChunkReceivedAt: REPLAY_SEEN,
          [field]: "browser",
        }),
      ).toBe(false);
    });
  }

  /*
   * No replay either. This is an application with nothing installed at all,
   * and telling it about the OTel SDK alone would be actively misleading -
   * the empty session list has its own setup guide for that case.
   */
  test("stays silent when replay has not reported either", () => {
    expect(isReplayOnlyInstrumented({})).toBe(false);
    expect(
      isReplayOnlyInstrumented({ sessionReplayLastChunkReceivedAt: null }),
    ).toBe(false);
  });

  test("stays silent while the application is still loading", () => {
    expect(isReplayOnlyInstrumented(null)).toBe(false);
    expect(isReplayOnlyInstrumented(undefined)).toBe(false);
  });
});
