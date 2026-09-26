import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
  makeT,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import Alert from "Common/Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import Project from "Common/Models/DatabaseModels/Project";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { UniqueColumnsTogetherMetadata } from "Common/Types/Database/UniqueColumnsTogether";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "Common/Types/Incident/IncidentAlertLink";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import {
  FEED_OPTIONS_TEXT,
  getFeedEventTypeLabel,
} from "Common/UI/Components/Feed/FeedOptions";
import { INCIDENT_PREFILL_RESOURCE_KEYS } from "Common/Utils/Incident/IncidentFromAlerts";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident docs against the alert linking feature they describe.
 *
 * Markdown is not compiled, so nothing else notices when the side menus
 * rename the Linked Alerts / Linked Incidents pages or their buttons, the
 * link cap or the miscDataProps key changes, a role gains or loses the
 * Incident Alert permissions or read access to the other side, a project
 * switch is renamed, a feed event type is added without the feed page
 * listing it, the declare prefill carries a new kind of resource, or the
 * Persian pages fall behind the English ones. Each test reads the source of
 * truth - the nav and its translations, the side menus and link pages, the
 * shared constants, the model's access lists, the Project columns, the feed
 * enums and entry wording - and checks the shipped pages still tell the same
 * story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const LOCALES_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Locales");

// The dashboard's two link pages, the alerts table's bulk actions and the link dialog they share.
const INCIDENT_LINKED_ALERTS_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/View/Alerts.tsx",
);
const ALERT_LINKED_INCIDENTS_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Alerts/View/Incidents.tsx",
);
const BULK_LINK_ACTIONS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions.tsx",
);
const LINK_HELPERS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/IncidentAlert/IncidentAlertLink.ts",
);
const LINK_DIALOG_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/IncidentAlert/LinkIncidentAlertModal.tsx",
);

// Writes the link feed entries and the one "Declared from N alerts" entry.
const INCIDENT_ALERT_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentAlertService.ts",
);

// "Declare Incident" in the alert header, next to the alert's state buttons.
const ALERT_CHANGE_STATE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Alert/ChangeState.tsx",
);
const DECLARE_FROM_ALERT_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Alert/DeclareIncidentFromAlert.ts",
);

// The create page's "acknowledge the alerts" box and the words around it.
const CREATE_INCIDENT_PAGE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/Create.tsx",
);
const ACKNOWLEDGE_ON_DECLARE_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Incident/AcknowledgeAlertsOnDeclare.ts",
);

// Declares an incident: carries the checked alerts to acknowledge to the acknowledgement.
const INCIDENT_SERVICE_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Services/IncidentService.ts",
);
// The miscDataProps keys and the API contract they document.
const INCIDENT_ALERT_LINK_TYPES_FILE: string = path.join(
  REPO_ROOT,
  "Common/Types/Incident/IncidentAlertLink.ts",
);
// The dashboard's shared Link, which the create page's incident links use.
const LINK_COMPONENT_FILE: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/Link/Link.tsx",
);

const DECLARING_FROM_ALERTS_HEADING: string =
  "Declaring an incident from alerts";
const ACKNOWLEDGING_HEADING: string = "Acknowledging the alerts as you declare";
const DECLARING_THROUGH_API_HEADING: string = "Declaring through the API";
const LINKED_ALERT_SWITCHES_HEADING: string =
  "Keeping alert states in step with the incident";

// The alert and incident used in the page's examples.
const EXAMPLE_INCIDENT_NUMBER: string = "INC-42";
const EXAMPLE_ALERT_COUNT: number = 3;

// How each language says the acknowledge box starts ticked.
const TICKED_BY_DEFAULT: Record<string, string> = {
  en: "ticked by default",
  fa: "به‌طور پیش‌فرض روشن",
};

// How each language refers to an alert episode.
const EPISODE_WORD: Record<string, string> = {
  en: "episode",
  fa: "اپیزود",
};

// How each language says pages already sent are not taken back.
const NOT_RECALLED: Record<string, string> = {
  en: "Pages that already went out are not recalled.",
  fa: "فراخوان‌هایی که از پیش فرستاده شده‌اند پس گرفته نمی‌شوند.",
};

/*
 * Acknowledging needs permission only on the alerts it will write: those
 * not acknowledged yet. How each language says so, and the wording it
 * replaced ("every one of the alerts").
 */
const NOT_ACKNOWLEDGED_YET: Record<string, string> = {
  en: "not acknowledged yet",
  fa: "هنوز تصدیق نشده",
};
const ALREADY_ACKNOWLEDGED_NEED_NO_PERMISSION: Record<string, string> = {
  en: "Alerts that are already acknowledged or resolved need no permission and never block the declaration.",
  fa: "هشدارهایی که از پیش تصدیق یا برطرف شده‌اند به هیچ مجوزی نیاز ندارند و هرگز جلوی اعلام را نمی‌گیرند.",
};
const EVERY_ALERT_CHECKED: Record<string, ReadonlyArray<string>> = {
  en: ["every one of the alerts", "every one of them"],
  fa: ["تک‌تک"],
};

// How each language says the incident links on the create page open in a new tab.
const OPENS_IN_NEW_TAB: Record<string, string> = {
  en: "The incident links open in a new tab",
  fa: "پیوندهای حادثه در زبانه‌ای تازه باز می‌شوند",
};
// The old advice for an already-linked alert, which cannot work for a lone alert.
const RELINK_ADVICE: Record<string, string> = {
  en: "link the alert to the existing incident",
  fa: "هشدار را به حادثه موجود پیوند دهید",
};

/*
 * When the linked-alert switches move the alerts instead of the box: how each
 * language says the switch, not the declaring user, gets the credit, that the
 * owners hear nothing, and that the switch's cause names even a private
 * incident by its number.
 */
const NOT_CREDITED_TO_YOU: Record<string, string> = {
  en: "they are not credited to you",
  fa: "به نام شما ثبت نمی‌شوند",
};
const OWNERS_NOT_NOTIFIED: Record<string, string> = {
  en: "their owners are not notified",
  fa: "به مالکانشان اعلانی فرستاده نمی‌شود",
};
const NAMES_PRIVATE_INCIDENT_NUMBER: Record<string, string> = {
  en: "names the incident by its number even when it is private",
  fa: "حادثه را حتی وقتی خصوصی است با شماره‌اش نام می‌برد",
};

// How each language says the acknowledgements are written a few at a time, given how many at once.
const A_FEW_AT_A_TIME: Record<string, (atOnce: number) => string> = {
  en: (atOnce: number): string => {
    return `in the background, just after they are linked, a few at a time — up to ${atOnce} at once`;
  },
  fa: (atOnce: number): string => {
    return `در پس‌زمینه، درست پس از پیوند شدن، چندتا چندتا — حداکثر ${toPersianDigits(atOnce)} هشدار هم‌زمان`;
  },
};

/*
 * The sentences that say linking leaves an alert's state alone. Each must
 * point at the acknowledge option, the one way declaring does change it.
 */
const LINKING_LEAVES_STATES_ALONE: Record<string, Array<string>> = {
  en: [
    "on its own it never acknowledges, resolves or silences an alert",
    "By default, linking changes nothing about an alert's state.",
  ],
  fa: [
    "به‌خودی‌خود هرگز هشداری را تصدیق، برطرف یا خاموش نمی‌کند",
    "به‌طور پیش‌فرض، پیوند دادن هیچ‌چیز را در وضعیت هشدار تغییر نمی‌دهد.",
  ],
};

// The old wording, from when declaring had two ways in.
const TWO_WAYS_IN: Record<string, string> = {
  en: "There are two ways in",
  fa: "دو راه ورود هست",
};
const THREE_WAYS_IN: Record<string, string> = {
  en: "There are three ways in:",
  fa: "سه راه ورود هست:",
};

const INCIDENT_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu.tsx",
);
const ALERT_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu.tsx",
);
const INCIDENTS_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu.tsx",
);
const INCIDENT_MORE_SETTINGS_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentMoreSettings.tsx",
);

// Where both pages tell readers to find the switches.
const MORE_SETTINGS_PATH: string = "**Incidents → Settings → More Settings**";

const NAV_GROUP_TITLE: string = "Incidents";

const OVERVIEW_PAGE: string = "incidents/index";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const FEED_PAGE: string = "incidents/notes-owners-and-feed";
const LINKED_ALERTS_PAGE: string = "incidents/linked-alerts";
const SETTINGS_PAGE: string = "incidents/settings";

const LINKED_ALERTS_TITLE: string = "Linked Alerts";
const LINKED_ALERTS_URL: string = `/docs/${LINKED_ALERTS_PAGE}`;

interface ExpectedPage {
  title: string;
  page: string;
}

/*
 * Reading order: what an incident is, how one starts, how it moves, what gets
 * written on it, which alerts belong to it, then how to configure it all.
 */
const EXPECTED_PAGES: ReadonlyArray<ExpectedPage> = [
  { title: "Incidents Overview", page: OVERVIEW_PAGE },
  { title: "Declaring an Incident", page: DECLARING_PAGE },
  {
    title: "Incident States & Severities",
    page: "incidents/states-and-severities",
  },
  { title: "Incident Notes, Owners & Feed", page: FEED_PAGE },
  { title: LINKED_ALERTS_TITLE, page: LINKED_ALERTS_PAGE },
  { title: "Incident Settings & Automation", page: SETTINGS_PAGE },
];

// The existing incident pages that must point readers at the new one.
const PAGES_THAT_LINK_TO_LINKED_ALERTS: ReadonlyArray<string> = [
  OVERVIEW_PAGE,
  DECLARING_PAGE,
  FEED_PAGE,
  SETTINGS_PAGE,
];

/*
 * Every language directory that ships the incident pages. `fa` is the only
 * translated corpus (every other language falls back to English per page at
 * request time), so a new translation only has to be added here.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];
const ALL_LANGUAGES: ReadonlyArray<string> = ["en", ...TRANSLATED_LANGUAGES];

const LINK_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.CreateIncidentAlert,
  Permission.ReadIncidentAlert,
  Permission.EditIncidentAlert,
  Permission.DeleteIncidentAlert,
];

const LINK_SWITCH_COLUMNS: ReadonlyArray<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

const LINK_FEED_EVENT_TYPES: ReadonlyArray<string> = [
  IncidentFeedEventType.AlertLinked,
  IncidentFeedEventType.AlertUnlinked,
  AlertFeedEventType.LinkedToIncident,
  AlertFeedEventType.UnlinkedFromIncident,
];

/*
 * How the Resources Affected row names each resource list the declare prefill
 * copies from the alerts (INCIDENT_PREFILL_RESOURCE_KEYS), after "monitor".
 * A key missing here fails the prefill test until the docs name it too.
 */
const PREFILL_RESOURCE_NAMES: Record<string, string> = {
  hosts: "host",
  kubernetesClusters: "Kubernetes cluster",
  dockerHosts: "Docker host",
  podmanHosts: "Podman host",
  services: "service",
};

// How each language refers to the bulk unlink action, given its verb.
const BULK_ACTION_PHRASE: Record<string, (verb: string) => string> = {
  en: (verb: string): string => {
    return `bulk **${verb}** action`;
  },
  fa: (verb: string): string => {
    return `کنش انبوه **${verb}**`;
  },
};

// The word each language uses for an incident's owners.
const OWNERS_WORD: Record<string, string> = {
  en: "owners",
  fa: "مالکان",
};

const FENCE_LINE: RegExp = /^\s*```/;
// An H2 or H3 heading: the ones in-page links point at.
const SECTION_HEADING: RegExp = /^#{2,3} /;
// A link dialog option as the docs show one, such as "ALT-63: Checkout API is offline".
const OPTION_LABEL_EXAMPLE: RegExp = /^[A-Z]+-\d+: \S/;
// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;
const PERSIAN_DIGITS: ReadonlyArray<string> = [
  "۰",
  "۱",
  "۲",
  "۳",
  "۴",
  "۵",
  "۶",
  "۷",
  "۸",
  "۹",
];

type PageFileFunction = (language: string, relative: string) => string;

const pageFile: PageFileFunction = (
  language: string,
  relative: string,
): string => {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
};

type ReadPageFunction = (relative: string, language?: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string = "en",
): string => {
  return fs.readFileSync(pageFile(language, relative), "utf8");
};

type SplitMarkdownFunction = (markdown: string) => {
  prose: Array<string>;
  codeBlocks: Array<string>;
};

// Prose lines and fenced code blocks, kept apart so headings and inline code are never read out of a fence.
const splitMarkdown: SplitMarkdownFunction = (
  markdown: string,
): { prose: Array<string>; codeBlocks: Array<string> } => {
  const prose: Array<string> = [];
  const codeBlocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        codeBlocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      prose.push(line);
    }
  }

  return { prose: prose, codeBlocks: codeBlocks };
};

type HeadingCountsFunction = (markdown: string) => {
  h2: number;
  h3: number;
};

const headingCounts: HeadingCountsFunction = (
  markdown: string,
): { h2: number; h3: number } => {
  const prose: Array<string> = splitMarkdown(markdown).prose;

  return {
    h2: prose.filter((line: string): boolean => {
      return line.startsWith("## ");
    }).length,
    h3: prose.filter((line: string): boolean => {
      return line.startsWith("### ");
    }).length,
  };
};

type TitleOfFunction = (markdown: string) => string;

const titleOf: TitleOfFunction = (markdown: string): string => {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
};

type InlineCodeFunction = (markdown: string) => Set<string>;

const inlineCode: InlineCodeFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type DocsLinksFunction = (markdown: string) => Set<string>;

// Every /docs/ link target, without its #anchor.
const docsLinks: DocsLinksFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type IncidentsGroupFunction = () => NavGroup;

const incidentsGroup: IncidentsGroupFunction = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
};

type EscapeRegExpFunction = (text: string) => string;

const escapeRegExp: EscapeRegExpFunction = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

type TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
) => string | undefined;

const tableRowStartingWith: TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
): string | undefined => {
  return markdown.split("\n").find((line: string): boolean => {
    return new RegExp(`^\\|\\s*${escapeRegExp(firstCell)}\\s*\\|`).test(line);
  });
};

type TableCellsFunction = (row: string) => Array<string>;

// The cells of a markdown table row, trimmed, without the empty outer ones.
const tableCells: TableCellsFunction = (row: string): Array<string> => {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
};

type ToPersianDigitsFunction = (value: number) => string;

const toPersianDigits: ToPersianDigitsFunction = (value: number): string => {
  return value
    .toString()
    .split("")
    .map((digit: string): string => {
      return PERSIAN_DIGITS[Number(digit)] as string;
    })
    .join("");
};

interface SideMenuPage {
  section: string;
  title: string;
}

type SideMenuPagesFunction = (file: string) => Array<SideMenuPage>;

/*
 * Every side-menu link title with the section it sits in, read from source:
 * the menus are React components that a plain-node test must not import.
 */
const sideMenuPages: SideMenuPagesFunction = (
  file: string,
): Array<SideMenuPage> => {
  const source: string = fs.readFileSync(file, "utf8");
  const pages: Array<SideMenuPage> = [];

  for (const chunk of source.split(/<SideMenuSection\s+title="/).slice(1)) {
    const section: string = chunk.slice(0, chunk.indexOf('"'));

    for (const match of chunk.matchAll(/title:\s*"([^"]+)"/g)) {
      pages.push({ section: section, title: match[1] as string });
    }
  }

  return pages;
};

type SideMenuPageTitledFunction = (
  file: string,
  title: string,
) => SideMenuPage | undefined;

const sideMenuPageTitled: SideMenuPageTitledFunction = (
  file: string,
  title: string,
): SideMenuPage | undefined => {
  return sideMenuPages(file).find((candidate: SideMenuPage): boolean => {
    return candidate.title === title;
  });
};

type RoleTitlesFunction = (permissions: Array<Permission>) => Array<string>;

// The roles in an access list, as the docs name them: everything but the link's own granular permissions.
const roleTitles: RoleTitlesFunction = (
  permissions: Array<Permission>,
): Array<string> => {
  return permissions
    .filter((permission: Permission): boolean => {
      return !LINK_PERMISSIONS.includes(permission);
    })
    .map((permission: Permission): string => {
      return PermissionHelper.getTitle(permission);
    })
    .sort();
};

type ListedRolesFunction = (cell: string) => Array<string>;

const listedRoles: ListedRolesFunction = (cell: string): Array<string> => {
  return cell
    .split(",")
    .map((role: string): string => {
      return role.trim();
    })
    .sort();
};

type ReadSourceFunction = (file: string) => string;

const readSource: ReadSourceFunction = (file: string): string => {
  return fs.readFileSync(file, "utf8");
};

interface DocsLocale {
  navLinks: { [key: string]: string };
}

type ReadLocaleFunction = (language: string) => DocsLocale;

const readLocale: ReadLocaleFunction = (language: string): DocsLocale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as DocsLocale;
};

type ReadAccessToAddFunction = (
  readPermissions: Array<Permission>,
) => Array<string>;

/*
 * The read access somebody who may link but cannot read this side has to be
 * given: the side's read permissions that do not already let you link.
 */
const readAccessToAdd: ReadAccessToAddFunction = (
  readPermissions: Array<Permission>,
): Array<string> => {
  const linkers: Array<Permission> = new IncidentAlert().getCreatePermissions();

  return Array.from(
    new Set<string>(
      readPermissions
        .filter((permission: Permission): boolean => {
          return !linkers.includes(permission);
        })
        .map((permission: Permission): string => {
          return PermissionHelper.getTitle(permission);
        }),
    ),
  ).sort();
};

type PermissionTitlesInFunction = (
  line: string,
  titles: Array<string>,
) => Array<string>;

/*
 * Which of `titles` a line names, as whole words. Longer titles are matched
 * first and blanked out, so "Viewer" is not also found inside "Alert Viewer".
 */
const permissionTitlesIn: PermissionTitlesInFunction = (
  line: string,
  titles: Array<string>,
): Array<string> => {
  let rest: string = line;
  const found: Array<string> = [];

  const longestFirst: Array<string> = [...titles].sort(
    (a: string, b: string): number => {
      return b.length - a.length;
    },
  );

  for (const title of longestFirst) {
    const pattern: RegExp = new RegExp(
      `(^|[^A-Za-z])${escapeRegExp(title)}(?![A-Za-z])`,
      "g",
    );

    if (pattern.test(rest)) {
      found.push(title);
      rest = rest.replace(pattern, "$1 ");
    }
  }

  return found.sort();
};

type QuotedNameFunction = (sourceSnippet: string) => string;

// The first double-quoted string in a source snippet: `title: "Link Alert"` -> "Link Alert".
const quotedName: QuotedNameFunction = (sourceSnippet: string): string => {
  return sourceSnippet.match(/"([^"]+)"/)?.[1] || "";
};

type InPageLinksFunction = (markdown: string) => Array<string>;

// Every in-page `](#anchor)` link target, in order.
const inPageLinks: InPageLinksFunction = (markdown: string): Array<string> => {
  return Array.from(markdown.matchAll(/\]\(#([^)\s]+)\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
};

interface ProseHeading {
  level: number;
  text: string;
  // Index into the page's prose lines.
  at: number;
}

type ProseHeadingsFunction = (markdown: string) => Array<ProseHeading>;

// Every H2 and H3 of a page, in order, with where it sits among the prose lines.
const proseHeadings: ProseHeadingsFunction = (
  markdown: string,
): Array<ProseHeading> => {
  const headings: Array<ProseHeading> = [];

  splitMarkdown(markdown).prose.forEach((line: string, at: number): void => {
    const match: RegExpMatchArray | null = line.match(/^(#{2,3}) (.+)$/);

    if (match) {
      headings.push({
        level: (match[1] as string).length,
        text: (match[2] as string).trim(),
        at: at,
      });
    }
  });

  return headings;
};

type HeadingIndexFunction = (level: number, text: string) => number;

// Where an English heading sits among the English page's headings: translations mirror it one for one.
const englishHeadingIndex: HeadingIndexFunction = (
  level: number,
  text: string,
): number => {
  const index: number = proseHeadings(readPage(LINKED_ALERTS_PAGE)).findIndex(
    (heading: ProseHeading): boolean => {
      return heading.level === level && heading.text === text;
    },
  );

  expect({ heading: text, found: index >= 0 }).toEqual({
    heading: text,
    found: true,
  });

  return index;
};

type SectionLinesFunction = (
  markdown: string,
  headingIndex: number,
) => Array<string>;

/*
 * The prose lines under a heading, down to the next heading of the same or a
 * higher level (so an H2's section includes its H3s).
 */
const sectionLines: SectionLinesFunction = (
  markdown: string,
  headingIndex: number,
): Array<string> => {
  const prose: Array<string> = splitMarkdown(markdown).prose;
  const headings: Array<ProseHeading> = proseHeadings(markdown);
  const heading: ProseHeading | undefined = headings[headingIndex];

  if (!heading) {
    throw new Error(`No heading #${headingIndex}`);
  }

  const next: ProseHeading | undefined = headings
    .slice(headingIndex + 1)
    .find((candidate: ProseHeading): boolean => {
      return candidate.level <= heading.level;
    });

  return prose.slice(heading.at + 1, next ? next.at : prose.length);
};

type StringLiteralsFunction = (source: string) => Array<string>;

// The double-quoted and template string literals of a source snippet, in order.
const stringLiterals: StringLiteralsFunction = (
  source: string,
): Array<string> => {
  return Array.from(source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] ?? match[2]) as string;
    },
  );
};

type SourceBetweenFunction = (
  source: string,
  start: string,
  end: string,
) => string;

// The source between two markers; throws if either is missing, so a moved marker never passes vacuously.
const sourceBetween: SourceBetweenFunction = (
  source: string,
  start: string,
  end: string,
): string => {
  const from: number = source.indexOf(start);

  if (from < 0) {
    throw new Error(`Expected to find ${start}`);
  }

  const to: number = source.indexOf(end, from + start.length);

  if (to < 0) {
    throw new Error(`Expected to find ${end} after ${start}`);
  }

  return source.slice(from + start.length, to);
};

type RoleTitlesOfFunction = (permissions: Array<Permission>) => Array<string>;

// The titles of the roles in an access list: granular permissions left out.
const roleTitlesOf: RoleTitlesOfFunction = (
  permissions: Array<Permission>,
): Array<string> => {
  const roles: Set<Permission> = new Set<Permission>(
    PermissionHelper.getRolePermissionProps().map(
      (props: PermissionProps): Permission => {
        return props.permission;
      },
    ),
  );

  return permissions
    .filter((permission: Permission): boolean => {
      return roles.has(permission);
    })
    .map((permission: Permission): string => {
      return PermissionHelper.getTitle(permission);
    })
    .sort();
};

type DeclareExampleBodyFunction = (markdown: string) => {
  miscDataProps?: { [key: string]: unknown };
};

// The JSON body of the page's `POST /api/incident` example, parsed.
const declareExampleBody: DeclareExampleBodyFunction = (
  markdown: string,
): { miscDataProps?: { [key: string]: unknown } } => {
  const example: string =
    splitMarkdown(markdown).codeBlocks.find((block: string): boolean => {
      return block.includes("https://oneuptime.com/api/incident \\");
    }) || "";

  return JSON.parse(sourceBetween(example, "-d '", "'")) as {
    miscDataProps?: { [key: string]: unknown };
  };
};

describe("Incident Linked Alerts docs", () => {
  describe("navigation", () => {
    it("lists the incident pages in reading order, with Linked Alerts after the feed page", () => {
      expect(
        incidentsGroup().links.map((link: NavLink): NavLink => {
          return { title: link.title, url: link.url };
        }),
      ).toEqual(
        EXPECTED_PAGES.map((expected: ExpectedPage): NavLink => {
          return { title: expected.title, url: `/docs/${expected.page}` };
        }),
      );
    });

    it("has an English page for every link, and titles the new page like its nav entry", () => {
      for (const expected of EXPECTED_PAGES) {
        expect({
          page: expected.page,
          exists: fs.existsSync(pageFile("en", expected.page)),
        }).toEqual({ page: expected.page, exists: true });
      }

      expect(titleOf(readPage(LINKED_ALERTS_PAGE))).toBe(LINKED_ALERTS_TITLE);
    });

    it("ships a real translation of every incident page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            exists: fs.existsSync(pageFile(language, expected.page)),
          }).toEqual({
            language: language,
            page: expected.page,
            exists: true,
          });

          const translated: string = readPage(expected.page, language);

          expect(PERSIAN_LETTER.test(titleOf(translated))).toBe(true);
          expect(translated).not.toEqual(readPage(expected.page));
        }
      }
    });

    it("has a nav title for every incident page in every docs language, with Linked Alerts translated", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const navLinks: { [key: string]: string } =
          readLocale(language).navLinks;

        for (const expected of EXPECTED_PAGES) {
          const title: string | undefined = navLinks[expected.title];

          expect({
            language: language,
            page: expected.title,
            hasTitle: typeof title === "string" && title.trim().length > 0,
          }).toEqual({
            language: language,
            page: expected.title,
            hasTitle: true,
          });
        }

        // The raw English title in another language means nobody translated it.
        expect({
          language: language,
          english: navLinks[LINKED_ALERTS_TITLE] === LINKED_ALERTS_TITLE,
        }).toEqual({
          language: language,
          english: language === DEFAULT_DOCS_LANGUAGE,
        });
      }
    });

    it("titles the translated nav link like the translated page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect(readLocale(language).navLinks[LINKED_ALERTS_TITLE]).toBe(
          titleOf(readPage(LINKED_ALERTS_PAGE, language)),
        );
      }
    });

    it("shows the translated title in every language's nav, linking to that language's page", () => {
      for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const group: LocalizedNavGroup | undefined = getLocalizedNav(
          language,
        ).find((item: LocalizedNavGroup): boolean => {
          return item.key === NAV_GROUP_TITLE;
        });

        expect(group).toBeDefined();

        const link: LocalizedNavLink | undefined = group?.links.find(
          (item: LocalizedNavLink): boolean => {
            return item.url === `/docs/${language}/${LINKED_ALERTS_PAGE}`;
          },
        );

        expect({ language: language, title: link?.title }).toEqual({
          language: language,
          title: readLocale(language).navLinks[LINKED_ALERTS_TITLE],
        });
        expect(link?.title).toBe(
          makeT(language)(`navLinks.${LINKED_ALERTS_TITLE}`),
        );
      }
    });
  });

  describe("links", () => {
    it("points every /docs link on the incident pages, in every language, at a page that exists", () => {
      for (const language of ALL_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          for (const link of docsLinks(readPage(expected.page, language))) {
            const relative: string = link.slice("/docs/".length);

            expect({
              language: language,
              page: expected.page,
              link: link,
              exists: fs.existsSync(pageFile("en", relative)),
            }).toEqual({
              language: language,
              page: expected.page,
              link: link,
              exists: true,
            });
          }
        }
      }
    });

    it("links the overview, declaring, feed and settings pages to Linked Alerts, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of PAGES_THAT_LINK_TO_LINKED_ALERTS) {
          expect({
            language: language,
            page: page,
            linksToLinkedAlerts: docsLinks(readPage(page, language)).has(
              LINKED_ALERTS_URL,
            ),
          }).toEqual({
            language: language,
            page: page,
            linksToLinkedAlerts: true,
          });
        }
      }
    });

    it("keeps the same docs links in the Linked Alerts translation", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        expect({
          language: language,
          links: Array.from(
            docsLinks(readPage(LINKED_ALERTS_PAGE, language)),
          ).sort(),
        }).toEqual({
          language: language,
          links: Array.from(docsLinks(readPage(LINKED_ALERTS_PAGE))).sort(),
        });
      }
    });

    it("keeps every in-page link of Linked Alerts in the translation, pointing at the translated heading", () => {
      const english: string = readPage(LINKED_ALERTS_PAGE);
      const englishHeadings: Array<string> = splitMarkdown(english)
        .prose.filter((line: string): boolean => {
          return SECTION_HEADING.test(line);
        })
        .map((line: string): string => {
          return slugify(line.replace(/^#+ /, "").trim());
        });

      for (const language of TRANSLATED_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);
        const translatedHeadings: Array<string> = splitMarkdown(translated)
          .prose.filter((line: string): boolean => {
            return SECTION_HEADING.test(line);
          })
          .map((line: string): string => {
            return slugify(line.replace(/^#+ /, "").trim());
          });

        /*
         * Headings mirror each other one for one, so the n-th in-page link
         * in the translation must target the translation of the heading the
         * n-th English link targets.
         */
        expect({
          language: language,
          links: inPageLinks(translated),
        }).toEqual({
          language: language,
          links: inPageLinks(english).map((anchor: string): string => {
            return translatedHeadings[englishHeadings.indexOf(anchor)] || "";
          }),
        });
      }
    });
  });

  describe("translations", () => {
    it("mirror the English heading structure on every incident page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page, language)),
          }).toEqual({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page)),
          });
        }
      }
    });

    it("keep every English code identifier and code block of Linked Alerts intact", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        const english: string = readPage(LINKED_ALERTS_PAGE);
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);
        const translatedCode: Set<string> = inlineCode(translated);

        for (const identifier of inlineCode(english)) {
          expect({
            language: language,
            identifier: identifier,
            present: translatedCode.has(identifier),
          }).toEqual({
            language: language,
            identifier: identifier,
            present: true,
          });
        }

        expect(splitMarkdown(translated).codeBlocks).toEqual(
          splitMarkdown(english).codeBlocks,
        );
      }
    });
  });

  describe("side menus", () => {
    /*
     * Where the dashboard puts the two pages. Read once here and pinned by the
     * first test, so a renamed or moved page fails there with a clear diff.
     */
    const incidentPage: SideMenuPage = sideMenuPageTitled(
      INCIDENT_SIDE_MENU_FILE,
      LINKED_ALERTS_TITLE,
    ) || { section: "", title: LINKED_ALERTS_TITLE };
    const alertPage: SideMenuPage = sideMenuPageTitled(
      ALERT_SIDE_MENU_FILE,
      "Linked Incidents",
    ) || { section: "", title: "Linked Incidents" };

    it("reads the incident and alert side-menu pages", () => {
      expect(incidentPage).toEqual({
        section: "Investigation",
        title: LINKED_ALERTS_TITLE,
      });
      expect(alertPage).toEqual({
        section: "Basic",
        title: "Linked Incidents",
      });
    });

    it("names both pages and their side-menu sections the way the menus do, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const page of [incidentPage, alertPage]) {
          expect({
            language: language,
            page: page.title,
            named: markdown.includes(`**${page.title}**`),
            sectionNamed: markdown.includes(`**${page.section}**`),
          }).toEqual({
            language: language,
            page: page.title,
            named: true,
            sectionNamed: true,
          });
        }
      }
    });

    it("lists the incident's Linked Alerts page on the overview, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(OVERVIEW_PAGE, language);

        expect({
          language: language,
          incidentPage: markdown.includes(`- **${incidentPage.title}** — `),
          alertPage: markdown.includes(`**${alertPage.title}**`),
        }).toEqual({ language: language, incidentPage: true, alertPage: true });
      }
    });
  });

  describe("Linked Alerts", () => {
    const markdown: string = readPage(LINKED_ALERTS_PAGE);
    const crudApiPath: string =
      new IncidentAlert().getCrudApiPath()?.toString() || "";

    it("states the per-action alert cap the dashboard and server enforce, in every language", () => {
      expect(MAX_ALERTS_PER_INCIDENT_LINK_ACTION).toBeGreaterThan(0);

      expect(markdown).toContain(`**${MAX_ALERTS_PER_INCIDENT_LINK_ACTION}**`);

      for (const language of TRANSLATED_LANGUAGES) {
        expect(readPage(LINKED_ALERTS_PAGE, language)).toContain(
          `**${toPersianDigits(MAX_ALERTS_PER_INCIDENT_LINK_ACTION)}**`,
        );
      }
    });

    it("sends the alert ids under the miscDataProps key the server reads", () => {
      const declareExample: string | undefined = splitMarkdown(
        markdown,
      ).codeBlocks.find((block: string): boolean => {
        return block.includes("https://oneuptime.com/api/incident \\");
      });

      expect(declareExample).toBeDefined();
      expect(declareExample).toContain('"miscDataProps": {');
      expect(declareExample).toContain(
        `"${INCIDENT_ALERT_IDS_TO_LINK_KEY}": [`,
      );
      expect(inlineCode(markdown).has(INCIDENT_ALERT_IDS_TO_LINK_KEY)).toBe(
        true,
      );
    });

    it("uses the link model's real API route in the prose and every example", () => {
      expect(crudApiPath).toBe("/incident-alert");
      expect(inlineCode(markdown).has(`/api${crudApiPath}`)).toBe(true);

      const linkExamples: Array<string> = splitMarkdown(
        markdown,
      ).codeBlocks.filter((block: string): boolean => {
        return block.includes("/api/incident-");
      });

      expect(linkExamples.length).toBeGreaterThanOrEqual(3);

      for (const example of linkExamples) {
        expect(example).toContain(`https://oneuptime.com/api${crudApiPath}`);
      }
    });

    it("names the generated workflow triggers after the model's singular name", () => {
      const singularName: string = new IncidentAlert().singularName || "";

      expect(singularName).toBe("Incident Alert");
      expect(markdown).toContain(`**On Create ${singularName}**`);
      expect(markdown).toContain(`**On Delete ${singularName}**`);
    });

    it("documents every Incident Alert permission, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const permission of LINK_PERMISSIONS) {
          const title: string = PermissionHelper.getTitle(permission);

          expect({
            language: language,
            permission: title,
            documented: Boolean(
              tableRowStartingWith(translated, `**${title}**`),
            ),
          }).toEqual({
            language: language,
            permission: title,
            documented: true,
          });
        }
      }
    });

    it("lists exactly the roles the link model grants create, edit and delete to", () => {
      const model: IncidentAlert = new IncidentAlert();
      const cases: Array<{ permission: Permission; roles: Array<string> }> = [
        {
          permission: Permission.CreateIncidentAlert,
          roles: roleTitles(model.getCreatePermissions()),
        },
        {
          permission: Permission.EditIncidentAlert,
          roles: roleTitles(model.getUpdatePermissions()),
        },
        {
          permission: Permission.DeleteIncidentAlert,
          roles: roleTitles(model.getDeletePermissions()),
        },
      ];

      for (const testCase of cases) {
        const title: string = PermissionHelper.getTitle(testCase.permission);
        const row: string | undefined = tableRowStartingWith(
          markdown,
          `**${title}**`,
        );

        expect(row).toBeDefined();

        expect({
          permission: title,
          roles: listedRoles(tableCells(row as string)[2] || ""),
        }).toEqual({ permission: title, roles: testCase.roles });
      }
    });

    it("lists the extra read-only roles the link model grants read to", () => {
      const model: IncidentAlert = new IncidentAlert();
      const createRoles: Array<string> = roleTitles(
        model.getCreatePermissions(),
      );
      const readRoles: Array<string> = roleTitles(model.getReadPermissions());

      // "All of the above" only holds while every role that can link can also read.
      for (const role of createRoles) {
        expect(readRoles).toContain(role);
      }

      const readRow: string = tableRowStartingWith(
        markdown,
        `**${PermissionHelper.getTitle(Permission.ReadIncidentAlert)}**`,
      ) as string;
      const rolesCell: string = tableCells(readRow)[2] || "";

      expect(rolesCell.startsWith("All of the above")).toBe(true);

      const readOnlyRoles: Array<string> = readRoles.filter(
        (role: string): boolean => {
          return !createRoles.includes(role);
        },
      );

      expect(readOnlyRoles.length).toBeGreaterThan(0);

      for (const role of readOnlyRoles) {
        expect({ role: role, listed: rolesCell.includes(role) }).toEqual({
          role: role,
          listed: true,
        });
      }
    });

    it("names the feed entries as the feed's filter labels them, with their event types, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const translated: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const eventType of LINK_FEED_EVENT_TYPES) {
          const entry: string = `**${getFeedEventTypeLabel(eventType)}** (\`${eventType}\`)`;

          expect({
            language: language,
            eventType: eventType,
            documented: translated.includes(entry),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }

        expect(translated).toContain(`**${FEED_OPTIONS_TEXT.triggerLabel}**`);
      }
    });

    it("quotes the message a duplicate link is refused with, in every language", () => {
      // The model's unique-together check answers with the shared message (and so does the unique index).
      expect(
        new IncidentAlert()
          .getUniqueColumnsTogether()
          .map((constraint: UniqueColumnsTogetherMetadata): string => {
            return constraint.errorMessage;
          }),
      ).toContain(INCIDENT_ALERT_ALREADY_LINKED_MESSAGE);

      for (const language of ALL_LANGUAGES) {
        expect({
          language: language,
          quoted: readPage(LINKED_ALERTS_PAGE, language).includes(
            INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
          ),
        }).toEqual({ language: language, quoted: true });
      }
    });

    it("names the link pages' buttons, dialogs and row actions as the dashboard does, in every language", () => {
      const cases: Array<{ file: string; snippet: string }> = [
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'title: "Link Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'submitButtonText="Link Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'fieldTitle="Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'title: "View Alert"',
        },
        {
          file: INCIDENT_LINKED_ALERTS_PAGE_FILE,
          snippet: 'deleteButtonText="Unlink"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "Link Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "Declare Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'title: "View Incident"',
        },
        {
          file: ALERT_LINKED_INCIDENTS_PAGE_FILE,
          snippet: 'deleteButtonText="Unlink"',
        },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'LINK_TO_INCIDENT_ACTION_TITLE: string = "Link to Incident"',
        },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident"',
        },
        { file: BULK_LINK_ACTIONS_FILE, snippet: 'fieldTitle="Incident"' },
        {
          file: BULK_LINK_ACTIONS_FILE,
          snippet: 'submitButtonText="Link Alerts"',
        },
      ];

      for (const testCase of cases) {
        expect({
          file: path.basename(testCase.file),
          snippet: testCase.snippet,
          inSource: readSource(testCase.file).includes(testCase.snippet),
        }).toEqual({
          file: path.basename(testCase.file),
          snippet: testCase.snippet,
          inSource: true,
        });

        const name: string = quotedName(testCase.snippet);

        for (const language of ALL_LANGUAGES) {
          expect({
            language: language,
            name: name,
            named: readPage(LINKED_ALERTS_PAGE, language).includes(
              `**${name}**`,
            ),
          }).toEqual({ language: language, name: name, named: true });
        }
      }
    });

    it("calls bulk unlinking by the verb both link pages give it, never Delete, in every language", () => {
      const verbs: Array<string> = [
        INCIDENT_LINKED_ALERTS_PAGE_FILE,
        ALERT_LINKED_INCIDENTS_PAGE_FILE,
      ].map((file: string): string => {
        return readSource(file).match(/deleteVerb:\s*"([^"]+)"/)?.[1] || "";
      });

      const verb: string = verbs[0] || "";

      expect(verb.length).toBeGreaterThan(0);
      expect(verbs).toEqual([verb, verb]);

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const phrase: string = (
          BULK_ACTION_PHRASE[language] as (verb: string) => string
        )(verb);

        expect({
          language: language,
          bulkActionNamed: markdown.includes(phrase),
          deleteNamed: markdown.includes("**Delete**"),
        }).toEqual({
          language: language,
          bulkActionNamed: true,
          deleteNamed: false,
        });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).not.toContain("Despite its name");
    });

    it("describes the link dialogs' options the way the dialogs build them", () => {
      const helpers: string = readSource(LINK_HELPERS_FILE);

      // Recent records first, each labelled "<number>: <title>".
      expect(helpers).toMatch(/createdAt:\s*SortOrder\.Descending/);
      expect(helpers).toMatch(/`\$\{number\}: \$\{title\}`/);

      // Typing searches every record by its title on the server.
      expect(readSource(LINK_DIALOG_FILE)).toMatch(/labelField:\s*"title"/);

      const markdown: string = readPage(LINKED_ALERTS_PAGE);
      const examples: Array<string> = Array.from(inlineCode(markdown)).filter(
        (code: string): boolean => {
          return OPTION_LABEL_EXAMPLE.test(code);
        },
      );

      // One example on each side: an alert label and an incident label.
      expect(
        examples
          .map((example: string): string => {
            return example.split("-")[0] as string;
          })
          .sort(),
      ).toEqual(["ALT", "INC"]);

      expect(markdown).toContain("searches every alert by title");
      expect(markdown).toContain("typing searches every incident by title");
    });

    it("says which read access alert and incident roles also need to link, in every language", () => {
      const linkers: Array<Permission> =
        new IncidentAlert().getCreatePermissions();
      const incidentReads: Array<Permission> =
        new Incident().getReadPermissions();
      const alertReads: Array<Permission> = new Alert().getReadPermissions();

      // Why the page says so: the alert roles that may link cannot read incidents, and the reverse.
      for (const role of [Permission.AlertAdmin, Permission.AlertMember]) {
        expect({ role: role, links: linkers.includes(role) }).toEqual({
          role: role,
          links: true,
        });
        expect({
          role: role,
          readsIncidents: incidentReads.includes(role),
        }).toEqual({ role: role, readsIncidents: false });
      }

      for (const role of [
        Permission.IncidentAdmin,
        Permission.IncidentMember,
      ]) {
        expect({ role: role, links: linkers.includes(role) }).toEqual({
          role: role,
          links: true,
        });
        expect({ role: role, readsAlerts: alertReads.includes(role) }).toEqual({
          role: role,
          readsAlerts: false,
        });
      }

      const incidentReadToAdd: Array<string> = readAccessToAdd(incidentReads);
      const alertReadToAdd: Array<string> = readAccessToAdd(alertReads);
      const candidates: Array<string> = Array.from(
        new Set<string>([...incidentReadToAdd, ...alertReadToAdd]),
      );

      const byKey: (lists: Array<Array<string>>) => Array<string> = (
        lists: Array<Array<string>>,
      ): Array<string> => {
        return lists
          .map((list: Array<string>): string => {
            return list.join(", ");
          })
          .sort();
      };

      for (const language of ALL_LANGUAGES) {
        // The two bullets that say what to add, and no other bullet naming a read permission.
        const listed: Array<Array<string>> = splitMarkdown(
          readPage(LINKED_ALERTS_PAGE, language),
        )
          .prose.filter((line: string): boolean => {
            return line.startsWith("- ");
          })
          .map((line: string): Array<string> => {
            return permissionTitlesIn(line, candidates);
          })
          .filter((titles: Array<string>): boolean => {
            return titles.length > 0;
          });

        expect({ language: language, listed: byKey(listed) }).toEqual({
          language: language,
          listed: byKey([incidentReadToAdd, alertReadToAdd]),
        });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).not.toContain(
        "without being given incident roles",
      );
    });

    it("names exactly the affected resources a declared incident is prefilled with", () => {
      for (const key of INCIDENT_PREFILL_RESOURCE_KEYS) {
        expect({
          key: key,
          named: Boolean(PREFILL_RESOURCE_NAMES[key]),
        }).toEqual({ key: key, named: true });
      }

      const names: Array<string> = [
        "monitor",
        ...INCIDENT_PREFILL_RESOURCE_KEYS.map((key: string): string => {
          return PREFILL_RESOURCE_NAMES[key] as string;
        }),
      ];

      const englishRow: string =
        tableRowStartingWith(
          readPage(LINKED_ALERTS_PAGE),
          "**Resources Affected**",
        ) || "";

      expect(tableCells(englishRow)[1]).toContain(
        `Every ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} of the selected alerts, combined.`,
      );
      expect(tableCells(englishRow)[1]).toContain("are not copied");

      // Product names stay in English in every translation.
      const productNames: Array<string> = names.flatMap(
        (name: string): Array<string> => {
          return name.match(/\b[A-Z][A-Za-z]+\b/g) || [];
        },
      );

      expect(productNames.length).toBeGreaterThan(0);

      for (const language of TRANSLATED_LANGUAGES) {
        const row: string =
          tableRowStartingWith(
            readPage(LINKED_ALERTS_PAGE, language),
            "**Resources Affected**",
          ) || "";

        for (const productName of productNames) {
          expect({
            language: language,
            productName: productName,
            named: (tableCells(row)[1] || "").includes(productName),
          }).toEqual({
            language: language,
            productName: productName,
            named: true,
          });
        }
      }
    });

    it("says a private declared incident takes the alerts' owners, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const row: string =
          tableRowStartingWith(
            readPage(LINKED_ALERTS_PAGE, language),
            "**Private Incident**",
          ) || "";

        expect({
          language: language,
          ownersMentioned: row.includes(OWNERS_WORD[language] as string),
        }).toEqual({ language: language, ownersMentioned: true });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).toContain(
        "are added as owners of the incident, without being notified",
      );
    });

    it("quotes the private-title and declared-from-alerts wording the feed entries use, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);

      // A private end is named "(private alert)" / "(private incident)", without its title.
      expect(service).toMatch(/\(private \$\{data\.privateNoun\}\)/);
      expect(service).toMatch(/privateNoun:\s*"alert"/);
      expect(service).toMatch(/privateNoun:\s*"incident"/);

      // The one entry for an incident declared from alerts, an Alert Linked entry.
      expect(service).toMatch(/Declared from \$\{alerts\.length\} \$\{noun\}:/);
      expect(service).toMatch(
        /createDeclaredFromAlertsFeedItem[\s\S]*?incidentFeedEventType:\s*IncidentFeedEventType\.AlertLinked/,
      );

      const incidentCreated: string = getFeedEventTypeLabel(
        IncidentFeedEventType.IncidentCreated,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);

        for (const phrase of [
          "(private alert)",
          "(private incident)",
          "Declared from 3 alerts:",
          `**${incidentCreated}**`,
          `**${getFeedEventTypeLabel(IncidentFeedEventType.AlertLinked)}**`,
        ]) {
          expect({
            language: language,
            phrase: phrase,
            quoted: markdown.includes(phrase),
          }).toEqual({ language: language, phrase: phrase, quoted: true });
        }
      }
    });
  });

  describe("linked alert switches", () => {
    const project: Project = new Project();

    it("are the opt-in Project columns the docs describe", () => {
      for (const column of LINK_SWITCH_COLUMNS) {
        expect({
          column: column,
          defaultValue: project.getTableColumnMetadata(column).defaultValue,
        }).toEqual({ column: column, defaultValue: false });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).toContain(
        "Both are off by default.",
      );
      expect(readPage(SETTINGS_PAGE)).toContain("Both are off by default");
    });

    it("are named by their real titles on Linked Alerts and Settings, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        for (const page of [LINKED_ALERTS_PAGE, SETTINGS_PAGE]) {
          const translated: string = readPage(page, language);

          for (const column of LINK_SWITCH_COLUMNS) {
            const title: string =
              project.getTableColumnMetadata(column).title || "";

            expect(title.length).toBeGreaterThan(0);

            expect({
              language: language,
              page: page,
              column: column,
              named: translated.includes(`- **${title}** — `),
            }).toEqual({
              language: language,
              page: page,
              column: column,
              named: true,
            });
          }
        }
      }
    });

    it("sit on a card of their own on More Settings, where the docs send readers, in every language", () => {
      const cards: Array<string> = fs
        .readFileSync(INCIDENT_MORE_SETTINGS_FILE, "utf8")
        .split("<CardModelDetail")
        .slice(1);

      const switchCards: Array<string> = cards.filter(
        (card: string): boolean => {
          return LINK_SWITCH_COLUMNS.some((column: string): boolean => {
            return card.includes(`${column}:`);
          });
        },
      );

      // One card, holding both switches and nothing else it could overwrite on Update.
      expect(switchCards).toHaveLength(1);

      const card: string = switchCards[0] as string;

      for (const column of LINK_SWITCH_COLUMNS) {
        expect(card).toContain(`${column}:`);
      }

      expect(card).not.toContain("NumberPrefix");

      const cardTitle: string | undefined = card.match(
        /cardProps=\{\{\s*title:\s*"([^"]+)"/,
      )?.[1];

      expect(cardTitle).toBeDefined();

      // The page holding the card is the one the Incidents side menu calls More Settings.
      expect(fs.readFileSync(INCIDENTS_SIDE_MENU_FILE, "utf8")).toMatch(
        /title:\s*"More Settings",\s*to:\s*RouteUtil\.populateRouteParams\(\s*RouteMap\[PageMap\.INCIDENTS_SETTINGS_MORE\]/,
      );

      const cardReference: Record<string, string> = {
        en: `**${cardTitle}** card`,
        fa: `کارت **${cardTitle}**`,
      };

      for (const language of ALL_LANGUAGES) {
        for (const page of [LINKED_ALERTS_PAGE, SETTINGS_PAGE]) {
          const translated: string = readPage(page, language);

          expect({
            language: language,
            page: page,
            path: translated.includes(MORE_SETTINGS_PATH),
            card: translated.includes(cardReference[language] as string),
          }).toEqual({
            language: language,
            page: page,
            path: true,
            card: true,
          });
        }
      }
    });
  });

  describe("who moves a linked alert", () => {
    const WHO_MOVES_HEADING: string = "Who moves a linked alert";

    it("is a real gap between linking and editing alerts", () => {
      const alertEditors: Array<Permission> =
        new Alert().getUpdatePermissions();

      /*
       * Roles that may link an alert but not edit it. While there are any,
       * the switches let somebody move an alert they could not move
       * themselves, which is what the page has to spell out.
       */
      const linkButNotEdit: Array<Permission> = new IncidentAlert()
        .getCreatePermissions()
        .filter((permission: Permission): boolean => {
          return (
            !LINK_PERMISSIONS.includes(permission) &&
            !alertEditors.includes(permission)
          );
        });

      expect(linkButNotEdit.length).toBeGreaterThan(0);
    });

    it("is explained under the switches and linked from the permissions, in every language", () => {
      const english: string = readPage(LINKED_ALERTS_PAGE);
      const englishHeadings: Array<string> = splitMarkdown(
        english,
      ).prose.filter((line: string): boolean => {
        return line.startsWith("### ");
      });
      const index: number = englishHeadings.indexOf(`### ${WHO_MOVES_HEADING}`);

      expect(index).toBeGreaterThanOrEqual(0);

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const heading: string =
          splitMarkdown(markdown)
            .prose.filter((line: string): boolean => {
              return line.startsWith("### ");
            })
            [index]?.slice(4)
            .trim() || "";

        expect({
          language: language,
          linked: inPageLinks(markdown).includes(slugify(heading)),
        }).toEqual({ language: language, linked: true });
      }

      // The switches' own page points at it too.
      expect(readPage(SETTINGS_PAGE)).toContain(
        "without needing permission to edit alerts",
      );
      expect(english).toContain("Leave them off if alert states should only");
    });
  });

  describe("Incident Notes, Owners & Feed", () => {
    it("lists every incident feed event type, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const documented: Set<string> = inlineCode(
          readPage(FEED_PAGE, language),
        );

        for (const eventType of Object.values(IncidentFeedEventType)) {
          expect({
            language: language,
            eventType: eventType,
            documented: documented.has(eventType),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }
      }
    });

    it("mentions the alert-side link entries, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const documented: Set<string> = inlineCode(
          readPage(FEED_PAGE, language),
        );

        for (const eventType of [
          AlertFeedEventType.LinkedToIncident,
          AlertFeedEventType.UnlinkedFromIncident,
        ]) {
          expect({
            language: language,
            eventType: eventType,
            documented: documented.has(eventType),
          }).toEqual({
            language: language,
            eventType: eventType,
            documented: true,
          });
        }
      }
    });
  });

  describe("declaring from the alert header and acknowledging the alerts", () => {
    it("keeps the English heading sequence, level for level, in the Linked Alerts translation", () => {
      const levels: (markdown: string) => Array<number> = (
        markdown: string,
      ): Array<number> => {
        return proseHeadings(markdown).map((heading: ProseHeading): number => {
          return heading.level;
        });
      };

      for (const language of TRANSLATED_LANGUAGES) {
        expect({
          language: language,
          levels: levels(readPage(LINKED_ALERTS_PAGE, language)),
        }).toEqual({
          language: language,
          levels: levels(readPage(LINKED_ALERTS_PAGE)),
        });
      }
    });

    it("puts acknowledging under declaring from alerts, right before declaring through the API", () => {
      const declaring: number = englishHeadingIndex(
        2,
        DECLARING_FROM_ALERTS_HEADING,
      );
      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );
      const api: number = englishHeadingIndex(3, DECLARING_THROUGH_API_HEADING);

      expect(acknowledging).toBeGreaterThan(declaring);
      expect(api).toBe(acknowledging + 1);

      // No other H2 in between: it is part of the declaring section.
      expect(
        proseHeadings(readPage(LINKED_ALERTS_PAGE))
          .slice(declaring + 1, acknowledging)
          .every((heading: ProseHeading): boolean => {
            return heading.level === 3;
          }),
      ).toBe(true);
    });

    it("documents the alert header as one of three ways to declare, next to the header's state buttons, in every language", () => {
      const header: string = readSource(ALERT_CHANGE_STATE_FILE);
      const action: string = readSource(DECLARE_FROM_ALERT_FILE);

      // The header's buttons, as the dashboard labels them.
      expect(header).toMatch(
        /getDeclareIncidentFromAlertAction\(\s*props\.alertId,?\s*\)/,
      );
      expect(action).toMatch(/label:\s*DECLARE_INCIDENT_ACTION_TITLE,/);
      expect(readSource(BULK_LINK_ACTIONS_FILE)).toContain(
        'DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident"',
      );

      const stateButtons: Array<string> = Array.from(
        sourceBetween(
          header,
          "const getActions:",
          "const durationStartsAt:",
        ).matchAll(/label:\s*"([^"]+)"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(Array.from(new Set<string>(stateButtons)).sort()).toEqual([
        "Acknowledge",
        "Resolve",
      ]);

      const declaring: number = englishHeadingIndex(
        2,
        DECLARING_FROM_ALERTS_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const section: Array<string> = sectionLines(markdown, declaring);
        const tableAt: number = section.findIndex((line: string): boolean => {
          return line.startsWith("|");
        });
        const waysIn: Array<string> = section
          .slice(0, tableAt)
          .filter((line: string): boolean => {
            return line.startsWith("- ");
          });

        const headerWays: Array<string> = waysIn.filter(
          (line: string): boolean => {
            return stateButtons.every((label: string): boolean => {
              return line.includes(`**${label}**`);
            });
          },
        );

        expect({
          language: language,
          introduced: section
            .join("\n")
            .includes(THREE_WAYS_IN[language] as string),
          stale: markdown.includes(TWO_WAYS_IN[language] as string),
          waysIn: waysIn.length,
          allDeclare: waysIn.every((line: string): boolean => {
            return line.includes("**Declare Incident**");
          }),
          headerWays: headerWays.length,
          linkedIncidentsWays: waysIn.filter((line: string): boolean => {
            return line.includes("**Linked Incidents**");
          }).length,
        }).toEqual({
          language: language,
          introduced: true,
          stale: false,
          waysIn: 3,
          allDeclare: true,
          headerWays: 1,
          linkedIncidentsWays: 1,
        });
      }
    });

    it("sends acknowledgeAlertsToLink under the miscDataProps key the server reads, in a valid example, in every language", () => {
      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const miscDataProps: { [key: string]: unknown } =
          declareExampleBody(markdown).miscDataProps || {};

        expect({
          language: language,
          alertIds: Array.isArray(
            miscDataProps[INCIDENT_ALERT_IDS_TO_LINK_KEY],
          ),
          acknowledge: miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY],
          keys: Object.keys(miscDataProps).sort(),
          named: inlineCode(markdown).has(
            INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
          ),
        }).toEqual({
          language: language,
          alertIds: true,
          acknowledge: true,
          keys: [
            INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
            INCIDENT_ALERT_IDS_TO_LINK_KEY,
          ].sort(),
          named: true,
        });
      }
    });

    it("lists each case the server refuses acknowledgeAlertsToLink for, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);
      const validate: string = sourceBetween(
        service,
        "public async validateAcknowledgeAlertsForNewIncident(",
        "public async acknowledgeAlertsDeclaredWithIncident(",
      );

      // The four refusals the page lists, in the order the server makes them.
      const refusals: Array<RegExp> = [
        /\$\{INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY\} must be true or false\./,
        /\$\{INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY\} only applies when the incident is declared from alerts: send the alert ids in \$\{INCIDENT_ALERT_IDS_TO_LINK_KEY\}\./,
        /This project has no Acknowledged alert state/,
        /You do not have permission to acknowledge one or more of these alerts\./,
      ];
      const positions: Array<number> = refusals.map(
        (refusal: RegExp): number => {
          return validate.search(refusal);
        },
      );

      expect(
        positions.every((position: number): boolean => {
          return position >= 0;
        }),
      ).toBe(true);
      expect(
        [...positions].sort((a: number, b: number): number => {
          return a - b;
        }),
      ).toEqual(positions);

      const permissionNames: Array<string> = [
        `**${PermissionHelper.getTitle(Permission.CreateAlertStateTimeline)}**`,
        `**${PermissionHelper.getTitle(Permission.EditAlert)}**`,
      ];

      for (const language of ALL_LANGUAGES) {
        const prose: Array<string> = splitMarkdown(
          readPage(LINKED_ALERTS_PAGE, language),
        ).prose;
        const paragraphAt: number = prose.findIndex((line: string): boolean => {
          return line.startsWith(
            `\`${INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY}\``,
          );
        });
        const after: Array<string> = prose.slice(paragraphAt + 1);
        const firstBullet: number = after.findIndex((line: string): boolean => {
          return line.startsWith("- ");
        });
        const cases: Array<string> = [];

        for (const line of after.slice(firstBullet)) {
          if (!line.startsWith("- ")) {
            break;
          }

          cases.push(line);
        }

        expect({
          language: language,
          paragraphFound: paragraphAt >= 0,
          // Straight after the paragraph, past one blank line.
          listFollows: firstBullet === 1,
          cases: cases.length,
          notBoolean:
            cases[0]?.includes("`true`") === true &&
            cases[0]?.includes("`false`") === true,
          withoutAlertIds:
            cases[1]?.includes(`\`${INCIDENT_ALERT_IDS_TO_LINK_KEY}\``) ===
            true,
          noAcknowledgedState: cases[2]?.includes("Acknowledged") === true,
          noPermission: permissionNames.every((name: string): boolean => {
            return cases[3]?.includes(name) === true;
          }),
        }).toEqual({
          language: language,
          paragraphFound: true,
          listFollows: true,
          cases: refusals.length,
          notBoolean: true,
          withoutAlertIds: true,
          noAcknowledgedState: true,
          noPermission: true,
        });
      }
    });

    it("quotes the acknowledge box's label as the create page builds it, and says it starts ticked, in every language", () => {
      const labels: Array<string> = stringLiterals(
        sourceBetween(
          readSource(ACKNOWLEDGE_ON_DECLARE_FILE),
          "export const getAcknowledgeAlertsTitle:",
          "export const getAcknowledgeAlertsDescription:",
        ),
      );

      // One alert / several, each "every alert" or "only those not acknowledged yet".
      expect(labels).toHaveLength(4);

      const oneAlert: string = labels[0] as string;
      const severalAlerts: string = (labels[2] as string).replace(
        "${count}",
        EXAMPLE_ALERT_COUNT.toString(),
      );

      expect(oneAlert).toBe("Acknowledge this alert to stop its escalation");
      expect(severalAlerts).toBe(
        `Acknowledge these ${EXAMPLE_ALERT_COUNT} alerts to stop their escalation`,
      );

      // The page shows that box, with that label, ticked until the user unticks it.
      const createPage: string = readSource(CREATE_INCIDENT_PAGE_FILE);

      expect(createPage).toMatch(
        /\[shouldAcknowledgeAlerts, setShouldAcknowledgeAlerts\]\s*=\s*useState<boolean>\(true\);/,
      );
      expect(createPage).toMatch(
        /dataTestId="incident-create-acknowledge-alerts-checkbox"\s*title=\{getAcknowledgeAlertsTitle\(/,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const section: string = sectionLines(
          markdown,
          englishHeadingIndex(3, ACKNOWLEDGING_HEADING),
        ).join("\n");

        expect({
          language: language,
          oneAlert: section.includes(`**${oneAlert}**`),
          severalAlerts: section.includes(`**${severalAlerts}**`),
          tickedByDefault: section.includes(
            TICKED_BY_DEFAULT[language] as string,
          ),
        }).toEqual({
          language: language,
          oneAlert: true,
          severalAlerts: true,
          tickedByDefault: true,
        });
      }
    });

    it("quotes the notes the create page shows about alerts that keep or stop paging, in every language", () => {
      const source: string = readSource(ACKNOWLEDGE_ON_DECLARE_FILE);
      const keepEscalating: string = stringLiterals(
        sourceBetween(
          source,
          "export const getAlertsKeepEscalatingNote:",
          "export const ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE:",
        ),
      )[0] as string;
      const noOnCall: string = stringLiterals(
        source.slice(
          source.indexOf("export const ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE:"),
        ),
      )[0] as string;

      expect(keepEscalating).toBe(
        "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged.",
      );
      /*
       * Claims only what acknowledging does: the alerts' own escalation
       * stops, an alert episode keeps paging, an incident on-call rule may.
       */
      expect(noOnCall).toBe(
        "The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page.",
      );

      // Both are on the create page: the note under the box, the other on the On-Call step.
      const createPage: string = readSource(CREATE_INCIDENT_PAGE_FILE);

      expect(createPage).toContain("getAlertsKeepEscalatingNote(");
      expect(createPage).toContain("${ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE}");

      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const section: string = sectionLines(markdown, acknowledging).join(
          "\n",
        );

        expect({
          language: language,
          keepEscalating: section.includes(keepEscalating),
          noOnCall: section.includes(noOnCall),
          // The note it replaced promised the alerts stop paging altogether.
          stale: markdown.includes("so they stop paging"),
        }).toEqual({
          language: language,
          keepEscalating: true,
          noOnCall: true,
          stale: false,
        });
      }
    });

    it("quotes the cause an acknowledged alert records, never naming a private incident, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);
      const causes: string = sourceBetween(
        service,
        "export function getDeclaredAlertAcknowledgementCause(",
        "\n}\n",
      );
      const privateCause: string = stringLiterals(
        sourceBetween(causes, "if (data.isIncidentPrivate) {", "}"),
      )[0] as string;
      const publicTemplate: string =
        stringLiterals(causes).find((literal: string): boolean => {
          return literal.includes("${withNumber(");
        }) || "";

      // "Incident INC-42": the label, a space and the number.
      expect(service).toMatch(
        /function withNumber\(label: string, number: string\): string \{\s*return number \? `\$\{label\} \$\{number\}` : label;\s*\}/,
      );
      expect(publicTemplate).toContain(
        '${withNumber("Incident", data.incidentNumber)}',
      );

      const publicCause: string = publicTemplate.replace(
        '${withNumber("Incident", data.incidentNumber)}',
        `Incident ${EXAMPLE_INCIDENT_NUMBER}`,
      );

      expect(publicCause).toBe(
        `Acknowledged because Incident ${EXAMPLE_INCIDENT_NUMBER} was declared from this alert.`,
      );
      expect(privateCause).toBe(
        "Acknowledged because a private incident was declared from this alert.",
      );

      for (const language of ALL_LANGUAGES) {
        const section: string = sectionLines(
          readPage(LINKED_ALERTS_PAGE, language),
          englishHeadingIndex(3, ACKNOWLEDGING_HEADING),
        ).join("\n");

        expect({
          language: language,
          publicCause: section.includes(publicCause),
          privateCause: section.includes(privateCause),
        }).toEqual({
          language: language,
          publicCause: true,
          privateCause: true,
        });
      }
    });

    it("names the permissions acknowledging takes, and exactly the roles that have them and that do not, in every language", () => {
      const timelineCreators: Array<Permission> =
        new AlertStateTimeline().getCreatePermissions();
      const alertEditors: Array<Permission> =
        new Alert().getUpdatePermissions();

      // The granular permissions the docs name are the ones the two models grant.
      expect(timelineCreators).toContain(Permission.CreateAlertStateTimeline);
      expect(alertEditors).toContain(Permission.EditAlert);

      // The dashboard gates the box on the same two models, in that order.
      expect(readSource(ACKNOWLEDGE_ON_DECLARE_FILE)).toMatch(
        /new AlertStateTimeline\(\),\s*ModelAction\.Create,[\s\S]*new Alert\(\),\s*ModelAction\.Update,/,
      );

      const acknowledgers: Array<string> = roleTitlesOf(
        timelineCreators.filter((permission: Permission): boolean => {
          return alertEditors.includes(permission);
        }),
      );
      const linkers: Array<string> = roleTitlesOf(
        new IncidentAlert().getCreatePermissions(),
      );
      const declareButCannotAcknowledge: Array<string> = linkers.filter(
        (role: string): boolean => {
          return !acknowledgers.includes(role);
        },
      );

      // While some roles can declare but not acknowledge, the page has to say which.
      expect(acknowledgers.length).toBeGreaterThan(0);
      expect(declareButCannotAcknowledge.length).toBeGreaterThan(0);

      const permissionNames: Array<string> = [
        `**${PermissionHelper.getTitle(Permission.CreateAlertStateTimeline)}**`,
        `**${PermissionHelper.getTitle(Permission.EditAlert)}**`,
      ];
      const candidates: Array<string> = Array.from(
        new Set<string>([...acknowledgers, ...linkers]),
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const roleLines: Array<string> = splitMarkdown(markdown).prose.filter(
          (line: string): boolean => {
            return (
              permissionNames.every((name: string): boolean => {
                return line.includes(name);
              }) && permissionTitlesIn(line, candidates).length > 0
            );
          },
        );

        expect({
          language: language,
          roleLines: roleLines.length,
          roles: permissionTitlesIn(roleLines[0] || "", candidates),
          inAcknowledgingSection: sectionLines(
            markdown,
            englishHeadingIndex(3, ACKNOWLEDGING_HEADING),
          ).includes(roleLines[0] || ""),
        }).toEqual({
          language: language,
          roleLines: 1,
          roles: [...acknowledgers, ...declareButCannotAcknowledge].sort(),
          inAcknowledgingSection: true,
        });

        // The permissions section and the API section name them too.
        expect({
          language: language,
          mentions: splitMarkdown(markdown).prose.filter(
            (line: string): boolean => {
              return permissionNames.every((name: string): boolean => {
                return line.includes(name);
              });
            },
          ).length,
        }).toEqual({ language: language, mentions: 3 });
      }

      expect(readPage(LINKED_ALERTS_PAGE)).toContain(
        `${declareButCannotAcknowledge.join(" and ")}, who can declare incidents from alerts, have neither.`,
      );
    });

    it("spells out what acknowledging stops and what it does not, in every language", () => {
      const reminderRule: AlertReminderRule = new AlertReminderRule();
      const stopWhen: string =
        reminderRule.getTableColumnMetadata("stopRemindersOnState").title || "";

      // Reminders stop on acknowledgement only when the rule says so; by default they run until resolved.
      expect(stopWhen).toBe("Stop Reminders When");
      expect(
        reminderRule.getTableColumnMetadata("stopRemindersOnState")
          .defaultValue,
      ).toBe(ReminderStopState.Resolved);

      for (const language of ALL_LANGUAGES) {
        const section: string = sectionLines(
          readPage(LINKED_ALERTS_PAGE, language),
          englishHeadingIndex(3, ACKNOWLEDGING_HEADING),
        ).join("\n");

        expect({
          language: language,
          reminders:
            section.includes(`**${stopWhen}**`) &&
            section.includes(`**${ReminderStopState.Acknowledged}**`),
          notRecalled: section.includes(NOT_RECALLED[language] as string),
          episode: section.includes(EPISODE_WORD[language] as string),
          onCallStep: section.includes("**On-Call**"),
        }).toEqual({
          language: language,
          reminders: true,
          notRecalled: true,
          episode: true,
          onCallStep: true,
        });
      }
    });

    it("points at the acknowledge option wherever it says linking leaves alert states alone, in every language", () => {
      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const anchor: string = slugify(
          (proseHeadings(markdown)[acknowledging] as ProseHeading).text,
        );

        for (const sentence of LINKING_LEAVES_STATES_ALONE[
          language
        ] as Array<string>) {
          const line: string =
            markdown.split("\n").find((candidate: string): boolean => {
              return candidate.includes(sentence);
            }) || "";

          expect({
            language: language,
            sentence: sentence,
            found: line.length > 0,
            pointsAtAcknowledging: inPageLinks(line).includes(anchor),
          }).toEqual({
            language: language,
            sentence: sentence,
            found: true,
            pointsAtAcknowledging: true,
          });
        }
      }
    });

    it("quotes each already-linked note as the create page chooses it, and says the incident links open in a new tab, in every language", () => {
      const createPage: string = readSource(CREATE_INCIDENT_PAGE_FILE);
      const chooser: string = sourceBetween(
        createPage,
        "const getAlreadyLinkedNote: GetAlreadyLinkedNoteFunction",
        "type GetIncidentReferenceFunction",
      );

      // In branch order: every alert linked (one alert, then several), then only some.
      const notes: Array<string> = stringLiterals(chooser).filter(
        (literal: string): boolean => {
          return literal.length > 0;
        },
      );

      expect(notes).toEqual([
        "This alert is already linked to an incident. If it is the same problem, update that incident instead of declaring another one.",
        "These alerts are already linked to incidents. If it is the same problem, update that incident instead of declaring another one.",
        "Some of these alerts are already linked to an incident. If it is the same problem, link the other alerts to that incident from the alerts list instead of declaring another one.",
      ]);
      expect(chooser).toMatch(
        /if \(isEveryAlertLinked\) \{\s*return alerts\.length === 1\s*\?/,
      );
      expect(createPage).toMatch(
        /\{getAlreadyLinkedNote\(\s*alertsToLink,\s*incidentsLinkedToAlerts,?\s*\)\}/,
      );

      // "(already linked to Incident INC-42)": the page's wording around each incident reference.
      expect(createPage).toMatch(/\(already linked to\{" "\}/);
      expect(createPage).toContain(
        "return `Incident ${incident.incidentNumberWithPrefix}`;",
      );

      // Each reference is a Link that opens in a new tab, which Link renders as target="_blank".
      expect(
        sourceBetween(
          createPage,
          'data-testid="incident-create-alert-already-linked"',
          "</Link>",
        ),
      ).toMatch(
        /<Link\s+className="font-medium underline"\s+openInNewTab=\{true\}/,
      );
      expect(readSource(LINK_COMPONENT_FILE)).toMatch(
        /if \(props\.openInNewTab\) \{\s*linkProps\["target"\] = "_blank";\s*\}/,
      );

      const marker: string = `(already linked to Incident ${EXAMPLE_INCIDENT_NUMBER})`;
      const declaring: number = englishHeadingIndex(
        2,
        DECLARING_FROM_ALERTS_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const section: Array<string> = sectionLines(markdown, declaring);
        // One list item per note, in the chooser's order.
        const noteItems: Array<number> = notes.map((note: string): number => {
          return section.findIndex((line: string): boolean => {
            return line.startsWith("- ") && line.includes(note);
          });
        });

        expect({
          language: language,
          marker: section.join("\n").includes(marker),
          notesListed: noteItems.every((at: number): boolean => {
            return at >= 0;
          }),
          inOrder: [...noteItems].sort((a: number, b: number): number => {
            return a - b;
          }),
          newTab: section
            .join("\n")
            .includes(OPENS_IN_NEW_TAB[language] as string),
          staleAdvice: markdown.includes(RELINK_ADVICE[language] as string),
        }).toEqual({
          language: language,
          marker: true,
          notesListed: true,
          inOrder: noteItems,
          newTab: true,
          staleAdvice: false,
        });
      }
    });

    it("says only the alerts not acknowledged yet need permission, and the others never block the declaration, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);
      const validate: string = sourceBetween(
        service,
        "public async validateAcknowledgeAlertsForNewIncident(",
        "public async acknowledgeAlertsDeclaredWithIncident(",
      );

      // The server keeps the alerts before Acknowledged (by order), and checks only those.
      expect(validate).toMatch(
        /return order === undefined \|\| order < acknowledgedOrder;/,
      );
      expect(validate).toMatch(
        /if \(\s*alertIdsToAcknowledge\.length > 0 &&\s*!data\.props\.isRoot &&\s*!data\.props\.isMasterAdmin\s*\)/,
      );
      expect(validate).toMatch(
        /assertCanChangeStateOfAlerts\(\{\s*projectId: projectId,\s*alertIds: alertIdsToAcknowledge,/,
      );
      expect(validate).not.toMatch(/alertIds: data\.alertIds,\s*props:/);
      // And only those are ever written.
      expect(readSource(INCIDENT_SERVICE_FILE)).toMatch(
        /acknowledgeAlertsDeclaredWithIncident\(\{\s*projectId: projectId,\s*incidentId: incidentId,\s*alertIds: alertIdsToAcknowledge,/,
      );

      const permissionNames: Array<string> = [
        `**${PermissionHelper.getTitle(Permission.CreateAlertStateTimeline)}**`,
        `**${PermissionHelper.getTitle(Permission.EditAlert)}**`,
      ];
      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const prose: Array<string> = splitMarkdown(markdown).prose;
        // The acknowledging section, the permissions section and the API refusals.
        const permissionLines: Array<string> = prose.filter(
          (line: string): boolean => {
            return permissionNames.every((name: string): boolean => {
              return line.includes(name);
            });
          },
        );
        const acknowledgingSection: Array<string> = sectionLines(
          markdown,
          acknowledging,
        );

        expect({
          language: language,
          permissionLines: permissionLines.length,
          eachSaysNotYet: permissionLines.every((line: string): boolean => {
            return line.includes(NOT_ACKNOWLEDGED_YET[language] as string);
          }),
          neverBlock: permissionLines.some((line: string): boolean => {
            return (
              acknowledgingSection.includes(line) &&
              line.includes(
                ALREADY_ACKNOWLEDGED_NEED_NO_PERMISSION[language] as string,
              )
            );
          }),
          staleEveryAlert: (
            EVERY_ALERT_CHECKED[language] as ReadonlyArray<string>
          ).filter((phrase: string): boolean => {
            return markdown.includes(phrase);
          }),
        }).toEqual({
          language: language,
          permissionLines: 3,
          eachSaysNotYet: true,
          neverBlock: true,
          staleEveryAlert: [],
        });
      }
    });

    it("says the linked-alert switches, not you, move alerts the incident is declared past, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);

      // The acknowledgement leaves to the switches the linked alerts they will move...
      expect(
        sourceBetween(
          service,
          "public async acknowledgeAlertsDeclaredWithIncident(",
          "private async getLinkedAlertsTheSyncWillMove(",
        ),
      ).toMatch(
        /if \(ownedBySync\.has\(key\)\) \{\s*result\.leftToLinkedAlertSyncAlertIds\.push\(alertId\);\s*continue;\s*\}/,
      );

      // ...which write them credited to nobody, telling no owner, naming the incident by number.
      const switchWrite: string = sourceBetween(
        service,
        "private async applyLinkedAlertStatePlan(",
        "\n  }\n",
      );

      expect(switchWrite).toMatch(
        /await AlertService\.changeAlertState\(\{[^}]*notifyOwners: false,/,
      );
      expect(switchWrite).not.toContain("createdByUserId");
      expect(switchWrite).not.toContain("isPrivate");
      expect(switchWrite).toContain(
        'const incidentLabel: string = withNumber("Incident", data.incidentNumber);',
      );
      expect(switchWrite).toMatch(
        /`Acknowledged because linked \$\{incidentLabel\} was \$\{\s*plan\.incidentReachedResolved \? "resolved" : "acknowledged"\s*\}\.`/,
      );

      // The API contract states the same exception.
      expect(readSource(INCIDENT_ALERT_LINK_TYPES_FILE)).toContain(
        "not credited to the declaring user.",
      );

      const switchCause: string = `Acknowledged because linked Incident ${EXAMPLE_INCIDENT_NUMBER} was acknowledged.`;
      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );
      const switches: number = englishHeadingIndex(
        2,
        LINKED_ALERT_SWITCHES_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const markdown: string = readPage(LINKED_ALERTS_PAGE, language);
        const switchesAnchor: string = slugify(
          (proseHeadings(markdown)[switches] as ProseHeading).text,
        );
        const exception: Array<string> = sectionLines(
          markdown,
          acknowledging,
        ).filter((line: string): boolean => {
          return line.includes(switchCause);
        });

        expect({
          language: language,
          lines: exception.length,
          pointsAtSwitches: inPageLinks(exception[0] || "").includes(
            switchesAnchor,
          ),
          notCredited: (exception[0] || "").includes(
            NOT_CREDITED_TO_YOU[language] as string,
          ),
          ownersNotNotified: (exception[0] || "").includes(
            OWNERS_NOT_NOTIFIED[language] as string,
          ),
          privateNumber: (exception[0] || "").includes(
            NAMES_PRIVATE_INCIDENT_NUMBER[language] as string,
          ),
        }).toEqual({
          language: language,
          lines: 1,
          pointsAtSwitches: true,
          notCredited: true,
          ownersNotNotified: true,
          privateNumber: true,
        });
      }
    });

    it("says the alerts are acknowledged in the background a few at a time, as many at once as the server writes, in every language", () => {
      const service: string = readSource(INCIDENT_ALERT_SERVICE_FILE);
      const atOnce: number = Number(
        service.match(
          /const DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY: number = (\d+);/,
        )?.[1],
      );

      // A few: more than one at a time, fewer than a full selection.
      expect(atOnce).toBeGreaterThan(1);
      expect(atOnce).toBeLessThan(MAX_ALERTS_PER_INCIDENT_LINK_ACTION);

      // Each batch is written together, and the next waits for it.
      expect(
        sourceBetween(
          service,
          "public async acknowledgeAlertsDeclaredWithIncident(",
          "private async getLinkedAlertsTheSyncWillMove(",
        ),
      ).toMatch(
        /const batch: Array<ObjectID> = alertIdsToWrite\.slice\(\s*index,\s*index \+ DECLARED_ALERT_ACKNOWLEDGE_CONCURRENCY,?\s*\);\s*const outcomes: Array<string \| null> = await Promise\.all\(/,
      );

      // In the background: the declaration does not wait for it.
      const incidentService: string = readSource(INCIDENT_SERVICE_FILE);

      expect(incidentService).toMatch(
        /\n\s*IncidentAlertService\.acknowledgeAlertsDeclaredWithIncident\(\{/,
      );
      expect(incidentService).not.toMatch(
        /await\s+IncidentAlertService\.acknowledgeAlertsDeclaredWithIncident/,
      );

      const acknowledging: number = englishHeadingIndex(
        3,
        ACKNOWLEDGING_HEADING,
      );

      for (const language of ALL_LANGUAGES) {
        const section: string = sectionLines(
          readPage(LINKED_ALERTS_PAGE, language),
          acknowledging,
        ).join("\n");

        expect({
          language: language,
          aFewAtATime: section.includes(
            (A_FEW_AT_A_TIME[language] as (atOnce: number) => string)(atOnce),
          ),
        }).toEqual({ language: language, aFewAtATime: true });
      }
    });

    it("tells the overview and declaring pages about the header and the acknowledge box, in every language", () => {
      const acknowledgeWords: Record<string, string> = {
        en: "acknowledge",
        fa: "تصدیق",
      };
      const headerWords: Record<string, string> = {
        en: "header",
        fa: "سرصفحه",
      };

      for (const language of ALL_LANGUAGES) {
        for (const page of [OVERVIEW_PAGE, DECLARING_PAGE]) {
          const lines: Array<string> = splitMarkdown(
            readPage(page, language),
          ).prose.filter((line: string): boolean => {
            return (
              line.includes("**Declare Incident**") &&
              docsLinks(line).has(LINKED_ALERTS_URL)
            );
          });

          expect({
            language: language,
            page: page,
            lines: lines.length,
            header: lines.some((line: string): boolean => {
              return line.includes(headerWords[language] as string);
            }),
            acknowledge: lines.some((line: string): boolean => {
              return line.includes(acknowledgeWords[language] as string);
            }),
          }).toEqual({
            language: language,
            page: page,
            lines: 1,
            header: true,
            acknowledge: true,
          });
        }
      }
    });
  });
});
