import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import {
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
import ProjectNotificationChannelsCopy, {
  getProjectNotificationChannel,
} from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say who may turn on a project's SMS, phone calls, WhatsApp and
 * Telegram the way the product does: a project owner, a Billing Admin or
 * someone with Manage Billing (the four columns' own update permissions) -
 * not a project admin.
 * Held to the model here, so the docs cannot keep naming the people after the
 * permissions change, or the reverse.
 *
 * Every docs language says it, on the same five pages: Users, Teams &
 * Permissions; Escalation Rules; status page Subscribers; Incoming Call
 * Policy; and the self-hosted Twilio page, where the channels have to be on
 * before anyone can add a phone number. Each language names the card the way
 * its dashboard does, and the settings page the way its own docs already do.
 */

const CONTENT_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const CONTENT: string = path.join(CONTENT_ROOT, "en");

const DASHBOARD_LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// Line breaks read as one space, so a claim may wrap anywhere.
function readPage(relative: string): string {
  return fs
    .readFileSync(path.join(CONTENT, relative), "utf8")
    .replace(/\s*\n\s*/g, " ");
}

function readRawPage(lang: string, relative: string): string {
  return fs.readFileSync(path.join(CONTENT_ROOT, lang, relative), "utf8");
}

// A page's paragraphs, list blocks and headings, in order.
function readParagraphs(lang: string, relative: string): Array<string> {
  return readRawPage(lang, relative)
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
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

const CARD: string = `**${ProjectNotificationChannelsCopy.cardTitle}**`;
const PAGE: string =
  "**Project Settings > Notifications > Notification Settings**";

/*
 * How each language names a project owner, the first of the people who may
 * turn a channel on: a project owner, a Billing Admin or someone with Manage
 * Billing. The role and the permission keep their English names, as the
 * dashboard's permission picker shows them.
 */
const PROJECT_OWNER: Record<string, string> = {
  en: "project owner",
  da: "projektejer",
  de: "Projekteigentümer",
  es: "propietario del proyecto",
  fa: "مالک پروژه",
  fr: "propriétaire du projet",
  hi: "प्रोजेक्ट का मालिक",
  it: "proprietario del progetto",
  ja: "プロジェクトのオーナー",
  ko: "프로젝트 소유자",
  nl: "projecteigenaar",
  no: "prosjekteier",
  pt: "proprietário do projeto",
  ru: "владелец проекта",
  sv: "projektägare",
  "zh-CN": "项目所有者",
  "zh-TW": "專案擁有者",
};

const BILLING_ADMIN: string = "**Billing Admin**";
const MANAGE_BILLING: string = "**Manage Billing**";

/*
 * The three people who may turn a channel on, named in `text` in the
 * language's words and in the product's order: a project owner, a Billing
 * Admin, someone with Manage Billing.
 */
function expectNamesWhoMay(lang: string, text: string): void {
  const owner: number = text.indexOf(PROJECT_OWNER[lang] || "-");
  const billingAdmin: number = text.indexOf(BILLING_ADMIN, owner + 1);
  const manageBilling: number = text.indexOf(MANAGE_BILLING, billingAdmin + 1);

  expect({
    lang,
    namesTheOwner: owner >= 0,
    thenTheBillingAdmin: owner >= 0 && billingAdmin > owner,
    thenManageBilling: billingAdmin >= 0 && manageBilling > billingAdmin,
  }).toEqual({
    lang,
    namesTheOwner: true,
    thenTheBillingAdmin: true,
    thenManageBilling: true,
  });
}

/*
 * The users' phone number section's last step: the number is verified by a
 * code sent as a text - "SMS", or the language's own word for one.
 */
const VERIFIED_BY_TEXT_STEP: RegExp = /^3\. .*(sms|短信|簡訊|پیامک)/im;

// The status page Subscribers line about SMS, in any language.
function readSmsSubscribersLine(lang: string): string {
  const lines: Array<string> = readRawPage(lang, "status-pages/subscribers.md")
    .split("\n")
    .filter((line: string): boolean => {
      return line.includes("`enableSmsSubscribers`");
    });

  expect(lines).toHaveLength(1);

  return lines[0]!;
}

/*
 * The bold path to the Notification Settings page, as the language's docs
 * write it on the Subscribers page ("**Projekteinstellungen > ... >
 * Benachrichtigungseinstellungen**").
 */
function readSettingsPath(lang: string): string {
  const parts: Array<string> = readSmsSubscribersLine(lang).split("**");
  const paths: Array<string> = parts.filter(
    (part: string, index: number): boolean => {
      return index % 2 === 1 && part.includes(" > ");
    },
  );

  expect(paths).toHaveLength(1);

  return `**${paths[0]}**`;
}

// The one paragraph of a page that holds `needle`, and where it sits.
function findOnly(
  paragraphs: Array<string>,
  needle: string,
): { paragraph: string; index: number } {
  const indexes: Array<number> = paragraphs
    .map((paragraph: string, index: number): number => {
      return paragraph.includes(needle) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect(indexes).toHaveLength(1);

  return { paragraph: paragraphs[indexes[0]!]!, index: indexes[0]! };
}

describe("the people the docs name", () => {
  test("are the people the columns let in", () => {
    const project: Project = new Project();

    for (const channel of Object.values(ProjectNotificationChannel)) {
      const column: string =
        PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel];

      expect([
        column,
        project.getColumnAccessControlFor(column)?.update,
      ]).toEqual([
        column,
        [
          Permission.ProjectOwner,
          Permission.BillingAdmin,
          Permission.ManageProjectBilling,
        ],
      ]);
    }

    expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.BillingAdmin,
      Permission.ManageProjectBilling,
    ]);
  });

  test("every docs language has its words for them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(Object.keys(PROJECT_OWNER).sort()).toEqual([...LANGUAGES].sort());
  });
});

describe("Users, Teams & Permissions", () => {
  const page: string = readPage("permissions/index.md");

  test("says turning a channel on counts as billing: ProjectOwner, BillingAdmin and ManageProjectBilling, not ProjectAdmin", () => {
    expect(page).toContain(
      "Turning SMS, phone calls, WhatsApp or Telegram on or off for the project counts as billing, because every message costs money.",
    );
    expect(page).toContain(
      "Only `ProjectOwner`, the `BillingAdmin` role (**Billing Admin**) and the `ManageProjectBilling` permission (**Manage Billing**) can change those switches, on **Project Settings > Notifications > Notification Settings** — not `ProjectAdmin`.",
    );
  });
});

describe("Escalation Rules", () => {
  const page: string = readPage("on-call/escalation-rules.md");

  test("says the four channels start off, who can turn them on, and where", () => {
    expect(page).toContain(
      "SMS, phone calls, WhatsApp and Telegram start off in a new project",
    );
    expect(page).toContain(
      "Until a channel is on, nobody in the project can add a method on it.",
    );
    expect(page).toContain(
      `Only a project owner, a **Billing Admin** or someone with the **Manage Billing** permission can turn one on, in the ${CARD} card on ${PAGE} — a project admin cannot.`,
    );
    expect(page).toContain(
      "Everyone else is told exactly who can, wherever a channel is off",
    );
  });
});

describe("Status page subscribers", () => {
  const page: string = readPage("status-pages/subscribers.md");

  test("the SMS line names the project switch and who can turn it on", () => {
    expect(page).toContain(
      `Turning it on also needs **SMS** switched on for the project, in the ${CARD} card on ${PAGE}, which a project owner, a **Billing Admin** or someone with **Manage Billing** can do.`,
    );
  });
});

describe("Incoming Call Policy", () => {
  const page: string = readPage("on-call/incoming-call-policy.md");

  test("says incoming call numbers need SMS on, and who can turn it on", () => {
    expect(page).toContain(
      `Incoming call numbers are verified by SMS, so **SMS** has to be on for the project first. A project owner, a **Billing Admin** or someone with **Manage Billing** turns it on in the ${CARD} card on ${PAGE}.`,
    );
  });
});

describe("Twilio SMS and Voice Integration", () => {
  const page: string = readPage("self-hosted/twilio-integration.md");

  test("says SMS and phone calls start off, and who turns them on, next to the Twilio config", () => {
    expect(page).toContain(
      `**SMS** and **Phone Calls** start off in every project, and until they are on nobody in the project can add a phone number for them. A project owner, a **Billing Admin** or someone with **Manage Billing** turns them on in the ${CARD} card on the same page.`,
    );
  });

  test("the switches it names are the Notification Channels card's own rows", () => {
    for (const channel of [
      ProjectNotificationChannel.SMS,
      ProjectNotificationChannel.Call,
    ]) {
      expect(page).toContain(
        `**${getProjectNotificationChannel(channel).title}**`,
      );
    }
  });
});

describe("no docs page sends a reader to a project admin for a channel", () => {
  test.each([
    "permissions/index.md",
    "on-call/escalation-rules.md",
    "status-pages/subscribers.md",
    "on-call/incoming-call-policy.md",
    "self-hosted/twilio-integration.md",
  ])("%s", (relative: string) => {
    expect(readPage(relative)).not.toMatch(
      /(ask|needs?) a project admin[^.]*(SMS|call|WhatsApp|Telegram|channel)/i,
    );
  });
});

describe.each(LANGUAGES)("the %s docs", (lang: string) => {
  const locale: Record<string, string> = readDashboardLocale(lang);
  const settingsPath: string = readSettingsPath(lang);
  const card: string = `**${locale[ProjectNotificationChannelsCopy.cardTitle]}**`;

  test("Users, Teams & Permissions: changing the switches is billing - ProjectOwner, BillingAdmin and ManageProjectBilling, not ProjectAdmin", () => {
    const paragraphs: Array<string> = readParagraphs(
      lang,
      "permissions/index.md",
    );
    const found: { paragraph: string; index: number } = findOnly(
      paragraphs,
      "`ManageProjectBilling`",
    );

    expect(found.paragraph).toContain("`ProjectOwner`");
    expect(found.paragraph).toContain("`BillingAdmin`");
    expect(found.paragraph).toContain(BILLING_ADMIN);
    expect(found.paragraph).toContain(MANAGE_BILLING);
    expect(found.paragraph).toContain("`ProjectAdmin`");
    expect(found.paragraph).toContain(settingsPath);
    // The three who may, in the product's order, before the one who may not.
    expect(found.paragraph.indexOf("`ProjectOwner`")).toBeLessThan(
      found.paragraph.indexOf("`BillingAdmin`"),
    );
    expect(found.paragraph.indexOf("`BillingAdmin`")).toBeLessThan(
      found.paragraph.indexOf("`ManageProjectBilling`"),
    );

    // Right after the paragraph on what ProjectOwner and ProjectAdmin cover.
    const before: string = paragraphs[found.index - 1] || "";

    expect(before).toContain("`ProjectOwner`");
    expect(before).toContain("`ProjectAdmin`");
  });

  test("Escalation Rules: the channels start off, and who turns them on, where", () => {
    const paragraphs: Array<string> = readParagraphs(
      lang,
      "on-call/escalation-rules.md",
    );
    const found: { paragraph: string; index: number } = findOnly(
      paragraphs,
      MANAGE_BILLING,
    );

    expectNamesWhoMay(lang, found.paragraph);
    expect(found.paragraph).toContain(card);
    expect(found.paragraph).toContain(settingsPath);
    expect(found.paragraph).toContain("WhatsApp");
    expect(found.paragraph).toContain("Telegram");
    // The last word on how a person is reached, before editing rules.
    expect(paragraphs[found.index + 1]).toMatch(/^## /);
  });

  test("Subscribers: the SMS line says who can switch SMS on for the project", () => {
    const line: string = readSmsSubscribersLine(lang);

    expect(line).toContain(card);
    expect(line).toContain(settingsPath);
    expectNamesWhoMay(lang, line);
    // Who can comes after where the switch is.
    expect(line.indexOf(MANAGE_BILLING)).toBeGreaterThan(
      line.indexOf(settingsPath),
    );
  });

  test("Incoming Call Policy: numbers need SMS on, and who turns it on", () => {
    const paragraphs: Array<string> = readParagraphs(
      lang,
      "on-call/incoming-call-policy.md",
    );
    const found: { paragraph: string; index: number } = findOnly(
      paragraphs,
      MANAGE_BILLING,
    );
    const lines: Array<string> = found.paragraph
      .split("\n")
      .filter((line: string): boolean => {
        return line.includes(MANAGE_BILLING);
      });

    expect(lines).toHaveLength(1);

    const sentence: string = lines[0]!;

    expect(sentence).toContain("**SMS**");
    expectNamesWhoMay(lang, sentence);
    expect(sentence).toContain(card);
    expect(sentence).toContain(settingsPath);

    // The last word of the section on users' phone numbers, in every language.
    expect(paragraphs[found.index + 1]).toMatch(/^## /);

    let heading: number = found.index - 1;

    while (heading >= 0 && !paragraphs[heading]!.startsWith("## ")) {
      heading--;
    }

    const section: string = paragraphs
      .slice(heading + 1, found.index)
      .join("\n");

    // Its numbered steps end by verifying the number by text message.
    expect(section).toMatch(VERIFIED_BY_TEXT_STEP);
  });

  test("Twilio: SMS and phone calls start off, and who turns them on, on the same page", () => {
    const paragraphs: Array<string> = readParagraphs(
      lang,
      "self-hosted/twilio-integration.md",
    );
    const found: { paragraph: string; index: number } = findOnly(
      paragraphs,
      MANAGE_BILLING,
    );

    expect(found.paragraph).toContain("**SMS**");
    expect(found.paragraph).toContain(
      `**${locale[getProjectNotificationChannel(ProjectNotificationChannel.Call).title]}**`,
    );
    expectNamesWhoMay(lang, found.paragraph);
    expect(found.paragraph).toContain(card);

    // Straight after the steps that save a project's Twilio config.
    const steps: Array<string> = (paragraphs[found.index - 1] || "").split(
      "\n",
    );

    expect(steps[steps.length - 1]).toMatch(/^5\. /);
  });
});
