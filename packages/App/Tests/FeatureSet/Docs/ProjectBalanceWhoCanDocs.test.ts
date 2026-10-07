import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  PROJECT_BALANCE_RECHARGE_PERMISSIONS,
  ProjectBalanceType,
  WHO_CAN_ADD_PROJECT_BALANCE,
} from "Common/Utils/Project/ProjectBalance";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say who may add to a project's prepaid balances the way the
 * product does: a project owner or someone with Manage Billing - the people
 * POST /notification/recharge and POST /ai/recharge let in, and the Auto
 * Recharge columns' own update permissions - not a project admin.
 *
 * Every docs language says it on Users, Teams & Permissions, right after
 * the paragraph on who may turn SMS, phone calls, WhatsApp and Telegram on:
 * both balances, both pages, who can recharge them and change their Auto
 * Recharge, and that only those people get a working Recharge Balance
 * button or a link. Each language names the pages, the button and the card
 * the way its dashboard does, and keeps the permission's English name.
 *
 * The English AI SRE page no longer offers auto-recharge as a way to start
 * on the global provider; what Auto Recharge does when the credits run out
 * is its own section (AiCreditsRunOutDocs).
 */

const DOCS_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// A page's paragraphs, list blocks and headings, in order.
function readParagraphs(lang: string, relative: string): Array<string> {
  return fs
    .readFileSync(path.join(DOCS_ROOT, lang, relative), "utf8")
    .split(/\n\s*\n/)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${lang}.json`),
      "utf8",
    ),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

/*
 * How each language names the people who may add balance - the same words
 * its docs use for who may turn a messaging channel on. The permission
 * keeps its English name, as the dashboard shows it.
 */
const WHO_MAY_ADD: Record<string, string> = {
  en: "project owner or someone with",
  da: "projektejer eller nogen med",
  de: "Projekteigentümer oder jemand mit",
  es: "propietario del proyecto o alguien con",
  fa: "مالک پروژه یا کسی که",
  fr: "propriétaire du projet ou une personne disposant de",
  hi: "प्रोजेक्ट का मालिक या",
  it: "proprietario del progetto o qualcuno con",
  ja: "プロジェクトのオーナーまたは",
  ko: "프로젝트 소유자 또는",
  nl: "projecteigenaar of iemand met",
  no: "prosjekteier eller noen med",
  pt: "proprietário do projeto ou alguém com",
  ru: "владелец проекта или пользователь с разрешением",
  sv: "projektägare eller någon med",
  "zh-CN": "项目所有者或拥有",
  "zh-TW": "專案擁有者或擁有",
};

const MANAGE_BILLING: string = "**Manage Billing**";

// The paragraph on who may turn the messaging channels on.
const CHANNELS_PARAGRAPH_MARK: string = "`ManageProjectBilling`";

interface PermissionsPage {
  channels: string;
  balances: string;
}

/*
 * The channels paragraph, and the one right after it - which must be the
 * only paragraph of the page naming Manage Billing without the permission's
 * code name.
 */
function readPermissionsPage(lang: string): PermissionsPage {
  const paragraphs: Array<string> = readParagraphs(
    lang,
    path.join("permissions", "index.md"),
  );
  const channels: Array<number> = paragraphs
    .map((paragraph: string, index: number): number => {
      return paragraph.includes(CHANNELS_PARAGRAPH_MARK) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect(channels).toHaveLength(1);

  return {
    channels: paragraphs[channels[0]!]!,
    balances: paragraphs[channels[0]! + 1] || "",
  };
}

// The bold settings paths a paragraph names, in order.
function boldPathsIn(paragraph: string): Array<string> {
  return paragraph
    .split("**")
    .filter((part: string, index: number): boolean => {
      return index % 2 === 1 && part.includes(" > ");
    });
}

describe("the people the docs name", () => {
  test("are the people the recharge routes and the Auto Recharge columns let in", () => {
    expect([...PROJECT_BALANCE_RECHARGE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);

    const project: Project = new Project();

    for (const balance of Object.values(ProjectBalanceType)) {
      for (const column of PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[balance]) {
        expect([
          column,
          project.getColumnAccessControlFor(column)?.update,
        ]).toEqual([
          column,
          [Permission.ProjectOwner, Permission.ManageProjectBilling],
        ]);
      }
    }

    expect(WHO_CAN_ADD_PROJECT_BALANCE).toBe(
      "a project owner or someone with Manage Billing",
    );
  });

  test("every docs language has its words for them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(Object.keys(WHO_MAY_ADD).sort()).toEqual([...LANGUAGES].sort());
  });

  test("the pages the docs name are where the dashboard puts them", () => {
    const menu: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "Settings", "SideMenu.tsx"),
      "utf8",
    );

    // [section, page]: each page sits in its section, before the next one.
    for (const [section, page] of [
      ["Notifications", "Notification Settings"],
      ["AI", "AI Credits"],
    ] as Array<[string, string]>) {
      const start: number = menu.indexOf(`title: "${section}",`);
      const next: number = menu.indexOf("\n    {\n      title:", start + 1);
      const at: number = menu.indexOf(`title: "${page}",`, start);

      expect([section, page, start > -1, at > start, at < next]).toEqual([
        section,
        page,
        true,
        true,
        true,
      ]);
    }
  });
});

describe("Users, Teams & Permissions (English)", () => {
  const { balances } = readPermissionsPage("en");

  test("says recharging either balance is billing: an owner or Manage Billing, not a project admin", () => {
    expect(balances).toBe(
      "Recharging the project's prepaid balances counts as billing too. On OneUptime Cloud, SMS, phone calls, WhatsApp and Telegram are paid from the balance on **Project Settings > Notifications > Notification Settings**, and AI from the AI credits on **Project Settings > AI > AI Credits**. Only a project owner or someone with **Manage Billing** can recharge them or change their **Auto Recharge** — a project admin cannot. A message about a balance that has run low names who can add to it, and only those people get a working **Recharge Balance** button or a link to the page.",
    );
  });

  test("names the people in the product's own words", () => {
    // "a project owner or someone with **Manage Billing**"
    expect(balances).toContain(
      WHO_CAN_ADD_PROJECT_BALANCE.replace("Manage Billing", MANAGE_BILLING),
    );
  });
});

describe.each(LANGUAGES)("the %s docs", (lang: string) => {
  const locale: Record<string, string> = readDashboardLocale(lang);

  test("Users, Teams & Permissions: right after the channels, who can recharge both balances, where", () => {
    const { channels, balances } = readPermissionsPage(lang);

    // The notification settings page, as the channels paragraph writes it.
    const channelPaths: Array<string> = boldPathsIn(channels);

    expect(channelPaths).toHaveLength(1);

    const notificationSettings: string = channelPaths[0]!;
    const projectSettings: string = notificationSettings.split(" > ")[0]!;

    /*
     * The AI credits page in the same language as the docs' own path: the
     * dashboard's words, or English where the docs keep the English path.
     */
    const aiCredits: string =
      projectSettings === "Project Settings"
        ? "Project Settings > AI > AI Credits"
        : `${locale["Project Settings"]} > ${locale["AI"]} > ${locale["AI Credits"]}`;

    expect(projectSettings).toBe(
      projectSettings === "Project Settings"
        ? "Project Settings"
        : locale["Project Settings"],
    );
    expect(boldPathsIn(balances)).toEqual([notificationSettings, aiCredits]);

    expect(balances).toContain(WHO_MAY_ADD[lang]!);
    expect(balances).toContain(MANAGE_BILLING);
    expect(balances).toContain(`**${locale["Auto Recharge"]}**`);
    expect(balances).toContain(`**${locale["Recharge Balance"]}**`);
    expect(balances).toContain("WhatsApp");
    expect(balances).toContain("Telegram");

    // The permission's code name stays on the channels paragraph alone.
    expect(balances).not.toContain(CHANNELS_PARAGRAPH_MARK);
  });
});

describe("AI SRE (English)", () => {
  const page: string = fs
    .readFileSync(path.join(DOCS_ROOT, "en", "ai", "ai-sre.md"), "utf8")
    .replace(/\s*\n\s*/g, " ");

  test("the global provider needs AI credits, which an owner or Manage Billing adds", () => {
    expect(page).toContain(
      "so the project needs AI credits: a project owner or someone with **Manage Billing** adds them on **Project Settings > AI > AI Credits**, where **Auto Recharge** keeps them from running out.",
    );
  });

  test("does not offer auto-recharge as a way to start", () => {
    expect(page).not.toMatch(/AI credits[^.]*\) or auto-recharge/i);
  });
});
