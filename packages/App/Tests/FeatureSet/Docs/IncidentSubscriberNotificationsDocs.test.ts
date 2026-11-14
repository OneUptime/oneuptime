import { NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN } from "Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import {
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY,
  NOTIFY_REVIEW_CHANGE_TO_YES,
} from "../../../FeatureSet/Dashboard/src/Components/Incident/NewIncidentNotifyDefaultCopy";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  parseDocsLink,
  readPage,
  scanPage,
} from "./DocsContentSupport";
import { dashboardLabel } from "./DocsDashboardLabels";
import { boldLabels, boldPaths, pathWithArrows } from "./DocsPageShape";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * INCIDENTS -> SETTINGS -> SUBSCRIBER NOTIFICATIONS, IN THE DOCS (#7606).
 *
 * A project decides whether Notify Status Page Subscribers starts ticked on
 * Declare New Incident. The incident settings page explains the switch, and
 * the Declare page's Notify bullet points to it. Markdown is not compiled,
 * so nothing else notices when the switch, its page's address or the
 * summary's Change to Yes is renamed. In every docs language:
 *
 *  - the settings page walks to the page by the Dashboard's own names
 *    (Incidents, Settings, Subscriber Notifications) and gives the address
 *    the Dashboard serves it at;
 *  - it names the switch, the box, and the summary's No and Change to Yes
 *    as that language's Dashboard draws them (DocsDashboardLabels), and the
 *    switch's API name;
 *  - the Declare page's Notify bullet names No and Change to Yes the same
 *    way, and links to the settings page's section that has the switch;
 *  - the settings page says an incident declared from Slack or Microsoft
 *    Teams, or by OneUptime AI, follows the switch too, and names none of
 *    them among the ways that keep the incident's own value - as the server
 *    declares them (NewIncidentSubscriberNotificationDefaultReader).
 *
 * (The settings table and the overview list the page as the side menu does:
 * IncidentSettingsMenuDocs. Every link landing: DocsLinksResolve.)
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const ROUTE_MAP_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Utils/RouteMap.ts",
);
const INCIDENTS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu.tsx",
);

/*
 * Where people declare an incident and nothing asks about subscribers: each
 * declares it as the project starts the box, through the one reader.
 */
const DECLARED_WITHOUT_BOX_FILES: ReadonlyArray<string> = [
  "Common/Server/Utils/Workspace/Slack/Actions/Incident.ts",
  "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
  "Common/Server/Utils/AI/Toolbox/IncidentWriteTools.ts",
];
const DECLARED_WITHOUT_BOX_CALL: string =
  "NewIncidentSubscriberNotificationDefaultReader.applyToIncidentDeclaredWithoutBox(";

// The names the settings page gives those three, in every language.
const DECLARED_WITHOUT_BOX_NAMES: ReadonlyArray<string> = [
  "Slack",
  "Microsoft Teams",
  "OneUptime AI",
];

const INCIDENT_COLUMN_SPAN: string =
  "`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`";

/*
 * Where a sentence ends, in every docs language: a Latin or Cyrillic stop
 * before a space, the ideographic full stop of Chinese and Japanese, and the
 * Devanagari danda.
 */
const SENTENCE_END: RegExp = /[.!?]\s|\u3002|\u0964\s?/g;

const LANGUAGES: ReadonlyArray<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";

const PAGE_KEY: string = "PageMap.INCIDENTS_SETTINGS_SUBSCRIBER_NOTIFICATIONS";
const PAGE_ROUTE: string = "settings/subscriber-notifications";
const PAGE_ADDRESS: string = `/dashboard/{projectId}/incidents/${PAGE_ROUTE}`;

const MENU_TITLE: string = "Subscriber Notifications";
const BOX: string = "Notify Status Page Subscribers";
const NO: string = "No";
const SWITCH_TITLE: string =
  NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchTitle;

// The path the settings page walks, in English: the side menu's own words.
const PATH_IN_ENGLISH: ReadonlyArray<string> = [
  "Incidents",
  "Settings",
  MENU_TITLE,
];

const TITLE: RegExp = /title:\s*"([^"]+)"/g;

function bold(text: string): string {
  return `**${text}**`;
}

function linesOf(language: string, page: string): Array<string> {
  return readPage(language, page).split("\n");
}

// The side menu's title for the item that opens the page.
function sideMenuTitle(): string | undefined {
  const menu: string = fs.readFileSync(INCIDENTS_SIDE_MENU_FILE, "utf8");
  const before: string = menu.slice(0, menu.indexOf(PAGE_KEY));

  return [...before.matchAll(TITLE)].pop()?.[1];
}

/*
 * The Declare page's bullet for the box: the list item that starts with the
 * box's name. Its line number counts from 1, as ScannedPage's do.
 */
function notifyBullet(
  language: string,
): { text: string; line: number } | undefined {
  const lines: Array<string> = linesOf(language, DECLARING_PAGE);
  const index: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(`- ${bold(dashboardLabel(language, BOX))}`);
  });

  return index === -1 ? undefined : { text: lines[index]!, line: index + 1 };
}

// The slug of the settings page's section that gives the page's address.
function switchSectionSlug(language: string): string | undefined {
  const addressLine: number =
    linesOf(language, SETTINGS_PAGE).findIndex((line: string): boolean => {
      return line.includes(PAGE_ADDRESS);
    }) + 1;
  const scanned: ScannedPage = scanPage(language, SETTINGS_PAGE);

  return scanned.headings
    .filter((heading: DocsHeading): boolean => {
      return heading.line > 1 && heading.line < addressLine;
    })
    .pop()?.slug;
}

describe("what the docs lean on in the Dashboard", () => {
  it("the page is served at settings/subscriber-notifications under incidents", () => {
    expect(fs.readFileSync(ROUTE_MAP_FILE, "utf8")).toMatch(
      /\[PageMap\.INCIDENTS_SETTINGS_SUBSCRIBER_NOTIFICATIONS\]:\s*"settings\/subscriber-notifications"/,
    );
  });

  it("the side menu and the page's card both call it Subscriber Notifications", () => {
    expect(sideMenuTitle()).toBe(MENU_TITLE);
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardTitle).toBe(MENU_TITLE);
  });

  it("Slack's and Microsoft Teams' Declare Incident forms and OneUptime AI's create_incident declare as the project starts the box", () => {
    for (const file of DECLARED_WITHOUT_BOX_FILES) {
      expect([
        file,
        fs
          .readFileSync(path.join(REPO_ROOT, file), "utf8")
          .includes(DECLARED_WITHOUT_BOX_CALL),
      ]).toEqual([file, true]);
    }
  });

  it("the switch's API name is the Project column the switch writes", () => {
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.column).toBe(
      NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN,
    );
    expect(NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN).toBe(
      "notifyStatusPageSubscribersOfNewIncidentsByDefault",
    );
  });

  /*
   * "No" is left out: Spanish and Italian write it as English does, and so
   * may another language.
   */
  it("the checks below read each translated page in its own words, not the English", () => {
    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      for (const english of [
        MENU_TITLE,
        SWITCH_TITLE,
        BOX,
        NOTIFY_REVIEW_CHANGE_TO_YES,
      ]) {
        expect([
          language,
          english,
          dashboardLabel(language, english),
        ]).not.toEqual([language, english, english]);
      }
    }
  });
});

describe.each(LANGUAGES)("the %s docs", (language: string) => {
  it("the settings page walks to Subscriber Notifications by the Dashboard's own names, and gives its address", () => {
    const steps: Array<string> = PATH_IN_ENGLISH.map(
      (english: string): string => {
        return dashboardLabel(language, english);
      },
    );
    const settings: string = readPage(language, SETTINGS_PAGE);

    expect(boldPaths(settings)).toContainEqual(steps);
    // Written with the arrows a page in this language draws between them.
    expect(settings).toContain(bold(pathWithArrows(steps, language)));
    expect(settings).toContain(`\`${PAGE_ADDRESS}\``);
  });

  it("the settings page names the switch, the box, and the summary's No and Change to Yes as the Dashboard draws them", () => {
    const labels: Array<string> = boldLabels(readPage(language, SETTINGS_PAGE));

    for (const english of [
      SWITCH_TITLE,
      BOX,
      NO,
      NOTIFY_REVIEW_CHANGE_TO_YES,
    ]) {
      expect([
        english,
        labels.includes(dashboardLabel(language, english)),
      ]).toEqual([english, true]);
    }
  });

  it("the settings page gives the switch's API name, and the incident's own that the other ways of creating one keep", () => {
    const settings: string = readPage(language, SETTINGS_PAGE);

    expect(settings).toContain(`\`${NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN}\``);
    expect(settings).toContain(
      "`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`",
    );
  });

  it("the settings page says incidents declared from Slack, Microsoft Teams or OneUptime AI follow the switch, and leaves them out of the ways that keep their own", () => {
    const paragraph: string | undefined = linesOf(language, SETTINGS_PAGE).find(
      (line: string): boolean => {
        return (
          line.includes(INCIDENT_COLUMN_SPAN) &&
          line.includes(`\`${NEW_INCIDENT_NOTIFY_DEFAULT_COLUMN}\``)
        );
      },
    );

    expect(paragraph).toBeDefined();

    // Up to the incident's own column: the sentences before the one it is in.
    const head: string = paragraph!.slice(
      0,
      paragraph!.indexOf(INCIDENT_COLUMN_SPAN),
    );
    const ends: Array<RegExpMatchArray> = [...head.matchAll(SENTENCE_END)];
    const lastEnd: RegExpMatchArray | undefined = ends[ends.length - 1];
    const keepFrom: number = lastEnd ? lastEnd.index! + lastEnd[0].length : 0;

    for (const name of DECLARED_WITHOUT_BOX_NAMES) {
      // Named as following the switch, before the sentence about the rest.
      expect([name, head.slice(0, keepFrom).includes(name)]).toEqual([
        name,
        true,
      ]);
      // And not among the ways of creating one that keep their own value.
      expect([name, head.slice(keepFrom).includes(name)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it("the Declare page's Notify bullet names the summary's No and Change to Yes as the Dashboard draws them", () => {
    const bullet: { text: string; line: number } | undefined =
      notifyBullet(language);

    expect(bullet).toBeDefined();
    expect(bullet?.text).toContain(bold(dashboardLabel(language, NO)));
    expect(bullet?.text).toContain(
      bold(dashboardLabel(language, NOTIFY_REVIEW_CHANGE_TO_YES)),
    );
  });

  it("the Declare page's Notify bullet links to the settings page's section that has the switch", () => {
    const bullet: { text: string; line: number } | undefined =
      notifyBullet(language);
    const slug: string | undefined = switchSectionSlug(language);

    expect(slug).toBeDefined();

    const anchors: Array<string | null> = scanPage(language, DECLARING_PAGE)
      .links.filter((link: DocsLink): boolean => {
        return link.line === bullet?.line;
      })
      .map((link: DocsLink): DocsPageLink | null => {
        return parseDocsLink(link.target);
      })
      .filter((target: DocsPageLink | null): target is DocsPageLink => {
        return target?.page === SETTINGS_PAGE;
      })
      .map((target: DocsPageLink): string | null => {
        return target.anchor;
      });

    expect(anchors).toContain(slug);
  });
});
