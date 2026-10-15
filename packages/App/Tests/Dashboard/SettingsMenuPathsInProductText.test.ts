import {
  PROJECT_SETTINGS,
  SettingsMenuSection,
  SettingsMenus,
  USER_SETTINGS,
  WrittenPath,
  drawnSteps,
  drawnTitle,
  namesInOrder,
  readableText,
  settingsMenus,
  writtenPaths,
} from "./SettingsMenuPaths";
import { readDashboardSource } from "../FeatureSet/Docs/DocsDashboardMenus";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NOTIFICATION TEXTS POINT TO REAL MENUS, AND NAME MICROSOFT TEAMS.
 *
 * The Notifications docs audit (#4844) found three texts that sent people
 * where nothing is: the owner emails' footer said "Dashboard > More > User
 * Settings > Notification Settings" (there is no More menu, User Settings is
 * on the bar), the Slack and Microsoft Teams account cards said "User
 * Settings > Slack Integration" (the page is the Slack entry of the folded
 * Workspace section), and the Notification Settings matrix labelled its
 * Microsoft Teams column with the bare "Teams" key, which most languages
 * translate as teams of people.
 *
 * Nothing compiles a sentence, so these hold every such text to the menus it
 * walks (SettingsMenuPaths reads them from the side menus' sources):
 *
 *   - every path OneUptime writes through User Settings - in the server's
 *     messages, the emails, the Dashboard - names a real page, with its
 *     folded section, and nothing but OneUptime's Dashboard before it;
 *   - every path to the Slack or Microsoft Teams page of Project Settings
 *     goes through its Workspace section;
 *   - every translation of such a text names each step as that language's
 *     Dashboard draws it;
 *   - no label beside the Microsoft Teams icon or workspace is the bare
 *     "Teams".
 *
 * Strings are read with the TypeScript scanner, so a comment does not count
 * and a sentence written as a template literal does; a ModelTable's `name`
 * (never drawn) is left out. The email templates are read as text. ee/ is
 * read where it is checked out: the App Test job deletes it, and the
 * Enterprise Edition Test workflow (test.ee.yaml) runs this suite with it.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  ".claude",
];

const CODE_FILE: RegExp = /\.(ts|tsx)$/;
const TEMPLATE_FILE: RegExp = /\.(hbs|ejs)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;

// Where OneUptime's own words are: the server, the emails, every frontend.
const SCANNED_ROOTS: ReadonlyArray<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "Common", "UI"),
  path.join(PACKAGES_ROOT, "Common", "Models"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(REPO_ROOT, "ee", "Server"),
  path.join(REPO_ROOT, "ee", "Dashboard"),
  path.join(REPO_ROOT, "ee", "AdminDashboard"),
];

function filesUnder(root: string): Array<string> {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...filesUnder(full));
      }
      continue;
    }

    const isCode: boolean =
      CODE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts");

    if (isCode || TEMPLATE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(PACKAGES_ROOT, file);
}

// A JSX attribute that is never drawn: a ModelTable's `name`.
function isUndrawnAttribute(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  for (let depth: number = 0; current && depth < 3; depth++) {
    if (ts.isJsxAttribute(current)) {
      return current.name.getText() === "name";
    }

    current = current.parent;
  }

  return false;
}

interface FoundText {
  file: string;
  line: number;
  text: string;
}

// The strings and template literals of a code file, as a reader sees them.
function codeTexts(file: string, source: string): Array<FoundText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const texts: Array<FoundText> = [];

  const add: (node: ts.Node, text: string) => void = (
    node: ts.Node,
    text: string,
  ): void => {
    texts.push({
      file: relative(file),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: text,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)) &&
      !isUndrawnAttribute(node)
    ) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node) && !isUndrawnAttribute(node)) {
      // The sentence as a reader sees it, with a placeholder per value.
      add(
        node,
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return `{value}${span.literal.text}`;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return texts;
}

// Text between two markers removed: a template's comments.
function withoutBetween(text: string, open: string, close: string): string {
  let result: string = "";
  let from: number = 0;

  while (from < text.length) {
    const start: number = text.indexOf(open, from);

    if (start < 0) {
      result += text.slice(from);
      break;
    }

    result += text.slice(from, start);

    const end: number = text.indexOf(close, start + open.length);

    if (end < 0) {
      break;
    }

    from = end + close.length;
  }

  return result;
}

// An email or page template's text, line by line, without its comments.
function templateTexts(file: string, source: string): Array<FoundText> {
  const text: string = withoutBetween(
    withoutBetween(source, "{{!--", "--}}"),
    "<!--",
    "-->",
  );

  return text.split("\n").map((line: string, index: number): FoundText => {
    return { file: relative(file), line: index + 1, text: line };
  });
}

// Every text the scan reads that writes a path through a settings menu.
function textsWithPaths(): Array<FoundText> {
  const texts: Array<FoundText> = [];

  for (const file of SCANNED_ROOTS.flatMap(filesUnder)) {
    const source: string = fs.readFileSync(file, "utf8");

    if (!source.includes(USER_SETTINGS) && !source.includes(PROJECT_SETTINGS)) {
      continue;
    }

    texts.push(
      ...(TEMPLATE_FILE.test(file)
        ? templateTexts(file, source)
        : codeTexts(file, source)),
    );
  }

  return texts;
}

interface FoundPath extends WrittenPath {
  file: string;
  line: number;
}

const MENUS: SettingsMenus = settingsMenus();

const FOUND_TEXTS: Array<FoundText> = textsWithPaths();

const FOUND_PATHS: Array<FoundPath> = FOUND_TEXTS.flatMap(
  (found: FoundText): Array<FoundPath> => {
    return writtenPaths(found.text, MENUS).map(
      (written: WrittenPath): FoundPath => {
        return { ...written, file: found.file, line: found.line };
      },
    );
  },
);

function pathsIn(file: string): Array<FoundPath> {
  return FOUND_PATHS.filter((found: FoundPath): boolean => {
    return found.file === file;
  });
}

function section(
  sections: Array<SettingsMenuSection>,
  title: string,
): SettingsMenuSection {
  const found: SettingsMenuSection | undefined = sections.find(
    (candidate: SettingsMenuSection): boolean => {
      return candidate.title === title;
    },
  );

  expect({ title, found: Boolean(found) }).toEqual({ title, found: true });

  return found as SettingsMenuSection;
}

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const LANGUAGES: ReadonlyArray<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

describe("the menus the paths are held to, read from their sources", () => {
  test("User Settings: where you are notified is open, Calendar and Workspace start folded", () => {
    const sections: Array<SettingsMenuSection> = MENUS.userSettings.sections;

    expect(
      sections.map((menuSection: SettingsMenuSection): string => {
        return menuSection.title;
      }),
    ).toEqual([
      "Get Started",
      "Alerts & Notifications",
      "On-Call Logs",
      "Incoming Call Policy",
      "Calendar",
      "Profile",
      "Workspace",
    ]);

    const notifications: SettingsMenuSection = section(
      sections,
      "Alerts & Notifications",
    );

    expect(notifications.folded).toBe(false);
    expect(notifications.items).toContain("Notification Settings");
    expect(section(sections, "Calendar").folded).toBe(true);

    const workspace: SettingsMenuSection = section(sections, "Workspace");

    expect(workspace.folded).toBe(true);
    // User Settings has no page to connect a workspace; it links your own account.
    expect(workspace.items).toEqual(["Slack", "Microsoft Teams"]);
  });

  test("Project Settings: Slack and Microsoft Teams are in the folded Workspace section", () => {
    const workspace: SettingsMenuSection = section(
      MENUS.projectSettings.sections,
      "Workspace",
    );

    expect(workspace.folded).toBe(true);
    expect(workspace.items).toEqual(
      expect.arrayContaining(["Slack", "Microsoft Teams"]),
    );
    expect(MENUS.chatWorkspaces).toEqual(["Slack", "Microsoft Teams"]);
  });

  test("User Settings is the bar's own entry, not an item of a menu", () => {
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");
    const rightElement: string = navigation.slice(
      navigation.indexOf("const rightElement"),
      navigation.indexOf("return {", navigation.indexOf("const rightElement")),
    );
    const english: { navbar: Record<string, unknown> } = readLocale("en") as {
      navbar: Record<string, unknown>;
    };

    expect(rightElement).toContain('title: t("navbar.userSettings")');
    expect(rightElement).toContain("PageMap.USER_SETTINGS");
    expect(english.navbar["userSettings"]).toBe(USER_SETTINGS);
  });
});

describe("a written path, as a reader follows it", () => {
  function problemsOf(text: string): Array<string> {
    return writtenPaths(text, MENUS).flatMap(
      (written: WrittenPath): Array<string> => {
        return written.problems;
      },
    );
  }

  function stepsOf(text: string): Array<Array<string>> {
    return writtenPaths(text, MENUS).map(
      (written: WrittenPath): Array<string> => {
        return [written.menu, ...written.steps];
      },
    );
  }

  test.each([
    [
      "the owner emails' old footer: a More menu before User Settings",
      "Go to OneUptime Dashboard &gt; More &gt; User Settings &gt; Notification Settings to choose which notification emails you receive.",
      'puts "More" before User Settings',
    ],
    [
      "the account cards' old empty message: a page User Settings has no entry for",
      "Connect your Slack account under User Settings > Slack Integration, then click 'Add Slack Account'.",
      'names no section or page of User Settings: "Slack Integration',
    ],
    [
      "the same for Microsoft Teams",
      "Connect your Microsoft Teams account under User Settings > Microsoft Teams Integration, then click 'Add Microsoft Teams Account'.",
      'names no section or page of User Settings: "Microsoft Teams Integration',
    ],
    [
      "the Slack entry without its folded section",
      "Connect your Slack account under User Settings > Slack, then click 'Add Slack Account'.",
      'names "Slack" without "Workspace", the folded section it is in: write User Settings > Workspace > Slack',
    ],
    [
      "a page of a folded section, without the section",
      "Pick the times under User Settings → Calendar Feed.",
      'names "Calendar Feed" without "Calendar"',
    ],
    [
      "the channel note's old pointer",
      "ask them to connect Slack in OneUptime under **User Settings → Slack**.",
      'names "Slack" without "Workspace"',
    ],
    [
      "the refusal's old Project Settings path",
      "Please ask a project admin to connect Slack in Project Settings > Slack Integration.",
      'names no section or page of Project Settings: "Slack Integration',
    ],
    [
      "the same for Microsoft Teams",
      "Please ask a project admin to connect Microsoft Teams in Project Settings > Microsoft Teams Integration.",
      'names no section or page of Project Settings: "Microsoft Teams Integration',
    ],
    [
      "the huddle's old Project Settings path",
      "Slack is not connected to this project. Connect it in Project Settings > Slack.",
      'names "Slack" without "Workspace"',
    ],
    [
      "a page that is not in User Settings at all",
      "Change it under User Settings > Profile Settings.",
      "names no section or page of User Settings",
    ],
    [
      "a section's page that is not in it",
      "Connect it under User Settings > Workspace > Discord.",
      "names no page of its Workspace section",
    ],
  ])("flags %s", (_case: string, text: string, problem: string): void => {
    const problems: Array<string> = problemsOf(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  test.each([
    [
      "Go to OneUptime Dashboard &gt; User Settings &gt; Notification Settings to choose which notification emails you receive.",
      [["User Settings", "Notification Settings"]],
    ],
    [
      "Connect your Slack account under User Settings > Workspace > Slack, then click 'Add Slack Account'.",
      [["User Settings", "Workspace", "Slack"]],
    ],
    [
      "Pick the times on **User Settings → Calendar → Calendar Feed**.",
      [["User Settings", "Calendar", "Calendar Feed"]],
    ],
    [
      "Every page you get is listed under User Settings → On-Call Logs.",
      [["User Settings", "On-Call Logs"]],
    ],
    [
      "Ask them to add a rule in User Settings &gt; On-Call Rules, or remove them.",
      [["User Settings", "On-Call Rules"]],
    ],
    [
      "Open OneUptime → User Settings → Notification Methods → Telegram to grab your link.",
      [["User Settings", "Notification Methods"]],
    ],
    [
      "In {value}, go to **User Settings → Workspace → {value}** and press Connect.",
      [["User Settings", "Workspace", "{value}"]],
    ],
    [
      "Open User Settings &gt; Alerts &amp; Notifications &gt; Notification Settings.",
      [["User Settings", "Alerts & Notifications", "Notification Settings"]],
    ],
    [
      "A project admin connects it under Project Settings → Workspace → Microsoft Teams. Then connect your own account here.",
      [["Project Settings", "Workspace", "Microsoft Teams"]],
    ],
  ])("follows %s", (text: string, steps: Array<Array<string>>): void => {
    expect(problemsOf(text)).toEqual([]);
    expect(stepsOf(text)).toEqual(steps);
  });

  test("a mention that is not a path is not one, and other Project Settings pages are not held here", () => {
    expect(
      writtenPaths(
        "Your User Settings are per project. Set SMTP in Project Settings > Notifications > Notification Settings.",
        MENUS,
      ),
    ).toEqual([]);
  });
});

describe("every path OneUptime writes is one a reader can follow", () => {
  test("the scan reads the server's messages, the emails and the Dashboard", () => {
    expect(FOUND_PATHS.length).toBeGreaterThan(30);

    const files: Set<string> = new Set(
      FOUND_PATHS.map((found: FoundPath): string => {
        return found.file;
      }),
    );

    for (const expected of [
      "App/FeatureSet/Notification/Templates/Partials/UnsubscribeOwnerEmail.hbs",
      "App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack.tsx",
      "App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams.tsx",
      "App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram.tsx",
      "Common/Server/Services/UserOnCallLogService.ts",
      "Common/Server/Services/UserSlackService.ts",
    ]) {
      expect({ file: expected, read: files.has(expected) }).toEqual({
        file: expected,
        read: true,
      });
    }
  });

  test.each([
    [
      "App/FeatureSet/Notification/Templates/Partials/UnsubscribeOwnerEmail.hbs",
      [[USER_SETTINGS, "Notification Settings"]],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack.tsx",
      [[USER_SETTINGS, "Workspace", "Slack"]],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams.tsx",
      [[USER_SETTINGS, "Workspace", "Microsoft Teams"]],
    ],
    [
      "Common/Server/Services/UserSlackService.ts",
      [
        [PROJECT_SETTINGS, "Workspace", "Slack"],
        [USER_SETTINGS, "Workspace", "Slack"],
      ],
    ],
    [
      "Common/Server/Services/UserMicrosoftTeamsService.ts",
      [
        [PROJECT_SETTINGS, "Workspace", "Microsoft Teams"],
        [USER_SETTINGS, "Workspace", "Microsoft Teams"],
      ],
    ],
    [
      "Common/Server/Utils/Workspace/Slack/SlackInlineImages.ts",
      [[PROJECT_SETTINGS, "Workspace", "Slack"]],
    ],
    [
      "Common/Server/Utils/VideoCall/EventVideoCall.ts",
      [[PROJECT_SETTINGS, "Workspace", "Slack"]],
    ],
    [
      "Common/Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice.ts",
      [[USER_SETTINGS, "Workspace", "Slack"]],
    ],
  ])(
    "%s names the real way there",
    (file: string, expected: Array<Array<string>>): void => {
      const found: Array<FoundPath> = pathsIn(file);

      expect(
        found
          .map((written: FoundPath): Array<string> => {
            return [written.menu, ...written.steps];
          })
          .sort(),
      ).toEqual([...expected].sort());

      for (const written of found) {
        expect({
          file,
          path: written.text,
          problems: written.problems,
        }).toEqual({ file, path: written.text, problems: [] });
      }
    },
  );

  test("the on-call user groups name the Workspace section on both menus", () => {
    const steps: Array<string> = pathsIn(
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserGroups/UserGroupsCopy.ts",
    ).map((written: FoundPath): string => {
      return [written.menu, ...written.steps].join(" > ");
    });

    expect(steps).toContain("User Settings > Workspace > Slack");
    expect(steps).toContain("Project Settings > Workspace > Slack");
    expect(steps).toContain("Project Settings > Workspace > Microsoft Teams");
  });

  test("none sends a reader to a page that is not there", () => {
    const problems: Array<string> = FOUND_PATHS.flatMap(
      (found: FoundPath): Array<string> => {
        return found.problems.map((problem: string): string => {
          return `${found.file}:${found.line} "${found.text}" ${problem}`;
        });
      },
    );

    expect(problems).toEqual([]);
  });

  test("no text says More > User Settings: User Settings is on the bar", () => {
    const offenders: Array<string> = FOUND_TEXTS.filter(
      (found: FoundText): boolean => {
        return readableText(found.text).includes("More > User Settings");
      },
    ).map((found: FoundText): string => {
      return `${found.file}:${found.line}`;
    });

    expect(offenders).toEqual([]);
  });
});

describe("every translation names the path as its language's Dashboard draws it", () => {
  const english: Record<string, unknown> = readLocale("en");
  const keysWithPaths: Array<{ key: string; paths: Array<WrittenPath> }> =
    Object.keys(english)
      .filter((key: string): boolean => {
        return typeof english[key] === "string";
      })
      .map((key: string): { key: string; paths: Array<WrittenPath> } => {
        return { key, paths: writtenPaths(key, MENUS) };
      })
      .filter((entry: { key: string; paths: Array<WrittenPath> }): boolean => {
        return entry.paths.length > 0;
      });

  test("the Dashboard's texts with such a path include the ones this change wrote", () => {
    const keys: Array<string> = keysWithPaths.map(
      (entry: { key: string }): string => {
        return entry.key;
      },
    );

    expect(keys).toEqual(
      expect.arrayContaining([
        "No Slack account added. Connect your Slack account under User Settings > Workspace > Slack, then click 'Add Slack Account'.",
        "No Microsoft Teams account added. Connect your Microsoft Teams account under User Settings > Workspace > Microsoft Teams, then click 'Add Microsoft Teams Account'.",
        "{{name}} is on call but isn't in the group: OneUptime can't find them in Slack. They can connect their Slack account in User Settings > Workspace > Slack, or use the same email address in both.",
        "You'll now receive OneUptime notifications in Telegram. You can manage event-level toggles under User Settings → Notification Settings.",
        "A project admin connects it under Project Settings → Workspace → Slack. Then you can connect your own Slack account here.",
        "A project admin connects it under Project Settings → Workspace → Microsoft Teams. Then you can connect your own Microsoft Teams account here.",
      ]),
    );

    for (const entry of keysWithPaths) {
      for (const written of entry.paths) {
        expect({ key: entry.key, problems: written.problems }).toEqual({
          key: entry.key,
          problems: [],
        });
      }
    }
  });

  test("the bar's word for User Settings, and the products menu's for Project Settings, are the labels the texts are checked against", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(language);
      const navbar: Record<string, unknown> = locale["navbar"] as Record<
        string,
        unknown
      >;
      const items: Record<string, unknown> = navbar["items"] as Record<
        string,
        unknown
      >;

      expect({ language, bar: navbar["userSettings"] }).toEqual({
        language,
        bar: drawnTitle(locale, USER_SETTINGS),
      });
      expect({ language, products: items["projectSettingsTitle"] }).toEqual({
        language,
        products: drawnTitle(locale, PROJECT_SETTINGS),
      });
    }
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: each step, in order, as its Dashboard draws it",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const misnamed: Array<string> = [];

      for (const entry of keysWithPaths) {
        const value: unknown = locale[entry.key];

        // Not translated yet: the reader sees the English, which is right.
        if (typeof value !== "string" || value === entry.key) {
          continue;
        }

        for (const written of entry.paths) {
          const steps: Array<string> = drawnSteps(locale, written);

          if (!namesInOrder(readableText(value), steps)) {
            misnamed.push(
              `${entry.key} -> ${value} (expected ${steps.join(" > ")})`,
            );
          }
        }
      }

      expect(misnamed).toEqual([]);
    },
  );
});

/*
 * The labels a Dashboard object or element gives something it marks with
 * the Microsoft Teams icon or workspace type: `{ label: "...", icon:
 * IconProp.MicrosoftTeams }`, `link: { title: "..." }` beside it, or the
 * same as JSX attributes.
 */
const LABEL_PROPERTIES: ReadonlyArray<string> = [
  "label",
  "title",
  "name",
  "text",
  "groupTitle",
];
const MARKS_MICROSOFT_TEAMS: RegExp = /\.MicrosoftTeams\b/;

function labelOf(expression: ts.Node | undefined): string | null {
  if (!expression) {
    return null;
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isJsxExpression(expression)) {
    return labelOf(expression.expression);
  }

  // translationKey("Teams"), translatableTerm("Teams")
  if (ts.isCallExpression(expression) && expression.arguments.length > 0) {
    return labelOf(expression.arguments[0]);
  }

  return null;
}

interface Labelled {
  name: string;
  value: ts.Node | undefined;
}

function labelsOf(entries: Array<Labelled>): Array<string> {
  const labels: Array<string> = [];

  for (const entry of entries) {
    if (LABEL_PROPERTIES.includes(entry.name)) {
      const label: string | null = labelOf(entry.value);

      if (label !== null) {
        labels.push(label);
      }
    }

    // One level in: `link: { title: ... }`.
    const inner: ts.Node | undefined =
      entry.value && ts.isJsxExpression(entry.value)
        ? entry.value.expression
        : entry.value;

    if (inner && ts.isObjectLiteralExpression(inner)) {
      for (const property of inner.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          LABEL_PROPERTIES.includes(property.name.getText())
        ) {
          const label: string | null = labelOf(property.initializer);

          if (label !== null) {
            labels.push(label);
          }
        }
      }
    }
  }

  return labels;
}

function labelsBesideMicrosoftTeams(
  file: string,
): Array<{ file: string; line: number; label: string }> {
  const source: string = fs.readFileSync(file, "utf8");

  if (!source.includes(".MicrosoftTeams")) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<{ file: string; line: number; label: string }> = [];

  const add: (node: ts.Node, entries: Array<Labelled>) => void = (
    node: ts.Node,
    entries: Array<Labelled>,
  ): void => {
    const marked: boolean = entries.some((entry: Labelled): boolean => {
      return Boolean(
        entry.value && MARKS_MICROSOFT_TEAMS.test(entry.value.getText()),
      );
    });

    if (!marked) {
      return;
    }

    for (const label of labelsOf(entries)) {
      found.push({
        file: relative(file),
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        label,
      });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      add(
        node,
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((property: ts.PropertyAssignment): Labelled => {
            return {
              name: property.name.getText(),
              value: property.initializer,
            };
          }),
      );
    } else if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      add(
        node,
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute: ts.JsxAttribute): Labelled => {
            return {
              name: attribute.name.getText(),
              value: attribute.initializer,
            };
          }),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

describe("Microsoft Teams is named as the product, never as the bare Teams", () => {
  test("the Notification Settings matrix labels each workspace's column with the workspace's own name", () => {
    const file: string = path.join(
      PACKAGES_ROOT,
      "App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings.tsx",
    );
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const columns: Array<{ workspaceType: string; label: string }> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "CHANNELS" &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (!ts.isObjectLiteralExpression(element)) {
            continue;
          }

          const properties: Map<string, ts.Expression> = new Map();

          for (const property of element.properties) {
            if (ts.isPropertyAssignment(property)) {
              properties.set(property.name.getText(), property.initializer);
            }
          }

          const workspaceType: ts.Expression | undefined =
            properties.get("workspaceType");

          if (workspaceType) {
            columns.push({
              workspaceType: workspaceType.getText().split(".").pop() || "",
              label: labelOf(properties.get("label")) || "",
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    expect(columns).toEqual([
      {
        workspaceType: "Slack",
        label: getWorkspaceTypeDisplayName(WorkspaceType.Slack),
      },
      {
        workspaceType: "MicrosoftTeams",
        label: getWorkspaceTypeDisplayName(WorkspaceType.MicrosoftTeams),
      },
    ]);
    expect(getWorkspaceTypeDisplayName(WorkspaceType.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
  });

  test("no label beside the Microsoft Teams icon or workspace is the bare Teams", () => {
    const labels: Array<{ file: string; line: number; label: string }> = [
      path.join(PACKAGES_ROOT, "App/FeatureSet/Dashboard/src"),
      path.join(PACKAGES_ROOT, "App/FeatureSet/AdminDashboard/src"),
      path.join(PACKAGES_ROOT, "App/FeatureSet/StatusPage/src"),
      path.join(PACKAGES_ROOT, "Common/UI"),
      path.join(REPO_ROOT, "ee", "Dashboard"),
    ]
      .flatMap(filesUnder)
      .filter((file: string): boolean => {
        return CODE_FILE.test(file);
      })
      .flatMap(labelsBesideMicrosoftTeams);

    // The scan sees the labels it is meant to: the matrix, the menus, search.
    expect(labels.length).toBeGreaterThan(5);
    expect(
      labels.filter((entry: { label: string }): boolean => {
        return entry.label === "Microsoft Teams";
      }).length,
    ).toBeGreaterThan(3);

    expect(
      labels
        .filter((entry: { label: string }): boolean => {
          return entry.label.trim() === "Teams";
        })
        .map((entry: { file: string; line: number }): string => {
          return `${entry.file}:${entry.line}`;
        }),
    ).toEqual([]);
  });

  test("every language keeps the product's name, while its word for Teams can mean teams of people", () => {
    const sameAsEnglish: Array<string> = JSON.parse(
      fs.readFileSync(
        path.join(
          PACKAGES_ROOT,
          "App/FeatureSet/Dashboard/i18n/SameAsEnglish.json",
        ),
        "utf8",
      ),
    ) as Array<string>;

    expect(sameAsEnglish).toContain("Microsoft Teams");

    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(language);

      expect({
        language,
        label: drawnTitle(locale, "Microsoft Teams"),
      }).toEqual({ language, label: "Microsoft Teams" });
    }

    // What the maintainer saw: in Persian and Korean "Teams" is teams of people.
    for (const language of ["fa", "ko"]) {
      expect(drawnTitle(readLocale(language), "Teams")).not.toContain("Teams");
    }
  });
});
