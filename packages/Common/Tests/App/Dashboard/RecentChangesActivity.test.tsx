import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import ChatActivityFeed, {
  describeRecentChanges,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import RecentChangesContext from "../../../Server/Utils/AI/SRE/RecentChangesContext";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import {
  AIRunEventResultSummary,
  RecentChangesActivity,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT AN INVESTIGATION READ ABOUT THE RECENT CHANGES, IN ITS ACTIVITY.
 *
 * Before the model starts, the run records how many changes it found from
 * the two hours before its subject and how many of them its services'
 * telemetry made suspects. The activity feed draws that as a line in the
 * reader's language, from the counts, not from the English the server
 * stored - and says the same as that English for an English reader.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function activity(
  partial: Partial<RecentChangesActivity> = {},
): RecentChangesActivity {
  return {
    changeCount: 3,
    suspectCount: 1,
    checkedCount: 2,
    hasMoreChanges: false,
    lookbackMinutes: 120,
    ...partial,
  };
}

function progressLog(summary: AIRunEventResultSummary): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = summary;
  return event;
}

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

afterEach(() => {
  cleanup();
});

describe("describeRecentChanges", () => {
  test("suspects are said first", () => {
    expect(describeRecentChanges(activity())).toBe(
      "Found 1 suspect among the recent changes",
    );
    expect(describeRecentChanges(activity({ suspectCount: 2 }))).toBe(
      "Found 2 suspects among the recent changes",
    );
  });

  test("changes without a suspect", () => {
    expect(
      describeRecentChanges(activity({ changeCount: 1, suspectCount: 0 })),
    ).toBe("Read 1 recent change; no suspect");
    expect(describeRecentChanges(activity({ suspectCount: 0 }))).toBe(
      "Read 3 recent changes; no suspect",
    );
  });

  test("no change at all", () => {
    expect(
      describeRecentChanges(activity({ changeCount: 0, suspectCount: 0 })),
    ).toBe("No recent changes recorded");
  });

  test("says what the server's English says, for every count", () => {
    for (const [changeCount, suspectCount] of [
      [0, 0],
      [1, 0],
      [4, 0],
      [4, 1],
      [4, 3],
    ] as Array<[number, number]>) {
      const counts: RecentChangesActivity = activity({
        changeCount,
        suspectCount,
      });
      expect(describeRecentChanges(counts)).toBe(
        RecentChangesContext.describeActivity(counts),
      );
    }
  });

  test("every locale holds every sentence, its English plural form included", () => {
    const keys: Array<string> = [
      "Found {{count}} suspects among the recent changes",
      "Found {{count}} suspects among the recent changes_one",
      "Read {{count}} recent changes; no suspect",
      "Read {{count}} recent changes; no suspect_one",
      "No recent changes recorded",
    ];

    const english: Record<string, string> = locale("en");

    for (const key of keys) {
      expect({ key, inEnglish: key in english }).toEqual({
        key,
        inEnglish: true,
      });
    }

    for (const file of fs.readdirSync(LOCALES)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const strings: Record<string, string> = locale(file.replace(".json", ""));
      for (const key of keys) {
        expect({
          file,
          key,
          present: typeof strings[key] === "string",
        }).toEqual({ file, key, present: true });
      }
    }
  });

  test("a language words it its own way when it has a translation", () => {
    const german: Record<string, string> = locale("de");
    const translator: Translator = createTranslator(
      (text: string): string | undefined => {
        return german[text];
      },
      "de",
    );
    expect(describeRecentChanges(activity(), translator)).toBe(
      "1 verdächtige Änderung unter den letzten Änderungen gefunden",
    );
    expect(
      describeRecentChanges(activity({ suspectCount: 0 }), translator),
    ).toBe("3 letzte Änderungen gelesen; keine verdächtig");
    expect(
      describeRecentChanges(
        activity({ changeCount: 0, suspectCount: 0 }),
        translator,
      ),
    ).toBe("Keine letzten Änderungen erfasst");
  });
});

describe("the activity feed draws it", () => {
  test("from the counts, as a quiet log line", () => {
    render(
      <ChatActivityFeed
        events={[
          progressLog({
            message: "the English the server stored",
            severity: "Info",
            recentChanges: activity(),
          }),
        ]}
        hideChrome={true}
      />,
    );

    const line: HTMLElement = screen.getByText(
      "Found 1 suspect among the recent changes",
    );

    expect(line).toBeVisible();
    expect(line).toHaveClass("text-gray-500");
    expect(screen.queryByText("the English the server stored")).toBeNull();
  });
});
