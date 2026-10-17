import {
  ALERT_EPISODE_SETTINGS_COPY,
  ALERT_SINGLE_MEMBERSHIP_DIALOG_COPY,
  EpisodeSingleMembershipCopy,
  EpisodeSingleMembershipDialogCopy,
  INCIDENT_EPISODE_SETTINGS_COPY,
  INCIDENT_SINGLE_MEMBERSHIP_DIALOG_COPY,
  LOCKED_NOTE,
  LOCKED_NOTE_UNNAMED,
} from "../../FeatureSet/Dashboard/src/Components/EpisodeMembers/EpisodeSingleMembershipCopy";
import Project from "Common/Models/DatabaseModels/Project";
import {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  ALERT_SINGLE_MEMBERSHIP_COLUMN,
  INCIDENT_IN_ANOTHER_EPISODE_REASON,
  INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
} from "Common/Types/Episode/EpisodeSingleMembership";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * One episode per incident, or per alert (EpisodeSingleMembership), as the
 * Dashboard wires it. The maintainer: "Some customers dont want [an
 * incident in many episodes], so can we create a setting in alert /
 * incident settings to allow alert to be in only one episode and same for
 * incidents."
 *
 *   - Incidents -> Settings -> Episode Membership and Alerts -> Settings ->
 *     Episode Membership:
 *     a page each, routed, in the Settings section of its menu right before
 *     Numbering, found by the command palette, drawing one switch card with
 *     its kind's words;
 *   - the three add dialogs read the switch when they open;
 *   - every word they say is in every language the Dashboard speaks.
 *
 * The App suite runs in Node with no renderer, so this reads the sources
 * and the locale files; the pages and the dialogs are rendered in
 * Common/Tests/App/Dashboard (EpisodeSingleMembershipSettingsPages,
 * EpisodeSingleMembershipDialogs).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

const PLACEHOLDER: RegExp = /\{\{\s*([^{}]+?)\s*\}\}/g;

// A source with its comments taken out and its whitespace run together.
function read(...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function placeholdersOf(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return (match[1] || "").trim();
    })
    .sort();
}

/*
 * Every key the switch and the dialogs look up, with its English: a plural
 * is its "other" sentence and its "_one" form.
 */
function keysOf(
  settings: EpisodeSingleMembershipCopy,
  dialogs: EpisodeSingleMembershipDialogCopy,
): Array<[string, string]> {
  const keys: Array<[string, string]> = [];

  for (const text of [
    settings.cardTitle,
    settings.cardDescription,
    settings.switchTitle,
    settings.switchOnDescription,
    settings.switchOffDescription,
    settings.note,
    dialogs.listRule,
    dialogs.lockedNoteTooltip,
    dialogs.lockedNoteTooltipUnnamed,
    dialogs.shownOutsideEpisodes,
    dialogs.emptyAllInOtherEpisodes,
  ]) {
    keys.push([text, text]);
  }

  for (const plural of [
    dialogs.pickNoteInAnotherEpisode,
    dialogs.newEpisodeLeftOut,
    dialogs.nothingToAdd,
  ]) {
    keys.push([plural.other, plural.other]);
    keys.push([`${plural.other}_one`, plural.one]);
  }

  return keys;
}

const ALL_KEYS: Array<[string, string]> = [
  ...keysOf(
    INCIDENT_EPISODE_SETTINGS_COPY,
    INCIDENT_SINGLE_MEMBERSHIP_DIALOG_COPY,
  ),
  ...keysOf(ALERT_EPISODE_SETTINGS_COPY, ALERT_SINGLE_MEMBERSHIP_DIALOG_COPY),
  [LOCKED_NOTE, LOCKED_NOTE],
  [LOCKED_NOTE_UNNAMED, LOCKED_NOTE_UNNAMED],
  [INCIDENT_IN_ANOTHER_EPISODE_REASON, INCIDENT_IN_ANOTHER_EPISODE_REASON],
  [ALERT_IN_ANOTHER_EPISODE_REASON, ALERT_IN_ANOTHER_EPISODE_REASON],
  ["Nothing to add", "Nothing to add"],
  // The Project columns' titles, as forms and tables name them.
  ["Limit Incidents to One Episode", "Limit Incidents to One Episode"],
  ["Limit Alerts to One Episode", "Limit Alerts to One Episode"],
];

describe("every word, in every language", () => {
  const english: Record<string, unknown> = readLocale("en");

  test("English holds each key, as itself", () => {
    for (const [key, text] of ALL_KEYS) {
      expect(english[key]).toBe(text);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s words each in its own language, keeping its placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const [key, text] of ALL_KEYS) {
        const value: unknown = translations[key];

        expect(typeof value).toBe("string");
        expect(value).not.toBe(text);
        expect(placeholdersOf(value as string)).toEqual(placeholdersOf(text));
      }
    },
  );
});

describe("the switches", () => {
  test("write the Project columns the server reads", () => {
    expect(INCIDENT_EPISODE_SETTINGS_COPY.column).toBe(
      INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
    );
    expect(ALERT_EPISODE_SETTINGS_COPY.column).toBe(
      ALERT_SINGLE_MEMBERSHIP_COLUMN,
    );

    const project: Project = new Project();

    for (const column of [
      INCIDENT_SINGLE_MEMBERSHIP_COLUMN,
      ALERT_SINGLE_MEMBERSHIP_COLUMN,
    ]) {
      expect(project.getTableColumnMetadata(column)?.defaultValue).toBe(false);
    }
  });

  test("each says what it is in a plain sentence", () => {
    expect(INCIDENT_EPISODE_SETTINGS_COPY.switchTitle).toBe(
      "An incident can be in only one episode",
    );
    expect(ALERT_EPISODE_SETTINGS_COPY.switchTitle).toBe(
      "An alert can be in only one episode",
    );
  });
});

interface SettingsPage {
  name: string;
  file: Array<string>;
  copy: string;
  routes: Array<string>;
  routeKey: string;
  component: string;
  sideMenu: Array<string>;
  before: string;
  after: string;
}

const SETTINGS_PAGES: Array<SettingsPage> = [
  {
    name: "Incidents",
    file: [
      "Pages",
      "Incidents",
      "Settings",
      "IncidentEpisodeMembershipSettings.tsx",
    ],
    copy: "INCIDENT_EPISODE_SETTINGS_COPY",
    routes: ["Routes", "IncidentsRoutes.tsx"],
    routeKey: "INCIDENTS_SETTINGS_EPISODE_MEMBERSHIP",
    component: "IncidentSettingsEpisodeMembership",
    sideMenu: ["Pages", "Incidents", "SideMenu.tsx"],
    before: "INCIDENTS_SETTINGS_NUMBERING",
    after: "INCIDENTS_SETTINGS_LINKED_ALERTS",
  },
  {
    name: "Alerts",
    file: ["Pages", "Alerts", "Settings", "AlertEpisodeMembershipSettings.tsx"],
    copy: "ALERT_EPISODE_SETTINGS_COPY",
    routes: ["Routes", "AlertRoutes.tsx"],
    routeKey: "ALERTS_SETTINGS_EPISODE_MEMBERSHIP",
    component: "AlertSettingsEpisodeMembership",
    sideMenu: ["Pages", "Alerts", "SideMenu.tsx"],
    before: "ALERTS_SETTINGS_NUMBERING",
    after: "ALERTS_SETTINGS_MEASUREMENTS",
  },
];

describe.each(SETTINGS_PAGES)(
  "$name → Settings → Episode Membership",
  (page: SettingsPage) => {
    test("draws the one switch card, with its kind's words", () => {
      expect(read(...page.file)).toContain(
        `<EpisodeSingleMembershipCard copy={${page.copy}} projectId={projectId} />`,
      );
    });

    test("is routed, at its own page key", () => {
      // Braces read without the spaces prettier puts inside a long one.
      const routes: string = read(...page.routes)
        .replace(/\{ /g, "{")
        .replace(/ \}/g, "}");

      expect(routes).toContain(
        `path={${page.name === "Incidents" ? "IncidentsRoutePath" : "AlertsRoutePath"}[PageMap.${page.routeKey}] || ""}`,
      );
      expect(routes).toContain(
        `<${page.component} {...props} pageRoute={RouteMap[PageMap.${page.routeKey}] as Route} />`,
      );
    });

    test("sits in the menu's Settings section, right before Numbering", () => {
      const menu: string = read(...page.sideMenu);
      const settings: number = menu.indexOf('title: "Settings"');
      const episodes: number = menu.indexOf(`PageMap.${page.routeKey}`);

      expect(settings).toBeGreaterThan(-1);
      expect(episodes).toBeGreaterThan(settings);
      expect(episodes).toBeGreaterThan(menu.indexOf(`PageMap.${page.after}`));
      expect(episodes).toBeLessThan(menu.indexOf(`PageMap.${page.before}`));
      expect(menu).toContain(
        `title: "Episode Membership", to: RouteUtil.populateRouteParams( RouteMap[PageMap.${page.routeKey}] as Route, ), }, icon: IconProp.SquareStack3D,`,
      );
    });

    test("the command palette finds it by name, and by what it decides", () => {
      const index: string = read(
        "Components",
        "CommandPalette",
        "PageSearchIndex.ts",
      );
      const start: number = index.indexOf(`page: PageMap.${page.routeKey},`);

      expect(start).toBeGreaterThan(-1);

      const entry: string = index.slice(start, index.indexOf("}", start));

      expect(entry).toContain('title: "Episode Membership"');
      expect(entry).toContain('"only one episode"');
    });
  },
);

describe("the add dialogs", () => {
  test.each([
    ["AddEpisodeMembersModal.tsx"],
    ["AddToExistingEpisodeModal.tsx"],
    ["AddToNewEpisodeModal.tsx"],
  ])("%s reads the switch when it opens", (file: string) => {
    expect(read("Components", "EpisodeMembers", file)).toContain(
      "fetchIsLimitedToOneEpisode({ config: config })",
    );
  });

  test("the lists' bulk actions translate the server's reason for one in another episode", () => {
    const code: string = read(
      "Components",
      "EpisodeMembers",
      "BulkAddToEpisodeActions.tsx",
    );

    expect(code).toContain(`"${INCIDENT_IN_ANOTHER_EPISODE_REASON}"`);
    expect(code).toContain(`"${ALERT_IN_ANOTHER_EPISODE_REASON}"`);
  });

  test("the switch is read through the project's own column, not a list of projects", () => {
    const code: string = read(
      "Components",
      "EpisodeMembers",
      "EpisodeMembersApi.ts",
    );

    expect(code).toContain(
      "ModelAPI.getItem<Project>({ modelType: Project, id: projectId, select: { [column]: true, } as Select<Project>, })",
    );
  });
});
