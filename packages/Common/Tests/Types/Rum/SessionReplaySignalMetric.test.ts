import { describe, expect, test } from "@jest/globals";
import {
  getSessionReplaySignalId,
  getSessionReplaySignalIdsByName,
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION,
} from "../../../Types/Rum/SessionReplaySignalMetric";
import SessionReplayBudgetMetricTypeUtil from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import { isProductAnalyticsMetricName } from "../../../Types/Rum/ProductAnalyticsEvents";

/*
 * The series a RUM application's signal alerts read (issue #6518): its
 * name sits where only OneUptime writes, and a hit reported by name is
 * filed under the signal's id, which a rename keeps.
 */

describe("the signal sessions series", () => {
  test("is named under the session replay prefix, which OTLP ingest and recording rules refuse", () => {
    expect(SESSION_REPLAY_SIGNAL_SESSIONS_METRIC).toBe(
      "oneuptime.rum.session.replay.signal.sessions",
    );
    expect(
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
        SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
      ),
    ).toBe(true);
    /* A page's metric() cannot send it either. */
    expect(
      isProductAnalyticsMetricName(SESSION_REPLAY_SIGNAL_SESSIONS_METRIC),
    ).toBe(false);
  });

  test("names its two attributes in its description, as the Metrics page shows it", () => {
    expect(SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION).toContain(
      SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
    );
    expect(SESSION_REPLAY_SIGNAL_SESSIONS_METRIC_DESCRIPTION).toContain(
      SESSION_REPLAY_SIGNAL_NAME_ATTRIBUTE,
    );
  });
});

describe("filing a hit under its signal's id", () => {
  const ids: Record<string, string> = getSessionReplaySignalIdsByName([
    { id: "signal-payment", name: "Payment Failed" },
    { id: "signal-chat", name: " Support chat " },
    { id: "", name: "No id" },
    { id: "signal-duplicate", name: "payment failed" },
  ]);

  test("knows each id by its name in lower case, the first of a name, none without an id", () => {
    expect(ids).toEqual({
      "payment failed": "signal-payment",
      "support chat": "signal-chat",
    });
  });

  test("finds the id of a name in any case, and none for a name the settings no longer hold", () => {
    expect(getSessionReplaySignalId(ids, "Payment Failed")).toBe(
      "signal-payment",
    );
    expect(getSessionReplaySignalId(ids, "PAYMENT FAILED ")).toBe(
      "signal-payment",
    );
    expect(getSessionReplaySignalId(ids, "Payment declined")).toBe("");
    expect(getSessionReplaySignalId(undefined, "Payment Failed")).toBe("");
    expect(getSessionReplaySignalId(null, "Payment Failed")).toBe("");
  });

  test("never reads a name that is a property of every object as an id, and files one called so", () => {
    expect(getSessionReplaySignalId(ids, "constructor")).toBe("");
    expect(getSessionReplaySignalId(ids, "__proto__")).toBe("");

    const odd: Record<string, string> = getSessionReplaySignalIdsByName([
      { id: "signal-proto", name: "__proto__" },
      { id: "signal-constructor", name: "constructor" },
    ]);

    expect(getSessionReplaySignalId(odd, "__proto__")).toBe("signal-proto");
    expect(getSessionReplaySignalId(odd, "Constructor")).toBe(
      "signal-constructor",
    );
    expect(Object.keys(odd).sort()).toEqual(["__proto__", "constructor"]);
  });
});
