import {
  ADMINISTRATION_PAGES,
  AUDIT_LOGS,
  AdministrationDocsPageEntry,
  BILLING,
  BILLING_ACCESS_ROWS,
  INVITING_PEOPLE,
  KEPT_AS_WRITTEN,
  PERMISSION_TITLES,
  PROJECT_SETTINGS,
  SERVER_MESSAGES,
} from "./AdministrationDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  menuSections,
  readCommonSource,
  readDashboardSource,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { PATH_SEPARATOR, boldPaths } from "./DocsPageShape";
import {
  SettingsMenu,
  WrittenPath,
  pathsThrough,
  projectSettingsMenu,
} from "../../Dashboard/SettingsMenuPaths";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import Errors from "Common/Server/Utils/Errors";
import { PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE } from "Common/Server/Services/PayAsYouGoBillingService";
import PublicMessageRateLimit, {
  PublicMessageChannel,
  TeamMessageKind,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import Label from "Common/Models/DatabaseModels/Label";
import { sortLabelNames } from "Common/Utils/LabelOrder";
import { compareNaturally } from "Common/Utils/NaturalOrder";
import {
  TABLE_COLUMN_LIST_VISIBLE_COUNT,
  getTableColumnListVisibleCount,
} from "Common/UI/Components/TableColumnList/TableColumnListFold";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectOidc from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import ProjectSso from "Common/Models/DatabaseModels/ProjectSso";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import {
  InviteTeam,
  InviteTeamPermissionRow,
  MEMBERS_TEAM_NAME,
  pickDefaultInviteTeam,
} from "Common/Types/Team/DefaultInviteTeamRule";
import {
  PAYMENT_METHOD_ADD_PERMISSIONS,
  PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS,
  PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS,
  PROJECT_INVOICE_DOWNLOAD_PERMISSIONS,
  PROJECT_INVOICE_PAY_PERMISSIONS,
  PROJECT_INVOICE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "Common/Utils/Project/ProjectBilling";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  PROJECT_BALANCE_RECHARGE_PERMISSIONS,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import {
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
} from "Common/Utils/Project/NotificationChannels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 39 added the four Administration pages the docs never
 * had: Inviting People, Project Settings, Billing & Usage and Audit Logs.
 * Between them they name a great deal of the product - every menu, card,
 * button, field and default of the Users list, the invitation, the Project
 * Settings side menu, the billing pages and the audit log; who may do what;
 * the prices; and which records the audit log covers.
 *
 * Markdown is not compiled, so nothing else notices when the product moves
 * on. These hold the English pages to the source: Common's models, types
 * and permission lists are imported, the rule that picks an invitation's
 * team is run, and the Dashboard's pages, the server's services and the
 * invitation email are read as text (an App test must not import the
 * Dashboard's React components). A renamed label, a changed default, a new
 * audited record or a new permission fails here until the English pages
 * follow - and AdministrationDocsTranslations then carries the change into
 * every language.
 *
 * The audit log's table, its settings form and its recorder are the
 * Enterprise Edition's (ee/): that half runs where ee/ is checked out,
 * which is the Enterprise Edition Test workflow (.github/workflows/
 * test.ee.yaml).
 */

const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPO_DIR, "ee");

const HEADING_LEVEL: RegExp = /^(#+) /;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const NAVBAR_CATEGORY: RegExp = /category: (\w+)Category/;
const SPLICE_OFFSET: RegExp = /sections\.splice\((-?\d+), 0,/;
const MIN_LENGTH: RegExp = /minLength:\s*(\d+)/;
const MIN_VALUE: RegExp = /minValue:\s*(\d+)/;
const MAX_VALUE: RegExp = /maxValue:\s*(\d+)/;
const AMOUNT_ABOVE: RegExp = /if \(amount > (\d+)\)/;
const AMOUNT_BELOW: RegExp = /if \(amount < (\d+)\)/;
// An amount in dollars as the page writes it: $0.10, $2, $1,000.
const DOLLARS: RegExp = /\$(\d+(?:[.,]\d+)*)/g;
const TITLE_PROPERTY: RegExp = /title: "([^"]+)"/g;
const TAB_NAME: RegExp = /name: "([^"]+)"/g;
const CACHE_TTL: RegExp =
  /PROJECT_SETTINGS_CACHE_TTL_MS: number = (\d+) \* 1000;/;
const RETENTION_CLAMP: RegExp =
  /Math\.max\(1, Math\.min\(retentionInDays \|\| (\d+), (\d+)\)\)/;
const UP_TO_DAYS: RegExp = /up to (\d+) days/;

function english(page: string): string {
  return readPage("en", page);
}

// A file of any package, as text.
function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
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

/*
 * The body rows of the first table in a piece of markdown whose header row
 * starts with `firstHeader`, as cells.
 */
function tableRows(
  markdown: string,
  firstHeader: string,
): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(`| ${firstHeader} |`);
  });

  expect({ firstHeader, found: start >= 0 }).toEqual({
    firstHeader,
    found: true,
  });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(tableCells(line));
  }

  return rows;
}

// Every **bold** name in a piece of text, in order.
function boldNames(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every `inline code` span in a piece of text, in order.
function inlineCodes(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The source between two markers, both of which must be there.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  expect({ from, found: start >= 0 }).toEqual({ from, found: true });

  const end: number = source.indexOf(to, start + from.length);

  expect({ to, found: end >= 0 }).toEqual({ to, found: true });

  return source.slice(start, end);
}

// The number a pattern's first group captures in a piece of source.
function capturedNumber(source: string, pattern: RegExp): number {
  const match: RegExpExecArray | null = pattern.exec(source);

  expect({ pattern: pattern.source, found: match !== null }).toEqual({
    pattern: pattern.source,
    found: true,
  });

  return Number((match as RegExpExecArray)[1]);
}

// The Dashboard's English locale, flat keys and the nested navbar.
const DASHBOARD_ENGLISH: Record<string, unknown> = JSON.parse(
  readDashboardSource("Locales/en.json"),
) as Record<string, unknown>;

function navbarValue(group: string, key: string): string {
  const navbar: Record<string, Record<string, string>> = DASHBOARD_ENGLISH[
    "navbar"
  ] as Record<string, Record<string, string>>;

  return navbar[group]?.[key] || "";
}

// The Products menu category a navbar item is listed under.
function productsMenuCategory(itemKey: string): string {
  const items: string = readDashboardSource("Utils/NavigationItems.tsx");
  const start: number = items.indexOf(`t("navbar.items.${itemKey}"`);

  expect({ itemKey, listed: start >= 0 }).toEqual({ itemKey, listed: true });

  const entry: string = items.slice(start, items.indexOf("},", start));
  const category: RegExpExecArray | null = NAVBAR_CATEGORY.exec(entry);

  return category?.[1] || "";
}

// The permission a name on the pages stands for: a role's or a permission's title.
function permissionNamed(name: string): Permission {
  const found: Array<Permission> = PermissionHelper.getAllPermissionProps()
    .filter((props: { title: string }): boolean => {
      return props.title === name;
    })
    .map((props: { permission: Permission }): Permission => {
      return props.permission;
    });

  expect({ name, permissions: found.length }).toEqual({
    name,
    permissions: 1,
  });

  return found[0] as Permission;
}

// The permissions a table cell names, by title, sorted.
function permissionsInCell(cell: string): Array<Permission> {
  return cell
    .split("**")
    .join("")
    .split(" or ")
    .join(", ")
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    })
    .map(permissionNamed)
    .sort();
}

function sorted(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return [...new Set(permissions)].sort();
}

/*
 * Project Settings' side menu as the reader sees it: the sections in the
 * order the menu draws them, the billing section put where the menu's own
 * splice puts it on OneUptime Cloud.
 */
function drawnProjectSettingsSections(): Array<MenuSection> {
  const source: string = readDashboardSource("Pages/Settings/SideMenu.tsx");
  const sections: Array<MenuSection> = menuSections(source);
  const offset: number = capturedNumber(source, SPLICE_OFFSET);
  const billing: MenuSection = sections.pop() as MenuSection;

  // Written last in the source, inserted as the menu inserts it.
  expect(billing.title).toBe("Billing and Invoices");

  sections.splice(sections.length + offset, 0, billing);

  return sections;
}

// The models every audit log entry can be about: those that record changes.
function auditedModels(): Array<BaseModel> {
  return AllModelTypes.map((modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  }).filter((model: BaseModel): boolean => {
    return Boolean(
      model.enableAuditLogOn &&
        (model.enableAuditLogOn.create ||
          model.enableAuditLogOn.update ||
          model.enableAuditLogOn.delete),
    );
  });
}

function isAudited(modelType: { new (): BaseModel }): boolean {
  const model: BaseModel = new modelType();

  return Boolean(model.enableAuditLogOn);
}

describe("the pages' places in the docs", () => {
  it("opens the Configuration category on Project Settings, its map", () => {
    const group: NavGroup = DocsNav.find((candidate: NavGroup): boolean => {
      return candidate.title === "Configuration";
    }) as NavGroup;

    expect(group.links[0]?.url).toBe(`/docs/${PROJECT_SETTINGS}`);
  });

  it("keeps Users, Teams & Permissions first in its group, with Inviting People after it", () => {
    const group: NavGroup = DocsNav.find((candidate: NavGroup): boolean => {
      return candidate.title === "Users & Permissions";
    }) as NavGroup;

    expect(
      group.links.map((link: NavLink): string => {
        return link.url;
      }),
    ).toEqual([
      "/docs/permissions/index",
      `/docs/${INVITING_PEOPLE}`,
      "/docs/permissions/reference",
    ]);
  });

  it.each(ADMINISTRATION_PAGES)(
    "$page is in the Administration section",
    (entry: AdministrationDocsPageEntry) => {
      const group: NavGroup | undefined = DocsNav.find(
        (candidate: NavGroup): boolean => {
          return candidate.links.some((link: NavLink): boolean => {
            return link.url === `/docs/${entry.page}`;
          });
        },
      );

      expect(group?.section).toBe("Administration");
      expect(group?.title).toBe(entry.navGroup);
    },
  );
});

describe("Inviting People", () => {
  const page: string = english(INVITING_PEOPLE);
  const users: string = readDashboardSource("Pages/Users/Index.tsx");

  it("opens Users from the Products menu's Settings group", () => {
    expect(page).toContain("**Products → Settings → Users**");
    expect(productsMenuCategory("usersTitle")).toBe("settings");
    expect(navbarValue("items", "usersTitle")).toBe("Users");
    expect(navbarValue("categories", "settings")).toBe("Settings");
  });

  it("names the Users list, its button and the invitation dialog as the Dashboard draws them", () => {
    expect(users).toContain('title: "Users"');
    expect(users).toContain('title: "Invite User"');
    expect(users).toContain('title="Invite New User"');
    expect(users).toContain('submitButtonText="Invite"');
    expect(users).toContain('placeholder: "member@company.com"');

    const steps: string = section(page, "## Invite someone");

    for (const label of [
      "Invite User",
      "Invite New User",
      "Email",
      "Name",
      "Team",
      "Invite",
      "Invitation Sent",
    ]) {
      expect(boldNames(steps)).toContain(label);
    }

    // The fields, in the order the dialog asks them.
    const fields: string = between(users, "fields: [", "formType:");

    expect(
      ['title: "Email"', 'title: "Name"', 'title: "Team"'].map(
        (title: string): number => {
          return fields.indexOf(title);
        },
      ),
    ).toEqual(
      [...['title: "Email"', 'title: "Name"', 'title: "Team"']]
        .map((title: string): number => {
          return fields.indexOf(title);
        })
        .sort((a: number, b: number): number => {
          return a - b;
        }),
    );
  });

  it("asks for a Name only for an address no account uses yet", () => {
    const nameField: string = between(
      users,
      'title: "Name"',
      "},\n              {",
    );

    expect(nameField).toContain("isEmailRegistered === false");
    expect(nameField).toContain("required: false");
    expect(page).toContain(
      "If no OneUptime account uses it yet, the dialog also asks for a **Name**",
    );
  });

  it("starts Team on the members team: Project Member for the whole project, or else the team named Members", () => {
    const canGrantAll: () => boolean = (): boolean => {
      return true;
    };
    const teams: Array<InviteTeam> = [
      { id: "owners", name: "Owners" },
      { id: "admin", name: "Admin" },
      { id: "everyone", name: "Everyone" },
    ];
    const rows: Array<InviteTeamPermissionRow> = [
      {
        teamId: "owners",
        permission: Permission.ProjectOwner,
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
      {
        teamId: "admin",
        permission: Permission.ProjectAdmin,
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
      {
        teamId: "everyone",
        permission: Permission.ProjectMember,
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
    ];

    // A renamed members team is still the members team.
    expect(
      pickDefaultInviteTeam({ teams, permissionRows: rows, canGrantAll })?.id,
    ).toBe("everyone");

    // Without one, the team named Members, whatever it holds.
    expect(
      pickDefaultInviteTeam({
        teams: [...teams, { id: "members", name: MEMBERS_TEAM_NAME }],
        permissionRows: rows.slice(0, 2),
        canGrantAll,
      })?.id,
    ).toBe("members");

    // Neither: Team starts empty.
    expect(
      pickDefaultInviteTeam({
        teams,
        permissionRows: rows.slice(0, 2),
        canGrantAll,
      }),
    ).toBeNull();

    // A team the person inviting could not hand on is never picked.
    expect(
      pickDefaultInviteTeam({
        teams,
        permissionRows: rows,
        canGrantAll: (): boolean => {
          return false;
        },
      }),
    ).toBeNull();

    expect(MEMBERS_TEAM_NAME).toBe("Members");
    expect(page).toContain(
      "the team that holds Project Member for the whole project, or else the one named Members",
    );
    expect(page).toContain(
      "**Team** starts empty when the project has no such team, or when you could not invite anyone to it yourself.",
    );
  });

  it("names who may invite: the team member table's create list, and only to a team they could hand on", () => {
    expect(sorted(new TeamMember().getCreatePermissions())).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.InviteProjectTeamMembers,
      ]),
    );
    expect(PermissionHelper.getTitle(Permission.InviteProjectTeamMembers)).toBe(
      "Invite New Members",
    );
    expect(page).toContain(
      "Project Owner, Project Admin, or a role with the **Invite New Members** permission.",
    );

    // The grant ceiling the page names.
    expect(readCommonSource("Server/Services/TeamMemberService.ts")).toContain(
      "TeamPermissionService.assertCanGrantTeamPermissions",
    );
  });

  it("names the invitation email's subjects and buttons", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const template: string = readPackageFile(
      "App/FeatureSet/Notification/Templates/InviteMember.hbs",
    );

    expect(service).toContain('"You have been invited to " + project.name');
    expect(service).toContain('"You have been added to " + project.name');
    expect(template).toContain('buttonText="Create Your Account"');
    expect(template).toContain('buttonText=(concat "Sign In to " (brandName))');
    expect(page).toContain(
      "Its button is **Create Your Account** for someone who has no OneUptime account yet, and **Sign In to OneUptime** for someone who has one.",
    );
  });

  it("names both places an invitation is accepted, with their buttons", () => {
    const pending: string = readCommonSource(
      "UI/Components/ProjectInvitations/PendingProjectInvitations.tsx",
    );
    const invitations: string = readDashboardSource(
      "Pages/Global/ProjectInvitations.tsx",
    );
    const welcome: string = readDashboardSource("Pages/Onboarding/Welcome.tsx");
    const header: string = readDashboardSource("Components/Header/Header.tsx");

    // No project yet: the welcome page lists the invitations.
    expect(welcome).toContain("<PendingProjectInvitations");
    expect(pending).toContain('title="Accept & Join"');
    expect(pending).toContain('title="Decline"');

    // In a project: the bell counts them and opens Project Invitations.
    expect(header).toContain('id: "invitations"');
    expect(between(header, 'case "invitations":', "break;")).toContain(
      "PageMap.PROJECT_INVITATIONS",
    );
    expect(invitations).toContain('title={"Project Invitations"}');
    expect(invitations).toContain('title: "Accept"');
    expect(invitations).toContain('deleteButtonText="Reject"');

    const rows: Array<Array<string>> = tableRows(
      section(page, "## Accept an invitation"),
      "Where they are",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return boldNames(row.join(" "));
      }),
    ).toEqual([
      ["Accept & Join", "Decline"],
      ["Project Invitations", "Accept", "Reject"],
    ]);
  });

  it("says one acceptance covers the project, and that a member added to another team is on it at once", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const onUpdate: string = between(
      service,
      "protected override async onUpdateSuccess(",
      "protected override async onBeforeDelete(",
    );

    expect(onUpdate).toContain("acceptPendingInvitationsInProject");

    const onCreate: string = between(
      service,
      "protected override async onBeforeCreate(",
      "protected override async onBeforeUpdate(",
    );

    expect(onCreate).toContain("await this.isUserMemberOfProject({");
    expect(onCreate).toContain("createBy.data.hasAcceptedInvitation = true;");

    expect(page).toContain(
      "Accepting one invitation accepts every other invitation the person has to the same project. A member you add to another team later is on it at once, with nothing to accept.",
    );
  });

  it("quotes the refusals as the server words them", () => {
    const refusals: string = section(page, "## Troubleshooting");

    expect(refusals).toContain(
      `:::details "${Errors.TeamMemberService.ALREADY_INVITED}"`,
    );
    expect(
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN.startsWith(
        "You have reached the user limit for the free plan",
      ),
    ).toBe(true);
    expect(refusals).toContain(
      ':::details "You have reached the user limit for the free plan"',
    );

    // The Free plan holds one person.
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );

    expect(service).toContain(
      "export const ALLOWED_PEOPLE_IN_FREE_PLAN: number = 1;",
    );
    // A project on the Free plan, as the request or the project's row names it.
    expect(service).toContain("isFreePlan: this.isHeldToFreePlanPerson({");
    expect(service).toContain(
      "if (data.props.currentPlan === PlanType.Free) {\n      return true;\n    }",
    );
    expect(service).toContain(
      "SubscriptionPlan.getSubscriptionPlanById(planId)?.getName() ===\n      PlanType.Free",
    );
    expect(service).toContain(
      "if (data.limits.isFreePlan && data.people >= ALLOWED_PEOPLE_IN_FREE_PLAN) {\n      return Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN;",
    );
    expect(page).toContain("The Free plan has room for one person.");
  });

  it("says SCIM Push Groups takes inviting and removing people out of OneUptime", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );

    expect(service).toContain(
      "Cannot invite team members while SCIM Push Groups is enabled for this project.",
    );
    expect(service).toContain(
      "Cannot delete team members while SCIM Push Groups is enabled for this project.",
    );
    expect(users).toContain('title="Users are managed by SCIM Push Groups"');
    expect(page).toContain(
      ":::details Invite User says users are managed by SCIM Push Groups",
    );
  });

  it("sends an invited person who signs up without the link a new one", () => {
    const authentication: string = readPackageFile(
      "App/FeatureSet/Identity/API/Authentication.ts",
    );

    expect(authentication).toContain(
      "AuthenticationEmail.sendCompleteRegistrationEmail({",
    );
    expect(page).toContain(
      "Ask them to sign up with the address you invited: OneUptime emails that address a new link to finish creating the account.",
    );
  });

  it("names the Users list's columns, statuses and filters", () => {
    for (const title of [
      'title: "User"',
      'title: "Teams"',
      'title: "Status"',
    ]) {
      expect(users).toContain(title);
    }

    expect(users).toContain('<Pill text="Invitation Sent" color={Yellow} />');
    expect(users).toContain('<Pill text="Member" color={Green} />');
    expect(users).toContain('other: "{{count}} Invitations Pending"');

    for (const facet of ['label: "User"', 'label: "Status"', 'label: "Team"']) {
      expect(users).toContain(facet);
    }

    const list: string = section(page, "## See who is in the project");

    expect(
      tableRows(list, "Column").map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["**User**", "**Teams**", "**Status**"]);
    expect(list).toContain(
      "Filter the list by **User**, **Status** or **Team**.",
    );
  });

  it("names a person's pages as their side menu draws them, and who sees the on-call ones", () => {
    const menu: string = readDashboardSource("Pages/Users/View/SideMenu.tsx");
    const pages: Array<string> = tableRows(
      section(page, "## See who is in the project"),
      "Page",
    ).map((row: Array<string>): string => {
      return row[0] as string;
    });

    expect(pages).toEqual([
      "**Profile**",
      "**Teams**",
      "**Readiness**, **Notification Methods**, **On-Call Rules**",
      "**Custom Fields**",
      "**Remove from Project**",
    ]);

    for (const title of [
      'title: "Profile"',
      'title: "Teams"',
      'title: "Readiness"',
      'title: "Notification Methods"',
      'title: "On-Call Rules"',
      'title: "Custom Fields"',
      'title: "Remove from Project"',
    ]) {
      expect(menu).toContain(title);
    }

    // Who sees the On-Call section: the person, and these.
    expect(
      between(
        menu,
        "NOTIFICATION_RULE_READ_PERMISSIONS: Array<Permission> = [",
        "];",
      ),
    ).toContain("Permission.ReadProjectUserNotificationRule");
    expect(menu).toContain("signedInUserId === props.modelId.toString()");
    expect(page).toContain(
      "Shown to Project Owners, Project Admins, the person themselves, and anyone who may read people's notification rules.",
    );
  });

  it("names the Teams page's buttons, and what removing the last team does", () => {
    const teams: string = readDashboardSource("Pages/Users/View/Teams.tsx");
    const removal: string = readDashboardSource(
      "Utils/TeamMembershipRemoval.ts",
    );

    expect(teams).toContain('createVerb={"Invite"}');
    expect(teams).toContain('deleteButtonText="Remove"');
    expect(removal).toContain('title: "Remove from Team and Project"');

    const steps: string = section(page, "## Change someone's teams");

    expect(boldNames(steps)).toEqual(
      expect.arrayContaining(["Invite", "Team", "Remove"]),
    );
  });

  it("says the Owners team keeps a member who has joined", () => {
    const projects: string = readCommonSource(
      "Server/Services/ProjectService.ts",
    );

    expect(projects).toContain('ownerTeam.name = "Owners";');
    expect(projects).toContain("ownerTeam.shouldHaveAtLeastOneMember = true;");
    expect(Errors.TeamMemberService.ONE_MEMBER_REQUIRED).toBe(
      "This team should have at least 1 member who has accepted the invitation.",
    );
    expect(page).toContain(
      "The Owners team always keeps at least one member who has joined",
    );
  });

  it("names how someone is removed: the row menu, their own page, or several at once", () => {
    expect(users).toContain('deleteButtonText="Remove from Project"');
    // View is the row's button, so Remove from Project waits in its menu.
    expect(users).toContain("isViewable={true}");
    expect(users).toContain(
      '"Each selected user will be removed from every team in this project and lose access to it immediately."',
    );
    expect(sorted(new TeamMember().getDeletePermissions())).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeleteProjectTeam,
      ]),
    );
    expect(section(page, "## Remove someone from the project")).toContain(
      "open the person's row menu, **⋯**, and click **Remove from Project**",
    );
  });
});

describe("Project Settings", () => {
  const page: string = english(PROJECT_SETTINGS);
  const sideMenu: string = readDashboardSource("Pages/Settings/SideMenu.tsx");

  it("opens Project Settings from the Products menu's Settings group", () => {
    expect(page).toContain("**Products → Settings → Project Settings**");
    expect(productsMenuCategory("projectSettingsTitle")).toBe("settings");
    expect(navbarValue("items", "projectSettingsTitle")).toBe(
      "Project Settings",
    );
  });

  it("maps every section of the side menu, in its order, with every page in it", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Find a setting"),
      "Section",
    );

    expect(
      rows.map((row: Array<string>): MenuSection => {
        return {
          title: boldNames(row[0] as string)[0] as string,
          items: boldNames(row[1] as string),
        };
      }),
    ).toEqual(drawnProjectSettingsSections());
  });

  it("says only Basic starts open", () => {
    const folded: Array<string> = drawnProjectSettingsSections()
      .filter((menuSection: MenuSection): boolean => {
        return startsCollapsed(sideMenu, menuSection.title);
      })
      .map((menuSection: MenuSection): string => {
        return menuSection.title;
      });

    expect(
      drawnProjectSettingsSections()
        .map((menuSection: MenuSection): string => {
          return menuSection.title;
        })
        .filter((title: string): boolean => {
          return !folded.includes(title);
        }),
    ).toEqual(["Basic"]);
    expect(page).toContain("only **Basic** starts open");
  });

  it("says Billing and Invoices and AI Credits are on OneUptime Cloud only", () => {
    const aiCredits: string = between(
      sideMenu,
      "...(BILLING_ENABLED",
      'title: "AI Credits"',
    );

    expect(aiCredits).toContain("?");
    expect(sideMenu).toContain("if (BILLING_ENABLED) {");
    expect(between(sideMenu, "if (BILLING_ENABLED) {", "});")).toContain(
      'title: "Billing and Invoices"',
    );
    expect(page).toContain(
      "**Billing and Invoices** and **AI Credits** are on OneUptime Cloud only",
    );
  });

  it("names the project's details as the Project page draws them, and who may rename it", () => {
    const projectPage: string = readDashboardSource(
      "Pages/Settings/ProjectSettings.tsx",
    );

    expect(projectPage).toContain('title: "Project Details"');
    expect(projectPage).toContain('title: "Project ID"');
    expect(projectPage).toContain('title: "Data Residency"');
    expect(
      capturedNumber(
        between(projectPage, 'title: "Project Name"', "onSaveSuccess"),
        MIN_LENGTH,
      ),
    ).toBe(2);
    // The card's edit button: "Edit {{itemName}}" with the model's name.
    expect(new Project().singularName).toBe("Project");
    expect(page).toContain("click **Edit Project** to rename the project");
    expect(page).toContain("A name has at least 2 characters.");

    expect(
      sorted(new Project().getColumnAccessControlFor("name")?.update || []),
    ).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.EditProject,
        Permission.ManageProjectBilling,
      ]),
    );
    expect(page).toContain(
      "Renaming takes a Project Owner, or permission to edit the project or to manage billing.",
    );

    // Set by OneUptime only, and shown only where it is set on the Cloud.
    expect(readCommonSource("Utils/Project/DataResidency.ts")).toContain(
      "return data.isBillingEnabled && DataResidencyUtil.isSet(data.dataResidency);",
    );
  });

  it("names Customer Support Access as its card draws it, and who may flip it", () => {
    const copy: string = readDashboardSource(
      "Components/Project/CustomerSupportAccessSwitchCopy.ts",
    );

    expect(copy).toContain(
      'cardTitle: translationKey("Customer Support Access")',
    );
    expect(copy).toContain(
      'switchTitle: translationKey("Let OneUptime support access this project")',
    );
    expect(copy).toContain(
      'allowConfirmButton: translationKey("Let support in")',
    );
    expect(
      sorted(
        new Project().getColumnAccessControlFor(
          "letCustomerSupportAccessProject",
        )?.update || [],
      ),
    ).toEqual(sorted([Permission.ProjectOwner, Permission.ProjectAdmin]));
    expect(readDashboardSource("Pages/Settings/ProjectSettings.tsx")).toContain(
      "{BILLING_ENABLED && (\n        <CustomerSupportAccessCard",
    );
    expect(page).toContain(
      "Turn on **Let OneUptime support access this project** when you want their help",
    );
    expect(page).toContain("Project Owners and Project Admins change it.");
  });

  it("names the label form's fields, and the plan labels need", () => {
    const labels: string = readDashboardSource("Pages/Settings/Labels.tsx");

    expect(labels).toContain('title: "Name"');
    expect(labels).toContain('title: "Description"');
    expect(labels).toContain('title: "Label Color"');
    expect(new Label().singularName).toBe("Label");
    expect(new Label().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(new Label().getUpdateBillingPlan()).toBe(PlanType.Growth);

    const steps: string = section(page, "## Labels");

    expect(boldNames(steps)).toEqual(
      expect.arrayContaining([
        "Create Label",
        "Name",
        "Description",
        "Label Color",
      ]),
    );
    expect(steps).toContain(
      "On OneUptime Cloud, creating and changing labels needs the Growth plan.",
    );
  });

  /*
   * OneUptime issues #5187 and #5183: a list shows a record's labels one
   * under another (Common/UI/Components/Label/Labels draws them through
   * TableColumnListComponent, which shows three and folds the rest, never
   * just one), and labels read in natural order everywhere
   * (Common/Utils/LabelOrder).
   */
  it("says how a list shows a record's labels, and the order labels read in", () => {
    const steps: string = section(page, "## Labels");

    expect(steps).toContain(
      "In a list, a record's labels are shown one under another; when there are more than four, the first three are shown with a link to the rest.",
    );
    expect(readCommonSource("UI/Components/Label/Labels.tsx")).toContain(
      "<TableColumnListComponent<LabelModel>",
    );
    expect(TABLE_COLUMN_LIST_VISIBLE_COUNT).toBe(3);
    expect(getTableColumnListVisibleCount(4)).toBe(4);
    expect(getTableColumnListVisibleCount(5)).toBe(3);

    // The page's examples, in the order it says they read in.
    expect(steps).toContain("(`2. Team` before `10. Owner`)");
    expect(sortLabelNames(["10. Owner", "2. Team"])).toEqual([
      "2. Team",
      "10. Owner",
    ]);
    expect(steps).toContain("such as `1. Category` and `2. Subcategory`.");
    expect(
      sortLabelNames(["2. Subcategory", "Production", "1. Category"]),
    ).toEqual(["1. Category", "2. Subcategory", "Production"]);

    // "then the others alphabetically, whatever their case".
    expect(steps).toContain(
      "then the others alphabetically, whatever their case",
    );
    expect(compareNaturally("apple", "Banana")).toBeLessThan(0);
    expect(compareNaturally("Banana", "cherry")).toBeLessThan(0);
  });

  it("names the notification channels, who switches them, and that they start off", () => {
    expect(sorted(PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS)).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.BillingAdmin,
        Permission.ManageProjectBilling,
      ]),
    );

    for (const column of Object.values(
      PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
    )) {
      expect({
        column,
        default: new Project().getTableColumnMetadata(column).defaultValue,
      }).toEqual({ column, default: false });
    }

    const notifications: string = section(page, "## Notifications");

    expect(notifications).toContain(
      "turns SMS, phone calls, WhatsApp and Telegram on or off for the project. All four start off. A Project Owner, a **Billing Admin** or someone with **Manage Billing** switches them.",
    );
    expect(
      readDashboardSource("Components/CustomSMTP/CustomSMTPTable.tsx"),
    ).toContain('title: "Custom SMTP Configs"');
  });

  it("names every tab of Notification Logs, in order", () => {
    const tabs: string = readDashboardSource(
      "Components/NotificationLogs/NotificationLogsTabs.tsx",
    );
    const names: Array<string> = Array.from(tabs.matchAll(TAB_NAME)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(names).toEqual([
      "Email",
      "SMS",
      "WhatsApp",
      "Telegram",
      "Webhook",
      "Call",
      "Push",
      "Workspace",
    ]);
    expect(section(page, "## Notifications")).toContain(
      "**Email**, **SMS**, **WhatsApp**, **Telegram**, **Webhook**, **Call**, **Push** and **Workspace**",
    );
  });

  it("names the one feature flag, off in a new project", () => {
    const copy: string = readDashboardSource(
      "Components/MonitorGroup/MonitorGroupsSwitchCopy.ts",
    );

    expect(copy).toContain('switchTitle: translationKey("Monitor Groups")');
    expect(copy).toContain("Turning this off deletes no group.");
    expect(
      new Project().getTableColumnMetadata("isFeatureFlagMonitorGroupsEnabled")
        .defaultValue,
    ).toBe(false);
    expect(section(page, "## Feature flags")).toContain(
      "Today it holds **Monitor Groups**, off in a new project",
    );
  });

  it("names how a project is deleted, who may, and that billing stops with it", () => {
    const dangerZone: string = readDashboardSource(
      "Pages/Settings/DangerZone.tsx",
    );

    expect(dangerZone).toContain("requireTypedName={true}");
    expect(dangerZone).toContain('title="Why are you deleting this project?"');
    expect(
      between(dangerZone, "confirmationContent={", "onDeleteSuccess"),
    ).toContain("BILLING_ENABLED ?");
    expect(
      readCommonSource(
        "UI/Components/DeleteConfirmation/TypeToConfirmDelete.tsx",
      ),
    ).toContain("return name.length > 0 && data.typed.trim() === name;");
    expect(sorted(new Project().getDeletePermissions())).toEqual(
      sorted([Permission.ProjectOwner, Permission.DeleteProject]),
    );

    const projects: string = readCommonSource(
      "Server/Services/ProjectService.ts",
    );

    expect(projects).toContain(
      "await BillingService.cancelSubscription(\n            project.paymentProviderSubscriptionId,",
    );

    const deleting: string = section(page, "## Delete the project");

    expect(boldNames(deleting)).toEqual(
      expect.arrayContaining(["Delete Project"]),
    );
    expect(deleting).toContain(
      "It takes a Project Owner, or permission to delete the project.",
    );
    expect(deleting).toContain("billing stops when the project is deleted");
  });
});

describe("Billing & Usage", () => {
  const page: string = english(BILLING);
  const billingPage: string = readDashboardSource("Pages/Settings/Billing.tsx");

  it("states the pay-as-you-go prices as OneUptime bills them", () => {
    const priced: Array<Array<string>> = tableRows(
      section(page, "## What a project pays for"),
      "What",
    );
    const rowOf: (what: string) => string = (what: string): string => {
      const row: Array<string> | undefined = priced.find(
        (candidate: Array<string>): boolean => {
          return candidate[0] === what;
        },
      );

      expect({ what, priced: Boolean(row) }).toEqual({ what, priced: true });

      return (row as Array<string>)[1] as string;
    };

    expect(rowOf("Telemetry")).toContain(
      `${formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB)} per GB ingested, with ${TELEMETRY_PRICE_RETENTION_IN_DAYS} days of retention.`,
    );
    expect(rowOf("Telemetry")).toContain(
      `retention under ${TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS} days is billed as ${TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS} days`,
    );
    expect(rowOf("Session replays")).toContain(
      `${formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB)} per GB, with ${TELEMETRY_PRICE_RETENTION_IN_DAYS} days of retention.`,
    );
    // Session replays are billed for the days they are kept, with no minimum.
    expect(rowOf("Session replays")).not.toContain("billed as");
    expect(rowOf("Active monitors")).toContain(
      `${formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} per monitor per month.`,
    );
  });

  it("counts every monitor but a Manual one as active, even while it is turned off", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect({
        monitorType,
        billed: MonitorTypeHelper.isBilledAsActiveMonitor(monitorType),
      }).toEqual({ monitorType, billed: monitorType !== MonitorType.Manual });
    }

    const limit: string = readCommonSource(
      "Server/Utils/Billing/ActiveMonitorLimit.ts",
    );
    const count: string = between(
      limit,
      "COUNT_STATEMENT: string =",
      "WRITE_COUNT_STATEMENT",
    );

    expect(count).toContain('"monitorType" <> $2');
    expect(count).toContain('"deletedAt" IS NULL');
    expect(count).not.toContain("disable");
    expect(page).toContain(
      "Every monitor but a Manual one is active, even while it is turned off.",
    );
  });

  it("names the Current Plan card, Seats and Change Plan as the Billing page draws them", () => {
    expect(billingPage).toContain('title: "Current Plan"');
    expect(billingPage).toContain('editButtonText={"Change Plan"}');
    expect(billingPage).toContain('title: "Seats"');
    expect(billingPage).toContain('title="Yearly Plan"');
    // What yearly saves is worked out from the prices, never written in.
    expect(billingPage).toContain(
      "description={yearlySavingText || undefined}",
    );
    expect(billingPage).not.toContain('description="(Save 20%)"');
    // Yearly starts on, unless a marketplace bills the project.
    expect(billingPage).toContain(
      "const [isSubscriptionPlanYearly, setIsSubscriptionPlanYearly] =\n    useState<boolean>(true);",
    );
    expect(billingPage).toContain("title={`Add a Payment Method`}");

    const plan: string = section(page, "## Change the plan");

    for (const label of [
      "Change Plan",
      "Add a Payment Method",
      "Current Plan",
      "Yearly Plan",
      "Your free trial carries over",
      "Changing plan does not start a free trial",
      "Not included in this plan",
    ]) {
      expect(boldNames(plan)).toContain(label);
    }

    const copy: string = readDashboardSource(
      "Components/Billing/ChangePlanBilling.ts",
    );

    expect(copy).toContain(
      'noTrialTitle: translationKey("Changing plan does not start a free trial")',
    );
    expect(copy).toContain(
      'trialTitle: translationKey("Your free trial carries over")',
    );
    expect(copy).toContain(
      "A paid plan is billed from the moment you change to it, and every user you invite on it is billed when you invite them.",
    );
    expect(plan).toContain(
      "Click **Save Changes**. A paid plan is billed from the moment you change to it, and every person you invite on it is billed when you invite them.",
    );
    expect(
      readCommonSource("UI/Components/ModelDetail/CardModelDetail.tsx"),
    ).toContain("submitButtonText={`Save Changes`}");
    expect(readDashboardSource("Components/Billing/PlanCutoff.ts")).toContain(
      'stoppedNoteTitle: translationKey("Not included in this plan")',
    );
  });

  it("counts a person as a seat from the moment they are invited", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const count: string = between(
      service,
      "public async getUniqueTeamMemberCountInProject(",
      "return [...new Set(memberIds)].length;",
    );

    // Every membership counts, an invitation not accepted yet included.
    expect(count).not.toContain("hasAcceptedInvitation");
    expect(
      between(
        service,
        "protected override async onCreateSuccess(",
        "protected override async onUpdateSuccess(",
      ),
    ).toContain("syncSubscriptionSeatsAfterMembershipChange");
    expect(section(page, "## Your plan and seats")).toContain(
      "A person counts as a seat from the moment you invite them, before they accept, until you remove them.",
    );
  });

  it("names the plans API keys and SCIM connections need, as the plan cut-off reads them", () => {
    expect(new ApiKey().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(new ProjectSCIM().getCreateBillingPlan()).toBe(PlanType.Scale);

    // A plan at or above the one they need keeps them working: Scale and Enterprise too.
    const cutoff: string = readDashboardSource(
      "Components/Billing/PlanCutoff.ts",
    );

    expect(cutoff).toContain("return isPlanAtLeast(");
    expect(cutoff).toContain("new ApiKey().getCreateBillingPlan()");
    expect(cutoff).toContain("new ProjectSCIM().getCreateBillingPlan()");
    expect(section(page, "## Change the plan")).toContain(
      "API keys need the Growth plan or a higher one, and below the Scale plan SCIM connections only remove people.",
    );
  });

  it("names the payment method card, its buttons, and the one method a project keeps", () => {
    expect(billingPage).toContain('title: "Payment Methods"');
    expect(billingPage).toContain('title: "Add Payment Method"');
    expect(billingPage).toContain("submitButtonText={`Save payment method`}");
    expect(billingPage).toContain('title: "Set as Default"');
    expect(billingPage).toContain('title: "Re-sync Autopay"');
    expect(billingPage).toContain(
      "A payment method you add becomes the default. Adding a payment method enables paid usage. It does not upgrade your subscription plan.",
    );

    /*
     * The one payment method a project keeps is Stripe's rule, in OneUptime
     * Cloud's billing (ee/Server/Billing). Core CI runs without ee/: the
     * page is held to it wherever ee/ is present.
     */
    if (fs.existsSync(EE_DIR)) {
      const stripeBilling: string = fs.readFileSync(
        path.join(EE_DIR, "Server", "Billing", "StripeBillingProvider.ts"),
        "utf8",
      );

      expect(
        between(
          stripeBilling,
          "public async deletePaymentMethod(",
          "Errors.BillingService.MIN_REQUIRED_PAYMENT_METHOD_NOT_MET",
        ),
      ).toContain("if (paymentMethods.length === 1) {");
    }

    const methods: string = section(page, "## Payment methods");

    for (const label of [
      "Payment Methods",
      "Add Payment Method",
      "Save payment method",
      "Set as Default",
      "Re-sync Autopay",
    ]) {
      expect(boldNames(methods)).toContain(label);
    }

    expect(methods).toContain(
      "The project keeps at least one payment method: add another before you delete the last one.",
    );
  });

  it("names the billing address card's steps and fields, in order", () => {
    const card: string = between(
      billingPage,
      'name="Business Details"',
      "modelDetailProps",
    );
    const fields: string = between(card, "formFields={[", "]}");

    expect(card).toContain('editButtonText={"Update"}');
    expect(card).toContain(
      '{ title: "Billing Address", id: "billing-address" }',
    );
    expect(card).toContain('{ title: "Invoices", id: "invoices" }');

    const rows: Array<Array<string>> = tableRows(
      section(page, "## Billing address and invoice email"),
      "Step",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [...boldNames(row[0] as string), ...boldNames(row[1] as string)];
      }),
    ).toEqual([
      ["Billing Address", "Business Details / Billing Address", "Country"],
      ["Invoices", "Finance / Accounting Email", "Send Invoices by Email"],
    ]);

    // Each field is on the step the page puts it on.
    for (const [title, stepId] of [
      ["Business Details / Billing Address", "billing-address"],
      ["Country", "billing-address"],
      ["Finance / Accounting Email", "invoices"],
      ["Send Invoices by Email", "invoices"],
    ] as Array<[string, string]>) {
      expect(between(fields, `title: "${title}",`, "required")).toContain(
        `stepId: "${stepId}"`,
      );
    }
  });

  it("names the invoices' columns and actions, and the bank's processing time", () => {
    const invoices: string = readDashboardSource("Pages/Settings/Invoices.tsx");

    for (const title of [
      'title: "Invoice Number"',
      'title: "Invoice Date"',
      'title: "Amount"',
      'title: "Invoice Status"',
      'title: "Download"',
      'title: "Pay Invoice"',
    ]) {
      expect(invoices).toContain(title);
    }

    // Pay Invoice is the row's button: Download waits in its menu.
    expect(between(invoices, 'title: "Pay Invoice"', "onClick")).toContain(
      "placement: ActionButtonPlacement.Primary",
    );
    expect(capturedNumber(invoices, UP_TO_DAYS)).toBe(2);
    expect(section(page, "## Invoices")).toContain(
      "some banks take up to 2 days to confirm a card payment",
    );
  });

  it("names Usage History's columns as the table draws them", () => {
    const usage: string = readDashboardSource(
      "Pages/Settings/UsageHistory.tsx",
    );
    const columns: string = between(usage, "columns={[", "]}");
    const drawn: Array<string> = [
      ...new Set(
        Array.from(columns.matchAll(TITLE_PROPERTY)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ),
    ];

    expect(drawn).toEqual([
      "Product",
      "Day",
      "Service",
      "Data Ingested (in GB)",
      "Data Retention (in Days)",
      "Total Cost",
    ]);
    // Each column once: Data Ingested used to be drawn twice.
    expect(Array.from(columns.matchAll(TITLE_PROPERTY)).length).toBe(
      drawn.length,
    );
    expect(usage).toContain('title: "Telemetry Usage History"');
    expect(usage).toContain("Each day's usage shows up after the day ends.");

    const rows: Array<string> = tableRows(
      section(page, "## Usage history"),
      "Column",
    ).map((row: Array<string>): string => {
      return (boldNames(row[0] as string)[0] as string) || "";
    });

    expect([...rows].sort()).toEqual([...drawn].sort());
  });

  it("names the balances' recharge, its bounds and Auto Recharge's defaults", () => {
    for (const api of [
      "Server/API/NotificationAPI.ts",
      "Server/API/AIBillingAPI.ts",
    ]) {
      const source: string = readCommonSource(api);

      expect({ api, above: capturedNumber(source, AMOUNT_ABOVE) }).toEqual({
        api,
        above: 1000,
      });
      expect({ api, below: capturedNumber(source, AMOUNT_BELOW) }).toEqual({
        api,
        below: 20,
      });
    }

    const settings: string = readDashboardSource(
      "Pages/Settings/NotificationSettings.tsx",
    );
    const dialog: string = between(
      settings,
      'title={"Recharge Balance"}',
      "/>",
    );

    expect(dialog).toContain('submitButtonText={"Recharge"}');
    expect(capturedNumber(dialog, MIN_VALUE)).toBe(20);
    expect(capturedNumber(dialog, MAX_VALUE)).toBe(1000);
    expect(
      readDashboardSource("Components/ProjectBalance/ProjectBalanceAccess.ts"),
    ).toContain('title: "Recharge Balance"');
    /*
     * Both balances draw one Auto Recharge card (Components/ProjectBalance/
     * AutoRechargeCard), its switch named as the guide names it.
     */
    const autoRecharge: string = readDashboardSource(
      "Components/ProjectBalance/AutoRechargeCard.tsx",
    );

    expect(settings).toContain("<AutoRechargeCard");
    expect(readDashboardSource("Pages/Settings/AICredits.tsx")).toContain(
      "<AutoRechargeCard",
    );
    expect(autoRecharge).toContain('editButtonText="Edit Auto Recharge"');
    expect(autoRecharge).toContain('title: "Enable Auto Recharge"');

    const project: Project = new Project();

    for (const balance of [
      ProjectBalanceType.SmsOrCall,
      ProjectBalanceType.AI,
    ]) {
      const [enable, by, when] = PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[
        balance
      ] as Array<string>;

      expect({
        balance,
        enabled: project.getTableColumnMetadata(enable as string).defaultValue,
        by: project.getTableColumnMetadata(by as string).defaultValue,
        when: project.getTableColumnMetadata(when as string).defaultValue,
      }).toEqual({ balance, enabled: false, by: 20, when: 10 });
    }

    const balances: string = section(page, "## Prepaid balances");

    expect(balances).toContain("Enter an amount from $20 to $1,000");
    expect(balances).toContain("It starts off.");
    expect(balances).toContain(
      "OneUptime adds $20 whenever the balance falls to $10",
    );
  });

  it("holds each row of Who can do what to the permissions the server checks", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Who can do what"),
      "To",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([...BILLING_ACCESS_ROWS]);

    const changePlan: string = between(
      readCommonSource("Server/API/ProjectAPI.ts"),
      "/:id/change-plan`",
      "await ProjectService.changePlan(",
    );

    expect(changePlan).toContain(
      "[Permission.ProjectOwner, Permission.ManageProjectBilling],",
    );

    const expected: Array<ReadonlyArray<Permission>> = [
      PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS,
      PROJECT_INVOICE_DOWNLOAD_PERMISSIONS,
      PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS,
      PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
      PAYMENT_METHOD_ADD_PERMISSIONS,
      PROJECT_INVOICE_PAY_PERMISSIONS,
      PROJECT_BALANCE_RECHARGE_PERMISSIONS,
    ];

    rows.forEach((row: Array<string>, index: number): void => {
      expect({
        row: row[0],
        permissions: permissionsInCell(row[1] as string),
      }).toEqual({
        row: row[0],
        permissions: sorted(expected[index] as ReadonlyArray<Permission>),
      });
    });

    /*
     * Reading every billing page: the narrowest read list is in each of
     * them. Every person in the project reads its payment methods (Project
     * User), so a person with any of them reads those too.
     */
    for (const readers of [
      PROJECT_INVOICE_READ_PERMISSIONS,
      PROJECT_USAGE_READ_PERMISSIONS,
    ]) {
      for (const permission of PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS) {
        expect(readers).toContain(permission);
      }
    }

    expect(new BillingPaymentMethod().getReadPermissions()).toContain(
      Permission.ProjectUser,
    );

    // Auto Recharge takes what a recharge takes.
    for (const columns of Object.values(
      PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
    )) {
      for (const column of columns) {
        expect({
          column,
          update: sorted(
            new Project().getColumnAccessControlFor(column)?.update || [],
          ),
        }).toEqual({
          column,
          update: sorted(PROJECT_BALANCE_RECHARGE_PERMISSIONS),
        });
      }
    }
  });

  it("names the plan each administration setting needs, as the models sell them", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Settings that need a plan"),
      "Setting",
    );
    const planOf: Record<string, Array<PlanType | null | undefined>> = {
      Labels: [new Label().getCreateBillingPlan()],
      "API keys": [new ApiKey().getCreateBillingPlan()],
      "Your own SMTP servers and Twilio accounts": [
        new ProjectSmtpConfig().getCreateBillingPlan(),
        new ProjectCallSMSConfig().getCreateBillingPlan(),
      ],
      "Your own LLM providers": [new LlmProvider().getCreateBillingPlan()],
      "Connecting MCP clients": [new McpOAuthGrant().getCreateBillingPlan()],
      "Creating teams": [new Team().getCreateBillingPlan()],
      "SSO, OIDC and SCIM": [
        new ProjectSso().getCreateBillingPlan(),
        new ProjectOidc().getCreateBillingPlan(),
        new ProjectSCIM().getCreateBillingPlan(),
      ],
      "Retention overrides": [
        new Project().getColumnBillingAccessControl("telemetryRetentionConfig")
          ?.update,
      ],
      "Audit logs": [
        new AuditLog().getReadBillingPlan(),
        new Project().getColumnBillingAccessControl("enableAuditLogs")?.update,
      ],
    };

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(Object.keys(planOf));

    for (const row of rows) {
      for (const plan of planOf[row[0] as string] as Array<
        PlanType | null | undefined
      >) {
        expect({ setting: row[0], plan }).toEqual({
          setting: row[0],
          plan: row[1],
        });
      }
    }
  });

  it("names the marketplaces as the Billing page does", () => {
    const note: string = section(page, "## Change the plan");

    for (const marketplace of CloudMarketplaceUtil.getAll()) {
      expect(note).toContain(
        CloudMarketplaceUtil.getDisplayName(marketplace as CloudMarketplace),
      );
    }
  });

  it("quotes the server's refusal for paid usage without a payment method", () => {
    const quoted: string = PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE.split(
      ". ",
    )[0]?.trim() as string;

    expect(page).toContain(`:::details "${quoted}"`);
    expect(PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE).toContain(
      "Manual monitors remain free.",
    );
    expect(page).toContain("Manual monitors stay free.");
  });

  it("says what the unpaid invoices banner says", () => {
    const masterPage: string = readDashboardSource(
      "Components/MasterPage/MasterPage.tsx",
    );

    expect(masterPage).toContain(
      '"Your project is not active because some invoices are unpaid. If left unpaid, your project will be deleted."',
    );
    expect(section(page, "## Troubleshooting")).toContain(
      "A project with unpaid invoices becomes inactive, and is deleted if they stay unpaid.",
    );
  });

  it("sends a plan's cancellation to the Danger Zone, as the Billing page does", () => {
    const cancel: string = between(
      billingPage,
      "If you would like to cancel the plan, you need to delete the project.",
      "/>",
    );

    expect(cancel).toContain(
      "If you would like to cancel the plan, you need to delete the project.",
    );
    expect(cancel).toContain("PageMap.SETTINGS_DANGERZONE");
    expect(section(page, "## Cancel the plan")).toContain(
      "(/docs/configuration/project-settings#delete-the-project)",
    );
  });

  it("states every dollar amount the page names, and only those", () => {
    const amounts: Array<string> = Array.from(page.matchAll(DOLLARS)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    // The prices, the recharge bounds and Auto Recharge's defaults.
    expect([...new Set(amounts)].sort()).toEqual(
      [
        formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB),
        formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB),
        formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH),
        "$20",
        "$1,000",
        "$10",
      ]
        .map((amount: string): string => {
          return amount.slice(1);
        })
        .sort(),
    );
  });
});

describe("Audit Logs", () => {
  const page: string = english(AUDIT_LOGS);

  it("names the plan audit logs are sold on", () => {
    const auditLog: AuditLog = new AuditLog();

    expect(auditLog.getReadBillingPlan()).toBe(PlanType.Enterprise);
    expect(auditLog.getCreateBillingPlan()).toBe(PlanType.Enterprise);

    for (const column of [
      "enableAuditLogs",
      "auditLogsRetentionInDays",
      "storeSystemEventsInAuditLogs",
    ]) {
      expect({
        column,
        plan: new Project().getColumnBillingAccessControl(column)?.update,
      }).toEqual({ column, plan: PlanType.Enterprise });
    }

    expect(
      readDashboardSource("Enterprise/EnterpriseEligibility.ts"),
    ).toContain(
      "export const AUDIT_LOGS_REQUIRED_PLAN: EnterpriseRequiredPlan =\n  PlanType.Enterprise;",
    );
    expect(page).toContain("**On OneUptime Cloud, the Enterprise plan.**");
  });

  it("names who reads the audit log, and who changes its settings", () => {
    expect(sorted(new AuditLog().getReadPermissions())).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.SettingsAdmin,
        Permission.ReadAuditLog,
      ]),
    );
    expect(PermissionHelper.getTitle(Permission.SettingsAdmin)).toBe(
      "Settings Admin",
    );
    expect(PermissionHelper.getTitle(Permission.ReadAuditLog)).toBe(
      "Read Audit Log",
    );
    expect(page).toContain(
      "Project Owner, Project Admin, Settings Admin, or the **Read Audit Log** permission.",
    );

    for (const column of [
      "enableAuditLogs",
      "auditLogsRetentionInDays",
      "storeSystemEventsInAuditLogs",
    ]) {
      expect({
        column,
        update: sorted(
          new Project().getColumnAccessControlFor(column)?.update || [],
        ),
      }).toEqual({
        column,
        update: sorted([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditProject,
        ]),
      });
    }

    expect(page).toContain(
      "takes a Project Owner, a Project Admin, or permission to edit the project.",
    );
  });

  it("states the settings' defaults as a new project has them", () => {
    const project: Project = new Project();
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Turn on audit logging"),
      "Setting",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual([
      ["**Enable Audit Logs**", "Off"],
      ["**Retention (days)**", "7"],
      ["**Store System Events**", "Off"],
    ]);
    expect(project.getTableColumnMetadata("enableAuditLogs").defaultValue).toBe(
      false,
    );
    expect(
      project.getTableColumnMetadata("auditLogsRetentionInDays").defaultValue,
    ).toBe(7);
    expect(
      project.getTableColumnMetadata("storeSystemEventsInAuditLogs")
        .defaultValue,
    ).toBe(false);
  });

  it("lists every record the audit log covers, by the resource type it files it under", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## What is recorded"),
      "Resource",
    );
    const documented: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return inlineCodes(row[1] as string);
      },
    );
    const audited: Array<string> = auditedModels().map(
      (model: BaseModel): string => {
        return model.singularName as string;
      },
    );

    expect([...documented].sort()).toEqual([...new Set(audited)].sort());
    expect(documented.length).toBe(new Set(documented).size);
  });

  it("says who is on a team, and a team's own permissions, are not recorded", () => {
    expect(isAudited(TeamMember)).toBe(false);
    expect(isAudited(TeamPermission)).toBe(false);
    expect(isAudited(Team)).toBe(true);
    expect(section(page, "## What is recorded")).toContain(
      "Other records are not in the audit log, such as who is on a team, or a permission added to a team on its own.",
    );
  });

  it("names the actions an entry can record, a download included", () => {
    expect(Object.values(AuditLogAction).sort()).toEqual(
      ["Create", "Update", "Delete", "Download"].sort(),
    );
    expect(readCommonSource("Server/API/PacketCaptureAPI.ts")).toContain(
      "AuditLogService.recordDownload({",
    );

    const actions: string = tableRows(
      section(page, "## Read the audit log"),
      "Column",
    ).find((row: Array<string>): boolean => {
      return row[0] === "**Action**";
    })?.[1] as string;

    expect(inlineCodes(actions)).toEqual([
      "Create",
      "Update",
      "Delete",
      "Download",
    ]);
  });

  it("says an administrator's changes to someone else's notification setup are recorded", () => {
    for (const service of [
      "Server/Services/UserNotificationMethodAdminService.ts",
      "Server/Services/UserNotificationRuleAdminService.ts",
    ]) {
      expect(readCommonSource(service)).toContain("await this.writeAuditLog(");
    }

    expect(section(page, "## What is recorded")).toContain(
      "An administrator adding or removing a notification method or a personal on-call rule on someone else's account is recorded too, without the address or number itself.",
    );
  });

  it("says the audit log can be read through the API, by the permission that reads it", () => {
    expect(new AuditLog().crudApiPath?.toString()).toBe("/audit-log");
    expect(readPackageFile("App/FeatureSet/BaseAPI/Index.ts")).toContain(
      "new BaseAnalyticsAPI<AuditLog, AuditLogServiceType>(",
    );
    expect(section(page, "## How long entries are kept")).toContain(
      "read them through the API with an API key that holds **Read Audit Log**",
    );
  });

  it("names the resources whose own pages list their entries", () => {
    for (const resourcePage of [
      "Pages/Monitor/View/AuditLogs.tsx",
      "Pages/Incidents/View/AuditLogs.tsx",
      "Pages/Alerts/View/AuditLogs.tsx",
      "Pages/StatusPages/View/AuditLogs.tsx",
      "Pages/Slo/View/AuditLogs.tsx",
    ]) {
      expect(readDashboardSource(resourcePage)).toContain("AuditLogsTable");
    }

    expect(section(page, "## Read the audit log")).toContain(
      "Monitors, incidents, alerts, status pages, SLOs and many other resources also have an **Audit Logs** page of their own",
    );
  });

  it("names the Enterprise Edition's audit log table, settings form and recorder as they are, where ee/ is checked out", () => {
    // Core CI runs without ee/: the page is held to it wherever ee/ is present.
    if (!fs.existsSync(EE_DIR)) {
      return;
    }

    const read: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(EE_DIR, relative), "utf8");
    };

    const settings: string = read("Dashboard/AuditLogs/AuditLogsSettings.tsx");

    expect(settings).toContain('editButtonText="Edit Audit Log Settings"');
    expect(settings).toContain('title: "Enable Audit Logs"');
    expect(settings).toContain('title: "Store System Events"');

    const retention: string = between(
      settings,
      'title: "Retention (days)"',
      "},\n          },",
    );

    expect(capturedNumber(retention, MIN_VALUE)).toBe(7);
    expect(capturedNumber(retention, MAX_VALUE)).toBe(180);

    const table: string = read("Dashboard/AuditLogs/AuditLogsTable.tsx");
    const columns: string = between(
      table,
      "columns={[",
      "/>\n\n      <AuditLogChangesModal",
    );

    for (const title of ["When", "Action", "Resource", "Actor", "Changes"]) {
      expect(columns).toContain(`title: "${title}"`);
    }

    const filters: string = between(table, "filters={[", "columns={[");

    expect(
      Array.from(filters.matchAll(TITLE_PROPERTY)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual([
      "Resource Type",
      "Resource Name",
      "Action",
      "User Email",
      "Time",
    ]);
    expect(section(page, "## Read the audit log")).toContain(
      "Filter by **Resource Type**, **Resource Name**, **Action**, **User Email** or **Time**.",
    );
    expect(table).toContain("sortOrder={SortOrder.Descending}");
    // A change OneUptime made by itself is drawn as System.
    expect(table).toContain(
      'const userType: string = item.userType || "System";',
    );

    const recorder: string = read("Server/AuditLog/AuditLogRecorder.ts");

    // Within a minute: the project's settings are read again each minute.
    expect(capturedNumber(recorder, CACHE_TTL)).toBe(60);
    expect(page).toContain(
      "A change to these settings applies within a minute.",
    );

    // Kept for the project's retention, at most 180 days, 7 unless set.
    const clamp: RegExpExecArray | null = RETENTION_CLAMP.exec(recorder);

    expect(clamp?.slice(1)).toEqual(["7", "180"]);

    // Recording on the Cloud: the Enterprise plan; self-hosted: the license.
    expect(recorder).toContain(
      "return settings.planName === PlanType.Enterprise;",
    );
    expect(recorder).toContain(
      "return EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);",
    );
    // System events only with Store System Events on.
    expect(recorder).toContain(
      "if (!settings.storeSystemEventsInAuditLogs && this.isSystemEvent(props)) {",
    );
    // Columns nobody may read are left out of every entry.
    expect(recorder).toContain(
      "if (ac && Array.isArray(ac.read) && ac.read.length === 0) {",
    );

    const notice: string = read(
      "Dashboard/AuditLogs/AuditLogsLicenseNotice.tsx",
    );

    expect(notice).toContain("Entries recorded so far are kept.");
    expect(notice).toContain("Recording resumes with the same settings");
  });
});

describe("every page", () => {
  const menu: SettingsMenu = projectSettingsMenu();

  it.each(ADMINISTRATION_PAGES)(
    "$page writes every Project Settings path down the side menu as it is drawn, naming the folded sections",
    (entry: AdministrationDocsPageEntry) => {
      const paths: Array<Array<string>> = boldPaths(english(entry.page)).filter(
        (segments: Array<string>): boolean => {
          return segments[0] === "Project Settings";
        },
      );

      for (const segments of paths) {
        const walked: Array<WrittenPath> = pathsThrough(
          segments.join(PATH_SEPARATOR),
          menu,
        );

        expect({ path: segments.join(PATH_SEPARATOR), walked }).toEqual({
          path: segments.join(PATH_SEPARATOR),
          walked: [
            expect.objectContaining({
              steps: segments.slice(1),
              problems: [],
            }),
          ],
        });
      }
    },
  );

  it.each(ADMINISTRATION_PAGES)(
    "$page names a Products menu path through the group the menu files it under",
    (entry: AdministrationDocsPageEntry) => {
      const itemKeys: Record<string, string> = {
        Users: "usersTitle",
        "Project Settings": "projectSettingsTitle",
      };

      for (const segments of boldPaths(english(entry.page)).filter(
        (candidate: Array<string>): boolean => {
          return candidate[0] === "Products";
        },
      )) {
        const item: string = segments[2] as string;

        expect({ segments, key: Boolean(itemKeys[item]) }).toEqual({
          segments,
          key: true,
        });
        expect(
          navbarValue(
            "categories",
            productsMenuCategory(itemKeys[item] as string),
          ),
        ).toBe(segments[1]);
      }
    },
  );

  it.each(ADMINISTRATION_PAGES)(
    "$page names permissions by their own titles",
    (entry: AdministrationDocsPageEntry) => {
      for (const title of PERMISSION_TITLES[entry.page] || []) {
        expect(PermissionHelper.getTitle(permissionNamed(title))).toBe(title);
      }
    },
  );

  it.each(ADMINISTRATION_PAGES)(
    "$page quotes each server message it lists in a Troubleshooting answer's summary, as the server sends it",
    (entry: AdministrationDocsPageEntry) => {
      const sent: Array<string> = [
        Errors.TeamMemberService.ALREADY_INVITED,
        Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
        PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
        // An invitation refused for its address (PublicMessageRateLimit).
        PublicMessageRateLimit.getTeamRefusalMessage({
          kind: TeamMessageKind.Invitation,
          channel: PublicMessageChannel.Email,
        }),
      ];

      for (const message of SERVER_MESSAGES[entry.page] || []) {
        expect(section(english(entry.page), "## Troubleshooting")).toContain(
          `:::details "${message}"`,
        );
        expect({
          message,
          sent: sent.some((sentMessage: string): boolean => {
            return sentMessage.startsWith(message);
          }),
        }).toEqual({ message, sent: true });
      }
    },
  );

  it("keeps in English only words no Dashboard locale has", () => {
    for (const words of Object.values(KEPT_AS_WRITTEN)) {
      for (const word of words) {
        expect({ word, key: DASHBOARD_ENGLISH[word] }).toEqual({
          word,
          key: undefined,
        });
      }
    }
  });
});
