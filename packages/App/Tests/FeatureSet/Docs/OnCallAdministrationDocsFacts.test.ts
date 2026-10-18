import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  NAV_TITLES_FROM_THE_DASHBOARD,
  NEW_ON_CALL_PAGES,
  ON_CALL_GROUP_PAGES,
  ON_CALL_NAV_GROUP,
  ON_CALL_NAV_SECTION,
  ON_CALL_OVERVIEW,
  ON_CALL_POLICIES,
  OnCallDocsPageEntry,
  READINESS_AND_REPORTS,
  ROLE_NAMES,
  USER_OVERRIDES,
} from "./OnCallAdministrationDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  developerSection,
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
  workspaceSection,
} from "./DocsDashboardMenus";
import { boldPaths } from "./DocsPageShape";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyTimeLog from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { getOnCallPolicyRepeatsAllowed } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
  ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { AWAY_TIMELINE_MESSAGE_PREFIX } from "Common/Types/OnCallDutyPolicy/AwayTimelineMessage";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import OnCallRuleKind, {
  ON_CALL_RULE_KINDS,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import TimeRange from "Common/Types/Time/TimeRange";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ModelImportExport from "Common/Utils/ModelImportExport";
import { EVERY_MINUTE, EVERY_WEEK } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 34: the On Call group's new pages - the overview, on-call
 * policies, user overrides, and readiness & reports - name a lot of the
 * product: the On-Call Duty menu and a policy's own menu, the create form, the
 * list and its bulk actions, what runs a policy, the repeat settings, the
 * statuses a run moves through and where its logs are, archiving, roles and
 * plans, the API; the override form, its cards and which override wins; the
 * readiness statuses, columns, filters and reminders, the weekly email, and
 * the on-call time report. Markdown is not compiled, so nothing else notices
 * when the product moves on.
 *
 * These hold those facts to the source: Common's types and models imported,
 * the Dashboard's pages, the server's services and the workers read as text
 * (an App test must not import the Dashboard's React components, nor any
 * package but App and Common). A renamed menu entry, column, status, default
 * or limit fails here until the English pages follow - and
 * OnCallAdministrationDocsTranslations then carries the change into every
 * language.
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

// The titles of a list of permissions, as a custom role's picker shows them.
function permissionTitles(permissions: Array<Permission>): Array<string> {
  return permissions.map((permission: Permission): string => {
    return PermissionHelper.getTitle(permission);
  });
}

// A table's permissions less the custom-role ones, as role names.
function roleTitles(
  permissions: Array<Permission>,
  customPermissions: Array<Permission>,
): Array<string> {
  return permissionTitles(
    permissions.filter((permission: Permission): boolean => {
      return !customPermissions.includes(permission);
    }),
  );
}

// "**A**, **B** and **C**": the names a sentence lists, as the pages write them.
function listed(names: Array<string>): string {
  const bold: Array<string> = names.map((name: string): string => {
    return `**${name}**`;
  });

  if (bold.length < 2) {
    return bold.join("");
  }

  return `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
}

// ---- The menus --------------------------------------------------------------

/*
 * The On-Call Duty menu's sections, from where the menu lists them: the
 * "Timeline" link above them is the sub-item Execution Logs shows while a log
 * is open, not a section.
 */
const ON_CALL_DUTY_MENU_FILE: string = readDashboardSource(
  "Pages/OnCallDuty/SideMenu.tsx",
);
const ON_CALL_DUTY_MENU_SOURCE: string = ON_CALL_DUTY_MENU_FILE.slice(
  ON_CALL_DUTY_MENU_FILE.indexOf("const sections: SideMenuSectionProps[]"),
);

// A policy's own menu, from where the menu starts.
const POLICY_MENU_FILE: string = readDashboardSource(
  "Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx",
);
const POLICY_MENU_SOURCE: string = POLICY_MENU_FILE.slice(
  POLICY_MENU_FILE.indexOf("<SideMenu>"),
);

const CONNECT_ENTRY_TITLE: string = "Connect Slack or Teams";

// The On-Call Duty menu, with the sections it adds from elsewhere.
function onCallDutyMenu(): Array<MenuSection> {
  return menuSections(ON_CALL_DUTY_MENU_SOURCE, {
    "...(workspaceSection ?": workspaceSection(),
    "addDeveloperSideMenuSection(sections": developerSection(),
  });
}

// A policy's menu, with the Developer section where the menu adds it.
function policyMenu(): Array<MenuSection> {
  return menuSections(POLICY_MENU_SOURCE, {
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

// ---- Shared sources -----------------------------------------------------------

const READINESS_PAGE: string = readDashboardSource(
  "Pages/OnCallDuty/Readiness.tsx",
);
const READINESS_SERVICE: string = readCommonSource(
  "Server/Services/OnCallReadinessService.ts",
);
const USER_OVERRIDE_FORM: string = readDashboardSource(
  "Components/OnCallPolicy/UserOverrides/UserOverrideForm.ts",
);
const USER_OVERRIDE_TABLE: string = readDashboardSource(
  "Components/OnCallPolicy/UserOverrides/UserOverrideTable.tsx",
);

// ---- The nav group --------------------------------------------------------------

describe("the On Call group in the docs", () => {
  it("opens with the overview, so /docs/on-call opens it, and lists the group page for page", () => {
    const group: NavGroup = navGroup(ON_CALL_NAV_GROUP);

    expect(group.section).toBe(ON_CALL_NAV_SECTION);
    expect(
      group.links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      ON_CALL_GROUP_PAGES.map((entry: OnCallDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      }),
    );
    expect(group.links[0]?.url).toBe(`/docs/${ON_CALL_OVERVIEW}`);
  });

  it("names the four new pages in every docs language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const locale: { navLinks: Record<string, string> } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );

      for (const entry of NEW_ON_CALL_PAGES) {
        expect({
          language,
          link: entry.navTitle,
          title: typeof locale.navLinks[entry.navTitle],
        }).toEqual({ language, link: entry.navTitle, title: "string" });
      }
    }
  });

  it("titles the policies and overrides pages as the On-Call Duty menu names the pages they document", () => {
    const entries: Array<string> = onCallDutyMenu().flatMap(
      (menuSection: MenuSection): Array<string> => {
        return menuSection.items;
      },
    );

    for (const title of NAV_TITLES_FROM_THE_DASHBOARD) {
      expect(entries).toContain(title);
    }
  });
});

// ---- The overview: where on-call lives -------------------------------------------

describe("the On-Call Duty menu, as the overview draws it", () => {
  it("has a row per section of the menu, with its pages, in the menu's order", () => {
    const table: string = section(
      english(ON_CALL_OVERVIEW),
      "## Where on-call lives",
    );
    const menu: Array<MenuSection> = onCallDutyMenu().map(
      (menuSection: MenuSection): MenuSection => {
        // The page names the entry that connects a chat tool in prose.
        return {
          title: menuSection.title,
          items: menuSection.items.filter((item: string): boolean => {
            return item !== CONNECT_ENTRY_TITLE;
          }),
        };
      },
    );

    expect(menuTable(table)).toEqual(menu);
    expect(workspaceSection().items).toContain(CONNECT_ENTRY_TITLE);
    expect(table).toContain(
      `**Workspace** lists the chat tools the project has connected, or **${CONNECT_ENTRY_TITLE}** when it has none.`,
    );
  });

  it("says which sections start open, as the menu draws them", () => {
    const open: Array<string> = openSections(
      onCallDutyMenu(),
      ON_CALL_DUTY_MENU_SOURCE,
    );

    expect(open).toEqual(["Policies", "Schedules", "Incoming Calls"]);
    expect(english(ON_CALL_OVERVIEW)).toContain(
      `${listed(open)} are open; the other sections start folded, and a section opens by itself when you are on one of its pages.`,
    );
  });

  it("opens on On-Call Policies, at the address the overview gives", () => {
    const routeMap: string = readDashboardSource("Utils/RouteMap.ts");
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");

    expect(routeMap).toContain(
      "[PageMap.ON_CALL_DUTY]: new Route(\n    `/dashboard/${RouteParams.ProjectID}/on-call-duty/policies`,",
    );
    expect(navigation).toContain("RouteMap[PageMap.ON_CALL_DUTY] as Route");
    expect(sectionByTitle(onCallDutyMenu(), "Policies").items[0]).toBe(
      "On-Call Policies",
    );
    expect(english(ON_CALL_OVERVIEW)).toContain(
      "It opens on **On-Call Policies**, at `/dashboard/{projectId}/on-call-duty/policies`, and its side menu holds the rest:",
    );
  });

  it("sends the bell's on-call item to My On-Call Policies, which says how you are on each policy", () => {
    const header: string = readDashboardSource("Components/Header/Header.tsx");
    const myPolicies: string = readDashboardSource(
      "Pages/Global/MyOnCallPolicies.tsx",
    );
    const onCallCase: string = header.slice(header.indexOf('case "oncall":'));

    expect(header).toContain('id: "oncall"');
    expect(onCallCase.slice(0, 200)).toContain("PageMap.MY_ON_CALL_POLICIES");
    expect(myPolicies).toContain('<Page title={"My On-Call Policies"}');
    // Named on it, through a team, or through a schedule.
    expect(myPolicies).toContain(
      'assignmentDetail: "You are directly assigned"',
    );
    expect(myPolicies).toContain("assignmentDetail: `Via team: ");
    expect(myPolicies).toContain("assignmentDetail: `Via schedule: ");
    expect(english(ON_CALL_OVERVIEW)).toContain(
      "Click it to open **My On-Call Policies**: every policy you are on call for, in all your projects, and whether you are named on it, in a team or on a schedule.",
    );
  });

  it("writes every path through On-Call Duty as its menu has it", () => {
    const menu: Array<MenuSection> = onCallDutyMenu();
    const entries: Array<string> = menu.flatMap(
      (menuSection: MenuSection): Array<string> => {
        return menuSection.items;
      },
    );
    let checked: number = 0;

    for (const entry of NEW_ON_CALL_PAGES) {
      for (const segments of boldPaths(english(entry.page))) {
        if (segments[0] !== "On-Call Duty") {
          continue;
        }

        checked++;

        if (segments.length === 2) {
          expect({
            path: segments,
            found: entries.includes(segments[1]!),
          }).toEqual({
            path: segments,
            found: true,
          });
          continue;
        }

        // On-Call Duty → a section → one of its pages.
        expect({
          path: segments,
          found: sectionByTitle(menu, segments[1]!).items.includes(
            segments[2]!,
          ),
        }).toEqual({ path: segments, found: true });
      }
    }

    // Every page names a path through it; most more than one.
    expect(checked).toBeGreaterThanOrEqual(NEW_ON_CALL_PAGES.length * 2);
  });
});

// ---- The overview: how a page reaches someone -------------------------------------

describe("how a page reaches someone", () => {
  it("moves running policies on every minute", () => {
    for (const job of [
      "OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
      "OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions.ts",
    ]) {
      expect(readWorkerSource(job)).toMatch(/schedule:[^,]*EVERY_MINUTE,/);
    }

    expect(EVERY_MINUTE).toBe("* * * * *");
    expect(english(ON_CALL_OVERVIEW)).toContain(
      "OneUptime moves running policies on every minute",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "OneUptime moves running policies on once a minute",
    );
  });

  it("gives a policy's first level the name and the wait the pages give", () => {
    expect(getDefaultEscalationRuleName(1)).toBe("Level 1");
    expect(DEFAULT_ESCALATE_AFTER_IN_MINUTES).toBe(30);
    expect(english(ON_CALL_OVERVIEW)).toContain(
      `It becomes the policy's first escalation rule, **Level 1**, which waits ${DEFAULT_ESCALATE_AFTER_IN_MINUTES} minutes for an acknowledgement.`,
    );
  });

  it("names the plans each piece needs on OneUptime Cloud", () => {
    // On every plan.
    for (const model of [
      new OnCallDutyPolicy(),
      new OnCallDutyPolicyEscalationRule(),
    ] as Array<DatabaseBaseModel>) {
      expect({
        table: model.tableName,
        plan: model.createBillingPlan || null,
      }).toEqual({
        table: model.tableName,
        plan: null,
      });
    }

    // Growth: schedules, overrides, execution logs and the time report.
    for (const model of [
      new OnCallDutyPolicySchedule(),
      new OnCallDutyPolicyUserOverride(),
      new OnCallDutyPolicyExecutionLog(),
      new OnCallDutyPolicyTimeLog(),
    ] as Array<DatabaseBaseModel>) {
      expect({ table: model.tableName, plan: model.createBillingPlan }).toEqual(
        {
          table: model.tableName,
          plan: PlanType.Growth,
        },
      );
    }

    expect(english(ON_CALL_OVERVIEW)).toContain(
      "> On OneUptime Cloud, on-call policies and escalation rules are on every plan. On-call schedules, user overrides, execution logs and the on-call time report need the **Growth** plan.",
    );
  });
});

// ---- Creating a policy -----------------------------------------------------------

describe("creating a policy", () => {
  const createForm: string = readDashboardSource(
    "Components/OnCallPolicy/OnCallPolicyCreateForm.ts",
  );

  it("asks for a name and who gets paged first, and folds the description and labels under More fields", () => {
    const fieldTitles: Array<string> = Array.from(
      createForm.matchAll(/title:\s*"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(fieldTitles).toEqual([
      "Name",
      "Who gets paged first?",
      "Description",
    ]);
    // Description and labels are both in the folded section.
    expect(createForm).toContain("collapsibleSection: advanced,\n    },");
    expect(createForm).toContain(
      "getLabelsFormField<OnCallDutyPolicy>({\n      collapsibleSection: advanced,",
    );
    expect(
      readCommonSource("UI/Components/FoldedSection/FoldedSectionTitles.ts"),
    ).toContain(
      'MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields")',
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "**Description** and **Labels** wait under **More fields**.",
    );
  });

  it("asks who gets paged first only of people who may add escalation rules", () => {
    expect(createForm).toContain("required: false,");
    expect(createForm).toContain("return options.canAddEscalationRules();");
    expect(english(ON_CALL_POLICIES)).toContain(
      "**Who gets paged first?** is optional, and asked only of people who may add escalation rules: left empty, the policy pages nobody until it has a rule.",
    );
  });

  it("picks the first responders with Add responder, and adds them as Level 1 with the default wait", () => {
    expect(
      readDashboardSource(
        "Components/OnCallPolicy/EscalationRule/EscalationRuleForm.ts",
      ),
    ).toContain('translationKey("Add responder")');
    expect(
      readCommonSource("Server/Services/OnCallDutyPolicyService.ts"),
    ).toContain(
      "rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "3. Under **Who gets paged first?**, click **Add responder** and pick the on-call schedules, teams and people to page first.",
    );
  });

  it("opens a new policy on its Escalation Rules page", () => {
    const list: string = readDashboardSource(
      "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
    );
    const onCreate: string = list.slice(list.indexOf("onCreateSuccess"));

    expect(onCreate.slice(0, 900)).toContain(
      "PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "4. Click **Create On-Call Policy**. The policy opens on its **Escalation Rules** page, with **Level 1** in place.",
    );
  });

  it("names the create button after the policy's singular name", () => {
    expect(new OnCallDutyPolicy().singularName).toBe("On-Call Policy");
    expect(
      readCommonSource("UI/Components/ModelTable/BaseModelTable.tsx"),
    ).toContain('Create: translationKey("Create {{itemName}}")');
  });

  it("names the list, its columns, its bulk actions and JSON import as the Dashboard does", () => {
    const list: string = readDashboardSource(
      "Pages/OnCallDuty/OnCallDutyPolicies.tsx",
    );
    const modelTable: string = readCommonSource(
      "UI/Components/ModelTable/ModelTable.tsx",
    );
    const columns: string = list.slice(list.indexOf("columns={["));
    const columnTitles: Array<string> = Array.from(
      columns.matchAll(/title:\s*"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(list).toContain('title: "On-Call Duty Policies"');
    expect(columnTitles).toEqual(["Name", "Description", "Labels", "Owners"]);
    expect(list).toContain(
      "...labelBulkActions,\n            ...ownerBulkActions,\n            ...archiveBulkActions,",
    );
    expect(list).toContain("enableJsonImportExport={true}");
    expect(modelTable).toContain('title: "Export JSON"');
    expect(modelTable).toContain('title: "Import JSON"');

    for (const [file, titles] of [
      ["BulkLabelActions.tsx", ["Add Labels", "Remove Labels"]],
      ["BulkOwnerActions.tsx", ["Add Owner", "Remove Owner"]],
      ["BulkArchiveActions.tsx", ["Archive"]],
    ] as Array<[string, Array<string>]>) {
      const source: string = readCommonSource(
        `UI/Components/BulkUpdate/${file}`,
      );

      for (const title of titles) {
        expect(source).toContain(`title: "${title}"`);
      }
    }

    expect(english(ON_CALL_POLICIES)).toContain(
      "The **On-Call Duty Policies** list shows each policy's **Name**, **Description**, **Labels** and **Owners**. Select policies to **Add Labels**, **Remove Labels**, **Add Owner**, **Remove Owner**, **Archive**, **Export JSON** or delete them. **Import JSON** creates policies from an export",
    );
  });

  it("exports a policy's own settings, not its escalation rules or owners", () => {
    const exported: Array<string> =
      ModelImportExport.getImportExportableColumnNames(OnCallDutyPolicy);

    expect(exported).toEqual(
      expect.arrayContaining([
        "name",
        "description",
        "repeatPolicyIfNoOneAcknowledges",
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
      ]),
    );

    for (const column of exported) {
      expect(column.toLowerCase()).not.toContain("escalation");
      expect(column.toLowerCase()).not.toContain("owner");
    }

    expect(english(ON_CALL_POLICIES)).toContain(
      "an export holds a policy's own settings, not its escalation rules or owners.",
    );
  });
});

// ---- What runs a policy -----------------------------------------------------------

describe("what runs a policy", () => {
  it("has the On-Call Policy field when an incident or alert is created, on incident templates, and the On-Call fold on a monitor's criteria", () => {
    for (const file of [
      "Pages/Incidents/Create.tsx",
      "Pages/Alerts/Create.tsx",
      "Pages/Incidents/Settings/IncidentTemplates.tsx",
    ]) {
      expect({
        file,
        field: readDashboardSource(file).includes('title: "On-Call Policy"'),
      }).toEqual({
        file,
        field: true,
      });
    }

    for (const file of [
      "Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx",
      "Components/Form/Monitor/MonitorCriteriaAlertForm.tsx",
    ]) {
      expect({
        file,
        fold: readDashboardSource(file).includes('title="On-Call"'),
      }).toEqual({
        file,
        fold: true,
      });
    }

    expect(english(ON_CALL_POLICIES)).toContain(
      "| The record itself | The **On-Call Policy** field when an incident or alert is created, an incident template, or the **On-Call** fold of a monitor's criteria |",
    );
  });

  it("names Execute On-Call Policy in a feed's Actions menu and on chat messages", () => {
    expect(
      readCommonSource("UI/Components/Feed/FeedActionsMenu.tsx"),
    ).toContain('translator.translateText("Actions")');

    for (const feed of [
      "Components/Incident/IncidentFeed.tsx",
      "Components/Alert/AlertFeed.tsx",
      "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
      "Components/AlertEpisode/AlertEpisodeFeed.tsx",
    ]) {
      expect({
        feed,
        action: readDashboardSource(feed).includes("Execute On-Call Policy"),
      }).toEqual({
        feed,
        action: true,
      });
    }

    expect(
      readCommonSource(
        "Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
      ),
    ).toContain('text: "Execute On-Call Policy"');
    /*
     * An alert's and an episode's message carry it; an incident's pages a
     * policy from its menu's Page Someone (WorkspaceIncidentActions).
     */
    for (const message of [
      "Server/Utils/Workspace/Slack/Messages/Alert.ts",
      "Server/Utils/Workspace/Slack/Messages/AlertEpisode.ts",
      "Server/Utils/Workspace/Slack/Messages/IncidentEpisode.ts",
    ]) {
      expect(readCommonSource(message)).toContain(
        'title: "📞 Execute On-Call Policy"',
      );
    }
    expect(english(ON_CALL_POLICIES)).toContain(
      "| By hand | **Execute On-Call Policy**, in the **Actions** menu of a feed, or on a Slack or Microsoft Teams message |",
    );
  });

  it("names the chat command and the workflow step that page a policy", () => {
    expect(
      readCommonSource("Server/Utils/Workspace/WorkspaceCommands.ts"),
    ).toContain('Page = "page"');
    expect(readCommonSource("Types/Workflow/Components/OnCall.ts")).toContain(
      'title: "Page an On-Call Policy"',
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "| Chat and workflows | `/oneuptime page` in Slack or Microsoft Teams, and a workflow's **Page an On-Call Policy** step |",
    );
  });

  it("adds the policies of every incident and alert on-call rule that matches", () => {
    for (const [menuFile, root] of [
      ["Pages/Incidents/SideMenu.tsx", "Incidents"],
      ["Pages/Alerts/SideMenu.tsx", "Alerts"],
    ] as Array<[string, string]>) {
      const rules: MenuSection = sectionByTitle(
        menuSections(readDashboardSource(menuFile)),
        "Rules",
      );

      expect({
        root,
        onCallRules: rules.items.includes("On-Call Rules"),
      }).toEqual({
        root,
        onCallRules: true,
      });
    }

    expect(readCommonSource("Server/Services/IncidentService.ts")).toContain(
      "await IncidentOnCallRuleEngineService.applyRulesToIncident(",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "| On-call rules | **Incidents → Rules → On-Call Rules** and **Alerts → Rules → On-Call Rules** add the policies of every rule that matches |",
    );
  });
});

// ---- A policy's pages --------------------------------------------------------------

describe("a policy's pages", () => {
  it("has a row per section of the policy's menu, with its pages, in the menu's order", () => {
    expect(
      menuTable(section(english(ON_CALL_POLICIES), "## A policy's pages")),
    ).toEqual(policyMenu());
  });

  it("says only Basic starts open", () => {
    expect(openSections(policyMenu(), POLICY_MENU_SOURCE)).toEqual(["Basic"]);
    expect(english(ON_CALL_POLICIES)).toContain(
      "**Basic** is open; the other sections start folded until you click them.",
    );
  });

  it("names the overview's cards in the order it shows them", () => {
    const overview: string = readDashboardSource(
      "Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx",
    );
    const order: Array<number> = [
      overview.indexOf('title: "On-Call Policy Details"'),
      overview.indexOf("<OnCallPolicySummary"),
      overview.indexOf("<ResponderReadinessCard"),
      overview.indexOf("<OnCallDutyPolicyFeedElement"),
    ];

    expect(
      order.every((index: number): boolean => {
        return index >= 0;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
    expect(
      readDashboardSource("Components/OnCallPolicy/OnCallPolicySummary.tsx"),
    ).toContain('translator.translateText("Policy at a glance")');
    expect(
      readDashboardSource(
        "Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx",
      ),
    ).toContain('translator.translateText("Responder readiness")');
    expect(
      readDashboardSource("Components/OnCallPolicy/OnCallDutyPolicyFeed.tsx"),
    ).toContain('title={"On-Call Policy Feed"}');
    expect(english(ON_CALL_POLICIES)).toContain(
      "- **Overview** shows the **On-Call Policy Details**, then **Policy at a glance**:",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "**Responder readiness** says whether everyone it can page can be reached now, and **On-Call Policy Feed** lists what changed",
    );
  });

  it("emails the policy's owners about a page it could not route, and the project's owners when it has none", () => {
    const alerting: string = readCommonSource(
      "Server/Services/OnCallNotificationAlertingService.ts",
    );
    const owners: string = alerting.slice(
      alerting.indexOf("const policyOwners: Array<User>"),
    );

    expect(owners).toContain("if (policyOwners.length > 0) {");
    expect(owners.slice(0, 2500)).toContain("await ProjectService.getOwners(");
    expect(english(ON_CALL_POLICIES)).toContain(
      "When a page it sends finds no rule for someone, or cannot be delivered, they are emailed; a policy with no owners emails the project's owners instead.",
    );
  });

  it("splits the notification logs into a tab per channel", () => {
    const tabs: string = readDashboardSource(
      "Components/NotificationLogs/NotificationLogsTabs.tsx",
    );

    expect(
      readDashboardSource(
        "Pages/OnCallDuty/OnCallDutyPolicy/NotificationLogs.tsx",
      ),
    ).toContain("<NotificationLogsTabs");

    for (const channel of ["Email", "SMS", "Call", "Push"]) {
      expect(tabs).toContain(`name: "${channel}"`);
    }

    expect(english(ON_CALL_POLICIES)).toContain(
      "- **Notification Logs** lists every message the policy sent, with a tab per channel.",
    );
  });

  it("puts Export On-Call Policy and the archive card on Settings", () => {
    const settings: string = readDashboardSource(
      "Pages/OnCallDuty/OnCallDutyPolicy/Settings.tsx",
    );

    expect(settings).toContain(
      "<ExportModelCard modelId={modelId} modelType={OnCallDutyPolicy} />",
    );
    expect(settings).toContain("<ArchiveResourceCard<OnCallDutyPolicy>");
    expect(
      readCommonSource("UI/Components/ImportExport/ExportModelCard.tsx"),
    ).toContain('template: "Export {{itemName}}"');
    expect(english(ON_CALL_POLICIES)).toContain(
      "- **Settings** has **Export On-Call Policy** and the card that archives the policy.",
    );
  });
});

// ---- Repeating a policy -------------------------------------------------------------

describe("repeating a policy", () => {
  const repeatCard: string = readDashboardSource(
    "Components/OnCallPolicy/RepeatPolicy.tsx",
  );

  it("names the card under the rules, its Edit button, the dialog and its two fields", () => {
    expect(
      readDashboardSource("Pages/OnCallDuty/OnCallDutyPolicy/Escalation.tsx"),
    ).toContain("<RepeatPolicy onCallDutyPolicyId={modelId} />");
    expect(repeatCard).toContain('translator.translateText("Repeat Policy")');
    expect(repeatCard).toContain('title="Edit"');
    expect(repeatCard).toContain('title="Edit Repeat Policy"');
    expect(repeatCard).toContain('title: "Repeat if no one acknowledges"');
    expect(repeatCard).toContain('title: "Number of times to repeat"');
    expect(english(ON_CALL_POLICIES)).toContain(
      "click **Edit** on the **Repeat Policy** card below the rules, and fill in **Edit Repeat Policy**:",
    );
  });

  it("starts a new policy with the switch off and no repeats", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    const rows: Array<string> = tableRows(
      section(english(ON_CALL_POLICIES), "## Repeat a policy"),
    );

    expect(
      policy.getTableColumnMetadata("repeatPolicyIfNoOneAcknowledges")
        ?.defaultValue,
    ).toBe(false);
    expect(
      policy.getTableColumnMetadata("repeatPolicyIfNoOneAcknowledgesNoOfTimes")
        ?.defaultValue,
    ).toBe(0);
    expect(
      rows.map((row: string): Array<string> => {
        const cells: Array<string> = tableCells(row);

        return [cells[0] || "", cells[2] || ""];
      }),
    ).toEqual([
      ["**Repeat if no one acknowledges**", "Off"],
      ["**Number of times to repeat**", "0"],
    ]);
  });

  it("repeats only while the switch is on, as many times as the number says", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: false,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).toBe(0);
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).toBe(3);
    // The job moves each run on through OnCallEscalationAdvance (#4914), which holds the repeat check.
    expect(
      readWorkerSource(
        "OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
      ),
    ).toContain("OnCallEscalationAdvance");
    expect(
      readCommonSource("Server/Utils/OnCall/OnCallEscalationAdvance.ts"),
    ).toMatch(/<=\s*getOnCallPolicyRepeatsAllowed\(run\.onCallDutyPolicy\)/);
    expect(english(ON_CALL_POLICIES)).toContain(
      "While it is off, the policy runs once.",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "With the switch on and three repeats, a policy goes through its levels four times in all.",
    );
  });
});

// ---- Execution logs --------------------------------------------------------------

describe("execution logs", () => {
  const statusTable: () => string = (): string => {
    return section(english(ON_CALL_POLICIES), "## Execution logs");
  };

  it("lists every status a run moves through, as the Dashboard writes them", () => {
    const firstCells: Array<string> = firstColumn(statusTable()).flatMap(
      (cell: string): Array<string> => {
        return boldNames(cell);
      },
    );

    expect(firstCells).toEqual([
      OnCallDutyPolicyStatus.Scheduled,
      OnCallDutyPolicyStatus.Started,
      OnCallDutyPolicyStatus.Executing,
      OnCallDutyPolicyStatus.Completed,
      OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      OnCallDutyPolicyStatus.Error,
    ]);
    expect(firstCells.sort()).toEqual(
      [...Object.values(OnCallDutyPolicyStatus)].sort(),
    );
  });

  it("stops a run still Scheduled or Started after 5 minutes as Error", () => {
    const timeout: string = readWorkerSource(
      "OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions.ts",
    );

    expect(timeout).toContain("OneUptimeDate.getSomeMinutesAgo(5)");
    expect(timeout).toContain("status: OnCallDutyPolicyStatus.Started,");
    expect(timeout).toContain("status: OnCallDutyPolicyStatus.Scheduled,");
    expect(timeout).toContain("OnCallDutyPolicyStatus.Error");
    expect(statusTable()).toContain(
      "| **Scheduled**, **Started** | The run is being set up. One still here after 5 minutes is stopped as **Error**. |",
    );
  });

  it("lists the three places a run's log is, and names direct pages as the list does", () => {
    const incidentMenu: Array<MenuSection> = menuSections(
      readDashboardSource("Pages/Incidents/View/SideMenu.tsx"),
    );
    const alertMenu: Array<MenuSection> = menuSections(
      readDashboardSource("Pages/Alerts/View/SideMenu.tsx"),
    );
    const entriesOf: (menu: Array<MenuSection>) => Array<string> = (
      menu: Array<MenuSection>,
    ): Array<string> => {
      return menu.flatMap((menuSection: MenuSection): Array<string> => {
        return menuSection.items;
      });
    };

    expect(entriesOf(incidentMenu)).toContain("On-Call Executions");
    // The alert menu names the page as the incident menu does.
    expect(entriesOf(alertMenu)).toContain("On-Call Executions");
    expect(sectionByTitle(policyMenu(), "Logs").items).toContain(
      "Execution Logs",
    );
    expect(sectionByTitle(onCallDutyMenu(), "Advanced").items).toContain(
      "Execution Logs",
    );
    expect(
      readCommonSource("UI/Components/OnCallDirectPage/DirectPageLabel.tsx"),
    ).toContain('DIRECT_PAGE_LABEL: string = translationKey("Direct page")');
    expect(statusTable()).toContain(
      "- **On-Call Duty → Advanced → Execution Logs**, for every policy, with direct pages from workflows and chat listed as **Direct page**;",
    );
    expect(statusTable()).toContain(
      "- the **On-Call Executions** page of an incident or an alert.",
    );
  });

  it("names the timeline's button, title and columns, and the line for a schedule with nobody on call", () => {
    const table: string = readDashboardSource(
      "Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
    );
    const timeline: string = readDashboardSource(
      "Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx",
    );

    expect(table).toContain('viewButtonText={translationKey("View Timeline")}');
    expect(table).toContain('title: "View Status Message"');
    expect(table).toContain('title: "Acknowledged By"');
    expect(timeline).toContain('translationKey("Execution Timeline")');

    for (const column of [
      "Escalation Rule",
      "Notification Sent To",
      "Schedule",
      "Status",
    ]) {
      expect(timeline).toContain(`title: "${column}"`);
    }

    expect(timeline).toContain(
      'translator.translateText("No one was on call")',
    );
    expect(statusTable()).toContain(
      "**View Timeline** opens its **Execution Timeline**: each escalation rule, who it paged, through which schedule, and how each page ended. A schedule with nobody on call shows **No one was on call** instead of a person.",
    );
  });

  it("says why a Skipped row skipped someone who is away", () => {
    expect(OnCallDutyExecutionLogTimelineStatus.Skipped).toBe("Skipped");
    expect(AWAY_TIMELINE_MESSAGE_PREFIX).toBe(
      "Skipped because this user is away until ",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "a **Skipped** row's status message says why, such as someone away with nobody to cover.",
    );
  });
});

// ---- Archiving and deleting a policy --------------------------------------------

describe("archiving and deleting a policy", () => {
  const archiveCopy: string = readDashboardSource(
    "Components/Archive/ResourceArchiveCopy.ts",
  );
  const policyCopy: string = archiveCopy.slice(
    archiveCopy.indexOf("ON_CALL_POLICY_ARCHIVE_COPY"),
  );

  it("says what an archived policy does, as the archive copy does", () => {
    expect(policyCopy).toContain(
      "Archived on-call policies page no one - incidents and alerts that use them, including any escalating now, skip them - and are hidden from the On-Call Policies list.",
    );
    expect(
      readDashboardSource(
        "Components/TelemetryResource/ArchiveResourceCard.tsx",
      ),
    ).toContain('title: isArchived ? "Unarchive" : "Archive"');
    expect(english(ON_CALL_POLICIES)).toContain(
      "- An archived policy pages no one. Incidents and alerts that use it skip it, and a run that is still escalating stops at its next step.",
    );
  });

  it("records the runs an archived policy refused or stopped", () => {
    expect(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE).toContain(
      "Not executed: this on-call policy is archived",
    );
    expect(ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE).toContain(
      "Execution stopped because the on-call policy was archived.",
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      "an archived policy stays on the incidents and alerts that use it, and pages nobody, and its execution log says it was not executed.",
    );
  });

  it("unarchives from Archived Policies", () => {
    expect(sectionByTitle(onCallDutyMenu(), "Advanced").items).toContain(
      "Archived Policies",
    );
    expect(
      readCommonSource("UI/Components/BulkUpdate/BulkArchiveActions.tsx"),
    ).toContain('title: "Unarchive"');
    expect(english(ON_CALL_POLICIES)).toContain(
      "- It leaves the **On-Call Policies** list for **On-Call Duty → Advanced → Archived Policies**, where **Unarchive** puts it back in service.",
    );
  });

  it("deletes a policy with its escalation rules and overrides, and suggests archiving from the list", () => {
    expect(sectionByTitle(policyMenu(), "Advanced").items).toContain(
      "Delete Policy",
    );
    expect(archiveCopy).toContain(
      "To take it off this list and keep everything, archive it instead.",
    );
    expect(
      readDashboardSource("Pages/OnCallDuty/OnCallDutyPolicies.tsx"),
    ).toContain("deleteConfirmationWarning={ARCHIVE_INSTEAD_OF_DELETE}");
    expect(english(ON_CALL_POLICIES)).toContain(
      "The list's delete asks first, and suggests archiving instead.",
    );
  });
});

// ---- Roles, plans and the API ----------------------------------------------------

describe("who can change a policy, and the policy API", () => {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  const custom: Array<Permission> = [
    Permission.CreateProjectOnCallDutyPolicy,
    Permission.EditProjectOnCallDutyPolicy,
    Permission.DeleteProjectOnCallDutyPolicy,
    Permission.ReadProjectOnCallDutyPolicy,
  ];

  it("names the roles that change and read policies, and the custom permissions", () => {
    const changers: Array<string> = roleTitles(
      policy.createRecordPermissions,
      custom,
    );

    expect(changers).toEqual(
      roleTitles(policy.updateRecordPermissions, custom),
    );
    expect(changers).toEqual(
      roleTitles(policy.deleteRecordPermissions, custom),
    );

    const readersOnly: Array<string> = roleTitles(
      policy.readRecordPermissions,
      custom,
    ).filter((title: string): boolean => {
      return !changers.includes(title);
    });

    expect([...changers, ...readersOnly].sort()).toEqual(
      [...ROLE_NAMES].sort(),
    );
    expect(english(ON_CALL_POLICIES)).toContain(
      `${listed(changers)} can create, change and delete policies; ${listed(readersOnly)} can read them. In a custom role, the permissions are ${listed(permissionTitles(custom))}`,
    );
  });

  it("needs Growth for owners and custom fields", () => {
    for (const model of [
      new OnCallDutyPolicyOwnerUser(),
      new OnCallDutyPolicyOwnerTeam(),
      new OnCallDutyPolicyCustomField(),
    ] as Array<DatabaseBaseModel>) {
      expect({ table: model.tableName, plan: model.createBillingPlan }).toEqual(
        {
          table: model.tableName,
          plan: PlanType.Growth,
        },
      );
    }

    expect(english(ON_CALL_POLICIES)).toContain(
      "Adding owners and custom fields needs the **Growth** plan on OneUptime Cloud.",
    );
  });

  it("names the resource route and the Terraform resource", () => {
    const route: string = policy.crudApiPath?.toString() || "";

    expect(route).toBe("/on-call-duty-policy");
    expect(
      readPackageFile(
        "E2E/Terraform/e2e-tests/tests/31-on-call-duty-policy-crud/main.tf",
      ),
    ).toContain('resource "oneuptime_on_call_policy"');
    expect(english(ON_CALL_POLICIES)).toContain(
      `On-call policies are the \`/api${route}\` resource, and the \`oneuptime_on_call_policy\` resource in Terraform:`,
    );
  });

  it("maps each setting to a column of the policy", () => {
    const rows: Array<Array<string>> = tableRows(
      section(english(ON_CALL_POLICIES), "## API and Terraform"),
    ).map(tableCells);

    expect(rows.length).toBe(5);

    for (const row of rows) {
      const column: string = (row[1] || "").replace(/`/g, "");

      expect({
        column,
        known: Boolean(policy.getTableColumnMetadata(column)),
      }).toEqual({ column, known: true });
    }
  });
});

// ---- User overrides ---------------------------------------------------------------

describe("user overrides", () => {
  const formTitles: Array<string> = Array.from(
    USER_OVERRIDE_FORM.matchAll(/^\s+title:\s*"([^"]+)"/gm),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  it("asks who is away, who covers, and when, in that order", () => {
    expect(formTitles).toEqual([
      "Who is away?",
      "Who covers?",
      "Starts",
      "Ends",
    ]);
    expect(USER_OVERRIDE_FORM).toContain(
      'description: "It starts now unless you pick another time."',
    );
    expect(USER_OVERRIDE_FORM).toContain('"Next person in the rotation"');
    expect(english(USER_OVERRIDES)).toContain(
      "**Starts** is now unless you pick another time.",
    );
    expect(english(USER_OVERRIDES)).toContain(
      "Leave **Who covers?** on **Next person in the rotation** to skip them",
    );
  });

  it("starts Who is away? as you", () => {
    expect(USER_OVERRIDE_FORM).toContain(
      "readPersonId(options?.awayUserId) || currentUserId;",
    );
    expect(english(USER_OVERRIDES)).toContain(
      "**Who is away?** starts as you, because booking your own time off is the most common case.",
    );
  });

  it("names the table's columns and the two cards", () => {
    for (const column of ["Away", "Covered by", "Starts", "Ends"]) {
      expect(USER_OVERRIDE_TABLE).toContain(`title: "${column}"`);
    }

    expect(USER_OVERRIDE_TABLE).toContain('? "On-Call Policy User Overrides"');
    expect(USER_OVERRIDE_TABLE).toContain(': "Global User Overrides"');

    const placement: Array<string> = firstColumn(
      section(english(USER_OVERRIDES), "## Every policy, or one"),
    );

    expect(
      tableRows(
        section(english(USER_OVERRIDES), "## Every policy, or one"),
      ).map((row: string): string => {
        return tableCells(row)[1] || "";
      }),
    ).toEqual([
      "**Global User Overrides**",
      "**On-Call Policy User Overrides**",
    ]);
    expect(placement).toEqual([
      "**On-Call Duty → Advanced → User Overrides**",
      "A policy's **User Overrides**",
    ]);
    expect(english(USER_OVERRIDES)).toContain(
      "Each override is a row: **Away**, **Covered by**, **Starts** and **Ends**",
    );
  });

  it("lets a policy's own override win over a global one, and one that names a cover win over a skip", () => {
    const at: Date = new Date("2026-10-15T09:00:00Z");
    const record: (
      policy: string | null,
      cover: string | null,
    ) => UserOverrideRecord = (
      policy: string | null,
      cover: string | null,
    ): UserOverrideRecord => {
      return {
        overrideUserId: "away",
        routeAlertsToUserId: cover,
        startsAt: at,
        endsAt: at,
        onCallDutyPolicyId: policy,
      };
    };

    expect(
      [
        record(null, null),
        record(null, "cover"),
        record("policy", null),
        record("policy", "cover"),
      ].map((override: UserOverrideRecord): number => {
        return UserOverrideUtil.getPrecedence(override);
      }),
    ).toEqual([3, 2, 1, 0]);
    expect(english(USER_OVERRIDES)).toContain(
      "When two overrides for the same person overlap, the policy's own one wins over a global one, and one that names who covers wins over a skip.",
    );
  });

  it("follows only global overrides for a page sent without a policy", () => {
    const at: Date = new Date("2026-10-15T09:00:00Z");
    const global: UserOverrideRecord = {
      overrideUserId: "away",
      startsAt: at,
      endsAt: at,
    };
    const scoped: UserOverrideRecord = {
      ...global,
      onCallDutyPolicyId: "policy",
    };

    expect(UserOverrideUtil.isOverrideApplicable(global, null)).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(scoped, null)).toBe(false);
    expect(UserOverrideUtil.isOverrideApplicable(scoped, "policy")).toBe(true);
    expect(english(USER_OVERRIDES)).toContain(
      "A page sent without a policy, from a workflow or from chat, follows the global overrides only.",
    );
  });

  it("does not chain overrides", () => {
    expect(
      readCommonSource("Types/OnCallDutyPolicy/UserOverrideUtil.ts"),
    ).toContain(
      "Overrides are non-transitive: an override must never act on a segment",
    );
    expect(english(USER_OVERRIDES)).toContain(
      "- Overrides do not chain. If the person covering is away too, they are still the one paged for the person they cover.",
    );
  });

  it("deletes the overrides of someone who leaves, on either side, that have not ended", () => {
    const leaving: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const removal: string = leaving.slice(
      leaving.indexOf(
        "3. Not-yet-ended user overrides that name the user on either side.",
      ),
    );

    expect(removal.slice(0, 1800)).toContain("overrideUserId: userId,");
    expect(removal.slice(0, 1800)).toContain("routeAlertsToUserId: userId,");
    expect(removal.slice(0, 1800)).toContain(
      "endsAt: QueryHelper.greaterThan(now),",
    );
    expect(english(USER_OVERRIDES)).toContain(
      "When someone leaves the project, every override that names them and has not ended yet is deleted, on either side.",
    );
  });

  it("refuses an override whose away person and cover are the same, or that ends before it starts", () => {
    const service: string = readCommonSource(
      "Server/Services/OnCallDutyPolicyUserOverrideService.ts",
    );

    expect(service).toContain(
      '"Override user and route alerts to user cannot be the same"',
    );
    expect(service).toContain('"Start time must be before end time"');
    expect(english(USER_OVERRIDES)).toContain(
      "An override whose away person and cover are the same is refused, and so is one that ends before it starts.",
    );
  });

  it("names the roles and permissions of overrides, and the Growth plan", () => {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    const custom: Array<Permission> = [
      Permission.CreateOnCallDutyPolicyUserOverride,
      Permission.EditOnCallDutyPolicyUserOverride,
      Permission.DeleteOnCallDutyPolicyUserOverride,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ];
    const changers: Array<string> = roleTitles(
      override.createRecordPermissions,
      custom,
    );
    const readersOnly: Array<string> = roleTitles(
      override.readRecordPermissions,
      custom,
    ).filter((title: string): boolean => {
      return !changers.includes(title);
    });

    expect(changers).toEqual(
      roleTitles(override.deleteRecordPermissions, custom),
    );
    expect(override.createBillingPlan).toBe(PlanType.Growth);
    expect(english(USER_OVERRIDES)).toContain(
      `${listed(changers)} can add and delete overrides; ${listed(readersOnly)} can see them. In a custom role, the permissions are ${listed(
        permissionTitles([
          Permission.CreateOnCallDutyPolicyUserOverride,
          Permission.DeleteOnCallDutyPolicyUserOverride,
          Permission.ReadOnCallDutyPolicyUserOverride,
        ]),
      )}.`,
    );
    expect(english(USER_OVERRIDES)).toContain(
      "On OneUptime Cloud, user overrides need the **Growth** plan.",
    );
  });

  it("shows whose shift is covered on the Schedule Timeline only to people who can read overrides", () => {
    expect(
      readCommonSource("Server/API/OnCallScheduleTimelineAPI.ts"),
    ).toContain("export function canReadUserOverrides(");
    expect(english(USER_OVERRIDES)).toContain(
      "On the **Schedule Timeline**, only people who can read overrides see whose shift is being covered.",
    );
  });

  it("names the API resource and the fields an override needs", () => {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    const required: (column: string) => boolean | undefined = (
      column: string,
    ): boolean | undefined => {
      return override.getTableColumnMetadata(column)?.required;
    };

    expect(override.crudApiPath?.toString()).toBe(
      "/on-call-duty-policy-user-override",
    );
    expect(required("overrideUserId")).toBe(true);
    expect(required("startsAt")).toBe(true);
    expect(required("endsAt")).toBe(true);
    expect(required("routeAlertsToUserId")).toBe(false);
    expect(required("onCallDutyPolicyId")).toBe(false);
    expect(english(USER_OVERRIDES)).toContain(
      "User overrides are the `/api/on-call-duty-policy-user-override` resource:",
    );
  });
});

// ---- Readiness ---------------------------------------------------------------------

describe("readiness", () => {
  it("names the statuses, the tiles and the card as the page draws them", () => {
    expect(READINESS_PAGE).toContain('Ready: translationKey("Ready")');
    expect(READINESS_PAGE).toContain(
      'PartiallyReady: translationKey("Needs setup")',
    );
    expect(READINESS_PAGE).toContain(
      'NotReachable: translationKey("Unreachable")',
    );
    expect(READINESS_PAGE).toContain('title="On-call readiness"');

    for (const tile of [
      '"Responders"',
      '"Ready"',
      '"Needs setup"',
      '"Unreachable"',
    ]) {
      expect(READINESS_PAGE).toContain(tile);
    }

    expect(
      firstColumn(
        section(
          english(READINESS_AND_REPORTS),
          "## How a status is worked out",
        ),
      ),
    ).toEqual(["**Ready**", "**Needs setup**", "**Unreachable**"]);
    expect(english(READINESS_AND_REPORTS)).toContain(
      "Above the list, the tiles count **Responders**, **Ready**, **Needs setup** and **Unreachable**.",
    );
  });

  it("works a status out as the service does", () => {
    const logic: string = READINESS_SERVICE.slice(
      READINESS_SERVICE.indexOf(
        "let status: ReadinessStatus = ReadinessStatus.Ready;",
      ),
    );

    expect(logic.slice(0, 400)).toContain(
      "if (!isProjectMember || usableMethods.length === 0) {\n      status = ReadinessStatus.NotReachable;",
    );
    expect(logic.slice(0, 400)).toContain(
      "} else if (uncoveredCells.length > 0) {\n      status = ReadinessStatus.PartiallyReady;",
    );
    // A cell with no rule that is muted on purpose is not a gap.
    expect(READINESS_SERVICE).toContain(
      "return !cell.hasRule && !cell.isOptOut;",
    );
    // Usable: verified, on a channel the project has on.
    expect(READINESS_SERVICE).toContain(
      "return this.isChannelEnabled(method.methodType, inputs.projectSettings);",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "A rule that turns a severity off on purpose is not a gap.",
    );
  });

  it("counts a gap on each of the four tabs of personal on-call rules", () => {
    expect(ON_CALL_RULE_KINDS).toEqual([
      OnCallRuleKind.Incidents,
      OnCallRuleKind.IncidentEpisodes,
      OnCallRuleKind.Alerts,
      OnCallRuleKind.AlertEpisodes,
    ]);

    for (const ruleType of [
      "ON_CALL_EXECUTED_INCIDENT,",
      "ON_CALL_EXECUTED_INCIDENT_EPISODE,",
      "ON_CALL_EXECUTED_ALERT,",
      "ON_CALL_EXECUTED_ALERT_EPISODE,",
    ]) {
      expect(READINESS_SERVICE).toContain(
        `ruleType: NotificationRuleType.${ruleType}`,
      );
    }

    expect(english(READINESS_AND_REPORTS)).toContain(
      "A gap is a severity with no rule, on the incidents, incident episodes, alerts or alert episodes tab.",
    );
  });

  it("adds every kind of responder the page lists, and says how each was reached", () => {
    expect(READINESS_SERVICE).toContain(
      "addResponder(row.userId, ResponderSource.Direct);",
    );
    expect(READINESS_SERVICE).toContain(
      "addResponder(row.userId, ResponderSource.Team, row.teamId);",
    );
    expect(READINESS_SERVICE).toContain(
      "addResponder(row.userId, ResponderSource.Schedule);",
    );
    expect(READINESS_SERVICE).toContain(
      "addResponder(row.routeAlertsToUserId, ResponderSource.Override);",
    );
    expect(READINESS_SERVICE).toContain(
      '  Direct = "Direct",\n  Team = "Team",\n  Schedule = "Schedule",\n  Override = "Override",',
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "| **Reached via** | How the policies reach them: `Direct`, `Team`, `Schedule` or `Override`. |",
    );
  });

  it("names the table's columns and the filters as the page has them", () => {
    const columns: string = READINESS_PAGE.slice(
      READINESS_PAGE.indexOf("const columns: Array<Column<ResponderRow>> = ["),
    );

    for (const column of [
      "Responder",
      "Status",
      "Teams",
      "Channels",
      "Coverage",
      "Reached via",
    ]) {
      expect(columns).toContain(`title: "${column}"`);
    }

    expect(
      firstColumn(
        section(english(READINESS_AND_REPORTS), "## The Readiness page"),
      ),
    ).toEqual([
      "**Responder**",
      "**Status**",
      "**Teams**",
      "**Channels**",
      "**Coverage**",
      "**Reached via**",
    ]);

    const filters: string = READINESS_PAGE.slice(
      READINESS_PAGE.indexOf("const filters: Array<Filter<ResponderRow>>"),
      READINESS_PAGE.indexOf("const columns: Array<Column<ResponderRow>> = ["),
    );

    for (const filter of ["Responder", "Status", "Team", "Reached via"]) {
      expect(filters).toContain(`title: "${filter}"`);
    }

    expect(english(READINESS_AND_REPORTS)).toContain(
      "The funnel filters the list by **Responder**, **Status**, **Team** or **Reached via**.",
    );
  });

  it("keeps the answer for a minute, and Refresh works it out again", () => {
    expect(READINESS_SERVICE).toContain(
      "const READINESS_CACHE_TTL_IN_MS: number = 60 * 1000;",
    );
    expect(READINESS_PAGE).toContain("getRefreshButton()");
    expect(READINESS_PAGE).toContain('{ refresh: "true" }');
    expect(english(READINESS_AND_REPORTS)).toContain(
      "The answer can be a minute old: **Refresh** works it out again.",
    );
  });

  it("reminds at most 250 people at once, each at most once in 24 hours, and only with the right permissions", () => {
    const reminders: string = readCommonSource(
      "Server/Services/OnCallSetupReminderService.ts",
    );
    const api: string = readCommonSource("Server/API/OnCallReadinessAPI.ts");
    const permissions: string = api.slice(
      api.indexOf("const SETUP_REMINDER_PERMISSIONS: Array<Permission> = ["),
      api.indexOf("];", api.indexOf("const SETUP_REMINDER_PERMISSIONS")),
    );
    const allowed: Array<string> = Array.from(
      permissions.matchAll(/Permission\.([A-Za-z]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return PermissionHelper.getTitle(
        Permission[match[1] as keyof typeof Permission],
      );
    });

    expect(reminders).toContain(
      "export const SETUP_REMINDER_MAX_RECIPIENTS: number = 250;",
    );
    expect(reminders).toContain(
      "const REMINDER_WINDOW_IN_SECONDS: number = 24 * 60 * 60;",
    );
    expect(READINESS_PAGE).toContain('title: "Send setup reminder"');
    expect(allowed).toEqual([
      "Project Owner",
      "Project Admin",
      "On-Call Admin",
      "Edit On-Call Duty Policy",
    ]);
    expect(english(READINESS_AND_REPORTS)).toContain(
      "Nobody is reminded more than once in 24 hours, and one go reminds at most 250 people. Sending reminders takes **Project Owner**, **Project Admin** or **On-Call Admin**, or **Edit On-Call Duty Policy** in a custom role.",
    );
  });

  it("does not let ready responders be ticked", () => {
    expect(READINESS_PAGE).toContain("isItemSelectable={isRemindable}");
    expect(READINESS_PAGE).toContain(
      "return row.status !== READINESS_STATUS_READY;",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "Ready responders cannot be ticked: there is nothing to remind them about.",
    );
  });

  it("shows readiness on a policy's overview, under Users, and walks you through your own setup", () => {
    const usersMenu: string = readDashboardSource(
      "Pages/Users/View/SideMenu.tsx",
    );
    const userSettingsMenu: Array<MenuSection> = menuSections(
      readDashboardSource("Pages/UserSettings/SideMenu.tsx").slice(
        readDashboardSource("Pages/UserSettings/SideMenu.tsx").indexOf(
          "const sections: SideMenuSectionProps[]",
        ),
      ),
    );

    expect(
      readDashboardSource("Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx"),
    ).toContain("<ResponderReadinessCard onCallDutyPolicyId={modelId} />");
    expect(
      readDashboardSource(
        "Components/OnCallPolicy/Readiness/ResponderReadinessCard.tsx",
      ),
    ).toContain('title="Recheck"');
    expect(usersMenu).toContain('title: "On-Call",');
    expect(usersMenu).toContain('title: "Readiness",');
    expect(sectionByTitle(userSettingsMenu, "Get Started").items).toContain(
      "Setup Checklist",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "- Under **Users**, open a member, then **Readiness** in the **On-Call** section: their status, their methods and their coverage grid.",
    );
  });
});

// ---- The weekly readiness email ---------------------------------------------------

describe("the weekly readiness email", () => {
  const digest: string = readWorkerSource(
    "OnCallDutyPolicy/WeeklyReadinessDigest.ts",
  );

  it("runs every week, mails only the owners, and only when someone needs attention", () => {
    expect(EVERY_WEEK).toBe("0 0 * * 0");
    expect(digest).toContain("{ schedule: EVERY_WEEK, runOnStartup: false },");
    expect(digest).toContain(
      "if (notReachable.length === 0 && partiallyReady.length === 0) {",
    );
    expect(digest).toContain("await ProjectService.sendEmailToProjectOwners(");
    expect(english(READINESS_AND_REPORTS)).toContain(
      "When anyone in it is **Unreachable** or **Needs setup**, the project's owners get one email",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "A week with everyone ready sends nothing",
    );
  });

  it("lists up to 20 names a group, and flags someone who cannot be paged at all", () => {
    expect(digest).toContain(
      "const MAX_RESPONDERS_LISTED_PER_SECTION: number = 20;",
    );
    expect(digest).toContain("? `[Action Required] ");
    expect(english(READINESS_AND_REPORTS)).toContain("up to 20 names each");
    expect(english(READINESS_AND_REPORTS)).toContain(
      "When someone cannot be paged at all, its subject starts with `[Action Required]`.",
    );
  });
});

// ---- User On Call Time ---------------------------------------------------------------

describe("User On Call Time", () => {
  const report: string = readDashboardSource(
    "Components/OnCallPolicy/TimeLog/OnCallDutyTimeLogTable.tsx",
  );

  it("is under Reports, with the columns and the starting range the page has", () => {
    expect(sectionByTitle(onCallDutyMenu(), "Reports").items).toEqual([
      "User On Call Time",
    ]);
    expect(report).toContain('title: "User",');
    expect(report).toContain('title: "Time user was on call",');
    expect(report).toContain("range: TimeRange.PAST_ONE_MONTH,");
    expect(TimeRange.PAST_ONE_MONTH).toBe("Past 1 Month");
    expect(
      firstColumn(
        section(english(READINESS_AND_REPORTS), "## User On Call Time"),
      ),
    ).toEqual(["**User**", "**Time user was on call**"]);
    expect(english(READINESS_AND_REPORTS)).toContain(
      "**On-Call Duty → Reports → User On Call Time** shows how long each person was on call, over a range you pick: **Past 1 Month** to start with.",
    );
  });

  it("counts time on call through two policies once, and time still going on up to now", () => {
    expect(report).toContain("// Merge overlapping time periods");
    expect(report).toContain(
      "let endDate: Date = log.endsAt || OneUptimeDate.getCurrentDate();",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "Time on call through two policies at once counts once, and time still going on counts up to now.",
    );
  });

  it("deletes time that ended more than 200 days ago on OneUptime Cloud, and keeps it all self-hosted", () => {
    const retention: string = readWorkerSource(
      "OnCallPolicy/DeleteOldTimeLogs.ts",
    );

    expect(retention).toContain("OneUptimeDate.getSomeDaysAgo(200)");
    expect(retention).toContain("if (!IsBillingEnabled) {");
    expect(retention).toContain(
      "endsAt: QueryHelper.lessThanEqualTo(sixMonthsAgo),",
    );
    expect(english(READINESS_AND_REPORTS)).toContain(
      "> On OneUptime Cloud, the report needs the **Growth** plan, and time that ended more than 200 days ago is deleted. A self-hosted installation keeps all of it.",
    );
  });
});
