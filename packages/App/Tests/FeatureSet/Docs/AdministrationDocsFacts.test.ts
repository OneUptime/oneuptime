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
import {
  DocsHeading,
  DocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
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
import { REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE } from "Common/Types/ServerSending/ServerSendingWords";
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
import { AUDIT_LOG_ACTION_LABELS } from "Common/Types/AuditLog/AuditLogActionLabel";
import {
  AUDIT_LOG_SESSION_RESOURCE_TYPE,
  SESSION_AUDIT_LOG_ACTIONS,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import {
  AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE,
  FAILED_SIGN_IN_WINDOW_IN_MINUTES,
  FAILED_SIGN_INS_RECORDED_PER_WINDOW,
} from "Common/Types/AuditLog/AuditLogSignInFailure";
import { AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE } from "Common/Types/AuditLog/AuditLogStatusPageSession";
import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  DEFAULT_SESSION_IDLE_DAYS,
  IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
} from "Common/Types/UserSession/SessionLength";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  AUDIT_LOG_EXEMPTION_KINDS,
  AUDIT_LOG_EXEMPT_TABLES,
  AuditLogExemptionKind,
} from "Common/Types/AuditLog/AuditLogCoverage";
import {
  AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
  AUDIT_LOG_RETENTION_ERROR,
  getAuditLogRetentionError,
} from "Common/Types/AuditLog/AuditLogRetention";
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
  PROJECT_CHANGE_PLAN_PERMISSIONS,
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
const UP_TO_DAYS: RegExp = /up to (\d+) days/;

function english(page: string): string {
  return readPage("en", page);
}

/*
 * Where a self-hosted server's email is set up: the SMTP page's Open the
 * form step, whose Self-hosted instance tab opens the Admin Dashboard's
 * email settings.
 */
const SMTP_PAGE: string = "emails/smtp";
const SMTP_FORM_LINK: string = "/docs/emails/smtp#open-the-form";

/*
 * What Inviting People says Invite does on a self-hosted server that cannot
 * send email yet (#6971): the last paragraph of the Send the invitation
 * step, and of the troubleshooting answer for an invitation email that did
 * not arrive. AdministrationDocsTranslations holds every language to them.
 */
const NO_EMAIL_STEP: string =
  "On a self-hosted server that cannot send email yet, no email goes out, and they show as **Invited**. A master admin sees **Send them their invitation link** first: copy the link, send it to them yourself, then click **Done**. Anyone else asks the server's admin to [set up email](/docs/emails/smtp#open-the-form). Email set up later does not send the invitations made before it: they get in with their invitation link, or by signing up with the address you invited.";
const NO_EMAIL_ANSWER: string =
  "On a self-hosted server that cannot send email yet, signing up cannot email them a new link either: it tells them to ask for their invitation link. Once the server's admin has [set up email](/docs/emails/smtp#open-the-form), signing up works as above. Until then, a master admin can send them a new link, which works once, only for that address, for 7 days: on **Users**, open the person's row menu, **⋯**, and click **Get Invitation Link**.";

/*
 * Where the answer for an invitation email that did not arrive says to see
 * whether it went out (#7169): the project's notification logs, and on a
 * self-hosted server the server's own email log (#6878).
 */
const EMAIL_PROVIDERS_PAGE: string = "emails/email-providers";
const EMAIL_LOG_LINK: string =
  "/docs/emails/email-providers#see-what-the-server-sent";
const WENT_OUT_ANSWER: string =
  "To see whether it went out, open the **Email** tab of the project's **Notification Logs**: each invitation's row says whether it was sent, and why not. On a self-hosted server, a master admin also finds every email the server failed to send in its [email log](/docs/emails/email-providers#see-what-the-server-sent).";

/*
 * What the answer for a person who shows Email Not Sent says (#9511): what
 * it means, where its reason comes from, and what to do, as the pill does.
 */
const EMAIL_NOT_SENT_ANSWER: string =
  "The mail service refused their latest invitation email, so nothing reached them. Point at **Email Not Sent**, or tap it, to see why, as the **Email** tab of the project's **Notification Logs** says it. Check the address you invited, then, once email works, open the person's row menu on **Users**, **⋯**, and click **Resend Invitation**: they show as **Invitation Sent** again once it goes out. On a self-hosted server, the server's admin can send them their invitation link instead: a master admin clicks **Get Invitation Link** in the same menu.";

/*
 * What Accept an invitation says of the sign-up page an invitation opens
 * (#7471), and of the link handed out where no email went (#7169).
 */
const SIGN_UP_JOINS: string =
  "**Create Your Account** opens the sign-up page with their address and the name you typed filled in, and says which project invited them and who. Signing up there joins the project, with nothing more to accept.";
const NO_EMAIL_ACCEPT: string =
  "On a self-hosted server that cannot send email yet, nobody is emailed: the invitation link they are sent instead opens the same sign-up page, or the sign-in page for someone who already has an account.";

// What Remove someone from the project says of a reader who reaches only some teams (#6599).
const REMOVAL_LOCK: string =
  "If your role removes people only from some teams, such as the ones you own, **Remove from Project** is locked for someone who is also in a team you can't remove them from, and names the teams that keep them in the project, the ones you may see. Removing several people at once leaves them out, and says so.";

const WHITESPACE_RUN: RegExp = /\s+/g;
const PARAGRAPH_BREAK: RegExp = /\n[ \t]*\n/;
const REGISTRATION_TOKEN_DAYS: RegExp =
  /REGISTRATION_TOKEN_EXPIRY_IN_DAYS: number = (\d+);/;

// Source with every run of whitespace made one space, so a match spans lines.
function collapsed(source: string): string {
  return source.replace(WHITESPACE_RUN, " ");
}

/*
 * The body of a :::steps step, under its "### <title>" heading, up to the
 * next step or the end of the steps (or of a block inside it). Empty when
 * the page has no such step, which every test that reads it then fails on.
 */
function stepText(markdown: string, title: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`### ${title}`);

  if (start === -1) {
    return "";
  }

  const rest: Array<string> = lines.slice(start + 1);
  const end: number = rest.findIndex((line: string): boolean => {
    return line === ":::" || line.startsWith("### ");
  });

  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

// The answer of a :::details block with this summary, or empty when there is none.
function detailsText(markdown: string, summary: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(`:::details ${summary}`);

  if (start === -1) {
    return "";
  }

  const rest: Array<string> = lines.slice(start + 1);

  return rest.slice(0, rest.indexOf(":::")).join("\n").trim();
}

// The paragraphs of a piece of markdown, in order.
function paragraphs(markdown: string): Array<string> {
  return markdown
    .split(PARAGRAPH_BREAK)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

// Every link a piece of markdown makes, in order.
function linkTargets(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return link.target;
  });
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

  it("names the invitation email's subjects and buttons, and says it names who invited them", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const inviter: string = readCommonSource(
      "Server/Utils/TeamMember/InvitationInviter.ts",
    );
    const template: string = readPackageFile(
      "App/FeatureSet/Notification/Templates/InviteMember.hbs",
    );

    // The subject says who invited them, or what it always said (#7471).
    expect(service).toContain("subject: InvitationInviterUtil.getSubject({");
    expect(inviter).toContain('"You have been invited to " + data.projectName');
    expect(inviter).toContain('"You have been added to " + data.projectName');
    expect(inviter).toContain("`${name} invited you to ${data.projectName}`");
    // The first line names them too.
    expect(template).toContain(
      '(concat inviterLabel " invited you to join " projectName " on " (brandName)',
    );
    expect(template).toContain('buttonText="Create Your Account"');
    expect(template).toContain('buttonText=(concat "Sign In to " (brandName))');
    expect(section(page, "## Accept an invitation")).toContain(
      "The invitation email names the project and who invited them. Its button is **Create Your Account** for someone who has no OneUptime account yet, and **Sign In to OneUptime** for someone who has one.",
    );
  });

  /*
   * The sign-up page an invitation opens (#7471): it fills in what the
   * invitation knows, says which project and who, and signing up there
   * joins - the server accepts that project's invitation once the token
   * has claimed the account. And where no email went (#7169), the link
   * handed out instead opens the same pages.
   */
  it("says the sign-up page an invitation opens names the project and who invited them, fills in the name, and joins", () => {
    const register: string = collapsed(
      readPackageFile("App/FeatureSet/Accounts/src/Pages/Register.tsx"),
    );
    const authentication: string = collapsed(
      readPackageFile("App/FeatureSet/Identity/API/Authentication.ts"),
    );
    const signUpInvitation: string = collapsed(
      readPackageFile("App/FeatureSet/Identity/Utils/SignUpInvitation.ts"),
    );
    const accept: Array<string> = paragraphs(
      section(page, "## Accept an invitation"),
    );

    // The page draws the invitation, fills in the name, and names the project in the sign-up.
    expect(register).toContain(
      "<InvitedSignUpHeader invitation={invitation} />",
    );
    expect(register).toContain(
      'return current["name"] ? current : { ...current, name: name };',
    );
    expect(register).toContain(
      "miscDataProps[SIGN_UP_INVITATION_PROJECT_KEY] = invitation.projectId;",
    );
    // The server accepts it once the token has claimed the account.
    expect(authentication).toContain(
      "await SignUpInvitationUtil.acceptForClaimedAccount({ userId: alreadySavedUser.id!, projectId: miscDataProps[SIGN_UP_INVITATION_PROJECT_KEY], });",
    );
    expect(signUpInvitation).toContain(
      "hasAcceptedInvitation: true, invitationAcceptedAt: OneUptimeDate.getCurrentDate(),",
    );

    expect(accept[1]).toBe(SIGN_UP_JOINS);
    expect(boldNames(SIGN_UP_JOINS)).toEqual(["Create Your Account"]);
  });

  it("says the link handed out where no email went opens the same sign-up page, or the sign-in page for an account", () => {
    const invitationLink: string = collapsed(
      readCommonSource("Server/Utils/InvitationLink.ts"),
    );
    const accept: Array<string> = paragraphs(
      section(page, "## Accept an invitation"),
    );

    // An account with a password is sent the sign-in page; one without, the sign-up link.
    expect(invitationLink).toContain(
      "if (user.password) { return { link: await InvitationLink.getSignInLink(),",
    );
    expect(invitationLink).toContain(
      "await UserRegistrationToken.generateRegistrationLink({ userId: user.id, email: user.email, });",
    );
    // The sign-up link is the one the email's Create Your Account carries.
    expect(
      collapsed(readCommonSource("Server/Services/TeamMemberService.ts")),
    ).toContain("await UserRegistrationToken.generateRegistrationLink({");

    expect(accept[2]).toBe(NO_EMAIL_ACCEPT);
    // Then the two places for everyone who signs in.
    expect(accept[3]).toBe(
      "Someone who signs in, or signs up another way, accepts in one of two places:",
    );
  });

  it("says email set up later sends no invitation made before it: an invitation is emailed when it is made", () => {
    const service: string = readCommonSource(
      "Server/Services/TeamMemberService.ts",
    );
    const onCreate: string = between(
      service,
      "protected override async onBeforeCreate(",
      "protected override async onBeforeUpdate(",
    );

    // The one InviteMember email, sent as the membership is made.
    expect(service.split("EmailTemplateType.InviteMember").length - 1).toBe(1);
    expect(onCreate).toContain("templateType: EmailTemplateType.InviteMember,");
    expect(NO_EMAIL_STEP).toContain(
      "Email set up later does not send the invitations made before it: they get in with their invitation link, or by signing up with the address you invited.",
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

    // Remove from Project's refusal, by its first sentence (#6599).
    const someTeamsOnly: string =
      "You can remove this person from only some of their teams, so you can't remove them from the project";

    expect(
      Errors.TeamMemberService.REMOVE_FROM_SOME_TEAMS_ONLY.startsWith(
        `${someTeamsOnly}.`,
      ),
    ).toBe(true);
    expect(refusals).toContain(`:::details "${someTeamsOnly}"`);
    expect(detailsText(page, `"${someTeamsOnly}"`)).toBe(
      "Your role removes people only from some of the project's teams, such as the ones you own, and this person is in others too. Remove them from your own teams on their **Teams** page, or ask a Project Owner or Project Admin to remove them from the project.",
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

  /*
   * A self-hosted server that cannot send email yet still creates every
   * invitation (#6825, #6877): nobody is emailed, the person shows as
   * Invited, and a master admin is handed the link the email would have
   * carried. The page says so where an inviter reads what Invite does - the
   * last step - and where they look when the email never came (#6971).
   */
  describe("on a self-hosted server that cannot send email yet", () => {
    const step: string = stepText(page, "Send the invitation");
    const answer: string = detailsText(
      page,
      "The invitation email did not arrive, or its link expired",
    );
    const invitationLink: string = collapsed(
      readCommonSource("UI/Components/InvitationLink/InvitationLinkModal.tsx"),
    );
    const serverEmail: string = collapsed(
      readDashboardSource("Utils/ServerEmail.ts"),
    );
    const usersPage: string = collapsed(users);
    const pendingPill: string = collapsed(
      readDashboardSource("Components/User/PendingInvitationPill.tsx"),
    );

    it("ends the Send the invitation step with what Invite does there, in a paragraph of its own", () => {
      expect(paragraphs(step)).toEqual([
        "Click **Invite**. OneUptime emails the invitation and opens the person's page. They show as **Invitation Sent** until they accept.",
        NO_EMAIL_STEP,
      ]);
      // The pill, the dialog's title and its button, as the Dashboard draws them.
      expect(boldNames(NO_EMAIL_STEP)).toEqual([
        "Invited",
        "Send them their invitation link",
        "Done",
      ]);
    });

    it("shows the person as Invited, the pill the Users list draws while the server cannot send email", () => {
      // The Users list draws a pending person's pill with PendingInvitationPill (#9511).
      expect(usersPage).toContain(
        "if (!item.hasAcceptedInvitation) { return ( <PendingInvitationPill serverEmail={serverEmail} notSent={invitationEmailsNotSent.getNotSent(item)} /> ); }",
      );
      expect(pendingPill).toContain(
        "if (cannotSendEmail(props.serverEmail)) { return ( <Pill text={SERVER_EMAIL_COPY.invitedPill} color={Yellow} dataTestId={PENDING_INVITATION_PILL_TEST_ID} /> ); }",
      );
      expect(pendingPill).toContain(
        'if (!props.notSent) { return ( <Pill text="Invitation Sent" color={Yellow} dataTestId={PENDING_INVITATION_PILL_TEST_ID} /> ); }',
      );
      expect(serverEmail).toContain(
        "invitedPill: INVITATION_LINK_COPY.invitedPill,",
      );
      expect(invitationLink).toContain(
        'invitedPill: translationKey("Invited"),',
      );
      // Only once the server is known not to send email: null while it is read.
      expect(serverEmail).toContain(
        "return serverEmail.canSendEmail === false;",
      );
      expect(NO_EMAIL_STEP).toContain(
        "On a self-hosted server that cannot send email yet, no email goes out, and they show as **Invited**.",
      );
    });

    it("hands a master admin the invitation link dialog after Invite, and opens the person's page on Done", () => {
      // After Invite: a master admin gets the dialog; anyone else the person's page.
      expect(usersPage).toContain(
        "if ( cannotSendEmail(serverEmail) && serverEmail.isMasterAdmin && teamMember.id ) { setInvitationLinkFor({ teamMemberId: teamMember.id, viewPageRoute: new Route(viewPageRoute), isEmailNotSent: false, }); } else { Navigation.navigate(new Route(viewPageRoute)); }",
      );
      // Done closes the dialog and goes on to the person's page.
      expect(usersPage).toContain(
        "const viewPageRoute: Route | null = invitationLinkFor.viewPageRoute; setInvitationLinkFor(null); if (viewPageRoute) { Navigation.navigate(viewPageRoute); }",
      );

      // The dialog: its title, the link with its copy button, and Done.
      expect(invitationLink).toContain(
        'title: translationKey("Send them their invitation link"),',
      );
      expect(invitationLink).toContain('done: translationKey("Done"),');
      expect(invitationLink).toContain("title={INVITATION_LINK_COPY.title}");
      expect(invitationLink).toContain(
        "submitButtonText={INVITATION_LINK_COPY.done}",
      );
      expect(invitationLink).toContain(
        "<CopyTextButton textToBeCopied={invitation.link}",
      );
      expect(invitationLink).toContain("Copy this link and send it yourself.");

      expect(NO_EMAIL_STEP).toContain(
        "A master admin sees **Send them their invitation link** first: copy the link, send it to them yourself, then click **Done**.",
      );
    });

    it("sends anyone else to the server's admin, as the invite dialog's Email field does", () => {
      expect(usersPage).toContain(
        'description: cannotSendEmail(serverEmail) ? serverEmail.isMasterAdmin ? SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin : SERVER_EMAIL_COPY.inviteEmailDescription : "We email them an invitation to the team you pick.",',
      );
      expect(serverEmail).toContain(
        "inviteEmailDescription: translationKey( \"This server cannot send email yet, so they get no invitation email. The invitation is still created: ask your server's admin to set up email.",
      );
      expect(NO_EMAIL_STEP).toContain(
        `Anyone else asks the server's admin to [set up email](${SMTP_FORM_LINK}).`,
      );
    });

    it("links where a self-hosted server's email is set up: the SMTP page's Open the form step, on its Self-hosted instance tab", () => {
      expect(linkTargets(NO_EMAIL_STEP)).toEqual([SMTP_FORM_LINK]);
      expect(linkTargets(NO_EMAIL_ANSWER)).toEqual([SMTP_FORM_LINK]);

      const smtp: string = english(SMTP_PAGE);
      const formStep: DocsHeading | undefined = scanMarkdown(
        smtp,
      ).headings.find((heading: DocsHeading): boolean => {
        return heading.text === "Open the form";
      });

      expect(`/docs/${SMTP_PAGE}#${formStep?.slug}`).toBe(SMTP_FORM_LINK);

      const form: string = stepText(smtp, "Open the form");
      const selfHosted: string = form.slice(
        form.indexOf("@tab Self-hosted instance\n"),
      );

      expect(form).toContain("@tab Self-hosted instance\n");
      expect(selfHosted).toContain(
        "In the Admin Dashboard, open **Settings**, then **Notifications > Emails** in the side menu",
      );
    });

    it("ends the troubleshooting answer for a missing invitation email with what happens without email, in a paragraph of its own", () => {
      expect(paragraphs(answer)).toEqual([
        "The invitation does not depend on the email. Ask them to sign up with the address you invited: OneUptime emails that address a new link to finish creating the account. Someone who already has an account signs in and finds the invitation waiting.",
        WENT_OUT_ANSWER,
        NO_EMAIL_ANSWER,
      ]);
      // The list, its row menu and the action, as the Dashboard draws them.
      expect(boldNames(NO_EMAIL_ANSWER)).toEqual([
        "Users",
        "⋯",
        "Get Invitation Link",
      ]);
    });

    it("says signing up cannot email a new link there, and tells them to ask for their invitation link", () => {
      const authentication: string = collapsed(
        readPackageFile("App/FeatureSet/Identity/API/Authentication.ts"),
      );
      const refusal: number = authentication.indexOf(
        "if (await ServerSendingStatus.isEmailKnownNotSetUp()) { return Response.sendErrorResponse( req, res, new BadDataException(REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE), ); }",
      );

      // Refused before the new link would be emailed.
      expect(refusal).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(
        authentication.indexOf(
          "AuthenticationEmail.sendCompleteRegistrationEmail({",
        ),
      );
      expect(REGISTRATION_LINK_CANNOT_BE_EMAILED_MESSAGE).toContain(
        "so it cannot email you a link to finish signing up. Ask the person who invited you for your invitation link",
      );
      expect(NO_EMAIL_ANSWER).toContain(
        "On a self-hosted server that cannot send email yet, signing up cannot email them a new link either: it tells them to ask for their invitation link.",
      );
      expect(NO_EMAIL_ANSWER).toContain(
        `Once the server's admin has [set up email](${SMTP_FORM_LINK}), signing up works as above.`,
      );
    });

    /*
     * A pending person invited by somebody else, or whose link ran out, has
     * their link one click away for a master admin (#7168): it was only ever
     * shown after the master admin's own Invite, and a pending person cannot
     * be invited to the same team twice.
     */
    it("gets a new link from Get Invitation Link in the person's row menu on Users, for a master admin", () => {
      const route: string = between(
        collapsed(readCommonSource("Server/API/TeamMemberAPI.ts")),
        "/invitation-link`",
        "/remove-user-from-project`",
      );

      /*
       * The Users list offers it on a pending row, to a master admin, on a
       * server that cannot send email - or whose latest invitation email
       * was not sent (#9511) - beside Resend Invitation (#9519).
       */
      expect(usersPage).toContain(
        "actionButtons={[ getInvitationLinkRowAction<TeamMember>({ isAvailable: canGetInvitationLinks(serverEmail), isNotSignedUp: membersNotSignedUp.isNotSignedUp, isEmailNotSent: canGetLinksOfInvitationsNotSent(serverEmail) ? (item: TeamMember): boolean => { return Boolean(invitationEmailsNotSent.getNotSent(item)); } : undefined, onOpen: (teamMemberId: ObjectID, item: TeamMember) => { setInvitationLinkFor({ teamMemberId: teamMemberId, viewPageRoute: null, isEmailNotSent: !cannotSendEmail(serverEmail) && Boolean(invitationEmailsNotSent.getNotSent(item)), }); }, }), getResendInvitationRowAction<TeamMember>({ isAvailable: canResendInvitations(serverEmail), getRequestHeaders: () => { return ModelAPI.getCommonHeaders(); }, }), ]}",
      );
      expect(serverEmail).toContain(
        "return cannotSendEmail(serverEmail) && serverEmail.isMasterAdmin;",
      );
      expect(invitationLink).toContain(
        'getLink: translationKey("Get Invitation Link"),',
      );
      expect(invitationLink).toContain("title: INVITATION_LINK_COPY.getLink,");
      /*
       * On a pending row - or a member's whose person has not signed up yet
       * (#8191), whom the same link lets in.
       */
      expect(invitationLink).toContain(
        "if (!item.id) { return false; } if (item.hasAcceptedInvitation) { return data.isAvailable && Boolean(data.isNotSignedUp?.(item)); } return data.isAvailable || Boolean(data.isEmailNotSent?.(item));",
      );
      // In the row menu: the row's button is View, which ModelTable puts first.
      expect(invitationLink).not.toContain("ActionButtonPlacement.Primary");
      // The dialog it opens reads a fresh link, which only a master admin is handed.
      expect(invitationLink).toContain(
        "fetchInvitationLink(props.teamMemberId)",
      );
      expect(route).toContain(
        "MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,",
      );

      expect(NO_EMAIL_ANSWER).toContain(
        "Until then, a master admin can send them a new link,",
      );
      expect(NO_EMAIL_ANSWER).toContain(
        "on **Users**, open the person's row menu, **⋯**, and click **Get Invitation Link**.",
      );
    });

    it("says how long the link works: once, only for that address, for the registration token's days", () => {
      const token: string = readCommonSource(
        "Server/Utils/UserRegistrationToken.ts",
      );
      const days: number = capturedNumber(token, REGISTRATION_TOKEN_DAYS);

      expect(days).toBe(7);
      // The link a master admin is handed is minted as the email's is.
      expect(readCommonSource("Server/Utils/InvitationLink.ts")).toContain(
        "await UserRegistrationToken.generateRegistrationLink({",
      );
      // Spent the first time it is used.
      expect(collapsed(token)).toContain(
        "The delete is what makes it single-use",
      );
      expect(invitationLink).toContain(
        `It works once, only for this address, for ${days} days.`,
      );
      expect(NO_EMAIL_ANSWER).toContain(
        `which works once, only for that address, for ${days} days:`,
      );
    });
  });

  it("names the Users list's columns, statuses and filters", () => {
    for (const title of [
      'title: "User"',
      'title: "Teams"',
      'title: "Status"',
    ]) {
      expect(users).toContain(title);
    }

    /*
     * Someone who has not accepted yet is Invitation Sent, or Invited on a
     * server that cannot send email, where no invitation email went out
     * (#6877), or Email Not Sent when the mail service refused their latest
     * invitation email (#9511): one pill, PendingInvitationPill, drawn for
     * a pending row.
     */
    const pending: string = between(
      users,
      "if (!item.hasAcceptedInvitation) {",
      "/>",
    ).replace(/\s+/g, " ");
    const pill: string = readDashboardSource(
      "Components/User/PendingInvitationPill.tsx",
    ).replace(/\s+/g, " ");

    expect(pending).toContain(
      "<PendingInvitationPill serverEmail={serverEmail} notSent={invitationEmailsNotSent.getNotSent(item)}",
    );
    expect(pill).toContain(
      "if (cannotSendEmail(props.serverEmail)) { return ( <Pill text={SERVER_EMAIL_COPY.invitedPill}",
    );
    expect(pill).toContain(
      'if (!props.notSent) { return ( <Pill text="Invitation Sent"',
    );
    // Email Not Sent: one pill, which the Admin Dashboard draws too (#9518).
    expect(pill).toContain("<InvitationEmailNotSentPill");
    expect(
      readCommonSource(
        "UI/Components/InvitationLink/InvitationEmailNotSentPill.tsx",
      ),
    ).toContain("text={INVITATION_EMAIL_NOT_SENT_COPY.pill}");
    expect(
      readCommonSource(
        "UI/Components/InvitationLink/InvitationEmailNotSentPill.tsx",
      ),
    ).toContain('pill: translationKey("Email Not Sent"),');
    expect(readDashboardSource("Utils/ServerEmail.ts")).toContain(
      "emailNotSentPill: INVITATION_EMAIL_NOT_SENT_COPY.pill,",
    );
    expect(readDashboardSource("Utils/ServerEmail.ts")).toContain(
      "invitedPill: INVITATION_LINK_COPY.invitedPill,",
    );
    expect(
      readCommonSource("UI/Components/InvitationLink/InvitationLinkModal.tsx"),
    ).toContain('invitedPill: translationKey("Invited"),');
    expect(users).toContain('<Pill text="Member" color={Green} />');
    expect(users).toContain('other: "{{count}} Invitations Pending"');

    for (const facet of ['label: "User"', 'label: "Status"', 'label: "Team"']) {
      expect(users).toContain(facet);
    }

    const list: string = section(page, "## See who is in the project");
    const columns: Array<Array<string>> = tableRows(list, "Column");

    expect(
      columns.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["**User**", "**Teams**", "**Status**"]);
    /*
     * The Status column's four pills: when a pending person is Email Not
     * Sent, and when Invited.
     */
    expect(boldNames(columns[2]?.[1] as string)).toEqual([
      "Member",
      "Invitation Sent",
      "Email Not Sent",
      "Invited",
    ]);
    expect(columns[2]?.[1]).toContain(
      "**Invitation Sent** until then, or **Email Not Sent** when the mail service refused their latest invitation email.",
    );
    expect(columns[2]?.[1]).toContain(
      "On a self-hosted server that cannot send email yet, **Invited** instead: the invitation is created, but no email goes out.",
    );
    expect(list).toContain(
      "Filter the list by **User**, **Status** or **Team**.",
    );
  });

  /*
   * A pending person whose latest invitation email the mail service refused
   * says Email Not Sent (#9511). The answer for it says what that means,
   * where its reason comes from and what to do, as the pill and its row do.
   */
  it("answers Email Not Sent as the pill says it: why, in the Email Logs' words, and what to do", () => {
    const answer: string = detailsText(page, "A person shows Email Not Sent");
    // The pill the Dashboard and the Admin Dashboard draw alike (#9518).
    const pill: string = collapsed(
      readCommonSource(
        "UI/Components/InvitationLink/InvitationEmailNotSentPill.tsx",
      ),
    );
    const serverEmail: string = collapsed(
      readDashboardSource("Utils/ServerEmail.ts"),
    );
    const reader: string = collapsed(
      readCommonSource("Server/Utils/TeamMember/InvitationEmailsNotSent.ts"),
    );
    const modal: string = collapsed(
      readCommonSource("UI/Components/InvitationLink/InvitationLinkModal.tsx"),
    );
    const resend: string = collapsed(
      readCommonSource("UI/Components/InvitationLink/ResendInvitation.ts"),
    );

    expect(answer).toBe(EMAIL_NOT_SENT_ANSWER);
    expect(boldNames(answer)).toEqual([
      "Email Not Sent",
      "Email",
      "Notification Logs",
      "Users",
      "⋯",
      "Resend Invitation",
      "Invitation Sent",
      "Get Invitation Link",
    ]);

    // Resend Invitation (#9519): the row action, on a pending row, in the row's menu.
    expect(resend).toContain('action: translationKey("Resend Invitation"),');
    expect(resend).toContain("title: RESEND_INVITATION_COPY.action,");
    expect(resend).toContain(
      "return ( data.isAvailable && Boolean(item.id) && !item.hasAcceptedInvitation );",
    );
    expect(resend).not.toContain("ActionButtonPlacement.Primary");
    // The row reads its status again once it went: Invitation Sent.
    expect(resend).toContain("context?.refresh();");
    expect(collapsed(users)).toContain(
      "getResendInvitationRowAction<TeamMember>({",
    );
    expect(
      collapsed(readCommonSource("Server/API/TeamMemberAPI.ts")),
    ).toContain("/:id${RESEND_INVITATION_ROUTE_END}`");

    // The person's latest invitation email decides, and it was refused.
    expect(reader).toContain(
      "templateType: QueryHelper.equalToOrNull(EmailTemplateType.InviteMember),",
    );
    expect(reader).toContain(
      "if (row.status !== MailStatus.Error) { continue; }",
    );

    // Pointed at or tapped, the pill says why, as the Email Logs table words it.
    expect(pill).toContain("<ExplainedPill");
    expect(readCommonSource("UI/Components/Pill/ExplainedPill.tsx")).toContain(
      "isShownOnPress={true}",
    );
    expect(pill).toContain("getEmailLogReason(");
    expect(
      readDashboardSource("Components/NotificationLogs/EmailLogsTable.tsx"),
    ).toContain("getEmailLogReason(");

    // What to do, as the pill tells anybody who is not a master admin: Resend Invitation.
    expect(serverEmail).toContain(
      '"Once email works, use Resend Invitation, or ask your server\'s admin for their invitation link."',
    );
    expect(serverEmail).toContain(
      '"Check their email address, then use Resend Invitation."',
    );
    expect(serverEmail).not.toContain("remove them and invite them again");

    // A master admin's Get Invitation Link, on that row.
    expect(serverEmail).toContain(
      "canGetLinksOfInvitationsNotSent: ( serverEmail: ServerEmail, ) => boolean = (serverEmail: ServerEmail): boolean => { return serverEmail.isMasterAdmin; };",
    );
    expect(modal).toContain(
      "return data.isAvailable || Boolean(data.isEmailNotSent?.(item));",
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
      "**Readiness**, **Notification Methods**, **How to Reach Me**",
      "**Custom Fields**",
      "**Remove from Project**",
    ]);

    for (const title of [
      'title: "Profile"',
      'title: "Teams"',
      'title: "Readiness"',
      'title: "Notification Methods"',
      'title: "How to Reach Me"',
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
    // Remove Team Members too (#6561); scoped to Owned, it removes someone from the project only when it reaches every team of theirs.
    expect(sorted(new TeamMember().getDeletePermissions())).toEqual(
      sorted([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeleteProjectTeam,
        Permission.RemoveProjectTeamMembers,
      ]),
    );
    expect(section(page, "## Remove someone from the project")).toContain(
      "open the person's row menu, **⋯**, and click **Remove from Project**",
    );
  });

  /*
   * Someone whose role removes people only from the teams they own cannot
   * take a person off a team they do not (#6599): Remove from Project is
   * locked for them, naming the teams that keep the person - the ones the
   * reader may read - on the row, in Bulk Actions and on the person's page.
   */
  it("says Remove from Project is locked for someone a role reaching only some teams cannot take off every team, naming the teams it may see", () => {
    const removalReach: string = collapsed(
      readDashboardSource("Utils/ProjectRemovalReach.ts"),
    );
    const personPage: string = collapsed(
      readDashboardSource("Components/User/RemoveUserFromProject.tsx"),
    );
    const route: string = collapsed(
      readCommonSource("Server/API/TeamMemberAPI.ts"),
    );

    // The row's lock, which a bulk removal checks too.
    expect(users).toContain(
      "getDeleteDisabledReason={removalReach.getDeleteDisabledReason}",
    );
    expect(users).toContain("<ProjectRemovalBulkDetails");
    // Asked only of a reader who may remove people, but not across the whole project.
    expect(removalReach).toContain(
      "GrantablePermission.canCurrentUserActOnWholeProject([ ...PROJECT_REMOVAL_PERMISSIONS, ])",
    );
    // The person's page locks it too.
    expect(personPage).toContain("disabled: Boolean(lockReason),");
    // Teams are named only for a reader who may read them.
    expect(route).toContain("await ReadableTeamNames.read({");

    const paragraphsOfSection: Array<string> = paragraphs(
      section(page, "## Remove someone from the project"),
    );

    expect(paragraphsOfSection[1]).toBe(REMOVAL_LOCK);
    expect(boldNames(REMOVAL_LOCK)).toEqual(["Remove from Project"]);
  });

  it("says where to see whether an invitation email went out: the project's notification logs, and the server's email log", () => {
    const sideMenu: string = readDashboardSource("Pages/Settings/SideMenu.tsx");
    const tabs: string = readDashboardSource(
      "Components/NotificationLogs/NotificationLogsTabs.tsx",
    );
    const providers: string = english(EMAIL_PROVIDERS_PAGE);
    const logHeading: DocsHeading | undefined = scanMarkdown(
      providers,
    ).headings.find((heading: DocsHeading): boolean => {
      return heading.text === "See what the server sent";
    });

    /*
     * The invitation email is the project's, so its log row is too - sent
     * again by Resend Invitation as well (#9519).
     */
    expect(
      collapsed(readCommonSource("Server/Services/TeamMemberService.ts")),
    ).toContain(
      "MailService.sendMail(invitationEmail, { projectId: createBy.data.projectId!, userId: user.id!, }).catch(",
    );
    expect(
      collapsed(readCommonSource("Server/Services/TeamMemberService.ts")),
    ).toContain(
      "await MailService.sendMail(invitationEmail, { projectId: projectId, userId: user.id, timeoutInMs: RESEND_INVITATION_SEND_TIMEOUT_IN_MS, });",
    );
    expect(sideMenu).toContain('title: "Notification Logs"');
    expect(tabs).toContain('name: "Email"');
    // And a failed one is in the server's own email log, for a master admin.
    expect(`/docs/${EMAIL_PROVIDERS_PAGE}#${logHeading?.slug}`).toBe(
      EMAIL_LOG_LINK,
    );
    expect(section(providers, "## See what the server sent")).toContain(
      "and every email it failed to send, a project's too",
    );
    expect(linkTargets(WENT_OUT_ANSWER)).toEqual([EMAIL_LOG_LINK]);
    expect(boldNames(WENT_OUT_ANSWER)).toEqual(["Email", "Notification Logs"]);
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
    // Feature Flags' one switch is on Products, under Monitors (#7324).
    expect(page).not.toContain("## Feature flags");
    expect(section(page, "## Products")).toContain(
      "Under **Monitors**, the **Monitor Groups** switch adds Monitor Groups to the Monitors menu. It is off in a new project and saves when you flip it, and turning it off deletes no group.",
    );
    expect(section(page, "## Products")).toContain(
      "Changing it takes the Project Owner role, or a custom role with the Edit Project or Manage Billing permission.",
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
    expect(billingPage).toContain('editModalTitle={"Change Plan"}');
    expect(billingPage).toContain('title: "Seats"');
    /*
     * Change Plan is the plan picker a new project starts on, for a plan
     * change: it marks the plan the project is on, and a marketplace
     * project sees the monthly prices alone.
     */
    expect(billingPage).toContain("<PlanPicker");
    expect(billingPage).toContain("isPlanChange={true}");
    expect(billingPage).toContain("currentPlanId={currentPlanId || undefined}");
    expect(billingPage).toContain("? [BillingPeriod.Monthly]");
    expect(billingPage).not.toContain('title="Yearly Plan"');
    expect(billingPage).not.toContain(
      "FormFieldSchemaType.OptionChooserButton",
    );

    const picker: string = readCommonSource(
      "UI/Components/Billing/PlanPicker/PlanPicker.tsx",
    );
    const pickerCopy: string = readCommonSource(
      "UI/Components/Billing/PlanPicker/PlanPickerCopy.ts",
    );

    // It opens at the period the project is billed for.
    expect(picker).toContain(
      "allowedPeriod(periodOf(props.plans, props.value))",
    );
    // The switch is Monthly | Yearly, and the pill says Current plan.
    expect(pickerCopy).toContain('monthly: translationKey("Monthly")');
    expect(pickerCopy).toContain('yearly: translationKey("Yearly")');
    expect(pickerCopy).toContain('currentPlan: translationKey("Current plan")');
    // What yearly saves is worked out from the prices, never written in.
    expect(picker).toContain("getYearlySavingText({");
    expect(billingPage).not.toContain("(Save 20%)");
    expect(billingPage).toContain("title={`Add a Payment Method`}");

    const plan: string = section(page, "## Change the plan");

    for (const label of [
      "Change Plan",
      "Add a Payment Method",
      "Current Plan",
      "Monthly",
      "Yearly",
      "Current plan",
      "Your free trial carries over",
      "Changing plan does not start a free trial",
      "Not included in this plan",
    ]) {
      expect(boldNames(plan)).toContain(label);
    }

    expect(boldNames(plan)).not.toContain("Yearly Plan");
    expect(plan).toContain(
      "The plans open at the period the project is billed for; switch between **Monthly** and **Yearly** to see the other prices.",
    );

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

    expect(changePlan).toContain("PROJECT_CHANGE_PLAN_PERMISSIONS,");
    expect([...PROJECT_CHANGE_PLAN_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);

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

  it("cancels a plan by moving it to Free, as the Billing page's Cancel Plan card does", () => {
    const cancelCard: string = readDashboardSource(
      "Components/Billing/CancelPlanCard.tsx",
    );
    const cancel: string = section(page, "## Cancel the plan");

    // The card's buttons are the ones the docs name.
    expect(cancelCard).toContain(
      'switchButton: translationKey("Switch to Free Plan")',
    );
    expect(cancelCard).toContain(
      'contactSupportButton: translationKey("Contact Support")',
    );
    expect(cancelCard).toContain(
      'SUPPORT_EMAIL: string = "support@oneuptime.com"',
    );
    expect(boldNames(cancel)).toEqual(
      expect.arrayContaining([
        "Cancel Plan",
        "Switch to Free Plan",
        "Contact Support",
        "Manage Billing",
      ]),
    );
    expect(cancel).toContain("support@oneuptime.com");

    // It never sends anybody to delete the project to stop paying.
    expect(billingPage).not.toContain("PageMap.SETTINGS_DANGERZONE");
    expect(cancelCard).not.toContain("SETTINGS_DANGERZONE");
    expect(cancelCard).toContain(
      "Usage is still billed as you go on the Free plan",
    );
    expect(cancel).toContain("Usage is still billed.");
    expect(cancel).toContain(
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

  /*
   * Every project-scoped model is audited unless it is exempt
   * (Common/Types/AuditLog/AuditLogCoverage), so the page says so and lists
   * what is not recorded by the kinds of record the exemptions name, in
   * their order and with their titles.
   */
  it("says everything people change is recorded, and names what is not by the kinds the coverage exempts", () => {
    const recorded: string = section(page, "## What is recorded");
    const rows: Array<Array<string>> = tableRows(recorded, "Not recorded");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      Object.values(AuditLogExemptionKind).map(
        (kind: AuditLogExemptionKind): string => {
          return AUDIT_LOG_EXEMPTION_KINDS[kind].title;
        },
      ),
    );

    // Every exemption is of a kind the table names.
    for (const kind of Object.values(AUDIT_LOG_EXEMPT_TABLES)) {
      expect(Object.values(AuditLogExemptionKind)).toContain(kind);
    }

    expect(recorded).toContain(
      "Everything people create, change or delete in a project is recorded:",
    );

    // The resource types it gives as examples are what entries carry.
    const audited: Array<string> = auditedModels().map(
      (model: BaseModel): string => {
        return model.singularName as string;
      },
    );
    const examples: Array<string> = inlineCodes(
      recorded.split("\n").find((line: string): boolean => {
        return line.startsWith("Everything people create");
      }) as string,
    );

    expect(examples).toEqual(["Monitor", "Workflow", "Queue"]);

    for (const example of examples) {
      expect(audited).toContain(example);
    }

    // Hundreds of models: the page names kinds, not each one.
    expect(audited.length).toBeGreaterThan(400);
  });

  it("says who is on a team, and a team's permissions, are recorded", () => {
    expect(isAudited(TeamMember)).toBe(true);
    expect(isAudited(TeamPermission)).toBe(true);
    expect(isAudited(Team)).toBe(true);
    expect(section(page, "## What is recorded")).toContain(
      "teams and who is on them",
    );
  });

  it("says what entries leave out: what only OneUptime writes, and a workflow's typed values and canvas moves", () => {
    const recorded: string = section(page, "## What is recorded");

    expect(recorded).toContain(
      "Fields only OneUptime writes, such as when a host was last seen, are left out of every entry",
    );
    expect(recorded).toContain(
      "naming a step's settings but never what was typed into them, and moving a step on the canvas is not recorded.",
    );
  });

  /*
   * Issue #6276: what OneUptime writes because someone asked it to - a
   * merge of exceptions, a webhook URL reset - is written round
   * DatabaseService's hooks, and records its entry itself, as that person's,
   * naming the columns the defaults otherwise leave out.
   */
  it("says a field OneUptime writes because someone asked it to is recorded as their change", () => {
    expect(section(page, "## What is recorded")).toContain(
      "When OneUptime writes one because someone asked it to, such as merging an exception into another or resetting a webhook URL, the entry records it as their change.",
    );

    for (const [source, column] of [
      [
        readCommonSource("Server/Utils/Telemetry/TelemetryExceptionMerge.ts"),
        "mergedIntoTelemetryExceptionId",
      ],
      [
        readPackageFile("App/FeatureSet/Runbook/API/RunbookWebhook.ts"),
        "webhookSecretKey",
      ],
    ] as Array<[string, string]>) {
      expect(source).toContain("AuditLogService.recordUpdate({");
      expect(source).toContain(`includeColumns: ["${column}"]`);
    }
  });

  /*
   * Issues #6300, #6323, #6324: what a rule changes when someone runs it is
   * their change - every rule's Run now hands who ran it to its engine, and
   * the engine writes with RuleRunWriteProps - and what a rule does by
   * itself is OneUptime's own. HookFreeWritesAreRecorded holds the engines
   * to it; this holds the page to the same list of rules.
   */
  it("says what a rule changes when someone runs it is their change, and what a rule does by itself OneUptime's own", () => {
    const recorded: string = section(page, "## What is recorded");

    expect(recorded).toContain(
      "- What a rule changes when someone runs it: the labels and owners it adds, the records a privacy rule makes private, the devices a site assignment rule moves, the devices and monitors an auto import rule creates, and what a status page or SLO monitor rule changes on its page or SLO.",
    );
    expect(recorded).toContain(
      "What a rule does by itself is OneUptime's own change, recorded with **Store System Events** on: the labels and owners a rule adds as a record is created, and a record it makes private then; the devices and monitors an auto import rule creates from new scan results; and what a status page or SLO monitor rule changes when a rule, a monitor or a label is saved.",
    );

    // Root as the person who ran it, and OneUptime's own with nobody named.
    expect(
      readCommonSource("Server/Utils/Rules/RuleRun/RuleApplication.ts"),
    ).toContain(
      "return props ? OnBehalfOfProps.get(props) : { isRoot: true };",
    );

    // The engines the page names write a Run now's changes as that person.
    for (const engine of [
      "Server/Services/NetworkDeviceAutoImportRuleEngineService.ts",
      "Server/Services/StatusPageMonitorRuleEngineService.ts",
      "Server/Services/ServiceLevelObjectiveMonitorRuleEngineService.ts",
      "Server/Services/NetworkDeviceService.ts",
    ]) {
      expect([engine, readCommonSource(engine)]).toEqual([
        engine,
        expect.stringContaining("RuleRunWriteProps.get(data.props)"),
      ]);
    }

    /*
     * And the routes and the runner hand who ran it on, every one of them
     * (HookFreeWritesAreRecorded reads each call).
     */
    expect(readPackageFile("App/FeatureSet/BaseAPI/API/RuleRun.ts")).toContain(
      "// What the run changes is theirs in the audit log.\n            props: props,",
    );
    expect(
      readCommonSource("Server/Utils/Rules/RuleRun/RuleRunner.ts"),
    ).toContain(
      "statusPageMonitorRuleId: data.ruleId,\n        props: data.props,",
    );
  });

  it("names the actions an entry can record, a download and a person's sessions included", () => {
    expect(Object.values(AuditLogAction).sort()).toEqual(
      [
        "Create",
        "Update",
        "Delete",
        "Download",
        "SignIn",
        "SignInFailed",
        "SignOut",
        "SessionTimeout",
        "SessionRevoked",
      ].sort(),
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

    // As the table draws them: an action by its words ("Sign In").
    expect(inlineCodes(actions)).toEqual(
      Object.values(AuditLogAction).map((action: AuditLogAction): string => {
        return AUDIT_LOG_ACTION_LABELS[action];
      }),
    );
  });

  /*
   * Issue #6762: every sign-in and every session's end is in the audit log
   * of each project its person is a member of, as theirs, whether or not the
   * project stores system events. The page names each session action as the
   * table draws it, and what the product does: the session service records
   * a sign-in as it makes the session and an end as a revocation writes it,
   * every revocation names its cause, and a sweep ends what ran out.
   */
  it("says sign-ins and sessions are recorded, in every project of the person's, as the product records them", () => {
    const sessions: string = section(page, "## Sign-ins and sessions");
    const rows: Array<Array<string>> = tableRows(sessions, "Action");

    expect(
      rows.map((row: Array<string>): string => {
        return inlineCodes(row[0] as string)[0] as string;
      }),
    ).toEqual(
      SESSION_AUDIT_LOG_ACTIONS.map((action: AuditLogAction): string => {
        return AUDIT_LOG_ACTION_LABELS[action];
      }),
    );
    expect(sessions).toContain(
      "A sign-in is to OneUptime, not to one project, so every project the person is a member of records it.",
    );
    expect(sessions).toContain(
      "Sign-ins and sessions are recorded whether or not the project stores system events.",
    );
    expect(sessions).toContain(
      `or ${DEFAULT_SESSION_IDLE_DAYS} days without use.`,
    );
    expect(sessions).toContain(
      "A project's own SSO provider is named only in that project's audit log.",
    );
    expect(AUDIT_LOG_SESSION_RESOURCE_TYPE).toBe("User Session");

    const sessionService: string = readCommonSource(
      "Server/Services/UserSessionService.ts",
    );

    // A sign-in as the session is made, an end as a revocation writes it.
    expect(sessionService).toContain(
      "await AuditLogService.recordSessionEvents([",
    );
    expect(sessionService).toContain("Service.toSignInEvent({");
    expect(sessionService).toContain(
      "protected override async onBeforeUpdate(",
    );
    expect(sessionService).toContain("await this.recordSessionEnds({");
    expect(sessionService).toContain("public async endSessionsThatRanOut(");
  });

  /*
   * Issue #6788: a failed sign-in on an existing account is in its person's
   * projects' audit logs, about the attempt, with the account as its actor,
   * never with what was typed, recorded after the sign-in page has
   * answered, and held to so many an hour for an account. The page says
   * each, by the numbers the bound keeps.
   */
  it("says failed sign-ins are recorded, how many, and that the sign-in page answers as before", () => {
    const sessions: string = section(page, "## Sign-ins and sessions");
    const bound: string = readCommonSource(
      "Server/Utils/AuditLog/FailedSignInAuditLog.ts",
    );
    const authentication: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App",
        "FeatureSet",
        "Identity",
        "API",
        "Authentication.ts",
      ),
      "utf8",
    );

    expect(FAILED_SIGN_INS_RECORDED_PER_WINDOW).toBe(10);
    expect(FAILED_SIGN_IN_WINDOW_IN_MINUTES).toBe(60);
    expect(AUDIT_LOG_SIGN_IN_ATTEMPT_RESOURCE_TYPE).toBe("Sign-In Attempt");
    expect(sessions).toContain(
      "| `Sign-In Failed` | Someone tries to sign in to an existing account and fails: a wrong password, authenticator code, backup code or security key, a blocked or unverified account, or a single sign-on OneUptime refused. |",
    );
    expect(sessions).toContain(
      "A `Sign-In Failed` entry is about the attempt, named by the device it came from. Its **Actor** is the account the attempt was made on: whoever made it did not prove they are that person.",
    );
    expect(sessions).toContain(
      "An attempt on an email address that no account has is not recorded, and recording an attempt changes neither what the sign-in page answers nor how fast.",
    );
    expect(sessions).toContain(
      `So that a flood of attempts cannot fill the audit log, the first ${FAILED_SIGN_INS_RECORDED_PER_WINDOW} failed attempts on an account in an hour are recorded one by one. The rest are counted, and the account's next entry says how many attempts it stands for and when the first of them was made.`,
    );

    // After the answer, never awaited by the route: a timer, then the count.
    expect(bound).toContain("setTimeout((): void => {");
    expect(bound).toContain("await FailedSignInAuditLog.countAttempt({");
    expect(authentication).toContain(
      "recordFailedSignIn(SignInFailureReason.WrongPassword);",
    );
    expect(authentication).not.toContain("await FailedSignInAuditLog");
  });

  /*
   * Issue #6790: a private status page's readers' sign-ins, sign-outs and
   * revoked sessions are in the status page's project, and on its own
   * Audit Logs page: each entry rolls up to the status page.
   */
  it("says a private status page's readers' sessions are recorded, in the status page's project", () => {
    const sessions: string = section(page, "## Sign-ins and sessions");
    const readerSessions: string = readCommonSource(
      "Server/Services/StatusPagePrivateUserSessionService.ts",
    );

    expect(AUDIT_LOG_STATUS_PAGE_SESSION_ROOT_RESOURCE_TYPE).toBe(
      "Status Page",
    );
    expect(sessions).toContain(
      "The readers of a private status page are recorded too, in the status page's project only: each sign-in with a password, a sign-in link or the status page's single sign-on, each sign-out, and each session OneUptime ends because the reader's password changed or the status page no longer accepts how it signed in. Their entries are also on the status page's own **Audit Logs** page.",
    );
    expect(readerSessions).toContain(
      "await AuditLogService.recordStatusPageSessionEvents(events);",
    );
    expect(readerSessions).toContain(
      "protected override async onBeforeUpdate(",
    );

    // No longer listed as working state the audit log leaves out.
    expect(section(page, "## What is recorded")).not.toContain(
      "Status page readers' sessions",
    );
  });

  /*
   * Issue #8188: an idle timeout was recorded only when the browser came
   * back, and for one that never did, 30 days later as "Not used for 30
   * days". The five-minute sweep records it once the idle timeout and the
   * margin have passed with nothing heard of the browser, so the page says
   * within how long: the margin and one sweep.
   *
   * Issue #8458: the mobile app after 1.6.0 renews while in use and says so
   * with every renewal (reportsActivityWhileInUse), so its sessions are
   * swept the same way; 1.6.0, the latest store release when it changed
   * (packages/MobileApp/app.json), and earlier say nothing, and theirs are
   * still recorded when the app next reaches OneUptime.
   */
  it("says how soon an idle timeout is recorded, as the sweep's margin and its schedule make it", () => {
    const sessions: string = section(page, "## Sign-ins and sessions");
    const sweepEveryMinutes: number = 5;

    expect(EVERY_FIVE_MINUTE).toBe(`*/${sweepEveryMinutes} * * * *`);
    expect(sessions).toContain(
      `An idle timeout in the browser, or in a version of the mobile app newer than 1.6.0, is recorded within ${
        IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES + sweepEveryMinutes
      } minutes of running out, whether or not the person comes back. In version 1.6.0 and earlier of the mobile app, it is recorded the next time the app reaches OneUptime.`,
    );
    expect(sessions).not.toContain("from a tab left open");

    // What makes it so: every renewal of the app says it renews while in use.
    const mobileClient: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "MobileApp", "src", "api", "client.ts"),
      "utf8",
    );
    const mobileActivity: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "MobileApp", "src", "auth", "userActivity.ts"),
      "utf8",
    );

    expect(mobileClient).toContain(
      "[REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]: true,",
    );
    expect(mobileActivity).toContain(
      `export const REPORTS_ACTIVITY_WHILE_IN_USE_FIELD: string =\n  "${REPORTS_ACTIVITY_WHILE_IN_USE_FIELD}";`,
    );
    expect(mobileActivity).toContain(
      `export const ACTIVITY_REPORT_INTERVAL_MS: number = ${ACTIVITY_REPORTED_WITHIN_IN_MINUTES} * 60 * 1000;`,
    );

    expect(readCommonSource("Server/Services/UserSessionService.ts")).toContain(
      "ended += await this.endSessionsPastIdleTimeout(condition);",
    );

    /*
     * The sweep is the Enterprise Edition's audit log job. Core CI runs
     * without ee/: its schedule is held to the page wherever ee/ is present.
     */
    if (fs.existsSync(EE_DIR)) {
      const sweepJob: string = fs.readFileSync(
        path.join(
          EE_DIR,
          "Server",
          "AuditLog",
          "Jobs",
          "EndSessionsThatRanOut.ts",
        ),
        "utf8",
      );

      expect(sweepJob).toContain("schedule: EVERY_FIVE_MINUTE,");
    }
  });

  it("says an administrator's changes to someone else's notification setup are recorded", () => {
    for (const service of [
      "Server/Services/UserNotificationMethodAdminService.ts",
      "Server/Services/UserNotificationRuleAdminService.ts",
    ]) {
      expect(readCommonSource(service)).toContain("await this.writeAuditLog(");
    }

    expect(section(page, "## What is recorded")).toContain(
      "An administrator adding or removing a notification method or a rule in How to Reach Me on someone else's account is recorded too, without the address or number itself.",
    );
  });

  /*
   * #6383: the form checked 7 to 180 days, and nothing on the server did,
   * so the API stored -3. The server refuses what the rule cannot save now,
   * on create and update (ProjectService.applyAuditLogRetentionRules).
   */
  it("states the retention's range, and that the API holds a retention to it", () => {
    const rows: Array<Array<string>> = tableRows(
      section(page, "## Turn on audit logging"),
      "Setting",
    );

    expect(
      rows.find((row: Array<string>): boolean => {
        return row[0] === "**Retention (days)**";
      }),
    ).toEqual([
      "**Retention (days)**",
      String(AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS),
      `How many days each entry is kept: from ${AUDIT_LOG_MIN_RETENTION_IN_DAYS} to ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}.`,
    ]);
    expect(section(page, "## How long entries are kept")).toContain(
      `Through the API too, a retention is a whole number of days from ${AUDIT_LOG_MIN_RETENTION_IN_DAYS} to ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}: any other value is refused.`,
    );

    for (const refused of [
      AUDIT_LOG_MIN_RETENTION_IN_DAYS - 1,
      AUDIT_LOG_MAX_RETENTION_IN_DAYS + 1,
      AUDIT_LOG_MIN_RETENTION_IN_DAYS + 0.5,
      -3,
    ]) {
      expect(getAuditLogRetentionError(refused)).toBe(
        AUDIT_LOG_RETENTION_ERROR,
      );
    }

    const projectService: string = readCommonSource(
      "Server/Services/ProjectService.ts",
    );

    expect(
      projectService.split("this.applyAuditLogRetentionRules(").length - 1,
    ).toBe(2);
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

    // The form's bounds are the rule's (Common/Types/AuditLog/AuditLogRetention).
    expect(retention).toContain("minValue: AUDIT_LOG_MIN_RETENTION_IN_DAYS,");
    expect(retention).toContain("maxValue: AUDIT_LOG_MAX_RETENTION_IN_DAYS,");

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
      // What a workflow's step ran as, and whose permissions (#9766).
      "Workflow Ran As",
      "Workflow Permissions Given By",
      "Time",
    ]);
    expect(section(page, "## Read the audit log")).toContain(
      "Filter by **Resource Type**, **Resource Name**, **Action**, **User Email**, **Workflow Ran As**, **Workflow Permissions Given By** or **Time**.",
    );
    expect(section(page, "## Read the audit log")).toContain(
      "A workflow's change says what it ran as and with whose permissions.",
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

    /*
     * Kept for the project's retention, from 7 to 180 days, 7 unless set:
     * read, and stamped on each entry, by the rule a failing export reckons
     * with too (#6383).
     */
    expect(recorder).toContain("readAuditLogRetentionInDays(");
    expect(recorder).toContain("return getAuditLogRetentionDate({");
    expect([
      AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS,
      AUDIT_LOG_MIN_RETENTION_IN_DAYS,
      AUDIT_LOG_MAX_RETENTION_IN_DAYS,
    ]).toEqual([7, 7, 180]);

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
        // Remove from Project refused for a role that reaches only some teams (#6599).
        Errors.TeamMemberService.REMOVE_FROM_SOME_TEAMS_ONLY,
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
