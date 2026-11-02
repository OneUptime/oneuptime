import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DETECTION_RULE_NEEDS_ATTENTION,
  DETECTION_RULE_REAL_TIME,
  DETECTION_RULE_RUN_FAILED,
  DETECTION_RULE_WAITING,
  LAST_ERROR_LABEL,
  LAST_MATCH_ERROR_LABEL,
  SECURITY_DETECTION_DISABLED,
  SECURITY_DETECTION_ENABLED,
  SecurityDetectionMessage,
  SecurityDetectionStatus,
  THREAT_INTEL_FEED_MATCHING_FAILED,
  THREAT_INTEL_FEED_NEEDS_ATTENTION,
  THREAT_INTEL_FEED_POLL_FAILED,
  THREAT_INTEL_FEED_WAITING,
  getDetectionRuleMessages,
  getDetectionRuleStatus,
  getThreatIntelFeedMessages,
  getThreatIntelFeedStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityDetectionStatus";
import { describeDetectionOverflow } from "../../../Utils/SecurityEvent/DetectionOverflow";
import { Green, LightGray, Red, Yellow } from "../../../Types/BrandColors";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";

/*
 * Whether a threat intel feed or a detection rule works, in its Status.
 *
 * Issue #5157's feeds read a green Enabled while every poll and every
 * check failed - the error in a column past the edge of the card - so
 * nothing said they brought in nothing. The Status now says it: red for a
 * failure, yellow for a run's note about its own work, grey while a new
 * feed or rule waits for its first poll or run, green only when the last
 * ones came back clean.
 */

// What 14.0.81 stored on every feed (issue #5157).
const POLL_FAILURE: string =
  "Code: 184. DB::Exception: Aggregate function max(version) AS version is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 25.3.14.14 (official build))";
const MATCH_FAILURE: string =
  "Code: 184. DB::Exception: Aggregate function max(confidence) AS confidence is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 25.3.14.14 (official build))";

const FEED_OVERFLOW: string = describeDetectionOverflow({
  kind: "feed",
  matched: 1240,
  moreThanRead: false,
  opened: 100,
  findingsWritten: true,
});

const RULE_OVERFLOW: string = describeDetectionOverflow({
  kind: "rule",
  matched: 10000,
  moreThanRead: true,
  opened: 100,
  findingsWritten: true,
});

const POLLED_AT: Date = new Date("2026-10-14T11:48:00.000Z");

function feed(values: Partial<ThreatIntelFeed>): ThreatIntelFeed {
  const model: ThreatIntelFeed = new ThreatIntelFeed();
  Object.assign(model, values);
  return model;
}

function rule(values: Partial<DetectionRule>): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  Object.assign(model, values);
  return model;
}

describe("a threat intel feed's Status", () => {
  test("a feed whose every poll and check failed - issue #5157 - reads Poll failed, in red", () => {
    const status: SecurityDetectionStatus = getThreatIntelFeedStatus(
      feed({
        isEnabled: true,
        lastPolledAt: POLLED_AT,
        lastError: POLL_FAILURE,
        lastMatchError: MATCH_FAILURE,
      }),
    );

    expect(status).toBe(THREAT_INTEL_FEED_POLL_FAILED);
    expect(status.text).toBe("Poll failed");
    expect(status.color).toBe(Red);
    expect(status.tooltip).toBe(
      "The last poll failed. Open View Error for the full message.",
    );
  });

  test("a check that failed while polling works reads Matching failed, in red", () => {
    const status: SecurityDetectionStatus = getThreatIntelFeedStatus(
      feed({
        isEnabled: true,
        lastPolledAt: POLLED_AT,
        lastMatchError: MATCH_FAILURE,
      }),
    );

    expect(status).toBe(THREAT_INTEL_FEED_MATCHING_FAILED);
    expect(status.text).toBe("Matching failed");
    expect(status.color).toBe(Red);
  });

  test("a check that matched more than it opens cases for needs a look, in yellow, not a failure", () => {
    const status: SecurityDetectionStatus = getThreatIntelFeedStatus(
      feed({
        isEnabled: true,
        lastPolledAt: POLLED_AT,
        lastMatchError: FEED_OVERFLOW,
      }),
    );

    expect(status).toBe(THREAT_INTEL_FEED_NEEDS_ATTENTION);
    expect(status.text).toBe("Needs attention");
    expect(status.color).toBe(Yellow);
    expect(status.tooltip).toBe(
      "The last check left a message. Open View Error to read it.",
    );
  });

  test("a feed not polled yet waits for its first poll, in grey", () => {
    const status: SecurityDetectionStatus = getThreatIntelFeedStatus(
      feed({ isEnabled: true }),
    );

    expect(status).toBe(THREAT_INTEL_FEED_WAITING);
    expect(status.text).toBe("Waiting for first poll");
    expect(status.color).toBe(LightGray);
    expect(status.tooltip).toBe("A new feed is polled within a minute.");
  });

  test("a feed whose last poll and check came back clean reads Enabled, in green", () => {
    const status: SecurityDetectionStatus = getThreatIntelFeedStatus(
      feed({ isEnabled: true, lastPolledAt: POLLED_AT }),
    );

    expect(status).toBe(SECURITY_DETECTION_ENABLED);
    expect(status.text).toBe("Enabled");
    expect(status.color).toBe(Green);
    expect(status.tooltip).toBeUndefined();
  });

  test("a switched-off feed reads Disabled, whatever its last poll left", () => {
    for (const values of [
      { isEnabled: false },
      { isEnabled: false, lastError: POLL_FAILURE },
      { isEnabled: false, lastMatchError: MATCH_FAILURE },
      { isEnabled: false, lastPolledAt: POLLED_AT },
      // Not selected reads as off, as the Status always read it.
      {},
    ]) {
      expect(getThreatIntelFeedStatus(feed(values))).toBe(
        SECURITY_DETECTION_DISABLED,
      );
    }

    expect(SECURITY_DETECTION_DISABLED.text).toBe("Disabled");
    expect(SECURITY_DETECTION_DISABLED.color).toBe(Red);
  });

  test("a message of only spaces is no message", () => {
    expect(
      getThreatIntelFeedStatus(
        feed({
          isEnabled: true,
          lastPolledAt: POLLED_AT,
          lastError: "  ",
          lastMatchError: "\n",
        }),
      ),
    ).toBe(SECURITY_DETECTION_ENABLED);
  });

  test("a failed poll outranks a failed check, and a failed check outranks waiting", () => {
    expect(
      getThreatIntelFeedStatus(
        feed({
          isEnabled: true,
          lastError: POLL_FAILURE,
          lastMatchError: FEED_OVERFLOW,
        }),
      ),
    ).toBe(THREAT_INTEL_FEED_POLL_FAILED);
    expect(
      getThreatIntelFeedStatus(
        feed({ isEnabled: true, lastMatchError: MATCH_FAILURE }),
      ),
    ).toBe(THREAT_INTEL_FEED_MATCHING_FAILED);
  });
});

describe("a threat intel feed's messages, as View Error shows them", () => {
  test("the poll's, then the check's, each under its column's title", () => {
    const messages: Array<SecurityDetectionMessage> =
      getThreatIntelFeedMessages(
        feed({ lastError: POLL_FAILURE, lastMatchError: MATCH_FAILURE }),
      );

    expect(messages).toEqual([
      { label: "Last Error", message: POLL_FAILURE, isNotice: false },
      { label: "Last Match Error", message: MATCH_FAILURE, isNotice: false },
    ]);
    expect(LAST_ERROR_LABEL).toBe("Last Error");
    expect(LAST_MATCH_ERROR_LABEL).toBe("Last Match Error");
  });

  test("a check's overflow is a note, not a failure", () => {
    expect(
      getThreatIntelFeedMessages(feed({ lastMatchError: FEED_OVERFLOW })),
    ).toEqual([
      { label: "Last Match Error", message: FEED_OVERFLOW, isNotice: true },
    ]);
  });

  test("a feed with nothing to say has no messages, so no View Error", () => {
    expect(getThreatIntelFeedMessages(feed({}))).toEqual([]);
    expect(
      getThreatIntelFeedMessages(feed({ lastError: " ", lastMatchError: "" })),
    ).toEqual([]);
  });
});

describe("a detection rule's Status", () => {
  test("a run that failed reads Run failed, in red", () => {
    const status: SecurityDetectionStatus = getDetectionRuleStatus(
      rule({
        isEnabled: true,
        lastEvaluatedAt: POLLED_AT,
        lastError: "Timeout exceeded: elapsed 30.00 seconds, maximum: 30.",
      }),
    );

    expect(status).toBe(DETECTION_RULE_RUN_FAILED);
    expect(status.text).toBe("Run failed");
    expect(status.color).toBe(Red);
    expect(status.tooltip).toBe(
      "The last run failed. Open View Error for the full message.",
    );
  });

  test("a run that matched more groups than it opens cases for needs a look, in yellow", () => {
    const status: SecurityDetectionStatus = getDetectionRuleStatus(
      rule({
        isEnabled: true,
        lastEvaluatedAt: POLLED_AT,
        lastError: RULE_OVERFLOW,
      }),
    );

    expect(status).toBe(DETECTION_RULE_NEEDS_ATTENTION);
    expect(status.text).toBe("Needs attention");
    expect(status.color).toBe(Yellow);
    expect(status.tooltip).toBe(
      "The last run left a message. Open View Error to read it.",
    );
  });

  test("a rule that has not run yet waits for its first run, in grey", () => {
    const status: SecurityDetectionStatus = getDetectionRuleStatus(
      rule({ isEnabled: true }),
    );

    expect(status).toBe(DETECTION_RULE_WAITING);
    expect(status.text).toBe("Waiting for first run");
    expect(status.color).toBe(LightGray);
    expect(status.tooltip).toBe("A new rule runs within a minute.");
  });

  test("a rule whose last run came back clean reads Enabled; a switched-off one Disabled", () => {
    expect(
      getDetectionRuleStatus(
        rule({ isEnabled: true, lastEvaluatedAt: POLLED_AT }),
      ),
    ).toBe(SECURITY_DETECTION_ENABLED);
    expect(
      getDetectionRuleStatus(
        rule({ isEnabled: false, lastError: "Timeout exceeded" }),
      ),
    ).toBe(SECURITY_DETECTION_DISABLED);
  });

  test("a real-time rule runs on no interval: it reads Real time, in green, never waiting for a run", () => {
    const status: SecurityDetectionStatus = getDetectionRuleStatus(
      rule({ isEnabled: true, isRealTime: true }),
    );

    expect(status).toBe(DETECTION_RULE_REAL_TIME);
    expect(status.text).toBe("Real time");
    expect(status.color).toBe(Green);
    expect(status.tooltip).toBe(
      "Checks each event as it arrives, within seconds, instead of every interval.",
    );

    // A failed confirmation still reads as one; a switched-off rule as off.
    expect(
      getDetectionRuleStatus(
        rule({ isEnabled: true, isRealTime: true, lastError: "Timeout" }),
      ),
    ).toBe(DETECTION_RULE_RUN_FAILED);
    expect(
      getDetectionRuleStatus(rule({ isEnabled: false, isRealTime: true })),
    ).toBe(SECURITY_DETECTION_DISABLED);
  });

  test("its one message is its Last Error, a note when the run wrote it about its work", () => {
    expect(
      getDetectionRuleMessages(rule({ lastError: RULE_OVERFLOW })),
    ).toEqual([
      { label: "Last Error", message: RULE_OVERFLOW, isNotice: true },
    ]);
    expect(getDetectionRuleMessages(rule({ lastError: "Timeout" }))).toEqual([
      { label: "Last Error", message: "Timeout", isNotice: false },
    ]);
    expect(getDetectionRuleMessages(rule({}))).toEqual([]);
  });
});

/*
 * The pill and its tooltip look their words up as they draw them: each must
 * be a key of the Dashboard's English, and each of the sixteen languages
 * words it, so no reader meets an English status in their own language.
 */
describe("every Status is worded in every Dashboard language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  const LANGUAGES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  const readLocale: (code: string) => Record<string, string> = (
    code: string,
  ): Record<string, string> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, string>;
  };

  const STATUSES: Array<SecurityDetectionStatus> = [
    THREAT_INTEL_FEED_POLL_FAILED,
    THREAT_INTEL_FEED_MATCHING_FAILED,
    THREAT_INTEL_FEED_NEEDS_ATTENTION,
    THREAT_INTEL_FEED_WAITING,
    DETECTION_RULE_RUN_FAILED,
    DETECTION_RULE_NEEDS_ATTENTION,
    DETECTION_RULE_WAITING,
    DETECTION_RULE_REAL_TIME,
    SECURITY_DETECTION_ENABLED,
    SECURITY_DETECTION_DISABLED,
  ];

  const WORDS: Array<string> = [];

  for (const status of STATUSES) {
    WORDS.push(status.text);

    if (status.tooltip) {
      WORDS.push(status.tooltip);
    }
  }

  WORDS.push(LAST_ERROR_LABEL, LAST_MATCH_ERROR_LABEL);

  test("each is a key of the English", () => {
    const english: Record<string, string> = readLocale("en");

    for (const words of WORDS) {
      expect(english[words]).toBe(words);
    }
  });

  test.each(LANGUAGES)("%s words each one", (code: string) => {
    const locale: Record<string, string> = readLocale(code);

    // The column titles are older keys, worded as their locale words them.
    const statusWords: Array<string> = WORDS.filter((words: string) => {
      return words !== LAST_ERROR_LABEL && words !== LAST_MATCH_ERROR_LABEL;
    });

    for (const words of statusWords) {
      expect(typeof locale[words]).toBe("string");
      expect(locale[words]).not.toBe(words);
    }
  });

  test("a tooltip names the button as the row draws it, in each language", () => {
    for (const code of LANGUAGES) {
      const locale: Record<string, string> = readLocale(code);
      const viewError: string = locale["View Error"] as string;

      expect(viewError).toBeTruthy();

      for (const status of STATUSES) {
        if (!status.tooltip || !status.tooltip.includes("View Error")) {
          continue;
        }

        expect(locale[status.tooltip]).toContain(viewError);
      }
    }
  });
});
