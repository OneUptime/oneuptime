import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ARABIC'S LOCALE FILES, EVERY APP.
 *
 * Arabic has a locale file wherever English has one: the Dashboard, the
 * status page, Accounts, the admin dashboard, public dashboards and the
 * server's own texts. Each holds exactly English's keys, in English's
 * order, with the same placeholders and tags, and none of the plural keys
 * English does not have. The small files are translated through; the
 * Dashboard starts with its most-used words. A count's general form reads
 * right for every count Arabic sends it (Locales/ARABIC.md).
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
  Server: "Common/Server/Locales",
};

type LocaleTree = { [key: string]: string | LocaleTree };

// The plural forms Arabic has that en.json never holds.
const UNUSED_PLURAL_FORM: RegExp = /_(zero|two|few|many)$/;
// ٠-٩ and the Persian ۰-۹: Arabic in OneUptime writes Latin digits.
const ARABIC_INDIC_DIGIT: RegExp = /[٠-٩۰-۹]/;
// An Arabic letter followed by a Latin comma, semicolon or question mark.
const LATIN_PUNCTUATION_AFTER_ARABIC: RegExp = /[ء-ي][,;?](?=\s|$)/;
/*
 * The Arabic word right after {{count}}: letters U+0621 to U+06D3, a range
 * written with escapes so no combining mark stands alone in the class.
 */
const WORD_AFTER_COUNT: RegExp = /\{\{count\}\}\s+([ء-ۓ]+)/g;

const readLocale: (app: string, code: string) => LocaleTree = (
  app: string,
  code: string,
): LocaleTree => {
  return JSON.parse(
    fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS[app] as string, `${code}.json`),
      "utf8",
    ),
  ) as LocaleTree;
};

// Every leaf, keyed by its path of keys (joined by a character no key has).
const leaves: (tree: LocaleTree, prefix?: string) => Map<string, string> = (
  tree: LocaleTree,
  prefix: string = "",
): Map<string, string> => {
  const found: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix}\u0000${key}` : key;

    if (typeof value === "string") {
      found.set(at, value);
    } else {
      for (const [inner, text] of leaves(value, at)) {
        found.set(inner, text);
      }
    }
  }

  return found;
};

const TOKEN: RegExp = /\{\{[^}]*\}\}|<\/?[A-Za-z][^<>]*>/g;

const tokensOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(TOKEN) || []).sort();
};

const APPS: Array<string> = Object.keys(LOCALE_DIRS);

/*
 * The small apps' texts Arabic writes as English does, on purpose: product
 * and vendor names, example values a person types over, and templates that
 * are only their values.
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  Accounts: ["OneUptime"],
  PublicDashboard: [],
  Server: [
    "{{first}} {{second}}",
    "{{hours}} {{minutes}}",
    "{{lead}}: {{record}}",
    "{{startDate}} - {{endDate}}",
    "{{title}}.",
  ],
  AdminDashboard: [
    "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321",
    "Amazon S3",
    "Azure Blob Storage",
    "Azure China",
    "Backblaze B2",
    "ClickHouse",
    "Cloudflare R2",
    "Company, Inc.",
    "EAAG...",
    "EU (Frankfurt)",
    "Google Cloud Storage",
    "HTTPS",
    "HackerBay, Inc.",
    "John Smith",
    "MinIO",
    "OneUptimeAlertsBot",
    "PostgreSQL",
    "Syslog",
    "Telegram",
    "Wasabi",
    "WhatsApp",
    "gpt-4o, claude-3-opus, llama-3.3-70b-versatile",
    "test@example.com",
    "vCenter",
    "{{size}} GB",
    "{{size}} KB",
    "{{size}} MB",
  ],
};

describe.each(APPS)("Arabic's %s locale", (app: string) => {
  const english: Map<string, string> = leaves(readLocale(app, "en"));
  const arabic: Map<string, string> = leaves(readLocale(app, "ar"));

  test("has exactly English's keys, in English's order", () => {
    expect(Array.from(arabic.keys())).toEqual(Array.from(english.keys()));
  });

  test("has none of the plural keys English does not have", () => {
    const extra: Array<string> = Array.from(arabic.keys()).filter(
      (key: string): boolean => {
        return UNUSED_PLURAL_FORM.test(key);
      },
    );

    expect(extra).toEqual([]);
  });

  test("keeps every placeholder and tag of the English", () => {
    const differ: Array<string> = [];

    for (const [key, text] of english) {
      const translated: string = arabic.get(key) as string;

      if (tokensOf(translated).join("|") !== tokensOf(text).join("|")) {
        differ.push(`${key}: ${translated}`);
      }
    }

    expect(differ).toEqual([]);
  });

  test("writes Latin digits, Arabic punctuation and no stray backslash", () => {
    const wrong: Array<string> = [];

    for (const [key, text] of english) {
      const translated: string = arabic.get(key) as string;

      if (translated === text) {
        continue;
      }

      if (ARABIC_INDIC_DIGIT.test(translated)) {
        wrong.push(`${key}: Arabic-Indic digits`);
      }

      if (LATIN_PUNCTUATION_AFTER_ARABIC.test(translated)) {
        wrong.push(`${key}: Latin punctuation after an Arabic letter`);
      }

      if (translated.includes("\\") && !text.includes("\\")) {
        wrong.push(`${key}: a backslash the English does not have`);
      }
    }

    expect(wrong).toEqual([]);
  });

  /*
   * i18next sends Arabic's general key for 0, 2, 3-10, 11-99 and 100+, so
   * it never reads "{{count}}" and then a bare singular noun: after the
   * count comes "من" ("N of the things"), a short unit the same for every
   * count, or nothing Arabic at all.
   */
  test("a count's general form reads right for every count", () => {
    const allowedAfterCount: Array<string> = [
      "من",
      "ث",
      "د",
      "س",
      "ي",
      "ش",
      "سنة",
      "منها",
      "غيرها",
      "أخرى",
      "الماضية",
    ];
    const wrong: Array<string> = [];

    for (const [key, text] of english) {
      if (key.endsWith("_one") || !english.has(`${key}_one`)) {
        continue;
      }

      const translated: string = arabic.get(key) as string;

      if (translated === text) {
        continue;
      }

      for (const match of translated.matchAll(WORD_AFTER_COUNT)) {
        if (!allowedAfterCount.includes(match[1] as string)) {
          wrong.push(`${key}: ${translated}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("a one form keeps the count wherever English's does", () => {
    const lost: Array<string> = [];

    for (const [key, text] of english) {
      if (!key.endsWith("_one") || !text.includes("{{count}}")) {
        continue;
      }

      const translated: string = arabic.get(key) as string;

      if (translated !== text && !translated.includes("{{count}}")) {
        lost.push(`${key}: ${translated}`);
      }
    }

    expect(lost).toEqual([]);
  });

  if (app !== "Dashboard" && app !== "StatusPage") {
    test("is translated through: only names and examples read as English", () => {
      const same: Array<string> = [];

      for (const [key, text] of english) {
        if (text.trim() !== "" && arabic.get(key) === text) {
          same.push(text);
        }
      }

      expect(Array.from(new Set(same)).sort()).toEqual(
        [...(SAME_AS_ENGLISH[app] as Array<string>)].sort(),
      );
    });
  }
});

describe("the Dashboard's most-used words, in Arabic", () => {
  const english: LocaleTree = readLocale("Dashboard", "en");
  const arabic: LocaleTree = readLocale("Dashboard", "ar");

  test("the products and pages every project opens are named in Arabic", () => {
    const expected: Record<string, string> = {
      Home: "الرئيسية",
      Monitors: "المراقبات",
      Incidents: "الحوادث",
      Alerts: "التنبيهات",
      "Status Pages": "صفحات الحالة",
      "On-Call Duty": "المناوبة",
      "Scheduled Maintenance": "الصيانة المجدولة",
      Settings: "الإعدادات",
      "Project Settings": "إعدادات المشروع",
      Logs: "السجلات",
      Traces: "التتبعات",
      Metrics: "المقاييس",
      Exceptions: "الاستثناءات",
      Workflows: "مهام سير العمل",
      Dashboards: "لوحات المعلومات",
      Runbooks: "أدلة التشغيل",
      "On-Call Policies": "سياسات المناوبة",
      "On-Call Schedules": "جداول المناوبة",
      "Incident Severity": "خطورة الحادثة",
      "Alert Severity": "خطورة التنبيه",
      "Monitor Status": "حالة المراقبة",
      Owners: "المالكون",
      Labels: "التسميات",
      "Declare Incident": "إعلان حادثة",
    };

    for (const [key, word] of Object.entries(expected)) {
      expect([key, english[key]]).toEqual([key, key]);
      expect([key, arabic[key]]).toEqual([key, word]);
    }
  });

  test("Span Type and Span Kind are two words, as the glossary says", () => {
    expect(arabic["Span Type"]).toBe("نوع الامتداد");
    expect(arabic["Span Kind"]).toBe("صنف الامتداد");

    const glossary: string = fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
      "utf8",
    );

    for (const word of [
      "المراقبة",
      "الحادثة",
      "التنبيه",
      "المناوبة",
      "نوع الامتداد / صنف الامتداد",
      "خطاف الويب",
    ]) {
      expect(glossary).toContain(word);
    }
  });

  /*
   * Home and an incident, looked at in Arabic in a browser, still showed
   * these in English: SLO badges on Home, the incident's facts and its AI
   * card. Each is Arabic now, in the glossary's words.
   */
  test("what Home and the incident page showed in English is Arabic", () => {
    const expected: Record<string, string> = {
      "At Risk": "معرّض للخطر",
      "Budget Exhausted": "استُنفدت الميزانية",
      "Incident Commander": "قائد الحادثة",
      "Root cause": "السبب الجذري",
      "AI root cause analysis": "تحليل السبب الجذري بالذكاء الاصطناعي",
      "What happened": "ما الذي حدث",
      "By {{name}}": "بواسطة {{name}}",
      "{{duration}} after impact began": "بعد {{duration}} من بدء التأثير",
      "Time to acknowledge": "وقت الإقرار",
      "Video Call": "مكالمة الفيديو",
    };

    for (const [key, word] of Object.entries(expected)) {
      expect([key, english[key]]).toEqual([key, key]);
      expect([key, arabic[key]]).toEqual([key, word]);
    }

    const glossary: string = fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
      "utf8",
    );

    expect(glossary).toContain("| Incident Commander | قائد الحادثة |");
    expect(glossary).toContain("| Grouping rule | قاعدة التجميع |");
  });
});

describe("the status page's uptime bars, in Arabic", () => {
  /*
   * "{{days}} days ago" is not a plural key: Arabic writes it for the 90
   * days every page starts with (11 to 99 take the singular يومًا), as
   * Locales/ARABIC.md says.
   */
  test("their far end reads right for the 90 days a page shows", () => {
    const english: LocaleTree = readLocale("StatusPage", "en");
    const arabic: LocaleTree = readLocale("StatusPage", "ar");

    expect((english["monitorOverview"] as LocaleTree)["daysAgo"]).toBe(
      "{{days}} days ago",
    );
    expect((arabic["monitorOverview"] as LocaleTree)["daysAgo"]).toBe(
      "قبل {{days}} يومًا",
    );
  });
});
