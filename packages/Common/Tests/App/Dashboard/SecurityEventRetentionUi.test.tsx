import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOW FAR BACK SECURITY EVENTS GO, WHERE A PERSON LOOKS (#10432). The
 * project keeps its security events for its retention, 15 days unless
 * changed, and what reads further back says so:
 *
 *   - under a rule as it is written, and in a Rule Library rule's details:
 *     a First seen rule that looks back 30 days takes a value last seen 20
 *     days ago for new, what it needs kept, and Change Retention;
 *   - under a hunt's time range: a range past the kept events finds nothing
 *     older;
 *   - on Settings -> Telemetry: the enabled rules that look back further,
 *     and the retention that covers them.
 *
 * Nothing is said while the kept events cover what is read, or while the
 * retention could not be read. Every sentence is in every language.
 */

const retentionMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        getSecurityEventRetention: (...args: Array<unknown>) => {
          return retentionMock(...args);
        },
      },
    };
  },
);

import DetectionRuleRetentionWarning from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/DetectionRuleRetentionWarning";
import HuntRangeRetentionWarning, {
  renderHuntRangeRetentionWarning,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/HuntRangeRetentionWarning";
import RulesPastRetentionNotice from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/RulesPastRetentionNotice";
import {
  HUNT_RANGE_PAST_RETENTION,
  RULE_FIRST_SEEN_PAST_RETENTION,
  RULE_WINDOW_PAST_RETENTION,
  SECURITY_EVENT_RETENTION_TEST_IDS,
  SETTINGS_RULES_PAST_RETENTION_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/SecurityEventRetentionCopy";
import {
  RetentionSentence,
  SettingsRetentionWarning,
  getDataRetentionSettingsRoute,
  getHuntRangeRetentionWarning,
  getRuleRetentionWarning,
  getSettingsRetentionWarning,
  writeRetentionSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/SecurityEventRetentionModel";
import {
  DetectionRuleShape,
  readDetectionRuleShape,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleShape";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import {
  DetectionRulePastRetention,
  SECONDS_IN_A_DAY,
  SecurityEventRetentionStatus,
} from "../../../Types/SecurityEvent/SecurityEventRetention";
import { DetectionRuleType } from "../../../Types/SecurityEvent/SigmaCorrelation";
import TimeRange from "../../../Types/Time/TimeRange";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";

const DAY: number = SECONDS_IN_A_DAY;

const FIRST_SEEN_30_DAYS: string = `title: AWS activity in a region the account never used
correlation:
  type: new_value
  rules: [cloudtrail_call]
  group-by: [targetHost]
  timespan: 30d
  condition:
    field: awsRegion
---
title: CloudTrail call
name: cloudtrail_call
detection:
  selection:
    productName: AWS CloudTrail
  condition: selection`;

const FIRST_SEEN_14_DAYS: string = FIRST_SEEN_30_DAYS.replace(
  "timespan: 30d",
  "timespan: 14d",
);

const SEQUENCE_WITH_COUNTING_STEP: string = `title: A burst, then a success
correlation:
  type: temporal_ordered
  rules: [burst, success]
  group-by: [principalIp]
  timespan: 1d
---
title: Burst
name: burst
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 12h
  condition:
    gte: 5
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Success
name: success
detection:
  selection:
    statusName: Success
  condition: selection`;

const SINGLE: string = `title: Audit log cleared
detection:
  selection:
    className: Account Change
  condition: selection`;

function shape(yaml: string): DetectionRuleShape {
  return readDetectionRuleShape(yaml)!;
}

function status(
  retentionInDays: number,
  rulesPastRetention: Array<DetectionRulePastRetention> | null = [],
): SecurityEventRetentionStatus {
  return {
    retentionInDays,
    rulesPastRetention,
    hasMoreRulesPastRetention: false,
  };
}

function pastRule(
  index: number,
  lookbackInDays: number,
): DetectionRulePastRetention {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    name: `Rule ${index}`,
    type: DetectionRuleType.NewValue,
    lookbackInSeconds: lookbackInDays * DAY,
  };
}

// Any run of white space as one space: a span of time holds its figure with a no-break space.
function oneSpace(text: string | null | undefined): string {
  return (text || "").replace(/\s+/g, " ");
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function draw(element: React.ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);
  await settle();
}

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  retentionMock.mockResolvedValue(status(15) as never);
});

afterEach(async () => {
  cleanup();
  retentionMock.mockReset();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("a rule whose window reaches past the kept events", () => {
  test("a 30-day First seen rule in a project keeping 15 days: what it reads, what is kept, what to change", () => {
    const warning: RetentionSentence | null = getRuleRetentionWarning({
      shape: shape(FIRST_SEEN_30_DAYS),
      retentionInDays: 15,
    });

    expect(warning).toEqual({
      template: RULE_FIRST_SEEN_PAST_RETENTION,
      spans: { lookback: 30 * DAY, retention: 15 * DAY, needed: 30 * DAY },
    });
    expect(
      oneSpace(writeRetentionSentence(getGlobalTranslator(), warning!)),
    ).toBe(
      "This rule looks back 30 days, but security events are kept for 15 days, so a value last seen before then reads as new. Keep them for at least 30 days, or shorten the rule's timespan.",
    );
  });

  test("a sequence whose window and counting step are longer than a day kept says it counts only those", () => {
    const warning: RetentionSentence | null = getRuleRetentionWarning({
      shape: shape(SEQUENCE_WITH_COUNTING_STEP),
      retentionInDays: 1,
    });

    expect(warning?.template).toBe(RULE_WINDOW_PAST_RETENTION);
    expect(
      oneSpace(writeRetentionSentence(getGlobalTranslator(), warning!)),
    ).toBe(
      "This rule's window is 36 hours, but security events are kept for 1 day, so it counts only those. Keep them for at least 2 days, or shorten the rule's timespan.",
    );
  });

  test("nothing while the kept events cover the window", () => {
    for (const retentionInDays of [30, 45, 90]) {
      expect(
        getRuleRetentionWarning({
          shape: shape(FIRST_SEEN_30_DAYS),
          retentionInDays,
        }),
      ).toBeNull();
    }

    expect(
      getRuleRetentionWarning({
        shape: shape(FIRST_SEEN_14_DAYS),
        retentionInDays: 15,
      }),
    ).toBeNull();
  });

  test("nothing for a single rule, a rule being typed, or a retention not known", () => {
    expect(
      getRuleRetentionWarning({ shape: shape(SINGLE), retentionInDays: 1 }),
    ).toBeNull();
    expect(
      getRuleRetentionWarning({
        shape: readDetectionRuleShape("title: [unclosed"),
        retentionInDays: 15,
      }),
    ).toBeNull();
    expect(
      getRuleRetentionWarning({
        shape: shape(FIRST_SEEN_30_DAYS),
        retentionInDays: null,
      }),
    ).toBeNull();
  });

  test("drawn under the rule, with Change Retention opening Data Retention", async () => {
    await draw(
      <DetectionRuleRetentionWarning shape={shape(FIRST_SEEN_30_DAYS)} />,
    );

    const warning: HTMLElement = screen.getByTestId(
      SECURITY_EVENT_RETENTION_TEST_IDS.ruleWarning,
    );

    expect(oneSpace(warning.textContent)).toContain(
      "This rule looks back 30 days, but security events are kept for 15 days, so a value last seen before then reads as new.",
    );
    expect(retentionMock).toHaveBeenCalledTimes(1);

    const link: HTMLElement = screen.getByTestId(
      SECURITY_EVENT_RETENTION_TEST_IDS.changeRetention,
    );

    expect(link).toHaveTextContent("Change Retention");
    expect(link.closest("a")?.getAttribute("href")).toContain(
      "/settings/telemetry-settings",
    );
  });

  test("drawn as nothing when the kept events cover it", async () => {
    retentionMock.mockResolvedValue(status(30) as never);

    await draw(
      <DetectionRuleRetentionWarning shape={shape(FIRST_SEEN_30_DAYS)} />,
    );

    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.ruleWarning),
    ).not.toBeInTheDocument();
  });

  test("drawn as nothing when the retention cannot be read: the form is as it was", async () => {
    retentionMock.mockRejectedValue(new Error("Forbidden") as never);

    await draw(
      <DetectionRuleRetentionWarning shape={shape(FIRST_SEEN_30_DAYS)} />,
    );

    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.ruleWarning),
    ).not.toBeInTheDocument();
  });

  test("nor when the answer is not one", async () => {
    retentionMock.mockResolvedValue(null as never);

    await draw(
      <DetectionRuleRetentionWarning shape={shape(FIRST_SEEN_30_DAYS)} />,
    );

    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.ruleWarning),
    ).not.toBeInTheDocument();
  });
});

describe("a hunt's time range past the kept events", () => {
  test("a month or three, in a project keeping 15 days, finds nothing older", () => {
    for (const range of [
      TimeRange.PAST_ONE_MONTH,
      TimeRange.PAST_THREE_MONTHS,
    ]) {
      const warning: RetentionSentence | null = getHuntRangeRetentionWarning({
        timeRange: range,
        retentionInDays: 15,
      });

      expect(warning).toEqual({
        template: HUNT_RANGE_PAST_RETENTION,
        spans: { retention: 15 * DAY },
      });
      expect(
        oneSpace(writeRetentionSentence(getGlobalTranslator(), warning!)),
      ).toBe(
        "Security events are kept for 15 days: this range finds nothing older.",
      );
    }
  });

  test("a range the kept events cover says nothing", () => {
    for (const range of [
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_WEEK,
      TimeRange.PAST_TWO_WEEKS,
    ]) {
      expect(
        getHuntRangeRetentionWarning({ timeRange: range, retentionInDays: 15 }),
      ).toBeNull();
    }

    expect(
      getHuntRangeRetentionWarning({
        timeRange: TimeRange.PAST_THREE_MONTHS,
        retentionInDays: 90,
      }),
    ).toBeNull();
  });

  test("nor a range that is not a hunt's, or a retention not known", () => {
    expect(
      getHuntRangeRetentionWarning({
        timeRange: TimeRange.CUSTOM,
        retentionInDays: 15,
      }),
    ).toBeNull();
    expect(
      getHuntRangeRetentionWarning({
        timeRange: TimeRange.PAST_THREE_MONTHS,
        retentionInDays: null,
      }),
    ).toBeNull();
  });

  test("drawn under the form's time range", async () => {
    await draw(
      renderHuntRangeRetentionWarning({
        timeRange: TimeRange.PAST_THREE_MONTHS,
      } as unknown as FormValues<SecurityHunt>),
    );

    expect(
      oneSpace(
        screen.getByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.huntRangeWarning)
          .textContent,
      ),
    ).toBe(
      "Security events are kept for 15 days: this range finds nothing older.",
    );
  });

  test("drawn as nothing for a week", async () => {
    await draw(
      <HuntRangeRetentionWarning timeRange={TimeRange.PAST_ONE_WEEK} />,
    );

    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.huntRangeWarning),
    ).not.toBeInTheDocument();
  });
});

describe("Settings -> Telemetry: enabled rules that look back further than events are kept", () => {
  test("how many, the first five by how far back they read, how many more, and what covers them", () => {
    const rules: Array<DetectionRulePastRetention> = [
      pastRule(1, 30),
      pastRule(2, 30),
      pastRule(3, 21),
      pastRule(4, 20),
      pastRule(5, 20),
      pastRule(6, 18),
      pastRule(7, 16),
    ];

    const warning: SettingsRetentionWarning | null =
      getSettingsRetentionWarning(status(15, rules));

    expect(warning?.count).toBe(7);
    expect(warning?.listed).toEqual(rules.slice(0, 5));
    expect(warning?.moreCount).toBe(2);
    expect(warning?.description).toEqual({
      template: SETTINGS_RULES_PAST_RETENTION_DESCRIPTION,
      spans: { retention: 15 * DAY, needed: 30 * DAY },
    });
  });

  test("nothing while every enabled rule fits, or the person may not read rules, or it could not be read", () => {
    expect(getSettingsRetentionWarning(status(15, []))).toBeNull();
    expect(getSettingsRetentionWarning(status(15, null))).toBeNull();
    expect(getSettingsRetentionWarning(null)).toBeNull();
  });

  test("drawn with each rule's name and how far back it reads, and the rest counted", async () => {
    retentionMock.mockResolvedValue(
      status(15, [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
          name: "AWS activity in a region the account never used",
          type: DetectionRuleType.NewValue,
          lookbackInSeconds: 30 * DAY,
        },
        pastRule(2, 21),
        pastRule(3, 20),
        pastRule(4, 20),
        pastRule(5, 18),
        pastRule(6, 16),
      ]) as never,
    );

    await draw(<RulesPastRetentionNotice className="mb-5" />);

    const notice: HTMLElement = screen.getByTestId(
      SECURITY_EVENT_RETENTION_TEST_IDS.settingsNotice,
    );

    expect(notice).toHaveClass("mb-5");
    expect(oneSpace(notice.textContent)).toContain(
      "6 enabled detection rules look back further than security events are kept",
    );
    expect(oneSpace(notice.textContent)).toContain(
      "Security events are kept for 15 days, so these rules see only that much, and a First seen rule takes a value last seen before then for new. Keep them for at least 30 days to cover every rule.",
    );

    const lines: Array<string> = screen
      .getAllByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsRule)
      .map((line: HTMLElement): string => {
        return oneSpace(line.textContent);
      });

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(
      "AWS activity in a region the account never used: looks back 30 days",
    );
    expect(lines[1]).toBe("Rule 2: looks back 3 weeks");
    expect(
      screen.getByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsMoreRules),
    ).toHaveTextContent("1 more rule");
  });

  test("one rule is one rule", async () => {
    retentionMock.mockResolvedValue(status(15, [pastRule(1, 30)]) as never);

    await draw(<RulesPastRetentionNotice />);

    expect(
      oneSpace(
        screen.getByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsNotice)
          .textContent,
      ),
    ).toContain(
      "1 enabled detection rule looks back further than security events are kept",
    );
    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsMoreRules),
    ).not.toBeInTheDocument();
  });

  test("drawn as nothing while every rule fits", async () => {
    retentionMock.mockResolvedValue(status(30, []) as never);

    await draw(<RulesPastRetentionNotice />);

    expect(
      screen.queryByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsNotice),
    ).not.toBeInTheDocument();
  });

  test("Data Retention is where the retention is changed", () => {
    expect(getDataRetentionSettingsRoute().toString()).toContain(
      "/settings/telemetry-settings",
    );
  });
});

/*
 * Every sentence in every language the Dashboard ships: the reader's words,
 * never the English, with each span of time written in the sentence's own
 * language.
 */
describe("in every language", () => {
  const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
    (language: string): boolean => {
      return language !== "en";
    },
  );

  test("the Dashboard ships 17 languages besides English", () => {
    expect(OTHER_LANGUAGES).toHaveLength(17);
  });

  test.each(OTHER_LANGUAGES)(
    "%s words the rule's warning, its spans of time in its own words",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const translator: Translator = getGlobalTranslator();
      const warning: RetentionSentence = getRuleRetentionWarning({
        shape: shape(FIRST_SEEN_30_DAYS),
        retentionInDays: 15,
      })!;
      const english: string =
        "This rule looks back 30 days, but security events are kept for 15 days, so a value last seen before then reads as new. Keep them for at least 30 days, or shorten the rule's timespan.";
      const written: string = oneSpace(
        writeRetentionSentence(translator, warning),
      );

      expect(written).not.toBe(english);
      expect(written).not.toContain("{{");
      // The spans of time are the language's, not English days.
      expect(written).not.toContain("30 days");
      expect(written).not.toContain("15 days");
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s words the Settings notice and a hunt's time range",
    async (language: string) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      retentionMock.mockResolvedValue(status(15, [pastRule(1, 30)]) as never);

      await draw(
        <>
          <RulesPastRetentionNotice />
          <HuntRangeRetentionWarning timeRange={TimeRange.PAST_ONE_MONTH} />
        </>,
      );

      const notice: string = oneSpace(
        screen.getByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.settingsNotice)
          .textContent,
      );
      const range: string = oneSpace(
        screen.getByTestId(SECURITY_EVENT_RETENTION_TEST_IDS.huntRangeWarning)
          .textContent,
      );

      expect(notice).not.toContain("look back further than security events");
      expect(notice).not.toContain("so these rules see only that much");
      expect(notice).not.toContain("{{");
      expect(range).not.toContain("this range finds nothing older");
      expect(range).not.toContain("{{");
    },
  );
});
