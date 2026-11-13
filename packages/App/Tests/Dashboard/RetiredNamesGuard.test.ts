// UX rule: Docs/ux/README.md#names
import {
  scanSourceRoots,
  SOURCE_ROOTS,
  SourceScanResult,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import DocsNav, { NavGroup, NavLink } from "../../FeatureSet/Docs/Utils/Nav";
import {
  findRetiredNames,
  RETIRED_NAMES,
  RetiredName,
} from "Common/Types/Docs/RetiredNames";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RETIRED NAME DOES NOT COME BACK (#6817: one name per thing).
 *
 * One thing had two or three names - "On-Call Duty", "On-Call" and "On
 * Call"; a person's own paging rules and the project's were both "On-Call
 * Rules" - so nobody could trust that a word meant the same on the next
 * page. #6817 kept one name for each and retired the rest
 * (Common/Types/Docs/RetiredNames). This holds what people read to that:
 *
 *   - every word the Dashboard draws, as its translation extractor finds
 *     them: menus, titles, cards, buttons, sentences, model and column
 *     names, and the nested menu words of en.json;
 *   - the permission picker's titles and descriptions;
 *   - the emails' templates, and what the server says in English;
 *   - the English docs, their nav titles, and the website.
 *
 * A retired name stays only where people who learned it look for it: a
 * Search keyword (not drawn, so not read here), an "Also called" name in
 * the glossary (skipped below), a docs-search synonym (code), and an address
 * or API name (code, a model's apiSingularName, a `code span` in the docs).
 * RetiredNamesFindable checks that it is still found there.
 *
 * A failure names the file and line, the words, and what the thing is
 * called now: write that instead. If the words are an API name or a stored
 * value, keep them out of what is drawn (a model's apiSingularName, a label
 * of its own as NotificationRuleCondition's CHECK_ON_LABELS gives).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const PACKAGES: string = path.join(REPOSITORY_ROOT, "packages");
const DASHBOARD_LOCALES: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src/Locales",
);
const DOCS_EN: string = path.join(PACKAGES, "App/FeatureSet/Docs/Content/en");
const EMAIL_TEMPLATES: string = path.join(
  PACKAGES,
  "App/FeatureSet/Notification/Templates",
);
const SERVER_ENGLISH: string = path.join(PACKAGES, "Common/Server/Locales/en.json");
const WEBSITE_VIEWS: string = path.join(PACKAGES, "Home/Views");
const SAMPLE_PROJECT: string = path.join(PACKAGES, "Common/Types/SampleProject");

interface Sighting {
  where: string;
  text: string;
  retired: string;
  nowCalled: string;
}

function sightings(where: string, text: string): Array<Sighting> {
  return findRetiredNames(text).map((retired: RetiredName): Sighting => {
    return {
      where,
      text: text.length > 160 ? `${text.slice(0, 157)}...` : text,
      retired: retired.name,
      nowCalled: retired.nowCalled,
    };
  });
}

function filesUnder(dir: string, extension: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...filesUnder(entryPath, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file);
}

// Every string value of a locale tree that sits under a nested key.
function nestedValues(
  tree: Record<string, unknown>,
  prefix: string = "",
): Array<[string, string]> {
  const values: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(tree)) {
    if (value && typeof value === "object") {
      values.push(
        ...nestedValues(value as Record<string, unknown>, `${prefix}${key}.`),
      );
    } else if (typeof value === "string" && prefix) {
      values.push([`${prefix}${key}`, value]);
    }
  }

  return values;
}

/*
 * The prose of a Markdown page, line by line: no fenced block, no `code`,
 * and no glossary "Also called" line, where a term's old names belong.
 */
export function proseLinesOf(markdown: string): Array<[number, string]> {
  const lines: Array<[number, string]> = [];
  let isInFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (/^\s*```/.test(line)) {
      isInFence = !isInFence;
      return;
    }

    if (isInFence || line.startsWith("Also called:")) {
      return;
    }

    lines.push([index + 1, line.replace(/`[^`]*`/g, "")]);
  });

  return lines;
}

const SCAN: SourceScanResult = scanSourceRoots(SOURCE_ROOTS);

describe("the retired names are told apart from the ordinary words they look like", () => {
  test.each([
    ["Open On-Call Duty > Readiness for the full list.", "On-Call Duty"],
    ["On Call Duty Policy Name", "On-Call Duty"],
    ["User On Call Time", "On Call"],
    ["On Call Executions", "On Call"],
    ["Edit On-Call Policy Schedule", "On-Call Policy Schedule"],
    ["See [Personal On-Call Rules](/docs/notifications/on-call-rules)", "Personal On-Call Rules"],
    ["their personal on-call rules", "Personal On-Call Rules"],
    [
      "Turn it on in Project Settings → Notifications → Notification Settings.",
      "Project Settings > Notifications > Notification Settings",
    ],
    [
      "on **Project Settings** > **Notifications** > **Notification Settings**",
      "Project Settings > Notifications > Notification Settings",
    ],
  ])('"%s" uses the retired name %s', (text: string, name: string) => {
    expect(
      findRetiredNames(text).map((retired: RetiredName): string => {
        return retired.name;
      }),
    ).toEqual([name]);
  });

  test.each([
    "Page whoever is on call in this schedule.",
    "On-call duty rotates through these users top to bottom.",
    "How often on-call duty passes to the next person in the layer.",
    "You are on call now.",
    "On-Call Policies",
    "On-Call > Advanced > User Overrides",
    "User On-Call Time",
    "On-Call Schedules",
    "How to Reach Me",
    "Incidents > Rules > On-Call Rules",
    "User Settings > Notification Settings",
    "Project Settings → Notifications → Notification Channels",
    "OnCallDutyPolicy",
    "/dashboard/:projectId/on-call-duty/policies",
  ])('"%s" is an ordinary word, a kept name or an address', (text: string) => {
    expect(findRetiredNames(text)).toEqual([]);
  });

  test("every retired name says what it is called now, and the two never match each other", () => {
    for (const retired of RETIRED_NAMES) {
      expect(retired.nowCalled.length).toBeGreaterThan(0);
      expect({
        name: retired.name,
        matchesItself: retired.pattern.test(retired.example || retired.name),
      }).toEqual({
        name: retired.name,
        matchesItself: true,
      });
      expect({
        name: retired.name,
        nowCalledMatches: findRetiredNames(retired.nowCalled).length,
      }).toEqual({ name: retired.name, nowCalledMatches: 0 });
    }
  });
});

describe("the Dashboard never draws a retired name", () => {
  test("the extractor read the Dashboard, so an empty answer means something", () => {
    expect(SCAN.strings.length).toBeGreaterThan(20000);
  });

  test("no word the extractor finds - menus, titles, cards, sentences, model and column names - uses one", () => {
    const found: Array<Sighting> = [
      ...SCAN.strings.flatMap((string: { text: string; file: string; line: number }): Array<Sighting> => {
        return sightings(`${string.file}:${string.line}`, string.text);
      }),
      ...SCAN.hardcoded.flatMap((string: { text: string; file: string; line: number }): Array<Sighting> => {
        return sightings(`${string.file}:${string.line}`, string.text);
      }),
    ];

    expect(found).toEqual([]);
  });

  test("no nested menu word of any locale's English, such as a product's title, uses one", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, "en.json"), "utf8"),
    ) as Record<string, unknown>;
    const found: Array<Sighting> = nestedValues(english).flatMap(
      ([key, value]: [string, string]): Array<Sighting> => {
        return sightings(`en.json ${key}`, value);
      },
    );

    expect(found).toEqual([]);
  });

  test("no permission's title or description in the custom role picker uses one", () => {
    const found: Array<Sighting> = PermissionHelper.getAllPermissionProps().flatMap(
      (props: PermissionProps): Array<Sighting> => {
        return [
          ...sightings(`${props.permission} title`, props.title),
          ...sightings(`${props.permission} description`, props.description),
        ];
      },
    );

    expect(found).toEqual([]);
  });
});

describe("what the server sends never uses a retired name", () => {
  test("no email template does", () => {
    const found: Array<Sighting> = filesUnder(EMAIL_TEMPLATES, ".hbs").flatMap(
      (file: string): Array<Sighting> => {
        return fs
          .readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line: string, index: number): Array<Sighting> => {
            return sightings(`${relative(file)}:${index + 1}`, line);
          });
      },
    );

    expect(found).toEqual([]);
  });

  test("no English sentence of the server's own locale does", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(SERVER_ENGLISH, "utf8"),
    ) as Record<string, unknown>;
    const found: Array<Sighting> = Object.entries(english).flatMap(
      ([key, value]: [string, unknown]): Array<Sighting> => {
        return typeof value === "string"
          ? sightings(`Common/Server/Locales/en.json ${key}`, value)
          : [];
      },
    );

    expect(found).toEqual([]);
  });
});

describe("the docs and the website never use a retired name", () => {
  test("no line of the English docs' prose does, but a glossary term's other names", () => {
    const found: Array<Sighting> = filesUnder(DOCS_EN, ".md").flatMap(
      (file: string): Array<Sighting> => {
        return proseLinesOf(fs.readFileSync(file, "utf8")).flatMap(
          ([line, text]: [number, string]): Array<Sighting> => {
            return sightings(`${relative(file)}:${line}`, text);
          },
        );
      },
    );

    expect(found).toEqual([]);
  });

  test("the docs' prose reader skips only code and the glossary's other names", () => {
    expect(
      proseLinesOf(
        [
          "Open On-Call Duty.",
          "```",
          "On-Call Duty",
          "```",
          "Run `On-Call Duty` here.",
          "Also called: **On-Call Duty**.",
        ].join("\n"),
      ),
    ).toEqual([
      [1, "Open On-Call Duty."],
      [5, "Run  here."],
    ]);
  });

  test("no docs group or page title does", () => {
    const found: Array<Sighting> = (DocsNav as Array<NavGroup>).flatMap(
      (group: NavGroup): Array<Sighting> => {
        return [
          ...sightings(`Docs nav group`, group.title),
          ...(group.links as Array<NavLink>).flatMap(
            (link: NavLink): Array<Sighting> => {
              return sightings(`Docs nav ${link.url}`, link.title);
            },
          ),
        ];
      },
    );

    expect(found).toEqual([]);
  });

  /*
   * The sample project (#6808) seeds records people read as the product's
   * own: a monitor, an on-call policy and schedule, a maintenance event. Its
   * words are held like the Dashboard's, comments aside.
   */
  test("no record the sample project seeds does", () => {
    const found: Array<Sighting> = filesUnder(SAMPLE_PROJECT, ".ts").flatMap(
      (file: string): Array<Sighting> => {
        return fs
          .readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line: string, index: number): Array<Sighting> => {
            const trimmed: string = line.trim();

            if (
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*")
            ) {
              return [];
            }

            return sightings(`${relative(file)}:${index + 1}`, line);
          });
      },
    );

    expect(found).toEqual([]);
  });

  test("no page of the website does", () => {
    const found: Array<Sighting> = filesUnder(WEBSITE_VIEWS, ".ejs").flatMap(
      (file: string): Array<Sighting> => {
        return fs
          .readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line: string, index: number): Array<Sighting> => {
            return sightings(`${relative(file)}:${index + 1}`, line);
          });
      },
    );

    expect(found).toEqual([]);
  });
});
