import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The guides say how text reaches Slack, Microsoft Teams and the feeds:
 *
 *   - Subscribers & Announcements (English and Persian, the one translated
 *     corpus with a "Values in templates" section): every subscriber
 *     message escapes plain values for Markdown - incidents, episodes,
 *     scheduled maintenance, announcements, the welcome and test messages;
 *   - Incident & Alert Dynamic Templating (every language): what a monitored
 *     system sent is placed into a description and remediation notes as
 *     text, between the basic and the advanced usage;
 *   - AI SRE (English and Persian): what OneUptime AI writes keeps its
 *     formatting and acts on nothing.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const ALL_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

function readGuide(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

describe("Subscribers & Announcements: values in Slack and Teams templates", () => {
  test("English names every subscriber message whose plain values are escaped for Markdown", () => {
    const guide: string = readGuide("en", "status-pages/subscribers.md");
    const start: number = guide.indexOf("### Values in templates");
    const section: string = guide.slice(start, guide.indexOf("\n### ", start + 1));

    expect(start).toBeGreaterThan(0);
    for (const phrase of [
      "an incident's, an incident episode's, a scheduled maintenance event's or an announcement's",
      "the welcome and test messages",
      "the status page's name",
      "the resources affected",
      "in the default messages and in your own templates alike",
      "on one line",
      "`<!channel>`",
    ]) {
      expect(section).toContain(phrase);
    }
  });

  test("Persian says the same", () => {
    const guide: string = readGuide("fa", "status-pages/subscribers.md");

    for (const phrase of [
      "نگهداری زمان‌بندی‌شده",
      "اطلاعیه",
      "پیام‌های خوش‌آمد و آزمایشی",
      "نام صفحهٔ وضعیت",
      "در یک خط",
      "`<!channel>`",
    ]) {
      expect(guide).toContain(phrase);
    }
  });
});

describe("Incident & Alert Dynamic Templating: values from the monitored system", () => {
  test.each(ALL_LANGUAGES)(
    "%s: a subsection between the basic and the advanced usage says values are placed as text",
    (language: string) => {
      const lines: Array<string> = readGuide(
        language,
        "monitor/incident-alert-templating.md",
      ).split("\n");

      const secondLevel: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith("## ") ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      // Basic usage is the third second-level heading, advanced the fourth.
      const between: Array<string> = lines.slice(
        secondLevel[2]! + 1,
        secondLevel[3]!,
      );
      const subsection: number = between.findIndex((line: string): boolean => {
        return line.startsWith("### ");
      });

      expect(subsection).toBeGreaterThanOrEqual(0);

      const text: string = between.slice(subsection).join("\n");

      expect(text).toContain("`<!channel>`");
      expect(text).toContain("Markdown");
      expect(text).toContain("Slack");
      // German compounds it: "Microsoft-Teams-Kanälen".
      expect(text).toMatch(/Microsoft[ -]Teams/);
    },
  );
});

describe("AI SRE: what OneUptime AI writes", () => {
  test.each([["en"], ["fa"]])(
    "%s: trust and safety says its text keeps its formatting and acts on nothing",
    (language: string) => {
      const guide: string = readGuide(language, "ai/ai-sre.md");
      const trust: number = guide.indexOf(
        language === "en" ? "## Trust and safety" : "## اعتماد و ایمنی",
      );
      const section: string = guide.slice(trust, guide.indexOf("\n## ", trust + 1));

      expect(trust).toBeGreaterThan(0);
      expect(section).toContain("`<!channel>`");
      expect(section).toContain("Slack");
      expect(section).toContain("Microsoft Teams");
      expect(section).toContain("HTML");
    },
  );
});
