import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The shortened descriptions say "acknowledge" and "resolve" the way each
 * language's own Acknowledge and Resolve buttons and states do.
 *
 * The Linked Alerts card shows a switch title and its description one under
 * the other: "Resolve Linked Alerts When Incident Is Resolved" and "Resolving
 * the incident resolves its linked alerts...". When the descriptions were
 * shortened, several languages translated the verb afresh - German "gelöst"
 * under a title that says "behoben", Russian "решён" under "устранить",
 * French "acquitté" under "pris en compte", Korean "확인" under "인지" - so
 * a title and the line right under it named one action two ways. Each
 * language's word is read here from its own Acknowledge / Resolve labels,
 * and every description below that uses the English verb has to use it.
 *
 * The same holds the SCIM descriptions to the name the Enable Push Groups
 * switch gives push groups in each language.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

/*
 * The stem of each language's word for the action. A word that changes its
 * form keeps the stem: German "behoben" / "beheben" / "behebt", Dutch
 * "opgelost" / "oplossen" / "op te lossen". Persian draws Resolve as "رفع"
 * on the button and "برطرف" on the state, so both count there.
 */
const ACKNOWLEDGE_STEMS: Record<string, Array<string>> = {
  da: ["bekræft"],
  de: ["bestätig"],
  es: ["reconoc"],
  fa: ["تأیید"],
  fr: [
    "pris en compte",
    "prise en compte",
    "prendre en compte",
    "prend en compte",
  ],
  hi: ["स्वीकार", "स्वीकृत"],
  it: ["riconosc"],
  ja: ["確認"],
  ko: ["인지"],
  nl: ["bevestig"],
  no: ["bekreft"],
  pt: ["confirm"],
  ru: ["подтвер"],
  sv: ["bekräft"],
  "zh-CN": ["确认"],
  "zh-TW": ["確認"],
};

const RESOLVE_STEMS: Record<string, Array<string>> = {
  da: ["løs"],
  de: ["behob", "beheb"],
  es: ["resuel", "resolv"],
  fa: ["برطرف", "رفع"],
  fr: ["résol", "résou"],
  hi: ["सुलझ"],
  it: ["risol"],
  ja: ["解決"],
  ko: ["해결"],
  nl: ["opgelost", "oplossen", "lossen", "los ", "lost "],
  no: ["løs"],
  pt: ["resolv", "resoluç"],
  ru: ["устран"],
  sv: ["lös"],
  "zh-CN": ["解决"],
  "zh-TW": ["解決"],
};

// The descriptions that name an incident or alert being acknowledged.
const ACKNOWLEDGING_DESCRIPTIONS: Array<string> = [
  "Whether alerts linked to an incident follow it when it is acknowledged or resolved. Both are on for new projects. Alerts never move back to an earlier state.",
  "Acknowledging the incident acknowledges its linked alerts and stops their on-call escalations.",
  "The time between two moments in an incident, like time to acknowledge. OneUptime charts it for every incident, so you see if your team gets faster.",
  "The state incidents from this template start in. Leave empty for the usual one; starting acknowledged or resolved pages no one.",
];

// The descriptions that name an incident, alert or exception being resolved.
const RESOLVING_DESCRIPTIONS: Array<string> = [
  "Whether alerts linked to an incident follow it when it is acknowledged or resolved. Both are on for new projects. Alerts never move back to an earlier state.",
  "Resolving the incident resolves its linked alerts, unless an alert is linked to another open incident.",
  "Count exceptions marked as resolved too. A resolved exception that happens again is always counted.",
  "How long after an alert or incident resolves before this rule may open another. Defaults to the long window.",
  "Resolve the alert when the long window's burn rate drops below the threshold.",
  "Resolve the incident when the long window's burn rate drops below the threshold.",
  "Only remove {{nodeName}} if it has been removed from the Proxmox cluster. Its Node Offline alert then resolves. If it reports again, it comes back.",
  "OneUptime stops measuring this SLO and resolves its open burn rate alerts and incidents. History and settings are kept.",
  "OneUptime AI archives exceptions that are expected, such as a refused sign-in, so they stop showing as unresolved.",
  "The state incidents from this template start in. Leave empty for the usual one; starting acknowledged or resolved pages no one.",
  "Keep a group's alert or incident open until a log with these attributes arrives. Leave empty to resolve a group when its logs stop.",
  "Each matching email opens its own alert. Replies are added to it as notes until it is resolved.",
  "Each matching email opens its own incident and alert. Replies are added as notes until they are resolved.",
  "Each matching email opens its own incident. Replies are added to it as notes until it is resolved.",
];

// The Linked Alerts card: each switch's title and the line under it.
const LINKED_ALERTS_SWITCHES: Array<{
  title: string;
  description: string;
  stems: Record<string, Array<string>>;
}> = [
  {
    title: "Acknowledge Linked Alerts When Incident Is Acknowledged",
    description:
      "Acknowledging the incident acknowledges its linked alerts and stops their on-call escalations.",
    stems: ACKNOWLEDGE_STEMS,
  },
  {
    title: "Resolve Linked Alerts When Incident Is Resolved",
    description:
      "Resolving the incident resolves its linked alerts, unless an alert is linked to another open incident.",
    stems: RESOLVE_STEMS,
  },
];

// Each language's name for push groups, as its Enable Push Groups switch says it.
const PUSH_GROUPS_NAMES: Record<string, string> = {
  da: "push-grupper",
  de: "push-gruppen",
  es: "grupos push",
  fa: "گروه\u200cهای پوش",
  fr: "groupes push",
  hi: "पुश समूह",
  it: "gruppi push",
  ja: "プッシュグループ",
  ko: "푸시 그룹",
  nl: "push-groepen",
  no: "push-grupper",
  pt: "grupos de push",
  ru: "push-групп",
  sv: "push-grupper",
  "zh-CN": "推送组",
  "zh-TW": "推送群組",
};

const PUSH_GROUPS_DESCRIPTIONS: Array<string> = [
  "Your identity provider manages team membership. Turn off Push Groups in Project Settings > Security > SCIM to invite people here.",
  "Manage team membership with your identity provider's push groups instead of adding people to default teams.",
];

function usesOneOf(text: string, stems: Array<string>): boolean {
  const lower: string = text.toLowerCase();

  return stems.some((stem: string): boolean => {
    return lower.includes(stem.toLowerCase());
  });
}

describe("the action words a description shares with the buttons", () => {
  const english: Record<string, string> = readLocale("en");

  test("every description here is an English key the Dashboard uses", () => {
    for (const text of [
      ...ACKNOWLEDGING_DESCRIPTIONS,
      ...RESOLVING_DESCRIPTIONS,
      ...PUSH_GROUPS_DESCRIPTIONS,
    ]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s: the stems are the ones its own Acknowledge and Resolve labels use",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const label of ["Acknowledge", "Acknowledged"]) {
        expect([label, translations[label]]).toEqual([
          label,
          expect.any(String),
        ]);
        expect([
          label,
          usesOneOf(translations[label] || "", ACKNOWLEDGE_STEMS[locale]!),
        ]).toEqual([label, true]);
      }

      for (const label of ["Resolve", "Resolved"]) {
        expect([label, translations[label]]).toEqual([
          label,
          expect.any(String),
        ]);
        expect([
          label,
          usesOneOf(translations[label] || "", RESOLVE_STEMS[locale]!),
        ]).toEqual([label, true]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s: a description that acknowledges says it with the Acknowledge word",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of ACKNOWLEDGING_DESCRIPTIONS) {
        const translated: string = translations[text] || "";

        expect([
          text,
          translated,
          usesOneOf(translated, ACKNOWLEDGE_STEMS[locale]!),
        ]).toEqual([text, translated, true]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s: a description that resolves says it with the Resolve word",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of RESOLVING_DESCRIPTIONS) {
        const translated: string = translations[text] || "";

        expect([
          text,
          translated,
          usesOneOf(translated, RESOLVE_STEMS[locale]!),
        ]).toEqual([text, translated, true]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s: each Linked Alerts switch and the line under it name the action alike",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const item of LINKED_ALERTS_SWITCHES) {
        const stems: Array<string> = item.stems[locale]!;

        expect([
          item.title,
          usesOneOf(translations[item.title] || "", stems),
        ]).toEqual([item.title, true]);
        expect([
          item.description,
          usesOneOf(translations[item.description] || "", stems),
        ]).toEqual([item.description, true]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s: the SCIM descriptions call push groups what the Enable Push Groups switch does",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const name: string = PUSH_GROUPS_NAMES[locale]!;

      expect(
        (translations["Enable Push Groups"] || "").toLowerCase(),
      ).toContain(name);

      for (const text of PUSH_GROUPS_DESCRIPTIONS) {
        expect([text, (translations[text] || "").toLowerCase()]).toEqual([
          text,
          expect.stringContaining(name),
        ]);
      }
    },
  );
});
