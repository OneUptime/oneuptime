import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A page's trail is a list of titles (BuildBreadcrumbLinksByTitles) that
 * Breadcrumbs translates when it draws them. The extractor did not read
 * those lists, so a title no other place happened to use - "View Runbook",
 * "Pod Detail", "View MCP Server" - was no key, and read in English in
 * every language (#5042, #5112, #5150). It reads them now; this holds every
 * trail in the Dashboard to it: each title is a key of en.json, so it is in
 * every locale to translate. A trail added without running
 * `npm run i18n:extract` fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const CALL: string = "BuildBreadcrumbLinksByTitles(";

// The Dashboard's sixteen languages besides English.
const LANGUAGES: ReadonlyArray<string> = [
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

function sourceFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(full);
      }

      return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
    });
}

const TRAIL_FILES: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
  (file: string): boolean => {
    return (
      fs.readFileSync(file, "utf8").includes(CALL) &&
      // The helper itself builds the trails; it holds no titles.
      !file.endsWith(path.join("Breadcrumbs", "Helper.ts"))
    );
  },
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

// Every title a trail file hands BuildBreadcrumbLinksByTitles, with its file.
function trailTitles(): Array<{ file: string; title: string }> {
  return TRAIL_FILES.flatMap(
    (file: string): Array<{ file: string; title: string }> => {
      const relative: string = path
        .relative(REPOSITORY_ROOT, file)
        .split(path.sep)
        .join("/");

      return scanSourceText(relative, fs.readFileSync(file, "utf8"), {
        kind: "ui",
      })
        .strings.filter((entry: ExtractedString): boolean => {
          return entry.kind === "prop";
        })
        .map((entry: ExtractedString): { file: string; title: string } => {
          return { file: relative, title: entry.text };
        });
    },
  );
}

describe("every breadcrumb title in the Dashboard is a translation key", () => {
  test("the trails are found: the breadcrumb utilities and the pages' own", () => {
    expect(TRAIL_FILES.length).toBeGreaterThan(40);
    expect(
      TRAIL_FILES.some((file: string): boolean => {
        return file.endsWith(
          path.join("Breadcrumbs", "RunbooksBreadcrumbs.ts"),
        );
      }),
    ).toBe(true);
    expect(trailTitles().length).toBeGreaterThan(1000);
  });

  test("each title is a key of en.json", () => {
    const missing: Array<string> = trailTitles()
      .filter((entry: { file: string; title: string }): boolean => {
        return ENGLISH[entry.title] !== entry.title;
      })
      .map((entry: { file: string; title: string }): string => {
        return `${entry.file}: ${entry.title}`;
      });

    expect(missing).toEqual([]);
  });

  /*
   * A key is not yet a translation: forty-odd trail titles - Delete Storage
   * Array, Site Types, Reminder Rules, Replay Users, Device Registry,
   * Latency Matrix, Video Calls - were keys of every locale and still read
   * in English in twelve languages (#5305's follow-up). Each title now
   * reads in every language: translated, or listed as reading the same
   * there (i18n/SameAsEnglish.json for every language - product names,
   * protocols - and each locale's i18n/Progress list for its own borrowed
   * words, as "Dashboards" is in Dutch). A title added to a trail needs
   * its words in every language, or a reason it reads the same.
   */
  test("each title reads in every language: translated, or the same there on purpose", () => {
    const i18nDirectory: string = path.join(
      REPOSITORY_ROOT,
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "i18n",
    );
    const everywhereTheSame: Set<string> = new Set<string>(
      JSON.parse(
        fs.readFileSync(path.join(i18nDirectory, "SameAsEnglish.json"), "utf8"),
      ) as Array<string>,
    );
    const titles: Array<string> = Array.from(
      new Set<string>(
        trailTitles().map((entry: { file: string; title: string }): string => {
          return entry.title;
        }),
      ),
    ).filter((title: string): boolean => {
      // "{{count}}"-like titles have no words to translate.
      return /[A-Za-z]/.test(title);
    });

    expect(LANGUAGES).toHaveLength(16);
    expect(titles.length).toBeGreaterThan(400);

    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
        fs.readFileSync(
          path.join(i18nDirectory, "Progress", `${language}.json`),
          "utf8",
        ),
      ) as { sameAsEnglish?: Array<string> };
      const theSameHere: Set<string> = new Set<string>(
        progress.sameAsEnglish || [],
      );

      const inEnglish: Array<string> = titles.filter(
        (title: string): boolean => {
          return (
            locale[title] === title &&
            !everywhereTheSame.has(title) &&
            !theSameHere.has(title)
          );
        },
      );

      expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
    }
  });

  test("the titles that read in English everywhere before are among them", () => {
    const titles: Set<string> = new Set<string>(
      trailTitles().map((entry: { file: string; title: string }): string => {
        return entry.title;
      }),
    );

    for (const title of [
      "View Runbook",
      "Pod Detail",
      "Node Detail",
      "View MCP Server",
      "View Provider",
      "Host Detail",
      "View Monitor Group",
    ]) {
      expect({ title, isTrailTitle: titles.has(title) }).toEqual({
        title,
        isTrailTitle: true,
      });
      expect(ENGLISH[title]).toBe(title);
    }
  });
});
