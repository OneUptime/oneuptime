import { describe, expect, test } from "@jest/globals";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  formatSessionReplayRetention,
  getSessionReplayRetentionOptions,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayRetention";

/*
 * A session replay retention, as the Replay Policy page says it (issue
 * #6369): the read view's "30 days" or "not set (defaults to 7 days)", and
 * Edit Policy's Limits choices. They were glued in English ("30 day" + "s")
 * in every language; each is a whole count-dependent phrase now, in the
 * reader's language when the page hands its translator in and in English,
 * word for word, without one.
 */

// A reader whose every lookup is marked: what was looked up shows.
const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

function labels(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return option.label;
  });
}

describe("getSessionReplayRetentionOptions", () => {
  test("offers the closed set, the default marked, in English without a translator", () => {
    const options: Array<DropdownOption> = getSessionReplayRetentionOptions();

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(SESSION_REPLAY_ALLOWED_RETENTION_DAYS);
    expect(DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS).toBe(7);
    expect(labels(options)).toEqual([
      "1 day",
      "7 days (default)",
      "14 days",
      "30 days",
      "90 days",
    ]);
  });

  test("words every choice as a whole phrase in the reader's language", () => {
    expect(labels(getSessionReplayRetentionOptions(MARKING))).toEqual([
      // A language's "one" form is its own key.
      "⟦1 days_one⟧",
      "⟦7 days (default)⟧",
      "⟦14 days⟧",
      "⟦30 days⟧",
      "⟦90 days⟧",
    ]);
  });
});

describe("formatSessionReplayRetention", () => {
  test("reads in English, word for word, without a translator", () => {
    expect(formatSessionReplayRetention(1)).toBe("1 day");
    expect(formatSessionReplayRetention(30)).toBe("30 days");
    expect(formatSessionReplayRetention(undefined)).toBe(
      "not set (defaults to 7 days)",
    );
  });

  test("is one looked-up phrase in the reader's language", () => {
    expect(formatSessionReplayRetention(30, MARKING)).toBe("⟦30 days⟧");
    expect(formatSessionReplayRetention(0, MARKING)).toBe(
      "⟦not set (defaults to 7 days)⟧",
    );
  });
});
