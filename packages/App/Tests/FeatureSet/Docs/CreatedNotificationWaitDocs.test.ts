import CreatedNotificationHold from "Common/Server/Utils/Notification/CreatedNotificationHold";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs against when an incident's owners hear that it was created
 * (#7571, #7573).
 *
 * The Incident created notification waits for the incident's owners: the
 * Created job takes an incident let go a minute after its create, so the
 * owners a script, a workflow or the API adds right after the create are
 * told too, and a hold nobody lets go - OneUptime restarted while the
 * incident was being declared - ends after a few minutes
 * (CreatedNotificationHold). The owners page says so in every language, and
 * Markdown is not compiled, so these tests are what notices when the page
 * and the job part ways.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const PAGE: string = "incidents/notes-owners-and-feed.md";

function readDoc(language: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
}

function languages(): Array<string> {
  return fs
    .readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return (
        entry.isDirectory() &&
        fs.existsSync(path.join(CONTENT_DIR, entry.name, PAGE))
      );
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    });
}

// The table row of the Created notification: the one with its email subject.
function createdRow(language: string): string {
  const rows: Array<string> = readDoc(language)
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes("`[New Incident {number}] - {title}`");
    });

  expect(rows).toHaveLength(1);

  return rows[0]!;
}

describe("the docs on when an incident's owners hear that it was created", () => {
  test("the job waits the minute the page says, and a hold lasts the few minutes it says", () => {
    expect(CreatedNotificationHold.SENT_AFTER_CREATED_IN_MINUTES).toBe(1);
    expect(
      CreatedNotificationHold.HELD_FOR_AT_MOST_MINUTES,
    ).toBeLessThanOrEqual(5);
  });

  test("the English page says it goes out a minute after the declare, to owners a script adds too, and survives a restart", () => {
    const page: string = readDoc("en");

    expect(createdRow("en")).toContain(
      "| About a minute after the incident is declared.",
    );
    expect(page).toContain(
      "The **Incident created** notification waits for the incident's owners first: it goes out about a minute after the incident is declared, to every owner it has by then, including owners a script, a workflow or the API adds right after creating it, and to the project's owners only if it still has none.",
    );
    expect(page).toContain(
      "If OneUptime restarts while the incident is being declared, the notification still goes out, a few minutes late at most.",
    );
  });

  // Before #7210 only a form's template owners were waited for: no page says so any more.
  test("no page says it waits only for a form's template owners", () => {
    expect(readDoc("en")).not.toContain(
      "reported through a form whose template has owners waits for those owners instead",
    );

    for (const language of languages()) {
      const row: string = createdRow(language);
      // The When cell no longer says only that the incident is declared.
      const when: string = row.split("|")[2]!.trim();

      expect([language, when]).not.toEqual([
        language,
        "The incident is declared.",
      ]);
    }
  });

  test("every language's page is translated alike: its Created row names a minute", () => {
    const minute: Record<string, RegExp> = {
      en: /minute/,
      da: /minut/,
      de: /Minute/,
      es: /minuto/,
      fa: /دقیقه/,
      fr: /minute/,
      hi: /मिनट/,
      it: /minuto/,
      ja: /1 分/,
      ko: /1분/,
      nl: /minuut/,
      no: /minutt/,
      pt: /minuto/,
      ru: /минуту/,
      sv: /minut/,
      "zh-CN": /一分钟/,
      "zh-TW": /一分鐘/,
    };

    expect(languages().sort()).toEqual(Object.keys(minute).sort());

    for (const language of languages()) {
      expect([language, minute[language]!.test(createdRow(language))]).toEqual([
        language,
        true,
      ]);
    }
  });
});
