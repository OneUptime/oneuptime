import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  CREATING_EVENTS,
  MAINTENANCE_NUMBER_PREFIX,
  MAINTENANCE_OVERVIEW,
  MAINTENANCE_STATES,
  ROLE_NAMES,
  RULES_AND_SETTINGS,
  SCHEDULED_MAINTENANCE_NAV_GROUP,
  SCHEDULED_MAINTENANCE_NAV_GROUP_AFTER,
  SCHEDULED_MAINTENANCE_NAV_SECTION,
  SCHEDULED_MAINTENANCE_PAGES,
  SERVER_TEXT,
  ScheduledMaintenanceDocsPageEntry,
  TEMPLATES_AND_RECURRING,
  WORKFLOW_COMPONENTS,
} from "./ScheduledMaintenanceDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  developerSection,
  menuSections,
  readCommonSource,
  readDashboardSource,
  routeGroup,
  sectionByTitle,
  startsCollapsed,
  workspaceSection,
} from "./DocsDashboardMenus";
import { boldPaths, detailsBody, tables } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  STATE_SETTINGS_COPY,
  StateSettingsSharedCopy,
} from "../../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import { getEventStateMenuStates } from "../../../FeatureSet/Dashboard/src/Components/EventView/EventStateMenu";
import {
  SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS,
  SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS,
  ScheduledMaintenancePhase,
  ScheduledMaintenanceStateKind,
  ScheduledMaintenanceTiming,
  getScheduledMaintenanceTiming,
  shouldRecheckScheduledMaintenanceState,
} from "../../../FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming";
import {
  CREATE_FROM_RECORD_KINDS,
  CreateFromRecordKind,
  CreateFromRecordKindDefinition,
  CreatedRecordKind,
} from "../../../FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import { getTemplateNextEventAt } from "../../../FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTemplateSchedule";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceLabelRule from "Common/Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceMeasurement from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerRule from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseModelComponent from "Common/Types/Workflow/Components/BaseModel";
import ComponentMetadata from "Common/Types/Workflow/Component";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import NumberPrefixUtil, {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumnInfo,
} from "Common/Utils/Project/NumberPrefix";
import StateMoveUtil, { StateMoveRecord } from "Common/Utils/StateMove";
import {
  STATE_LISTS,
  StateListRow,
  StateListType,
  getStateListInsertValue,
  toStateListRow,
} from "Common/Utils/StateOrder";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";
import {
  DEFAULT_MAINTENANCE_DURATION_IN_MINUTES,
  MaintenanceWindow,
  getDefaultMaintenanceWindow,
  getMaintenanceEndAfterStartMoved,
} from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import {
  MeasurementDomain,
  MeasurementPreset,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";
import EventInterval from "Common/Types/Events/EventInterval";
import ScheduledMaintenanceReminderStopState from "Common/Types/Reminder/ScheduledMaintenanceReminderStopState";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateRowDeleteEffect,
  StateTimelineRecord,
  decideStateRowDelete,
} from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 35: the Scheduled Maintenance group - the overview,
 * creating events, states, templates and recurring events, and rules and
 * settings - names a great deal of the product: the Scheduled Maintenance
 * menu and an event's own menu, the list and its bulk actions, the create
 * form and its defaults, what happens when an event is created, the seeded
 * states and how an event moves through them, the header's buttons and
 * clock, the refusals of a move up the list, the template form and the
 * recurring schedule, the rules a new event passes through, the reminder
 * rules, note templates, custom fields, measurements, number prefixes,
 * workflows, roles and plans. Markdown is not compiled, so nothing else
 * notices when the product moves on.
 *
 * These hold those facts to the source: Common's models and rules imported,
 * the Dashboard's React-free modules imported and its pages read as text,
 * the server's services and the workers read as text (an App test must not
 * import the Dashboard's React components, nor any package but App and
 * Common). A renamed menu entry, column, field, default, state or limit
 * fails here until the English pages follow - and ScheduledMaintenanceDocs-
 * Translations then carries the change into every language.
 */

function english(page: string): string {
  return readPage("en", page);
}

// A file of any package, as text.
function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

// A file of the workers, as text.
function readWorkerSource(relative: string): string {
  return readPackageFile(path.join("App/FeatureSet/Workers/Jobs", relative));
}

const BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;
const HEADING_LEVEL: RegExp = /^(#+) /;
const QUOTED_TITLE: RegExp = /title:\s*"([^"]*)"/g;
// A form field's description, written as one string.
const FIELD_DESCRIPTION: RegExp = /description:\s*"([^"]*)"/;

// Every **bold** name in a piece of markdown, in order.
function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The text of the section under `heading` ("## X"), up to the next heading of
 * its level or above. A heading the page lacks fails, naming it.
 */
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(HEADING_LEVEL)?.[1] || "#").length;
  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(new RegExp(`\\n#{1,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The body rows of the first table in a piece of markdown.
function tableRows(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("|");
  });

  if (start < 0) {
    return [];
  }

  const rows: Array<string> = [];

  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(line);
  }

  return rows.slice(2);
}

// The first cell of each body row of the first table in a piece of markdown.
function firstColumn(markdown: string): Array<string> {
  return tableRows(markdown).map((row: string): string => {
    return tableCells(row)[0] || "";
  });
}

/*
 * A table of a menu's sections: its rows as sections, each the bold names of
 * its second cell before any ": " that says what they are for.
 */
function menuTable(markdown: string): Array<MenuSection> {
  return tableRows(markdown).map((row: string): MenuSection => {
    const cells: Array<string> = tableCells(row);
    const pages: string = (cells[1] || "").split(": ")[0] || "";

    return {
      title: boldNames(cells[0] || "")[0] || "",
      items: boldNames(pages),
    };
  });
}

function navGroup(title: string): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === title;
    },
  );

  expect({ group: title, found: Boolean(group) }).toEqual({
    group: title,
    found: true,
  });

  return group as NavGroup;
}

// "**A**, **B** and **C**": the names a sentence lists, as the pages write them.
function listed(names: Array<string>, conjunction: string = "and"): string {
  const bold: Array<string> = names.map((name: string): string => {
    return `**${name}**`;
  });

  if (bold.length < 2) {
    return bold.join("");
  }

  return `${bold.slice(0, -1).join(", ")} ${conjunction} ${bold[bold.length - 1]}`;
}

// The quoted titles in a piece of source, in order, without the empty ones.
function quotedTitles(source: string): Array<string> {
  return Array.from(source.matchAll(QUOTED_TITLE))
    .map((match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    })
    .filter((title: string): boolean => {
      return title.length > 0;
    });
}

// The titles of a list of permissions, as a custom role's picker shows them.
function permissionTitles(permissions: Array<Permission>): Array<string> {
  return permissions.map((permission: Permission): string => {
    return PermissionHelper.getTitle(permission);
  });
}

// The role names among a model's permissions, the custom permissions left out.
function rolesOf(permissions: Array<Permission>): Array<string> {
  return permissionTitles(
    permissions.filter((permission: Permission): boolean => {
      return PermissionHelper.getAllPermissionProps().some(
        (props: { permission: Permission; isRolePermission?: boolean }) => {
          return props.permission === permission && props.isRolePermission;
        },
      );
    }),
  );
}

/*
 * The source of the object a field is declared in on a form, from its title:
 * the text between the `{` that opens it and the `}` that closes it, found by
 * brace depth around `title: "<title>"`.
 */
function fieldObject(source: string, title: string): string {
  const at: number = source.search(
    new RegExp(`title:\\s*"${escapeRegExp(title)} ?"`),
  );

  expect({ field: title, found: at >= 0 }).toEqual({
    field: title,
    found: true,
  });

  let start: number = at;
  let depth: number = 0;

  while (start > 0) {
    const character: string = source[start] as string;

    if (character === "}") {
      depth++;
    }

    if (character === "{") {
      if (depth === 0) {
        break;
      }

      depth--;
    }

    start--;
  }

  let end: number = at;
  depth = 0;

  while (end < source.length) {
    const character: string = source[end] as string;

    if (character === "{") {
      depth++;
    }

    if (character === "}") {
      if (depth === 0) {
        break;
      }

      depth--;
    }

    end++;
  }

  return source.slice(start, end + 1);
}

// The step id a field object names.
function stepOf(fieldSource: string): string {
  return fieldSource.match(/stepId:\s*"([^"]+)"/)?.[1] || "";
}

// ---- The menus ----------------------------------------------------------------

// The Scheduled Maintenance menu, from where it lists its sections.
const MAINTENANCE_MENU_FILE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
);
const MAINTENANCE_MENU_SOURCE: string = MAINTENANCE_MENU_FILE.slice(
  MAINTENANCE_MENU_FILE.indexOf("const sections: SideMenuSectionProps[]"),
);

// An event's own menu, from where the menu starts.
const EVENT_MENU_FILE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/View/SideMenu.tsx",
);
const EVENT_MENU_SOURCE: string = EVENT_MENU_FILE.slice(
  EVENT_MENU_FILE.indexOf("<SideMenu>"),
);

// The Scheduled Maintenance menu, with the sections it adds from elsewhere.
function maintenanceMenu(): Array<MenuSection> {
  return menuSections(MAINTENANCE_MENU_SOURCE, {
    "...(workspaceSection ?": workspaceSection(),
    "addDeveloperSideMenuSection(sections": developerSection(),
  });
}

// An event's menu, with the Developer section where the menu adds it.
function eventMenu(): Array<MenuSection> {
  return menuSections(EVENT_MENU_SOURCE, {
    "{getDeveloperSideMenuSection(": developerSection(),
  });
}

// The titles of a menu's sections that start open.
function openSections(menu: Array<MenuSection>, source: string): Array<string> {
  return menu
    .map((menuSection: MenuSection): string => {
      return menuSection.title;
    })
    .filter((title: string): boolean => {
      return !startsCollapsed(source, title);
    });
}

// ---- Shared sources -------------------------------------------------------------

const LIST_TABLE: string = readDashboardSource(
  "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
);
const CREATE_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Create.tsx",
);
const FORM_MODULE: string = readDashboardSource(
  "Components/ScheduledMaintenance/ScheduledMaintenanceForm.ts",
);
const EVENT_OVERVIEW_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
);
const STATE_TIMELINE_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/View/StateTimeline.tsx",
);
const CHANGE_STATE: string = readDashboardSource(
  "Components/ScheduledMaintenance/ChangeState.tsx",
);
const TEMPLATES_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
);
const TEMPLATE_VIEW_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx",
);
const REMINDER_RULES_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules.tsx",
);
const OWNER_RULES_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules.tsx",
);
const LABEL_RULES_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules.tsx",
);
const NOTE_TEMPLATES_PAGE: string = readDashboardSource(
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates.tsx",
);
const RULE_FORM: string = readDashboardSource("Utils/Form/ResourceRuleForm.ts");
const EVENT_SERVICE: string = readCommonSource(
  "Server/Services/ScheduledMaintenanceService.ts",
);
const TIMELINE_SERVICE: string = readCommonSource(
  "Server/Services/ScheduledMaintenanceStateTimelineService.ts",
);
const TEMPLATE_SERVICE: string = readCommonSource(
  "Server/Services/ScheduledMaintenanceTemplateService.ts",
);
const REMINDER_RULE_SERVICE: string = readCommonSource(
  "Server/Services/ScheduledMaintenanceReminderRuleService.ts",
);

// ---- The nav group ----------------------------------------------------------------

describe("the Scheduled Maintenance group in the docs", () => {
  it("sits in Incident Response right after Status Pages, and opens with the overview, page for page", () => {
    const group: NavGroup = navGroup(SCHEDULED_MAINTENANCE_NAV_GROUP);
    const titles: Array<string> = DocsNav.map((candidate: NavGroup): string => {
      return candidate.title;
    });

    expect(group.section).toBe(SCHEDULED_MAINTENANCE_NAV_SECTION);
    expect(navGroup(SCHEDULED_MAINTENANCE_NAV_GROUP_AFTER).section).toBe(
      SCHEDULED_MAINTENANCE_NAV_SECTION,
    );
    expect(titles.indexOf(SCHEDULED_MAINTENANCE_NAV_GROUP)).toBe(
      titles.indexOf(SCHEDULED_MAINTENANCE_NAV_GROUP_AFTER) + 1,
    );
    expect(
      group.links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      SCHEDULED_MAINTENANCE_PAGES.map(
        (entry: ScheduledMaintenanceDocsPageEntry): Array<string> => {
          return [`/docs/${entry.page}`, entry.navTitle];
        },
      ),
    );
    expect(group.links[0]?.url).toBe(`/docs/${MAINTENANCE_OVERVIEW}`);
  });

  it("titles the group as each language's Dashboard names the product, and every page in every docs language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const docsLocale: {
        navGroups: Record<string, string>;
        navLinks: Record<string, string>;
      } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );
      const dashboardLocale: {
        navbar: { items: Record<string, string> };
      } = JSON.parse(
        readPackageFile(
          `App/FeatureSet/Dashboard/src/Locales/${language}.json`,
        ),
      );

      expect({
        language,
        group: docsLocale.navGroups[SCHEDULED_MAINTENANCE_NAV_GROUP],
      }).toEqual({
        language,
        group: dashboardLocale.navbar.items["scheduledMaintenanceTitle"],
      });

      for (const entry of SCHEDULED_MAINTENANCE_PAGES) {
        expect({
          language,
          link: entry.navTitle,
          title: typeof docsLocale.navLinks[entry.navTitle],
        }).toEqual({ language, link: entry.navTitle, title: "string" });
      }
    }
  });

  it("opens the product from the Products menu, by the menu item the Dashboard draws", () => {
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");
    const item: string = navigation.slice(
      navigation.indexOf('t("navbar.items.scheduledMaintenanceTitle")') - 200,
      navigation.indexOf('t("navbar.items.scheduledMaintenanceTitle")') + 400,
    );

    expect(item).toContain("PageMap.SCHEDULED_MAINTENANCE_EVENTS");
    expect(english(MAINTENANCE_OVERVIEW)).toContain(
      "Open **Scheduled Maintenance** from the **Products** menu in the top bar.",
    );
    expect(english(RULES_AND_SETTINGS)).toContain(
      "Open **Scheduled Maintenance** from the **Products** menu in the top bar.",
    );
  });
});

// ---- The overview: where maintenance lives -------------------------------------

describe("the Scheduled Maintenance menu, as the overview draws it", () => {
  const overview: string = english(MAINTENANCE_OVERVIEW);
  const where: string = section(
    overview,
    "## Where maintenance lives in the dashboard",
  );

  it("has a row per section of the menu but Developer, with its pages, in the menu's order", () => {
    const menu: Array<MenuSection> = maintenanceMenu().filter(
      (menuSection: MenuSection): boolean => {
        return menuSection.title !== developerSection().title;
      },
    );

    expect(menuTable(where)).toEqual(menu);
    expect(
      maintenanceMenu().map((menuSection: MenuSection): string => {
        return menuSection.title;
      }),
    ).toEqual([
      "Overview",
      "Calendar",
      "Workspace",
      "Rules",
      "Settings",
      "Developer",
    ]);
  });

  it("says Overview and Calendar are open and the rest start folded, and what Developer holds", () => {
    const menu: Array<MenuSection> = maintenanceMenu();
    const open: Array<string> = openSections(menu, MAINTENANCE_MENU_SOURCE);
    const folded: Array<string> = menu
      .map((menuSection: MenuSection): string => {
        return menuSection.title;
      })
      .filter((title: string): boolean => {
        return !open.includes(title);
      });

    expect(open).toEqual(["Overview", "Calendar"]);
    expect(where).toContain(
      `${listed(open)} are open; ${listed(folded)} start folded, and a section opens by itself when you are on one of its pages.`,
    );
    expect(where).toContain(
      `**Developer** holds ${listed(developerSection().items)}, for managing maintenance from code.`,
    );
  });

  it("counts the events in progress on the Ongoing Events badge: ongoing, or in a state of the project's own between Ongoing and Ended", () => {
    expect(MAINTENANCE_MENU_FILE).toContain(
      "useInProgressScheduledMaintenanceStateIds()",
    );
    expect(MAINTENANCE_MENU_FILE).toContain(
      "currentScheduledMaintenanceStateId: new Includes(",
    );
    expect(
      readDashboardSource("Pages/ScheduledMaintenanceEvents/Ongoing.tsx"),
    ).toContain("useInProgressScheduledMaintenanceStateIds()");
    expect(where).toContain(
      "**All Events** and **Ongoing Events**, whose badge counts the events in progress right now.",
    );
  });

  it("lists the events at the address the overview gives", () => {
    const routeMap: string = readDashboardSource("Utils/RouteMap.ts");

    expect(routeMap).toContain(
      "[PageMap.SCHEDULED_MAINTENANCE_EVENTS]: new Route(\n    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events`,",
    );
    expect(where).toContain(
      "The list of events is at `/dashboard/{projectId}/scheduled-maintenance-events`",
    );
  });

  it("names the list's columns, in its order", () => {
    const columns: string = LIST_TABLE.slice(LIST_TABLE.indexOf("columns={["));
    const titles: Array<string> = quotedTitles(
      columns.slice(0, columns.indexOf("NoTemplatesYetModal")),
    );

    expect(titles).toEqual([
      "Scheduled Maintenance Number",
      "Title",
      "Current State",
      "Affected Resources",
      "Shown on Status Page",
      "Starts At",
      "Duration",
      "Ends At",
      "Labels",
      "Owners",
    ]);
    expect(where).toContain(`The list shows ${listed(titles)}.`);
  });

  it("names the bulk actions, in the order the list offers them", () => {
    const bulk: string = LIST_TABLE.slice(
      LIST_TABLE.indexOf("bulkActions={{"),
      LIST_TABLE.indexOf("isDeleteable={true}"),
    );
    const labelActions: Array<string> = quotedTitles(
      readCommonSource("UI/Components/BulkUpdate/BulkLabelActions.tsx"),
    ).filter((title: string): boolean => {
      return title.endsWith("Labels") && title !== "Select Labels";
    });
    // Once each: a row's Add Owner and its dialog are titled alike.
    const ownerActions: Array<string> = [
      ...new Set(
        quotedTitles(
          readCommonSource("UI/Components/BulkUpdate/BulkOwnerActions.tsx"),
        ).filter((title: string): boolean => {
          return title.endsWith("Owner");
        }),
      ),
    ];

    const stateEngine: string = readDashboardSource(
      "Components/EventView/useEventStateActions.tsx",
    );
    const stateKinds: string = readDashboardSource(
      "Components/EventView/EventStateKinds.ts",
    );

    // The state moves, then the owners (Assign to Me first), then labels.
    expect(bulk).toContain("...stateBulkActions,");
    expect(bulk.indexOf("...stateBulkActions")).toBeLessThan(
      bulk.indexOf("...ownerBulkActions"),
    );
    expect(bulk.indexOf("...ownerBulkActions")).toBeLessThan(
      bulk.indexOf("...labelBulkActions"),
    );
    expect(bulk).toContain("ModalTableBulkDefaultActions.Delete");
    expect(LIST_TABLE).toContain("kind: EventStateKind.ScheduledMaintenance,");
    expect(LIST_TABLE).toContain("offerAssignToMeInBulk: true,");
    expect(stateEngine).toContain('title: "Change State",');
    expect(stateKinds).toContain(
      'export const MARK_AS_STATE: string = translationKey("Mark as {{state}}");',
    );
    expect(labelActions).toEqual(["Add Labels", "Remove Labels"]);
    expect(ownerActions).toEqual(["Add Owner", "Remove Owner"]);
    expect(where).toContain(
      `Select events to act on several at once: ${listed(
        [
          "Mark as {{state}}",
          "Change State",
          "Assign to Me",
          ...ownerActions,
          ...labelActions,
          "Delete",
        ],
        "or",
      )}.`,
    );
    // Each row's ⋯ menu: the same moves, and owners, for one event.
    expect(LIST_TABLE).toContain(
      "actionButtons={[...stateRowActions, ...ownerRowActions]}",
    );
    expect(where).toContain(
      "Each event's **⋯** menu, at the end of its row, does the same for that event alone: the **Mark as {{state}}** moves while the event can make them, **Change State**, **Assign to Me** until you own it, and **Add Owner**.",
    );
  });

  it("keeps everything about maintenance in its own menu, none of it in Project Settings", () => {
    const projectSettings: string = readDashboardSource(
      "Pages/Settings/SideMenu.tsx",
    );

    expect(projectSettings).not.toContain("SCHEDULED_MAINTENANCE");
    expect(where).toContain(
      "Everything about maintenance lives here, not in **Project Settings**.",
    );
  });
});

describe("an event's own menu, as the overview draws it", () => {
  const overview: string = english(MAINTENANCE_OVERVIEW);
  const pages: string = section(overview, "## An event's own pages");

  it("has a row per section of the event's menu, with its pages, in the menu's order", () => {
    expect(menuTable(pages)).toEqual(eventMenu());
  });

  it("says Overview, Team and Notes are open and the rest start folded", () => {
    // The incident page's sections, as an incident's and an alert's menus have them.
    expect(openSections(eventMenu(), EVENT_MENU_SOURCE)).toEqual([
      "Overview",
      "Team",
      "Notes",
    ]);
    expect(pages).toContain(
      "**Overview**, **Team** and **Notes** are open; the other sections start folded until you click them.",
    );
  });

  it("shows the planned window, the feed and the cards the overview names", () => {
    expect(EVENT_OVERVIEW_PAGE).toContain('label="Starts"');
    expect(EVENT_OVERVIEW_PAGE).toContain('label="Ends"');
    expect(EVENT_OVERVIEW_PAGE).toContain('label="Duration"');
    expect(EVENT_OVERVIEW_PAGE).toContain(
      "abbreviation: OneUptimeDate.getCurrentTimezoneString()",
    );
    expect(
      readDashboardSource(
        "Components/ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
      ),
    ).toContain('title={"Scheduled Maintenance Feed"}');
    expect(EVENT_OVERVIEW_PAGE).toContain('title: "Maintenance Details",');
    expect(EVENT_OVERVIEW_PAGE).toContain('title: "Affected Resources",');
    expect(EVENT_OVERVIEW_PAGE).toContain("<EventMeasurementsCard");
    expect(EVENT_OVERVIEW_PAGE).toContain("<OverviewCustomFields");
    expect(pages).toContain(
      "Under it, **Starts**, **Ends** and **Duration** show the planned window in your time zone. The **Scheduled Maintenance Feed** records everything that happened to the event, beside the **Maintenance Details** and **Affected Resources** cards, and the **Measurements** and **Custom Fields** cards when your project has any.",
    );
  });

  it("keeps the event's two switches on its Settings page, each saved when flipped", () => {
    const settingsPage: string = readDashboardSource(
      "Pages/ScheduledMaintenanceEvents/View/Settings.tsx",
    );

    expect(settingsPage).toContain("<StatusPageVisibilityCard");
    expect(settingsPage).toContain("<RemindersCard");
    expect(settingsPage).toContain(
      "Each is one switch\n * that saves the moment it is flipped.",
    );
    expect(
      readDashboardSource(
        "Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy.ts",
      ),
    ).toContain('switchTitle: translationKey("Visible on Status Page")');
    expect(
      readDashboardSource("Components/Reminders/RemindersSwitchCopy.ts"),
    ).toContain('switchTitle: translationKey("Send reminders")');
    expect(pages).toContain(
      "- **Settings** — **Visible on Status Page**, which shows or hides the event on its status pages, and **Send reminders**, which reminds its owners until it is completed. Each switch saves the moment you flip it.",
    );
  });
});

// ---- How an event runs ------------------------------------------------------------

describe("how an event runs", () => {
  const overview: string = english(MAINTENANCE_OVERVIEW);
  const ongoingJob: string = readWorkerSource(
    "ScheduledMaintenance/ChangeStateToOngoing.ts",
  );
  const endedJob: string = readWorkerSource(
    "ScheduledMaintenance/ChangeStateToEnded.ts",
  );

  it("moves an event on at both ends of its window, from a job that runs every minute", () => {
    expect(EVERY_MINUTE).toBe("* * * * *");

    for (const job of [ongoingJob, endedJob]) {
      expect(job).toContain("{ schedule: EVERY_MINUTE, runOnStartup: false }");
    }

    expect(ongoingJob).toContain("startsAt: QueryHelper.lessThan(now)");
    expect(ongoingJob).toContain(
      "ScheduledMaintenanceStartUtil.getOngoingState(",
    );
    expect(endedJob).toContain("endsAt: QueryHelper.lessThan(now)");
    expect(overview).toContain(
      "A job that runs every minute moves it on at both ends of the window, so you schedule the work once and OneUptime does the rest.",
    );
  });

  it("never completes an event on its own: no maintenance job moves one to the completed state", () => {
    const jobsDir: string = path.join(
      PACKAGES_DIR,
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenance",
    );

    for (const file of fs.readdirSync(jobsDir)) {
      const job: string = fs.readFileSync(path.join(jobsDir, file), "utf8");

      expect({
        job: file,
        completes: job.includes("getCompletedState"),
      }).toEqual({ job: file, completes: false });
    }

    expect(overview).toContain(
      "**Completed** is the last step, and nothing takes it on its own: a person, a chat button or the API marks the work as signed off, which also stops the owners' reminders.",
    );
  });

  it("draws the seeded states in their order", () => {
    const diagram: string = section(overview, "## How an event runs");

    for (const name of ["Scheduled", "Ongoing", "Ended", "Completed"]) {
      expect(diagram).toContain(`["${name}<br/>`);
    }

    expect(diagram.indexOf('["Scheduled<br/>')).toBeLessThan(
      diagram.indexOf('["Ongoing<br/>'),
    );
    expect(diagram.indexOf('["Ongoing<br/>')).toBeLessThan(
      diagram.indexOf('["Ended<br/>'),
    );
    expect(diagram.indexOf('["Ended<br/>')).toBeLessThan(
      diagram.indexOf('["Completed<br/>'),
    );
  });
});

// ---- Maintenance and announcements --------------------------------------------------

describe("maintenance against announcements", () => {
  const table: string = section(
    english(MAINTENANCE_OVERVIEW),
    "## Maintenance and announcements",
  );

  it("numbers a new project's events with its seeded prefix", () => {
    const info: NumberPrefixColumnInfo | undefined = NUMBER_PREFIX_COLUMNS.find(
      (column: NumberPrefixColumnInfo): boolean => {
        return column.column === "scheduledMaintenanceNumberPrefix";
      },
    );

    expect(info?.defaultForNewProjects).toBe(MAINTENANCE_NUMBER_PREFIX);
    expect(NumberPrefixUtil.getExample(MAINTENANCE_NUMBER_PREFIX)).toBe(
      "SM-42",
    );
    expect(table).toContain("| **Numbers in a new project** | `SM-42`");
  });

  it("shows an announcement from its start until its end, if it has one, and tells subscribers once", () => {
    const announcement: string = readCommonSource(
      "Models/DatabaseModels/StatusPageAnnouncement.ts",
    );
    const announcementJob: string = readWorkerSource(
      "Announcement/SendNotificationToSubscribers.ts",
    );

    expect(announcement).toContain("public showAnnouncementAt?: Date");
    expect(announcement).toContain("public endAnnouncementAt?: Date");
    expect(announcementJob).toContain(
      "showAnnouncementAt: QueryHelper.lessThan(",
    );
    expect(table).toContain(
      "It shows from its start time until its end time, if it has one",
    );
    expect(table).toContain("Once, when it starts showing");
  });
});

// ---- Where events come from ------------------------------------------------------

describe("where events come from", () => {
  const sources: string = section(
    english(MAINTENANCE_OVERVIEW),
    "## Where events come from",
  );

  it("opens the form from the list and from a resource's Scheduled Maintenance tab, and from a template", () => {
    expect(LIST_TABLE).toContain(
      'title: "Create Scheduled Maintenance Event",',
    );
    expect(LIST_TABLE).toContain('title: "Create from Template",');
    expect(sources).toContain(
      "Click **Create Scheduled Maintenance Event** on the list of events, or on the **Scheduled Maintenance** tab of a host, a cluster, a service, a network site or another resource, which picks that resource for you.",
    );
    expect(sources).toContain(
      "**Create from Template** fills the form in from a template you saved for work you do often.",
    );
  });

  it("schedules recurring events and opens the form from chat", () => {
    const commands: string = readCommonSource(
      "Server/Utils/Workspace/WorkspaceCommands.ts",
    );

    expect(commands).toContain('Maintenance = "maintenance",');
    expect(commands).toContain(
      "/oneuptime maintenance [title]    schedule a maintenance event",
    );
    expect(commands).toContain(
      "Microsoft Teams has no slash commands: the same words are typed to the bot",
    );
    expect(sources).toContain(
      "`/oneuptime maintenance` in Slack, or `maintenance` typed to the OneUptime bot in Microsoft Teams, opens the form in your chat tool.",
    );
  });

  it("names the API, the Terraform resource and the workflow step the code paths use", () => {
    const createStep: string = `Create One ${new ScheduledMaintenance().singularName}`;

    expect(new ScheduledMaintenance().getCrudApiPath()?.toString()).toBe(
      "/scheduled-maintenance",
    );
    expect(
      readPackageFile(
        "E2E/Terraform/e2e-tests/tests/30-scheduled-maintenance-crud/main.tf",
      ),
    ).toContain('resource "oneuptime_scheduled_maintenance_event"');
    expect(componentTitles(new ScheduledMaintenance())).toContain(createStep);
    expect(sources).toContain(
      `The API at \`/api/scheduled-maintenance\`, the \`oneuptime_scheduled_maintenance_event\` Terraform resource, and the **${createStep}** step of a workflow.`,
    );
  });
});

// The titles of a model's workflow components.
function componentTitles(model: DatabaseBaseModel): Array<string> {
  return BaseModelComponent.getComponents(model).map(
    (component: ComponentMetadata): string => {
      return component.title;
    },
  );
}

// ---- What an event affects --------------------------------------------------------

describe("what an event affects", () => {
  const affects: string = section(
    english(MAINTENANCE_OVERVIEW),
    "## What an event affects",
  );

  it("stops checking its monitors, says so on their pages and shows the status picked for them", () => {
    expect(TIMELINE_SERVICE).toContain(
      "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true, /// This will stop active monitoring.",
    );
    expect(TIMELINE_SERVICE).toContain(
      "await this.applyMonitorStatusWhenStarting({",
    );
    expect(
      readDashboardSource("Components/Monitor/DisabledWarning.tsx"),
    ).toContain(
      'const PAUSED_TITLE: string = translationKey("This monitor is disabled");',
    );
    expect(affects).toContain(
      "Every monitor under **Monitors** stops being checked, and each one's pages say **This monitor is disabled**.",
    );
  });

  it("puts each monitor back to operational when the event ends or is deleted, unless another event still holds it", () => {
    const release: string = TIMELINE_SERVICE.slice(
      TIMELINE_SERVICE.indexOf(
        "public async enableActiveMonitoringForMonitors(",
      ),
    );

    expect(release).toContain("isOperationalState: true,");
    expect(release).toContain(
      "await this.isMonitorHeldInMaintenanceByAnyEvent(",
    );
    expect(release.indexOf("if (isHeldByAnotherEvent) {")).toBeLessThan(
      release.indexOf(
        "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:\n                  false",
      ),
    );
    expect(EVENT_SERVICE).toContain(
      "protected override async onDeleteSuccess(",
    );
    expect(affects).toContain(
      "When the event ends, or is deleted, checks resume and each monitor goes back to operational, unless another event in progress still holds it.",
    );
  });

  it("silences the series of a telemetry monitor whose resource the event covers", () => {
    const suppression: string = readCommonSource(
      "Server/Utils/Monitor/MonitorMaintenanceSuppression.ts",
    );

    for (const resources of [
      "hosts: ResourceKeySet;",
      "kubernetesClusters: ResourceKeySet;",
      "databaseServers: ResourceKeySet;",
      "services: ResourceKeySet;",
    ]) {
      expect(suppression).toContain(resources);
    }

    expect(affects).toContain(
      "A telemetry monitor that watches many hosts, clusters, databases or services, one series each, raises no incident or alert for a series whose resource the event covers, while the other series keep alerting.",
    );
  });

  it("shows on its status pages while Visible on Status Page is on, which it is for a new event", () => {
    expect(
      new ScheduledMaintenance().getTableColumnMetadata("isVisibleOnStatusPage")
        .defaultValue,
    ).toBe(true);
    expect(affects).toContain(
      "The event appears on the status pages you picked, as coming up, then in progress, then over, while **Visible on Status Page** is on in its **Settings**.",
    );
  });

  it("tells the subscribers of its pages when it is scheduled, starts and ends, by default", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    for (const column of [
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing",
      "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded",
    ]) {
      expect({
        column,
        default: event.getTableColumnMetadata(column).defaultValue,
      }).toEqual({ column, default: true });
    }

    expect(affects).toContain(
      "By default, the subscribers of those pages are told when it is scheduled, when it starts and when it ends, and reminded before it starts if you set reminders.",
    );
  });

  it("posts the event to chat channels through the Workspace rules", () => {
    expect(workspaceSection().items).toEqual([
      "Slack",
      "Microsoft Teams",
      "Connect Slack or Teams",
    ]);
    expect(affects).toContain(
      "the Slack and Microsoft Teams rules under **Workspace** post it to your channels.",
    );
  });
});

// ---- Troubleshooting on the overview -----------------------------------------------

describe("the overview's troubleshooting", () => {
  const overview: string = english(MAINTENANCE_OVERVIEW);

  it("calls a start overdue after two minutes, as the header does", () => {
    expect(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS).toBe(
      2 * 60 * 1000,
    );
    expect(
      detailsBody(overview, "An event did not start at its Starts At"),
    ).toContain(
      "If the header says **Start overdue**, the event missed its start by more than two minutes",
    );
  });

  it("drops an event from a status page after the page's history window, 14 days unless changed", () => {
    expect(readCommonSource("Server/API/StatusPageAPI.ts")).toContain(
      "statusPage.showScheduledEventHistoryInDays || 14,",
    );
    expect(
      new StatusPage().getTableColumnMetadata("showScheduledEventHistoryInDays")
        .defaultValue,
    ).toBe(14);
    expect(
      detailsBody(overview, "The event is not on my status page"),
    ).toContain(
      "an event that started longer ago than the page's history window, 14 days unless you changed it, is no longer listed.",
    );
  });
});

// ---- Seeded states ----------------------------------------------------------------

/*
 * What a new project is seeded with, read from ProjectService's
 * addDefaultScheduledMaintenanceState: each row's name, description,
 * colour, flag and order.
 */
interface SeededRow {
  name: string;
  description: string;
  color: string;
  flag: string | null;
  order: number;
}

const SEEDED_FLAG: RegExp = /\.(is\w+State) = true;/;
const LITERAL_COLOR: RegExp = /^new Color\("(#[0-9a-fA-F]{6})"\)$/;

function seededColor(expression: string): string {
  const literal: RegExpMatchArray | null = expression.match(LITERAL_COLOR);

  if (literal) {
    return (literal[1] as string).toLowerCase();
  }

  const brand: RegExpMatchArray | null = readCommonSource(
    "Types/BrandColors.ts",
  ).match(
    new RegExp(
      `export const ${escapeRegExp(expression)}: Color = Color\\.fromString\\("(#[0-9a-fA-F]{6})"\\)`,
    ),
  );

  expect({ color: expression, found: Boolean(brand) }).toEqual({
    color: expression,
    found: true,
  });

  return (brand?.[1] as string).toLowerCase();
}

function seededStates(): Array<SeededRow> {
  const source: string = readCommonSource("Server/Services/ProjectService.ts");
  const start: number = source.search(
    /(?:private|public) async addDefaultScheduledMaintenanceState\(/,
  );

  expect(start).toBeGreaterThanOrEqual(0);

  const body: string = source.slice(start, source.indexOf("\n  }\n", start));

  return body
    .split("if (!existingNames.has(")
    .slice(1)
    .map((block: string): SeededRow => {
      const field: (name: string) => string = (name: string): string => {
        return (
          block.match(
            new RegExp(`\\.${escapeRegExp(name)} =\\s*([^;]+);`),
          )?.[1] || ""
        ).trim();
      };
      const flag: RegExpMatchArray | null = block.match(SEEDED_FLAG);

      return {
        name: JSON.parse(field("name")) as string,
        description: JSON.parse(field("description")) as string,
        color: seededColor(field("color")),
        flag: flag ? (flag[1] as string) : null,
        order: Number(field("order")),
      };
    });
}

// The seeded states as the state rules read them, with ids.
function seededStateRecords(): Array<Record<string, unknown>> {
  return seededStates().map((row: SeededRow): Record<string, unknown> => {
    return {
      _id: row.name.toLowerCase(),
      name: row.name,
      order: row.order,
      ...(row.flag ? { [row.flag]: true } : {}),
    };
  });
}

describe("the seeded maintenance states", () => {
  const states: string = english(MAINTENANCE_STATES);
  const seeded: Array<SeededRow> = seededStates();

  it("are read from the project's seeding: four states, one built-in flag each, in order", () => {
    expect(
      seeded.map((row: SeededRow): Array<string | number | null> => {
        return [row.name, row.order, row.flag];
      }),
    ).toEqual([
      ["Scheduled", 1, "isScheduledState"],
      ["Ongoing", 2, "isOngoingState"],
      ["Ended", 3, "isEndedState"],
      ["Completed", 4, "isResolvedState"],
    ]);
    expect(
      STATE_LISTS[StateListType.ScheduledMaintenanceState].builtIns.map(
        (builtIn: { flag: string }): string => {
          return builtIn.flag;
        },
      ),
    ).toEqual(
      seeded.map((row: SeededRow): string => {
        return row.flag as string;
      }),
    );
  });

  it("has a row per seeded state, with its order, flag and colour", () => {
    const table: string = section(states, "## The seeded states");

    expect(firstColumn(table)).toEqual(
      seeded.map((row: SeededRow): string => {
        return `**${row.name}**`;
      }),
    );

    for (const row of seeded) {
      expect(table).toMatch(
        new RegExp(
          `\\| \\*\\*${escapeRegExp(row.name)}\\*\\* +\\| \`${row.order}\` +\\| \`${row.flag}\` +\\| \`${escapeRegExp(row.color)}\` +\\|`,
        ),
      );
    }
  });

  it("lists the model's columns and flags as the page does, and names a state by its flags and order alone", () => {
    const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();

    for (const column of [
      "name",
      "description",
      "color",
      "order",
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]) {
      expect({
        column,
        found: Boolean(model.getTableColumnMetadata(column)),
      }).toEqual({ column, found: true });
    }

    expect(states).toContain(
      "The `ScheduledMaintenanceState` model has `name`, `description`, `color` and `order`, plus four flags: `isScheduledState`, `isOngoingState`, `isEndedState` and `isResolvedState`. OneUptime reads the flags and the order, never the name,",
    );
  });

  it("tags the built-in states and locks their Delete, keeping their order", () => {
    const definition: (typeof STATE_LISTS)[StateListType.ScheduledMaintenanceState] =
      STATE_LISTS[StateListType.ScheduledMaintenanceState];

    expect(StateSettingsSharedCopy.builtInTag).toBe("Built-in");
    expect(definition.keepsBuiltInOrder).toBe(true);
    expect(
      STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState]
        .deleteLockedReason,
    ).toBe("Built-in states can be renamed, but not deleted.");
    expect(states).toContain(
      "The four flagged states carry a **Built-in** tag on the settings page. You can rename, recolor and drag them, but they keep their order, and they cannot be deleted: their **Delete** stays locked, and says why.",
    );
  });

  it("counts Ended and Completed as over, and only Completed as complete", () => {
    const records: Array<Record<string, unknown>> = seededStateRecords();
    const byName: (name: string) => Record<string, unknown> = (
      name: string,
    ): Record<string, unknown> => {
      return records.find((record: Record<string, unknown>): boolean => {
        return record["name"] === name;
      }) as Record<string, unknown>;
    };

    for (const name of ["Ended", "Completed"]) {
      expect(
        ScheduledMaintenanceStartUtil.hasEnded({
          states: records,
          state: byName(name),
        }),
      ).toBe(true);
    }

    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: records,
        state: byName("Ended"),
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: records,
        state: byName("Completed"),
      }),
    ).toBe(true);
    expect(states).toContain(
      "**Ended** and **Completed** are both over. The difference is who moves the event: OneUptime moves it to **Ended** at its **Ends At**, and a person, a chat button or the API moves it to **Completed** once the work is checked.",
    );
  });

  it("gives the list's path as the menu holds it", () => {
    expect(sectionByTitle(maintenanceMenu(), "Settings").items[0]).toBe(
      "Event State",
    );
    expect(states).toContain(
      "> The list is under **Scheduled Maintenance → Settings → Event State**. **Settings** starts folded in the side menu: expand it first.",
    );
  });
});

// ---- What moves an event ------------------------------------------------------------

describe("what moves an event", () => {
  const states: string = english(MAINTENANCE_STATES);
  const moves: string = section(states, "## What moves an event");
  const stateChangeFields: string = readDashboardSource(
    "Components/EventView/StateChangeFormFields.ts",
  );

  it("names the header's buttons, its menu and the dialog they open", () => {
    expect(CHANGE_STATE).toContain(
      'translator.translateTemplate("Mark as {{state}}", {',
    );
    expect(CHANGE_STATE).toContain(
      '"Mark Scheduled Maintenance as {{state}}",',
    );
    expect(
      readDashboardSource("Components/EventView/EventStatusPanel.tsx"),
    ).toContain('title={props.moreMenuTitle || "Change state to"}');
    expect(stateChangeFields).toContain(
      'title: "Notify Status Page Subscribers",',
    );
    expect(stateChangeFields).toContain(
      '[BulkStateChangeNoteType.Public]: translationKey("Add a public note"),',
    );
    expect(moves).toContain(
      "| **The header**   | The event's **Overview**: the **Mark as {{state}}** buttons, and **Change state to** in its **⋯** menu | A short dialog, **Mark Scheduled Maintenance as {{state}}**, with **Notify Status Page Subscribers** and an optional note under **Add a public note**. |",
    );
  });

  it("adds a timeline row by hand with the state and when it began", () => {
    const formFields: string = STATE_TIMELINE_PAGE.slice(
      STATE_TIMELINE_PAGE.indexOf(
        "SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS",
      ),
      STATE_TIMELINE_PAGE.indexOf("];"),
    );

    expect(quotedTitles(formFields).slice(0, 2)).toEqual([
      "Scheduled Maintenance Status",
      "Starts At",
    ]);
    expect(moves).toContain(
      "A row you add by hand, with **Scheduled Maintenance Status** and **Starts At**.",
    );
  });

  it("changes the state of a selection with one public note, skipping events already at or past it", () => {
    // The list's Change State, from the events' entry in the state engine.
    const stateKinds: string = readDashboardSource(
      "Components/EventView/EventStateKinds.ts",
    );

    expect(stateKinds).toContain(
      '"Select the state to change scheduled maintenance events to. Events already at or past the selected state will be skipped.",',
    );
    expect(stateKinds).toContain(
      '"Post a public note about this state change to the status page. The same note is added to every event you selected.",',
    );
    expect(moves).toContain(
      "The state, and one public note added to every event. Events already at or past the state are skipped.",
    );
    expect(moves).toContain(
      "**Mark as {{state}}** or **Change State** on a selection in the list of events",
    );
    expect(moves).toContain(
      "| **A list row** | The **⋯** menu on an event's row in the list of events: the **Mark as {{state}}** moves and **Change State** | The header's dialog, naming the event.",
    );
  });

  it("takes a state change through the API at the state timeline's address", () => {
    expect(
      new ScheduledMaintenanceStateTimeline().getCrudApiPath()?.toString(),
    ).toBe("/scheduled-maintenance-state-timeline");
    expect(
      new ScheduledMaintenanceStateTimeline().getTableColumnMetadata(
        "shouldStatusPageSubscribersBeNotified",
      ),
    ).toBeTruthy();
    expect(moves).toContain(
      "| **The API**      | A row created at `/api/scheduled-maintenance-state-timeline`",
    );
  });

  it("offers, while the event waits, a button to start it and one to end it, and once it runs only the second", () => {
    const actions: string = CHANGE_STATE.slice(
      CHANGE_STATE.indexOf(
        "if (stateKind === ScheduledMaintenanceStateKind.Scheduled) {",
      ),
      CHANGE_STATE.indexOf("const overdueNotice"),
    );
    const scheduledBranch: string = actions.slice(
      0,
      actions.indexOf(
        "} else if (stateKind === ScheduledMaintenanceStateKind.Ongoing",
      ),
    );
    const ongoingBranch: string = actions.slice(
      actions.indexOf(
        "} else if (stateKind === ScheduledMaintenanceStateKind.Ongoing",
      ),
    );

    expect(scheduledBranch).toContain("label: markAsOngoingText,");
    expect(scheduledBranch).toContain("label: markAsCompleteText,");
    expect(ongoingBranch).not.toContain("markAsOngoingText");
    expect(ongoingBranch).toContain("label: markAsCompleteText,");
    expect(CHANGE_STATE).toContain(
      'const markAsOngoingText: string = getMarkAsText(\n    ongoingState?.name || "Ongoing",',
    );
    expect(CHANGE_STATE).toContain(
      "ScheduledMaintenanceStartUtil.getEndedState({",
    );
    expect(states).toContain(
      "The header's buttons are named after your states. While the event waits, it offers two: one that starts it, named after your ongoing state, and one that ends it, named after your ended state. While the event is in progress, only the second.",
    );
  });

  it("lists in the ⋯ menu every other state after the current one", () => {
    const records: Array<{ id: string; order: number }> =
      seededStateRecords().map(
        (record: Record<string, unknown>): { id: string; order: number } => {
          return {
            id: record["_id"] as string,
            order: record["order"] as number,
          };
        },
      );
    const ids: (states: Array<{ id: string }>) => Array<string> = (
      menuStates: Array<{ id: string }>,
    ): Array<string> => {
      return menuStates.map((state: { id: string }): string => {
        return state.id;
      });
    };

    expect(
      ids(
        getEventStateMenuStates({
          list: StateListType.ScheduledMaintenanceState,
          states: records,
          currentStateId: "scheduled",
          buttonStateIds: ["ongoing", "ended"],
        }),
      ),
    ).toEqual(["completed"]);
    expect(
      ids(
        getEventStateMenuStates({
          list: StateListType.ScheduledMaintenanceState,
          states: records,
          currentStateId: "ongoing",
          buttonStateIds: ["ended"],
        }),
      ),
    ).toEqual(["completed"]);
    expect(states).toContain(
      "The **⋯** menu lists every other state after the current one.",
    );
    expect(
      detailsBody(
        states,
        "The completed state is missing from the header's buttons",
      ),
    ).toContain(
      "Completing it is in the **⋯** menu, under **Change state to**.",
    );
  });
});

// ---- Starting and ending --------------------------------------------------------------

/*
 * A project's states with three of its own: "Confirmed" between Scheduled
 * and Ongoing, "Verifying" between Ongoing and Ended, "Reviewing" between
 * Ended and Completed, and "Archived" below Completed; "Draft" above
 * Scheduled.
 */
function statesWithOwn(): Array<Record<string, unknown>> {
  return [
    { _id: "draft", name: "Draft", order: 1 },
    { _id: "scheduled", name: "Scheduled", order: 2, isScheduledState: true },
    { _id: "confirmed", name: "Confirmed", order: 3 },
    { _id: "ongoing", name: "Ongoing", order: 4, isOngoingState: true },
    { _id: "verifying", name: "Verifying", order: 5 },
    { _id: "ended", name: "Ended", order: 6, isEndedState: true },
    { _id: "reviewing", name: "Reviewing", order: 7 },
    { _id: "completed", name: "Completed", order: 8, isResolvedState: true },
    { _id: "archived", name: "Archived", order: 9 },
  ];
}

function stateById(id: string): Record<string, unknown> {
  return statesWithOwn().find((state: Record<string, unknown>): boolean => {
    return state["_id"] === id;
  }) as Record<string, unknown>;
}

describe("what starting and ending do", () => {
  const states: string = english(MAINTENANCE_STATES);
  const startAndEnd: string = section(states, "## What starting and ending do");

  it("starts an event when it moves from waiting into Ongoing, or straight into a state of its own between Ongoing and Ended", () => {
    const all: Array<Record<string, unknown>> = statesWithOwn();

    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: all,
        state: stateById("verifying"),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.getStartRows({
        states: all,
        timeline: [
          { stateId: "scheduled", startsAt: "2030-01-01T00:00:00Z" },
          { stateId: "verifying", startsAt: "2030-01-01T01:00:00Z" },
        ],
      }).map((row: { stateId?: unknown }): unknown => {
        return row.stateId;
      }),
    ).toEqual(["verifying"]);
    expect(startAndEnd).toContain(
      "An event starts when it moves from a state where it waits into **Ongoing**, or straight into a state of yours placed between **Ongoing** and **Ended**.",
    );
  });

  it("ends an event when it moves from progress into Ended, Completed or a state of its own after Ended", () => {
    const all: Array<Record<string, unknown>> = statesWithOwn();

    for (const id of ["ended", "completed", "reviewing", "archived"]) {
      expect({
        state: id,
        over: ScheduledMaintenanceStartUtil.hasEnded({
          states: all,
          state: stateById(id),
        }),
      }).toEqual({ state: id, over: true });
    }

    expect(startAndEnd).toContain(
      "An event ends when it moves from a state where it is in progress into **Ended**, **Completed**, or a state of yours placed after **Ended**.",
    );
  });

  it("starts or ends nothing again on a move on from Ongoing, or from Ended to Completed", () => {
    const all: Array<Record<string, unknown>> = statesWithOwn();
    const timeline: Array<{ stateId: string; startsAt: string }> = [
      { stateId: "scheduled", startsAt: "2030-01-01T00:00:00Z" },
      { stateId: "ongoing", startsAt: "2030-01-01T01:00:00Z" },
      { stateId: "verifying", startsAt: "2030-01-01T02:00:00Z" },
      { stateId: "ended", startsAt: "2030-01-01T03:00:00Z" },
      { stateId: "completed", startsAt: "2030-01-01T04:00:00Z" },
    ];
    const stateIds: (rows: Array<{ stateId?: unknown }>) => Array<unknown> = (
      rows: Array<{ stateId?: unknown }>,
    ): Array<unknown> => {
      return rows.map((row: { stateId?: unknown }): unknown => {
        return row.stateId;
      });
    };

    expect(
      stateIds(
        ScheduledMaintenanceStartUtil.getStartRows({ states: all, timeline }),
      ),
    ).toEqual(["ongoing"]);
    expect(
      stateIds(
        ScheduledMaintenanceStartUtil.getEndRows({ states: all, timeline }),
      ),
    ).toEqual(["ended"]);
    expect(startAndEnd).toContain(
      'Moving on from **Ongoing** to "Verifying", or from **Ended** to **Completed**, starts or ends nothing again: the event had already started, or ended.',
    );
  });

  it("changes a monitor added while the event runs too", () => {
    expect(EVENT_SERVICE).toContain(
      "private async holdMonitorsAttachedToEvent(",
    );
    expect(startAndEnd).toContain(
      "A monitor you add to the event while it runs changes too.",
    );
  });

  it("tells owners who turned the state change notification on, and lists the event under Ongoing Events", () => {
    expect(
      readWorkerSource(
        "ScheduledMaintenanceOwners/SendStateChangeNotification.ts",
      ),
    ).toContain(
      "NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION",
    );
    expect(sectionByTitle(maintenanceMenu(), "Overview").items).toContain(
      "Ongoing Events",
    );
    expect(startAndEnd).toContain(
      "- **Its owners are told**, if they turned the state change notification on, and the event appears under **Ongoing Events**.",
    );
  });
});

// ---- The header's clock -------------------------------------------------------------

describe("the header's clock", () => {
  const clock: string = section(
    english(MAINTENANCE_STATES),
    "## The header's clock",
  );
  const startsAt: Date = new Date("2030-06-01T02:00:00Z");
  const endsAt: Date = new Date("2030-06-01T04:00:00Z");
  const minutes: (count: number, from: Date) => Date = (
    count: number,
    from: Date,
  ): Date => {
    return new Date(from.getTime() + count * 60 * 1000);
  };

  it("warns of a missed start or end only after two minutes", () => {
    const early: ScheduledMaintenanceTiming = getScheduledMaintenanceTiming({
      stateKind: ScheduledMaintenanceStateKind.Scheduled,
      startsAt,
      endsAt,
      now: minutes(1, startsAt),
    });
    const late: ScheduledMaintenanceTiming = getScheduledMaintenanceTiming({
      stateKind: ScheduledMaintenanceStateKind.Scheduled,
      startsAt,
      endsAt,
      now: minutes(3, startsAt),
    });
    const overrunning: ScheduledMaintenanceTiming =
      getScheduledMaintenanceTiming({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        startsAt,
        endsAt,
        now: minutes(3, endsAt),
      });

    expect(early.phase).toBe(ScheduledMaintenancePhase.StartOverdue);
    expect(early.isOverdue).toBe(false);
    expect(late.isOverdue).toBe(true);
    expect(overrunning.phase).toBe(ScheduledMaintenancePhase.EndOverdue);
    expect(overrunning.isOverdue).toBe(true);
    expect(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS).toBe(
      2 * 60 * 1000,
    );
    expect(clock).toContain(
      "When the event misses a boundary by more than two minutes, an amber notice says so:",
    );
  });

  it("calls the two warnings what the header calls them, in amber, with the planned time and the state not reached", () => {
    expect(CHANGE_STATE).toContain(
      'export const START_OVERDUE_TEXT: string = translationKey("Start overdue");',
    );
    expect(CHANGE_STATE).toContain(
      'export const OVERRUNNING_TEXT: string = translationKey("Overrunning");',
    );
    expect(CHANGE_STATE).toContain(
      "isStartOverdue ? START_OVERDUE_TEXT : OVERRUNNING_TEXT,",
    );
    // An amber notice: the header's amber band, its words in amber.
    expect(CHANGE_STATE).toContain('headerNoticeTone="warning"');
    expect(CHANGE_STATE).toContain(
      '<p className="text-sm font-semibold text-amber-800">',
    );
    expect(
      readDashboardSource("Components/EventView/EventHeaderLayout.ts"),
    ).toContain("border-amber-200 bg-amber-50/70");
    // The planned time, and the state the event has not reached yet.
    expect(CHANGE_STATE).toContain(
      '"Planned to start at {{time}}, but it has not been marked as {{state}} yet.",',
    );
    expect(CHANGE_STATE).toContain(
      '"Planned to end at {{time}}, but it has not been marked as {{state}} yet.",',
    );
    expect(CHANGE_STATE).toContain(
      "values={{ state: translatableTerm(props.nextStateName) }}",
    );
    expect(clock).toContain(
      "- **Start overdue**: the event is still waiting after its **Starts At**.",
    );
    expect(clock).toContain(
      "- **Overrunning**: the event is still in progress after its **Ends At**.",
    );
    expect(clock).toContain(
      "The notice names the planned time and the state the event has not reached yet.",
    );
  });

  it("checks again by itself for a few minutes after a boundary, and then stops", () => {
    const timing: ScheduledMaintenanceTiming = getScheduledMaintenanceTiming({
      stateKind: ScheduledMaintenanceStateKind.Scheduled,
      startsAt,
      endsAt,
      now: minutes(1, startsAt),
    });

    expect(SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS).toBe(
      5 * 60 * 1000,
    );
    expect(
      shouldRecheckScheduledMaintenanceState(timing, minutes(4, startsAt)),
    ).toBe(true);
    expect(
      shouldRecheckScheduledMaintenanceState(timing, minutes(6, startsAt)),
    ).toBe(false);
    expect(clock).toContain(
      "so for the next few minutes the header checks again on its own, and shows the new state without a reload.",
    );
  });
});

// ---- Order is enforced ------------------------------------------------------------

describe("the order every state change is held to", () => {
  const states: string = english(MAINTENANCE_STATES);
  const order: string = section(states, "## Order is enforced");
  const records: Array<Record<string, unknown>> = seededStateRecords();

  it("quotes the refusals of a backwards move and of a move to the same state, as the order rule words them", () => {
    const ongoing: Record<string, unknown> = records[1] as Record<
      string,
      unknown
    >;
    const scheduled: Record<string, unknown> = records[0] as Record<
      string,
      unknown
    >;
    const backwards: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.ScheduledMaintenance,
      from: ongoing as { _id: string; name: string; order: number },
      to: scheduled as { _id: string; name: string; order: number },
    });
    const same: string | null = StateMoveUtil.getMoveRefusal({
      record: StateMoveRecord.ScheduledMaintenance,
      from: ongoing as { _id: string; name: string; order: number },
      to: ongoing as { _id: string; name: string; order: number },
    });

    expect([backwards, same]).toEqual(SERVER_TEXT[MAINTENANCE_STATES]);
    expect(order).toContain(`"${backwards}"`);
    expect(order).toContain(`"${same}"`);
  });

  it("offers in a picker only the states after the current one", () => {
    expect(
      StateMoveUtil.getStatesToMoveTo({
        list: StateListType.ScheduledMaintenanceState,
        states: records,
        currentStateId: "ongoing",
      }).map((state: Record<string, unknown>): unknown => {
        return state["_id"];
      }),
    ).toEqual(["ended", "completed"]);
    expect(order).toContain(
      "- **Pickers offer only the states after the current one**, so nobody is offered a move that would be refused.",
    );
  });

  it("puts a state set by mistake right by deleting its row, which returns the event to the row before", () => {
    expect(
      decideStateRowDelete({ hasStateBefore: true, hasStateAfter: false }),
    ).toBe(StateRowDeleteEffect.PreviousIsCurrentAgain);
    expect(order).toContain(
      "To put right a state set by mistake, delete its row on the event's **State Timeline** page; the event goes back to the state of the row before it.",
    );
  });
});

// ---- States of your own -----------------------------------------------------------

describe("states of your own", () => {
  const states: string = english(MAINTENANCE_STATES);
  const own: string = section(states, "## States of your own");
  const copy: (typeof STATE_SETTINGS_COPY)[StateListType.ScheduledMaintenanceState] =
    STATE_SETTINGS_COPY[StateListType.ScheduledMaintenanceState];

  it("names the card, its Counts as column and the create form as the settings page draws them", () => {
    const createButton: string = `Create ${new ScheduledMaintenanceState().singularName}`;

    expect(copy.title).toBe("Scheduled Maintenance States");
    expect(copy.countsAs?.title).toBe("Counts as");
    expect(createButton).toBe("Create Scheduled Maintenance State");
    expect([
      StateSettingsSharedCopy.nameFieldTitle,
      StateSettingsSharedCopy.descriptionFieldTitle,
      StateSettingsSharedCopy.colorFieldTitle,
    ]).toEqual(["Name", "Description", "Color"]);
    expect(own).toContain(
      `The **${copy.title}** card lists your states in their order. Each row shows its color and name, what an event in it **${copy.countsAs?.title}**, and its description.`,
    );
    expect(own).toContain(
      `Click **${createButton}** and fill in its **Name**, **Description** and **Color**. The new state is added just above the completed state.`,
    );
  });

  it("adds a new state just above the completed state, and saves a drag as it is dropped", () => {
    const rows: Array<StateListRow> = seededStateRecords().map(
      (record: Record<string, unknown>): StateListRow => {
        return toStateListRow(
          STATE_LISTS[StateListType.ScheduledMaintenanceState],
          record,
        );
      },
    );

    expect(copy.description).toContain(
      "A new state is added just above the completed state.",
    );
    expect(
      getStateListInsertValue(
        STATE_LISTS[StateListType.ScheduledMaintenanceState],
        rows,
      ),
    ).toBe(4);
    expect(
      readDashboardSource(
        "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceState.tsx",
      ),
    ).toContain('enableDragAndDrop={true}\n        dragDropIndexField="order"');
  });

  it("says what an event in a state of its own counts as, by the state's place", () => {
    const all: Array<Record<string, unknown>> = statesWithOwn();
    const placement: string = tableRows(own).join("\n");

    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: all,
        state: stateById("confirmed"),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: all,
        state: stateById("verifying"),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.hasEnded({
        states: all,
        state: stateById("reviewing"),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: all,
        state: stateById("reviewing"),
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: all,
        state: stateById("archived"),
      }),
    ).toBe(true);
    expect(firstColumn(own)).toEqual([
      "Between **Scheduled** and **Ongoing**",
      "Between **Ongoing** and **Ended**",
      "Between **Ended** and **Completed**",
      "Below **Completed**",
    ]);
    expect(placement).toContain(
      "Waits for its **Starts At**, as in **Scheduled**, and starts from there at its time.",
    );
    expect(placement).toContain(
      "Is over, but not complete yet: reminders that run until completion keep going.",
    );
  });

  it("never reaches a state placed above Scheduled: events start there, and the clock starts only waiting ones", () => {
    const all: Array<Record<string, unknown>> = statesWithOwn();

    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: all,
        state: stateById("draft"),
      }),
    ).toBe(false);
    expect(EVENT_SERVICE).toContain(
      "Every event starts scheduled, whatever state the write named under",
    );
    expect(states).toContain(
      "Keep your states below **Scheduled**: every new event starts there, and an event never moves back up the list, so a state above it is never reached.",
    );
  });

  it("needs Growth to add or change a state, and no plan to read, use or delete one", () => {
    const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();

    expect([
      model.getCreateBillingPlan(),
      model.getUpdateBillingPlan(),
      model.getReadBillingPlan(),
      model.getDeleteBillingPlan(),
    ]).toEqual([
      PlanType.Growth,
      PlanType.Growth,
      PlanType.Free,
      PlanType.Free,
    ]);
    expect(states).toContain(
      "> On OneUptime Cloud, adding or changing maintenance states takes the **Growth** plan or above. Every plan can read them, use them and delete a state you added.",
    );
  });
});

// ---- The state timeline -----------------------------------------------------------

describe("an event's state timeline", () => {
  const timeline: string = section(
    english(MAINTENANCE_STATES),
    "## The state timeline",
  );

  it("draws the State Timeline card, and its Table view with the columns the page names", () => {
    const viewSwitch: string = readCommonSource(
      "UI/Components/StatusTimeline/StatusTimelineView.tsx",
    );
    const table: string = STATE_TIMELINE_PAGE.slice(
      STATE_TIMELINE_PAGE.indexOf(
        "<ModelTable<ScheduledMaintenanceStateTimeline>",
      ),
    );
    const columns: string = table.slice(table.indexOf("columns={["));

    // The card is named like the page and its menu entry: State Timeline.
    expect(STATE_TIMELINE_PAGE).toContain('title="State Timeline"');
    expect(STATE_TIMELINE_PAGE).not.toContain('"Status Timeline"');
    expect(viewSwitch).toContain('label: translationKey("Table"),');
    expect(quotedTitles(columns)).toEqual([
      "Scheduled Maintenance Status",
      "Starts At",
      "Notification Enabled",
      "Subscriber Notification Status",
    ]);
    expect(columns).toContain(
      "getStateTimelineEndsAtColumn<ScheduledMaintenanceStateTimeline>(),\n          getStateTimelineDurationColumn<ScheduledMaintenanceStateTimeline>(),",
    );
    expect(timeline).toContain("Its card draws them as a timeline");
    expect(timeline).toContain(
      "**Table**, in the card's header, lists them as rows instead, with **Scheduled Maintenance Status**, **Starts At**, **Ends At**, **Duration**, whether subscribers were to be notified, and how their notification went.",
    );
  });

  it("adds and deletes rows in the dashboard, never edits them, and keeps one", () => {
    expect(STATE_TIMELINE_PAGE).not.toContain("isEditable={true}");
    expect(
      decideStateRowDelete({ hasStateBefore: false, hasStateAfter: false }),
    ).toBe(StateRowDeleteEffect.OnlyState);
    expect(
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.ScheduledMaintenance],
    ).toBe(
      "The event's only state can't be deleted: a scheduled maintenance event always has a state. To change it, add a new state.",
    );
    expect(timeline).toContain(
      "In the dashboard, rows can be added and deleted, but not edited, and an event always keeps at least one.",
    );
  });

  it("lets the API correct a row's startsAt, and recomputes the measurements after a correction or a delete", () => {
    expect(
      new ScheduledMaintenanceStateTimeline().getColumnAccessControlFor(
        "startsAt",
      )?.update.length,
    ).toBeGreaterThan(0);
    expect(TIMELINE_SERVICE).toContain(
      "this.recomputeMeasurementsForScheduledMaintenanceIds(",
    );
    expect(TIMELINE_SERVICE).toContain(
      "A deleted timeline row removes the point some anchors resolved to.",
    );
    expect(timeline).toContain(
      "Through the API, a row's `startsAt` can be corrected, and every measurement worked out from the timeline follows it.",
    );
    expect(timeline).toContain(
      "> Deleting a row rewrites the event's history and every measurement worked out from it.",
    );
  });
});

// ---- Creating an event ---------------------------------------------------------------

describe("who may create an event, and what they need", () => {
  const creating: string = english(CREATING_EVENTS);

  it("names the roles that create events and the custom permission", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    const custom: Array<string> = permissionTitles(
      event.getCreatePermissions().filter((permission: Permission): boolean => {
        return !rolesOf([permission]).length;
      }),
    );

    expect(rolesOf(event.getCreatePermissions())).toEqual([...ROLE_NAMES]);
    expect(custom).toEqual(["Create Scheduled Maintenance"]);
    expect(creating).toContain(
      `Creating an event takes ${listed([...ROLE_NAMES], "or")}, or a custom role with **${custom[0]}**.`,
    );
  });
});

describe("the create form", () => {
  const creating: string = english(CREATING_EVENTS);
  const fieldsTable: string = section(creating, "## The form's fields");

  it("walks two steps, Event and Resources Affected, then the review with the create button", () => {
    const steps: string = CREATE_PAGE.slice(
      CREATE_PAGE.indexOf("steps={["),
      CREATE_PAGE.indexOf("]}", CREATE_PAGE.indexOf("steps={[")),
    );

    expect(quotedTitles(steps)).toEqual(["Event", "Resources Affected"]);
    expect(CREATE_PAGE).toContain(
      'submitButtonText={"Create Scheduled Maintenance Event"}',
    );
    expect(creating).toContain(
      "Click **Next** to see the review, check it, then click **Create Scheduled Maintenance Event**. The event's own page opens.",
    );
  });

  it("has a row per field, on the step the form asks it", () => {
    const stepTitles: Record<string, string> = {
      event: "Event",
      "resources-affected": "Resources Affected",
    };
    const rows: Array<Array<string>> = tableRows(fieldsTable).map(
      (row: string): Array<string> => {
        return tableCells(row);
      },
    );

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual([
      "**Title**",
      "**Description**",
      "**Starts At**",
      "**Ends At**",
      "**Owners**",
      "**Labels**",
      "**Monitors**",
      "**Change Monitor Status to**",
      "**Other Affected Resources**",
      "**Show event on these status pages**",
      "**Subscriber Notifications**",
    ]);

    for (const cells of rows) {
      const field: string = boldNames(cells[0] as string)[0] as string;
      const step: string = boldNames(cells[1] as string)[0] as string;

      if (field === "Owners" || field === "Labels") {
        expect(CREATE_PAGE).toMatch(
          new RegExp(
            `get${field}FormField(?:<ScheduledMaintenance>)?\\(\\{\\s*stepId: "event",`,
          ),
        );
        expect(step).toBe("Event");
        continue;
      }

      if (field === "Subscriber Notifications") {
        expect(FORM_MODULE).toContain('title: "Subscriber Notifications",');
        expect(
          stepOf(fieldObject(CREATE_PAGE, "When the event is scheduled")),
        ).toBe("resources-affected");
        expect(step).toBe("Resources Affected");
        continue;
      }

      expect({
        field,
        step: stepTitles[stepOf(fieldObject(CREATE_PAGE, field))],
      }).toEqual({ field, step });
    }
  });

  it("asks only for the title, and makes the description Markdown", () => {
    expect(fieldObject(CREATE_PAGE, "Title")).toContain("required: true");
    expect(fieldObject(CREATE_PAGE, "Description")).toContain(
      "fieldType: FormFieldSchemaType.Markdown",
    );
    expect(creating).toContain(
      "Only the title has to be typed; everything else starts with a sensible default.",
    );
    expect(fieldsTable).toContain(
      "| **Title**                            | **Event**          | Empty, and required",
    );
  });

  it("starts the window at the next full hour, for an hour, and moves the end with the start", () => {
    const window: MaintenanceWindow = getDefaultMaintenanceWindow({
      now: new Date("2030-06-01T09:20:00Z"),
      timezone: "UTC",
    });
    const movedEnd: Date | null = getMaintenanceEndAfterStartMoved({
      previousStartsAt: "2030-06-01T10:00:00Z",
      previousEndsAt: "2030-06-01T12:00:00Z",
      nextStartsAt: "2030-06-02T10:00:00Z",
    });

    expect(DEFAULT_MAINTENANCE_DURATION_IN_MINUTES).toBe(60);
    expect(window.startsAt.toISOString()).toBe("2030-06-01T10:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2030-06-01T11:00:00.000Z");
    expect(movedEnd?.toISOString()).toBe("2030-06-02T12:00:00.000Z");
    expect(fieldObject(CREATE_PAGE, "Starts At")).toContain(
      "onChange: moveMaintenanceEndWithStart,",
    );
    expect(creating).toContain(
      "**Starts At** is already the next full hour on your clock, and **Ends At** an hour later; change them only when they are wrong. Moving **Starts At** moves **Ends At** with it, so the window keeps its length.",
    );
  });

  it("refuses an end before the start, in the words the troubleshooting quotes", () => {
    expect(FORM_MODULE).toContain('"Ends At must be after Starts At."');
    expect(fieldObject(CREATE_PAGE, "Ends At")).toContain(
      "return getMaintenanceEndsAtError(values);",
    );
    expect(
      detailsBody(creating, "Ends At says it must be after Starts At"),
    ).toContain(
      "The window has to be in order: the event ends after it starts.",
    );
  });

  it("folds Owners and Labels under More fields", () => {
    expect(
      readCommonSource("UI/Components/FoldedSection/FoldedSectionTitles.ts"),
    ).toContain(
      'MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields")',
    );
    expect(CREATE_PAGE).toContain(
      "const advancedSection: FormFieldCollapsibleSection<ScheduledMaintenance> =\n  getAdvancedFormSection<ScheduledMaintenance>();",
    );
    expect(
      CREATE_PAGE.match(/collapsibleSection: advancedSection,/g)?.length,
    ).toBe(2);
    expect(creating).toContain(
      "**Owners** and **Labels** wait under **More fields**, folded.",
    );
  });

  it("asks for Change Monitor Status to only once a monitor is picked", () => {
    expect(fieldObject(CREATE_PAGE, "Change Monitor Status to")).toContain(
      "showIf: hasMonitors,",
    );
    expect(creating).toContain(
      "Once you pick one, **Change Monitor Status to** appears under them: the status the monitors change to when the event starts.",
    );
    expect(
      detailsBody(
        creating,
        "Change Monitor Status to is missing from the form",
      ),
    ).toContain("It is asked only once the event has a monitor.");
  });

  it("folds Subscriber Notifications to one line, with the three moments on and no reminders", () => {
    expect(FORM_MODULE).toContain(
      '"scheduled,started,ended": translationKey(\n    "Subscribers of the event\'s status pages are notified when it is scheduled, when it starts and when it ends.",',
    );

    for (const title of [
      "When the event is scheduled",
      "When the event starts",
      "When the event ends",
      "Reminders before the event",
    ]) {
      expect(fieldObject(CREATE_PAGE, title)).toContain(
        "collapsibleSection: subscriberNotificationsSection,",
      );
    }

    expect(creating).toContain(
      "**Subscriber Notifications**, folded, says in one line who is told and when; open it to change **When the event is scheduled**, **When the event starts**, **When the event ends** or **Reminders before the event**.",
    );
    expect(fieldsTable).toContain("All three moments on, no reminders");
  });

  it("adds a monitor's linked resources, and suggests the status pages that show the monitors", () => {
    const prefill: string = readDashboardSource(
      "Components/AffectedResources/MonitorLinkedResourcesPrefillRules.ts",
    );
    const suggestions: string = readDashboardSource(
      "Components/StatusPage/StatusPageSuggestionRules.ts",
    );

    expect(prefill).toContain(
      'export const SCHEDULED_MAINTENANCE_PREFILL_PAYLOAD_KEYS: Array<AffectedResourcesPayloadKey> =\n  [...MONITOR_LINKED_RESOURCE_KEYS, "networkSites"];',
    );
    expect(suggestions).toContain(
      'export const ADD_ALL_SUGGESTED_STATUS_PAGES: string = translationKey("Add all");',
    );
    expect(creating).toContain(
      "- **Linked resources.** When you pick a monitor, the hosts, clusters, services and other resources it is linked to are added under **Other Affected Resources**",
    );
    expect(creating).toContain(
      "click a page's name to add it, or **Add all**. Nothing is picked for you.",
    );
  });

  it("sends nothing until a status page is picked", () => {
    expect(
      readWorkerSource("ScheduledMaintenance/SendNotificationToSubscribers.ts"),
    ).toContain("isVisibleOnStatusPage: true,");
    expect(creating).toContain(
      "Nothing is sent until you pick a status page: an event shown on no status page tells no subscriber.",
    );
  });
});

describe("starting from a resource or a template", () => {
  const start: string = section(
    english(CREATING_EVENTS),
    "## Start from a resource or a template",
  );

  it("opens the form from the Scheduled Maintenance tab of the resources the page lists, with the resource picked", () => {
    const kinds: Array<CreateFromRecordKind> = CREATE_FROM_RECORD_KINDS.filter(
      (definition: CreateFromRecordKindDefinition): boolean => {
        return Boolean(definition.tabs[CreatedRecordKind.ScheduledMaintenance]);
      },
    ).map(
      (definition: CreateFromRecordKindDefinition): CreateFromRecordKind => {
        return definition.kind;
      },
    );

    expect([...kinds].sort()).toEqual(
      [
        CreateFromRecordKind.Host,
        CreateFromRecordKind.KubernetesCluster,
        CreateFromRecordKind.ProxmoxCluster,
        CreateFromRecordKind.CephCluster,
        CreateFromRecordKind.DockerSwarmCluster,
        CreateFromRecordKind.DockerHost,
        CreateFromRecordKind.PodmanHost,
        CreateFromRecordKind.VMwareVCenter,
        CreateFromRecordKind.StorageArray,
        CreateFromRecordKind.IoTFleet,
        CreateFromRecordKind.DatabaseServer,
        CreateFromRecordKind.Service,
        CreateFromRecordKind.NetworkSite,
      ].sort(),
    );

    for (const definition of CREATE_FROM_RECORD_KINDS) {
      const tab: { title: string } | undefined =
        definition.tabs[CreatedRecordKind.ScheduledMaintenance];

      if (tab) {
        expect(tab.title).toBe("Scheduled Maintenance");
      }
    }

    expect(start).toContain(
      "On the **Scheduled Maintenance** tab of a host, a Kubernetes, Proxmox, Ceph or Docker Swarm cluster, a Docker or Podman host, a vCenter, a storage array, an IoT fleet, a database, a service or a network site, **Create Scheduled Maintenance Event** opens the same form with that resource already picked under **Other Affected Resources**",
    );
  });

  it("picks, from an inventory item's tab, the host, service or Kubernetes cluster it points at", () => {
    expect(
      readDashboardSource("Components/Inventory/LinkedResource.ts"),
    ).toContain(
      'export enum LinkedResourceKind {\n  Service = "Service",\n  Host = "Host",\n  KubernetesCluster = "KubernetesCluster",\n}',
    );
    expect(
      readDashboardSource("Pages/Inventory/View/ScheduledMaintenance.tsx"),
    ).toContain("createFrom={getCreateFromRecordForLinkedResource(resource)}");
    expect(start).toContain(
      "An inventory item's tab picks the host, service or Kubernetes cluster the item points at.",
    );
  });

  it("asks for a template beside the create button, and opens the form filled in from it", () => {
    expect(LIST_TABLE).toContain(
      'title: "Select Scheduled Maintenance Template",',
    );
    expect(LIST_TABLE).toContain('submitButtonText="Create from Template"');
    expect(LIST_TABLE).toContain(
      "scheduledMaintenanceTemplateId:\n                      scheduledMaintenanceTemplateId.toString(),",
    );
    expect(start).toContain(
      "**Create from Template**, beside the create button, asks you to **Select Scheduled Maintenance Template**, then opens the form filled in from the template.",
    );
  });
});

// The order of a service's onCreateSuccess steps, from the hook on.
function createSuccessSteps(service: string): string {
  return service.slice(
    service.indexOf("protected override async onCreateSuccess("),
  );
}

function positionsIn(source: string, markers: Array<string>): Array<number> {
  return markers.map((marker: string): number => {
    const position: number = source.indexOf(marker);

    expect({ marker, found: position >= 0 }).toEqual({ marker, found: true });

    return position;
  });
}

function inOrder(positions: Array<number>): boolean {
  return positions.every((position: number, index: number): boolean => {
    return index === 0 || position > (positions[index - 1] as number);
  });
}

describe("what happens when an event is created", () => {
  const creating: string = english(CREATING_EVENTS);
  const happens: string = section(
    creating,
    "## What happens when you create it",
  );

  it("numbers it from a per-project counter with the prefix, and starts it in the scheduled state whatever a request names", () => {
    expect(EVENT_SERVICE).toContain(
      "await ProjectService.incrementAndGetScheduledMaintenanceCounter(",
    );
    expect(EVENT_SERVICE).toContain("NumberPrefixUtil.formatNumber(");
    expect(EVENT_SERVICE).toContain("isScheduledState: true,");
    expect(EVENT_SERVICE).toContain("RelationIdUtil.stamp(");
    expect(happens).toContain(
      "1. **It gets a number and a state.** The number comes from a per-project counter, shown with your prefix (`SM-42`). The event starts in your scheduled state, whatever state a request names.",
    );
  });

  it("works through the steps in the page's order: chat, feed, state timeline, owners and labels, runbook rules, reminders", () => {
    expect(
      inOrder(
        positionsIn(createSuccessSteps(EVENT_SERVICE), [
          "this.handleScheduledMaintenanceWorkspaceOperationsAsync(",
          "this.createScheduledMaintenanceFeedAsync(",
          "this.createScheduledMaintenanceStateTimelineAsync(",
          "this.addOwners(",
          "ScheduledMaintenanceOwnerRuleEngineService.applyRulesToScheduledMaintenance(",
          "ScheduledMaintenanceLabelRuleEngineService.applyRulesToScheduledMaintenance(",
          "RunbookRuleEngineService.applyRulesToScheduledMaintenance(",
          "this.refreshReminderSchedule({",
        ]),
      ),
    ).toBe(true);
    expect(
      inOrder(
        positionsIn(happens, [
          "**Your chat tools hear of it.**",
          "**Its state timeline starts.**",
          "**Owners and labels are added**",
          "**Runbook rules start**",
          "**Reminders are scheduled**",
        ]),
      ),
    ).toBe(true);
  });

  it("lets a Workspace rule create a channel for the event", () => {
    expect(
      readCommonSource(
        "Types/Workspace/NotificationRules/NotificationRuleTypes/ScheduledMaintenanceNotificationRule.ts",
      ),
    ).toContain("extends CreateChannelNotificationRule");
    expect(happens).toContain(
      "a rule can create a channel for the event. Its feed records that it was created.",
    );
  });

  it("tells subscribers within a minute that it is scheduled, unless the switch is off, and starts the On Create trigger", () => {
    const subscriberJob: string = readWorkerSource(
      "ScheduledMaintenance/SendNotificationToSubscribers.ts",
    );
    const trigger: string = `On Create ${new ScheduledMaintenance().singularName}`;

    expect(subscriberJob).toContain(
      "{ schedule: EVERY_MINUTE, runOnStartup: false }",
    );
    expect(subscriberJob).toContain(
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,",
    );
    expect(componentTitles(new ScheduledMaintenance())).toContain(trigger);
    expect(
      readWorkerSource(
        "ScheduledMaintenanceOwners/SendCreatedResourceNotification.ts",
      ),
    ).toContain(
      "NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION",
    );
    expect(happens).toContain(
      `Within a minute, the subscribers of its status pages are told that it is scheduled, unless you turned **When the event is scheduled** off. The **${trigger}** workflow trigger starts any workflow built on it,`,
    );
  });
});

describe("changing an event later", () => {
  const creating: string = english(CREATING_EVENTS);
  const later: string = section(creating, "## Change an event later");

  it("edits the window and labels, then the status pages and reminders, on the Maintenance Details card", () => {
    const details: string = EVENT_OVERVIEW_PAGE.slice(
      EVENT_OVERVIEW_PAGE.indexOf('title: "Maintenance Details",'),
    );
    const steps: string = details.slice(
      details.indexOf("formSteps={["),
      details.indexOf("]}", details.indexOf("formSteps={[")),
    );

    expect(quotedTitles(steps)).toEqual(["Event", "Status Pages"]);
    expect(details).toContain('editButtonText="Edit"');
    expect(later).toContain(
      "| The title, the window or the labels         | **Edit** on the **Maintenance Details** card of its **Overview**, step **Event** |",
    );
    expect(later).toContain(
      "| The status pages or the reminders           | The same **Edit**, step **Status Pages**",
    );
  });

  it("sets the three subscriber moments once, when the event is created", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    for (const column of [
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing",
      "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded",
    ]) {
      expect({
        column,
        update: event.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, update: [] });
    }

    expect(
      event.getColumnAccessControlFor(
        "sendSubscriberNotificationsOnBeforeTheEvent",
      )?.update.length,
    ).toBeGreaterThan(0);
    expect(later).toContain(
      "Everything on the form can be changed on the event's own pages, except the three subscriber moments, which are set once, when the event is created.",
    );
  });

  it("locks Change Monitor Status to once the event has started", () => {
    expect(EVENT_SERVICE).toContain(
      '"Change Monitor Status to can no longer be changed: this event has already started."',
    );
    expect(
      readDashboardSource(
        "Components/ScheduledMaintenance/StartedEventMonitorStatus.tsx",
      ),
    ).toContain("shown\n * read-only");
    expect(later).toContain(
      "**Change Monitor Status to** can be changed until the event starts. After that the card shows it read-only, because the monitors are already in that status.",
    );
  });

  it("records an edit in the feed only when something changed", () => {
    expect(EVENT_SERVICE).toContain("if (shouldAddScheduledMaintenanceFeed) {");
    expect(EVENT_SERVICE).toContain(
      "ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated,",
    );
    expect(later).toContain(
      "An edit adds an entry to the **Scheduled Maintenance Feed** that names what it changed; saving with nothing changed adds none.",
    );
  });
});

describe("notes on an event", () => {
  const notes: string = section(
    english(CREATING_EVENTS),
    "## Post notes as the work goes on",
  );

  it("offers the public note's Notify status page subscribers, and the feed's Actions", () => {
    const feed: string = readDashboardSource(
      "Components/ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
    );
    const dialogs: string = readDashboardSource(
      "Components/EventNotes/EventNoteComposerDialog.tsx",
    );

    expect(
      readDashboardSource("Components/EventNotes/EventNoteComposer.tsx"),
    ).toContain('title: translationKey("Notify status page subscribers"),');
    expect(feed).toContain('text="Execute Runbook"');
    expect(feed).toContain("...noteActions.menuItems,");
    expect(dialogs).toContain('public: translationKey("Add Public Note"),');
    expect(dialogs).toContain('private: translationKey("Add Private Note"),');
    expect(
      readCommonSource("UI/Components/Feed/FeedActionsMenu.tsx"),
    ).toContain('translator.translateText("Actions")');
    expect(notes).toContain(
      "or from the **Actions** menu of the **Scheduled Maintenance Feed** with **Add Public Note** or **Add Private Note**. The same menu runs a runbook with **Execute Runbook**.",
    );
  });
});

describe("creating events from code", () => {
  const code: string = section(
    english(CREATING_EVENTS),
    "## Create events from code",
  );

  it("creates an event at the model's API address, with an API key in the apikey header", () => {
    expect(new ScheduledMaintenance().getCrudApiPath()?.toString()).toBe(
      "/scheduled-maintenance",
    );
    expect(
      readCommonSource("Server/Middleware/ProjectAuthorization.ts"),
    ).toContain('req.headers?.["apikey"]');
    expect(code).toContain(
      "so `POST /api/scheduled-maintenance` creates an event. Authenticate with an API key from **Project Settings → Advanced → API Keys**, sent in the `apikey` header",
    );
    expect(code).toContain(
      "curl -X POST https://oneuptime.com/api/scheduled-maintenance",
    );
  });

  it("names only columns the model has, and ignores the state a request names", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    const fields: Array<string> = tableRows(code).flatMap(
      (row: string): Array<string> => {
        return Array.from(
          (tableCells(row)[0] as string).matchAll(/`([^`]+)`/g),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });
      },
    );

    expect(fields).toEqual([
      "title",
      "startsAt",
      "endsAt",
      "monitors",
      "statusPages",
      "labels",
      "changeMonitorStatusToId",
      "currentScheduledMaintenanceStateId",
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
    ]);

    for (const field of fields) {
      expect({
        field,
        found: Boolean(event.getTableColumnMetadata(field)),
      }).toEqual({ field, found: true });
    }

    expect(EVENT_SERVICE).toContain('  "currentScheduledMaintenanceStateId",');
    expect(FORM_MODULE).toContain(
      'SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY: string =\n  "shouldStatusPageSubscribersBeNotifiedOnEventCreated";',
    );
    expect(code).toContain(
      "| `currentScheduledMaintenanceStateId`                  | Ignored: every event starts in your scheduled state.",
    );
  });

  it("names the Terraform resource and the workflow step", () => {
    expect(
      readPackageFile(
        "E2E/Terraform/e2e-tests/tests/30-scheduled-maintenance-crud/main.tf",
      ),
    ).toContain('resource "oneuptime_scheduled_maintenance_event"');
    expect(english("terraform/examples")).toContain(
      'resource "oneuptime_scheduled_maintenance_event"',
    );
    expect(code).toContain(
      "The same event as code is the `oneuptime_scheduled_maintenance_event` Terraform resource: see [Examples](/docs/terraform/examples#scheduled-maintenance). A workflow creates one with its **Create One Scheduled Maintenance Event** step",
    );
  });
});

// ---- Templates and recurring events -------------------------------------------------

describe("maintenance templates", () => {
  const templates: string = english(TEMPLATES_AND_RECURRING);

  it("need Growth, and the roles the page names", () => {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    expect(template.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(rolesOf(template.getCreatePermissions())).toEqual([...ROLE_NAMES]);
    expect(templates).toContain(
      "- **Your plan.** On OneUptime Cloud, templates take the **Growth** plan or above.",
    );
    expect(templates).toContain(
      `- **Your role.** Creating a template takes ${listed([...ROLE_NAMES], "or")}, or a custom role that may create scheduled maintenance templates.`,
    );
  });

  it("walk the form's steps: Template Info, Event, Resources Affected, Recurring - Status Pages on the view page's Edit", () => {
    expect(TEMPLATES_PAGE).toContain(
      '{\n      title: "Template Info",\n      id: "template-info",\n    },\n    {\n      title: "Event",\n      id: "event",\n    },\n    {\n      title: data.excludeAffectedResources\n        ? "Status Pages"\n        : "Resources Affected",\n      id: "resources-affected",\n    },\n    {\n      title: "Recurring",\n      id: "recurring",\n    },',
    );
    expect(TEMPLATE_VIEW_PAGE).toContain("excludeAffectedResources: true,");
    expect(templates).toContain(
      "Its **Edit** walks **Template Info**, **Event**, **Status Pages** and **Recurring**.",
    );
  });

  it("asks for a name and a description, both required, on Template Info", () => {
    for (const title of ["Template Name", "Template Description"]) {
      const field: string = fieldObject(TEMPLATES_PAGE, title);

      expect(stepOf(field)).toBe("template-info");
      expect(field).toContain("required: true");
    }

    expect(templates).toContain(
      "On **Template Info**, give it a **Template Name** and a **Template Description**, so your team knows when to use it. Both are required.",
    );
  });

  it("is created from the Event Templates page by its create button", () => {
    expect(sectionByTitle(maintenanceMenu(), "Settings").items).toContain(
      "Event Templates",
    );
    expect(`Create ${new ScheduledMaintenanceTemplate().singularName}`).toBe(
      "Create Scheduled Maintenance Template",
    );
    expect(templates).toContain(
      "Go to **Scheduled Maintenance → Settings → Event Templates**. **Settings** starts folded in the side menu: expand it first. Click **Create Scheduled Maintenance Template**.",
    );
  });

  it("always asks for Change Monitor Status to, and takes five kinds of other affected resource", () => {
    const status: string = fieldObject(
      TEMPLATES_PAGE,
      "Change Monitor Status to",
    );
    const others: string = fieldObject(
      TEMPLATES_PAGE,
      "Other Affected Resources",
    );

    expect(status).not.toContain("showIf");
    expect(others).toContain(
      '"Host",\n                "KubernetesCluster",\n                "DockerHost",\n                "PodmanHost",\n                "Service",',
    );
    expect(templates).toContain(
      "A template asks for **Change Monitor Status to** even when it names no monitors: the status also applies to the monitors you add when you schedule an event from it. Under **Other Affected Resources**, a template takes hosts, Kubernetes clusters, Docker hosts, Podman hosts and services.",
    );
  });

  it("fill in the create form with everything but the window", () => {
    const fill: string = CREATE_PAGE.slice(
      CREATE_PAGE.indexOf("monitors: scheduledMaintenanceTemplate.monitors"),
      CREATE_PAGE.indexOf(
        "setInitialValuesForScheduledMaintenance(initialValue);",
      ),
    );

    for (const fieldName of [
      "monitors:",
      "hosts:",
      "statusPages:",
      "labels:",
      "ownerUsers:",
      "ownerTeams:",
    ]) {
      expect(fill).toContain(fieldName);
    }

    expect(CREATE_PAGE).not.toContain("firstEventStartsAt");
    expect(section(templates, "## What a template fills in")).toContain(
      "| **Starts At** and **Ends At**                     | The next full hour, for an hour      | Worked out from the schedule    |",
    );
  });

  it("say so when the project has none, and link to Event Templates", () => {
    expect(LIST_TABLE).toContain(
      'description="This project has no scheduled maintenance templates yet. Create them in Scheduled Maintenance → Settings → Event Templates."',
    );
    expect(LIST_TABLE).toContain(
      "PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES",
    );
    expect(templates).toContain(
      "When the project has no template yet, **Create from Template** says so, and links to **Event Templates**.",
    );
  });

  it("keep the events they made when deleted: an event holds no link to its template", () => {
    expect(
      readCommonSource("Models/DatabaseModels/ScheduledMaintenance.ts"),
    ).not.toContain("ScheduledMaintenanceTemplate");
    expect(templates).toContain(
      "Deleting a template leaves the events it created.",
    );
  });

  it("show what new events start with on the template's own page, its resources and its owners", () => {
    expect(TEMPLATE_VIEW_PAGE).toContain(
      'title: "Scheduled Maintenance Template Details",',
    );
    expect(TEMPLATE_VIEW_PAGE).toContain('title: "Affected Resources",');
    expect(TEMPLATE_VIEW_PAGE).toContain("<OwnersCard<");
    expect(TEMPLATE_VIEW_PAGE).toContain(
      'description="People and teams who own every event scheduled from this template. They are added as the event\'s owners and notified."',
    );
    expect(templates).toContain(
      "- **Owners** lists the people and teams who own every event scheduled from it.",
    );
  });
});

describe("recurring events", () => {
  const templates: string = english(TEMPLATES_AND_RECURRING);
  const recurring: string = section(templates, "## Recurring events");
  const recurringJob: string = readWorkerSource(
    "ScheduledMaintenance/ScheduleRecurringEvents.ts",
  );
  // The templates the job reads: recurring ones whose next time has come.
  const RECURRING_TEMPLATES_QUERY: string =
    "query: {\n          isRecurringEvent: true,\n          scheduleNextEventAt: QueryHelper.lessThanEqualTo(";

  it("asks for the schedule on the Recurring step, only once Recurring Event is on", () => {
    expect(stepOf(fieldObject(TEMPLATES_PAGE, "Recurring Event"))).toBe(
      "recurring",
    );

    for (const title of [
      "First Event Scheduled At",
      "First Event Starts At",
      "First Event Ends At",
      "How often should this event recur?",
    ]) {
      const field: string = fieldObject(TEMPLATES_PAGE, title);

      expect(stepOf(field)).toBe("recurring");
      expect(field).toContain("showIf: isRecurring,");
    }

    expect(firstColumn(recurring)).toEqual([
      "**Recurring Event**",
      "**First Event Scheduled At**",
      "**First Event Starts At**",
      "**First Event Ends At**",
      "**How often should this event recur?**",
    ]);
  });

  /*
   * The picker offers every EventInterval (RecurringFieldElement), so the
   * sentence is built from EventInterval here: a unit added there fails
   * until the field's description and the page both name it.
   */
  it("repeats every interval the schedule offers, in the words the field's description uses", () => {
    const units: Array<string> = Object.values(EventInterval).map(
      (interval: EventInterval): string => {
        return `${interval.toLowerCase()}s`;
      },
    );
    const sentence: string = `A number and a unit: ${units.slice(0, -1).join(", ")} or ${units[units.length - 1]}.`;
    const field: string = fieldObject(
      TEMPLATES_PAGE,
      "How often should this event recur?",
    );
    const row: Array<string> | undefined = tableRows(recurring)
      .map(tableCells)
      .find((cells: Array<string>): boolean => {
        return cells[0] === "**How often should this event recur?**";
      });

    expect(
      readCommonSource("UI/Components/Events/RecurringFieldElement.tsx"),
    ).toContain(
      "options={DropdownUtil.getDropdownOptionsFromEnum(EventInterval)}",
    );
    expect(field.match(FIELD_DESCRIPTION)?.[1]).toBe(sentence);
    expect(row?.[1]).toBe(sentence);
  });

  it("refuses a schedule out of order, and, on a new template, times in the past", () => {
    const create: string = TEMPLATE_SERVICE.slice(
      TEMPLATE_SERVICE.indexOf("public validateEventTemplate("),
      TEMPLATE_SERVICE.indexOf("public getNextEventTime("),
    );
    const update: string = TEMPLATE_SERVICE.slice(
      TEMPLATE_SERVICE.indexOf("protected override async onBeforeUpdate("),
    );

    for (const message of [
      "Start date should be in the future.",
      "End date should be in the future.",
      "Scheduled time should be in the future.",
    ]) {
      expect(create).toContain(message);
      expect(update).not.toContain(message);
    }

    for (const message of [
      "Scheduled time should be less than start date.",
      "Scheduled time should be less than end date.",
      "Start date should be less than end date.",
    ]) {
      expect(create).toContain(message);
      expect(update).toContain(message);
    }

    expect(TEMPLATE_SERVICE).toContain(
      "this.validateEventTemplate(createBy.data);",
    );
    expect(templates).toContain(
      "All three times must be in the future when you create the template, the event has to be created before it starts and ends, and it has to start before it ends; the form says which rule a time breaks.",
    );
    expect(
      detailsBody(
        templates,
        "Creating a recurring template says a time should be in the future",
      ),
    ).toContain(
      "All three first times have to be ahead of now when you create it.",
    );
  });

  it("is run every minute: the job moves a template's next time on by one interval and creates the event", () => {
    expect(recurringJob).toContain(
      "{ schedule: EVERY_MINUTE, runOnStartup: false }",
    );
    expect(recurringJob).toContain(RECURRING_TEMPLATES_QUERY);
    expect(
      inOrder(
        positionsIn(recurringJob, [
          "scheduleNextEventAt: nextScheduledTime,",
          "scheduledMaintenanceEvent = await ScheduledMaintenanceService.create({",
        ]),
      ),
    ).toBe(true);
    expect(recurring).toContain(
      "A job checks the recurring templates every minute. When a template's next time comes, it moves that time on by one interval and creates the event.",
    );
  });

  it("keeps each event's distances from the first one, one interval later", () => {
    expect(recurringJob).toContain(
      "scheduledMaintenanceEvent.startsAt = OneUptimeDate.addRemoveMinutes(\n          eventscheduledTime,\n          minutesBetwenScheduledAndStartTime,",
    );
    expect(recurringJob).toContain(
      "scheduledMaintenanceEvent.endsAt = OneUptimeDate.addRemoveMinutes(\n          eventscheduledTime,\n          minutesBetweenScheduledAndEndTime,",
    );
    expect(recurring).toContain(
      "every later event keeps the same distances, one interval later.",
    );
  });

  it("copies the template into each event, owners included", () => {
    for (const copied of [
      "scheduledMaintenanceEvent.title = recurringTemplate.title!;",
      "scheduledMaintenanceEvent.description = recurringTemplate.description!;",
      "scheduledMaintenanceEvent.changeMonitorStatusToId =",
      "scheduledMaintenanceEvent.monitors =",
      "scheduledMaintenanceEvent.hosts =",
      "scheduledMaintenanceEvent.statusPages =",
      "scheduledMaintenanceEvent.labels =",
      "scheduledMaintenanceEvent.shouldStatusPageSubscribersBeNotifiedOnEventCreated =",
      "await OwnerRuleAssignment.createOwner({",
    ]) {
      expect(recurringJob).toContain(copied);
    }

    expect(section(templates, "## What a template fills in")).toContain(
      "| **Owners** and **Labels**                         | Filled in                            | Copied                          |",
    );
  });

  it("shows the next time in the templates list's Recurring Event column, and No for a template that does not recur", () => {
    const column: string = fieldObject(TEMPLATES_PAGE, "Recurring Event");
    const listColumn: string = TEMPLATES_PAGE.slice(
      TEMPLATES_PAGE.indexOf(
        '{\n            field: {\n              scheduleNextEventAt: true,\n            },\n            title: "Recurring Event",',
      ),
    );

    expect(column).toBeTruthy();
    expect(listColumn).toContain(
      "const nextEventAt: Date | null = getTemplateNextEventAt(item);",
    );
    expect(listColumn).toContain('translator.translateText("No")');
    // The list reads the switch beside the time, as the job does.
    expect(TEMPLATES_PAGE).toContain(
      "selectMoreFields={{\n          // The Recurring Event column reads the switch beside the next time.\n          isRecurringEvent: true,\n        }}",
    );
    expect(
      getTemplateNextEventAt({
        isRecurringEvent: false,
        scheduleNextEventAt: new Date("2030-06-10T09:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      getTemplateNextEventAt({
        isRecurringEvent: true,
        scheduleNextEventAt: new Date("2030-06-10T09:00:00.000Z"),
      }),
    ).toEqual(new Date("2030-06-10T09:00:00.000Z"));
    expect(recurring).toContain(
      `The templates list shows that time in its **Recurring Event** column, and **No** for a template that does not recur.`,
    );
  });

  it("stops when Recurring Event is turned off or the template is deleted", () => {
    expect(recurringJob).toContain(RECURRING_TEMPLATES_QUERY);
    expect(templates).toContain(
      "To stop a schedule, turn **Recurring Event** off in **Edit**, or delete the template.",
    );
  });

  /*
   * Turned off, the service clears the template's next time and nothing
   * else; turned back on, it works the next time out from the first event,
   * the schedule's next time after now (Recurring.getNextDate).
   */
  it("keeps the schedule of a template turned off, and picks it up at its next time when it is turned back on", () => {
    const update: string = TEMPLATE_SERVICE.slice(
      TEMPLATE_SERVICE.indexOf("protected override async onBeforeUpdate("),
      TEMPLATE_SERVICE.indexOf(
        "private async validateProjectScopedReferences(",
      ),
    );

    expect(update).toContain(
      "if (!anyTemplateRecurs && (anyTemplateHoldsANextTime || writesANextTime)) {\n      newTemplate.scheduleNextEventAt = null;\n    }",
    );

    for (const kept of [
      "firstEventScheduledAt",
      "firstEventStartsAt",
      "firstEventEndsAt",
      "recurringInterval",
    ]) {
      expect(update).not.toContain(`newTemplate.${kept} =`);
    }
    expect(update).toContain(
      "newTemplate.scheduleNextEventAt = this.getNextEventTime({\n            dateAndTime: firstEventScheduledAt,\n            recurringInterval: recurringInterval,\n          });",
    );
    expect(TEMPLATE_SERVICE).toContain(
      "return Recurring.getNextDate(data.dateAndTime, data.recurringInterval);",
    );
    expect(templates).toContain(
      "A template turned off keeps its schedule: turn it back on, and it picks up at the schedule's next time, skipping the times it was off.",
    );
  });
});

// ---- Rules and settings ----------------------------------------------------------------

describe("where maintenance settings live", () => {
  const settings: string = english(RULES_AND_SETTINGS);
  const where: string = section(settings, "## Where maintenance settings live");

  it("has a row per Rules page, in the menu's order", () => {
    expect(firstColumn(where)).toEqual(
      sectionByTitle(maintenanceMenu(), "Rules").items.map(
        (item: string): string => {
          return `**${item}**`;
        },
      ),
    );
  });

  it("lists the Settings section's pages in the menu's order", () => {
    const items: Array<string> = sectionByTitle(
      maintenanceMenu(),
      "Settings",
    ).items;

    expect(items).toEqual([
      "Event State",
      "Event Templates",
      "Note Templates",
      "Custom Fields",
      "Measurements",
      "Calendar Settings",
      "Numbering",
    ]);
    expect(
      inOrder(
        positionsIn(
          where,
          items.map((item: string): string => {
            return `**${item}**`;
          }),
        ),
      ),
    ).toBe(true);
  });

  it("puts every Rules and Settings page at the address the page gives", () => {
    const routes: Array<string> = routeGroup(
      "ScheduledMaintenanceEventsRoutePath",
    );
    const keys: Array<string> = Array.from(
      MAINTENANCE_MENU_SOURCE.matchAll(
        /PageMap\.(SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_\w+)/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const routeMap: string = readDashboardSource("Utils/RouteMap.ts");

    // Four Rules pages and seven Settings pages, Calendar Settings among them.
    expect(keys.length).toBe(11);
    expect(keys).toContain("SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR");

    for (const key of keys) {
      const route: string =
        routeMap.match(
          new RegExp(`\\[PageMap\\.${escapeRegExp(key)}\\]:\\s*"([^"]+)"`),
        )?.[1] || "";

      expect({ key, settings: route.startsWith("settings/") }).toEqual({
        key,
        settings: true,
      });
      expect(routes).toContain(route);
    }

    expect(where).toContain(
      "at an address beginning `/dashboard/{projectId}/scheduled-maintenance-events/settings/`.",
    );
  });
});

describe("the rules a new event passes through", () => {
  const settings: string = english(RULES_AND_SETTINGS);
  const passes: string = section(
    settings,
    "## The rules a new event passes through",
  );

  it("draws them in the order a new event meets them", () => {
    expect(
      inOrder(
        positionsIn(createSuccessSteps(EVENT_SERVICE), [
          "ScheduledMaintenanceOwnerRuleEngineService.applyRulesToScheduledMaintenance(",
          "ScheduledMaintenanceLabelRuleEngineService.applyRulesToScheduledMaintenance(",
          "RunbookRuleEngineService.applyRulesToScheduledMaintenance(",
          "this.refreshReminderSchedule({",
        ]),
      ),
    ).toBe(true);
    expect(
      inOrder(
        positionsIn(passes, [
          'owners["Owner rules<br/>add owners"]',
          'labels["Label rules<br/>add labels"]',
          'runbooks["Runbook rules<br/>start runbooks"]',
          'reminders["Reminder rules<br/>schedule reminders"]',
        ]),
      ),
    ).toBe(true);
  });

  it("checks reminder rules in their order, first match winning, and puts a new one at the end", () => {
    expect(REMINDER_RULE_SERVICE).toContain(
      "// Get all enabled rules sorted by order. First matching rule wins.",
    );
    expect(REMINDER_RULES_PAGE).toContain(
      "drag it up or down. A new rule goes to the end.",
    );
    expect(passes).toContain(
      "- **Reminder Rules** are checked from the top of their list down, and the first match wins. Drag a rule to change its place; a new rule goes to the end.",
    );
  });

  it("fires every matching owner, label and runbook rule, adding each owner and label once", () => {
    expect(OWNER_RULES_PAGE).toContain(
      "Already-assigned owners are not duplicated.",
    );
    expect(OWNER_RULES_PAGE).toContain("Multiple matching rules all fire");
    expect(passes).toContain(
      "- **Owner Rules**, **Label Rules** and **Runbook Rules** all act when they match. Owners and labels that several rules add are added once.",
    );
  });

  it("starts a rule enabled, shows Enabled or Disabled, and runs owner and label rules on existing events with Run Now", () => {
    const ruleTable: string = readCommonSource(
      "UI/Components/RuleRun/RuleTable.tsx",
    );
    const ruleRun: string = readCommonSource("Types/Rules/RuleRun.ts");

    expect(ruleTable).toContain(
      "Every rule starts on: the create form leaves out the rule's Enabled\n * switch, which stays on the edit form and in the table (RuleEnabledField).",
    );
    expect(ruleTable).toContain('title: "Run Now",');
    expect(ruleRun).toContain(
      'ScheduledMaintenanceLabelRule = "ScheduledMaintenanceLabelRule",',
    );
    expect(ruleRun).toContain(
      'ScheduledMaintenanceOwnerRule = "ScheduledMaintenanceOwnerRule",',
    );
    expect(OWNER_RULES_PAGE).toContain('<Pill color={Green} text="Enabled" />');
    expect(OWNER_RULES_PAGE).toContain('<Pill color={Red} text="Disabled" />');
    expect(passes).toContain(
      "A new rule starts enabled; switch **Enabled** off on its edit form to pause it, and the list shows a green **Enabled** or red **Disabled** for each rule.",
    );
  });
});

describe("owner and label rules", () => {
  const rules: string = section(
    english(RULES_AND_SETTINGS),
    "## Owner and label rules",
  );

  it("walk two steps, Match then Owners or Labels", () => {
    expect(RULE_FORM).toContain(
      '{ title: "Match", id: "match-criteria" },\n    { title: "Labels", id: "labels" },',
    );
    expect(RULE_FORM).toContain(
      '{ title: "Match", id: "match-criteria" },\n    { title: "Owners", id: "owners" },',
    );
    expect(rules).toContain(
      "Creating one takes two steps: **Match**, the conditions, then **Owners** or **Labels**, what the rule adds.",
    );
  });

  it("match on the conditions the table lists, the patterns as case-insensitive regular expressions", () => {
    for (const page of [OWNER_RULES_PAGE, LABEL_RULES_PAGE]) {
      const titles: Array<string> = quotedTitles(
        page.slice(page.indexOf("formFields={[")),
      ).filter((title: string): boolean => {
        return [
          "Monitors",
          "Event Labels",
          "Monitor Labels",
          "Event Title",
          "Event Description",
          "Monitor Name",
          "Monitor Description",
        ].includes(title);
      });

      expect(titles).toEqual([
        "Monitors",
        "Event Labels",
        "Monitor Labels",
        "Event Title",
        "Event Description",
        "Monitor Name",
        "Monitor Description",
      ]);
      expect(page).toContain(
        '"Case-insensitive regex matched against event and monitor text."',
      );
    }

    expect(firstColumn(rules)).toEqual([
      "**Monitors**, **Event Labels**, **Monitor Labels**",
      "**Event Title**, **Event Description**, **Monitor Name**, **Monitor Description**",
    ]);
    expect(rules).toContain(
      "A pattern, as a regular expression, ignoring case.",
    );
  });

  it("match only when every condition filled in holds", () => {
    expect(OWNER_RULES_PAGE).toContain(
      "A rule matches an event only when **all** specified criteria pass. Empty criteria are skipped.",
    );
    expect(rules).toContain(
      "A rule matches only when every condition you fill in holds; a condition left empty is skipped.",
    );
  });

  it("fold six inherit switches, and refuse a new rule that adds nothing", () => {
    expect(RULE_FORM).toContain('title: "Inherit Labels",');
    expect(RULE_FORM).toContain('title: "Inherit Owners",');
    expect(OWNER_RULES_PAGE.match(/`Inherit Owners From [^`]+`/g)?.length).toBe(
      6,
    );
    expect(RULE_FORM).toContain("A new rule must add something:");
    expect(rules).toContain(
      "- **A rule can inherit.** Folded under **Inherit Owners** or **Inherit Labels**, six switches hand on the owners or labels of the event's monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts and services.",
    );
  });

  it("fold Notify Owners under More fields on an owner rule", () => {
    expect(RULE_FORM).toContain('title: "Notify Owners",');
    expect(RULE_FORM).toContain(
      "Notify Owners, on as the server starts it - fold under More fields,",
    );
    expect(rules).toContain(
      "- **Notify Owners**, under **More fields** on an owner rule, decides whether the people added are told.",
    );
  });
});

describe("runbook rules for maintenance", () => {
  it("offer no severity, as events have none, and attach the run to the event's Runbooks page", () => {
    const runbookRules: string = readDashboardSource(
      "Components/Runbook/RunbookRulesTable.tsx",
    );

    expect(runbookRules).toContain(
      "...(props.triggerEntityType === RunbookRuleTriggerEntity.Incident",
    );
    expect(runbookRules).toContain(
      "...(props.triggerEntityType === RunbookRuleTriggerEntity.Alert",
    );
    expect(eventMenu()[0]?.items).toContain("Runbooks");
    expect(section(english(RULES_AND_SETTINGS), "## Runbook rules")).toContain(
      "events have no severity, so maintenance runbook rules do not offer one. The run is attached to the event, on its **Runbooks** page.",
    );
  });
});

describe("reminder rules", () => {
  const reminders: string = section(
    english(RULES_AND_SETTINGS),
    "## Reminder rules",
  );
  const rule: ScheduledMaintenanceReminderRule =
    new ScheduledMaintenanceReminderRule();

  it("walk Match and Reminders, with the fields the steps name", () => {
    const form: string = readDashboardSource("Utils/Form/EventRuleForm.ts");
    const fields: string = readDashboardSource(
      "Components/Reminders/MaintenanceReminderRuleFields.tsx",
    );

    expect(REMINDER_RULES_PAGE).toContain(
      "formSteps={getReminderRuleFormSteps<ScheduledMaintenanceReminderRule>()}",
    );
    expect(REMINDER_RULES_PAGE).toContain(
      "...getMaintenanceReminderRuleActionFields()",
    );
    expect(form).toContain('{ title: "Match", id: "match-criteria" },');
    expect(form).toContain('{ title: "Reminders", id: "reminder-settings" },');

    expect(
      stepOf(
        fieldObject(
          REMINDER_RULES_PAGE.slice(
            REMINDER_RULES_PAGE.indexOf("formFields={["),
          ),
          "Labels",
        ),
      ),
    ).toBe("match-criteria");

    for (const title of [
      "Reminder Interval (minutes)",
      "Name",
      "Description",
    ]) {
      expect({ title, step: stepOf(fieldObject(fields, title)) }).toEqual({
        title,
        step: "reminder-settings",
      });
    }

    // The one choice, Remind Owners, on the same step.
    expect(fields).toContain("title: MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,");
    expect(
      readDashboardSource("Components/Reminders/MaintenanceReminderTiming.ts"),
    ).toContain('translationKey("Remind Owners")');

    expect(`Create ${rule.singularName}`).toBe(
      "Create Scheduled Maintenance Reminder Rule",
    );
    expect(reminders).toContain(
      "Click **Create Scheduled Maintenance Reminder Rule**. On **Match**, leave **All scheduled maintenance events** picked",
    );
    expect(reminders).toContain(
      'pick when to remind them under **Remind Owners**. Its **Name** follows both, such as "Remind every 30 minutes while it is in progress"',
    );
    expect(reminders).not.toContain("**Rule Info**");
  });

  it("name the three answers of Remind Owners, the columns' defaults first", () => {
    const timing: string = readDashboardSource(
      "Components/Reminders/MaintenanceReminderTiming.ts",
    );

    expect(
      rule.getTableColumnMetadata("stopRemindersOnState").defaultValue,
    ).toBe(ScheduledMaintenanceReminderStopState.Completed);
    expect(
      rule.getTableColumnMetadata("remindWhileScheduled").defaultValue,
    ).toBe(false);
    expect(rule.getTableColumnMetadata("isEnabled").defaultValue).toBe(true);
    // A new rule's answer is the pair the columns start as.
    expect(timing).toContain(
      "[MaintenanceReminderTiming.WhileInProgress]: {\n    remindWhileScheduled: false,\n    stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,",
    );
    expect(timing).toContain(
      "export const DEFAULT_MAINTENANCE_REMINDER_TIMING: MaintenanceReminderTiming =\n  MaintenanceReminderTiming.WhileInProgress;",
    );

    const answers: Array<[string, string]> = [
      ["While it is in progress", "From when the event starts until it ends."],
      ["Before it starts", "From when the event is scheduled until it starts."],
      [
        "Before it starts and while it is in progress",
        "From when the event is scheduled until it ends.",
      ],
    ];

    expect(firstColumn(reminders)).toEqual(
      answers.map(([answer]: [string, string]): string => {
        return `**${answer}**`;
      }),
    );

    for (const [answer, description] of answers) {
      expect(timing).toContain(`title: translationKey("${answer}"),`);
      expect(timing).toContain(`"${description}"`);
      expect(reminders).toContain(`| **${answer}** | ${description}`);
    }

    /*
     * The API and Terraform refuse such a rule (ScheduledMaintenanceReminder
     * NeverReminds); the list marks one saved before, as it marks a label
     * rule that adds nothing.
     */
    expect(reminders).toContain(
      "The API and Terraform refuse a rule that would wait for the event to start and stop when it starts: it would never send a reminder. An older rule saved that way is marked **Never reminds** in the list, and its form asks you to pick when to remind.",
    );
    expect(
      readCommonSource(
        "Server/Services/ScheduledMaintenanceReminderRuleService.ts",
      ),
    ).toContain("SCHEDULED_MAINTENANCE_REMINDER_TIMING_RULE,");
    expect(
      readCommonSource(
        "Types/Reminder/ScheduledMaintenanceReminderNeverReminds.ts",
      ),
    ).toContain(
      "values.remindWhileScheduled !== true &&\n    values.stopRemindersOnState ===\n      ScheduledMaintenanceReminderStopState.Ongoing",
    );
    expect(timing).toContain(
      'export const MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT: string =\n  translationKey("Never reminds");',
    );
    expect(
      readDashboardSource(
        "Components/Reminders/MaintenanceReminderTimingText.tsx",
      ),
    ).toContain("text={MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT}");
    expect(timing).toContain(
      '"This rule never sends a reminder: it waits for the event to start and stops when it starts. Pick when to remind."',
    );
  });

  it("reach owners as Maintenance reminder, on by email for every new member", () => {
    const notificationSettings: string = readCommonSource(
      "Server/Services/UserNotificationSettingService.ts",
    );

    expect(
      readDashboardSource("Pages/UserSettings/NotificationSettings.tsx"),
    ).toContain(
      '[NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION]:\n    {\n      label: "Maintenance reminder",',
    );
    expect(notificationSettings).toContain(
      "private async addScheduledMaintenanceNotificationSettings(",
    );
    expect(notificationSettings).toContain("item.alertByEmail = true;");
    expect(reminders).toContain(
      "Owners get each reminder as **Maintenance reminder**, which is on by email for every new member.",
    );
  });

  it("re-match every event not completed when a rule is saved, changed or deleted", () => {
    for (const hook of [
      "onCreateSuccess(",
      "onUpdateSuccess(",
      "onDeleteSuccess(",
    ]) {
      const at: number = REMINDER_RULE_SERVICE.indexOf(
        `protected override async ${hook}`,
      );

      expect(at).toBeGreaterThanOrEqual(0);
      expect(REMINDER_RULE_SERVICE.slice(at, at + 600)).toContain(
        "this.refreshSchedulesForOpenScheduledMaintenances(",
      );
    }

    expect(REMINDER_RULE_SERVICE).toContain(
      "(ScheduledMaintenanceStartUtil.isComplete) - the rule that stops the",
    );
    expect(reminders).toContain(
      "Saving, changing or deleting a reminder rule matches every event that is not completed again.",
    );
  });
});

describe("the Settings section's pages", () => {
  const settings: string = english(RULES_AND_SETTINGS);
  const settingsSection: string = section(settings, "## Settings");

  it("name the note template card, create button and fields, offered on notes and state changes", () => {
    expect(NOTE_TEMPLATES_PAGE).toContain(
      '"Public or Private Note Templates for Scheduled Maintenance Events",',
    );
    expect(NOTE_TEMPLATES_PAGE).toContain(
      "Pick one when writing a public or private note on a scheduled maintenance event, or when changing its state, and edit it before posting.",
    );
    expect(
      `Create ${new ScheduledMaintenanceNoteTemplate().singularName}`,
    ).toBe("Create Scheduled Maintenance Note Template");
    expect(
      quotedTitles(
        NOTE_TEMPLATES_PAGE.slice(
          NOTE_TEMPLATES_PAGE.indexOf("formFields={["),
          NOTE_TEMPLATES_PAGE.indexOf("showRefreshButton"),
        ),
      ),
    ).toEqual(["Template Name", "Template Description"]);
    expect(
      readDashboardSource("Components/NoteTemplate/NoteTemplateFormCopy.ts"),
    ).toContain('noteFieldTitle: "Note",');
    expect(settingsSection).toContain(
      "**Create Scheduled Maintenance Note Template** asks for a **Template Name**, a **Template Description** and the **Note**.",
    );
  });

  it("fill in no variables on a maintenance note template, unlike an incident's", () => {
    expect(
      readDashboardSource("Pages/Incidents/Settings/IncidentNoteTemplates.tsx"),
    ).toContain("templateVariables: noteTemplateVariables.groups,");
    expect(NOTE_TEMPLATES_PAGE).not.toContain("templateVariables");
    expect(settingsSection).toContain(
      "Unlike incident note templates, maintenance note templates fill in no variables.",
    );
  });

  it("take custom field values on the event's page or through the API, and copy them from a monitor's", () => {
    expect(
      new ScheduledMaintenance().getTableColumnMetadata("customFields"),
    ).toBeTruthy();
    expect(eventMenu()[eventMenu().length - 1]?.items).toContain(
      "Custom Fields",
    );
    expect(
      readCommonSource(
        "Server/Utils/CustomField/CustomFieldMappingRegistry.ts",
      ),
    ).toContain('targetName: "Scheduled Maintenance",');
    expect(settingsSection).toContain(
      "Fill them in on an event's **Custom Fields** page, or through the API as `customFields`. A field can copy its value from a monitor custom field instead of being typed in",
    );
  });

  it("offer the measurement presets the page names, and chart each under its metric", () => {
    const presets: Array<string> = getMeasurementPresets(
      MeasurementDomain.ScheduledMaintenance,
    ).map((preset: MeasurementPreset): string => {
      return preset.name;
    });

    expect(presets).toEqual([
      "Start delay",
      "Overrun",
      "Maintenance duration",
      "Something else",
    ]);
    expect(
      readCommonSource(
        "Server/Services/ScheduledMaintenanceMeasurementService.ts",
      ),
    ).toContain('"oneuptime.scheduled-maintenance.measurement.";');
    expect(settingsSection).toContain(
      "Pick **Start delay**, from the planned start until the event starts, **Overrun**, from the planned end until it ends, or **Maintenance duration**, from when it starts until it ends; or two moments of your own with **Something else**. Each measurement is shown on the event's page and charted as `oneuptime.scheduled-maintenance.measurement.<key>`.",
    );
  });

  it("set the number prefix with Update, previewing the number, for new events only", () => {
    const prefixSettings: string = readDashboardSource(
      "Components/NumberPrefix/NumberPrefixSettings.ts",
    );
    const prefixCard: string = readDashboardSource(
      "Components/NumberPrefix/NumberPrefixCard.tsx",
    );

    expect(NumberPrefixUtil.formatNumber(null, 42)).toBe("#42");
    expect(NumberPrefixUtil.formatNumber(MAINTENANCE_NUMBER_PREFIX, 42)).toBe(
      "SM-42",
    );
    expect(prefixSettings).toContain(
      'export const NUMBER_PREFIX_EDIT_BUTTON_TITLE: string = "Update";',
    );
    expect(prefixSettings).toContain(
      'formTitle: "Scheduled Maintenance Number Prefix",',
    );
    expect(prefixSettings).toContain(
      '"Only new events use the new prefix. Existing ones keep their numbers.",',
    );
    expect(prefixCard).toContain("<NumberPrefixPreview");
    expect(settingsSection).toContain(
      "sets the text in front of event numbers: `SM-` in a new project, or `#` with none. **Update** asks for the **Scheduled Maintenance Number Prefix**, and previews the number as you type. Only events created afterwards get the new prefix; existing ones keep their numbers.",
    );
  });

  /*
   * Numbering holds the Next Number card under the prefixes: the number the
   * next event gets, for a team carrying on from another tool's numbers.
   * The rules are the incidents' rules, on the page the paragraph links to.
   */
  it("set the next event number on the Next Number card, above the highest used", () => {
    const nextNumbers: string = readDashboardSource(
      "Components/NextNumber/NextNumberSettings.ts",
    );
    const maintenancePage: string = nextNumbers.slice(
      nextNumbers.indexOf("export const SCHEDULED_MAINTENANCE_NEXT_NUMBERS"),
      nextNumbers.indexOf("export const NEXT_NUMBER_PAGES"),
    );

    expect(nextNumbers).toContain(
      'export const NEXT_NUMBER_CARD_TITLE: string = translationKey("Next Number");',
    );
    expect(nextNumbers).toContain(
      'export const NEXT_NUMBER_EDIT_BUTTON_TITLE: string = translationKey("Update");',
    );
    expect(maintenancePage).toContain(
      'formTitle: translationKey("Next Scheduled Maintenance Number"),',
    );
    expect(
      readDashboardSource(
        "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumbering.tsx",
      ),
    ).toContain("nextNumbers={SCHEDULED_MAINTENANCE_NEXT_NUMBERS}");
    expect(settingsSection).toContain(
      "**Scheduled Maintenance → Settings → Numbering** sets the text in front of event numbers",
    );
    expect(settingsSection).toContain(
      "The **Next Number** card under it sets the number the next event gets, to carry on from another tool's numbers: **Update** opens **Next Scheduled Maintenance Number**, which must be higher than the highest used so far. See [Next numbers](/docs/incidents/settings#next-numbers).",
    );
  });

  it("need Growth for custom fields, maintenance states and templates", () => {
    for (const model of [
      new ScheduledMaintenanceCustomField(),
      new ScheduledMaintenanceState(),
      new ScheduledMaintenanceTemplate(),
    ] as Array<DatabaseBaseModel>) {
      expect({
        table: model.tableName,
        plan: model.getCreateBillingPlan(),
      }).toEqual({ table: model.tableName, plan: PlanType.Growth });
    }

    expect(settingsSection).toContain(
      "> On OneUptime Cloud, custom fields take the **Growth** plan or above, and so do adding and changing maintenance states and templates.",
    );
  });
});

describe("workflows for maintenance", () => {
  const workflows: string = section(
    english(RULES_AND_SETTINGS),
    "## Workflows",
  );

  it("names the triggers and actions as the workflow builder titles them", () => {
    const titles: Array<string> = componentTitles(new ScheduledMaintenance());

    for (const component of WORKFLOW_COMPONENTS) {
      expect(titles).toContain(component);
      expect(workflows).toContain(`**${component}**`);
    }

    expect(componentTitles(new ScheduledMaintenanceStateTimeline())).toContain(
      "On Create Scheduled Maintenance State Timeline",
    );
    expect(workflows).toContain(
      "the same for **Scheduled Maintenance State Timeline** and the others",
    );
  });

  it("gives custom field definitions and measurement values no workflow steps", () => {
    expect(componentTitles(new ScheduledMaintenanceCustomField())).toEqual([]);
    expect(componentTitles(new ScheduledMaintenanceMeasurementValue())).toEqual(
      [],
    );
    expect(
      componentTitles(new ScheduledMaintenanceMeasurement()).length,
    ).toBeGreaterThan(0);
    expect(workflows).toContain(
      "Custom field definitions and measurement values are the exceptions: they have no workflow steps.",
    );
  });
});

describe("who can change maintenance", () => {
  const who: string = section(
    english(RULES_AND_SETTINGS),
    "## Who can change these",
  );

  // Whether a role is among each of a model's create, update and delete permissions.
  function changes(model: DatabaseBaseModel, role: Permission): boolean {
    return [
      model.getCreatePermissions(),
      model.getUpdatePermissions(),
      model.getDeletePermissions(),
    ].every((permissions: Array<Permission>): boolean => {
      return permissions.includes(role);
    });
  }

  const memberModels: Array<DatabaseBaseModel> = [
    new ScheduledMaintenance(),
    new ScheduledMaintenancePublicNote(),
    new ScheduledMaintenanceInternalNote(),
    new ScheduledMaintenanceStateTimeline(),
    new ScheduledMaintenanceOwnerUser(),
    new ScheduledMaintenanceOwnerTeam(),
    new ScheduledMaintenanceTemplate(),
    new ScheduledMaintenanceNoteTemplate(),
  ];
  const projectAdminModels: Array<DatabaseBaseModel> = [
    new ScheduledMaintenanceOwnerRule(),
    new ScheduledMaintenanceLabelRule(),
    new ScheduledMaintenanceReminderRule(),
    new ScheduledMaintenanceCustomField(),
    new ScheduledMaintenanceMeasurement(),
  ];

  it("lets a viewer read events and change nothing", () => {
    expect(new ScheduledMaintenance().getReadPermissions()).toContain(
      Permission.ScheduledMaintenanceViewer,
    );

    for (const model of [
      ...memberModels,
      ...projectAdminModels,
      new ScheduledMaintenanceState(),
    ]) {
      expect({
        table: model.tableName,
        creates: model
          .getCreatePermissions()
          .includes(Permission.ScheduledMaintenanceViewer),
      }).toEqual({ table: model.tableName, creates: false });
    }

    expect(who).toContain(
      "| **Scheduled Maintenance Viewer**  | Reads events, and changes nothing.",
    );
  });

  it("lets a member create, change and delete events with their notes, state timelines and owners, and both kinds of templates", () => {
    for (const model of memberModels) {
      expect({
        table: model.tableName,
        changes: changes(model, Permission.ScheduledMaintenanceMember),
      }).toEqual({ table: model.tableName, changes: true });
    }

    expect(
      new ScheduledMaintenanceState()
        .getCreatePermissions()
        .includes(Permission.ScheduledMaintenanceMember),
    ).toBe(false);
    expect(who).toContain(
      "| **Scheduled Maintenance Member**  | Creates, changes and deletes events with their notes, state timelines and owners, and both kinds of templates. |",
    );
  });

  it("lets an admin also create, change and delete maintenance states", () => {
    expect(
      changes(
        new ScheduledMaintenanceState(),
        Permission.ScheduledMaintenanceAdmin,
      ),
    ).toBe(true);

    for (const model of memberModels) {
      expect({
        table: model.tableName,
        changes: changes(model, Permission.ScheduledMaintenanceAdmin),
      }).toEqual({ table: model.tableName, changes: true });
    }

    expect(who).toContain(
      "| **Scheduled Maintenance Admin**   | Everything a member does, and also creates, changes and deletes maintenance states.",
    );
  });

  it("keeps rules, custom fields and measurements to Project Owner, Project Admin and the page's own permission", () => {
    for (const model of projectAdminModels) {
      expect({
        table: model.tableName,
        roles: rolesOf(model.getCreatePermissions()),
      }).toEqual({
        table: model.tableName,
        roles: ["Project Owner", "Project Admin"],
      });
    }

    expect(
      PermissionHelper.getTitle(Permission.CreateScheduledMaintenanceOwnerRule),
    ).toBe("Create Scheduled Maintenance Owner Rule");
    expect(
      new ScheduledMaintenanceOwnerRule().getCreatePermissions(),
    ).toContain(Permission.CreateScheduledMaintenanceOwnerRule);
    expect(who).toContain(
      "Rules, custom fields and measurements take **Project Owner** or **Project Admin**, or a custom role with that page's own permission, such as **Create Scheduled Maintenance Owner Rule**.",
    );
  });

  /*
   * Maintenance runbook rules are rows of the one RunbookRule model that
   * incidents and alerts share (triggerEntity ScheduledMaintenance), and it
   * lets the Runbook Admin role change them too - the roles table used to
   * leave that out.
   */
  it("lets Runbook Admin change runbook rules as well, and says so", () => {
    const runbookRule: RunbookRule = new RunbookRule();

    expect(rolesOf(runbookRule.getCreatePermissions())).toEqual([
      "Project Owner",
      "Project Admin",
      "Runbook Admin",
    ]);
    expect(changes(runbookRule, Permission.RunbookAdmin)).toBe(true);
    // The maintenance roles do not reach them.
    expect(changes(runbookRule, Permission.ScheduledMaintenanceAdmin)).toBe(
      false,
    );
    expect(PermissionHelper.getTitle(Permission.RunbookAdmin)).toBe(
      "Runbook Admin",
    );
    expect(who).toContain(
      "such as **Create Scheduled Maintenance Owner Rule**. Runbook rules also take **Runbook Admin**.",
    );
  });

  it("lets Project Member work with events and templates, as a maintenance member does", () => {
    for (const model of [
      new ScheduledMaintenance(),
      new ScheduledMaintenanceTemplate(),
    ]) {
      expect(changes(model, Permission.ProjectMember)).toBe(true);
    }

    expect(who).toContain(
      "**Project Member** works with events and templates, like **Scheduled Maintenance Member**.",
    );
  });

  it("says in the roles' own descriptions what the table says", () => {
    const description: (permission: Permission) => string = (
      permission: Permission,
    ): string => {
      return (
        PermissionHelper.getAllPermissionProps().find(
          (props: { permission: Permission }): boolean => {
            return props.permission === permission;
          },
        ) as { description: string }
      ).description;
    };

    expect(description(Permission.ScheduledMaintenanceMember)).toContain(
      "Creates, changes and deletes scheduled maintenance events with their notes, state timelines and owners, and scheduled maintenance and note templates.",
    );
    expect(description(Permission.ScheduledMaintenanceAdmin)).toContain(
      "Does everything Scheduled Maintenance Member does, and also creates, changes and deletes maintenance states.",
    );
  });
});

// ---- Paths and addresses ------------------------------------------------------------

describe("every menu path the maintenance pages give is in that menu", () => {
  type MenuReader = () => Array<MenuSection>;

  const MENUS: Record<string, MenuReader> = {
    "Scheduled Maintenance": maintenanceMenu,
    "Project Settings": (): Array<MenuSection> => {
      return menuSections(readDashboardSource("Pages/Settings/SideMenu.tsx"));
    },
  };

  function paths(): Array<{ page: string; segments: Array<string> }> {
    const found: Array<{ page: string; segments: Array<string> }> = [];

    for (const entry of SCHEDULED_MAINTENANCE_PAGES) {
      for (const segments of boldPaths(english(entry.page))) {
        found.push({ page: entry.page, segments });
      }
    }

    return found;
  }

  it("finds the paths, every one from a menu it knows", () => {
    const roots: Set<string> = new Set(
      paths().map((found: { segments: Array<string> }): string => {
        return found.segments[0] as string;
      }),
    );

    expect([...roots].sort()).toEqual(Object.keys(MENUS).sort());
    expect(paths().length).toBeGreaterThanOrEqual(10);
  });

  it("resolves each one to a section and its page", () => {
    const unresolved: Array<string> = [];

    for (const found of paths()) {
      const sections: Array<MenuSection> = (
        MENUS[found.segments[0] as string] as MenuReader
      )();
      const rest: Array<string> = found.segments.slice(1);
      const asSection: MenuSection | undefined = sections.find(
        (candidate: MenuSection): boolean => {
          return candidate.title === rest[0];
        },
      );
      const resolves: boolean = asSection
        ? rest.length === 1 || asSection.items.includes(rest[1] as string)
        : rest.length === 1 &&
          sections.some((candidate: MenuSection): boolean => {
            return candidate.items.includes(rest[0] as string);
          });

      if (!resolves || rest.length > 2) {
        unresolved.push(`${found.page}: ${found.segments.join(" → ")}`);
      }
    }

    expect(unresolved).toEqual([]);
  });
});

describe("every dashboard address the maintenance pages give is a route", () => {
  const routes: Array<string> = routeGroup(
    "ScheduledMaintenanceEventsRoutePath",
  );
  const ADDRESS: RegExp =
    /`\/dashboard\/\{projectId\}\/scheduled-maintenance-events(\/[^`]*)?`/g;
  const LEADING_SLASH: RegExp = /^\//;

  function addresses(): Array<{ page: string; route: string }> {
    const found: Array<{ page: string; route: string }> = [];

    for (const entry of SCHEDULED_MAINTENANCE_PAGES) {
      for (const match of Array.from(english(entry.page).matchAll(ADDRESS))) {
        found.push({
          page: entry.page,
          route: (match[1] || "").replace(LEADING_SLASH, ""),
        });
      }
    }

    return found;
  }

  it("reads the maintenance routes, and finds the addresses", () => {
    expect(routes).toContain("settings/reminder-rules");
    expect(routes).toContain("{id}/state-timeline");
    expect(addresses().length).toBeGreaterThanOrEqual(2);
  });

  it("resolves each address to a route, or to the start of some", () => {
    const unknown: Array<string> = addresses()
      .filter((found: { route: string }): boolean => {
        if (found.route === "") {
          return false;
        }

        if (found.route.endsWith("/")) {
          return !routes.some((route: string): boolean => {
            return route.startsWith(found.route);
          });
        }

        return !routes.includes(found.route);
      })
      .map((found: { page: string; route: string }): string => {
        return `${found.page}: ${found.route}`;
      });

    expect(unknown).toEqual([]);
  });
});

// ---- The readers ------------------------------------------------------------------

describe("the readers", () => {
  it("read every table the pages draw", () => {
    for (const entry of SCHEDULED_MAINTENANCE_PAGES) {
      expect({
        page: entry.page,
        tables: tables(english(entry.page)).length > 0,
      }).toEqual({ page: entry.page, tables: true });
    }
  });

  it("find a field's object and step on a form", () => {
    expect(stepOf(fieldObject(CREATE_PAGE, "Monitors"))).toBe(
      "resources-affected",
    );
    expect(stepOf(fieldObject(CREATE_PAGE, "Title"))).toBe("event");
    expect(
      fieldObject(CREATE_PAGE, "Show event on these status pages"),
    ).toContain('title: "Show event on these status pages ",');
  });

  it("read the seeded states with their colours", () => {
    expect(
      seededStates().map((row: SeededRow): string => {
        return row.color;
      }),
    ).toEqual(["#000000", "#ffbf53", "#4a4a4a", "#2ab57d"]);
  });

  it("list names as the pages write them", () => {
    expect(listed(["A"])).toBe("**A**");
    expect(listed(["A", "B"])).toBe("**A** and **B**");
    expect(listed(["A", "B", "C"], "or")).toBe("**A**, **B** or **C**");
  });
});
