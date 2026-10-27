import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { readPage } from "./DocsContentSupport";
import { boldSpans } from "./DocsTranslationChecks";
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DASHBOARD_GO_TO_LEADER_KEY,
  DashboardGoToShortcut,
  DashboardKeyAction,
  DashboardKeyResolution,
  getDashboardGoToShortcuts,
  resolveDashboardKeyPress,
} from "../../../FeatureSet/Dashboard/src/Utils/KeyboardShortcuts";
import { DEFAULT_MONITORING_INTERVAL } from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import { getMonitoringIntervalLabel } from "../../../FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import { ProjectNotificationChannelsCopy } from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import { StatusPageOverviewCopy } from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageOverviewCopy";
import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  KeyboardSequenceState,
} from "Common/UI/Utils/GlobalKeyboardShortcut";
import { SECTION_TITLES_COLLAPSED_BY_DEFAULT } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import ThemeUtil from "Common/UI/Utils/Theme";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  Theme,
  ThemePreference,
} from "Common/Types/Theme/ThemePreference";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import {
  ToolImportCatalog,
  isToolImportFileUpload,
} from "Common/Types/ToolImport/ToolImportCatalog";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import ObjectID from "Common/Types/ObjectID";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  getDefaultPlanIdForNewProject,
  getTrialDays,
  isPlanFree,
} from "Common/Types/Billing/SubscriptionPlanPricing";
import User from "Common/Models/DatabaseModels/User";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Introduction pages - Getting Started, the Quickstart, Core Concepts,
 * Home Page & Shortcuts and Your Account - are the first thing a new user
 * reads, and almost every sentence on them names something the product
 * draws or decides: a button, a default, a seeded state, a side menu, a key.
 * Each fact here is read from where the product keeps it, so a page fails
 * HERE when the product changes under it, rather than misleading the next
 * person who signs up.
 *
 * React views cannot be imported into App's tests (App has no react), so a
 * view is read as text and only its literal titles are compared; the pure
 * modules (shortcuts, defaults, models, catalogs) are imported and run.
 */

const APP_DIR: string = path.resolve(__dirname, "../../..");
const DASHBOARD_DIR: string = path.join(APP_DIR, "FeatureSet/Dashboard/src");
const ACCOUNTS_DIR: string = path.join(APP_DIR, "FeatureSet/Accounts/src");
const IDENTITY_DIR: string = path.join(APP_DIR, "FeatureSet/Identity");
const COMMON_DIR: string = path.resolve(APP_DIR, "../Common");

function readSource(directory: string, relative: string): string {
  return fs.readFileSync(path.join(directory, relative), "utf8");
}

function dashboard(relative: string): string {
  return readSource(DASHBOARD_DIR, relative);
}

const GETTING_STARTED: string = readPage("en", "introduction/getting-started");
const QUICKSTART: string = readPage("en", "introduction/quickstart");
const CORE_CONCEPTS: string = readPage("en", "introduction/core-concepts");
const HOME: string = readPage("en", "introduction/home");
const YOUR_ACCOUNT: string = readPage("en", "introduction/your-account");

// ---- reading the pages ------------------------------------------------------

const HEADING_LINE: RegExp = /^(#{1,6}) /;
const TABLE_SEPARATOR_CELL: RegExp = /^:?-+:?$/;
const LINK_IN_CELL: RegExp = /^\[([^\]]+)\]\(([^)]+)\)$/;
const INLINE_CODE_SPAN: RegExp = /`([^`]+)`/g;
const BOLD_TEXT: RegExp = /\*\*([^*]+)\*\*/g;
const WHITESPACE_RUN: RegExp = /\s+/g;
const DOUBLE_QUOTE: RegExp = /"/g;

// Source text with every run of whitespace as one space, to read across lines.
function oneLine(text: string): string {
  return text.replace(WHITESPACE_RUN, " ");
}

/*
 * The part of a page under a heading ("## What Home shows"), up to the next
 * heading of the same or a higher level.
 */
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(HEADING_LINE) as RegExpMatchArray)[1]!
    .length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const match: RegExpMatchArray | null = (lines[index] as string).match(
      HEADING_LINE,
    );

    if (match && (match[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The body rows of each table in some markdown, as trimmed cells.
function tablesOf(markdown: string): Array<Array<Array<string>>> {
  const tables: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }

    const cells: Array<string> = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      });

    if (!current) {
      // The header row starts a table; it is not a body row.
      current = [];
      tables.push(current);
      continue;
    }

    if (
      cells.every((cell: string): boolean => {
        return TABLE_SEPARATOR_CELL.test(cell);
      })
    ) {
      continue;
    }

    current.push(cells);
  }

  return tables;
}

function onlyTableOf(markdown: string): Array<Array<string>> {
  const tables: Array<Array<Array<string>>> = tablesOf(markdown);

  expect(tables.length).toBe(1);

  return tables[0] as Array<Array<string>>;
}

function inlineCodeOf(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// ---- reading the product ----------------------------------------------------

const SIDE_MENU_JSX_SECTION: RegExp = /<SideMenuSection\s+title="([^"]+)"/;
const SIDE_MENU_TITLE_LINE: RegExp = /^(\s*)title:\s*"([^"]+)",?\s*$/;

interface MenuSection {
  title: string;
  items: Array<string>;
}

/*
 * A side menu's sections and their items, in order. Two shapes are drawn in
 * the dashboard: <SideMenuSection title="..."> with items inside it, and an
 * array of { title, items: [{ link: { title } }] } objects, where a
 * section's title is indented less than its items' (prettier keeps that
 * true).
 */
function sideMenuSections(source: string): Array<MenuSection> {
  const sectionsStart: number = source.indexOf("const sections");
  const body: string =
    sectionsStart >= 0 ? source.slice(sectionsStart) : source;
  const lines: Array<string> = body.split("\n");
  const isJsx: boolean = SIDE_MENU_JSX_SECTION.test(body);
  const sections: Array<MenuSection> = [];

  const titleIndents: Array<number> = lines
    .map((line: string): RegExpMatchArray | null => {
      return line.match(SIDE_MENU_TITLE_LINE);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): number => {
      return (match[1] as string).length;
    });
  const sectionIndent: number = Math.min(...titleIndents);

  for (const line of lines) {
    const jsxSection: RegExpMatchArray | null = line.match(
      SIDE_MENU_JSX_SECTION,
    );

    if (isJsx && jsxSection) {
      sections.push({ title: jsxSection[1] as string, items: [] });
      continue;
    }

    const title: RegExpMatchArray | null = line.match(SIDE_MENU_TITLE_LINE);

    if (!title) {
      continue;
    }

    if (!isJsx && (title[1] as string).length === sectionIndent) {
      sections.push({ title: title[2] as string, items: [] });
      continue;
    }

    sections[sections.length - 1]?.items.push(title[2] as string);
  }

  return sections;
}

function menuSection(source: string, title: string): MenuSection {
  const section: MenuSection | undefined = sideMenuSections(source).find(
    (candidate: MenuSection): boolean => {
      return candidate.title === title;
    },
  );

  expect({ section: title, found: Boolean(section) }).toEqual({
    section: title,
    found: true,
  });

  return section as MenuSection;
}

function isCollapsedByDefault(title: string): boolean {
  return SECTION_TITLES_COLLAPSED_BY_DEFAULT.some(
    (collapsed: string): boolean => {
      return collapsed.toLowerCase() === title.toLowerCase();
    },
  );
}

// The block of a source file from a marker to the first line after it that ends one.
function blockFrom(source: string, marker: string, end: string): string {
  const start: number = source.indexOf(marker);

  expect({ marker: marker, found: start >= 0 }).toEqual({
    marker: marker,
    found: true,
  });

  const stop: number = source.indexOf(end, start + marker.length);

  return source.slice(start, stop === -1 ? undefined : stop);
}

// A button the dashboard names from a model: "Create Monitor", "Edit User".
function createButton(model: { singularName?: string | null }): string {
  return `Create ${model.singularName}`;
}

/*
 * The names each new project is given (Common/Server/Services/
 * ProjectService.ts), by the variable that holds each one.
 */
const SEEDED_NAME: RegExp = /(\w+)\.name = "([^"]+)";/g;

const SEEDED_NAMES: Map<string, string> = new Map(
  Array.from(
    readSource(COMMON_DIR, "Server/Services/ProjectService.ts").matchAll(
      SEEDED_NAME,
    ),
  ).map((match: RegExpMatchArray): [string, string] => {
    return [match[1] as string, match[2] as string];
  }),
);

function seeded(variable: string): string {
  const name: string | undefined = SEEDED_NAMES.get(variable);

  expect({ variable: variable, name: typeof name }).toEqual({
    variable: variable,
    name: "string",
  });

  return name as string;
}

// ---- Getting Started --------------------------------------------------------

describe("Getting Started", () => {
  const moving: string = sectionOf(
    GETTING_STARTED,
    "### Bring your setup with you",
  );

  it("names every tool the import reads, in the order the import page lists them, each linked to its own guide", () => {
    const rows: Array<Array<string>> = onlyTableOf(moving);
    const links: Array<{ title: string; target: string }> = rows.map(
      (row: Array<string>): { title: string; target: string } => {
        const match: RegExpMatchArray | null = (row[0] as string).match(
          LINK_IN_CELL,
        );

        expect({ cell: row[0], link: Boolean(match) }).toEqual({
          cell: row[0],
          link: true,
        });

        return {
          title: (match as RegExpMatchArray)[1] as string,
          target: (match as RegExpMatchArray)[2] as string,
        };
      },
    );

    expect(links).toEqual(
      AllToolImportSources.map(
        (source: ToolImportSource): { title: string; target: string } => {
          return {
            title: ToolImportCatalog[source].title,
            target: ToolImportCatalog[source].docsPath,
          };
        },
      ),
    );

    // The same guides, in the same order, as the Moving to OneUptime group.
    const group: NavGroup | undefined = DocsNav.find(
      (candidate: NavGroup): boolean => {
        return candidate.title === "Moving to OneUptime";
      },
    );

    expect(
      links.map((link: { target: string }): string => {
        return link.target;
      }),
    ).toEqual(
      (group as NavGroup).links.map((link: NavLink): string => {
        return link.url;
      }),
    );
  });

  it("says a key connects every tool but Uptime Kuma, which reads a file", () => {
    expect(
      AllToolImportSources.filter((source: ToolImportSource): boolean => {
        return isToolImportFileUpload(ToolImportCatalog[source]);
      }),
    ).toEqual([ToolImportSource.UptimeKuma]);
    expect(moving).toContain("with an API key or, for Uptime Kuma, a file");
  });

  /*
   * "This should be in the advanced section in the side menu." (the
   * maintainer): the import waits in Advanced, which starts folded, so the
   * path names Advanced on the way.
   */
  it("finds the import where Project Settings lists it: in Advanced, which the path names", () => {
    const settingsMenu: string = dashboard("Pages/Settings/SideMenu.tsx");

    expect(moving).toContain(
      "**Project Settings → Advanced → Import from another tool**",
    );
    expect(moving).not.toContain(
      "**Project Settings → Import from another tool**",
    );
    expect(menuSection(settingsMenu, "Advanced").items).toContain(
      "Import from another tool",
    );
    expect(
      sideMenuSections(settingsMenu).filter((section: MenuSection): boolean => {
        return section.items.includes("Import from another tool");
      }),
    ).toHaveLength(1);
    expect(isCollapsedByDefault("Advanced")).toBe(true);
  });

  it("tells an alert from an incident the way the Alerts list does", () => {
    expect(oneLine(dashboard("Components/Alert/AlertsTable.tsx"))).toContain(
      "Alerts flag problems for your team to look into before users are affected. Unlike incidents, they never appear on status pages.",
    );
    expect(GETTING_STARTED).toContain(
      "An **alert** is a problem for your team to look into before users notice.",
    );
    expect(GETTING_STARTED).toContain("but never shows on a status page");
  });
});

// ---- Quickstart -------------------------------------------------------------

describe("Quickstart", () => {
  /*
   * Create New Project is one page: the plan is picked under the name, Free
   * is picked to start with (getDefaultPlanIdForNewProject), and a new
   * project on a paid plan starts with its trial - on the plans OneUptime
   * Cloud is configured with (Common's test-setup.sh, which the suites run
   * with). It used to walk a second step for the plan.
   */
  it("picks the plan on the same page as the name, Free first, with the paid plans' trials", () => {
    const picker: string = dashboard("Components/Header/ProjectPicker.tsx");
    const fields: string = readSource(
      COMMON_DIR,
      "UI/Components/Project/CreateProjectFormFields.tsx",
    );
    const env: Record<string, string> = {};

    for (const line of readSource(COMMON_DIR, "test-setup.sh").split("\n")) {
      if (line.startsWith("SUBSCRIPTION_PLAN_")) {
        env[line.slice(0, line.indexOf("="))] = line.slice(
          line.indexOf("=") + 1,
        );
      }
    }

    const plans: Array<SubscriptionPlan> =
      SubscriptionPlan.getSubscriptionPlans(env);
    const free: SubscriptionPlan | undefined = plans.find(
      (plan: SubscriptionPlan): boolean => {
        return isPlanFree(plan, BillingPeriod.Yearly);
      },
    );

    expect(free?.getName()).toBe("Free");
    expect(getDefaultPlanIdForNewProject(plans, BillingPeriod.Yearly)).toBe(
      free!.getYearlyPlanId(),
    );

    for (const plan of plans) {
      if (plan !== free) {
        expect({
          plan: plan.getName(),
          trial: getTrialDays(plan) > 0,
        }).toEqual({ plan: plan.getName(), trial: true });
      }
    }

    // One page: no steps in the dialog, and no field on a step.
    expect(picker).not.toContain("steps:");
    expect(fields).not.toContain("stepId");
    expect(fields).toContain("getDefaultPlanIdForNewProject(");

    expect(QUICKSTART).toContain(
      "Enter a **Project Name**, such as your company's name. On OneUptime Cloud, pick a plan below it as well: Free is already picked, and the paid plans start with a free trial.",
    );
    expect(QUICKSTART).not.toContain("the next step asks you to pick a plan");
  });

  it("starts a monitor on the interval the create form starts on", () => {
    expect(getMonitoringIntervalLabel(DEFAULT_MONITORING_INTERVAL)).toBe(
      "Every 5 Minutes",
    );
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveInterval(MonitorType.Website),
    ).toBe(true);
    expect(QUICKSTART).toContain(
      "the **Monitoring Interval** of **Every 5 Minutes**",
    );
    expect(QUICKSTART).toContain("checks your website every five minutes");
  });

  it("says what the website monitor's own criteria do: offline, and an incident, when the site does not answer or answers with an error", () => {
    const offline: ObjectID = ObjectID.generate();
    const criteria: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria(
      {
        monitorType: MonitorType.Website,
        monitorName: "Website",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: offline,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
      },
    );
    const first: MonitorCriteriaInstance = criteria.data!
      .monitorCriteriaInstanceArray[0] as MonitorCriteriaInstance;
    const filters: Array<CriteriaFilter> = first.data!.filters;

    expect(first.data!.monitorStatusId?.toString()).toBe(offline.toString());
    expect(first.data!.changeMonitorStatus).toBe(true);
    expect(first.data!.createIncidents).toBe(true);
    expect(first.data!.filterCondition).toBe(FilterCondition.Any);
    // Not answering...
    expect(filters).toContainEqual(
      expect.objectContaining({
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
      }),
    );
    // ...or answering with an error status.
    expect(filters).toContainEqual(
      expect.objectContaining({
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 400,
      }),
    );
    expect(QUICKSTART).toContain(
      "the monitor goes **Offline** and declares an incident when the site does not answer, or answers with an error",
    );
    expect(seeded("downStatus")).toBe("Offline");
  });

  it("names each Create button as the dashboard draws it from its model", () => {
    for (const button of [
      createButton(new Monitor()),
      createButton(new OnCallDutyPolicy()),
      createButton(new IncidentOnCallRule()),
      createButton(new StatusPage()),
    ]) {
      expect({
        button: button,
        named: QUICKSTART.includes(`**${button}**`),
      }).toEqual({ button: button, named: true });
    }

    expect(createButton(new IncidentOnCallRule())).toBe(
      "Create Incident On-Call Rule",
    );
  });

  it("asks who gets paged first, with the responder button the policy form has", () => {
    expect(
      dashboard("Components/OnCallPolicy/OnCallPolicyCreateForm.ts"),
    ).toContain('title: "Who gets paged first?"');
    expect(
      dashboard("Components/OnCallPolicy/EscalationRule/EscalationRuleForm.ts"),
    ).toContain('translationKey("Add responder")');
    expect(QUICKSTART).toContain(
      "Under **Who gets paged first?**, click **Add responder**",
    );
  });

  it("finds the incident on-call rules under the folded Rules section of Incidents", () => {
    const rules: MenuSection = menuSection(
      dashboard("Pages/Incidents/SideMenu.tsx"),
      "Rules",
    );

    expect(rules.items).toContain("On-Call Rules");
    expect(isCollapsedByDefault("Rules")).toBe(true);
    expect(QUICKSTART).toContain(
      "expand **Rules** in the side menu and choose **On-Call Rules**",
    );
  });

  it("adds phone numbers where Direct Contact keeps them", () => {
    expect(
      dashboard("Components/NotificationMethods/NotificationMethodTabs.tsx"),
    ).toContain('translationKey("Direct Contact")');
    expect(dashboard("Components/NotificationMethods/SMS.tsx")).toContain(
      'title: "Phone Numbers for SMS Notifications"',
    );
    expect(dashboard("Components/NotificationMethods/Call.tsx")).toContain(
      'title: "Phone Numbers for Call Notifications"',
    );
    expect(dashboard("Components/NotificationMethods/Call.tsx")).toContain(
      'title: "Verify"',
    );
  });

  it("says SMS and calls start off, and who turns them on where", () => {
    const project: Project = new Project();

    for (const column of [
      "enableSmsNotifications",
      "enableCallNotifications",
    ]) {
      expect({
        column: column,
        defaultValue: project.getTableColumnMetadata(column).defaultValue,
      }).toEqual({ column: column, defaultValue: false });
    }

    expect(ProjectNotificationChannelsCopy.cardTitle).toBe(
      "Notification Channels",
    );
    expect(ProjectNotificationChannelsCopy.whoCanChange).toContain(
      "A project owner, a Billing Admin or someone with Manage Billing",
    );
    expect(
      menuSection(dashboard("Pages/Settings/SideMenu.tsx"), "Notifications")
        .items,
    ).toContain("Notification Settings");
    expect(QUICKSTART).toContain(
      "SMS and phone calls are off in a new project. A project owner, a Billing Admin or someone with Manage Billing turns them on in the **Notification Channels** card, under **Project Settings → Notifications → Notification Settings**.",
    );
  });

  it("publishes a status page that starts public, with its monitors and preview link where the page keeps them", () => {
    expect(
      new StatusPage().getTableColumnMetadata("isPublicStatusPage")
        .defaultValue,
    ).toBe(true);
    expect(QUICKSTART).toContain("A new status page is public");

    const statusPageMenu: string = dashboard(
      "Pages/StatusPages/View/SideMenu.tsx",
    );

    expect(oneLine(statusPageMenu)).toContain(
      'title: project?.isFeatureFlagMonitorGroupsEnabled ? "Resources" : "Monitors"',
    );
    expect(QUICKSTART).toContain(
      "under **Resources**, choose **Monitors**; it reads **Resources** in projects with monitor groups turned on",
    );
    expect(
      dashboard("Components/StatusPage/StatusPageResourcePanel.tsx"),
    ).toContain('submitButtonText="Add Monitor"');
    expect(
      dashboard("Components/StatusPage/StatusPageResourceFormFields.ts"),
    ).toContain('title: "Display Name"');
    // The new page opens on its Overview, whose first step is Add Monitors.
    expect(dashboard("Pages/StatusPages/StatusPages.tsx")).toContain(
      "RouteMap[PageMap.STATUS_PAGE_VIEW]",
    );
    expect(StatusPageOverviewCopy.firstStepButton).toBe("Add Monitors");
    expect(QUICKSTART).toContain(
      "and click **Create Status Page**. The new page opens on its **Overview**.",
    );
    expect(QUICKSTART).toContain("Click **Add Monitors** on the **Overview**");
    expect(
      dashboard("Pages/StatusPages/View/StatusPagePreviewLink.tsx"),
    ).toContain("title={StatusPageOverviewCopy.linkCardTitle}");
    expect(StatusPageOverviewCopy.linkCardTitle).toBe("Status Page Link");
    expect(QUICKSTART).toContain(
      "The **Status Page Link** card links to your status page",
    );
  });

  it("invites with the Users page's own form, starting on the members team", () => {
    const users: string = dashboard("Pages/Users/Index.tsx");

    expect(users).toContain('title: "Invite User"');
    expect(users).toContain('title: "Email"');
    expect(users).toContain('title: "Team"');
    expect(users).toContain('submitButtonText="Invite"');
    expect(users).toContain("findDefaultInviteTeam");
    expect(readSource(COMMON_DIR, "UI/Utils/DefaultInviteTeam.ts")).toContain(
      'the team called "Members"',
    );
    expect(QUICKSTART).toContain(
      "Click **Invite User**, enter their **Email**, and pick a **Team**: the members team is picked to start with. Click **Invite**.",
    );
  });

  it("declares, follows and resolves the test incident with the incident's own controls", () => {
    expect(dashboard("Components/Incident/IncidentsTable.tsx")).toContain(
      'title: "Declare Incident"',
    );
    expect(dashboard("Pages/Incidents/Create.tsx")).toContain(
      'submitButtonText={"Declare Incident"}',
    );
    expect(
      sideMenuSections(dashboard("Pages/Incidents/View/SideMenu.tsx")).some(
        (section: MenuSection): boolean => {
          return section.items.includes("On-Call Executions");
        },
      ),
    ).toBe(true);
    expect(QUICKSTART).toContain(
      "choose **On-Call Executions** in its side menu",
    );
  });
});

// ---- Core Concepts ----------------------------------------------------------

describe("Core Concepts", () => {
  it("names the three monitor statuses every new project starts with", () => {
    expect([
      seeded("operationalStatus"),
      seeded("degradedStatus"),
      seeded("downStatus"),
    ]).toEqual(["Operational", "Degraded", "Offline"]);
    expect(CORE_CONCEPTS).toContain(
      "three monitor statuses: **Operational**, **Degraded** and **Offline**",
    );
  });

  it("gives incidents and alerts the states and severities a new project is seeded with", () => {
    const table: Array<Array<string>> = onlyTableOf(
      sectionOf(CORE_CONCEPTS, "## Incidents and alerts"),
    );
    const row: (label: string) => Array<string> = (
      label: string,
    ): Array<string> => {
      return table.find((candidate: Array<string>): boolean => {
        return candidate[0] === `**${label}**`;
      }) as Array<string>;
    };

    const incidentStates: Array<string> = [
      seeded("createdIncidentState"),
      seeded("acknowledgedIncidentState"),
      seeded("resolvedIncidentState"),
    ];
    const alertStates: Array<string> = [
      seeded("createdAlertState"),
      seeded("acknowledgedAlertState"),
      seeded("resolvedAlertState"),
    ];

    expect(boldSpans(row("Starting states")[1] as string)).toEqual(
      incidentStates,
    );
    expect(boldSpans(row("Starting states")[2] as string)).toEqual(alertStates);
    expect(row("Starting severities")[1]).toBe(
      [
        seeded("criticalIncident"),
        seeded("majorIncident"),
        seeded("minorIncident"),
      ].join(", "),
    );
    expect(boldSpans(row("Starting severities")[2] as string)).toEqual([
      seeded("highSeverity"),
      seeded("lowSeverity"),
    ]);
  });

  it("walks a maintenance event through the states a new project is seeded with", () => {
    expect(CORE_CONCEPTS).toContain(
      `An event moves through **${seeded("createdScheduledMaintenanceState")}**, **${seeded("ongoingScheduledMaintenanceState")}**, **${seeded("endedScheduledMaintenanceState")}** and **${seeded("completedScheduledMaintenanceState")}**`,
    );
  });

  it("names the three teams every new project starts with", () => {
    expect(CORE_CONCEPTS).toContain(
      `three teams: ${seeded("ownerTeam")}, with you in it, ${seeded("adminTeam")} and ${seeded("memberTeam")}`,
    );
  });

  it("finds ingestion keys and the AI switch where Project Settings keeps them, and AI starts on", () => {
    const settings: string = dashboard("Pages/Settings/SideMenu.tsx");

    expect(menuSection(settings, "Telemetry & APM").items).toContain(
      "Ingestion Keys",
    );
    expect(CORE_CONCEPTS).toContain(
      "**Project Settings → Telemetry & APM → Ingestion Keys**",
    );

    expect(menuSection(settings, "AI").items).toContain("AI Features");

    const enableAi: { title?: string; defaultValue?: unknown } =
      new Project().getTableColumnMetadata("enableAi") as {
        title?: string;
        defaultValue?: unknown;
      };

    expect(enableAi.title).toBe("Enable AI");
    expect(enableAi.defaultValue).toBe(true);
    expect(CORE_CONCEPTS).toContain(
      "A new project starts with AI on; the **Enable AI** switch under **Project Settings → AI → AI Features** turns all of it off.",
    );
  });
});

// ---- Home Page & Shortcuts --------------------------------------------------

const CHECKLIST_SOURCE: string = dashboard(
  "Components/Home/GettingStarted.tsx",
);
const TILES_SOURCE: string = dashboard("Components/Home/OverviewStats.tsx");
const OVERVIEW_DATA_SOURCE: string = dashboard(
  "Components/Home/HomeOverviewData.ts",
);
const HEALTH_SOURCE: string = dashboard("Components/Home/ProjectHealth.ts");
const COMMAND_BAR_SOURCE: string = dashboard(
  "Components/Home/HomeCommandBar.tsx",
);
const ATTENTION_SOURCE: string = dashboard(
  "Components/Home/NeedsAttention.tsx",
);
const RESOURCES_SOURCE: string = dashboard(
  "Components/Home/ProjectResources.tsx",
);
const UPCOMING_SOURCE: string = dashboard(
  "Components/Home/UpcomingMaintenance.tsx",
);
const EXPLORE_SOURCE: string = dashboard("Components/Home/ExploreProducts.tsx");

const TASK_TITLE: RegExp = /^ {4}title: "([^"]+)",$/gm;
const TASK_PAGE_MAP: RegExp = /^ {4}pageMap: PageMap\.(\w+),$/m;
const TASK_CREATE_PAGE_MAP: RegExp =
  /createPage: \{\s*pageMap: PageMap\.(\w+),/;
const TASK_COUNT_THRESHOLD: RegExp = /\)\) > (\d)/;
const TILE_KEY: RegExp = /^ {4}key: "([^"]+)",$/gm;
const TILE_FIELD: (field: string) => RegExp = (field: string): RegExp => {
  return new RegExp(`^ {4}${field}: "([^"]+)",$`, "m");
};
const TILE_NOT_SET_UP_LABEL: RegExp =
  /notSetUp: \(counts: HomeCounts\): NotSetUpState => \{\s*return \{[^}]*label: (\w+),/;
const STRING_CONSTANT: (name: string) => RegExp = (name: string): RegExp => {
  return new RegExp(`export const ${name}: string = "([^"]+)";`);
};
const TRANSLATION_KEY_CONSTANT: (name: string) => RegExp = (
  name: string,
): RegExp => {
  return new RegExp(
    `export const ${name}: string = translationKey\\(\\s*"([^"]+)",?\\s*\\);`,
  );
};
const NUMBER_CONSTANT: (name: string) => RegExp = (name: string): RegExp => {
  return new RegExp(`export const ${name}: number = (\\d+);`);
};
const HOW_IT_WORKS_STEP_TITLE: RegExp = /^ {4}title: "([^"]+)",$/gm;
const KEY_SEQUENCE: RegExp = /keySequence: \[\[([^\]]+)\]\]/g;
const QUICK_ACTION_TITLE: RegExp = /title: translationKey\("([^"]+)"\)/g;
const RESOURCE_TITLE: RegExp = /title: translationKey\("([^"]+)"\)/g;
const NUMBERED_ITEM: RegExp = /^\d+\. (.+)$/gm;

// Each checklist task, as the component's array literal declares it.
interface ChecklistTask {
  title: string;
  pageMap: string;
  createPageMap: string | null;
  countMustExceed: number;
}

function checklistTasks(): Array<ChecklistTask> {
  const block: string = blockFrom(
    CHECKLIST_SOURCE,
    "const gettingStartedTasks",
    "\n];",
  );
  const starts: Array<RegExpMatchArray> = Array.from(
    block.matchAll(TASK_TITLE),
  );

  return starts.map((match: RegExpMatchArray, index: number): ChecklistTask => {
    const chunk: string = block.slice(
      match.index,
      starts[index + 1]?.index ?? block.length,
    );

    return {
      title: match[1] as string,
      pageMap: (chunk.match(TASK_PAGE_MAP) as RegExpMatchArray)[1] as string,
      createPageMap:
        (chunk.match(TASK_CREATE_PAGE_MAP)?.[1] as string | undefined) || null,
      countMustExceed: Number(
        (chunk.match(TASK_COUNT_THRESHOLD) as RegExpMatchArray)[1],
      ),
    };
  });
}

interface HomeTile {
  key: string;
  label: string;
  attentionLabel: string;
  allClearLabel: string;
  notSetUpLabel: string | null;
}

function homeTiles(): Array<HomeTile> {
  const block: string = blockFrom(
    TILES_SOURCE,
    "const STAT_TILE_DEFINITIONS: Array<StatTileDefinition>",
    "\n];",
  );
  const starts: Array<RegExpMatchArray> = Array.from(block.matchAll(TILE_KEY));

  return starts.map((match: RegExpMatchArray, index: number): HomeTile => {
    const chunk: string = block.slice(
      match.index,
      starts[index + 1]?.index ?? block.length,
    );
    const notSetUp: string | undefined = chunk.match(
      TILE_NOT_SET_UP_LABEL,
    )?.[1];

    return {
      key: match[1] as string,
      label: (
        chunk.match(TILE_FIELD("label")) as RegExpMatchArray
      )[1] as string,
      attentionLabel: (
        chunk.match(TILE_FIELD("attentionLabel")) as RegExpMatchArray
      )[1] as string,
      allClearLabel: (
        chunk.match(TILE_FIELD("allClearLabel")) as RegExpMatchArray
      )[1] as string,
      notSetUpLabel: notSetUp
        ? ((
            TILES_SOURCE.match(STRING_CONSTANT(notSetUp)) as RegExpMatchArray
          )[1] as string)
        : null,
    };
  });
}

function translationKeyConstant(source: string, name: string): string {
  return (
    source.match(TRANSLATION_KEY_CONSTANT(name)) as RegExpMatchArray
  )[1] as string;
}

function numberConstant(source: string, name: string): number {
  return Number(
    (source.match(NUMBER_CONSTANT(name)) as RegExpMatchArray)[1] as string,
  );
}

describe("Home Page & Shortcuts", () => {
  const whatHomeShows: string = sectionOf(HOME, "## What Home shows");

  it("lists Home from top to bottom as the page renders it", () => {
    const homePage: string = dashboard("Pages/Home/Home.tsx");
    const order: Array<number> = [
      "<HomeCommandBar",
      "<ProjectHealthCard",
      "<GettingStarted",
      "<NeedsAttention",
      "<ProjectResources",
      "<UpcomingMaintenance",
      "<ExploreProducts",
    ].map((element: string): number => {
      return homePage.indexOf(element);
    });

    for (let index: number = 0; index < order.length; index++) {
      expect(order[index]).toBeGreaterThan(-1);
      if (index > 0) {
        expect(order[index]).toBeGreaterThan(order[index - 1] as number);
      }
    }
    expect(CHECKLIST_SOURCE).toContain('title="Welcome to OneUptime 👋"');

    const items: Array<string> = Array.from(
      whatHomeShows.matchAll(NUMBERED_ITEM),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(items).toEqual([
      "A search box, with **Declare Incident** and **Create** beside it.",
      "One line that says whether anything is wrong, over five numbers that count what needs attention.",
      "**Welcome to OneUptime 👋**, a checklist for a new project, until it is done.",
      "**Needs attention**, every problem that is open right now, by name.",
      "**Your project**, what the project is made of, and **Upcoming maintenance** when any is scheduled.",
      "**Explore OneUptime**, every product, one category at a time.",
    ]);
    expect(homeTiles().length).toBe(5);
  });

  it("names the search box's door and the create actions as the bar draws them", () => {
    const section: string = sectionOf(HOME, "### Search and create");
    const declare: string = (
      blockFrom(
        COMMAND_BAR_SOURCE,
        "export const DECLARE_INCIDENT_ACTION",
        "\n};",
      ).match(/title: translationKey\("([^"]+)"\)/) as RegExpMatchArray
    )[1] as string;
    const creates: Array<string> = Array.from(
      blockFrom(COMMAND_BAR_SOURCE, "const CREATE_ACTIONS", "\n];").matchAll(
        QUICK_ACTION_TITLE,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(declare).toBe("Declare Incident");
    expect(creates).toEqual([
      "Create Monitor",
      "Schedule Maintenance",
      "Create Announcement",
    ]);
    expect(section).toContain(`**${declare}** opens the form`);
    expect(section).toContain(
      `**Create** offers ${creates
        .slice(0, -1)
        .map((title: string): string => {
          return `**${title}**`;
        })
        .join(", ")} and **${creates[creates.length - 1]}**.`,
    );
    // The bar opens the same palette as the shortcut the section names.
    expect(COMMAND_BAR_SOURCE).toContain(
      "GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE)",
    );
    expect(COMMAND_BAR_SOURCE).toContain('[KeyboardKey.Mod, "K"]');
    expect(section).toContain("`Mod` + `K`");
    // Gated by the palette's own rule.
    expect(COMMAND_BAR_SOURCE).toContain("computeCreateActionGates(");
  });

  it("names the headline's two fixed verdicts as the card says them", () => {
    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The headline"),
    );

    expect(rows).toHaveLength(5);
    expect(boldSpans(rows[3]![1] as string)).toEqual([
      translationKeyConstant(HEALTH_SOURCE, "OPERATIONAL_HEADLINE"),
    ]);
    expect(boldSpans(rows[4]![1] as string)).toEqual([
      translationKeyConstant(HEALTH_SOURCE, "NOT_SET_UP_HEADLINE"),
    ]);
    // The verdicts in the order getProjectHealth checks them.
    const health: string = oneLine(HEALTH_SOURCE);
    const incidents: number = health.indexOf("ProjectHealthKind.Incidents,");
    const attention: number = health.indexOf(
      "ProjectHealthKind.NeedsAttention,",
    );
    const maintenance: number = health.indexOf(
      "ProjectHealthKind.Maintenance,",
    );
    const notSetUp: number = health.indexOf("ProjectHealthKind.NotSetUp,");
    const operational: number = health.indexOf(
      "kind: ProjectHealthKind.Operational,",
    );

    expect(incidents).toBeLessThan(attention);
    expect(attention).toBeLessThan(maintenance);
    expect(maintenance).toBeLessThan(notSetUp);
    expect(notSetUp).toBeLessThan(operational);
    expect(sectionOf(HOME, "### The headline")).toContain(
      "**Refresh** reads it again",
    );
  });

  it("gives the checklist's steps, what finishes each and what each opens, as the component does", () => {
    const tasks: Array<ChecklistTask> = checklistTasks();
    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The welcome checklist"),
    );

    expect(tasks.length).toBe(4);

    // Where each step goes, by the name the page gives the place.
    const OPENS: Record<string, string> = {
      MONITORS: "Monitors",
      MONITOR_CREATE: "Create Monitor",
      STATUS_PAGES: "Status Pages",
      USERS: "Users",
      ON_CALL_DUTY: "On-Call Duty",
    };

    expect(
      rows.map((row: Array<string>): string => {
        return boldSpans(row[0] as string)[0] as string;
      }),
    ).toEqual(
      tasks.map((task: ChecklistTask): string => {
        return task.title;
      }),
    );

    tasks.forEach((task: ChecklistTask, index: number): void => {
      const opens: Array<string> = boldSpans(
        (rows[index] as Array<string>)[2] as string,
      );
      const expected: Array<string> = task.createPageMap
        ? [OPENS[task.createPageMap] as string, OPENS[task.pageMap] as string]
        : [OPENS[task.pageMap] as string];

      expect({ task: task.title, opens: opens }).toEqual({
        task: task.title,
        opens: expected,
      });
    });

    // Monitors, status pages and policies: one. Team members: you and one more.
    expect(
      tasks.map((task: ChecklistTask): number => {
        return task.countMustExceed;
      }),
    ).toEqual([0, 0, 1, 0]);
    expect((rows[2] as Array<string>)[1]).toBe(
      "Someone besides you is in the project, or invited to it.",
    );
  });

  it("dismisses the checklist for this project, in this browser", () => {
    expect(CHECKLIST_SOURCE).toContain('title="Dismiss"');
    expect(CHECKLIST_SOURCE).toContain(
      "LocalStorage.setItem(getDismissKey(props.projectId), true);",
    );
    expect(CHECKLIST_SOURCE).toContain(
      "const isEveryTaskComplete: boolean = gettingStartedTasks.every(",
    );
    expect(whatHomeShows).toContain(
      "Dismissing is remembered in this browser, for this project",
    );
  });

  it("names How OneUptime works and its four products in their order", () => {
    const source: string = dashboard("Components/Home/HowOneUptimeWorks.tsx");
    const steps: Array<string> = Array.from(
      blockFrom(source, "export const HOW_IT_WORKS_STEPS", "\n];").matchAll(
        HOW_IT_WORKS_STEP_TITLE,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(source).toContain(
      'export const HOW_IT_WORKS_TITLE: string = "How OneUptime works";',
    );
    expect(CHECKLIST_SOURCE).toContain("<HowOneUptimeWorks");
    expect(whatHomeShows).toContain(
      `**How OneUptime works** shows the four core products in the order a problem flows through them: ${steps
        .slice(0, -1)
        .map((step: string): string => {
          return `**${step}**`;
        })
        .join(", ")} and **${steps[steps.length - 1]}**.`,
    );
  });

  it("describes every number by its label, what makes it count and the words it shows", () => {
    const tiles: Array<HomeTile> = homeTiles();
    const tileSection: string = sectionOf(HOME, "### The five numbers");
    const rows: Array<Array<string>> = onlyTableOf(tileSection);

    expect(tiles.length).toBe(5);

    expect(
      rows.map((row: Array<string>): [string, string] => {
        return [
          boldSpans(row[0] as string)[0] as string,
          boldSpans(row[2] as string)[0] as string,
        ];
      }),
    ).toEqual(
      tiles.map((tile: HomeTile): [string, string] => {
        return [tile.label, tile.allClearLabel];
      }),
    );

    const after: Array<string> = boldSpans(
      tileSection.slice(tileSection.indexOf("A count above zero")),
    );

    for (const tile of tiles) {
      expect({ tile: tile.key, label: tile.attentionLabel, ok: true }).toEqual({
        tile: tile.key,
        label: tile.attentionLabel,
        ok: after.includes(tile.attentionLabel),
      });

      if (tile.notSetUpLabel) {
        expect({ tile: tile.key, label: tile.notSetUpLabel, ok: true }).toEqual(
          {
            tile: tile.key,
            label: tile.notSetUpLabel,
            ok: after.includes(tile.notSetUpLabel),
          },
        );
      }
    }

    // Only the monitors and SLO numbers say they are not set up yet.
    expect(
      tiles
        .filter((tile: HomeTile): boolean => {
          return tile.notSetUpLabel !== null;
        })
        .map((tile: HomeTile): string => {
          return tile.key;
        }),
    ).toEqual(["not-operational-monitors", "slos-needing-attention"]);
  });

  it("counts what the numbers count: archived monitors left out, turned-on SLOs at risk or out of budget", () => {
    const counting: string = oneLine(OVERVIEW_DATA_SOURCE);

    expect(counting).toContain(
      "isArchived: false, currentMonitorStatus: { isOperationalState: false",
    );
    expect(counting).toContain("isEnabled: true, isArchived: false");
    expect(counting).toContain("SloStatus.AtRisk");
    expect(counting).toContain("SloStatus.BudgetExhausted");

    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The five numbers"),
    );

    expect((rows[2] as Array<string>)[1]).toBe(
      "Monitors whose status is not an operational one. Archived monitors are left out.",
    );
    expect((rows[4] as Array<string>)[1]).toBe(
      "Turned-on SLOs that are at risk or have used up their error budget",
    );
  });

  it("says how many of each kind Needs attention shows, and what it says when nothing is open", () => {
    const section: string = sectionOf(HOME, "### Needs attention");

    expect(
      numberConstant(OVERVIEW_DATA_SOURCE, "HOME_ATTENTION_LIST_LIMIT"),
    ).toBe(5);
    expect(section).toContain("Each kind shows up to five");
    expect(section).toContain("**View all**");
    expect(section).toContain(
      `**${translationKeyConstant(ATTENTION_SOURCE, "ALL_CLEAR_TITLE")}**`,
    );
    expect(
      translationKeyConstant(ATTENTION_SOURCE, "NEEDS_ATTENTION_TITLE"),
    ).toBe("Needs attention");
    // The kinds, in the order the card draws them.
    const kinds: string = oneLine(
      blockFrom(ATTENTION_SOURCE, "const groups: Array<AttentionGroup>", "];"),
    );
    const order: Array<number> = [
      "AttentionGroupKey.Incidents",
      "AttentionGroupKey.Alerts",
      "AttentionGroupKey.Monitors",
      "AttentionGroupKey.Slos",
      "AttentionGroupKey.Maintenance",
    ].map((key: string): number => {
      return kinds.indexOf(key);
    });
    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
    expect(section).toContain(
      "the open incidents, the open alerts, the monitors that are not operational, the SLOs at risk and the maintenance in progress, the most urgent first",
    );
  });

  it("names Your project's resources in the card's order, and when Upcoming maintenance shows", () => {
    const section: string = sectionOf(HOME, "### Your project");
    const titles: Array<string> = Array.from(
      blockFrom(
        RESOURCES_SOURCE,
        "export const PROJECT_RESOURCES",
        "\n];",
      ).matchAll(RESOURCE_TITLE),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(titles).toEqual([
      "Monitors",
      "Status Pages",
      "On-Call Policies",
      "SLOs",
      "Services",
      "Dashboards",
      "Workflows",
    ]);
    expect(section).toContain(
      `**Your project** counts the project's ${titles
        .slice(0, -1)
        .map((title: string): string => {
          return `**${title}**`;
        })
        .join(", ")} and **${titles[titles.length - 1]}**`,
    );
    expect(oneLine(RESOURCES_SOURCE)).toContain(
      "query: { projectId: projectId, isArchived: false }",
    );
    expect(section).toContain("**Set up**");

    expect(numberConstant(UPCOMING_SOURCE, "UPCOMING_MAINTENANCE_LIMIT")).toBe(
      3,
    );
    expect(section).toContain(
      "**Upcoming maintenance** lists the next three scheduled maintenance windows, the soonest first. It is left out when nothing is scheduled.",
    );
    // Left out until it has windows to list: while it reads, and after.
    expect(oneLine(UPCOMING_SOURCE)).toContain(
      'if (state.status !== "loaded" || state.items.length === 0) { return <></>; }',
    );
  });

  it("explores the products menu's own catalog, one category at a time", () => {
    expect(EXPLORE_SOURCE).toContain("useDashboardNavigationItems()");
    expect(EXPLORE_SOURCE).toContain("groupItemsByCategory(");
    expect(sectionOf(HOME, "### Explore OneUptime")).toContain(
      "**Explore OneUptime** shows the products of the **Products** menu one category at a time, starting with the essentials.",
    );
  });

  it("gives Home's side menu its sections and pages, in order", () => {
    const sections: Array<MenuSection> = sideMenuSections(
      dashboard("Pages/Home/SideMenu.tsx"),
    );
    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### Home's side menu"),
    );

    expect(sections.length).toBe(5);
    expect(sections[0]).toEqual({ title: "Home", items: ["Overview"] });

    // Home itself has none: the layout leaves the menu off the overview only.
    expect(dashboard("Pages/Home/Layout.tsx")).toMatch(
      /sideMenu=\{\s*isOverview \? undefined : \(\s*<DashboardSideMenu/,
    );
    expect(sectionOf(HOME, "### Home's side menu")).toContain(
      "Home itself has no side menu: it already shows everything the menu would.",
    );

    expect(
      rows.map((row: Array<string>): MenuSection => {
        return {
          title: boldSpans(row[0] as string)[0] as string,
          items: Array.from((row[1] as string).matchAll(BOLD_TEXT)).map(
            (match: RegExpMatchArray): string => {
              return match[1] as string;
            },
          ),
        };
      }),
    ).toEqual(sections);
  });

  it("names the Help menu's items, and what a narrow screen leaves out", () => {
    const help: string = dashboard("Components/Header/Help.tsx");

    expect(help).toContain('t("help.documentation", "Documentation")');
    expect(help).toContain(
      't("keyboardShortcuts.title", "Keyboard shortcuts")',
    );
    expect(help).toContain('t("help.supportEmail")');
    expect(help).toContain('t("help.chatSlack")');

    const header: string = blockFrom(
      dashboard("Components/Header/Header.tsx"),
      "rightComponents={",
      "\n      />",
    );
    const hiddenOnNarrow: Array<string> = header
      .split('className="max-lg:hidden')
      .slice(1)
      .map((chunk: string): string => {
        return chunk.slice(0, chunk.indexOf("</div>"));
      });

    expect(hiddenOnNarrow.join(" ")).toContain("<Search />");
    expect(hiddenOnNarrow.join(" ")).toContain("<AskAI />");
    expect(hiddenOnNarrow.join(" ")).toContain("<Help />");
    expect(hiddenOnNarrow.join(" ")).not.toContain("<NotificationBell");
    expect(hiddenOnNarrow.join(" ")).not.toContain("<UserProfile");
    expect(header).toContain("<NotificationBell");
    expect(header).toContain("<UserProfile");

    expect(HOME).toContain(
      "**Help** opens these docs (**Documentation**) and the **Keyboard shortcuts** list, and offers support by email and on Slack. On a narrow screen, such as a phone, **Search**, **Ask AI** and **Help** are left out to save room; the bell and your picture stay.",
    );
  });

  describe("keyboard shortcuts", () => {
    const keyboard: string = sectionOf(HOME, "## Keyboard shortcuts");
    const goTo: string = sectionOf(HOME, "### Go to a product");

    const KEY_NAMES: Record<string, string> = {
      "KeyboardKey.Mod": "Mod",
      "KeyboardKey.Escape": "Esc",
    };

    it("lists the dialog's general shortcuts, in its order", () => {
      const general: string = blockFrom(
        dashboard(
          "Components/KeyboardShortcuts/DashboardKeyboardShortcuts.tsx",
        ),
        'id: "general"',
        'id: "go-to"',
      );
      const dialog: Array<string> = Array.from(
        general.matchAll(KEY_SEQUENCE),
      ).map((match: RegExpMatchArray): string => {
        return (match[1] as string)
          .split(",")
          .map((key: string): string => {
            const trimmed: string = key.trim();

            return KEY_NAMES[trimmed] || trimmed.replace(DOUBLE_QUOTE, "");
          })
          .join(" + ");
      });
      const table: Array<Array<string>> = tablesOf(keyboard)[0] as Array<
        Array<string>
      >;

      expect(dialog.length).toBe(5);

      expect(
        table.map((row: Array<string>): string => {
          return inlineCodeOf(row[0] as string).join(" + ");
        }),
      ).toEqual(dialog);
    });

    it("lists every go-to shortcut, its key and where it goes, in the dialog's order", () => {
      const rows: Array<Array<string>> = onlyTableOf(goTo);

      expect(rows.length).toBe(getDashboardGoToShortcuts().length);
      expect(rows.length).toBeGreaterThanOrEqual(10);

      expect(
        rows.map((row: Array<string>): [Array<string>, string] => {
          return [inlineCodeOf(row[0] as string), row[1] as string];
        }),
      ).toEqual(
        getDashboardGoToShortcuts().map(
          (shortcut: DashboardGoToShortcut): [Array<string>, string] => {
            return [
              [DASHBOARD_GO_TO_LEADER_KEY, shortcut.key],
              shortcut.defaultTitle,
            ];
          },
        ),
      );
    });

    it("gives the letter the time the sequence waits for it", () => {
      expect(KEYBOARD_SEQUENCE_TIMEOUT_IN_MS).toBe(1500);
      expect(goTo).toContain(
        `Press the letter within ${KEYBOARD_SEQUENCE_TIMEOUT_IN_MS / 1000} seconds of \`g\`.`,
      );
    });

    const press: (input: {
      key: string;
      sequenceState?: KeyboardSequenceState;
      now?: number;
      isDialogOpen?: boolean;
      target?: { tagName: string };
    }) => DashboardKeyResolution = (input: {
      key: string;
      sequenceState?: KeyboardSequenceState;
      now?: number;
      isDialogOpen?: boolean;
      target?: { tagName: string };
    }): DashboardKeyResolution => {
      return resolveDashboardKeyPress({
        event: {
          key: input.key,
          target: (input.target || null) as unknown as EventTarget | null,
        },
        isShortcutsModalOpen: false,
        isDialogOpen: Boolean(input.isDialogOpen),
        sequenceState: input.sequenceState || EMPTY_KEYBOARD_SEQUENCE_STATE,
        now: input.now ?? 1000,
      });
    };

    it("goes to a product on g then its letter, but not too late, not from a field, not from under a dialog", () => {
      const armed: DashboardKeyResolution = press({ key: "g", now: 1000 });
      const inTime: DashboardKeyResolution = press({
        key: "i",
        now: 1000 + KEYBOARD_SEQUENCE_TIMEOUT_IN_MS - 100,
        sequenceState: armed.sequenceState,
      });

      expect(inTime.action).toBe(DashboardKeyAction.NavigateToPage);
      expect(inTime.pageMap).toBe(PageMap.INCIDENTS);

      const late: DashboardKeyResolution = press({
        key: "i",
        now: 1000 + KEYBOARD_SEQUENCE_TIMEOUT_IN_MS + 100,
        sequenceState: armed.sequenceState,
      });

      expect(late.action).toBe(DashboardKeyAction.None);

      const underDialog: DashboardKeyResolution = press({
        key: "i",
        now: 1100,
        sequenceState: armed.sequenceState,
        isDialogOpen: true,
      });

      expect(underDialog.action).toBe(DashboardKeyAction.None);

      for (const key of ["?", DASHBOARD_GO_TO_LEADER_KEY]) {
        expect({
          key: key,
          action: press({ key: key, target: { tagName: "INPUT" } }).action,
        }).toEqual({ key: key, action: DashboardKeyAction.None });
      }

      expect(press({ key: "?" }).action).toBe(
        DashboardKeyAction.OpenShortcutsModal,
      );
      expect(keyboard).toContain(
        "`?`, `/` and `g` do nothing while you type in a field, and nothing navigates away while a dialog is open",
      );
    });

    it("searches a list on / unless you are typing", () => {
      const table: string = readSource(
        COMMON_DIR,
        "UI/Components/ModelTable/BaseModelTable.tsx",
      );
      // Every table's header owns the shortcut (TableHeaderControls, #5135).
      const header: string = readSource(
        COMMON_DIR,
        "UI/Components/Table/TableHeaderControls.tsx",
      );

      expect(table).toContain("useTableHeaderSearchShortcut(");
      expect(header).toContain(
        'if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {',
      );
      expect(header).toContain('target.tagName === "INPUT"');
      expect(header).toContain('target.tagName === "TEXTAREA"');
    });
  });
});

// ---- Your Account -----------------------------------------------------------

const USER_MENU_KEY: RegExp = /t\("userProfile\.(\w+)"/g;
const TRANSLATION_KEY_LITERAL: RegExp = /translationKey\("([^"]+)"\)/g;

describe("Your Account", () => {
  const english: { userProfile: Record<string, string> } = JSON.parse(
    dashboard("Locales/en.json"),
  ) as { userProfile: Record<string, string> };

  it("lists the user menu as the header draws it: admin settings for master admins, the theme row with its three choices", () => {
    const source: string = dashboard("Components/Header/UserProfile.tsx");
    const keys: Array<string> = Array.from(source.matchAll(USER_MENU_KEY)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(keys).toEqual(["label", "profile", "adminSettings", "logOut"]);

    /*
     * The theme is one row between Admin Settings and Log out, which draws
     * its own words (Common's ThemeChoiceRow): "Theme", and Light, Dark and
     * System, in that order.
     */
    const menu: string = oneLine(source);
    const themeRow: number = menu.indexOf("<ThemeChoiceRow />");

    expect(themeRow).toBeGreaterThan(
      menu.indexOf('t("userProfile.adminSettings")'),
    );
    expect(themeRow).toBeLessThan(menu.indexOf('t("userProfile.logOut")'));

    const row: string = oneLine(
      readSource(
        COMMON_DIR,
        "UI/Components/Header/IconDropdown/ThemeChoiceRow.tsx",
      ),
    );
    const rowWords: Array<string> = Array.from(
      row.matchAll(TRANSLATION_KEY_LITERAL),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(rowWords).toEqual(["Theme", "Light", "Dark", "System"]);
    expect(THEME_PREFERENCES).toEqual([
      ThemePreference.Light,
      ThemePreference.Dark,
      ThemePreference.System,
    ]);

    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(YOUR_ACCOUNT, "## The user menu"),
    );

    expect(
      rows.map((tableRow: Array<string>): string => {
        return boldSpans(tableRow[0] as string)[0] as string;
      }),
    ).toEqual([
      english.userProfile["profile"] as string,
      english.userProfile["adminSettings"] as string,
      "Theme",
      english.userProfile["logOut"] as string,
    ]);

    expect(menu).toContain(
      'User.isMasterAdmin() ? ( <IconDropdownItem title={t("userProfile.adminSettings")}',
    );
    expect((rows[1] as Array<string>)[1]).toContain(
      "Only master admins of a self-hosted installation see it.",
    );
    expect(boldSpans((rows[2] as Array<string>)[1] as string)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
    expect((rows[2] as Array<string>)[1]).toContain(
      "which is light or dark as your device is set",
    );
  });

  it("opens User Profile on Overview, whose side menu folds Security and Danger Zone", () => {
    expect(oneLine(dashboard("Components/Header/Header.tsx"))).toContain(
      "onClickUserProfile={() => { Navigation.navigate(RouteMap[PageMap.USER_PROFILE_OVERVIEW]!);",
    );

    const sections: Array<MenuSection> = sideMenuSections(
      dashboard("Pages/Global/UserProfile/SideMenu.tsx"),
    );

    expect(sections).toEqual([
      { title: "Basic", items: ["Overview", "Profile Picture"] },
      {
        title: "Security",
        items: ["Password Management", "Passkeys", "Two-factor authentication"],
      },
      { title: "Danger Zone", items: ["Delete Account"] },
    ]);
    expect(isCollapsedByDefault("Basic")).toBe(false);
    expect(isCollapsedByDefault("Security")).toBe(true);
    expect(isCollapsedByDefault("Danger Zone")).toBe(true);

    expect(YOUR_ACCOUNT).toContain(
      "**Basic** holds **Overview** and **Profile Picture**. **Security** and **Danger Zone** are folded",
    );
    expect(
      onlyTableOf(sectionOf(YOUR_ACCOUNT, "## Signing in securely")).map(
        (row: Array<string>): string => {
          return boldSpans(row[0] as string)[0] as string;
        },
      ),
    ).toEqual((sections[1] as MenuSection).items);
    expect(YOUR_ACCOUNT).toContain("Open **Danger Zone → Delete Account**.");
  });

  it("edits the profile with the Basic Info card's own fields and button", () => {
    const overview: string = dashboard("Pages/Global/UserProfile/Index.tsx");

    expect(overview).toContain('title: "Basic Info"');

    for (const field of ["Email", "Full Name", "Timezone"]) {
      expect(overview).toContain(`title: "${field}"`);
      expect(YOUR_ACCOUNT).toContain(`- **${field}**: `);
    }

    // CardModelDetail names its button "Edit {{itemName}}" from the model.
    expect(overview).not.toContain("editButtonText");
    expect(`Edit ${new User().singularName}`).toBe("Edit User");
    expect(YOUR_ACCOUNT).toContain("Click **Edit User**");
    expect(dashboard("Pages/Global/UserProfile/Picture.tsx")).toContain(
      'editButtonText={"Update Profile Picture"}',
    );
  });

  it("saves the first browser's time zone silently, and asks once per time zone after that", () => {
    const timezone: string = dashboard(
      "Components/UserTimezone/UserTimezoneInit.tsx",
    );

    expect(timezone).toContain(
      "first time — silently save the browser timezone",
    );
    expect(timezone).toContain('submitButtonText={"Update Timezone"}');
    expect(timezone).toContain(
      "User.setDismissedTimezonePrompt(timezoneToSave);",
    );
    expect(YOUR_ACCOUNT).toContain(
      "The first time you sign in on a browser, OneUptime saves that browser's time zone to your profile.",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Close it, and it does not ask again for that time zone.",
    );
  });

  it("asks for a password of at least 6 characters, twice", () => {
    const password: string = dashboard("Pages/Global/UserProfile/Password.tsx");

    expect(password.split("minLength: 6").length - 1).toBe(2);
    expect(password).toContain('title: "Password"');
    expect(password).toContain('title: "Confirm Password"');
    expect(password).toContain('submitButtonText={"Update Password"}');
    expect(YOUR_ACCOUNT).toContain("It must be at least 6 characters long.");
  });

  it("adds a passkey and signs in with one, as the profile and the sign-in page name them", () => {
    const credentials: string = dashboard(
      "Components/TwoFactorAuth/WebAuthnCredentials.tsx",
    );

    expect(credentials).toContain(
      'title: props.isPasskey ? "Add Passkey" : "Add Security Key"',
    );
    expect(oneLine(credentials)).toContain(
      'isRegisteringPasskey ? "Create Passkey" : "Register Security Key"',
    );
    expect(readSource(ACCOUNTS_DIR, "Pages/Login.tsx")).toContain(
      '"login.passkey.signIn"',
    );
  });

  it("turns on two-factor authentication with the page's own words", () => {
    const page: string = dashboard(
      "Pages/Global/UserProfile/TwoFactorAuth.tsx",
    );
    const status: string = dashboard(
      "Components/TwoFactorAuth/TwoFactorStatus.tsx",
    );
    const backupCodes: string = dashboard(
      "Components/TwoFactorAuth/BackupCodes.tsx",
    );
    const keys: string = dashboard(
      "Components/TwoFactorAuth/WebAuthnCredentials.tsx",
    );

    expect(page).toContain('title: "Authenticator apps"');
    expect(page).toContain(
      "an app such as 1Password, Google Authenticator, or Microsoft Authenticator",
    );
    expect(page).toContain("enter its 6-digit code to finish setup");
    expect(page).toContain('submitButtonText="Verify and finish"');
    expect(keys).toContain(
      'name={props.isPasskey ? "Passkeys" : "Security keys"}',
    );
    expect(backupCodes).toContain('title="Your backup codes"');
    expect(backupCodes).toContain('submitButtonText="Done"');
    expect(backupCodes).toContain('"Regenerate codes"');
    expect(status).toContain('"Enable two-factor authentication"');
    expect(status).toContain('{isEnabled ? "Enabled" : "Not enabled"}');

    // The steps are headings of their own, so read the whole section.
    const turnOn: string = sectionOf(YOUR_ACCOUNT, "## Signing in securely");

    for (const label of [
      "Authenticator apps",
      "Verify and finish",
      "Security keys",
      "Your backup codes",
      "Done",
      "Enable two-factor authentication",
      "Enabled",
      "Regenerate codes",
    ]) {
      expect({ label: label, named: turnOn.includes(`**${label}**`) }).toEqual({
        label: label,
        named: true,
      });
    }
  });

  it("creates, joins and leaves projects with the controls that do it", () => {
    const picker: string = dashboard("Components/Header/ProjectPicker.tsx");
    const fields: string = readSource(
      COMMON_DIR,
      "UI/Components/Project/CreateProjectFormFields.tsx",
    );

    expect(picker).toContain('title="Create New Project"');
    expect(picker).toContain("getCreateProjectFormFields({");
    expect(fields).toContain('title: "Project Name"');
    expect(picker).toContain('submitButtonText="Create Project"');
    expect(picker).toContain(
      "setCanCreateProject(!vars.disableUserProjectCreation);",
    );

    const invitations: string = dashboard(
      "Pages/Global/ProjectInvitations.tsx",
    );

    expect(invitations).toContain('title: "Accept"');
    expect(invitations).toContain('deleteButtonText="Reject"');
    expect(dashboard("Pages/Users/Index.tsx")).toContain(
      'deleteButtonText="Remove from Project"',
    );
    expect(YOUR_ACCOUNT).toContain("There you **Accept** or **Reject** it.");
    expect(YOUR_ACCOUNT).toContain(
      "with **Remove from Project** on its **Users** page",
    );
  });

  it("lists User Settings' pages as its side menu does, in order", () => {
    const pages: Array<string> = sideMenuSections(
      dashboard("Pages/UserSettings/SideMenu.tsx"),
    ).flatMap((section: MenuSection): Array<string> => {
      return section.items;
    });
    const rows: Array<string> = onlyTableOf(
      sectionOf(YOUR_ACCOUNT, "## What each project keeps for you"),
    ).map((row: Array<string>): string => {
      return boldSpans(row[0] as string)[0] as string;
    });

    expect(rows.length).toBe(8);
    expect(
      pages.filter((page: string): boolean => {
        return rows.includes(page);
      }),
    ).toEqual(rows);
  });

  it("keeps language and theme in the browser: the browser's language first, the device's theme unless Light or Dark was picked", () => {
    const i18n: string = dashboard("Utils/i18n.ts");

    expect(i18n).toContain('order: ["localStorage", "navigator", "htmlTag"]');
    expect(i18n).toContain('caches: ["localStorage"]');
    expect(dashboard("Components/Footer/Footer.tsx")).toContain(
      "<LanguageSwitcher />",
    );

    const globals: { window?: unknown } = globalThis as unknown as {
      window?: unknown;
    };
    const savedWindow: unknown = globals.window;
    const asked: Array<string> = [];

    /*
     * A browser that kept nothing is System - the device decides - and so is
     * every browser the page is opened in for the first time.
     */
    const browserWith: (
      kept: string | null,
      prefersDark: boolean,
    ) => unknown = (kept: string | null, prefersDark: boolean): unknown => {
      return {
        localStorage: {
          getItem: (key: string): string | null => {
            asked.push(key);
            return kept;
          },
        },
        matchMedia: (): { matches: boolean } => {
          return { matches: prefersDark };
        },
      };
    };

    try {
      globals.window = browserWith(null, true);
      expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);
      expect(asked).toContain(THEME_STORAGE_KEY);

      globals.window = browserWith(null, false);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);

      globals.window = browserWith(ThemePreference.Dark, false);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);

      globals.window = browserWith(ThemePreference.Light, true);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);
    } finally {
      globals.window = savedWindow;
    }

    expect(DEFAULT_THEME_PREFERENCE).toBe(ThemePreference.System);
    expect(YOUR_ACCOUNT).toContain(
      "Both are saved in your browser, not in your account",
    );
    expect(YOUR_ACCOUNT).toContain(
      "**System** is light or dark as your device is set, and changes with it; every browser starts with it.",
    );
    // The sign-in pages draw the same theme (Accounts' views/index.ejs).
    expect(YOUR_ACCOUNT).toContain("The sign-in pages use the same theme.");
    expect(
      readSource(path.join(APP_DIR, "FeatureSet/Accounts"), "views/index.ejs"),
    ).toContain("Common/Server/Views/Partials/Theme");
    expect(YOUR_ACCOUNT).toContain(
      "the dashboard starts in your browser's language. To change it, use the language menu at the bottom of any page.",
    );
  });

  it("deletes an account only once it is in no project, for good", () => {
    const deletion: string = dashboard(
      "Pages/Global/UserProfile/DeleteAccount.tsx",
    );

    expect(deletion).toContain(
      "const canDeleteAccount: boolean = projects.length === 0;",
    );
    expect(deletion).toContain("permanent and cannot be undone");
    expect(YOUR_ACCOUNT).toContain(
      "You can delete your account only once you are in no project",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Deleting your account is permanent and cannot be undone.",
    );
  });

  it("recovers sign-in with the sign-in page's own links, and a reset verifies the address", () => {
    const login: string = readSource(ACCOUNTS_DIR, "Pages/Login.tsx");

    expect(login).toContain('t("login.forgotPassword")');
    expect(login).toContain('t("login.twoFactor.lostAccess")');

    const authentication: string = readSource(
      IDENTITY_DIR,
      "API/Authentication.ts",
    );
    const reset: string = authentication.slice(
      authentication.indexOf('"/reset-password",'),
    );

    expect(reset.slice(0, reset.indexOf("router."))).toContain(
      "isEmailVerified: true",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Its reset link verifies your address as well.",
    );
  });
});
