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
import { FoundText, PACKAGES_ROOT, productTexts } from "./ProductTextScan";
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
 *     names, and the nested menu words of en.json; and every key of en.json,
 *     so an old text's translations are deleted with it;
 *   - the permission picker's titles and descriptions;
 *   - the emails' templates, and what the server says in English;
 *   - the English locale of every other front end: the public status page,
 *     the sign-in pages, the Admin Dashboard, public dashboards, the API
 *     reference and the docs' own words;
 *   - every string the server, the emails and each front end write
 *     (ProductTextScan), where the extractor does not look: chat messages,
 *     workflow templates, error messages, props drawn as words;
 *   - the English docs, their diagrams, their nav titles, and the website.
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
const SERVER_ENGLISH: string = path.join(
  PACKAGES,
  "Common/Server/Locales/en.json",
);
/*
 * Every front end's English locale but the Dashboard's, which the
 * extractor's tests read: the public status page says "Scheduled
 * Maintenance" for what it called "Scheduled Events" (#6817 part 3).
 */
const OTHER_FRONT_END_LOCALES: ReadonlyArray<string> = [
  "App/FeatureSet/APIReference/Locales/en.json",
  "App/FeatureSet/Accounts/src/Locales/en.json",
  "App/FeatureSet/AdminDashboard/src/Locales/en.json",
  "App/FeatureSet/Docs/Locales/en.json",
  "App/FeatureSet/PublicDashboard/src/Locales/en.json",
  "App/FeatureSet/StatusPage/src/Locales/en.json",
];
const WEBSITE_VIEWS: string = path.join(PACKAGES, "Home/Views");
const SAMPLE_PROJECT: string = path.join(
  PACKAGES,
  "Common/Types/SampleProject",
);

interface Sighting {
  where: string;
  text: string;
  retired: string;
  nowCalled: string;
}

/*
 * Names another app keeps, as an API keeps its names: the Slack app's
 * shortcuts, which a workspace shows as its app was set up from
 * app-manifest.json ("Create Scheduled Event"). Renaming one there would
 * leave every installed app showing the old name while the docs and the
 * prompts said the new one, so the docs and the prompts say what Slack
 * shows.
 */
const SLACK_MANIFEST: string = path.join(
  PACKAGES,
  "Common/Server/Utils/Workspace/Slack/app-manifest.json",
);

function keptExternalNames(): Array<string> {
  const manifest: {
    features?: { shortcuts?: Array<{ name: string }> };
  } = JSON.parse(fs.readFileSync(SLACK_MANIFEST, "utf8"));

  return (manifest.features?.shortcuts || []).map(
    (shortcut: { name: string }): string => {
      return shortcut.name;
    },
  );
}

const KEPT_EXTERNAL_NAMES: Array<string> = keptExternalNames();

function sightings(where: string, rawText: string): Array<Sighting> {
  // A name another app keeps is not a retired name's sighting.
  const text: string = KEPT_EXTERNAL_NAMES.reduce(
    (stripped: string, name: string): string => {
      return stripped.split(name).join("");
    },
    rawText,
  );

  return findRetiredNames(text).map((retired: RetiredName): Sighting => {
    return {
      where,
      text: rawText.length > 160 ? `${rawText.slice(0, 157)}...` : rawText,
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

// Every string of a locale, at the top level too, by its key's path.
function allValues(tree: Record<string, unknown>): Array<[string, string]> {
  return [
    ...Object.entries(tree).filter(
      (entry: [string, unknown]): entry is [string, string] => {
        return typeof entry[1] === "string";
      },
    ),
    ...nestedValues(tree),
  ];
}

/*
 * The prose of a Markdown page, line by line: no fenced code block, no
 * `code`, and no glossary "Also called" line, where a term's old names
 * belong. A diagram (a mermaid block) is read: the page draws its labels,
 * a line break in one read as a space.
 */
const FENCE: RegExp = /^\s*```/;
const DIAGRAM_FENCE: RegExp = /^\s*```mermaid\b/;

export function proseLinesOf(markdown: string): Array<[number, string]> {
  const lines: Array<[number, string]> = [];
  let fence: "code" | "diagram" | null = null;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (FENCE.test(line)) {
      if (fence) {
        fence = null;
      } else {
        fence = DIAGRAM_FENCE.test(line) ? "diagram" : "code";
      }
      return;
    }

    if (fence === "code" || line.startsWith("Also called:")) {
      return;
    }

    const read: string =
      fence === "diagram" ? line.replace(/<br\s*\/?>/g, " ") : line;

    lines.push([index + 1, read.replace(/`[^`]*`/g, "")]);
  });

  return lines;
}

const SCAN: SourceScanResult = scanSourceRoots(SOURCE_ROOTS);

const MODELS: string = path.join(PACKAGES, "Common/Models/DatabaseModels");

// The names renamed models keep for the API, Terraform, the CLI and MCP.
function keptApiNamesOfModels(): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const file of filesUnder(MODELS, ".ts")) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(
      /\bapi(?:Singular|Plural)Name:\s*"([^"]+)"/g,
    )) {
      names.add(match[1] as string);
    }
  }

  return names;
}

/*
 * The files whose enums are values a workspace notification rule stores and
 * matches on: renaming one would stop saved rules from matching, so each is
 * shown through a label of its own instead.
 */
const STORED_VALUES: Record<string, string> = {
  "Common/Types/Workspace/NotificationRules/NotificationRuleCondition.ts":
    "a condition a rule checks, shown by CHECK_ON_LABELS",
  "Common/Types/Workspace/NotificationRules/EventType.ts":
    "the event a rule is for, shown by NotificationRuleCopy",
  "Common/Types/StatusPage/StatusPageEventType.ts":
    "the event types a subscriber picks, kept on StatusPageSubscriber, shown by StatusPageUtil's labels",
};

function sourceLinesOf(file: string): Array<string> {
  return fs.readFileSync(path.join(PACKAGES_ROOT, file), "utf8").split("\n");
}

// The line of a file (from packages/) that holds a piece of text.
function sourceLineOf(file: string, piece: string): number {
  return (
    sourceLinesOf(file).findIndex((line: string): boolean => {
      return line.includes(piece);
    }) + 1
  );
}

// An enum member: `Name = "value",`.
const ENUM_MEMBER: RegExp = /^\s*\w+\s*=\s*"[^"]*",?\s*$/;

function isStoredValue(text: FoundText): boolean {
  if (!STORED_VALUES[text.file]) {
    return false;
  }

  const line: string = sourceLinesOf(text.file)[text.line - 1] || "";

  return ENUM_MEMBER.test(line);
}

const SEARCH_KEYWORD_FILES: ReadonlyArray<string> = [
  "App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex.ts",
  "App/FeatureSet/Dashboard/src/Utils/NavigationItems.tsx",
];

// A line holding only a string, a comment's line, and a keywords list's start.
const STRING_LINE: RegExp = /^\s*"[^"]*",?\s*$/;
const COMMENT_LINE: RegExp = /^\s*(\/\/|\/?\*)/;
const KEYWORDS_START: RegExp = /\bkeywords:\s*\[\s*$/;

// A string in a `keywords: [...]` list of the Search index or the menu.
function isSearchKeyword(text: FoundText): boolean {
  if (!SEARCH_KEYWORD_FILES.includes(text.file)) {
    return false;
  }

  const lines: Array<string> = sourceLinesOf(text.file);

  if (!STRING_LINE.test(lines[text.line - 1] || "")) {
    return false;
  }

  for (let index: number = text.line - 2; index >= 0; index--) {
    const line: string = lines[index] as string;

    // Another keyword, or a comment between them.
    if (STRING_LINE.test(line) || COMMENT_LINE.test(line)) {
      continue;
    }

    return KEYWORDS_START.test(line);
  }

  return false;
}

describe("the retired names are told apart from the ordinary words they look like", () => {
  test.each([
    ["Open On-Call Duty > Readiness for the full list.", "On-Call Duty"],
    ["Select which on-call duty schedules will be notified.", "On-Call Duty"],
    ["Here is a list of on-call-duty policies.", "On-Call Duty"],
    ["On Call Duty Policy Name", "On-Call Duty"],
    ["User On Call Time", "On Call"],
    ["On Call Executions", "On Call"],
    // A heading of its own, as an email rollup's category was.
    ["On Call", "On Call"],
    ["Edit On-Call Policy Schedule", "On-Call Policy Schedule"],
    [
      "See [Personal On-Call Rules](/docs/notifications/on-call-rules)",
      "Personal On-Call Rules",
    ],
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
      ...SCAN.strings.flatMap(
        (string: {
          text: string;
          file: string;
          line: number;
        }): Array<Sighting> => {
          return sightings(`${string.file}:${string.line}`, string.text);
        },
      ),
      ...SCAN.hardcoded.flatMap(
        (string: {
          text: string;
          file: string;
          line: number;
        }): Array<Sighting> => {
          return sightings(`${string.file}:${string.line}`, string.text);
        },
      ),
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

  /*
   * The locale files keep a key until it is deleted from en.json
   * (i18n:extract then drops it from every other locale). A text rewritten
   * away from a retired name leaves its old key, and the old key's 17
   * translations, behind: they are deleted with it, so a stale translation
   * of a retired name never comes back.
   */
  test("no key of the Dashboard's English locale uses one: an old text's key goes with it", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, "en.json"), "utf8"),
    ) as Record<string, unknown>;
    const found: Array<Sighting> = Object.keys(english)
      .filter((key: string): boolean => {
        return typeof english[key] === "string";
      })
      .flatMap((key: string): Array<Sighting> => {
        return sightings("en.json key", key);
      });

    expect(found).toEqual([]);
  });

  test("no permission's title or description in the custom role picker uses one", () => {
    const found: Array<Sighting> =
      PermissionHelper.getAllPermissionProps().flatMap(
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

  test.each(OTHER_FRONT_END_LOCALES)("no word of %s does", (locale: string) => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(PACKAGES, locale), "utf8"),
    ) as Record<string, unknown>;
    const found: Array<Sighting> = allValues(english).flatMap(
      ([key, value]: [string, string]): Array<Sighting> => {
        return sightings(`${locale} ${key}`, value);
      },
    );

    expect(found).toEqual([]);
  });

  test("reads every front end's English locale, so a new one is read too", () => {
    const featureSets: string = path.join(PACKAGES, "App/FeatureSet");
    const locales: Array<string> = fs
      .readdirSync(featureSets)
      .flatMap((name: string): Array<string> => {
        return [`${name}/Locales/en.json`, `${name}/src/Locales/en.json`];
      })
      .filter((locale: string): boolean => {
        return fs.existsSync(path.join(featureSets, locale));
      })
      .map((locale: string): string => {
        return `App/FeatureSet/${locale}`;
      })
      .filter((locale: string): boolean => {
        return locale !== "App/FeatureSet/Dashboard/src/Locales/en.json";
      })
      .sort();

    expect(locales).toEqual([...OTHER_FRONT_END_LOCALES].sort());

    // The status page's own words are read: its nav, overview and lists.
    const statusPage: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.join(PACKAGES, "App/FeatureSet/StatusPage/src/Locales/en.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(allValues(statusPage)).toContainEqual([
      "nav.scheduledEvents",
      "Scheduled Maintenance",
    ]);
  });

  /*
   * Every string literal of the server, the emails and the front ends, as
   * the menu path guards read them. Three kinds keep an old name, each
   * recognised from its own source rather than listed: a renamed model's
   * kept API name (its apiSingularName or apiPluralName), a value a
   * workspace rule stores and matches on (an enum member of a file in
   * STORED_VALUES, shown through a label of its own), and a Search keyword
   * (in a keywords list of the Search index or the products menu).
   */
  test("no string the server, the emails or a front end write does, but a kept API name, a stored value or a Search keyword", () => {
    const keptApiNames: Set<string> = keptApiNamesOfModels();
    const found: Array<Sighting> = productTexts((source: string): boolean => {
      return RETIRED_NAMES.some((retired: RetiredName): boolean => {
        return retired.pattern.test(source);
      });
    })
      .filter((text: FoundText): boolean => {
        return (
          !keptApiNames.has(text.text) &&
          !isStoredValue(text) &&
          !isSearchKeyword(text)
        );
      })
      .flatMap((text: FoundText): Array<Sighting> => {
        return sightings(`${text.file}:${text.line}`, text.text);
      });

    expect(found).toEqual([]);
  });

  test("the scan's exceptions are what they say", () => {
    const keptApiNames: Set<string> = keptApiNamesOfModels();

    // Kept by the models #6817 renamed, so Terraform and the CLI keep them.
    expect(keptApiNames).toContain("On-Call Duty Policies");
    expect(keptApiNames).toContain("On-Call Policy Schedule");
    expect(keptApiNames).not.toContain("On-Call Policies");

    expect(
      isStoredValue({
        file: "Common/Types/Workspace/NotificationRules/NotificationRuleCondition.ts",
        line: sourceLineOf(
          "Common/Types/Workspace/NotificationRules/NotificationRuleCondition.ts",
          '"On Call Duty Policy Name"',
        ),
        text: "On Call Duty Policy Name",
      }),
    ).toBe(true);
    // The Slack app's shortcut, as every installed app shows it.
    expect(KEPT_EXTERNAL_NAMES).toContain("Create Scheduled Event");
    expect(
      sightings("docs", "The **Create Scheduled Event** shortcut opens it."),
    ).toEqual([]);
    expect(
      sightings("docs", "Open the Scheduled Event.").map(
        (sighting: Sighting): string => {
          return sighting.retired;
        },
      ),
    ).toEqual(["Scheduled Event"]);
    // A subscriber's stored event type, which the pages label Maintenance Event.
    expect(
      isStoredValue({
        file: "Common/Types/StatusPage/StatusPageEventType.ts",
        line: sourceLineOf(
          "Common/Types/StatusPage/StatusPageEventType.ts",
          '"Scheduled Event"',
        ),
        text: "Scheduled Event",
      }),
    ).toBe(true);
    expect(
      isSearchKeyword({
        file: "App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex.ts",
        line: sourceLineOf(
          "App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex.ts",
          '"personal on-call rules"',
        ),
        text: "personal on-call rules",
      }),
    ).toBe(true);
    // A page's title in the same file is drawn, so it is no keyword.
    expect(
      isSearchKeyword({
        file: "App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex.ts",
        line: sourceLineOf(
          "App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex.ts",
          'title: "How to Reach Me"',
        ),
        text: "How to Reach Me",
      }),
    ).toBe(false);
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

  test("the docs' prose reader skips only code and the glossary's other names, and reads a diagram's labels", () => {
    expect(
      proseLinesOf(
        [
          "Open On-Call Duty.",
          "```",
          "On-Call Duty",
          "```",
          "Run `On-Call Duty` here.",
          "Also called: **On-Call Duty**.",
          "```mermaid",
          '    people --> rules["Their personal<br/>on-call rules"]',
          "```",
        ].join("\n"),
      ),
    ).toEqual([
      [1, "Open On-Call Duty."],
      [5, "Run  here."],
      [8, '    people --> rules["Their personal on-call rules"]'],
    ]);
    expect(
      sightings(
        "diagram",
        '    people --> rules["Their personal on-call rules"]',
      ),
    ).toHaveLength(1);
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
