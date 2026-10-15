import {
  ON_CALL_DUTY,
  SettingsMenu,
  SettingsMenuSection,
  WrittenPath,
  drawnSteps,
  drawnTitle,
  namesInOrder,
  onCallDutyMenu,
  pathsStartingAt,
  pathsThrough,
  readableText,
} from "./SettingsMenuPaths";
import { FoundText, PACKAGES_ROOT, productTexts } from "./ProductTextScan";
import {
  menuSections,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
} from "../FeatureSet/Docs/DocsDashboardMenus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ON-CALL TEXTS NAME THE REAL MENU PATH.
 *
 * The On Call docs audit (#4853) found product text that sent people where
 * the menu does not: the User Overrides cards and the Skip dialog said "add
 * (or delete) it under On-Call Duty > User Overrides", but User Overrides is
 * in On-Call Duty's Advanced section, which starts folded, so the page is not
 * on screen until Advanced is opened. A policy's own User Overrides page is in
 * the policy menu's folded Advanced section too. And a policy's readiness
 * note and the notification deletion preview said "On-Call > Readiness",
 * naming a menu the bar does not have: the product is On-Call Duty.
 *
 * Nothing compiles a sentence, so these hold every such text to the menu it
 * walks (SettingsMenuPaths reads On-Call Duty's side menu from its source):
 *
 *   - every path OneUptime writes from On-Call Duty - in the server's
 *     messages, the Slack and Microsoft Teams messages, the emails, the
 *     Dashboard - names a real section or page of its side menu, and a page
 *     in a folded section with its section;
 *   - no text starts a path at "On-Call", which is not on the bar;
 *   - every translation of such a text names each step as that language's
 *     Dashboard draws it;
 *   - the global card names a policy's User Overrides page with the Advanced
 *     section it is in, in every language.
 *
 * The docs pages are held the same way by OnCallDutyMenuPathsDocs. Texts
 * are read as the menu paths guard for the settings menus reads them
 * (ProductTextScan); ee/ is read where it is checked out, and the Enterprise
 * Edition Test workflow (test.ee.yaml) runs this suite with it.
 */

const LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

// The word a path must not start at: the bar's entry is On-Call Duty.
const NOT_A_MENU: string = "On-Call";

const MENU: SettingsMenu = onCallDutyMenu();

// Every text of a file that names On-Call Duty, or On-Call, at all.
const FOUND_TEXTS: Array<FoundText> = productTexts(
  (source: string): boolean => {
    return source.includes(NOT_A_MENU);
  },
);

interface FoundPath extends WrittenPath {
  file: string;
  line: number;
}

const FOUND_PATHS: Array<FoundPath> = FOUND_TEXTS.flatMap(
  (found: FoundText): Array<FoundPath> => {
    return pathsThrough(found.text, MENU).map(
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

function stepsOf(written: WrittenPath): string {
  return [written.menu, ...written.steps].join(" > ");
}

function section(title: string): SettingsMenuSection {
  const found: SettingsMenuSection | undefined = MENU.sections.find(
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

// The texts this task rewrote, as the Dashboard's English locale keys them.
const POLICY_CARD: string =
  "While someone is away, their pages from this policy go to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation. To cover someone on every policy at once, add the override under On-Call Duty > Advanced > User Overrides.";
const SKIP_DIALOG: string =
  "This applies to every on-call policy. When it ends, they are back in their usual place in the rotation. To end it early, delete it under On-Call Duty > Advanced > User Overrides.";
const GLOBAL_CARD: string =
  "While someone is away, their pages from every on-call policy go to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation. To cover someone on one policy only, add the override on that policy's User Overrides page, under Advanced.";
const READINESS_NOTE: string =
  "The readiness answer for this policy does not cover {{names}}, so they are unknown rather than ready. Open On-Call Duty > Readiness for the full list.";

describe("the menu the paths are held to, read from its source", () => {
  test("On-Call Duty: the policies, schedules and incoming calls are open; the rest starts folded", () => {
    expect(
      MENU.sections.map((menuSection: SettingsMenuSection): string => {
        return `${menuSection.title}${menuSection.folded ? " (folded)" : ""}`;
      }),
    ).toEqual([
      "Policies",
      "Schedules",
      "Incoming Calls",
      "Advanced (folded)",
      "Reports (folded)",
      "Workspace (folded)",
      "Settings (folded)",
      "Developer (folded)",
    ]);
    expect(section("Policies").items).toEqual([
      "On-Call Policies",
      "Readiness",
    ]);
    expect(section("Schedules").items).toEqual([
      "On-Call Schedules",
      "Schedule Timeline",
      "Calendar Feeds",
    ]);
  });

  test("User Overrides, Execution Logs and Archived Policies are in the folded Advanced section", () => {
    const advanced: SettingsMenuSection = section("Advanced");

    expect(advanced.folded).toBe(true);
    expect(advanced.items).toEqual([
      "User Overrides",
      "Execution Logs",
      "Archived Policies",
    ]);
  });

  test("the On-Call Duty menu is the bar's entry the paths start from", () => {
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");
    const english: { navbar: { items: Record<string, unknown> } } = readLocale(
      "en",
    ) as { navbar: { items: Record<string, unknown> } };

    expect(navigation).toContain('title: t("navbar.items.onCallDutyTitle")');
    expect(navigation).toContain("RouteMap[PageMap.ON_CALL_DUTY]");
    expect(english.navbar.items["onCallDutyTitle"]).toBe(ON_CALL_DUTY);
  });
});

describe("a written On-Call Duty path, as a reader follows it", () => {
  function problemsOf(text: string): Array<string> {
    return pathsThrough(text, MENU).flatMap(
      (written: WrittenPath): Array<string> => {
        return written.problems;
      },
    );
  }

  test.each([
    [
      "the policy card's old pointer",
      "To cover someone on every policy at once, add the override under On-Call Duty > User Overrides.",
      'names "User Overrides" without "Advanced", the folded section it is in: write On-Call Duty > Advanced > User Overrides',
    ],
    [
      "the Skip dialog's old pointer",
      "To end it early, delete it under On-Call Duty > User Overrides.",
      'names "User Overrides" without "Advanced"',
    ],
    [
      "the execution logs without their section",
      "Every run is listed under On-Call Duty → Execution Logs.",
      'names "Execution Logs" without "Advanced"',
    ],
    [
      "the archived policies without their section, as a docs page writes it",
      "Unarchive it under **On-Call Duty** > **Archived Policies**.",
      'names "Archived Policies" without "Advanced"',
    ],
    [
      "the on-call time report without Reports",
      "See On-Call Duty > User On Call Time for the hours.",
      'names "User On Call Time" without "Reports"',
    ],
    [
      "a settings page without Settings",
      "Add the field under On-Call Duty > Custom Fields.",
      'names "Custom Fields" without "Settings"',
    ],
    [
      "a chat workspace without Workspace",
      "Connect it under On-Call Duty > Slack.",
      'names "Slack" without "Workspace"',
    ],
    [
      "a page the menu has no entry for",
      "Add the override under On-Call Duty > Overrides.",
      'names no section or page of On-Call Duty: "Overrides.',
    ],
    [
      "a page in another section",
      "Open On-Call Duty > Advanced > Readiness.",
      "names no page of its Advanced section",
    ],
  ])("flags %s", (_case: string, text: string, problem: string): void => {
    const problems: Array<string> = problemsOf(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  test.each([
    [
      "add the override under On-Call Duty > Advanced > User Overrides.",
      ["On-Call Duty > Advanced > User Overrides"],
    ],
    [
      "Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.",
      ["On-Call Duty > Policies"],
    ],
    [
      "Add one in OneUptime under On-Call Duty → Schedules.",
      ["On-Call Duty > Schedules"],
    ],
    [
      "Open On-Call Duty > Readiness for the full list.",
      ["On-Call Duty > Readiness"],
    ],
    [
      "use **On-Call Duty** > **Reports** > **User On Call Time**.",
      ["On-Call Duty > Reports > User On Call Time"],
    ],
    [
      "for **On-Call Duty → Advanced → Archived Policies**, where **Unarchive** puts it back",
      ["On-Call Duty > Advanced > Archived Policies"],
    ],
    [
      "Open each schedule under **On-Call Duty** > **On-Call Schedules** and check who is on call now.",
      ["On-Call Duty > On-Call Schedules"],
    ],
  ])("follows %s", (text: string, steps: Array<string>): void => {
    expect(problemsOf(text)).toEqual([]);
    expect(pathsThrough(text, MENU).map(stepsOf)).toEqual(steps);
  });

  test("a mention that is not a path is not one", () => {
    expect(
      pathsThrough(
        "Products → Essentials → **On-Call Duty** (`/dashboard/{id}/on-call-duty`). On-Call Duty policies page people.",
        MENU,
      ),
    ).toEqual([]);
  });

  test("a path started at On-Call, which is not on the bar, is flagged; one at On-Call Duty, or inside a longer path, is not", () => {
    expect(
      pathsStartingAt(
        "Open On-Call > Readiness for the full list.",
        NOT_A_MENU,
      ),
    ).toEqual(["On-Call > Readiness for the full list."]);
    expect(
      pathsStartingAt(
        "check On-Call → Readiness to confirm this user can be paged",
        NOT_A_MENU,
      ),
    ).toHaveLength(1);
    expect(
      pathsStartingAt("Open On-Call Duty > Readiness.", NOT_A_MENU),
    ).toEqual([]);
    expect(
      pathsStartingAt("Users > Alex Kim > On-Call > Readiness", NOT_A_MENU),
    ).toEqual([]);
    expect(
      pathsStartingAt(
        "Critical On-Call Alerts ring through. Non-On-Call > x",
        NOT_A_MENU,
      ),
    ).toEqual([]);
  });
});

describe("every On-Call Duty path OneUptime writes is one a reader can follow", () => {
  test("the scan reads the Dashboard, the server's messages and the chat messages", () => {
    expect(FOUND_PATHS.length).toBeGreaterThanOrEqual(10);

    const files: Set<string> = new Set(
      FOUND_PATHS.map((found: FoundPath): string => {
        return found.file;
      }),
    );

    for (const expected of [
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTable.tsx",
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx",
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx",
      "Common/Server/Services/UserNotificationRuleService.ts",
      "Common/Server/Utils/Workspace/Slack/Actions/Answer.ts",
      "Common/Server/Utils/Workspace/WorkspaceOnCallNow.ts",
    ]) {
      expect({ file: expected, read: files.has(expected) }).toEqual({
        file: expected,
        read: true,
      });
    }
  });

  test.each([
    [
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTable.tsx",
      ["On-Call Duty > Advanced > User Overrides"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx",
      ["On-Call Duty > Advanced > User Overrides"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleReadiness.tsx",
      ["On-Call Duty > Readiness"],
    ],
    [
      "Common/Server/Services/UserNotificationRuleService.ts",
      ["On-Call Duty > Readiness"],
    ],
    [
      "Common/Server/Utils/Workspace/Slack/Actions/Answer.ts",
      ["On-Call Duty > Policies"],
    ],
    [
      "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
      ["On-Call Duty > Policies"],
    ],
    [
      "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Alert.ts",
      ["On-Call Duty > Policies"],
    ],
    [
      "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode.ts",
      ["On-Call Duty > Policies"],
    ],
    [
      "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode.ts",
      ["On-Call Duty > Policies"],
    ],
    [
      "Common/Server/Utils/Workspace/WorkspaceOnCallNow.ts",
      [
        "On-Call Duty > Schedules",
        "On-Call Duty > Schedules",
        "On-Call Duty > Schedules",
      ],
    ],
  ])(
    "%s names the real way there",
    (file: string, expected: Array<string>): void => {
      const found: Array<FoundPath> = pathsIn(file);

      expect(found.map(stepsOf)).toEqual(expected);

      for (const written of found) {
        expect({
          file,
          path: written.text,
          problems: written.problems,
        }).toEqual({ file, path: written.text, problems: [] });
      }
    },
  );

  test("none sends a reader to a page that is not there, or to one in a folded section without it", () => {
    const problems: Array<string> = FOUND_PATHS.flatMap(
      (found: FoundPath): Array<string> => {
        return found.problems.map((problem: string): string => {
          return `${found.file}:${found.line} "${found.text}" ${problem}`;
        });
      },
    );

    expect(problems).toEqual([]);
  });

  test("none starts a path at On-Call: the bar's entry is On-Call Duty", () => {
    const offenders: Array<string> = FOUND_TEXTS.flatMap(
      (found: FoundText): Array<string> => {
        return pathsStartingAt(found.text, NOT_A_MENU).map(
          (text: string): string => {
            return `${found.file}:${found.line} "${text}"`;
          },
        );
      },
    );

    expect(offenders).toEqual([]);
  });

  test("none still names User Overrides right after On-Call Duty", () => {
    const offenders: Array<string> = FOUND_TEXTS.filter(
      (found: FoundText): boolean => {
        return readableText(found.text).includes(
          `${ON_CALL_DUTY} > User Overrides`,
        );
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
        return { key, paths: pathsThrough(key, MENU) };
      })
      .filter((entry: { key: string; paths: Array<WrittenPath> }): boolean => {
        return entry.paths.length > 0;
      });

  test("the Dashboard's texts with such a path are the ones this change wrote, and each walks the menu", () => {
    expect(
      keysWithPaths
        .map((entry: { key: string }): string => {
          return entry.key;
        })
        .sort(),
    ).toEqual([READINESS_NOTE, SKIP_DIALOG, POLICY_CARD].sort());

    for (const entry of keysWithPaths) {
      for (const written of entry.paths) {
        expect({ key: entry.key, problems: written.problems }).toEqual({
          key: entry.key,
          problems: [],
        });
      }
    }
  });

  test("no Dashboard text starts a path at On-Call", () => {
    expect(
      Object.keys(english).filter((key: string): boolean => {
        return pathsStartingAt(key, NOT_A_MENU).length > 0;
      }),
    ).toEqual([]);
  });

  test("the bar's word for On-Call Duty is the label the texts are checked against", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(language);
      const items: Record<string, unknown> = (
        locale["navbar"] as Record<string, unknown>
      )["items"] as Record<string, unknown>;

      expect({ language, bar: items["onCallDutyTitle"] }).toEqual({
        language,
        bar: drawnTitle(locale, ON_CALL_DUTY),
      });
    }
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: translates each text, naming each step, in order, as its Dashboard draws it",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);
      const misnamed: Array<string> = [];

      for (const entry of keysWithPaths) {
        const value: unknown = locale[entry.key];

        // The Dashboard draws this sentence translated, in every language.
        expect({ language, key: entry.key, translated: true }).toEqual({
          language,
          key: entry.key,
          translated: typeof value === "string" && value !== entry.key,
        });

        for (const written of entry.paths) {
          const steps: Array<string> = drawnSteps(locale, written);

          if (!namesInOrder(readableText(String(value)), steps)) {
            misnamed.push(
              `${entry.key} -> ${String(value)} (expected ${steps.join(" > ")})`,
            );
          }
        }
      }

      expect(misnamed).toEqual([]);
    },
  );

  test("the global card names a policy's User Overrides page with the Advanced section it is in", () => {
    // A policy's own menu, where its User Overrides page is.
    const policyMenu: string = readDashboardSource(
      "Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx",
    );

    expect(sectionByTitle(menuSections(policyMenu), "Advanced").items).toEqual(
      expect.arrayContaining(["User Overrides"]),
    );
    expect(startsCollapsed(policyMenu, "Advanced")).toBe(true);
    expect(english[GLOBAL_CARD]).toBe(GLOBAL_CARD);
    expect(GLOBAL_CARD).toContain("User Overrides page, under Advanced.");

    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = readLocale(language);
      const value: string = String(locale[GLOBAL_CARD]);

      expect({ language, translated: value !== GLOBAL_CARD }).toEqual({
        language,
        translated: true,
      });
      expect({
        language,
        names: [
          drawnTitle(locale, "User Overrides"),
          drawnTitle(locale, "Advanced"),
        ].filter((label: string): boolean => {
          return !value.includes(label);
        }),
      }).toEqual({ language, names: [] });
    }
  });
});
