import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { readPage } from "./DocsContentSupport";
import { boldSpans, escapeRegExp } from "./DocsTranslationChecks";
import { foldedBlocks } from "./GettingStartedPage";
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
import { SLO_STATUSES_AT_RISK } from "../../../FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryTiles";
import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  KeyboardSequenceState,
} from "Common/UI/Utils/GlobalKeyboardShortcut";
import { SECTION_TITLES_COLLAPSED_BY_DEFAULT } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import { KEYS_KEPT_AFTER_SIGN_OUT } from "Common/UI/Utils/KeptAfterSignOut";
import ThemeUtil from "Common/UI/Utils/Theme";
import { DASHBOARD_LANGUAGE_STORAGE_KEY } from "Common/Types/Dashboard/DashboardLanguage";
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
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import ObjectID from "Common/Types/ObjectID";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NotOperationalMonitorQuery from "Common/Utils/Monitor/NotOperationalMonitorQuery";
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
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  WebsiteAddress,
  buildWebsiteMonitor,
  parseWebsiteAddress,
} from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import {
  FirstOnCallPolicyCreate,
  GUIDED_SETUP_POLICY_NAME,
  buildFirstOnCallPolicy,
} from "Common/Utils/GuidedSetup/OnCallPolicyRecords";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "Common/Types/OnCallDutyPolicy/EveryNewEventRules";
import {
  DEFAULT_WELCOME_STEPS,
  PHONE_OR_APP_METHOD_TYPES,
  WELCOME_STEP_GAP_CHECKS,
  WelcomeOutcomeFacts,
  WelcomeStep,
  canPageByPhoneOrApp,
  getWelcomeMoreSteps,
  isWelcomeStepDone,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import ProjectGoal from "Common/Types/WelcomeChecklist/ProjectGoal";
import { SetupHealthCheck } from "Common/Types/SetupHealth/SetupHealth";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
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
  // Since #6822 the import is one paragraph, its eleven tools folded under it.
  const moving: string = sectionOf(
    GETTING_STARTED,
    "## Coming from another tool",
  );

  it("names every tool the import reads, in the order the import page lists them, each linked to its own guide", () => {
    const tools: { title: string; lines: Array<string> } | undefined =
      foldedBlocks(moving)[0];

    expect(tools?.title).toBe("The eleven tools it imports from");
    expect(AllToolImportSources).toHaveLength(11);

    const rows: Array<Array<string>> = onlyTableOf(
      (tools as { lines: Array<string> }).lines.join("\n"),
    );
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

  /*
   * The three jobs after the project (#7332): each checklist step opens a
   * guided setup, so each section walks that setup - where the step leads,
   * the setup's own steps by the titles its frame draws, the words it
   * draws - and only then names the create form, as the other way in.
   */
  describe("walks the guided setup each checklist step opens", () => {
    it("says it follows the guided setups, from its first lines", () => {
      expect(QUICKSTART.split("\n")[2]).toContain(
        "It follows the **Welcome to OneUptime 👋** checklist on your project's Home page, and the guided setups its steps open.",
      );
      expect(
        QUICKSTART_GUIDED_SECTIONS.map((entry: QuickstartGuidedSection) => {
          return entry.heading;
        }),
      ).toEqual(
        QUICKSTART.split("\n")
          .filter((line: string): boolean => {
            return line.startsWith("## ");
          })
          .slice(2, 5),
      );
    });

    it("opens the website setup from Create your first monitor, and says who gets the Monitors list instead", () => {
      const task: ChecklistTask = checklistTaskOf("Monitor");
      const where: StepDestinations = stepDestinations(task);
      const first: QuickstartStep = quickstartStepsOf(
        "## Monitor your website",
      )[0] as QuickstartStep;

      expect(where).toEqual({
        mayCreate: "MONITOR_GUIDED_SETUP",
        mayNotCreate: "MONITORS",
      });
      expect(first.heading).toBe("Open the website setup");
      expect(first.body).toContain(
        `In the checklist, click **${task.title}**. It opens the guided setup **${routedGuidedSetup(where.mayCreate).title}**,`,
      );
      expect(first.body).toContain(
        `Someone who may not create ${pluralNameOf(task.gateModel as string)} gets the **${plainPageName(where.mayNotCreate as string)}** list instead.`,
      );
    });

    it("opens the status page setup from Publish a status page, from the website setup's summary too, and says who gets the Status Pages list instead", () => {
      const task: ChecklistTask = checklistTaskOf("StatusPage");
      const where: StepDestinations = stepDestinations(task);
      const first: QuickstartStep = quickstartStepsOf(
        "## Publish a status page",
      )[0] as QuickstartStep;
      const websiteSetup: string = fs.readFileSync(
        routedGuidedSetup("MONITOR_GUIDED_SETUP").setupFile,
        "utf8",
      );
      const summaryRoute: string = oneLine(
        blockFrom(
          websiteSetup,
          "const statusPageSetupRoute: Route | null =",
          ": null;",
        ),
      );
      const summaryLink: string = oneLine(
        blockFrom(websiteSetup, "to={statusPageSetupRoute}", "</AppLink>"),
      );

      expect(where).toEqual({
        mayCreate: "STATUS_PAGES_GUIDED_SETUP",
        mayNotCreate: "STATUS_PAGES",
      });
      expect(first.heading).toBe("Open the status page setup");
      expect(first.body).toContain(
        `In the checklist, click **${task.title}**. It opens the guided setup **${routedGuidedSetup(where.mayCreate).title}**,`,
      );
      expect(first.body).toContain(
        `Someone who may not create ${pluralNameOf(task.gateModel as string)} gets the **${plainPageName(where.mayNotCreate as string)}** list instead.`,
      );

      // The website setup's summary links the same setup, by these words.
      expect(summaryRoute).toContain(
        "routeOf(PageMap.STATUS_PAGES_GUIDED_SETUP)",
      );
      expect(summaryLink).toContain("WEBSITE_DOWN_COPY.nextStatusPage");
      expect(setupWord(QUICKSTART_SETUP_COPIES.website, "nextStatusPage")).toBe(
        "Show it on a status page",
      );
      expect(first.body).toContain(
        "The website setup's summary opens the same setup, as **Show it on a status page**.",
      );
    });

    /*
     * By the on-call section, the website setup's own policy pages the reader
     * and its test page was acknowledged: either ticks the on-call step, and
     * a ticked step is no longer a button. So the section opens the setup
     * from the website setup's summary (#7370), or later from Search, and
     * says the step opens it only while it is not ticked.
     */
    it("opens the on-call setup from the website setup's summary or from Search, because the website setup has ticked its checklist step", () => {
      const task: ChecklistTask = checklistTaskOf("OnCall");
      const where: StepDestinations = stepDestinations(task);
      const setup: RoutedGuidedSetup = routedGuidedSetup(where.mayCreate);
      const section: string = sectionOf(
        QUICKSTART,
        "## Get paged when it goes down",
      );
      const first: QuickstartStep = quickstartStepsOf(
        "## Get paged when it goes down",
      )[0] as QuickstartStep;
      const search: string = dashboard(
        "Components/CommandPalette/PageSearchIndex.ts",
      );
      const entry: string = search.slice(
        search.indexOf(`page: PageMap.${where.mayCreate},`),
        search.indexOf(
          "],",
          search.indexOf(`page: PageMap.${where.mayCreate},`),
        ),
      );
      const facts: (data: {
        reached: Array<ActivationMilestone>;
        hasPolicyThatPagesSomeone: boolean;
      }) => WelcomeOutcomeFacts = (data: {
        reached: Array<ActivationMilestone>;
        hasPolicyThatPagesSomeone: boolean;
      }): WelcomeOutcomeFacts => {
        return {
          reached: data.reached,
          hasPolicyThatPagesSomeone: data.hasPolicyThatPagesSomeone,
          hasFinishedImport: false,
        };
      };
      // Each step of the path is drawn by WelcomePlanStep (#8897).
      const doneStep: string = oneLine(
        blockFrom(
          PLAN_STEP_SOURCE,
          "// A done step is a record, not a way anywhere.",
          "A step to do is a button",
        ),
      );

      // The step opens the setup for everyone: no model gates it.
      expect(where).toEqual({
        mayCreate: "ON_CALL_DUTY_GUIDED_SETUP",
        mayNotCreate: null,
      });

      // Ticked by the policy's rule, or by an acknowledged test page.
      expect(
        isWelcomeStepDone(
          WelcomeStep.OnCall,
          facts({ reached: [], hasPolicyThatPagesSomeone: true }),
        ),
      ).toBe(true);
      expect(
        isWelcomeStepDone(
          WelcomeStep.OnCall,
          facts({
            reached: [ActivationMilestone.FirstTestPageAcknowledged],
            hasPolicyThatPagesSomeone: false,
          }),
        ),
      ).toBe(true);
      expect(
        isWelcomeStepDone(
          WelcomeStep.OnCall,
          facts({ reached: [], hasPolicyThatPagesSomeone: false }),
        ),
      ).toBe(false);

      // A ticked step is a record, not a button.
      expect(doneStep).toContain("<div");
      expect(doneStep).not.toContain("<button");
      expect(doneStep).not.toContain("onClick");

      // Search finds the setup by its title and the words the page gives.
      expect(entry).toContain(`title: "${setup.title}",`);
      expect(entry).toContain('"get paged",');

      expect(section).toContain(
        `so the checklist ticks **${task.title}** as done.`,
      );
      /*
       * The summary's "Get paged by SMS or phone call" opens the setup for
       * whoever may use it, as the project's owner may (#7370).
       */
      const phoneLink: string = oneLine(
        blockFrom(
          dashboard(
            "Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup.tsx",
          ),
          'dataTestId="guided-setup-next-phone"',
          "</AppLink>",
        ),
      );
      const phonePage: string = oneLine(
        blockFrom(
          dashboard("Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts"),
          "export const getPagedByPhonePage",
          "};",
        ),
      );
      const phoneWords: string = setupWord(
        QUICKSTART_SETUP_COPIES.website,
        "nextPhone",
      );

      expect(phoneLink).toContain("WEBSITE_DOWN_COPY.nextPhone");
      expect(phonePage).toContain(
        `return mayUseOnCallSetup ? PageMap.${where.mayCreate} :`,
      );
      expect(phoneWords).toBe("Get paged by SMS or phone call");

      expect(first.heading).toBe("Open the on-call setup");
      expect(first.body).toBe(
        `On the website setup's summary, click **${phoneWords}**: it opens the guided setup **${setup.title}**. To open it later, press \`Ctrl+K\` (\`Cmd+K\` on a Mac), type \`get paged\` and choose it. While the checklist has not ticked **${task.title}**, that step opens the same guided setup. Once it has, and while only email can page you, Home keeps **${phoneWords}** under it.`,
      );
      // The same words under the ticked step (#9442).
      expect(
        dashboard(
          "Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts",
        ),
      ).toContain(`phoneTitle: translationKey("${phoneWords}"),`);
    });

    it("walks each setup's steps in the order its frame draws them, each under the title it draws", () => {
      for (const entry of QUICKSTART_GUIDED_SECTIONS) {
        const task: ChecklistTask = checklistTaskOf(entry.step);
        const setup: RoutedGuidedSetup = routedGuidedSetup(
          task.guidedSetupPage as string,
        );
        const titles: Array<string> = frameStepTitles(setup);
        const steps: Array<QuickstartStep> = quickstartStepsOf(entry.heading);

        expect({ section: entry.heading, steps: titles.length }).toEqual({
          section: entry.heading,
          steps: entry.frameSteps,
        });
        // The first step opens the setup; each after it is one of its steps.
        expect({
          section: entry.heading,
          leads: steps.slice(1).map((step: QuickstartStep): string => {
            return step.body.slice(0, step.body.indexOf("**,") + 3);
          }),
        }).toEqual({
          section: entry.heading,
          leads: titles.map((title: string): string => {
            return `Under **${title}**,`;
          }),
        });
      }
    });

    it("names, inside each section's steps, only words the setup, its test page dialog or the checklist draws", () => {
      const drawn: Set<string> = new Set([
        ...setupWords(QUICKSTART_SETUP_COPIES.website),
        ...setupWords(QUICKSTART_SETUP_COPIES.onCall),
        ...setupWords(QUICKSTART_SETUP_COPIES.statusPage),
        ...TEST_PAGE_DIALOG_WORDS,
        ...checklistTasks().map((task: ChecklistTask): string => {
          return task.title;
        }),
        // The lists someone who may not create gets instead.
        plainPageName("MONITORS"),
        plainPageName("STATUS_PAGES"),
        // The monitor's status when the site is down (a new project's seed).
        seeded("downStatus"),
        /*
         * The policy the website setup makes, which its note names
         * ("This makes the on-call policy "{{policy}}"") and the on-call
         * setup's On-call policy dropdown then shows (#8329).
         */
        GUIDED_SETUP_POLICY_NAME,
      ]);
      const onCallSetup: string = fs.readFileSync(
        routedGuidedSetup("ON_CALL_DUTY_GUIDED_SETUP").setupFile,
        "utf8",
      );

      // The reach step's own button, written in its frame.
      expect(onCallSetup).toContain('title="Recheck"');
      drawn.add("Recheck");

      for (const entry of QUICKSTART_GUIDED_SECTIONS) {
        const steps: string = stepsBlockOf(
          sectionOf(QUICKSTART, entry.heading),
        );

        expect({
          section: entry.heading,
          notDrawnThere: boldSpans(steps).filter((span: string): boolean => {
            return !drawn.has(span);
          }),
        }).toEqual({ section: entry.heading, notDrawnThere: [] });
      }
    });

    it("takes the test page dialog's words from the dialog", () => {
      const button: string = dashboard(
        "Components/OnCallTestPage/SendTestPageButton.tsx",
      );
      const dialog: string = dashboard(
        "Components/OnCallTestPage/SendTestPageModal.tsx",
      );

      expect(button).toContain('return "Send me a test page";');
      expect(button).toContain('return "Test this policy";');
      expect(dialog).toContain('translator.translateText("Send test page")');
      expect(dialog).toContain('translator.translateText("Severity")');
      expect(dialog).toContain('closeButtonText="Done"');
      expect(TEST_PAGE_DIALOG_WORDS).toEqual([
        "Send me a test page",
        "Test this policy",
        "Send test page",
        "Severity",
        "Done",
      ]);
      // The website setup tests the person; the on-call setup the policy.
      expect(
        fs.readFileSync(
          routedGuidedSetup("MONITOR_GUIDED_SETUP").setupFile,
          "utf8",
        ),
      ).toContain('target={{ kind: "self" }}');
      expect(
        oneLine(
          fs.readFileSync(
            routedGuidedSetup("ON_CALL_DUTY_GUIDED_SETUP").setupFile,
            "utf8",
          ),
        ),
      ).toContain('<SendTestPageButton target={{ kind: "policy",');
      expect(quickstartStepsOf("## Monitor your website")[3]?.body).toContain(
        "click **Send me a test page**, pick a **Severity** and click **Send test page**",
      );
      expect(
        quickstartStepsOf("## Get paged when it goes down")[4]?.body,
      ).toContain(
        "click **Test this policy**, pick a **Severity** and click **Send test page**",
      );
    });

    it("names the create forms only after the setup's steps, as the other way in", () => {
      const ways: Array<[string, string]> = [
        ["## Monitor your website", createButton(new Monitor())],
        [
          "## Get paged when it goes down",
          createButton(new OnCallDutyPolicy()),
        ],
        ["## Publish a status page", createButton(new StatusPage())],
      ];

      for (const [heading, button] of ways) {
        const section: string = sectionOf(QUICKSTART, heading);
        const steps: string = stepsBlockOf(section);
        const after: string = section.slice(
          section.indexOf(steps) + steps.length,
        );

        expect({ heading, inSteps: steps.includes(`**${button}**`) }).toEqual({
          heading,
          inSteps: false,
        });
        expect({ heading, after: after.includes(`**${button}**`) }).toEqual({
          heading,
          after: true,
        });
      }

      expect(QUICKSTART).toContain(
        "open **Monitors** from the **Products** menu and click **Create Monitor**. [Creating a Monitor](/docs/monitor/create-monitor) describes the form and every monitor type.",
      );
      expect(QUICKSTART).toContain(
        "To build a policy field by field instead, open **On-Call** from the **Products** menu and click **Create On-Call Policy**.",
      );
      expect(QUICKSTART).toContain(
        "To make a page by hand instead, open **Status Pages** from the **Products** menu and click **Create Status Page**",
      );
    });

    it("no longer walks the create forms the checklist steps used to open", () => {
      const guided: string = QUICKSTART_GUIDED_SECTIONS.map(
        (entry: QuickstartGuidedSection): string => {
          return stepsBlockOf(sectionOf(QUICKSTART, entry.heading));
        },
      ).join("\n");

      for (const retired of [
        "### Open Create Monitor",
        "### Pick Website",
        "### Create the monitor",
        "### Create an on-call policy",
        "### See the rule that pages it",
        "### Create the status page",
        "### Add your monitor",
        "**Monitor Type**",
        "**Website URL**",
        "**Test Monitor**",
        "**Monitoring Interval**",
        "**Probes**",
        "**Who gets paged first?**",
        "**Add responder**",
        "**Page this policy for every new incident and alert**",
        "**User Settings**",
        "**Direct Contact**",
        "**Phone Numbers for SMS Notifications**",
        "**Status Page Link**",
        "**Display Name**",
        "**Add Monitor**",
        "**Name**",
      ]) {
        expect({ retired, found: guided.includes(retired) }).toEqual({
          retired,
          found: false,
        });
      }
    });
  });

  it("checks the website every five minutes, as the website setup's monitor is", () => {
    const setupSource: string = oneLine(
      readSource(
        DASHBOARD_DIR,
        "Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts",
      ),
    );

    expect(getMonitoringIntervalLabel(DEFAULT_MONITORING_INTERVAL)).toBe(
      "Every 5 Minutes",
    );
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveInterval(MonitorType.Website),
    ).toBe(true);
    expect(GUIDED_SETUP_MONITORING_INTERVAL).toBe(DEFAULT_MONITORING_INTERVAL);
    expect(setupSource).toContain(
      "monitoringInterval: DEFAULT_MONITORING_INTERVAL,",
    );
    expect(setupWord(QUICKSTART_SETUP_COPIES.website, "checkHelp")).toContain(
      "OneUptime makes a {{monitor}} that checks it every 5 minutes",
    );
    expect(QUICKSTART).toContain("checks your website every five minutes");
    expect(QUICKSTART).toContain(
      "The probes check it at once, then every 5 minutes",
    );
  });

  it("says what the website setup's monitor does: offline, and an incident, when the site does not answer or answers with an error", () => {
    const offline: ObjectID = ObjectID.generate();
    const address: WebsiteAddress | null = parseWebsiteAddress(
      "https://example.com",
    );
    const monitor: Monitor = buildWebsiteMonitor({
      address: address as WebsiteAddress,
      isApi: false,
      seeds: {
        operationalStatusId: ObjectID.generate(),
        offlineStatusId: offline,
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
      },
      monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
    });
    const first: MonitorCriteriaInstance = monitor.monitorSteps!.data!
      .monitorStepsInstanceArray[0]!.data!.monitorCriteria!.data!
      .monitorCriteriaInstanceArray[0] as MonitorCriteriaInstance;
    const filters: Array<CriteriaFilter> = first.data!.filters;

    expect(monitor.monitorType).toBe(MonitorType.Website);
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
      "when the site does not answer, or answers with an error, the monitor goes **Offline** and declares an incident",
    );
    expect(seeded("downStatus")).toBe("Offline");
  });

  it("makes Default on-call policy in the website setup, paging the reader for every new incident and alert, by email first", () => {
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: [ObjectID.generate().toString()],
      teamIds: [],
    });

    expect(GUIDED_SETUP_POLICY_NAME).toBe("Default on-call policy");
    expect(create.policy.name).toBe(GUIDED_SETUP_POLICY_NAME);
    expect(
      create.miscDataProps[PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY],
    ).toBe(true);
    expect(
      setupWord(QUICKSTART_SETUP_COPIES.website, "whoCreatePolicyNote"),
    ).toContain(
      "which pages them for every new incident and alert in this project",
    );
    expect(
      setupWord(QUICKSTART_SETUP_COPIES.website, "whoCreateHelp"),
    ).toContain("It starts with you, by email.");
    expect(QUICKSTART).toContain(
      `Click **Save and continue**: this makes **${GUIDED_SETUP_POLICY_NAME}**, which pages you for every new incident and alert in the project, by email to start with.`,
    );
    expect(QUICKSTART).toContain(
      `The website setup already made **${GUIDED_SETUP_POLICY_NAME}**, which pages you by email for every new incident and alert`,
    );
  });

  it("keeps that policy in the on-call setup, which adds nobody unless someone is picked", () => {
    const onCallSetup: string = fs.readFileSync(
      routedGuidedSetup("ON_CALL_DUTY_GUIDED_SETUP").setupFile,
      "utf8",
    );
    const save: string = oneLine(
      blockFrom(onCallSetup, "const savePeople", "const continueFromPeople"),
    );

    // A project with a policy picks it; nobody picked is no error then.
    expect(save).toContain(
      "if (!isExistingMode && userIds.length + teamIds.length === 0) {",
    );
    expect(setupWord(QUICKSTART_SETUP_COPIES.onCall, "whoPolicyLabel")).toBe(
      "On-call policy",
    );
    expect(setupWord(QUICKSTART_SETUP_COPIES.onCall, "whoAddToLevel")).toBe(
      "Add to the first escalation rule",
    );
    /*
     * Everyone this step adds is paged at once, with you (#7372); someone
     * not in the project yet is invited from the step (#7150).
     */
    expect(setupWord(QUICKSTART_SETUP_COPIES.onCall, "inviteByEmail")).toBe(
      "Invite by email",
    );
    expect(QUICKSTART).toContain(
      `keep **${GUIDED_SETUP_POLICY_NAME}** under **On-call policy**. To page teammates at the same time as you, add them under **Add to the first escalation rule**, or invite them with **Invite by email**. Click **Save and continue**.`,
    );
  });

  it("offers paging the same people again always, and someone else only where a second escalation rule may be added", () => {
    const onCallSetup: string = oneLine(
      fs.readFileSync(
        routedGuidedSetup("ON_CALL_DUTY_GUIDED_SETUP").setupFile,
        "utf8",
      ),
    );

    expect(onCallSetup).toContain(
      "if (maySecondLevel) { noAnswerOptions.push({ title: translator.translateText(ON_CALL_SETUP_COPY.noAnswerEscalate)",
    );
    expect(onCallSetup).toContain(
      "noAnswerOptions.push( { title: translator.translateText(ON_CALL_SETUP_COPY.noAnswerRepeat)",
    );
    expect(QUICKSTART).toContain(
      `pick **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "noAnswerRepeat")}** while you are the only person in the project. Once teammates are in, **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "noAnswerEscalate")}** pages the person you pick under **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "noAnswerSecondLevelLabel")}**.`,
    );
  });

  /*
   * A new Cloud project starts on the Free plan, where a second escalation
   * rule is not offered: the step shows only the repeat, and says why. The
   * Quickstart says so, rather than promise a choice most readers never see.
   */
  it("says Page someone else is offered on Cloud's paid plans only, as the step decides", () => {
    const setupApi: string = oneLine(
      dashboard("Components/GuidedSetup/OnCall/OnCallSetupApi.ts"),
    );
    const noAnswer: string = (
      quickstartStepsOf("## Get paged when it goes down")[3] as QuickstartStep
    ).body;

    expect(setupApi).toContain(
      "export const maySecondEscalationLevel: () => boolean = (): boolean => { if (!BILLING_ENABLED) { return true; } return ProjectUtil.getCurrentPlan() !== PlanType.Free; };",
    );
    expect(
      setupWord(QUICKSTART_SETUP_COPIES.onCall, "noAnswerFreePlan"),
    ).toContain("which needs a paid plan");
    expect(noAnswer).toContain(
      `under **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "noAnswerSecondLevelLabel")}**. On OneUptime Cloud, only paid plans offer that choice. Click **Save and continue**.`,
    );
  });

  /*
   * On Cloud, a Free plan project with no card on file may not make a monitor
   * that runs checks: the server refuses the website setup's create with the
   * payment-required message. The Quickstart says so where the reader first
   * meets it, with where to add one.
   */
  it("says a Free plan project on Cloud needs a payment method before the website setup can check, as the server requires", () => {
    const monitorService: string = oneLine(
      readSource(COMMON_DIR, "Server/Services/MonitorService.ts"),
    );
    const payAsYouGo: string = oneLine(
      readSource(COMMON_DIR, "Server/Services/PayAsYouGoBillingService.ts"),
    );
    const address: QuickstartStep = quickstartStepsOf(
      "## Monitor your website",
    )[1] as QuickstartStep;
    const billing: string = readPage("en", "configuration/billing");

    // Every monitor but a Manual one asks for pay-as-you-go on create.
    expect(monitorService).toContain(
      "if (IsBillingEnabled && createBy.props.tenantId) { if (createBy.data.monitorType !== MonitorType.Manual) { await PayAsYouGoBillingService.requirePayAsYouGo( createBy.props.tenantId, ); }",
    );
    // Which a paid plan has, and the Free plan has only with a card on file.
    expect(payAsYouGo).toContain(
      'if (plan.getName() !== PlanType.Free) { return "paid-plan"; }',
    );
    expect(payAsYouGo).toContain(
      'if ( await BillingService.hasPaymentMethods(project.paymentProviderCustomerId) ) { return "payment-method"; }',
    );
    expect(payAsYouGo).toContain(
      '"Add a payment method in Project Settings > Billing and Invoices > Billing before using paid monitoring or telemetry. These features have usage charges even on the Free plan.',
    );
    // The website setup makes a Website or an API monitor, never a Manual one.
    expect(
      buildWebsiteMonitor({
        address: parseWebsiteAddress("https://example.com") as WebsiteAddress,
        isApi: true,
        seeds: {
          operationalStatusId: ObjectID.generate(),
          offlineStatusId: ObjectID.generate(),
          incidentSeverityId: ObjectID.generate(),
          alertSeverityId: ObjectID.generate(),
        },
        monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
      }).monitorType,
    ).not.toBe(MonitorType.Manual);

    expect(address.body).toContain(
      "On OneUptime Cloud's Free plan, monitors are billed as they are used, so the project needs a payment method before it can check your site: without one, the step says so before **Start checking**, with **Add Payment Method** to [add one](/docs/configuration/billing#payment-methods).",
    );
    // Said before the button, with the billing page's own button (#7367).
    expect(setupWord(QUICKSTART_SETUP_COPIES.website, "addPaymentMethod")).toBe(
      "Add Payment Method",
    );
    expect(
      dashboard(
        "Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup.tsx",
      ),
    ).toContain("{paymentNotice}");
    // The link lands on the billing page's section that adds one.
    expect(billing.split("\n")).toContain("## Payment methods");
    expect(billing).toContain("adding one turns on pay-as-you-go usage");
  });

  it("says the reach step lists the sign-in email, finds the app with Recheck, and asks for balance before a number on Cloud", () => {
    const reach: string = (
      quickstartStepsOf("## Get paged when it goes down")[1] as QuickstartStep
    ).body;

    expect(setupWord(QUICKSTART_SETUP_COPIES.onCall, "emailRow")).toBe("Email");
    expect(setupWord(QUICKSTART_SETUP_COPIES.onCall, "phoneBalance")).toContain(
      "Texts and calls are paid from this project's balance",
    );
    expect(reach).toContain("your sign-in email is listed already");
    expect(reach).toContain(
      "install the OneUptime On-Call app from the App Store or Google Play, sign in, and click **Recheck**",
    );
    // Push is set up in the step itself (#7149): the app's codes, or this browser.
    expect(reach).toContain(
      `**${setupWord(QUICKSTART_SETUP_COPIES.onCall, "getTheApp")}** shows a code to scan for each store, and **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "useThisBrowser")}** has this browser paged too.`,
    );
    expect(reach).toContain(
      `click **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "turnOnSmsAndCalls")}**, type your number in **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "phoneLabel")}** and click **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "sendSmsCode")}**: on OneUptime Cloud, texts and calls are paid from the project's balance, so the step asks you to add some first.`,
    );
  });

  it("ends each setup where its frame does", () => {
    const steps: (heading: string) => Array<QuickstartStep> = quickstartStepsOf;

    expect(steps("## Monitor your website")[3]?.body).toContain(
      `and **${setupWord(QUICKSTART_SETUP_COPIES.website, "continueButton")}**: the setup ends on a summary of what it set up.`,
    );
    expect(steps("## Get paged when it goes down")[4]?.body).toContain(
      `The setup ends on **${setupWord(QUICKSTART_SETUP_COPIES.onCall, "summaryTitle")}**.`,
    );
    expect(steps("## Publish a status page")[2]?.body).toContain(
      `click **${setupWord(QUICKSTART_SETUP_COPIES.statusPage, "reviewButton")}**. The setup ends on a summary with what to do next.`,
    );
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
      "A Project Owner, a Billing Admin or someone with Manage Billing",
    );
    expect(
      menuSection(dashboard("Pages/Settings/SideMenu.tsx"), "Notifications")
        .items,
    ).toContain("Notification Channels");
    expect(QUICKSTART).toContain(
      "SMS and phone calls are off in a new project. A Project Owner, a Billing Admin or someone with Manage Billing turns them on in the **Notification Channels** card, under **Project Settings → Notifications → Notification Channels**.",
    );
  });

  it("publishes a status page that is public from its first save, and makes one by hand on its Overview", () => {
    expect(
      new StatusPage().getTableColumnMetadata("isPublicStatusPage")
        .defaultValue,
    ).toBe(true);
    expect(
      setupWord(QUICKSTART_SETUP_COPIES.statusPage, "publicNotice"),
    ).toContain("The page is public as soon as you create it");
    expect(QUICKSTART).toContain(
      "The page is public at its link from this moment: anyone with its address can open it.",
    );

    // The setup's first step creates it with the monitors picked.
    expect(setupWord(QUICKSTART_SETUP_COPIES.statusPage, "createButton")).toBe(
      "Create the status page",
    );
    expect(QUICKSTART).toContain(
      "Under **What it shows**, tick your website monitor, and click **Create the status page**.",
    );

    // By hand: the new page opens on its Overview, whose first step is Add Monitors.
    expect(dashboard("Pages/StatusPages/StatusPages.tsx")).toContain(
      "RouteMap[PageMap.STATUS_PAGE_VIEW]",
    );
    expect(StatusPageOverviewCopy.firstStepButton).toBe("Add Monitors");
    expect(QUICKSTART).toContain(
      "then add your monitor with **Add Monitors** on its **Overview**.",
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

/*
 * The helpers above, on made-up pages: a step block and its steps are read
 * as the docs draw them, so a section the reader sees as three steps is
 * three steps here.
 */
describe("the Quickstart's step readers", () => {
  const PAGE: string = [
    "## A section",
    "",
    "Before the steps.",
    "",
    ":::steps",
    "### First",
    "",
    "One line.",
    "",
    "### Second",
    "",
    "![A picture](screen:some-shot)",
    "",
    "Under **Title**, a line.",
    ":::",
    "",
    "After the steps.",
  ].join("\n");

  it("reads the steps block from :::steps to the line that closes it", () => {
    const block: string = stepsBlockOf(PAGE);

    expect(block.split("\n")[0]).toBe(":::steps");
    expect(block.split("\n").pop()).toBe(":::");
    expect(block).not.toContain("Before the steps.");
    expect(block).not.toContain("After the steps.");
  });

  it("reads each step's heading and its words, leaving pictures out", () => {
    expect(stepsOfBlock(stepsBlockOf(PAGE))).toEqual([
      { heading: "First", body: "One line." },
      { heading: "Second", body: "Under **Title**, a line." },
    ]);
  });

  it("finds no steps where a page has no steps block", () => {
    expect(() => {
      return stepsBlockOf("## A section\n\nNo steps here.");
    }).toThrow();
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

  /*
   * #6818 took Core Concepts past the core loop: what you watch, reliability
   * targets, security, what you install and the kinds of rule, so it covers
   * what a newcomer meets in the menu's first three categories and the
   * things they install.
   */
  it("covers what you watch, reliability targets, security, what you install and the kinds of rule, in reading order", () => {
    const sections: Array<string> = CORE_CONCEPTS.split("\n").filter(
      (line: string): boolean => {
        return line.startsWith("## ");
      },
    );

    expect(sections).toEqual([
      "## How the pieces connect",
      "## Projects and people",
      "## Monitors and probes",
      "## What you watch",
      "## Reliability targets",
      "## Incidents and alerts",
      "## On-call",
      "## Status pages and maintenance",
      "## Telemetry",
      "## Security",
      "## What you install, and the keys",
      "## Automation and AI",
      "## Labels and owners",
      "## The kinds of rule",
      "## Next steps",
    ]);
  });

  it("sends a reader to the Glossary for one word and to Which One Do I Use? for two that look alike", () => {
    const opening: string = CORE_CONCEPTS.split("\n")[2] as string;

    expect(opening).toContain("[Glossary](/docs/introduction/glossary)");
    expect(opening).toContain(
      "[Which One Do I Use?](/docs/introduction/which-one)",
    );
    expect(
      sectionOf(CORE_CONCEPTS, "## What you install, and the keys"),
    ).toContain(
      "(/docs/introduction/which-one#probe-agent-collector-or-runner)",
    );
  });

  it("names the products of the menu's first three categories", () => {
    const essentials: Array<string> = [
      "monitor",
      "incident",
      "alert",
      "on-call",
      "status page",
      "maintenance",
      "SLO",
    ];

    for (const word of essentials) {
      expect({ word: word, named: CORE_CONCEPTS.includes(word) }).toEqual({
        word: word,
        named: true,
      });
    }

    // Observability, in the menu's own order, as the menu names each one.
    const navigation: string = dashboard("Utils/NavigationItems.tsx");
    const items: Record<string, string> = (
      JSON.parse(dashboard("Locales/en.json")) as {
        navbar: { items: Record<string, string> };
      }
    ).navbar.items;
    const observability: Array<string> = [
      "logsTitle",
      "metricsTitle",
      "tracesTitle",
      "performanceProfilesTitle",
      "exceptionsTitle",
      "llmObservabilityTitle",
      "dataObservabilityTitle",
      "topologyTitle",
    ];
    const positions: Array<number> = observability.map(
      (key: string): number => {
        return navigation.indexOf(`navbar.items.${key}`);
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

    const telemetry: string = sectionOf(CORE_CONCEPTS, "## Telemetry");
    const named: Array<string> = boldSpans(
      telemetry.slice(telemetry.indexOf("In the menu,")),
    );

    expect(named).toEqual(
      observability.map((key: string): string => {
        return items[key] as string;
      }),
    );

    // Security, both of its products.
    expect(boldSpans(sectionOf(CORE_CONCEPTS, "## Security"))).toEqual([
      items["securityEventsTitle"],
      items["dataSecurityTitle"],
    ]);
  });

  it("names every kind of rule as the side menus that list it do", () => {
    const table: Array<Array<string>> = onlyTableOf(
      sectionOf(CORE_CONCEPTS, "## The kinds of rule"),
    );
    const rules: Array<string> = table.flatMap(
      (row: Array<string>): Array<string> => {
        return boldSpans(row[1] as string);
      },
    );
    const listed: Set<string> = new Set<string>([
      ...menuSection(dashboard("Pages/Incidents/SideMenu.tsx"), "Rules").items,
      ...menuSection(dashboard("Pages/Alerts/SideMenu.tsx"), "Rules").items,
    ]);

    expect(rules.length).toBeGreaterThanOrEqual(10);

    for (const rule of rules) {
      const where: boolean =
        listed.has(rule) ||
        // A policy's own levels.
        (rule === "Escalation Rules" &&
          dashboard("Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx").includes(
            'title: "Escalation Rules"',
          )) ||
        // OneUptime AI's rules, under AI → Settings.
        rule === AUTO_REMEDIATION_RULES;

      expect({ rule: rule, where: where }).toEqual({ rule: rule, where: true });
    }

    // Every rule Incidents lists has its family.
    for (const rule of menuSection(
      dashboard("Pages/Incidents/SideMenu.tsx"),
      "Rules",
    ).items) {
      expect({ rule: rule, named: rules.includes(rule) }).toEqual({
        rule: rule,
        named: true,
      });
    }
  });

  it("measures an SLO as often as the SLO pages say, and links the service diagram's pieces to their pages", () => {
    expect(sectionOf(CORE_CONCEPTS, "## Reliability targets")).toContain(
      "every 5 minutes",
    );
    expect(readPage("en", "slo/introduction")).toContain(
      "OneUptime measures every SLO against its target every 5 minutes",
    );

    const watch: string = sectionOf(CORE_CONCEPTS, "## What you watch");

    expect(watch).toContain(
      'title="One service, what watches it, and where it shows"',
    );

    for (const page of [
      "/docs/monitor/monitor-groups",
      "/docs/telemetry/services",
      "/docs/inventory/overview",
    ]) {
      expect(watch).toContain(`(${page})`);
    }
  });
});

// AI rules' name, as their model names them.
const AUTO_REMEDIATION_RULES: string = String(
  readSource(COMMON_DIR, "Models/DatabaseModels/AutoRemediationRule.ts").match(
    /pluralName: "([^"]+)"/,
  )?.[1],
);

// ---- Home Page & Shortcuts --------------------------------------------------

const CHECKLIST_SOURCE: string = dashboard(
  "Components/Home/GettingStarted.tsx",
);
// The Welcome checklist's steps, words and pages (issue #6803).
const CHECKLIST_CATALOG_SOURCE: string = dashboard(
  "Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts",
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
// The greeting the checklist opens with (#8897).
const GREETING_SOURCE: string = dashboard(
  "Components/Home/WelcomeChecklist/WelcomeGreeting.tsx",
);
// Home, which is the checklist alone while it shows (#8897).
const HOME_PAGE_SOURCE: string = dashboard("Pages/Home/Home.tsx");
// One step of the checklist's path, with about how long it takes (#8897).
const PLAN_STEP_SOURCE: string = dashboard(
  "Components/Home/WelcomeChecklist/WelcomePlanStep.tsx",
);
// The question, with what the goals picked bring (#8897).
const QUESTION_SOURCE: string = dashboard(
  "Components/Home/WelcomeChecklist/GoalQuestion.tsx",
);
// The frame every guided setup is drawn in.
const GUIDED_SETUP_FRAME_SOURCE: string = dashboard(
  "Components/GuidedSetup/GuidedSetupFrame.tsx",
);

// The panel beside a guided setup's steps, which the frame draws (#10276).
const GUIDED_SETUP_PANEL_SOURCE: string = dashboard(
  "Components/GuidedSetup/GuidedSetupResourcePanel.tsx",
);

const TASK_STEP: RegExp =
  /^ {4}step: WelcomeStep\.(\w+),\n {4}title: translationKey\("([^"]+)"\),$/gm;
const TASK_PAGE_MAP: RegExp = /^ {4}pageMap: PageMap\.(\w+),$/m;
const TASK_CREATE_PAGE_MAP: RegExp =
  /createPage: \{\s*pageMap: PageMap\.(\w+),/;
const TASK_CREATE_MODEL: RegExp =
  /createPage: \{\s*pageMap: PageMap\.\w+,\s*modelType: (\w+),/;
const TASK_GUIDED_SETUP_PAGE: RegExp =
  /^ {4}guidedSetupPage: PageMap\.(\w+),$/m;
const TASK_GUIDED_SETUP_MODEL: RegExp = /^ {4}guidedSetupModelType: (\w+),$/m;
const TASK_LANDING: RegExp = /^ {4}landing: /m;
const TILE_KEY: RegExp = /^ {4}key: "([^"]+)",$/gm;
const TILE_FIELD: (field: string) => RegExp = (field: string): RegExp => {
  return new RegExp(`^ {4}${field}: "([^"]+)",$`, "m");
};
// A tile's own page, not its not-set-up one (that is indented deeper).
const TILE_PAGE_MAP: RegExp = /^ {4}pageMap: PageMap\.(\w+),$/m;
// The filters a tile's list opens with while its count is above zero.
const TILE_ATTENTION_LINK_QUERY: RegExp = /^ {4}attentionLinkQuery: (\w+),$/m;
const ATTENTION_GROUP_TITLE: RegExp = /title: translationKey\("([^"]+)"\)/;
const ATTENTION_GROUP_VIEW_ALL: RegExp = /viewAll: PageMap\.(\w+),/;
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
const KEY_SEQUENCE: RegExp = /keySequence: \[\[([^\]]+)\]\]/g;
const QUICK_ACTION_TITLE: RegExp = /title: translationKey\("([^"]+)"\)/g;
const RESOURCE_TITLE: RegExp = /title: translationKey\("([^"]+)"\)/g;
const NUMBERED_ITEM: RegExp = /^\d+\. (.+)$/gm;

// Each checklist step, as the catalog's array literal declares it.
interface ChecklistTask {
  step: string;
  title: string;
  pageMap: string | null;
  createPageMap: string | null;
  // The guided setup that takes the step over (#6804-#6806), if any.
  guidedSetupPage: string | null;
  /*
   * The model someone must be allowed to create to be sent past today's
   * page: the create page's, else the guided setup's own. Null when the step
   * sends everyone to the same place.
   */
  gateModel: string | null;
  // The two places that model is read from, as declared.
  createModel: string | null;
  setupModel: string | null;
  // Whether the step draws the next-step line where its record lands.
  hasLanding: boolean;
}

function checklistTasks(): Array<ChecklistTask> {
  const block: string = blockFrom(
    CHECKLIST_CATALOG_SOURCE,
    "export const WELCOME_STEPS",
    "\n];",
  );
  const starts: Array<RegExpMatchArray> = Array.from(block.matchAll(TASK_STEP));

  return starts.map((match: RegExpMatchArray, index: number): ChecklistTask => {
    const chunk: string = block.slice(
      match.index,
      starts[index + 1]?.index ?? block.length,
    );
    const createModel: string | null =
      (chunk.match(TASK_CREATE_MODEL)?.[1] as string | undefined) || null;
    const setupModel: string | null =
      (chunk.match(TASK_GUIDED_SETUP_MODEL)?.[1] as string | undefined) || null;

    return {
      step: match[1] as string,
      title: match[2] as string,
      pageMap: (chunk.match(TASK_PAGE_MAP)?.[1] as string | undefined) || null,
      createPageMap:
        (chunk.match(TASK_CREATE_PAGE_MAP)?.[1] as string | undefined) || null,
      guidedSetupPage:
        (chunk.match(TASK_GUIDED_SETUP_PAGE)?.[1] as string | undefined) ||
        null,
      gateModel: createModel || setupModel,
      createModel: createModel,
      setupModel: setupModel,
      hasLanding: TASK_LANDING.test(chunk),
    };
  });
}

/*
 * How many lines of the catalog's step list declare a field, comments left
 * out: what checklistTasks must have read, field by field.
 */
function declaredFieldLines(field: string): number {
  return blockFrom(
    CHECKLIST_CATALOG_SOURCE,
    "export const WELCOME_STEPS",
    "\n];",
  )
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().startsWith(`${field}:`);
    }).length;
}

/*
 * Where a step leads, by the rule getWelcomeStepPage follows (the test
 * "routes each step by the rule the table states" holds its source to it,
 * and Common's WelcomeStepPageRule runs it on every step):
 *
 *   - someone who may create what the step asks for goes to its guided
 *     setup, else its create page, else today's page;
 *   - anyone else goes to today's page, unless the step names no model to
 *     create - then everyone goes where the first person does.
 */
interface StepDestinations {
  mayCreate: string;
  // Only when it is another page.
  mayNotCreate: string | null;
}

function stepDestinations(task: ChecklistTask): StepDestinations {
  const forCreators: string = (task.guidedSetupPage ||
    task.createPageMap ||
    task.pageMap) as string;
  const forOthers: string = task.gateModel
    ? (task.pageMap as string)
    : forCreators;

  return {
    mayCreate: forCreators,
    mayNotCreate: forOthers === forCreators ? null : forOthers,
  };
}

const ROUTES_DIR: string = path.join(DASHBOARD_DIR, "Routes");
const PAGE_TITLE_PROP: RegExp = /title=\{(\w+)\.(\w+)\}/;
const PAGE_ONLY_CHILD: RegExp = /<(\w+) \/>/;
const MODEL_PLURAL_NAME: RegExp = /pluralName: "([^"]+)"/;

// The file a default or named import of a source file brings in.
function importedFile(
  fromFile: string,
  name: string,
  extension: string,
): string {
  const source: string = fs.readFileSync(fromFile, "utf8");
  const named: string = escapeRegExp(name);
  const match: RegExpMatchArray | null =
    source.match(new RegExp(`^import ${named} from "([^"]+)";$`, "m")) ||
    source.match(new RegExp(`^import \\{ ${named} \\} from "([^"]+)";$`, "m"));

  expect({ file: fromFile, name: name, imported: match !== null }).toEqual({
    file: fromFile,
    name: name,
    imported: true,
  });

  return path.join(
    path.dirname(fromFile),
    `${(match as RegExpMatchArray)[1]}${extension}`,
  );
}

interface RoutedGuidedSetup {
  // The title its page draws, as Search and the docs name it.
  title: string;
  // The page drawn at the route, and the setup it draws.
  pageFile: string;
  setupFile: string;
}

/*
 * A guided setup, read through the Dashboard's routing: the route that
 * draws the page for this PageMap entry (Routes/), the page file it imports,
 * the title that page gives itself and the setup component it draws.
 */
function routedGuidedSetup(pageMap: string): RoutedGuidedSetup {
  const element: RegExp = new RegExp(
    `<(\\w+)\\s+\\{\\.\\.\\.props\\}\\s+pageRoute=\\{RouteMap\\[PageMap\\.${escapeRegExp(pageMap)}\\] as Route\\}`,
  );
  const routes: Array<{ file: string; component: string }> = fs
    .readdirSync(ROUTES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .flatMap((file: string): Array<{ file: string; component: string }> => {
      const match: RegExpMatchArray | null = readSource(ROUTES_DIR, file).match(
        element,
      );

      return match ? [{ file: file, component: match[1] as string }] : [];
    });

  expect({ page: pageMap, routes: routes.length }).toEqual({
    page: pageMap,
    routes: 1,
  });

  const route: { file: string; component: string } = routes[0] as {
    file: string;
    component: string;
  };
  const pageFile: string = importedFile(
    path.join(ROUTES_DIR, route.file),
    route.component,
    ".tsx",
  );
  const page: string = fs.readFileSync(pageFile, "utf8");
  const titleProp: RegExpMatchArray | null = page.match(PAGE_TITLE_PROP);
  const child: RegExpMatchArray | null = page.match(PAGE_ONLY_CHILD);

  expect({
    page: pageMap,
    title: Boolean(titleProp),
    child: Boolean(child),
  }).toEqual({ page: pageMap, title: true, child: true });

  const copy: string = oneLine(
    fs.readFileSync(
      importedFile(
        pageFile,
        (titleProp as RegExpMatchArray)[1] as string,
        ".ts",
      ),
      "utf8",
    ),
  );
  const title: RegExpMatchArray | null = copy.match(
    new RegExp(
      `\\b${escapeRegExp((titleProp as RegExpMatchArray)[2] as string)}: translationKey\\( ?"([^"]+)",? ?\\)`,
    ),
  );

  expect({ page: pageMap, titled: title !== null }).toEqual({
    page: pageMap,
    titled: true,
  });

  return {
    title: (title as RegExpMatchArray)[1] as string,
    pageFile: pageFile,
    setupFile: importedFile(
      pageFile,
      (child as RegExpMatchArray)[1] as string,
      ".tsx",
    ),
  };
}

// A model's plural name, lowercased as a sentence says it: "status pages".
function pluralNameOf(model: string): string {
  return String(
    readSource(COMMON_DIR, `Models/DatabaseModels/${model}.ts`).match(
      MODEL_PLURAL_NAME,
    )?.[1],
  ).toLowerCase();
}

// Today's pages a step opens, by the name each page gives the place.
const PLAIN_PAGE_NAMES: Record<string, string> = {
  SETTINGS_IMPORT_FROM_TOOL: "Import from another tool",
  MONITORS: "Monitors",
  MONITOR_CREATE: "Create Monitor",
  HOSTS: "Hosts",
  LOGS: "Logs",
  STATUS_PAGES: "Status Pages",
  USERS: "Users",
  ON_CALL_DUTY: "On-Call",
};

function plainPageName(page: string): string {
  expect({ page: page, named: page in PLAIN_PAGE_NAMES }).toEqual({
    page: page,
    named: true,
  });

  return PLAIN_PAGE_NAMES[page] as string;
}

/*
 * What the English table's Opens cell says for a step, from where the step
 * leads: its guided setup by the title its page draws, else its create form,
 * else today's page by name; then, when someone who may not create what the
 * step asks for lands elsewhere, that list.
 */
function opensCell(task: ChecklistTask): string {
  const where: StepDestinations = stepDestinations(task);
  let first: string;

  if (where.mayCreate === task.guidedSetupPage) {
    first = `The guided setup **${routedGuidedSetup(where.mayCreate).title}**`;
  } else if (where.mayCreate === task.createPageMap) {
    first = `The **${plainPageName(where.mayCreate)}** form`;
  } else {
    first = `**${plainPageName(where.mayCreate)}**`;
  }

  if (!where.mayNotCreate) {
    return first;
  }

  return `${first}, or the **${plainPageName(where.mayNotCreate)}** list for someone who may not create ${pluralNameOf(task.gateModel as string)}.`;
}

// A guided setup's last part says what to do next (its summaryNext words).
const GUIDED_SETUP_SUMMARY_NEXT: RegExp = /translateText\(\w+\.summaryNext\)/;
// The page Home's headline button links to.
const HEADLINE_BUTTON_PAGE: RegExp =
  /to=\{RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.(\w+)\] as Route,? \)\}/;

interface HomeTile {
  key: string;
  label: string;
  // The page the number opens: a product's own list (#6857).
  pageMap: string;
  attentionLabel: string;
  allClearLabel: string;
  notSetUpLabel: string | null;
  // What sets that list's filters while the count is above zero, if anything.
  attentionLinkQuery: string | null;
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
      pageMap: (chunk.match(TILE_PAGE_MAP) as RegExpMatchArray)[1] as string,
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
      attentionLinkQuery:
        (chunk.match(TILE_ATTENTION_LINK_QUERY)?.[1] as string | undefined) ||
        null,
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

// ---- the Quickstart's guided setups (#7332) ---------------------------------

/*
 * The three sections of the Quickstart that walk a guided setup: each is
 * the job of a checklist step, and walks the setup that step opens, whose
 * frame draws this many steps.
 */
interface QuickstartGuidedSection {
  heading: string;
  // The checklist step, as WelcomeStep names it.
  step: string;
  frameSteps: number;
}

const QUICKSTART_GUIDED_SECTIONS: ReadonlyArray<QuickstartGuidedSection> = [
  { heading: "## Monitor your website", step: "Monitor", frameSteps: 3 },
  { heading: "## Get paged when it goes down", step: "OnCall", frameSteps: 4 },
  { heading: "## Publish a status page", step: "StatusPage", frameSteps: 2 },
];

// A step of a :::steps block: its heading's words, and its lines of words.
interface QuickstartStep {
  heading: string;
  body: string;
}

const STEPS_OPENING: string = ":::steps";
const STEPS_CLOSING: string = ":::";
const STEP_HEADING_PREFIX: string = "### ";
const PICTURE_LINE_PREFIX: string = "![";

// The :::steps block of some markdown, from its opening line to its closing one.
function stepsBlockOf(markdown: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(STEPS_OPENING);
  const end: number = lines.indexOf(STEPS_CLOSING, start + 1);

  if (start < 0 || end < 0) {
    throw new Error("No :::steps block");
  }

  return lines.slice(start, end + 1).join("\n");
}

/*
 * The steps of a :::steps block, each with the words under its heading:
 * blank lines and pictures left out, as a reader reads the instructions.
 */
function stepsOfBlock(block: string): Array<QuickstartStep> {
  const steps: Array<{ heading: string; lines: Array<string> }> = [];

  for (const line of block.split("\n")) {
    if (line.startsWith(STEP_HEADING_PREFIX)) {
      steps.push({
        heading: line.slice(STEP_HEADING_PREFIX.length),
        lines: [],
      });
      continue;
    }

    if (
      !line.trim() ||
      line === STEPS_OPENING ||
      line === STEPS_CLOSING ||
      line.startsWith(PICTURE_LINE_PREFIX)
    ) {
      continue;
    }

    steps[steps.length - 1]?.lines.push(line);
  }

  return steps.map(
    (step: { heading: string; lines: Array<string> }): QuickstartStep => {
      return { heading: step.heading, body: step.lines.join("\n") };
    },
  );
}

function quickstartStepsOf(heading: string): Array<QuickstartStep> {
  return stepsOfBlock(stepsBlockOf(sectionOf(QUICKSTART, heading)));
}

function checklistTaskOf(step: string): ChecklistTask {
  const task: ChecklistTask | undefined = checklistTasks().find(
    (candidate: ChecklistTask): boolean => {
      return candidate.step === step;
    },
  );

  expect({ step: step, found: Boolean(task) }).toEqual({
    step: step,
    found: true,
  });

  return task as ChecklistTask;
}

/*
 * A guided setup's words: the copy object its file exports, React-free so
 * it is read as source (the Dashboard's copy files load the browser's
 * config on import).
 */
interface SetupCopy {
  object: string;
  file: string;
}

const QUICKSTART_SETUP_COPIES: {
  website: SetupCopy;
  onCall: SetupCopy;
  statusPage: SetupCopy;
} = {
  website: {
    object: "WEBSITE_DOWN_COPY",
    file: "Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts",
  },
  onCall: {
    object: "ON_CALL_SETUP_COPY",
    file: "Components/GuidedSetup/OnCall/OnCallSetup.ts",
  },
  statusPage: {
    object: "STATUS_PAGE_SETUP_COPY",
    file: "Components/GuidedSetup/StatusPage/StatusPageSetup.ts",
  },
};

const COPY_PROPERTY_LINE: RegExp = /^ {2}(\w+): /gm;

// The values half of a copy object ("} = { ... };"), on one line.
function copyValuesOf(copy: SetupCopy): string {
  const block: string = blockFrom(
    dashboard(copy.file),
    `export const ${copy.object}: {`,
    "\n};",
  );

  return block.slice(block.indexOf("} = {"));
}

function copyOfObject(object: string): SetupCopy {
  const copy: SetupCopy | undefined = Object.values(
    QUICKSTART_SETUP_COPIES,
  ).find((candidate: SetupCopy): boolean => {
    return candidate.object === object;
  });

  expect({ object: object, known: Boolean(copy) }).toEqual({
    object: object,
    known: true,
  });

  return copy as SetupCopy;
}

/*
 * The English a copy object's property holds: its translationKey("..."), a
 * plain "..." string, or another setup's word it reuses
 * (continueButton: WEBSITE_DOWN_COPY.continueButton).
 */
function setupWord(copy: SetupCopy, property: string): string {
  const values: string = oneLine(copyValuesOf(copy));
  const named: string = escapeRegExp(property);
  const key: RegExpMatchArray | null = values.match(
    new RegExp(
      `\\b${named}: translationKey\\( ?"((?:[^"\\\\]|\\\\.)*)",? ?\\)`,
    ),
  );

  if (key) {
    return JSON.parse(`"${key[1] as string}"`) as string;
  }

  // Words that quote something are kept in single quotes: '"{{name}}" is live'.
  const quotingKey: RegExpMatchArray | null = values.match(
    new RegExp(`\\b${named}: translationKey\\( ?'([^'\\\\]*)',? ?\\)`),
  );

  if (quotingKey) {
    return quotingKey[1] as string;
  }

  const plain: RegExpMatchArray | null = values.match(
    new RegExp(`\\b${named}: "((?:[^"\\\\]|\\\\.)*)",`),
  );

  if (plain) {
    return JSON.parse(`"${plain[1] as string}"`) as string;
  }

  const reused: RegExpMatchArray | null = values.match(
    new RegExp(`\\b${named}: (\\w+_COPY)\\.(\\w+),`),
  );

  expect({
    copy: copy.object,
    property: property,
    read: Boolean(reused),
  }).toEqual({ copy: copy.object, property: property, read: true });

  return setupWord(
    copyOfObject((reused as RegExpMatchArray)[1] as string),
    (reused as RegExpMatchArray)[2] as string,
  );
}

// Every word a setup's copy object holds.
function setupWords(copy: SetupCopy): Array<string> {
  return Array.from(copyValuesOf(copy).matchAll(COPY_PROPERTY_LINE)).map(
    (match: RegExpMatchArray): string => {
      return setupWord(copy, match[1] as string);
    },
  );
}

const FRAME_STEP_TITLE: RegExp = /^ +title: (\w+_COPY)\.(\w+Title),$/gm;

// The titles of a guided setup's steps, in the order its frame draws them.
function frameStepTitles(setup: RoutedGuidedSetup): Array<string> {
  const frameSteps: string = blockFrom(
    fs.readFileSync(setup.setupFile, "utf8"),
    "const steps: Array<GuidedSetupFrameStep> = [",
    "\n  ];",
  );

  return Array.from(frameSteps.matchAll(FRAME_STEP_TITLE)).map(
    (match: RegExpMatchArray): string => {
      return setupWord(copyOfObject(match[1] as string), match[2] as string);
    },
  );
}

/*
 * The test page dialog both setups open (Components/OnCallTestPage): its
 * button for the person themselves and for a policy, its send button, its
 * severity field and the button that closes it.
 */
const TEST_PAGE_DIALOG_WORDS: ReadonlyArray<string> = [
  "Send me a test page",
  "Test this policy",
  "Send test page",
  "Severity",
  "Done",
];

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
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'title: "Welcome to OneUptime 👋",',
    );
    /*
     * The checklist opens on a greeting (#8897): the card's title, with the
     * person's first name when the Dashboard knows it.
     */
    expect(CHECKLIST_SOURCE).toContain("<WelcomeGreeting");
    expect(GREETING_SOURCE).toContain(
      "translator.translateText(WELCOME_CHECKLIST_COPY.title)",
    );

    const items: Array<string> = Array.from(
      whatHomeShows.matchAll(NUMBERED_ITEM),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(items).toEqual([
      "A search box, with **Declare Incident** and **Create** beside it.",
      "One line that says whether anything is wrong, over five numbers that count what needs attention.",
      "**Welcome to OneUptime 👋**, a checklist for a new project, until it is done, then **More to set up** while anything is left.",
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

  /*
   * Home follows what it counts as it changes (#8963): its batch hears every
   * kind it counts (UseHomeOverview), and Upcoming maintenance its events.
   */
  it("says Home follows what it counts as it changes, as the overview and Upcoming maintenance hear it", () => {
    expect(sectionOf(HOME, "### The headline")).toContain(
      "Home also follows what it counts as it changes: when an incident, alert, monitor, maintenance event or SLO is created, changed or deleted, the line, the numbers, **Needs attention** and **Upcoming maintenance** catch up within seconds, without a refresh.",
    );

    const hook: string = oneLine(
      dashboard("Components/Home/UseHomeOverview.ts"),
    );
    const kinds: RegExpMatchArray | null = hook.match(
      /HOME_OVERVIEW_LIVE_MODEL_TYPES: ReadonlyArray<\{ new \(\): BaseModel; \}> = \[([^\]]+)\]/,
    );

    expect(
      (kinds?.[1] || "")
        .split(",")
        .map((kind: string): string => {
          return kind.trim();
        })
        .filter(Boolean),
    ).toEqual([
      "Incident",
      "Alert",
      "Monitor",
      "ScheduledMaintenance",
      "ServiceLevelObjective",
    ]);
    expect(hook).toContain(
      "useLiveRefresh({ modelTypes: HOME_OVERVIEW_LIVE_MODEL_TYPES,",
    );

    const upcoming: string = oneLine(UPCOMING_SOURCE);
    expect(upcoming).toContain(
      "UPCOMING_MAINTENANCE_LIVE_MODEL_TYPES: ReadonlyArray<{ new (): BaseModel; }> = [ScheduledMaintenance];",
    );
    expect(upcoming).toContain(
      "useLiveRefresh({ modelTypes: UPCOMING_MAINTENANCE_LIVE_MODEL_TYPES,",
    );

    // The words the sentence uses for what it follows are the batch's kinds.
    for (const kind of [
      "an incident",
      "alert",
      "monitor",
      "maintenance event",
      "SLO",
    ]) {
      expect(sectionOf(HOME, "### The headline")).toContain(kind);
    }
  });

  it("says where Create your first monitor leads, as the headline links it", () => {
    const card: string = oneLine(
      dashboard("Components/Home/ProjectHealthCard.tsx"),
    );
    const button: string = blockFrom(
      card,
      "health.kind === ProjectHealthKind.NotSetUp && props.canCreateMonitor ? ( <AppLink",
      "</AppLink>",
    );
    const page: string = (
      button.match(HEADLINE_BUTTON_PAGE) as RegExpMatchArray
    )[1] as string;

    expect(button).toContain(
      'translator.translateText("Create your first monitor")',
    );
    // The guided setup (#6804), the same page the checklist's step opens.
    expect(page).toBe("MONITOR_GUIDED_SETUP");
    /*
     * One start for one job (#7759): the headline leaves its button out
     * while the Welcome card offers the monitor step, on the checklist or
     * among what else to set up.
     */
    expect(oneLine(HOME_PAGE_SOURCE)).toContain(
      "return data.canCreateMonitor && !data.welcome.offersFirstMonitor;",
    );
    expect(oneLine(HOME_PAGE_SOURCE)).toContain(
      "canCreateMonitor={isCreateFirstMonitorShown({",
    );
    expect(oneLine(CHECKLIST_SOURCE)).toContain(
      "if (data.view === WelcomeCardView.Checklist) { return isMonitorLeft(data.answer.steps); }",
    );
    expect(sectionOf(HOME, "### The headline")).toContain(
      `While nothing is monitored yet, the line ends on **Create your first monitor**, which opens the guided setup **${routedGuidedSetup(page).title}**, unless the welcome checklist under it offers that step already. Only people who are allowed to create monitors see it.`,
    );
  });

  it("asks what the project came to do, with the goals the question offers", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const goals: Array<string> = Array.from(
      blockFrom(
        CHECKLIST_CATALOG_SOURCE,
        "export const WELCOME_GOALS",
        "\n];",
      ).matchAll(/title: translationKey\("([^"]+)"\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(goals).toHaveLength(7);
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'title: translationKey("What do you want to do first?"),',
    );
    expect(section).toContain(
      "the card greets them by their first name and asks **What do you want to do first?**",
    );
    expect(GREETING_SOURCE).toContain("getFirstName()");
    // The first goal and the last, as the question lists them.
    expect(goals[0]).toBe("Know when my website or API is down");
    expect(goals[goals.length - 1]).toBe("Just looking around");
    expect(section).toContain(`**${goals[0]}**`);
    expect(section).toContain(`**${goals[goals.length - 1]}**`);
    for (const button of ["Continue", "Change"]) {
      expect(CHECKLIST_CATALOG_SOURCE).toContain(`translationKey("${button}")`);
      expect(section).toContain(`**${button}**`);
    }
    /*
     * Skip is gone (#8897): "Just looking around" is the way out, under the
     * cards, and it hides the checklist for the person who chose it.
     */
    expect(CHECKLIST_CATALOG_SOURCE).not.toContain('translationKey("Skip")');
    expect(section).not.toContain("**Skip**");
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      "export const WELCOME_JUST_LOOKING_GOAL: ProjectGoal = ProjectGoal.Explore;",
    );
    expect(CHECKLIST_SOURCE).toMatch(
      /const justLookAround[\s\S]*WELCOME_CHECKLIST_GOALS_ROUTE[\s\S]*WELCOME_CHECKLIST_HIDE_ROUTE/,
    );
    expect(section).toContain(
      `**${goals[goals.length - 1]}** takes you straight to the rest of Home instead, and leaves a line to show the checklist again.`,
    );
    // While picking, how many steps and about how long.
    expect(QUESTION_SOURCE).toContain("WELCOME_QUESTION_COPY.stepsToSetUp");
    expect(QUESTION_SOURCE).toContain("getWelcomeStepsMinutes(planSteps)");
    expect(section).toContain(
      "While you pick, it says how many steps that is and about how long they take.",
    );
  });

  it("says the checklist is all of Home while it shows, with what cannot wait above it", () => {
    expect(whatHomeShows).toContain(
      "While a new project's **Welcome to OneUptime 👋** checklist shows, it is all of Home, so the first thing you meet is what to do first. An open incident, or anything else that needs someone, still shows above it. Hide the checklist, or finish it, and the rest of Home comes back.",
    );
    // The question and the steps are the quickstart; Home draws only it.
    expect(HOME_PAGE_SOURCE).toContain(
      "return welcome.isTakingHome ? HomeMode.Quickstart : HomeMode.Overview;",
    );
    /*
     * A new project's: the question, and the steps once someone answered
     * it, as the page says ("a new project's ... checklist").
     */
    expect(CHECKLIST_SOURCE).toContain(
      "data.view === WelcomeCardView.Question",
    );
    expect(CHECKLIST_SOURCE).toContain("data.answer.goals !== null");
    // An open incident or anything else that needs someone: the health card.
    expect(HOME_PAGE_SOURCE).toContain(
      "kind === ProjectHealthKind.Incidents ||",
    );
    expect(HOME_PAGE_SOURCE).toContain(
      "kind === ProjectHealthKind.NeedsAttention",
    );
  });

  it("says each step's minutes, the minutes left and the next step's Start, as the path draws them", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");

    expect(PLAN_STEP_SOURCE).toContain("WELCOME_STEP_MINUTES[state.step]");
    expect(CHECKLIST_SOURCE).toContain("getWelcomeMinutesLeft(answer.steps)");
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'startButton: translationKey("Start"),',
    );
    expect(section).toContain(
      "Each step says about how long it takes, the checklist says about how long is left, and the next step has a **Start** button of its own.",
    );
  });

  it("says a guided setup lists what it sets up beside its steps, and how long it takes", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");

    expect(GUIDED_SETUP_FRAME_SOURCE).toContain("<GuidedSetupResourcePanel");
    expect(GUIDED_SETUP_FRAME_SOURCE).toContain("minutes={props.minutes}");
    expect(GUIDED_SETUP_PANEL_SOURCE).toContain(
      'translationKey("What this sets up")',
    );
    expect(GUIDED_SETUP_PANEL_SOURCE).toContain("props.minutes");
    expect(section).toContain(
      "Beside its steps, a guided setup lists what it sets up, ticked off as you go, and says about how long it takes.",
    );
  });

  it("gives the checklist's steps, what finishes each and what each opens, as the catalog routes them", () => {
    /*
     * The project's own steps: the server's setup is its admins' own card,
     * not a step (#7018).
     */
    const tasks: Array<ChecklistTask> = checklistTasks();
    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The welcome checklist"),
    );

    expect(
      tasks.map((task: ChecklistTask): string => {
        return task.step;
      }),
    ).toEqual([
      "Import",
      "Monitor",
      "Infrastructure",
      "Telemetry",
      "OnCall",
      "StatusPage",
      "Team",
    ]);

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
      expect({
        task: task.title,
        opens: (rows[index] as Array<string>)[2],
      }).toEqual({ task: task.title, opens: opensCell(task) });
    });

    // Done on outcomes, as the rules in Common/Types/WelcomeChecklist say.
    expect((rows[1] as Array<string>)[1]).toBe("Its first check comes in.");
    /*
     * Who is told: a policy that can reach someone, run by an on-call rule
     * or paged directly by a monitor's criteria (#7017).
     */
    const service: string = oneLine(
      readSource(COMMON_DIR, "Server/Services/WelcomeChecklistService.ts"),
    );
    expect(service).toContain(
      "this.readPoliciesRunByRules(projectId), this.readPoliciesPagedByMonitors(projectId),",
    );
    expect(service).toContain(
      "reference.model === MonitorStepsReferenceModel.OnCallDutyPolicy && reference.isOperative &&",
    );
    expect((rows[4] as Array<string>)[1]).toBe(
      "A test page is acknowledged, a page reaches someone, or an on-call rule or a monitor runs a policy that can reach someone.",
    );
    expect((rows[5] as Array<string>)[1]).toBe(
      "A status page shows a monitor.",
    );
    expect((rows[6] as Array<string>)[1]).toBe(
      "Someone accepts your invitation.",
    );
  });

  it("reads every routing declaration the checklist's steps make", () => {
    const tasks: Array<ChecklistTask> = checklistTasks();
    const count: (keep: (task: ChecklistTask) => boolean) => number = (
      keep: (task: ChecklistTask) => boolean,
    ): number => {
      return tasks.filter(keep).length;
    };
    const spreads: number = blockFrom(
      CHECKLIST_CATALOG_SOURCE,
      "export const WELCOME_STEPS",
      "\n];",
    )
      .split("\n")
      .filter((line: string): boolean => {
        return line.trim().startsWith("...");
      }).length;

    /*
     * The table is held to what checklistTasks reads, so a declaration it
     * cannot read - written over two lines, in another order, or spread in
     * from elsewhere - fails here instead of leaving a step's row checked
     * against the wrong page.
     */
    expect({
      step: declaredFieldLines("step"),
      createPage: declaredFieldLines("createPage"),
      modelType: declaredFieldLines("modelType"),
      guidedSetupPage: declaredFieldLines("guidedSetupPage"),
      guidedSetupModelType: declaredFieldLines("guidedSetupModelType"),
      landing: declaredFieldLines("landing"),
      spreads: spreads,
    }).toEqual({
      step: tasks.length,
      createPage: count((task: ChecklistTask): boolean => {
        return task.createPageMap !== null;
      }),
      modelType: count((task: ChecklistTask): boolean => {
        return task.createModel !== null;
      }),
      guidedSetupPage: count((task: ChecklistTask): boolean => {
        return task.guidedSetupPage !== null;
      }),
      guidedSetupModelType: count((task: ChecklistTask): boolean => {
        return task.setupModel !== null;
      }),
      landing: count((task: ChecklistTask): boolean => {
        return task.hasLanding;
      }),
      spreads: 0,
    });
  });

  it("says which steps open a guided setup, for whom, and names each one as its page does", () => {
    const tasks: Array<ChecklistTask> = checklistTasks();
    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The welcome checklist"),
    );
    const guided: Array<ChecklistTask> = tasks.filter(
      (task: ChecklistTask): boolean => {
        return task.guidedSetupPage !== null;
      },
    );

    // The four guided setups (#6804, #6805, #6806), in the checklist's order.
    expect(
      guided.map((task: ChecklistTask): [string, string, string | null] => {
        return [task.step, task.guidedSetupPage as string, task.gateModel];
      }),
    ).toEqual([
      ["Monitor", "MONITOR_GUIDED_SETUP", "Monitor"],
      ["Telemetry", "SERVICES_GUIDED_SETUP", null],
      ["OnCall", "ON_CALL_DUTY_GUIDED_SETUP", null],
      ["StatusPage", "STATUS_PAGES_GUIDED_SETUP", "StatusPage"],
    ]);

    // Each by the title its page draws, which is what the setup is called.
    expect(
      guided.map((task: ChecklistTask): string => {
        return routedGuidedSetup(task.guidedSetupPage as string).title;
      }),
    ).toEqual([
      "Know when my website or API is down",
      "Send logs, metrics and traces, then get alerted",
      "Page the right person when something breaks",
      "Publish a status page",
    ]);

    // A step that names a model opens its setup only for who may create one.
    expect(
      guided.map((task: ChecklistTask): string | null => {
        return stepDestinations(task).mayNotCreate;
      }),
    ).toEqual(["MONITORS", null, null, "STATUS_PAGES"]);

    // The steps with no guided setup say none.
    for (const task of tasks) {
      if (task.guidedSetupPage) {
        continue;
      }

      const row: Array<string> | undefined = rows.find(
        (candidate: Array<string>): boolean => {
          return boldSpans(candidate[0] as string)[0] === task.title;
        },
      );

      expect({ task: task.title, row: Boolean(row) }).toEqual({
        task: task.title,
        row: true,
      });
      expect((row as Array<string>)[2]).not.toContain("guided setup");
    }
  });

  it("routes each step by the rule the table states", () => {
    const rule: string = oneLine(
      blockFrom(
        CHECKLIST_CATALOG_SOURCE,
        "export const getWelcomeStepPage",
        "\n};",
      ),
    );
    const lines: Array<string> = [
      // Who may: the create page's model, else the setup's own.
      "entry.createPage?.modelType || entry.guidedSetupModelType;",
      // A step that names no model sends everyone to its setup.
      "const maySetUp: boolean = setupModelType ? entry.createPage ? mayCreate : PermissionGate.check(new setupModelType(), ModelAction.Create).isAllowed : true;",
      "if (entry.guidedSetupPage && maySetUp) { return entry.guidedSetupPage; }",
      "if (entry.createPage && mayCreate) { return entry.createPage.pageMap; }",
      "return entry.pageMap || null;",
    ];
    const at: Array<number> = lines.map((line: string): number => {
      return rule.indexOf(line);
    });

    lines.forEach((line: string, index: number): void => {
      expect({ line: line, found: (at[index] as number) >= 0 }).toEqual({
        line: line,
        found: true,
      });
    });

    // In that order: the setup first, then the form, then today's page.
    expect(
      [...at].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(at);
  });

  it("says a guided setup ends with what to do next, and how to find one again", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const guided: Array<RoutedGuidedSetup> = checklistTasks()
      .filter((task: ChecklistTask): boolean => {
        return task.guidedSetupPage !== null;
      })
      .map((task: ChecklistTask): RoutedGuidedSetup => {
        return routedGuidedSetup(task.guidedSetupPage as string);
      });
    const search: string = dashboard(
      "Components/CommandPalette/PageSearchIndex.ts",
    );

    expect(guided).toHaveLength(4);

    for (const setup of guided) {
      const source: string = fs.readFileSync(setup.setupFile, "utf8");

      // Drawn in the guided setup frame, ending on what to do next.
      expect({
        setup: setup.title,
        framed: source.includes("<GuidedSetupFrame"),
        next: GUIDED_SETUP_SUMMARY_NEXT.test(source),
      }).toEqual({ setup: setup.title, framed: true, next: true });
      // Search finds it by the same name.
      expect({
        setup: setup.title,
        searched: search.includes(`title: "${setup.title}",`),
      }).toEqual({ setup: setup.title, searched: true });
    }

    expect(section).toContain(
      "A guided setup does the whole job on one page, a step at a time, and ends with what it set up and what to do next. To open one again later, search for its name.",
    );
  });

  it("names the next step, the plan's limit and the server's own card as Home draws them", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const serverCard: string = dashboard(
      "Components/ServerSetup/ServerSetupCard.tsx",
    );
    const home: string = oneLine(HOME_PAGE_SOURCE);

    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'nextBadge: translationKey("Next step"),',
    );
    expect(section).toContain("is marked **Next step**");
    expect(section).toContain(
      "**Invite your team** says it needs the Growth plan, and opens **Billing**",
    );
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      "WELCOME_PLAN_PAGE: PageMap = PageMap.SETTINGS_BILLING;",
    );
    /*
     * A server that is not set up yet is its admins' own card, drawn above
     * the checklist, never a step of it as well (#7018).
     */
    expect(CHECKLIST_CATALOG_SOURCE).not.toContain("WelcomeStep.ServerEmail");
    expect(home.indexOf("<ServerSetupCard />")).toBeGreaterThan(-1);
    expect(home.indexOf("<ServerSetupCard />")).toBeLessThan(
      home.indexOf("<GettingStarted"),
    );
    expect(serverCard).toContain(
      'finishSetup: translationKey("Finish setup"),',
    );
    expect(serverCard).toContain("to={getAdminServerSetupUrl()}");
    expect(section).toContain(
      "On a self-hosted server that is not set up yet, its admins see the server's own card above the checklist instead, with **Finish setup**, which opens the Admin Dashboard.",
    );
    expect(section).not.toContain("This server cannot send email yet");
  });

  /*
   * A step whose record exists but does not work yet (#6938) says why, in
   * the sentence Setup Health draws for it, and opens the page that fixes
   * it; next, its button names the fix.
   */
  it("says why a step whose record exists is not done, in Setup Health's words, and names its fix", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const gap: string = dashboard(
      "Components/Home/WelcomeChecklist/WelcomeStepGap.tsx",
    );
    const words: string = dashboard(
      "Components/SetupHealth/SetupHealthWords.ts",
    );

    // The breaks the page names, as the rules map them to steps.
    expect(WELCOME_STEP_GAP_CHECKS[WelcomeStep.StatusPage]).toEqual([
      SetupHealthCheck.StatusPageShowsNoMonitor,
    ]);
    expect(WELCOME_STEP_GAP_CHECKS[WelcomeStep.Monitor]).toEqual([
      SetupHealthCheck.MonitorNotChecked,
    ]);
    expect(WELCOME_STEP_GAP_CHECKS[WelcomeStep.OnCall]).toEqual(
      expect.arrayContaining([
        SetupHealthCheck.PolicyNotRun,
        SetupHealthCheck.PolicyReachesNobody,
      ]),
    );
    // An invitation nobody accepted is the team's, read by the server.
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      '"An invitation to this project hasn\'t been accepted yet.",',
    );
    // In Setup Health's own sentence, opening its fix, named on the button.
    expect(dashboard("Pages/Home/SetupHealth.tsx")).toContain(
      'title="Setup Health"',
    );
    expect(gap).toContain("<FindingSentence finding={props.gap.finding} />");
    expect(gap).toContain("return getSetupHealthFixLink({");
    expect(oneLine(CHECKLIST_SOURCE)).toContain(
      "startTitle={ getWelcomeStepGapFix({ gap: state.gap, translator: translator, })?.text }",
    );
    expect(words).toContain(
      '[SetupHealthFix.StatusPageResources]: translationKey("Add Monitors"),',
    );
    expect(section).toContain(
      "A step whose record exists but does not work yet says why under it, in the words of **Setup Health**: a status page that shows no monitor, a monitor nothing checks, an on-call policy that nothing runs or that reaches nobody, an invitation nobody accepted. The step then opens the page that fixes it, and when it is next, its button names the fix, such as **Add Monitors**.",
    );
  });

  /*
   * Paged by more than email (#9442): once who is told is ticked, the way
   * to SMS, calls and the app stays under it while only email pages you.
   */
  it("keeps the way to SMS, calls and the app under the ticked on-call step while only email can page you", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const card: string = oneLine(CHECKLIST_SOURCE);
    const catalog: string = oneLine(CHECKLIST_CATALOG_SOURCE);
    const service: string = oneLine(
      readSource(COMMON_DIR, "Server/Services/WelcomeChecklistService.ts"),
    );
    const task: ChecklistTask = checklistTaskOf("OnCall");
    const setup: RoutedGuidedSetup = routedGuidedSetup(
      "ON_CALL_DUTY_GUIDED_SETUP",
    );
    const phoneWords: string = setupWord(
      QUICKSTART_SETUP_COPIES.website,
      "nextPhone",
    );

    // In the website setup's own words, to the on-call guided setup.
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      `phoneTitle: translationKey("${phoneWords}"),`,
    );
    expect(catalog).toContain(
      "RouteMap[PageMap.ON_CALL_DUTY_GUIDED_SETUP] as Route, ).toString(), GuidedSetupEntryPoint.Home,",
    );
    // Under the ticked step, for who may create a policy.
    expect(card).toContain(
      "doneFooter={ state.step === WelcomeStep.OnCall && offersPhone ? pagedByPhoneLink : undefined }",
    );
    expect(card).toContain(
      "data.answer.canBePagedByPhoneOrApp === false && data.mayUseOnCallSetup,",
    );
    expect(catalog).toContain(
      "return PermissionGate.check(new OnCallDutyPolicy(), ModelAction.Create) .isAllowed;",
    );
    // Read once the step is done: a verified phone or push device pages you.
    expect(service).toContain(
      "data.isOnCallDone ? this.canBePagedByPhoneOrApp(data.caller) : Promise.resolve(null),",
    );
    expect(PHONE_OR_APP_METHOD_TYPES).toEqual([
      "SMS",
      "Call",
      "WhatsApp",
      "Push",
    ]);
    expect(
      canPageByPhoneOrApp([{ methodType: "Email", isVerified: true }]),
    ).toBe(false);
    expect(
      canPageByPhoneOrApp([{ methodType: "SMS", isVerified: false }]),
    ).toBe(false);
    expect(
      canPageByPhoneOrApp([{ methodType: "Push", isVerified: true }]),
    ).toBe(true);

    expect(section).toContain(
      `Once **${task.title}** is ticked, and while only email can page you, **${phoneWords}** stays under it: it opens the guided setup **${setup.title}**, to add your phone or the mobile app. Only people who may create on-call policies see it.`,
    );
  });

  /*
   * What else to set up (#7986): once the checklist is done, the core steps
   * no goal brought, as a card among Home's others, hidden for one person.
   */
  it("offers what else to set up once the checklist is done, as a card among Home's others", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");
    const card: string = oneLine(CHECKLIST_SOURCE);
    const more: string = oneLine(
      dashboard("Components/Home/WelcomeChecklist/WelcomeMoreSteps.tsx"),
    );
    const phoneWords: string = setupWord(
      QUICKSTART_SETUP_COPIES.website,
      "nextPhone",
    );

    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'title: translationKey("More to set up"),',
    );
    // The core steps a website's goal did not bring: a status page, the team.
    expect(DEFAULT_WELCOME_STEPS).toEqual([
      WelcomeStep.Monitor,
      WelcomeStep.OnCall,
      WelcomeStep.StatusPage,
      WelcomeStep.Team,
    ]);
    expect(getWelcomeMoreSteps({ goals: [ProjectGoal.Uptime] })).toEqual([
      WelcomeStep.StatusPage,
      WelcomeStep.Team,
    ]);
    // A project that never chose goals had the four already.
    expect(getWelcomeMoreSteps({ goals: null })).toEqual([]);
    // Shown once finished, while a step or the phone is left, unless hidden.
    expect(card).toContain(
      "if (answer.isFinished) { return !answer.isHiddenForMe && (getMoreSteps(answer).length > 0 || Boolean(data.offersPhone)) ? WelcomeCardView.More : WelcomeCardView.None; }",
    );
    // A card among the others: only the question and the checklist take Home.
    expect(card).toContain(
      "return ( data.view === WelcomeCardView.Checklist && data.answer !== null && data.answer.goals !== null );",
    );
    // The phone first, then the steps; its Hide is the checklist's.
    expect(more.indexOf("{props.offersPhone ? (")).toBeGreaterThan(-1);
    expect(more.indexOf("{props.offersPhone ? (")).toBeLessThan(
      more.indexOf("{props.moreSteps.map("),
    );
    expect(more).toContain("title={WELCOME_CHECKLIST_COPY.hideButton}");
    expect(card).toContain(
      "onHide={() => { change(WELCOME_CHECKLIST_HIDE_ROUTE, {})",
    );

    expect(section).toContain(
      `Once the checklist is done, **More to set up** takes its place under the headline, as a card among the others: the core steps your goals did not bring, such as a status page and your team, each until it works, with **${phoneWords}** first while only email can page you. Its **Hide** takes it away for you, with no line left behind.`,
    );
  });

  it("promises no way back to the checklist that no step draws", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");

    /*
     * The next-step line, with Back to setup, shows only where a step with
     * a landing put its record (WelcomeNextStep). Every step that made a
     * record opens a guided setup now, which says what is next itself
     * (#7109), so no step has one, and the page does not promise the line.
     */
    expect(
      checklistTasks()
        .filter((task: ChecklistTask): boolean => {
          return task.hasLanding;
        })
        .map((task: ChecklistTask): string => {
          return task.step;
        }),
    ).toEqual([]);
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'backToSetup: translationKey("Back to setup"),',
    );
    expect(section).not.toContain("Back to setup");
    expect(section).not.toContain("the page you land on says what is next");
  });

  it("hides the checklist for this person, on every device, and keeps How OneUptime works a click away", () => {
    const section: string = sectionOf(HOME, "### The welcome checklist");

    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'hideButton: translationKey("Hide"),',
    );
    expect(CHECKLIST_CATALOG_SOURCE).toContain(
      'showButton: translationKey("Show it"),',
    );
    expect(CHECKLIST_SOURCE).toContain("WELCOME_CHECKLIST_HIDE_ROUTE");
    expect(section).toContain(
      "click **Hide**: it is hidden for you alone, on every device, and a line stays with **Show it** and **How OneUptime works**.",
    );
    expect(section).not.toContain("this browser");
  });

  /*
   * The checklist drew a strip of four products of its own, beside the
   * dialog's four steps; now one line under its steps opens the dialog,
   * saying what it holds in the dialog's own words (#8995).
   */
  it("says a line under the steps opens How OneUptime works, in the words the line says", () => {
    const source: string = dashboard("Components/Home/HowOneUptimeWorks.tsx");
    const description: string = (
      dashboard("Components/Home/HowOneUptimeWorksDialog.tsx").match(
        TRANSLATION_KEY_CONSTANT("HOW_ONEUPTIME_WORKS_DESCRIPTION"),
      ) as RegExpMatchArray
    )[1] as string;

    expect(source).toContain(
      'export const HOW_IT_WORKS_TITLE: string = "How OneUptime works";',
    );
    expect(CHECKLIST_SOURCE).toContain(
      "openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.WelcomeChecklist);",
    );
    expect(CHECKLIST_SOURCE).toContain(
      "translator.translateText(HOW_ONEUPTIME_WORKS_DESCRIPTION)",
    );
    expect(CHECKLIST_SOURCE).not.toContain("<HowOneUptimeWorks");
    expect(description).toBe(
      "Everything OneUptime does, and how it fits together.",
    );
    expect(whatHomeShows).toContain(
      `Under the steps, a line opens **How OneUptime works**: ${description
        .charAt(0)
        .toLowerCase()}${description.slice(1)}`,
    );
    // The products are the dialog's to name, in its four steps.
    expect(whatHomeShows).not.toContain("four core products");
  });

  /*
   * The dialog Help, Home and Search open (#8891): its first section and its
   * four steps, in the order the overview draws them, and its categories.
   */
  it("says what How OneUptime works opens on: its first section and its four steps, in their order", () => {
    const source: string = dashboard(
      "Components/Home/HowOneUptimeWorksOverview.tsx",
    );
    const steps: Array<string> = Array.from(
      blockFrom(source, "export const HOW_IT_WORKS_LOOP:", "\n];").matchAll(
        /^ {4}title: translationKey\("([^"]+)"\),$/gm,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const section: string = sectionOf(HOME, "### The welcome checklist");

    expect(steps).toHaveLength(4);
    expect(source).toContain(
      'export const HOW_IT_WORKS_LOOP_TAB: string = translationKey(\n  "How it fits together",\n);',
    );
    expect(section).toContain(
      `**How OneUptime works** opens on **How it fits together**: the four steps a problem moves through, ${steps
        .slice(0, -1)
        .map((step: string): string => {
          return `**${step}**`;
        })
        .join(
          ", ",
        )} and **${steps[steps.length - 1]}**, each with the products that do it.`,
    );
    // Then the products menu's categories, walked with the arrow keys or Next.
    expect(source).toContain('translationKey("Next: {{section}}")');
    expect(section).toContain(
      "Then come the categories of the **Products** menu, each listing its products and what each is for: pick one, or move on with the arrow keys or **Next**.",
    );
    expect(section).toContain("Products your project hides are left out.");
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

  it("counts what the numbers count: archived monitors and monitors with monitoring off left out, turned-on SLOs at risk or out of budget", () => {
    const counting: string = oneLine(OVERVIEW_DATA_SOURCE);

    // The Not Operational list's own query (#6400).
    expect(counting).toContain(
      "projectId: projectId, ...NotOperationalMonitorQuery.getQuery(projectId),",
    );
    expect(NotOperationalMonitorQuery.getQuery()).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
    expect(counting).toContain("isEnabled: true, isArchived: false");
    expect(counting).toContain(
      "sloStatus: new Includes([...SLO_STATUSES_AT_RISK]),",
    );
    expect(SLO_STATUSES_AT_RISK).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);

    const rows: Array<Array<string>> = onlyTableOf(
      sectionOf(HOME, "### The five numbers"),
    );

    expect((rows[2] as Array<string>)[1]).toBe(
      "Monitors whose status is not an operational one. Archived monitors, and monitors with monitoring turned off, are left out.",
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

  /*
   * Setup health (#6812): the Setup section that ends Needs attention, and
   * the page it opens, named as Home, the page, its levels, the monitor's
   * card and Search draw them.
   */
  it("names Setup health's line, page, levels and Dismissed as the product draws them", () => {
    const section: string = sectionOf(HOME, "### Setup health");
    const homeWords: string = dashboard(
      "Components/SetupHealth/SetupHealthHomeWords.ts",
    );
    const pageWords: string = dashboard(
      "Components/SetupHealth/SetupHealthWords.ts",
    );
    const attention: string = oneLine(ATTENTION_SOURCE);
    const levelTitles: Array<string> = Array.from(
      blockFrom(pageWords, "export const LEVEL_WORDS", "\n};").matchAll(
        /title: translationKey\("([^"]+)"\)/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    // The Setup section is the last one Needs attention draws, after the kinds.
    expect(homeWords).toContain('group: translationKey("Setup"),');
    expect(
      attention.indexOf(
        "{setupCount > 0 ? renderSetupSection(setupCount) : <></>}",
      ),
    ).toBeGreaterThan(attention.indexOf("{group.rows.map("));
    expect(attention.indexOf("{group.rows.map(")).toBeGreaterThan(-1);
    expect(section).toContain("**Needs attention** ends with **Setup**");

    // The page, by the title it shows and the name Search finds it by.
    const setupHealthPage: string = oneLine(
      dashboard("Pages/Home/SetupHealth.tsx"),
    );

    expect(setupHealthPage).toContain('<Page title="Setup Health"');
    expect(setupHealthPage).toContain(
      "description={SETUP_HEALTH_WORDS_PAGE.description}",
    );
    expect(
      oneLine(dashboard("Components/CommandPalette/PageSearchIndex.ts")),
    ).toContain('page: PageMap.HOME_SETUP_HEALTH, title: "Setup Health"');
    expect(section).toContain("It opens **Setup Health**");
    expect(section).toContain("Search finds the page as **Setup Health**");

    // Its levels, worst first, as the page's cards title them.
    expect(levelTitles).toEqual([
      "Pages Will Not Arrive",
      "Worth Fixing",
      "Suggestions",
    ]);
    expect(section).toContain(
      `worst first, under **${levelTitles[0]}**, **${levelTitles[1]}** and **${levelTitles[2]}**`,
    );

    // The verdict it opens with, and what a finding reaches, as the page words them.
    expect(pageWords).toContain(
      'nothingToFix: translationKey("Nothing to fix."),',
    );
    expect(section).toContain("or **Nothing to fix**");
    expect(pageWords).toContain(
      'export const SETUP_HEALTH_AFFECTS: string = translationKey("Affects");',
    );
    expect(section).toContain("the monitors or policies it **Affects**");

    // The two one-click fixes (#7299), by the buttons that open their dialogs.
    const quickFixWords: string = dashboard(
      "Components/SetupHealth/SetupHealthQuickFix.ts",
    );

    expect(quickFixWords).toContain('button: translationKey("Turn On SMS"),');
    expect(quickFixWords).toContain(
      'button: translationKey("Create On-Call Rule"),',
    );
    expect(section).toContain(
      "**Turn On SMS** (or phone calls, WhatsApp or Telegram)",
    );
    expect(section).toContain("**Create On-Call Rule**");
    expect(section).toContain(
      "once a dialog has said exactly what will change",
    );

    // A policy's and a status page's own Overview say their findings (#7297).
    for (const page of [
      "Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx",
      "Pages/StatusPages/View/Index.tsx",
    ]) {
      expect(dashboard(page)).toContain("<SetupHealthRecordFindings");
    }

    expect(section).toContain(
      "says so at the top of the policy's or the status page's own page too",
    );

    // A monitor's findings are its own card's breaks; dismissed ones fold away.
    expect(
      dashboard("Components/Monitor/Overview/MonitorWhoIsToldCard.tsx"),
    ).toContain('title="When this goes down"');
    expect(section).toContain("**When this goes down** card");
    expect(pageWords).toContain('dismissed: translationKey("Dismissed"),');
    expect(section).toContain("restored from **Dismissed**");

    /*
     * An owner the card says no Created email reaches is a finding too
     * (#9371), with the card's own fix pages.
     */
    expect(
      oneLine(
        fs.readFileSync(
          path.join(
            __dirname,
            "../../../../Common/Types/SetupHealth/SetupHealth.ts",
          ),
          "utf8",
        ),
      ),
    ).toContain('OwnerNotEmailed = "owner_not_emailed"');
    expect(pageWords).toContain(
      "[SetupHealthFix.TeamMembers]: OWNER_FIX_WORDS.team,",
    );
    expect(section).toContain(
      "Each owner the card says no Created email reaches is a finding too, worth fixing, with the same page to put it right.",
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
    /*
     * The products the project hides are not left out of everything
     * (#7468): they are its last tab, named as the products menu names
     * them, with the menu's note that they still work.
     */
    expect(dashboard("Components/NavBar/NavBar.tsx")).toContain(
      'export const HIDDEN_PRODUCTS_TITLE: string = translationKey("More products");',
    );
    expect(oneLine(EXPLORE_SOURCE)).toContain(
      "? [...listedCategories, { title: hiddenTitle, items: hiddenItems }]",
    );
    expect(EXPLORE_SOURCE).toContain("<HiddenProductsMenuNote");
    expect(
      dashboard("Components/ProjectProducts/ProjectProductsCopy.ts"),
    ).toContain(
      '"Hidden in this project. Search still finds them, and their pages work.",',
    );
    expect(sectionOf(HOME, "### Explore OneUptime")).toContain(
      "The products your project hides are under its last tab, **More products**, with a note that they still work.",
    );
  });

  /*
   * Home is one page with no side menu and no lists of its own (#6857): each
   * number, and each View all, opens the list in the product it belongs to.
   */
  it("says Home is one page with no side menu, as its layout draws it", () => {
    const layout: string = dashboard("Pages/Home/Layout.tsx");

    expect(layout).not.toContain("sideMenu");
    expect(layout).not.toContain("SideMenu");
    expect(
      fs.existsSync(path.join(DASHBOARD_DIR, "Pages/Home/SideMenu.tsx")),
    ).toBe(false);
    expect(whatHomeShows).toContain(
      "Home is the overview of your project, one page with no side menu.",
    );
    expect(HOME).not.toContain("side menu:");
    expect(HOME).not.toContain("### Home's side menu");
  });

  it("names the list each number opens the way the Products menu and that product's own menu name it", () => {
    const tiles: Array<HomeTile> = homeTiles();
    const tileSection: string = sectionOf(HOME, "### The five numbers");
    const rows: Array<Array<string>> = onlyTableOf(tileSection);
    const products: Record<string, string> = (
      JSON.parse(dashboard("Locales/en.json")) as {
        navbar: { items: Record<string, string> };
      }
    ).navbar.items;
    // Each list a number opens: its product in the Products menu, and that product's own menu.
    const owners: Record<string, { product: string; menu: string }> = {
      UNRESOLVED_INCIDENTS: {
        product: "incidentsTitle",
        menu: "Pages/Incidents/SideMenu.tsx",
      },
      UNRESOLVED_ALERTS: {
        product: "alertsTitle",
        menu: "Pages/Alerts/SideMenu.tsx",
      },
      MONITORS_INOPERATIONAL: {
        product: "monitorsTitle",
        menu: "Pages/Monitor/SideMenu.tsx",
      },
      ONGOING_SCHEDULED_MAINTENANCE_EVENTS: {
        product: "scheduledMaintenanceTitle",
        menu: "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
      },
      SLOS: { product: "slosTitle", menu: "Pages/Slo/SideMenu.tsx" },
    };

    expect(tileSection).toContain(
      "| Number | What it counts | When the count is zero | Opens |",
    );
    expect(tileSection).toContain(
      "Each number counts something, says whether that needs you, and opens the list behind it, in the product it belongs to.",
    );
    // Every number opens a product's own list, never a page of Home's.
    expect(
      tiles.map((tile: HomeTile): string => {
        return tile.pageMap;
      }),
    ).toEqual(Object.keys(owners));

    const opens: Array<string> = tiles.map((tile: HomeTile): string => {
      const owner: { product: string; menu: string } | undefined =
        owners[tile.pageMap];

      expect({ tile: tile.key, owned: Boolean(owner) }).toEqual({
        tile: tile.key,
        owned: true,
      });

      const product: string = products[owner!.product] as string;
      const item: string | undefined = oneLine(dashboard(owner!.menu)).match(
        new RegExp(
          `title: "([^"]+)", to: RouteUtil\\.populateRouteParams\\( ?RouteMap\\[ ?PageMap\\.${tile.pageMap} ?\\] as Route`,
        ),
      )?.[1];

      expect({
        tile: tile.key,
        product: typeof product,
        item: typeof item,
      }).toEqual({
        tile: tile.key,
        product: "string",
        item: "string",
      });

      // A product's front list goes by the product's name alone.
      return item === product ? `**${product}**` : `**${product} → ${item}**`;
    });

    expect(
      rows.map((row: Array<string>): string => {
        return row[3] as string;
      }),
    ).toEqual(opens);
    expect(opens).toEqual([
      "**Incidents → Active Incidents**",
      "**Alerts → Active Alerts**",
      "**Monitors → Not Operational**",
      "**Scheduled Maintenance → Ongoing Maintenance Events**",
      "**SLOs**",
    ]);
  });

  it("opens the same list from each View all in Needs attention as from its number", () => {
    const tiles: Array<HomeTile> = homeTiles();
    const groups: Array<{ title: string; viewAll: string }> = blockFrom(
      ATTENTION_SOURCE,
      "const groups: Array<AttentionGroup>",
      "];",
    )
      .split("key: AttentionGroupKey.")
      .slice(1)
      .map((chunk: string): { title: string; viewAll: string } => {
        return {
          title: (chunk.match(ATTENTION_GROUP_TITLE) as RegExpMatchArray)[1]!,
          viewAll: (
            chunk.match(ATTENTION_GROUP_VIEW_ALL) as RegExpMatchArray
          )[1]!,
        };
      });

    expect(groups.length).toBe(5);

    for (const group of groups) {
      const tile: HomeTile | undefined = tiles.find(
        (candidate: HomeTile): boolean => {
          return candidate.label === group.title;
        },
      );

      expect({ kind: group.title, viewAll: group.viewAll }).toEqual({
        kind: group.title,
        viewAll: tile?.pageMap,
      });
    }

    expect(sectionOf(HOME, "### Needs attention")).toContain(
      "Each kind shows up to five, with **View all** for the rest, which opens the same list as its number.",
    );
  });

  /*
   * The SLOs list holds every SLO, so while any is at risk the number, and
   * the View all of the SLOs it lists, open that list with its chips set to
   * the SLOs at risk. At zero, or with no SLOs yet, the whole list opens.
   */
  it("opens the SLOs list showing only the SLOs at risk while any is, from the number and from View all", () => {
    expect(
      homeTiles()
        .filter((tile: HomeTile): boolean => {
          return tile.attentionLinkQuery !== null;
        })
        .map((tile: HomeTile): [string, string | null] => {
          return [tile.key, tile.attentionLinkQuery];
        }),
    ).toEqual([["slos-needing-attention", "getSlosAtRiskQueryParams"]]);
    // Only a count above zero opens the list with those filters.
    expect(
      oneLine(blockFrom(TILES_SOURCE, "if (count > 0) {", "\n      }")),
    ).toContain("linkQuery: definition.attentionLinkQuery?.(),");
    expect(
      blockFrom(ATTENTION_SOURCE, "key: AttentionGroupKey.Slos,", "\n    },"),
    ).toContain("viewAllQuery: getSlosAtRiskQueryParams(),");
    expect(sectionOf(HOME, "### The five numbers")).toContain(
      "While any SLO is at risk, **SLOs at risk** opens the **SLOs** list filtered to those SLOs.",
    );
  });

  it("names the Help menu's items, and what a tablet and a phone leave out of the header", () => {
    const help: string = dashboard("Components/Header/Help.tsx");

    // The ways to learn first, in the order the docs name them.
    const learn: Array<number> = [
      't("help.quickstart", "Quickstart")',
      't("help.howOneUptimeWorks", "How OneUptime works")',
      't("help.glossary", "Glossary")',
      't("help.documentation", "Documentation")',
      't("keyboardShortcuts.title", "Keyboard shortcuts")',
    ].map((call: string): number => {
      return help.indexOf(call);
    });

    expect(
      learn.every((index: number): boolean => {
        return index >= 0;
      }),
    ).toBe(true);
    expect(
      [...learn].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(learn);
    expect(help).toContain('t("help.documentation", "Documentation")');
    expect(help).toContain(
      't("keyboardShortcuts.title", "Keyboard shortcuts")',
    );
    expect(help).toContain('t("help.supportEmail")');
    expect(help).toContain('t("help.chatSlack")');

    const headerSource: string = dashboard("Components/Header/Header.tsx");
    const header: string = blockFrom(
      headerSource,
      "rightComponents={",
      "\n      />",
    );

    /*
     * The rail's entries by the wrapper they are drawn in (#7037): from a
     * tablet's width up (md) or from a laptop's (lg); the bell and the
     * picture in none.
     */
    const drawnFrom: (wrapper: string) => string = (
      wrapper: string,
    ): string => {
      return header
        .split(`className={${wrapper}}`)
        .slice(1)
        .map((chunk: string): string => {
          return chunk.slice(0, chunk.indexOf("</div>"));
        })
        .join(" ");
    };
    const fromTablet: string = drawnFrom("FROM_TABLET_WIDTH_CLASS_NAME");
    const fromLaptop: string = drawnFrom("FROM_LAPTOP_WIDTH_CLASS_NAME");

    expect(headerSource).toContain(
      'FROM_TABLET_WIDTH_CLASS_NAME: string =\n  "max-md:hidden items-center md:flex"',
    );
    expect(headerSource).toContain(
      'FROM_LAPTOP_WIDTH_CLASS_NAME: string =\n  "max-lg:hidden items-center lg:flex"',
    );
    expect(fromTablet).toContain("<Search />");
    expect(fromTablet).toContain("<Help />");
    expect(fromTablet).not.toContain("<AskAI />");
    expect(fromLaptop).toContain("<AskAI />");
    expect(fromLaptop).not.toContain("<Search />");
    expect(fromLaptop).not.toContain("<Help />");

    for (const always of ["<NotificationBell", "<UserProfile"]) {
      expect(header).toContain(always);
      expect(`${fromTablet} ${fromLaptop}`).not.toContain(always);
    }

    // Below md, the menu button's list starts with Search and ends with Help.
    const navBar: string = oneLine(dashboard("Components/NavBar/NavBar.tsx"));

    expect(navBar).toContain(
      "return <PhoneMenuSearch closeMenu={closeMenu} />;",
    );
    expect(navBar).toContain("return <PhoneMenuHelp closeMenu={closeMenu} />;");
    expect(readSource(COMMON_DIR, "UI/Components/Navbar/NavBar.tsx")).toContain(
      "export const PHONE_MENU_BELOW_WIDTH_IN_PX: number = 768;",
    );

    // Ask AI, left out below lg, is one of Search's actions.
    expect(
      dashboard("Components/CommandPalette/DashboardCommandPalette.tsx"),
    ).toContain('title: t("commandPalette.actions.askAi", "Ask AI"),');

    expect(HOME).toContain(
      "**Help** starts with what helps you learn: the **Quickstart**, **How OneUptime works**, the **Glossary** and these docs (**Documentation**). Under them are the **Keyboard shortcuts** list and support by email and on Slack. On a tablet or in a narrow window, **Ask AI** is left out to save room: it is among the actions in **Search**. On a phone, **Search** and **Help** move into the menu button's list, at its top and at its bottom; the bell and your picture stay.",
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

    expect(keys).toEqual(["label", "profile", "adminSettings", "signOut"]);

    /*
     * The theme is one row between Admin Settings and Sign Out, which draws
     * its own words (Common's ThemeChoiceRow): "Theme", and Light, Dark and
     * System, in that order.
     */
    const menu: string = oneLine(source);
    const themeRow: number = menu.indexOf("<ThemeChoiceRow />");

    expect(themeRow).toBeGreaterThan(
      menu.indexOf('t("userProfile.adminSettings")'),
    );
    expect(themeRow).toBeLessThan(menu.indexOf('t("userProfile.signOut")'));

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
      english.userProfile["signOut"] as string,
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
    /*
     * Security's pages, in the one table that opens Signing in securely,
     * above its first subsection (Confirm it's you has a table of its own).
     */
    const signingIn: string = sectionOf(YOUR_ACCOUNT, "## Signing in securely");

    expect(
      onlyTableOf(signingIn.slice(0, signingIn.indexOf("\n### "))).map(
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

    for (const field of ["Email", "Full Name", "Timezone", "Language"]) {
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

  it("asks for a password that keeps the one password rule, twice", () => {
    const password: string = dashboard("Pages/Global/UserProfile/Password.tsx");
    const rule: string = readSource(COMMON_DIR, "Types/Password.ts");

    // The shared fields: the rule's checklist, then its confirmation (#9123).
    expect(password).toContain("getNewPasswordFields<");
    expect(password).toContain('translator.translateText("New Password")');
    expect(password).toContain('translator.translateText("Confirm Password")');
    expect(password).toContain('submitButtonText={"Update Password"}');
    expect(rule).toContain(
      "export const MINIMUM_PASSWORD_LENGTH: number = 15;",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Enter the new password in **New Password** and again in **Confirm Password**. It must be at least 15 characters long",
    );
    expect(YOUR_ACCOUNT).toContain(
      "A password you set before this rule keeps working until you change it.",
    );
  });

  it("says what a new password ends, as the write that stores one ends it", () => {
    const userService: string = readSource(
      COMMON_DIR,
      "Server/Services/UserService.ts",
    );

    expect(userService).toContain("updateBy.data.resetPasswordToken = null!;");
    expect(userService).toContain("updateBy.data.magicLinkToken = null!;");
    expect(userService).toContain("cause: SessionEndCause.PasswordChanged,");
    expect(YOUR_ACCOUNT).toContain(
      "A new password signs every device out of your account, and any password reset link or sign-in link already sent stops working.",
    );
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
    // Enable with nothing set up chooses a second step first (#9666).
    expect(page).toContain(
      'authenticatorApp: translationKey("Authenticator app")',
    );
    expect(page).toContain('securityKey: translationKey("Security key")');
    expect(page).toContain('submitButtonText="Continue"');
    expect(page).toContain("enter its 6-digit code to finish setup");
    expect(page).toContain('submitButtonText="Verify and finish"');
    expect(keys).toContain(
      'name={props.isPasskey ? "Passkeys" : "Security keys"}',
    );
    expect(backupCodes).toContain('title="Your backup codes"');
    expect(backupCodes).toContain('submitButtonText="Done"');
    expect(backupCodes).toContain('"Regenerate codes"');
    expect(status).toContain(
      'enableAction: translationKey("Enable two-factor authentication")',
    );
    expect(status).toContain(
      'finishSetupAction: translationKey("Finish setup")',
    );
    /*
     * The badge is a Pill, which looks its words up in the reader's language
     * (#6658): Enabled, or Setup needed while nothing is set up behind it.
     */
    expect(status).toContain('enabled: translationKey("Enabled")');
    expect(status).toContain('setupNeeded: translationKey("Setup needed")');
    expect(status).toContain("text={TWO_FACTOR_STATUS_COPY.enabled}");
    expect(status).toContain("text={TWO_FACTOR_STATUS_COPY.setupNeeded}");
    expect(readSource(COMMON_DIR, "UI/Components/Pill/Pill.tsx")).toContain(
      "translateString(props.text)",
    );

    // The steps are headings of their own, so read the whole section.
    const turnOn: string = sectionOf(YOUR_ACCOUNT, "## Signing in securely");

    for (const label of [
      "Enable two-factor authentication",
      "Authenticator app",
      "Security key",
      "Continue",
      "Verify and finish",
      "Enabled",
      "Your backup codes",
      "Done",
      "Authenticator apps",
      "Security keys",
      "Setup needed",
      "Finish setup",
      "Regenerate codes",
    ]) {
      expect({ label: label, named: turnOn.includes(`**${label}**`) }).toEqual({
        label: label,
        named: true,
      });
    }
  });

  it("says what User Profile shows when the server requires SSO, as the profile and the server decide it (#9688)", () => {
    const sideMenu: string = dashboard("Pages/Global/UserProfile/SideMenu.tsx");
    const overview: string = dashboard("Pages/Global/UserProfile/Index.tsx");
    const notice: string = dashboard(
      "Components/UserProfile/SignInManagement.tsx",
    );
    const rule: string = readSource(
      COMMON_DIR,
      "Server/Utils/SsoRequiredSignIn.ts",
    );
    const managed: string = readSource(
      COMMON_DIR,
      "Server/Utils/SsoManagedSignIn.ts",
    );

    /*
     * The rule is the server's own Require SSO, and master admins are exempt
     * from it and from the projects' rule (#9763), never asked either.
     */
    expect(managed).toContain(
      "await SsoRequiredSignIn.isNonSsoSignInRefused({",
    );
    expect(managed).toContain("if (account.isMasterAdmin === true) {");
    expect(rule).toContain("if (account.isMasterAdmin === true) {");

    // No Security section, and Overview names the provider under Single Sign-On.
    expect(oneLine(sideMenu)).toContain(
      "(props.signInManagement !== null && !props.signInManagement.isManagedBySso);",
    );
    expect(oneLine(sideMenu)).toContain(
      '{showsSecurity ? ( <SideMenuSection title="Security">',
    );
    expect(oneLine(overview)).toContain(
      "{signInManagement?.isManagedBySso || (signInManagement?.localSignInProjectNames.length || 0) > 0 ? (",
    );
    expect(overview).toContain("<SsoManagedSignInNotice");
    expect(notice).toContain('title: translationKey("Single Sign-On")');

    const managedSection: string = sectionOf(
      YOUR_ACCOUNT,
      "### When your organization manages your sign-in",
    );

    expect(managedSection).toContain(
      "**User Profile** then has no **Security** section, and its **Overview** names your provider under **Single Sign-On**.",
    );
    expect(managedSection).toContain(
      "Master admins keep their own **Security** settings.",
    );
  });

  it("says when every project managing sign-in takes the Security settings away, and what gives them back, as the rule and the profile decide it (#9763)", () => {
    const managed: string = readSource(
      COMMON_DIR,
      "Server/Utils/SsoManagedSignIn.ts",
    );
    const notice: string = dashboard(
      "Components/UserProfile/SignInManagement.tsx",
    );
    const managedSection: string = sectionOf(
      YOUR_ACCOUNT,
      "### When your organization manages your sign-in",
    );

    // Every project requires SSO and has the switch on; any other gives them back.
    expect(managed).toContain("project.manageSignInWithSso === true");
    expect(managed).toContain("projects.otherProjects.length === 0");
    expect(managedSection).toContain(
      "The same happens when every project you belong to requires single sign-on and has **Manage Sign-In with SSO** on.",
    );
    expect(managedSection).toContain(
      "- **A project that does not**: as soon as you are a member of, or invited to, a project that does not require SSO, or does not have **Manage Sign-In with SSO** on, your **Security** section comes back.",
    );

    // The profile names those projects as the reason.
    expect(notice).toContain("localSignInProjectNames");
    expect(notice).toContain(
      "You keep your own password, passkeys and two-factor authentication because these projects don't: {{projects}}.",
    );
    expect(managedSection).toContain(
      "**Overview** then names those projects under **Single Sign-On**, as the reason your settings are yours.",
    );
    expect(managedSection).toContain("- **Master admins** always keep");
  });

  it("walks through setting up a second step while signing in with the sign-in page's own words (#9764)", () => {
    const accountsEnglish: {
      login: {
        submitButton: string;
        twoFactorEnrolment: Record<string, string>;
      };
    } = JSON.parse(
      readSource(ACCOUNTS_DIR, "Locales/en.json"),
    ) as typeof accountsEnglish;
    const words: Record<string, string> =
      accountsEnglish.login.twoFactorEnrolment;
    const section: string = sectionOf(
      YOUR_ACCOUNT,
      "### Set up two-factor authentication while signing in",
    );

    for (const label of [
      words["authenticatorApp"]!,
      words["securityKey"]!,
      words["continue"]!,
      words["submitButton"]!,
      words["securityKeyButton"]!,
      words["chooseAnotherWay"]!,
    ]) {
      expect({ label, named: section.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }

    // A browser that cannot register a key is offered only the app.
    expect(readSource(ACCOUNTS_DIR, "Pages/Login.tsx")).toContain(
      "getSecondStepEnrolmentChoices(isPasskeySupported)",
    );
    expect(section).toContain(
      "A browser that cannot register a security key, such as one on a page without HTTPS, offers only the authenticator app.",
    );
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

  it("opens User Settings on its Setup Checklist while something is left, and on Notification Methods after (#7039)", () => {
    expect(
      dashboard(
        "Components/UserSettings/SetupChecklist/UserSettingsLanding.ts",
      ).replace(/\s+/g, " "),
    ).toContain(
      "return hasEssentialStepsLeft ? PageMap.USER_SETTINGS_SETUP : PageMap.USER_SETTINGS_NOTIFICATION_METHODS;",
    );
    expect(
      sectionOf(YOUR_ACCOUNT, "## What each project keeps for you"),
    ).toContain(
      "It opens on **Setup Checklist** while something is left to set up, and on **Notification Methods** once nothing essential is.",
    );
  });

  it("keeps the theme in the browser and a picked language in the account: the browser's language first, the device's theme unless Light or Dark was picked", () => {
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
    expect(YOUR_ACCOUNT).not.toContain(
      "Both are saved in your browser, not in your account",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Your theme is saved in your browser, so set it again on another browser or device.",
    );
    /*
     * A picked language is the account's (User.language): the language menu
     * saves it, and every browser starts in it once the page is up
     * (UserLanguageInit, mounted beside the time zone's).
     */
    expect(YOUR_ACCOUNT).toContain(
      "Your language is saved in your account once you pick it, and every browser you sign in on starts in it.",
    );
    expect(
      dashboard("Components/LanguageSwitcher/LanguageSwitcher.tsx"),
    ).toContain(
      "await UserLanguageUtil.saveSignedInUserLanguage(nextLanguage);",
    );
    expect(dashboard("App.tsx")).toContain("<UserLanguageInit />");

    const languageInit: string = dashboard(
      "Components/UserLanguage/UserLanguageInit.tsx",
    );

    expect(languageInit).toContain("await followUserLanguage(");
    expect(languageInit).toContain(
      "await UserLanguageUtil.readSignedInUserLanguage(),",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Your pick is saved to your account, as **Language** on your profile is, and OneUptime writes your on-call pages in it.",
    );
    // Signing out leaves both: the sign-in page opens next (KeptAfterSignOut.ts).
    expect(YOUR_ACCOUNT).toContain(
      "Logging out keeps them, so on a shared computer the next person starts with yours.",
    );
    expect(KEYS_KEPT_AFTER_SIGN_OUT).toContain(THEME_STORAGE_KEY);
    expect(KEYS_KEPT_AFTER_SIGN_OUT).toContain(DASHBOARD_LANGUAGE_STORAGE_KEY);
    expect(i18n).toContain(
      "export const LANGUAGE_STORAGE_KEY: string = DASHBOARD_LANGUAGE_STORAGE_KEY;",
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

  /*
   * Confirm It's You (#10155, #10216 to #10221): what asks, with what, for
   * how long, and what wrong attempts do, each read from where the server
   * and the prompt decide it.
   */
  it("says what asks you to confirm it's you, as the server's gates decide it", () => {
    const userService: string = readSource(
      COMMON_DIR,
      "Server/Services/UserService.ts",
    );

    // Your email or password, two-factor authentication off, your account.
    expect(userService).toContain(
      "await this.assertSignInChangeIsConfirmed(updateBy, carryForward);",
    );
    expect(userService).toContain(
      "turnsTwoFactorAuthOff &&\n        (await this.isTwoFactorAuthOn(updateBy.props.userId!))",
    );
    expect(userService).toContain(
      "await this.assertAccountDeleteIsConfirmed(deleteBy, users);",
    );

    // Passkeys, security keys and authenticator apps, added or removed.
    for (const [file, calls] of [
      ["Server/Services/UserWebAuthnService.ts", 2],
      ["Server/Services/UserTotpAuthService.ts", 2],
      ["Server/API/UserTotpAuthAPI.ts", 1],
    ] as Array<[string, number]>) {
      expect({
        file: file,
        calls:
          readSource(COMMON_DIR, file).split(
            "await Reauthentication.assertConfirmed(",
          ).length - 1,
      }).toEqual({ file: file, calls: calls });
    }

    // New backup codes only in place of unused ones.
    expect(
      readSource(COMMON_DIR, "Server/API/UserTwoFactorBackupCodeAPI.ts"),
    ).toContain("await Reauthentication.assertConfirmed(");

    expect(YOUR_ACCOUNT).toContain(
      "- change your email address or your password;\n- add or remove a passkey, a security key or an authenticator app;\n- get new backup codes while you still have unused ones;\n- turn two-factor authentication off;\n- delete your account.",
    );
    expect(YOUR_ACCOUNT).toContain(
      "Before it deletes your account, OneUptime asks you to confirm it's you.",
    );
  });

  it("names the prompt, its window and its five tries as the prompt and the server draw them", () => {
    const types: string = readSource(
      COMMON_DIR,
      "Types/Accounts/Reauthentication.ts",
    );
    const prompt: string = readSource(
      COMMON_DIR,
      "UI/Components/Reauthentication/ReauthenticationPrompt.tsx",
    );

    expect(types).toContain(
      "export const REAUTHENTICATION_WINDOW_IN_MINUTES: number = 10;",
    );
    expect(types).toContain(
      "export const REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT: number = 5;",
    );

    for (const label of [
      "Confirm It's You",
      "Use a Passkey",
      "Sign In Again",
      "Sign In Another Way",
    ]) {
      expect(prompt).toContain(`translationKey("${label}")`);
      expect(YOUR_ACCOUNT).toContain(`**${label}**`);
    }

    expect(YOUR_ACCOUNT).toContain(
      "you are not asked again for 10 minutes in that browser. Five wrong attempts sign that browser out, but never lock your account",
    );

    // The two emails: a session signed out, and a backup code spent.
    expect(
      readSource(
        COMMON_DIR,
        "Server/Utils/Reauthentication/Reauthentication.ts",
      ),
    ).toContain("usedFor: BackupCodeUse.ConfirmItsYou,");
    expect(
      readSource(COMMON_DIR, "Server/Utils/Reauthentication/SignedOutEmail.ts"),
    ).toContain("export const SIGNED_OUT_EMAILS_PER_DAY: number = 3;");
    expect(YOUR_ACCOUNT).toContain(
      "OneUptime emails you when this happens, and whenever a backup code confirms it's you.",
    );
  });

  it("says what a master admin confirms first, and that the master API key cannot (#10216)", () => {
    const userApi: string = readSource(COMMON_DIR, "Server/API/UserAPI.ts");

    expect(
      userApi.split("await UserAPI.assertMasterAdminConfirmed(req);").length -
        1,
    ).toBe(5);
    expect(readSource(COMMON_DIR, "Server/API/GlobalConfigAPI.ts")).toContain(
      "await MasterAdminAuthorization.assertSessionConfirmed(req);",
    );

    for (const file of [
      "Server/Services/GlobalSsoService.ts",
      "Server/Services/GlobalOidcService.ts",
    ]) {
      expect(readSource(COMMON_DIR, file)).toContain(
        "await this.assertChangeIsConfirmed(deleteBy.props);",
      );
    }

    expect(
      readSource(COMMON_DIR, "Server/Services/GlobalConfigService.ts"),
    ).toContain("await this.assertEmailSettingsChangeIsConfirmed(updateBy);");
    expect(
      readSource(COMMON_DIR, "Types/Accounts/Reauthentication.ts"),
    ).toContain("An API key cannot make it.");

    expect(YOUR_ACCOUNT).toContain(
      "master admins confirm it's them in the same way before they change how someone else signs in, make someone a master admin, change the server's single sign-on providers or email settings, or create a master API key. The master API key cannot make these changes.",
    );
  });

  it("says what Sign In Again asks of each provider, as each sign-in's start asks it (#10217)", () => {
    expect(readSource(IDENTITY_DIR, "Utils/SSO.ts")).toContain(
      'ForceAuthn="${data.forceAuthn ? "true" : "false"}"',
    );
    expect(readSource(IDENTITY_DIR, "Utils/OIDC.ts")).toContain(
      '...(data.isSignInAgain ? { prompt: "login", max_age: 0 } : {}),',
    );

    const microsoft: string = readSource(
      COMMON_DIR,
      "Server/Utils/MicrosoftSignIn/MicrosoftSignInClient.ts",
    );
    expect(microsoft).toContain('params.set("prompt", "login");');
    expect(microsoft).toContain('params.set("max_age", "0");');

    const google: string = readSource(
      COMMON_DIR,
      "Server/Utils/GoogleSignIn/GoogleSignInClient.ts",
    );
    expect(google).toContain("id_token: { auth_time: { essential: true } },");
    // Google takes no prompt=login: it is asked to choose an account only.
    expect(google).not.toContain('"login"');

    const prompt: string = readSource(
      COMMON_DIR,
      "UI/Components/Reauthentication/ReauthenticationPrompt.tsx",
    );
    expect(prompt).toContain("such as Honor Force Authentication in Okta.");
    expect(prompt).toContain("the auth_time claim in Microsoft Entra ID.");
    expect(prompt).toContain(
      "turn on Session age claims for the server's Google sign-in app.",
    );

    for (const row of [
      '| SAML | `ForceAuthn="true"`, and when you signed in (`AuthnInstant`) | Have the provider honor the request, such as with Honor Force Authentication in Okta. |',
      "| OpenID Connect | `prompt=login` and `max_age=0`, and when you signed in (`auth_time`) | Have the provider send `auth_time`. In Microsoft Entra ID, add it to the ID token as an optional claim. |",
      "| Google | When you signed in (`auth_time`). Google cannot be asked to have you sign in again. | Turn on Session age claims for the server's Google sign-in app, which must be published and verified. |",
      "| Microsoft | `prompt=login` and `max_age=0`, and when you signed in (`auth_time`) | Add `auth_time` to the ID token of the server's Microsoft sign-in app as an optional claim. |",
    ]) {
      expect(YOUR_ACCOUNT).toContain(row);
    }
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
