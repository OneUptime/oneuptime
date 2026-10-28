import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { getDocsNavIcon } from "../../../FeatureSet/Docs/Utils/NavIcons";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ENGLISH_TEXT,
  NOTIFICATIONS_GROUP_TITLE_OVERRIDES,
  NOTIFICATIONS_NAV_GROUP,
  NOTIFICATIONS_NAV_GROUP_AFTER,
  NOTIFICATIONS_NAV_SECTION,
  NOTIFICATION_METHODS,
  NOTIFICATION_PAGES,
  NOTIFICATION_SETTINGS,
  NotificationDocsPageEntry,
  PERSONAL_ON_CALL_RULES,
  REACHING_YOU,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SIGNATURE_HEADER,
} from "./NotificationDocsPages";
import { readPage, scanMarkdown } from "./DocsContentSupport";
import {
  MenuSection,
  menuSections,
  quotedListConstant,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
  workspaceSection,
} from "./DocsDashboardMenus";
import { boldPaths } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  ON_CALL_RULE_KIND_DEFINITIONS,
  OnCallRuleKindDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRuleKinds";
import ProjectNotificationChannelsCopy, {
  PROJECT_NOTIFICATION_CHANNELS,
  ProjectNotificationChannelDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import {
  VerificationCodeChannel,
  VerificationCodeCopy,
  getVerificationCodeChannel,
} from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeChannels";
import OnCallRuleKind, {
  DEFAULT_ON_CALL_RULE_KIND,
  MOVED_ON_CALL_RULES_PATHS,
  ON_CALL_RULE_KIND_QUERY_PARAM,
  ON_CALL_RULES_PAGE_PATH,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import {
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "Common/Types/NotificationRule/NotificationRepeat";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import {
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  getOnCallPageCallPassOnPrompt,
} from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  WHO_MAY_TURN_THEM_ON,
} from "Common/Utils/Project/NotificationChannels";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import { ON_CALL_PAGE_SMS_ACTION } from "Common/Utils/Sms/OnCallPageSms";
import { describe, expect, it } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";

/*
 * Docs overhaul task 33: the Notifications pages - how OneUptime reaches
 * you, notification methods, personal on-call rules and notification
 * settings - name a lot of the product: User Settings and every page under
 * it, the cards, buttons and dialogs of each kind of method, how codes are
 * verified, the project's channel switches, the on-call rules' tabs, delays,
 * push levels and repeats, the defaults a new member gets, the fallback when
 * no rule matches, the webhook a page posts, and the notification settings'
 * tabs, events and defaults. Markdown is not compiled, so nothing else
 * notices when the product moves on.
 *
 * These hold those facts to the source: Common's types, models and copy
 * imported, the Dashboard's pages and the server's services read as text
 * (an App test must not import the Dashboard's React components, nor any
 * package but App and Common). A renamed tab, card, button, event, default
 * or limit fails here until the English pages follow - and
 * NotificationDocsTranslations then carries the change into every language.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function english(page: string): string {
  return readPage("en", page);
}

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

// Every **bold** name in a piece of markdown, in order.
const BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;
const HEADING_LEVEL: RegExp = /^(#+) /;
const QUOTED_TITLE: RegExp = /title:\s*"([^"]+)"/g;
const QUOTED_STRING: RegExp = /"([^"]+)"/g;
const LABEL_OPTION: RegExp = /label:\s*"([^"]+)"/g;
const TAB_NAME: RegExp = /name:\s*(?:translationKey\()?"([^"]+)"/g;
const EVENT_TYPE_NAME: RegExp = /NotificationSettingEventType\.([A-Z_]+)/g;
const CHANNEL_NAME: RegExp = /channelName:\s*"([^"]+)"/g;
const DEFAULT_MINUTES: RegExp =
  /"NOTIFICATION_VERIFICATION_CODE_EXPIRY_MINUTES",\s*(\d+),/;
const DEFAULT_ATTEMPTS: RegExp =
  /"NOTIFICATION_VERIFICATION_MAX_ATTEMPTS",\s*(\d+),/;
const DEFAULT_COOLDOWN: RegExp =
  /"NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_SECONDS",\s*(\d+),/;
const CODE_LENGTH: RegExp = /VERIFICATION_CODE_LENGTH:\s*number\s*=\s*(\d+);/;
const WEBHOOK_TIMEOUT: RegExp =
  /WEBHOOK_REQUEST_TIMEOUT_MS:\s*number\s*=\s*([\d_]+);/;
// An event of the notification settings page: its enum member and label.
const EVENT_ENTRY: RegExp =
  /NotificationSettingEventType\.([A-Z_]+)\]:\s*\{\s*label:\s*"([^"]+)"/g;
// The helpers addDefaultNotificationSettingsForUser calls, in order.
const ADD_HELPER_CALL: RegExp =
  /await this\.(add[A-Za-z]+)\(userId, projectId\);/g;
const NAME_PROPERTY: RegExp = /name:\s*"([^"]+)"/g;
// A column for quiet hours: `public quietHours`, or a title that says so.
const QUIET_COLUMN: RegExp = /public\s+quiet|title:\s*"[^"]*quiet/i;
// The title of the Workspace section's entry that connects a workspace.
const CONNECT_ENTRY_TITLE: RegExp =
  /\[WorkspaceMenuEntry\.Connect\]:\s*"([^"]+)"/g;

function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function captures(source: string, pattern: RegExp): Array<string> {
  return Array.from(source.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
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
 * The text of the section under `heading` ("## X" or "### X"), up to the
 * next heading of its level or above. A heading the page lacks fails, naming
 * it.
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

// The row of a table whose first cell is `first`; fails, naming it, when none is.
function rowStartingWith(rows: Array<string>, first: string): Array<string> {
  const row: string | undefined = rows.find((candidate: string): boolean => {
    return tableCells(candidate)[0] === first;
  });

  expect({ row: first, found: Boolean(row) }).toEqual({
    row: first,
    found: true,
  });

  return tableCells(row || "");
}

/*
 * A table of a page's menu sections: its rows as sections, each the bold
 * names of its second cell before any ": " that says what they are for.
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

// The source of a function or method, from its name to the next one's.
function functionSource(
  source: string,
  name: string,
  nextName: string,
): string {
  const start: number = source.indexOf(name);
  const end: number = source.indexOf(nextName, start + name.length);

  expect({ name, found: start >= 0 && end > start }).toEqual({
    name,
    found: true,
  });

  return source.slice(start, end);
}

// The fenced code blocks of a page with this language, in order.
function codeBlocks(markdown: string, lang: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === lang;
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });
}

// ---- The User Settings side menu -------------------------------------------

/*
 * The menu's sections, from where the menu lists them: the "Timeline" link
 * above them is the sub-item On-Call Logs shows while a log is open, not a
 * section.
 */
const USER_SETTINGS_MENU_FILE: string = readDashboardSource(
  "Pages/UserSettings/SideMenu.tsx",
);
const USER_SETTINGS_MENU_SOURCE: string = USER_SETTINGS_MENU_FILE.slice(
  USER_SETTINGS_MENU_FILE.indexOf("const sections: SideMenuSectionProps[]"),
);

/*
 * The User Settings menu, with the Workspace section where the menu adds it.
 * User Settings has no page to connect a workspace, so its Workspace section
 * lists only the workspaces themselves.
 */
function userSettingsMenu(): Array<MenuSection> {
  const workspace: MenuSection = workspaceSection();
  const connectTitle: string = captures(
    readDashboardSource("Components/Workspace/WorkspaceSideMenuSection.ts"),
    CONNECT_ENTRY_TITLE,
  )[0] as string;

  expect(workspace.items).toContain(connectTitle);

  return menuSections(USER_SETTINGS_MENU_SOURCE, {
    "...(workspaceSection ?": {
      title: workspace.title,
      items: workspace.items.filter((item: string): boolean => {
        return item !== connectTitle;
      }),
    },
  });
}

function projectSettingsMenu(): Array<MenuSection> {
  return menuSections(readDashboardSource("Pages/Settings/SideMenu.tsx"));
}

/*
 * Whether a path through a side menu is one the reader can follow: a page
 * of the menu (["Setup Checklist"]), or a section and a page in it
 * (["Calendar", "Calendar Feed"]), or a section alone.
 */
function isMenuPath(menu: Array<MenuSection>, rest: Array<string>): boolean {
  if (rest.length === 1) {
    return menu.some((menuSection: MenuSection): boolean => {
      return (
        menuSection.title === rest[0] ||
        menuSection.items.includes(rest[0] as string)
      );
    });
  }

  if (rest.length === 2) {
    return menu.some((menuSection: MenuSection): boolean => {
      return (
        menuSection.title === rest[0] &&
        menuSection.items.includes(rest[1] as string)
      );
    });
  }

  return false;
}

// ---- The nav group ----------------------------------------------------------

describe("the Notifications group in the docs", () => {
  it("is in Incident Response, right after the On Call group", () => {
    const titles: Array<string> = DocsNav.map((group: NavGroup): string => {
      return group.title;
    });

    expect(DocsNavSections).toContain(NOTIFICATIONS_NAV_SECTION);
    expect(navGroup(NOTIFICATIONS_NAV_GROUP).section).toBe(
      NOTIFICATIONS_NAV_SECTION,
    );
    expect(titles.indexOf(NOTIFICATIONS_NAV_GROUP)).toBe(
      titles.indexOf(NOTIFICATIONS_NAV_GROUP_AFTER) + 1,
    );
  });

  it("lists the overview first, so /docs/notifications opens it, then the other pages in order", () => {
    expect(
      navGroup(NOTIFICATIONS_NAV_GROUP).links.map(
        (link: NavLink): Array<string> => {
          return [link.url, link.title];
        },
      ),
    ).toEqual(
      NOTIFICATION_PAGES.map(
        (entry: NotificationDocsPageEntry): Array<string> => {
          return [`/docs/${entry.page}`, entry.navTitle];
        },
      ),
    );
    expect(NOTIFICATION_PAGES[0]?.page).toBe(REACHING_YOU);
  });

  it("has an icon of its own: an inbox tray, not the Alerts bell", () => {
    const icon: string = getDocsNavIcon(NOTIFICATIONS_NAV_GROUP);

    expect(icon).toContain("M20 13V6a2 2 0 00-2-2H6");
    expect(icon).not.toBe(getDocsNavIcon("Alerts"));
    expect(icon).not.toBe(getDocsNavIcon("Emails"));
  });

  it("names the group and its pages in every docs language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const locale: {
        navGroups: Record<string, string>;
        navLinks: Record<string, string>;
      } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );

      expect({
        language,
        group: typeof locale.navGroups[NOTIFICATIONS_NAV_GROUP],
      }).toEqual({ language, group: "string" });

      for (const entry of NOTIFICATION_PAGES) {
        expect({
          language,
          link: entry.navTitle,
          title: typeof locale.navLinks[entry.navTitle],
        }).toEqual({ language, link: entry.navTitle, title: "string" });
      }
    }
  });

  it("names the group, and the methods and settings pages, as each language's Dashboard does", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const docs: {
        navGroups: Record<string, string>;
        navLinks: Record<string, string>;
      } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );
      const dashboard: Record<string, unknown> = JSON.parse(
        readDashboardSource(`Locales/${language}.json`),
      ) as Record<string, unknown>;

      expect({
        language,
        group: docs.navGroups[NOTIFICATIONS_NAV_GROUP],
      }).toEqual({
        language,
        group:
          NOTIFICATIONS_GROUP_TITLE_OVERRIDES[language] ||
          dashboard["Notifications"],
      });

      for (const page of ["Notification Methods", "Notification Settings"]) {
        expect({ language, page, title: docs.navLinks[page] }).toEqual({
          language,
          page,
          title: dashboard[page],
        });
      }
    }
  });

  it("gives no two groups of Incident Response one title in any language", () => {
    const groups: Array<string> = DocsNav.filter((group: NavGroup): boolean => {
      return group.section === NOTIFICATIONS_NAV_SECTION;
    }).map((group: NavGroup): string => {
      return group.title;
    });

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const docs: { navGroups: Record<string, string> } = JSON.parse(
        readPackageFile(`App/FeatureSet/Docs/Locales/${language}.json`),
      );
      const titles: Array<string> = groups.map((group: string): string => {
        return docs.navGroups[group] || group;
      });

      expect({ language, distinct: new Set(titles).size }).toEqual({
        language,
        distinct: titles.length,
      });
    }
  });

  it("takes its Norwegian title from the Norwegian User Settings menu, since Notifications and Alerts are both Varsler there", () => {
    const norwegian: Record<string, unknown> = JSON.parse(
      readDashboardSource("Locales/no.json"),
    ) as Record<string, unknown>;

    expect(norwegian["Notifications"]).toBe(norwegian["Alerts"]);
    expect(
      (norwegian["Alerts & Notifications"] as string).toLowerCase(),
    ).toContain(
      (NOTIFICATIONS_GROUP_TITLE_OVERRIDES["no"] as string).toLowerCase(),
    );
  });

  it("is linked from Getting Started's Incident Response cards, right after On-call, and from Core Concepts' on-call section", () => {
    const gettingStarted: Array<string> = section(
      readPage("en", "introduction/getting-started"),
      "### Incident Response",
    )
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- [");
      });
    // The On-call card opens the On Call group at its overview.
    const onCall: number = gettingStarted.findIndex((line: string): boolean => {
      return line.includes("(/docs/on-call/index)");
    });

    expect(onCall).toBeGreaterThanOrEqual(0);
    expect(gettingStarted[onCall + 1]).toContain(
      `[${NOTIFICATIONS_NAV_GROUP}](/docs/${REACHING_YOU})`,
    );

    expect(
      section(readPage("en", "introduction/core-concepts"), "## On-call"),
    ).toContain(`- [How OneUptime Reaches You](/docs/${REACHING_YOU}): `);
  });
});

// ---- User Settings, as every page names it -----------------------------------

describe("User Settings, where everything on these pages is", () => {
  it("is the bar's own entry, on its right, drawn from navbar.userSettings", () => {
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");
    const rightElement: string = navigation.slice(
      navigation.indexOf("const rightElement"),
    );

    expect(rightElement).toContain('title: t("navbar.userSettings")');

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const dashboard: {
        navbar: Record<string, unknown>;
        [key: string]: unknown;
      } = JSON.parse(readDashboardSource(`Locales/${language}.json`));

      // The bar's word and the flat label the pages are checked against agree.
      expect({ language, bar: dashboard.navbar["userSettings"] }).toEqual({
        language,
        bar: dashboard["User Settings"],
      });
    }

    expect(english(REACHING_YOU)).toContain(
      "Open **User Settings**, on the right of the bar under the top bar.",
    );
  });

  it("has a side menu row per section, with its pages, in the menu's order", () => {
    const table: string = section(
      english(REACHING_YOU),
      "## Where to find them",
    );

    expect(menuTable(table)).toEqual(userSettingsMenu());
  });

  it("says which sections start open, as the menu draws them", () => {
    const open: Array<string> = userSettingsMenu()
      .map((menuSection: MenuSection): string => {
        return menuSection.title;
      })
      .filter((title: string): boolean => {
        return (
          title !== workspaceSection().title &&
          !startsCollapsed(USER_SETTINGS_MENU_SOURCE, title)
        );
      });

    expect(open).toEqual(["Get Started", "Alerts & Notifications"]);
    expect(startsCollapsed(USER_SETTINGS_MENU_SOURCE, "Workspace")).toBe(true);
    expect(english(REACHING_YOU)).toContain(
      `**${open[0]}** and **${open[1]}** are open; the other sections start folded`,
    );
  });

  it("shows Workspace only when the project has connected a workspace", () => {
    expect(USER_SETTINGS_MENU_SOURCE).toContain(
      "...(workspaceSection ? [workspaceSection] : [])",
    );
    // No page to connect one: the section is left out instead.
    expect(USER_SETTINGS_MENU_SOURCE).not.toContain("connect:");
    expect(english(REACHING_YOU)).toContain(
      "**Workspace** shows only when the project has connected Slack or Microsoft Teams.",
    );
  });

  it("writes every path through User Settings and Project Settings as their menus have it", () => {
    const menus: Record<string, Array<MenuSection>> = {
      "User Settings": userSettingsMenu(),
      "Project Settings": projectSettingsMenu(),
    };
    const incidents: Array<MenuSection> = menuSections(
      readDashboardSource("Pages/Incidents/SideMenu.tsx"),
    );
    const alerts: Array<MenuSection> = menuSections(
      readDashboardSource("Pages/Alerts/SideMenu.tsx"),
    );
    let checked: number = 0;

    for (const entry of NOTIFICATION_PAGES) {
      for (const segments of boldPaths(english(entry.page))) {
        const [first, ...rest] = segments;

        if (first === "Incidents" || first === "Alerts") {
          // "Incidents → Rules": the section that holds their On-Call Rules.
          const menu: Array<MenuSection> =
            first === "Incidents" ? incidents : alerts;

          expect(rest).toEqual(["Rules"]);
          expect(sectionByTitle(menu, "Rules").items).toContain(
            "On-Call Rules",
          );
          checked++;
          continue;
        }

        expect({ page: entry.page, path: segments.join(" → ") }).toEqual({
          page: entry.page,
          path: segments.join(" → "),
        });
        expect({
          path: segments.join(" → "),
          known: Boolean(menus[first as string]),
          follows: menus[first as string]
            ? isMenuPath(menus[first as string] as Array<MenuSection>, rest)
            : false,
        }).toEqual({
          path: segments.join(" → "),
          known: true,
          follows: true,
        });
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(15);
  });

  it("lets project owners and admins see a member's readiness, methods and rules, and add a method that only the member can verify", () => {
    const memberMenu: string = readDashboardSource(
      "Pages/Users/View/SideMenu.tsx",
    );
    const entries: string = memberMenu.slice(
      memberMenu.indexOf("ON_CALL_MENU_ENTRIES"),
      memberMenu.indexOf("];", memberMenu.indexOf("ON_CALL_MENU_ENTRIES")),
    );

    expect(captures(entries, QUOTED_TITLE)).toEqual([
      "Readiness",
      "Notification Methods",
      "On-Call Rules",
    ]);
    expect(memberMenu).toContain('title: "On-Call",');

    const adminApi: string = readCommonSource(
      "Server/API/UserNotificationMethodAdminAPI.ts",
    );
    const manage: string = adminApi.slice(
      adminApi.indexOf("const MANAGE_PERMISSIONS"),
      adminApi.indexOf("];", adminApi.indexOf("const MANAGE_PERMISSIONS")),
    );

    expect(manage).toContain("Permission.ProjectOwner");
    expect(manage).toContain("Permission.ProjectAdmin");
    expect(
      readDashboardSource("Pages/Users/View/OnCall/NotificationMethods.tsx"),
    ).toContain("AN ADMINISTRATOR CAN ADD A METHOD BUT CANNOT MAKE IT");
    expect(english(REACHING_YOU)).toContain(
      "they open your row and its **On-Call** section, with **Readiness**, **Notification Methods** and **On-Call Rules**. They can add a method for you there, but the code goes to the method itself, so only you can verify it.",
    );
  });
});

// ---- What a new member starts with -------------------------------------------

describe("what a new member starts with", () => {
  const ruleService: string = readCommonSource(
    "Server/Services/UserNotificationRuleService.ts",
  );

  it("is set up only once the member's sign-in email is verified", () => {
    const teamMember: string = functionSource(
      readCommonSource("Server/Services/TeamMemberService.ts"),
      "private async addDefaultNotificationSettingsAndRules",
      "Accept every invitation",
    );

    expect(teamMember).toContain("!user.isEmailVerified");
    expect(teamMember).toContain(
      "UserNotificationSettingService.addDefaultNotificationSettingsForUser",
    );
    expect(teamMember).toContain(
      "UserNotificationRuleService.addDefaultNotificationRuleForUser",
    );
    expect(english(REACHING_YOU)).toContain(
      "When you join a project with a verified sign-in email",
    );
  });

  it("adds the sign-in email, verified, and a rule for it on every severity of the four kinds, sent at once", () => {
    const forUser: string = functionSource(
      ruleService,
      "public async addDefaultNotificationRuleForUser(",
      "What this user would lose",
    );

    expect(forUser).toContain("userEmail.isVerified = true;");

    const forMethod: string = functionSource(
      ruleService,
      "public async addDefaultNotificationRulesForVerifiedMethod(",
      "private applyNotificationMethod(",
    );

    for (const ruleType of [
      "ON_CALL_EXECUTED_INCIDENT,",
      "ON_CALL_EXECUTED_ALERT,",
      "ON_CALL_EXECUTED_ALERT_EPISODE,",
      "ON_CALL_EXECUTED_INCIDENT_EPISODE,",
    ]) {
      expect(forMethod).toContain(`NotificationRuleType.${ruleType}`);
    }

    expect(
      functionSource(
        ruleService,
        "private async createSeverityScopedRules(",
        "private async createSingleRule(",
      ),
    ).toContain("rule.notifyAfterMinutes = 0;");

    expect(english(REACHING_YOU)).toContain(
      "1. Your sign-in email is added as a verified email method.\n2. For every severity, on each of the four tabs of **On-Call Rules**, a rule emails you as soon as you are paged.",
    );
  });

  it("gives every method the same rules the moment it is verified, linked or added", () => {
    const verifiedBy: Array<string> = [
      "Common/Server/API/UserEmailAPI.ts",
      "Common/Server/API/UserSmsAPI.ts",
      "Common/Server/API/UserCallAPI.ts",
      "Common/Server/API/UserWhatsAppAPI.ts",
      "Common/Server/API/UserPushAPI.ts",
      // A Telegram account, linked by webhook or by polling.
      "Common/Server/Utils/TelegramBotUpdates.ts",
      "Common/Server/Services/UserSlackService.ts",
      "Common/Server/Services/UserMicrosoftTeamsService.ts",
      "Common/Server/Services/UserWebhookService.ts",
    ];

    for (const file of verifiedBy) {
      expect({
        file,
        adds: readPackageFile(file).includes(
          "addDefaultNotificationRulesForVerifiedMethod",
        ),
      }).toEqual({ file, adds: true });
    }

    expect(english(REACHING_YOU)).toContain(
      "Every method you verify later gets the same rules: a rule for every severity, sent as soon as you are paged.",
    );
    expect(english(PERSONAL_ON_CALL_RULES)).toContain(
      "Every method you verify gets a rule on every card of every tab, sent as soon as you are paged.",
    );
  });
});

// ---- The setup checklist -----------------------------------------------------

describe("the setup checklist", () => {
  const model: string = readDashboardSource(
    "Components/UserSettings/SetupChecklist/ChecklistModel.ts",
  );
  const card: string = readDashboardSource(
    "Components/UserSettings/SetupChecklist/SetupChecklist.tsx",
  );
  const checklist: string = section(
    english(REACHING_YOU),
    "## The setup checklist",
  );

  it("names the card and its Recheck button as the page draws them", () => {
    expect(card).toContain('title="Your setup checklist"');
    expect(card).toContain('title="Recheck"');
    expect(checklist).toContain("opens **Your setup checklist**");
    expect(checklist).toContain("**Recheck** reads it all again");
  });

  it("has a row per section of the checklist, in its order", () => {
    const sections: string = model.slice(
      model.indexOf("const candidateSections"),
      model.indexOf("const sections: Array<SetupSection>"),
    );
    const titles: Array<string> = captures(sections, QUOTED_TITLE);

    expect(titles).toEqual([
      "So we can reach you",
      "How you want to be paged",
      "Staying informed",
      "Nice to have",
    ]);
    expect(
      tableRows(checklist).map((row: string): string => {
        return boldNames(tableCells(row)[0] || "")[0] || "";
      }),
    ).toEqual(titles);
  });

  it("says Nice to have is not counted, nor a step only someone else can fix", () => {
    expect(
      functionSource(
        model,
        "const buildOptionalSteps",
        "type IsCountedFunction",
      ),
    ).toContain("importance: SetupStepImportance.Optional");
    expect(
      functionSource(
        model,
        "const isCountedTowardsProgress",
        "type BuildChecklistFunction",
      ),
    ).toContain("if (step.importance === SetupStepImportance.Optional) {");
    expect(model).toContain("SetupStepStatus.Blocked");
    expect(checklist).toContain(
      "**Nice to have** is not counted in the progress bar, and neither is a step only someone else can fix.",
    );
  });

  it("lists the four headlines the checklist can show, as it words them", () => {
    const headlines: string = functionSource(
      model,
      "const getHeadline: GetHeadlineFunction",
      "\n};",
    );
    const words: Array<string> = captures(headlines, QUOTED_STRING);
    const table: string = checklist.slice(checklist.indexOf("| Headline |"));

    expect(words).toHaveLength(4);
    expect(
      tableRows(table)
        .map((row: string): string => {
          return boldNames(tableCells(row)[0] || "")[0] || "";
        })
        .sort(),
    ).toEqual([...words].sort());
  });
});

// ---- When no rule matches ----------------------------------------------------

describe("when a page finds no rule", () => {
  const ruleService: string = readCommonSource(
    "Server/Services/UserNotificationRuleService.ts",
  );
  const fallback: string = functionSource(
    ruleService,
    "private async chooseFallbackChannels(",
    "private buildUnsavedFallbackRule(",
  );

  it("pages every free method, else the first paid one the project allows, else a webhook, in that order", () => {
    expect(captures(fallback, CHANNEL_NAME)).toEqual([
      "Push",
      "Email",
      "Slack",
      "Microsoft Teams",
      "SMS",
      "Call",
      "WhatsApp",
      "Telegram",
      "Webhook",
    ]);

    // The free ones are all used; a paid one returns at once.
    expect(fallback).toContain(
      "if (chosen.length > 0) {\n      return chosen;",
    );
    for (const flag of [
      "enableSmsNotifications",
      "enableCallNotifications",
      "enableWhatsAppNotifications",
      "enableTelegramNotifications",
    ]) {
      expect(fallback).toContain(`if (project?.${flag}) {`);
    }

    const page: string = section(
      english(REACHING_YOU),
      "## When no rule matches",
    );

    expect(page).toContain(
      "1. Every free method you have: push devices, email addresses, Slack and Microsoft Teams.",
    );
    expect(page).toContain(
      "in this order: SMS, a phone call, WhatsApp, Telegram. It is the first one you have verified, on a channel the project has turned on.",
    );
    expect(page).toContain("3. If you have none of those either, a webhook.");
  });

  it("emails the person paged and the policy's owners, or the project's owners, and holds the emails back during a storm", () => {
    const alerting: string = readCommonSource(
      "Server/Services/OnCallNotificationAlertingService.ts",
    );

    expect(alerting).toContain("OnCallDutyPolicyOwnerUserService");
    expect(alerting).toContain("OnCallDutyPolicyOwnerTeamService");
    expect(alerting).toContain("ProjectService");
    expect(alerting).toContain(
      "const NOTIFICATION_WINDOW_IN_MS: number = 24 * 60 * 60 * 1000;",
    );
    expect(english(REACHING_YOU)).toContain(
      "You get an email saying so, and so do the on-call policy's owners, or the project's owners when the policy has none.",
    );
  });

  it("can be turned off for a project, through the API, by a project owner or someone with Manage Billing", () => {
    const column: { title?: string; defaultValue?: unknown } =
      new Project().getTableColumnMetadata(
        "disableOnCallNotificationFallback",
      ) as { title?: string; defaultValue?: unknown };

    expect(column.defaultValue).toBe(false);
    expect(
      new Project().getColumnAccessControlFor(
        "disableOnCallNotificationFallback",
      )?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ManageProjectBilling]);

    const logService: string = readCommonSource(
      "Server/Services/UserOnCallLogService.ts",
    );

    expect(logService).toContain(
      "User should add the rules in User Settings > On-Call Rules.",
    );
    expect(english(PERSONAL_ON_CALL_RULES)).toContain(
      "A project owner, or someone with **Manage Billing**, can set the project's `disableOnCallNotificationFallback` through the API.",
    );
  });

  it("is skipped for a severity the person muted with an opt-out rule, which the API can store", () => {
    const rule: UserNotificationRule = new UserNotificationRule();
    const access: ColumnAccessControl | null =
      rule.getColumnAccessControlFor("isOptOut");

    expect(access?.create).toContain(Permission.CurrentUser);
    expect(
      readDashboardSource("Components/NotificationRule/OnCallRulesTable.tsx"),
    ).toContain('"Muted - notifications turned off for this rule"');
    expect(english(PERSONAL_ON_CALL_RULES)).toContain(
      "The row reads **Muted - notifications turned off for this rule**, and deleting it turns paging back on.",
    );
  });
});

// ---- Notification methods ----------------------------------------------------

describe("notification methods", () => {
  const methods: string = english(NOTIFICATION_METHODS);
  const tabsSource: string = readDashboardSource(
    "Components/NotificationMethods/NotificationMethodTabs.tsx",
  );

  function component(name: string): string {
    return readDashboardSource(`Components/NotificationMethods/${name}.tsx`);
  }

  // A component's card title: cardProps' own title.
  function cardTitle(name: string): string {
    const source: string = component(name);
    const cardProps: string = source.slice(source.indexOf("cardProps={{"));

    return captures(cardProps, QUOTED_TITLE)[0] as string;
  }

  const CARDS: Array<{ component: string; tab: string }> = [
    { component: "Email", tab: "Direct Contact" },
    { component: "SMS", tab: "Direct Contact" },
    { component: "Call", tab: "Direct Contact" },
    { component: "WhatsApp", tab: "Direct Contact" },
    { component: "Telegram", tab: "Direct Contact" },
    { component: "Slack", tab: "Workspace Apps" },
    { component: "MicrosoftTeams", tab: "Workspace Apps" },
    { component: "Push", tab: "Push Notifications" },
    { component: "Webhook", tab: "Webhooks" },
  ];

  it("has the tabs the page draws, in its order", () => {
    expect(captures(tabsSource, TAB_NAME)).toEqual([
      "Workspace Apps",
      // A server's custom channels: drawn only while one is on.
      "Custom Channels",
      /*
       * The push devices, or the notice that the server has push turned off
       * (getPushNotificationsTab): defined before the page, drawn fourth.
       */
      "Push Notifications",
      "Direct Contact",
      "Webhooks",
    ]);
    // Workspace Apps is defined first, and drawn second, only when offered.
    expect(tabsSource).toContain(
      "...(workspaceAppsTab ? [workspaceAppsTab] : []),",
    );
    expect(tabsSource).toContain(
      "if (offered.length === 0) {\n    return null;",
    );

    // Drawn after Direct Contact, the workspaces and the custom channels, before Webhooks.
    const drawnAt: (code: string) => number = (code: string): number => {
      const at: number = tabsSource.indexOf(code);

      expect([code, at > -1]).toEqual([code, true]);

      return at;
    };

    const drawn: Array<number> = [
      drawnAt('name: translationKey("Direct Contact")'),
      drawnAt("...(workspaceAppsTab ? [workspaceAppsTab] : []),"),
      drawnAt("...(customChannelsTab ? [customChannelsTab] : []),"),
      drawnAt("getPushNotificationsTab(isPushTurnedOff),"),
      drawnAt('name: translationKey("Webhooks")'),
    ];

    expect(drawn).toEqual(
      [...drawn].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
  });

  it("puts each card on its tab, in the tab's order, under its own title", () => {
    const directContact: string = tabsSource.slice(
      tabsSource.indexOf('name: translationKey("Direct Contact")'),
      tabsSource.indexOf("...(workspaceAppsTab"),
    );

    expect(directContact.indexOf("<UserEmail />")).toBeLessThan(
      directContact.indexOf("<UserSMS />"),
    );
    expect(directContact.indexOf("<UserSMS />")).toBeLessThan(
      directContact.indexOf("<UserCall />"),
    );
    expect(directContact.indexOf("<UserCall />")).toBeLessThan(
      directContact.indexOf("<UserWhatsApp />"),
    );
    expect(directContact.indexOf("<UserWhatsApp />")).toBeLessThan(
      directContact.indexOf("<UserTelegram />"),
    );

    const rows: Array<string> = tableRows(section(methods, "## Pick a method"));

    expect(
      rows.map((row: string): Array<string> => {
        const cells: Array<string> = tableCells(row);

        return [
          boldNames(cells[0] || "")[0] || "",
          boldNames(cells[1] || "")[0] || "",
        ];
      }),
    ).toEqual(
      CARDS.map((entry: { component: string; tab: string }): Array<string> => {
        return [cardTitle(entry.component), entry.tab];
      }),
    );
  });

  it("verifies email, SMS, call and WhatsApp with a 6-digit code that lasts 15 minutes, five tries, and a new one a minute later", () => {
    const verification: string = readCommonSource(
      "Server/Utils/ChannelVerification.ts",
    );

    expect(verification.match(DEFAULT_MINUTES)?.[1]).toBe("15");
    expect(verification.match(DEFAULT_ATTEMPTS)?.[1]).toBe("5");
    expect(verification.match(DEFAULT_COOLDOWN)?.[1]).toBe("60");
    expect(
      readCommonSource("Server/Utils/VerificationCode.ts").match(
        CODE_LENGTH,
      )?.[1],
    ).toBe("6");

    expect(methods).toContain("are verified with a 6-digit code.");
    expect(methods).toContain(
      "- A code works for 15 minutes. Five wrong tries cancel it, and you need a new one.",
    );
    expect(methods).toContain("You can ask for one a minute after the last.");
  });

  it("names the verify dialog's field, button and send-again controls as the dialog does", () => {
    expect(VerificationCodeCopy.codeFieldTitle).toBe("Verification Code");
    expect(VerificationCodeCopy.verifyButtonText).toBe("Verify");
    expect(
      getVerificationCodeChannel(VerificationCodeChannel.SMS)
        .sendCodeButtonText,
    ).toBe("Send a new code");
    expect(
      getVerificationCodeChannel(VerificationCodeChannel.Call)
        .sendCodeButtonText,
    ).toBe("Call me with a new code");
    expect(methods).toContain(
      "Type the code into **Verification Code** and click **Verify**.",
    );
    expect(methods).toContain(
      "**Send a new code**, or **Call me with a new code** for a call number, is in the dialog.",
    );
  });

  it("names each add button as the list draws it: Add, and the method's name", () => {
    const buttons: Array<
      [string, { singularName?: string | null | undefined }]
    > = [
      ["SMS", new UserSMS()],
      ["Telegram", new UserTelegram()],
      ["Webhook", new UserWebhook()],
    ];

    for (const [name, model] of buttons) {
      expect({
        name,
        verb: component(name).includes('createVerb={"Add"}'),
      }).toEqual({ name, verb: true });
      expect(methods).toContain(`**Add ${model.singularName}**`);
    }

    // The others' buttons, should a page name them.
    expect(new UserEmail().singularName).toBe("Email for Notifications");
    expect(new UserCall().singularName).toBe("Phone Number for Calls");
    expect(new UserWhatsApp().singularName).toBe("WhatsApp Number");
  });

  it("verifies a call number that is verified for SMS without a code, both ways", () => {
    expect(component("Call")).toContain(
      "A number you have verified for SMS is verified for calls too, with no new code.",
    );

    const callService: string = readCommonSource(
      "Server/Services/UserCallService.ts",
    );

    expect(callService).toContain("isNumberVerifiedForSms");
    expect(callService).toContain("verifyNumbersProvenBySms");
    expect(methods).toContain(
      "Adding it under **Phone Numbers for Call Notifications** needs no code, and verifying an SMS number also verifies the call number you added for it.",
    );
  });

  it("links Telegram through the bot, with the dialog's own words", () => {
    const telegram: string = component("Telegram");

    for (const label of [
      'title: "Telegram Handle (optional)"',
      'title={"Verify Telegram Account"}',
      '"Open in Telegram"',
      "I've sent the message — check",
      'title: "Rotate Code"',
    ]) {
      expect({ label, found: telegram.includes(label) }).toEqual({
        label,
        found: true,
      });
    }

    expect(readCommonSource("Server/API/UserTelegramAPI.ts")).toContain(
      'startCommand: verificationCode ? `/start ${verificationCode}` : "",',
    );
    // Rotate Code is offered only on an account that is not verified yet.
    expect(telegram).toContain(
      'title: "Rotate Code",\n            buttonStyleType: ButtonStyleType.NORMAL,\n            icon: IconProp.Refresh,\n            isVisible: (item: UserTelegram): boolean => {\n              return !item["isVerified"];',
    );
    expect(methods).toContain(
      "**Rotate Code** makes a new code for an account that is not verified yet.",
    );
  });

  it("adds Slack and Microsoft Teams accounts verified, from an account linked to the workspace", () => {
    for (const [name, button, service] of [
      ["Slack", "Add Slack Account", "UserSlackService"],
      [
        "MicrosoftTeams",
        "Add Microsoft Teams Account",
        "UserMicrosoftTeamsService",
      ],
    ] as Array<[string, string, string]>) {
      expect(component(name)).toContain(`title: "${button}"`);
      expect(component(name)).toContain('title: "Send Test Message"');
      expect(readCommonSource(`Server/Services/${service}.ts`)).toContain(
        "createBy.data.isVerified = true;",
      );
      expect(methods).toContain(`**${button}**`);
    }
  });

  it("registers phones and browsers for push, tests them, and shows their critical alert state", () => {
    const push: string = component("Push");

    for (const label of [
      'title: "Register Device"',
      'title: "Device Name"',
      'title: "Test Notification"',
      'title: "Critical Alerts"',
      'text="Not receiving notifications"',
    ]) {
      expect({ label, found: push.includes(label) }).toEqual({
        label,
        found: true,
      });
    }

    expect(methods).toContain(
      "Click **Register Device**, give it a **Device Name**, and allow notifications when the browser asks.",
    );
  });

  describe("webhooks", () => {
    const webhookComponent: string = component("Webhook");
    const sender: string = readPackageFile(
      "App/FeatureSet/Notification/Services/WebhookService.ts",
    );
    const ruleService: string = readCommonSource(
      "Server/Services/UserNotificationRuleService.ts",
    );

    it("asks for a name, an address and an optional signing secret, and sends a test event", () => {
      for (const field of [
        "Name",
        "Webhook URL",
        "Signing Secret (optional)",
      ]) {
        expect(webhookComponent).toContain(`title: "${field}"`);
        expect(methods).toContain(`**${field}**`);
      }

      expect(webhookComponent).toContain('title: "Send Test"');
      expect(readCommonSource("Server/API/UserWebhookAPI.ts")).toContain(
        'eventType: "test",',
      );
      expect(methods).toContain(
        "Your endpoint receives an event whose `eventType` is `test`.",
      );
    });

    it("posts JSON with the event in a header, signed with sha256= HMAC of the raw body, within 10 seconds, following no redirect", () => {
      expect(sender).toContain(`"${WEBHOOK_EVENT_HEADER}": message.eventType,`);
      expect(sender).toContain(
        `headers["${WEBHOOK_SIGNATURE_HEADER}"] = \`sha256=\${signature}\`;`,
      );
      expect(sender).toContain('.createHmac("sha256", message.secret)');
      expect(sender).toContain(".update(bodyString)");
      expect(sender).toContain("doNotFollowRedirects: true,");
      expect(sender.match(WEBHOOK_TIMEOUT)?.[1]).toBe("10_000");

      expect(methods).toContain(
        "Answer with any `2xx` status within 10 seconds; redirects are not followed.",
      );
      expect(methods).toContain(
        `Every request carries \`${WEBHOOK_EVENT_HEADER}\`, the event type. With a signing secret, it also carries \`${WEBHOOK_SIGNATURE_HEADER}\`: \`sha256=\` followed by the HMAC-SHA256 of the raw body, in hex.`,
      );
    });

    it("lists the four event types a page is posted under, with the key its record is under", () => {
      for (const entry of WEBHOOK_EVENT_TYPES) {
        expect(ruleService).toContain(`eventType: "${entry.eventType}",`);
        expect(ruleService).toContain(`${entry.recordKey}: {`);
      }

      const rows: Array<Array<string>> = tableRows(
        methods.slice(methods.indexOf("| `eventType` |")),
      ).map((row: string): Array<string> => {
        return tableCells(row);
      });

      expect(
        rows.map((cells: Array<string>): Array<string> => {
          return [cells[0] as string, cells[2] as string];
        }),
      ).toEqual(
        WEBHOOK_EVENT_TYPES.map(
          (entry: { eventType: string; recordKey: string }): Array<string> => {
            return [`\`${entry.eventType}\``, `\`${entry.recordKey}\``];
          },
        ),
      );
    });

    it("shows a page with exactly the fields an incident's page carries", () => {
      const example: Record<string, unknown> = JSON.parse(
        codeBlocks(methods, "json")[0] as string,
      ) as Record<string, unknown>;
      const incidentPayload: string = functionSource(
        ruleService,
        'eventType: "on-call.incident.created",\n          entityKind: "incident",',
        "onCallPolicyEscalationRuleId:",
      );

      expect(example["eventType"]).toBe("on-call.incident.created");

      for (const key of Object.keys(example)) {
        if (key === "onCallPolicyEscalationRuleId") {
          continue;
        }

        expect({ key, sent: incidentPayload.includes(`${key}:`) }).toEqual({
          key,
          sent: true,
        });
      }

      for (const key of Object.keys(
        example["incident"] as Record<string, unknown>,
      )) {
        expect({ key, sent: incidentPayload.includes(`${key}:`) }).toEqual({
          key,
          sent: true,
        });
      }

      expect(Object.keys(example)).toEqual([
        "eventType",
        "timestamp",
        "projectId",
        "userId",
        "incident",
        "onCallPolicyId",
        "onCallPolicyEscalationRuleId",
      ]);
    });

    it("gives a signature check that accepts what OneUptime signs, and refuses anything else", () => {
      const code: string = codeBlocks(methods, "javascript")[0] as string;
      const sandbox: {
        Buffer: typeof Buffer;
        require: (name: string) => unknown;
        isFromOneUptime?: (
          rawBody: string,
          header: string | undefined,
          secret: string,
        ) => boolean;
      } = {
        Buffer: Buffer,
        require: (name: string): unknown => {
          expect(name).toBe("crypto");
          return crypto;
        },
      };

      vm.runInNewContext(
        `${code}\nthis.isFromOneUptime = isFromOneUptime;`,
        sandbox,
      );

      const check: (
        rawBody: string,
        header: string | undefined,
        secret: string,
      ) => boolean = sandbox.isFromOneUptime as (
        rawBody: string,
        header: string | undefined,
        secret: string,
      ) => boolean;
      const body: string = JSON.stringify(
        JSON.parse(codeBlocks(methods, "json")[0] as string),
      );
      // Signed exactly as WebhookService signs a request.
      const signed: string = `sha256=${crypto
        .createHmac("sha256", "s3cret")
        .update(body)
        .digest("hex")}`;

      expect(check(body, signed, "s3cret")).toBe(true);
      expect(check(body, signed, "another")).toBe(false);
      expect(check(`${body} `, signed, "s3cret")).toBe(false);
      expect(check(body, undefined, "s3cret")).toBe(false);
      expect(check(body, signed.toUpperCase(), "s3cret")).toBe(false);
    });

    it("adds a webhook's rules as it is created, and refuses private addresses unless the server allows them", () => {
      const service: string = readCommonSource(
        "Server/Services/UserWebhookService.ts",
      );

      expect(service).toContain(
        "Webhooks skip verification, so default on-call rules are seeded at create time.",
      );
      expect(service).toContain("allowPrivateNetworkTargets: true,");
      expect(methods).toContain(
        "A webhook needs no verification, so adding one adds its rules at once.",
      );
    });

    it("posts the updates switched on in Notification Settings to the same endpoint, with a summary", () => {
      const settingService: string = readCommonSource(
        "Server/Services/UserNotificationSettingService.ts",
      );
      const payload: string = settingService.slice(
        settingService.indexOf("const webhookPayload: JSONObject = {"),
        settingService.indexOf(
          "};",
          settingService.indexOf("const webhookPayload: JSONObject = {"),
        ),
      );

      expect(payload).toContain("eventType: data.eventType,");
      expect(payload).toContain('subject: data.emailEnvelope?.subject || "",');
      expect(payload).toContain('message: data.smsMessage?.message || "",');
      expect(methods).toContain(
        "The updates you turn on for Webhook in **Notification Settings** arrive at the same endpoint, with the setting's event in `eventType` and a short summary in `subject` and `message`.",
      );
    });
  });

  describe("the channels a project turns on", () => {
    it("are SMS, Phone Calls, WhatsApp and Telegram, each off in a new project", () => {
      expect(
        PROJECT_NOTIFICATION_CHANNELS.map(
          (definition: ProjectNotificationChannelDefinition): string => {
            return definition.title;
          },
        ),
      ).toEqual(["SMS", "Phone Calls", "WhatsApp", "Telegram"]);

      for (const definition of PROJECT_NOTIFICATION_CHANNELS) {
        const column: { defaultValue?: unknown } =
          new Project().getTableColumnMetadata(definition.column) as {
            defaultValue?: unknown;
          };

        expect({ column: definition.column, off: column.defaultValue }).toEqual(
          { column: definition.column, off: false },
        );
      }

      expect(methods).toContain(
        "**SMS**, **Phone Calls**, **WhatsApp** and **Telegram** start off in every new project",
      );
    });

    it("are turned on by a project owner, a Billing Admin or someone with Manage Billing, never a project admin", () => {
      expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS]).toEqual([
        Permission.ProjectOwner,
        Permission.BillingAdmin,
        Permission.ManageProjectBilling,
      ]);
      expect(PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS).not.toContain(
        Permission.ProjectAdmin,
      );
      expect(WHO_MAY_TURN_THEM_ON).toBe(
        "a project owner, a Billing Admin or someone with Manage Billing",
      );
      expect(PermissionHelper.getTitle(Permission.BillingAdmin)).toBe(
        "Billing Admin",
      );
      expect(PermissionHelper.getTitle(Permission.ManageProjectBilling)).toBe(
        "Manage Billing",
      );
      expect(ProjectNotificationChannelsCopy.cardTitle).toBe(
        "Notification Channels",
      );
      expect(
        sectionByTitle(projectSettingsMenu(), "Notifications").items,
      ).toEqual(
        expect.arrayContaining(["Notification Settings", "Notification Logs"]),
      );
      expect(methods).toContain(
        "A project owner, a **Billing Admin** or someone with **Manage Billing** turns it on, in the **Notification Channels** card on **Project Settings → Notifications → Notification Settings**. A project admin cannot.",
      );
    });
  });

  it("deletes a method's rules with it, and says so before it does", () => {
    const guard: string = component("NotificationMethod");

    expect(guard).toContain('title: "Delete",');
    expect(guard).toContain(
      "Deleting a notification method also deletes every notification rule that uses it.",
    );
    expect(methods).toContain(
      "Deleting a method deletes every on-call rule that uses it",
    );
  });
});

// ---- Personal on-call rules ---------------------------------------------------

describe("personal on-call rules", () => {
  const rules: string = english(PERSONAL_ON_CALL_RULES);
  const table: string = readDashboardSource(
    "Components/NotificationRule/OnCallRulesTable.tsx",
  );

  it("has a tab per kind, in order, each with cards for the severities that band it", () => {
    const rows: Array<Array<string>> = tableRows(
      section(rules, "## The four tabs"),
    ).map((row: string): Array<string> => {
      return tableCells(row);
    });

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return [boldNames(cells[0] || "")[0] || "", cells[2] as string];
      }),
    ).toEqual(
      ON_CALL_RULE_KIND_DEFINITIONS.map(
        (definition: OnCallRuleKindDefinition): Array<string> => {
          return [
            definition.tabName,
            definition.severityForeignKeyColumn === "incidentSeverityId"
              ? "Incident severities"
              : "Alert severities",
          ];
        },
      ),
    );
  });

  it("names the open tab in the address, with the bare address on Incidents", () => {
    expect(ON_CALL_RULE_KIND_QUERY_PARAM).toBe("type");
    expect(ON_CALL_RULES_PAGE_PATH).toBe("on-call-rules");
    expect(DEFAULT_ON_CALL_RULE_KIND).toBe(OnCallRuleKind.Incidents);
    expect(Object.values(MOVED_ON_CALL_RULES_PATHS)).toHaveLength(4);
    expect(rules).toContain(
      `\`/dashboard/{projectId}/user-settings/${ON_CALL_RULES_PAGE_PATH}?${ON_CALL_RULE_KIND_QUERY_PARAM}=${OnCallRuleKind.Alerts}\``,
    );
    expect(rules).toContain(
      `the other values are \`${OnCallRuleKind.IncidentEpisodes}\` and \`${OnCallRuleKind.AlertEpisodes}\``,
    );
  });

  it("offers the delays the rule form offers, in order", () => {
    const options: Array<string> = captures(
      readDashboardSource(
        "Components/NotificationRule/NotifyAfterMinutesDropdownOptions.ts",
      ),
      LABEL_OPTION,
    );

    expect(options).toEqual([
      "Immediately",
      "5 minutes",
      "10 minutes",
      "15 minutes",
      "30 minutes",
      "1 hour",
    ]);
    expect(rules).toContain(
      `Pick **Notify me after**: ${options
        .slice(0, -1)
        .map((option: string): string => {
          return `**${option}**`;
        })
        .join(", ")} or **${options[options.length - 1]}**.`,
    );
  });

  it("names the add button, the form's fields and the list's columns as the card draws them", () => {
    expect(new UserNotificationRule().singularName).toBe("Notification Rule");
    expect(table).toContain('createVerb={"Add"}');
    expect(rules).toContain("Click **Add Notification Rule**.");

    for (const title of [
      'title: "Notification Method",',
      'title: "Push notification",',
      'title: "Repeat until acknowledged",',
      'translator.translateTemplate("Notify me after")',
      'title: "Notify After",',
    ]) {
      expect({ title, found: table.includes(title) }).toEqual({
        title,
        found: true,
      });
    }

    // The list is in order of the delay.
    expect(table).toContain('sortBy="notifyAfterMinutes"');
    expect(table).toContain("sortOrder={SortOrder.Ascending}");
    expect(rules).toContain(
      "The card lists its rules in order of their delay, with **Notification Method** and **Notify After** for each one.",
    );
  });

  it("edits only the delay: the method is not offered when editing", () => {
    const methodField: string = table.slice(
      table.indexOf('overrideFieldKey: "notificationMethod"'),
      table.indexOf(
        "doNotShowWhenEditing: true",
        table.indexOf('overrideFieldKey: "notificationMethod"'),
      ),
    );

    expect(methodField).toContain('title: "Notification Method"');
    expect(rules).toContain(
      "- **Edit** on a rule's row changes its delay. To send a rule to another method, delete it and add a new one.",
    );
  });

  it("sounds a phone's push as a critical alert or standard, starting critical", () => {
    const level: string = readDashboardSource(
      "Components/NotificationRule/PushNotificationLevelControl.tsx",
    );

    expect(level).toContain('title: translationKey("Critical alert"),');
    expect(level).toContain('title: translationKey("Standard"),');
    expect(level).toContain(
      '"Rings even when the phone is on silent or in Do Not Disturb.",',
    );
    expect(level).toContain(
      '"Follows the phone\'s sound, silent and Do Not Disturb settings.",',
    );
    expect(
      (
        new UserNotificationRule().getTableColumnMetadata(
          "pushNotificationLevel",
        ) as { defaultValue?: unknown }
      ).defaultValue,
    ).toBe(PushNotificationLevel.Critical);

    const rows: Array<string> = tableRows(section(rules, "## Push rules"));

    expect(rowStartingWith(rows, "**Critical alert**")[1]).toContain(
      "Rings even when the phone is on silent or in Do Not Disturb",
    );
    expect(rowStartingWith(rows, "**Standard**")[1]).toBe(
      "Follows the phone's sound, silent and Do Not Disturb settings.",
    );
    expect(rowStartingWith(rows, "**Critical alert**")[1]).toContain(
      "A new phone rule starts here.",
    );
  });

  it("repeats a push at the intervals the form offers, up to 10 more times, not at all by default", () => {
    const repeat: string = readDashboardSource(
      "Components/NotificationRule/PushRepeatControl.tsx",
    );
    const labels: Array<string> = captures(
      repeat.slice(
        repeat.indexOf("PUSH_REPEAT_DROPDOWN_OPTIONS"),
        repeat.indexOf("];", repeat.indexOf("PUSH_REPEAT_DROPDOWN_OPTIONS")),
      ),
      LABEL_OPTION,
    );

    expect(labels).toEqual([
      "Don't repeat",
      ...REPEAT_EVERY_MINUTES_OPTIONS.map((minutes: number): string => {
        return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
      }),
    ]);
    expect(MAX_NOTIFICATION_REPEATS).toBe(10);
    expect(NO_NOTIFICATION_REPEAT).toBe(0);
    expect(
      (
        new UserNotificationRule().getTableColumnMetadata(
          "repeatEveryMinutes",
        ) as { defaultValue?: unknown }
      ).defaultValue,
    ).toBe(NO_NOTIFICATION_REPEAT);

    expect(rules).toContain(
      `**${labels[0]}**, the default, or ${labels
        .slice(1, -1)
        .map((label: string): string => {
          return `**${label}**`;
        })
        .join(", ")} or **${labels[labels.length - 1]}**.`,
    );
    expect(rules).toContain(
      `It repeats up to ${MAX_NOTIFICATION_REPEATS} more times, and stops as soon as the incident, alert or episode is acknowledged.`,
    );
  });

  it("asks a phone for its push sound, and any push device for its repeat", () => {
    expect(table).toContain("isExpoPushDeviceType(device.deviceType)");
    expect(rules).toContain(
      "For a phone, pick **Push notification**: **Critical alert** or **Standard**. For any push device, pick **Repeat until acknowledged**.",
    );
  });

  it("runs each rule once its delay has passed, every minute, and stops the rest when the page is acknowledged", () => {
    const pending: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions.ts",
    );

    expect(pending).toContain("EVERY_MINUTE");
    for (const record of [
      "incident",
      "alert",
      "alert episode",
      "incident episode",
    ]) {
      expect(pending).toContain(
        `"Execution completed because ${record} is acknowledged."`,
      );
    }
    expect(rules).toContain(
      "Acknowledging the incident or alert, from any message or in OneUptime, stops every rule that has not fired yet.",
    );
  });

  it("lets the messages acknowledge: a link in most of them, and a key to press in a call", () => {
    const ruleService: string = readCommonSource(
      "Server/Services/UserNotificationRuleService.ts",
    );

    expect(ruleService).toContain(
      "introMessage: `To acknowledge this alert, press 1. ${getOnCallPageCallPassOnPrompt()}`,",
    );
    // A text's one link acknowledges the page (Utils/Sms/OnCallPageSms).
    expect(ON_CALL_PAGE_SMS_ACTION).toBe("Ack or escalate:");
    expect(ruleService).toContain(
      "link: await this.buildOnCallAcknowledgeShortUrl(",
    );
    expect(ruleService).toContain(">Tap to acknowledge</a>");
    expect(ruleService).toContain("[Acknowledge](${data.ackUrl.toString()})");
    expect(ruleService).toContain(
      "acknowledge_url: acknowledgeUrl.toString(),",
    );
    expect(rules).toContain("and a call asks you to press 1.");
  });

  /*
   * "Can't take it? Escalate" (tasks oncall-page-pass-on and
   * escalate-incident-copy): the same messages escalate the page to the
   * policy's next level, and a call asks for 2. The page says so beside
   * acknowledging, and links to where the Escalation Rules page says what
   * escalating does.
   */
  it("lets the messages escalate a page: the same messages, and a key to press in a call", () => {
    const ruleService: string = readCommonSource(
      "Server/Services/UserNotificationRuleService.ts",
    );

    expect(ON_CALL_PAGE_CALL_PASS_ON_DIGIT).toBe("2");
    expect(getOnCallPageCallPassOnPrompt()).toBe(
      `If you can't take it, press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to escalate.`,
    );
    expect(ruleService).toContain(
      '`⬆️ <a href="${this.escapeTelegramHtml(passOnUrl.toString())}">${CANT_TAKE_IT_ESCALATE}</a>`',
    );
    expect(ruleService).toContain(
      "mdText`⬆️ [${CANT_TAKE_IT_ESCALATE}](${data.passOnUrl.toString()})`",
    );
    expect(rules).toContain(
      `When you cannot take a page, the same messages let you escalate it, and a call asks you to press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT}: the policy pages its next level straight away, and you are not paged again for it. See [Escalating a page](/docs/on-call/escalation-rules#escalating-a-page).`,
    );
  });

  it("covers a new severity within minutes, with the choices already made on its tab, or the verified email", () => {
    const backfill: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities.ts",
    );

    expect(backfill).toContain("schedule: EVERY_FIVE_MINUTE");
    expect(backfill).toContain("mirroredRules");
    expect(backfill).toContain('methodColumn: "userEmailId",');
    expect(backfill).toContain("notifyAfterMinutes: 0,");
    expect(backfill).toContain("if (intent.hasOptOut) {");
    expect(rules).toContain(
      "A severity your project adds later gets rules within a few minutes, made from the choices you already made on that tab: the same methods, after the same delays. If you had no rules on that tab, it gets your verified email, at once.",
    );
  });

  it("emails a person whose rules someone else changed, and audits every change", () => {
    const ruleService: string = readCommonSource(
      "Server/Services/UserNotificationRuleService.ts",
    );

    expect(ruleService).toContain("private async reportAdministrativeChange(");
    expect(ruleService).toContain(
      "One audit entry per ROW, because that is what an investigator reconstructs",
    );
    expect(ruleService).toContain("at most one mail per PERSON");
    expect(rules).toContain(
      "When someone else adds, changes or deletes your rules, you get an email about it, and each change is in the project's audit log.",
    );
  });

  it("has no quiet hours to point at: neither a rule nor a setting has such a column", () => {
    for (const model of [
      "Models/DatabaseModels/UserNotificationRule.ts",
      "Models/DatabaseModels/UserNotificationSetting.ts",
    ]) {
      const source: string = readCommonSource(model);

      expect({ model, column: QUIET_COLUMN.test(source) }).toEqual({
        model,
        column: false,
      });
    }

    expect(rules).toContain("Your own rules have no quiet hours");
  });

  /*
   * What waits for working hours is an alert's or incident's on-call rule
   * (OnCallRuleWhenToPage), not a person's: the page points there, by the
   * answer the rule's form gives, and the rule models carry the setting.
   */
  it("points at the on-call rule that pages only during working hours, for everyone", () => {
    expect(rules).toContain(
      "To make a low-severity page wait for working hours for everyone, set the on-call rule that pages it to **Only during working hours**: see [On-call rules](/docs/alerts/settings#on-call-rules).",
    );
    // The answer the rule's form gives, as the page bolds it.
    expect(readDashboardSource("Utils/Form/EventRuleForm.ts")).toContain(
      '"Only during working hours"',
    );
    expect(
      readCommonSource(
        "Models/DatabaseModels/DatabaseBaseModel/OnCallRuleBaseModel.ts",
      ),
    ).toContain("public whenToPage?");
  });

  it("names the rules' own kinds as Common names them", () => {
    expect(
      ON_CALL_RULE_KIND_DEFINITIONS.map(
        (definition: OnCallRuleKindDefinition): NotificationRuleType => {
          return definition.ruleType;
        },
      ),
    ).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ]);
  });
});

// ---- Notification settings ----------------------------------------------------

interface SettingsSection {
  title: string;
  eventTypes: Array<string>;
}

describe("notification settings", () => {
  const settings: string = english(NOTIFICATION_SETTINGS);
  const page: string = readDashboardSource(
    "Pages/UserSettings/NotificationSettings.tsx",
  );
  const settingService: string = readCommonSource(
    "Server/Services/UserNotificationSettingService.ts",
  );

  // The event names of the page's EVENT_LIBRARY, by enum member name.
  function eventLabels(): Record<string, string> {
    const library: string = page.slice(
      page.indexOf("const EVENT_LIBRARY"),
      page.indexOf("interface SectionDef"),
    );
    const labels: Record<string, string> = {};

    for (const match of Array.from(library.matchAll(EVENT_ENTRY))) {
      labels[match[1] as string] = match[2] as string;
    }

    return labels;
  }

  // The cards of a tab: `const incidents: Array<SectionDef> = [...]`.
  function tabSections(constant: string): Array<SettingsSection> {
    const start: number = page.indexOf(`const ${constant}: Array<SectionDef>`);
    const block: string = page.slice(start, page.indexOf("];", start));

    return block
      .split("buildSection(")
      .slice(1)
      .map((part: string): SettingsSection => {
        return {
          title: captures(part, QUOTED_STRING)[0] as string,
          eventTypes: captures(part, EVENT_TYPE_NAME),
        };
      });
  }

  const TABS: Array<{ name: string; constant: string }> = [
    { name: "Incidents", constant: "incidents" },
    { name: "Alerts", constant: "alerts" },
    { name: "Monitoring", constant: "monitoring" },
    { name: "Status Pages", constant: "statusPages" },
    { name: "Scheduled Maintenance", constant: "scheduledMaintenance" },
    { name: "On-Call", constant: "onCall" },
    { name: "Security", constant: "security" },
  ];

  /*
   * The events a new member starts with, by enum member name: what
   * addDefaultNotificationSettingsForUser adds, all of it by email, and the
   * ones it adds with push too.
   */
  function defaults(): { email: Set<string>; push: Set<string> } {
    const entry: string = functionSource(
      settingService,
      "public async addDefaultNotificationSettingsForUser(",
      "public async addIncomingCallNotificationSettings(",
    );
    const helpers: Array<string> = captures(entry, ADD_HELPER_CALL);
    const email: Set<string> = new Set<string>();
    const push: Set<string> = new Set<string>();
    const visit: (name: string) => void = (name: string): void => {
      const start: number = settingService.search(
        new RegExp(`(?:public|private) async ${escapeRegExp(name)}\\(`),
      );
      const body: string = settingService.slice(
        start,
        settingService.indexOf("\n  }\n", start),
      );

      for (const call of body
        .split("addNotificationSettingIfNotExists(")
        .slice(1)) {
        const type: string | undefined = captures(call, EVENT_TYPE_NAME)[0];

        if (!type) {
          continue;
        }

        email.add(type);

        if (call.slice(0, call.indexOf(");")).includes("alertByPush: true")) {
          push.add(type);
        }
      }

      for (const nested of captures(body, ADD_HELPER_CALL)) {
        visit(nested);
      }
    };

    for (const helper of helpers) {
      visit(helper);
    }

    return { email, push };
  }

  it("has the tabs the page draws, in its order", () => {
    const tabs: string = page.slice(page.indexOf("<Tabs"));

    expect(captures(tabs, NAME_PROPERTY)).toEqual(
      TABS.map((tab: { name: string }): string => {
        return tab.name;
      }),
    );
    expect(settings).toContain(
      `The tabs are ${TABS.slice(0, -1)
        .map((tab: { name: string }): string => {
          return `**${tab.name}**`;
        })
        .join(", ")} and **${TABS[TABS.length - 1]?.name}**.`,
    );
  });

  it("names its channels as the matrix's columns do, Slack and Microsoft Teams only when connected", () => {
    const channels: Array<string> = captures(
      page.slice(
        page.indexOf("const CHANNELS"),
        page.indexOf("];", page.indexOf("const CHANNELS")),
      ),
      LABEL_OPTION,
    );

    expect(channels).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Slack",
      "Microsoft Teams",
      "Webhook",
      // A server's custom channels: a column only while one is on.
      "Custom Channels",
    ]);
    expect(page).toContain("workspaceType: WorkspaceType.Slack,");
    expect(page).toContain("workspaceType: WorkspaceType.MicrosoftTeams,");
    expect(page).toContain("isCustomChannels: true,");

    const columns: string =
      "Email, SMS, Call, Push, WhatsApp, Telegram, Slack and Microsoft Teams, and Webhook.";

    expect(settings).toContain(
      `${columns} Slack and Microsoft Teams are columns only when the project has connected them.`,
    );

    /*
     * Every column by the label the matrix draws, in its order: the page
     * names no column otherwise. The Microsoft Teams column was labelled
     * "Teams", a word most languages translate as teams of people.
     */
    let from: number = 0;

    for (const channel of channels) {
      if (channel === "Custom Channels") {
        continue;
      }

      const at: number = columns.indexOf(channel, from);

      expect({ channel, named: at >= 0 }).toEqual({ channel, named: true });
      from = at + channel.length;
    }

    /*
     * The custom channels' column is there only on a server whose admin
     * turned a custom channel on, so it is named, by its label, where custom
     * channels are.
     */
    expect(english("self-hosted/custom-notification-channels")).toContain(
      "**User Settings > Notification Settings**, which has a **Custom Channels** column while a channel is on.",
    );
  });

  it("sends to every verified method of a channel that is on, and nothing without a setting", () => {
    expect(settingService).toContain("// get all the emails of the user.");
    expect(settingService).toContain("isVerified: true,");
    expect(settingService).toContain(
      "since sendUserNotification no-ops when no row exists",
    );
    expect(page).toContain(
      '"Click any channel to switch it on or off. Changes save automatically."',
    );
    expect(settings).toContain(
      "A channel that is on sends to every verified method you have on it in this project, not just one.",
    );
    expect(settings).toContain("Changes save automatically.");
  });

  it("lists, tab by tab, the events a new member starts with, and the rest", () => {
    const labels: Record<string, string> = eventLabels();
    const { email, push } = defaults();
    const rows: Array<string> = tableRows(
      section(settings, "## What is on for a new member"),
    );

    for (const tab of TABS) {
      const cells: Array<string> = rowStartingWith(rows, `**${tab.name}**`);
      const events: Array<string> = tabSections(tab.constant).flatMap(
        (card: SettingsSection): Array<string> => {
          return card.eventTypes;
        },
      );
      const on: Array<string> = events
        .filter((type: string): boolean => {
          return email.has(type);
        })
        .map((type: string): string => {
          return labels[type] as string;
        });
      const off: Array<string> = events
        .filter((type: string): boolean => {
          return !email.has(type);
        })
        .map((type: string): string => {
          return labels[type] as string;
        });

      expect({
        tab: tab.name,
        on: [...boldNames(cells[1] || "")].sort(),
      }).toEqual({ tab: tab.name, on: [...on].sort() });
      expect({
        tab: tab.name,
        off: [...boldNames(cells[2] || "")].sort(),
      }).toEqual({ tab: tab.name, off: [...off].sort() });

      if (on.length === 0) {
        expect(cells[1]).toBe("None");
      }

      if (off.length === 0) {
        expect(cells[2]).toBe("None");
      }
    }

    // The two shift reminders and the five security case events start on by push too, and they alone.
    const byPush: Array<string> = Array.from(push).map(
      (type: string): string => {
        return labels[type] as string;
      },
    );

    expect(byPush.sort()).toEqual(
      [
        "Before my on-call shift starts",
        "My upcoming on-call shift is reassigned",
        "New security case",
        "Security case assigned to me",
        "Playbook step waiting for my approval",
        "Security case response target",
        "Security case task assigned to me",
      ].sort(),
    );
    expect(settings).toContain(
      "and by push too: **Before my on-call shift starts**, **My upcoming on-call shift is reassigned**",
    );
    expect(settings).toContain(
      "| **Security** | By push too: **New security case** (High and Critical cases), **Security case assigned to me**, **Playbook step waiting for my approval**, **Security case response target**, **Security case task assigned to me** | None |",
    );
  });

  it("warns that a monitor's status changes are off for a new member", () => {
    const { email } = defaults();

    expect(email.has("SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION")).toBe(
      false,
    );
    expect(
      eventLabels()["SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION"],
    ).toBe("Monitor status changed");
    expect(settings).toContain(
      "> **Monitor status changed** starts off. To hear when a monitor you own goes down or comes back, switch it on, on the **Monitoring** tab.",
    );
  });

  it("puts each card on the tab the page says, under its title", () => {
    expect(
      tabSections("incidents").map((card: SettingsSection): string => {
        return card.title;
      }),
    ).toContain("Incident Episodes");
    expect(
      tabSections("onCall").map((card: SettingsSection): string => {
        return card.title;
      }),
    ).toEqual(["On-Call", "Incoming Call Policies"]);
    expect(settings).toContain(
      "such as **Incident Episodes** on the **Incidents** tab.",
    );
    expect(settings).toContain(
      "- **Missed call**, on the **Incoming Call Policies** card,",
    );
  });

  it("tells a record's owners, members of its owner teams included, or the project's owners when it has none, but tells only the person added that they were", () => {
    const jobs: string = path.join(PACKAGES_DIR, "App/FeatureSet/Workers/Jobs");

    for (const job of [
      "IncidentOwners/SendCreatedResourceNotification.ts",
      "AlertOwners/SendStateChangeNotification.ts",
      "MonitorOwners/SendStatusChangeNotification.ts",
      "ScheduledMaintenanceOwners/SendNotePostedNotification.ts",
      "StatusPageOwners/SendAnnouncementCreatedNotification.ts",
    ]) {
      expect({
        job,
        fallsBack: fs
          .readFileSync(path.join(jobs, job), "utf8")
          .includes("ProjectService.getOwners("),
      }).toEqual({ job, fallsBack: true });
    }

    for (const job of [
      "IncidentOwners/SendOwnerAddedNotification.ts",
      "AlertOwners/SendOwnerAddedNotification.ts",
      "MonitorOwners/SendOwnerAddedNotification.ts",
    ]) {
      expect({
        job,
        fallsBack: fs
          .readFileSync(path.join(jobs, job), "utf8")
          .includes("ProjectService.getOwners("),
      }).toEqual({ job, fallsBack: false });
    }

    expect(readCommonSource("Server/Services/AlertService.ts")).toContain(
      "AlertOwnerTeamService.findBy(",
    );
    expect(settings).toContain(
      "When a record has no owners, it goes to the project's owners instead.",
    );
  });

  it("names the link every owner email ends with, in the email's own English words", () => {
    const footer: string = readPackageFile(
      "App/FeatureSet/Notification/Templates/Partials/UnsubscribeOwnerEmail.hbs",
    );

    for (const text of ENGLISH_TEXT[NOTIFICATION_SETTINGS] || []) {
      expect(footer).toContain(`>${text}</a>`);
      expect(settings).toContain(`"${text}"`);
    }

    expect(settingService).toContain("/user-settings/notification-settings");
  });

  it("points at Email Preferences' two cards for fewer emails", () => {
    const noise: string = readDashboardSource(
      "Components/EmailPreferences/EmailNoiseCard.tsx",
    );
    const rollup: string = readDashboardSource(
      "Components/EmailPreferences/EmailRollupCard.tsx",
    );

    expect(rollup).toContain('title="Email Rollup"');
    expect(noise).toContain('title="Fewer routine emails"');
    expect(noise).toContain('"Reduce routine emails"');
    expect(
      sectionByTitle(userSettingsMenu(), "Alerts & Notifications").items,
    ).toContain("Email Preferences");
    expect(settings).toContain(
      "- **Fewer routine emails** switches off, with **Reduce routine emails**,",
    );
  });

  it("sends shift reminders at the times picked on the Calendar Feed page", () => {
    expect(page).toContain(
      '"Reminders ahead of a shift, at the lead times you pick on the Calendar Feed page."',
    );
    expect(sectionByTitle(userSettingsMenu(), "Calendar").items).toEqual([
      "Calendar Feed",
    ]);
    expect(settings).toContain(
      "**Before my on-call shift starts** sends reminders at the times you pick on **User Settings → Calendar → Calendar Feed**",
    );
  });
});

// ---- The On-Call Logs a person reads ------------------------------------------

describe("the On-Call Logs a page leaves", () => {
  it("lists every page with View Timeline and View Status Message", () => {
    const logs: string = readDashboardSource(
      "Pages/UserSettings/OnCallLogs.tsx",
    );

    expect(logs).toContain('viewButtonText={"View Timeline"}');
    expect(logs).toContain('title: "View Status Message",');
    expect(logs).toContain("UserNotificationExecutionStatus.Error");
    expect(english(PERSONAL_ON_CALL_RULES)).toContain(
      "**View Timeline** shows every message it sent and whether it was delivered.",
    );
    expect(english(REACHING_YOU)).toContain(
      "For a row whose status is **Error**, **View Status Message** says why",
    );
  });
});

// ---- Every list a page names is the product's ---------------------------------

describe("the words the pages use for the product", () => {
  it("quote every Dashboard source they name verbatim, so a rename is caught", () => {
    // Spot checks that the strings asserted above still exist where they live.
    expect(
      quotedListConstant(
        readCommonSource("UI/Components/SideMenu/SideMenuSectionState.ts"),
        "SECTION_TITLES_COLLAPSED_BY_DEFAULT",
      ),
    ).toEqual(expect.arrayContaining(["On-Call Logs", "Workspace"]));
  });
});
