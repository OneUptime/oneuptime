import {
  RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT,
  generateOutputMetricName,
  getOutputMetricNameFromRuleName,
} from "../../../Types/Metrics/RecordingRuleOutputMetricName";
import SessionReplayBudgetMetricTypeUtil from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * A recording rule's Output Metric Name is made from the rule's name unless
 * someone types one: the metric the rule writes, so it is written the way
 * metric names are, in lowercase with underscores.
 */

describe("getOutputMetricNameFromRuleName", () => {
  test.each([
    ["HTTP 5xx error rate", "http_5xx_error_rate"],
    ["HTTP error rate (from spans)", "http_error_rate_from_spans"],
    ["Checkout p99 latency", "checkout_p99_latency"],
    ["Error rate %", "error_rate"],
    ["Größe der Warteschlange", "grosse_der_warteschlange"],
  ])("%p writes %p", (ruleName: string, metricName: string) => {
    expect(getOutputMetricNameFromRuleName(ruleName)).toBe(metricName);
  });

  test("a rule name with nothing usable in it writes recording_rule", () => {
    expect(getOutputMetricNameFromRuleName("!!!")).toBe("recording_rule");
    expect(getOutputMetricNameFromRuleName("错误率")).toBe("recording_rule");
  });

  test("a long rule name writes a name of at most 64 characters", () => {
    const name: string = getOutputMetricNameFromRuleName("word ".repeat(50));

    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.endsWith("_")).toBe(false);
  });

  test("a made name is never in the reserved session replay namespace", () => {
    for (const ruleName of [
      "oneuptime.rum.session.replay.budget",
      "OneUptime RUM Session Replay Budget",
    ]) {
      expect(
        SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
          getOutputMetricNameFromRuleName(ruleName),
        ),
      ).toBe(false);
    }
  });
});

describe("generateOutputMetricName", () => {
  test("is the rule name's metric when no rule of the project writes it", () => {
    expect(
      generateOutputMetricName({
        ruleName: "HTTP 5xx error rate",
        existingNames: ["http.server.error_rate"],
      }),
    ).toBe("http_5xx_error_rate");
  });

  test("numbers the name when another rule already writes it", () => {
    expect(
      generateOutputMetricName({
        ruleName: "HTTP 5xx error rate",
        existingNames: ["http_5xx_error_rate"],
      }),
    ).toBe("http_5xx_error_rate_2");

    expect(
      generateOutputMetricName({
        ruleName: "HTTP 5xx error rate",
        existingNames: [
          "http_5xx_error_rate",
          "http_5xx_error_rate_2",
          null,
          undefined,
          "",
        ],
      }),
    ).toBe("http_5xx_error_rate_3");
  });
});

describe("RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT", () => {
  test("joins words with underscores, as metric names are written", () => {
    expect(RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT).toEqual({
      separator: "_",
      maxLength: 64,
      fallback: "recording_rule",
    });
  });
});
