// UX rule: Docs/ux/README.md#in-every-language
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
 * English does not have. Every one is translated through: what reads as
 * English is a name, a code or an example, on a list that says so. A
 * count's general form reads right for every count Arabic sends it
 * (Locales/ARABIC.md).
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
// An Arabic letter first: the words before it were only part of a longer one.
const ARABIC_LETTER_FIRST: RegExp = /^[ء-ۓ]/;

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
 * The Dashboard's lists of what is right in English, beside its locales: one
 * for every language (i18n/SameAsEnglish.json) and Arabic's own, with its
 * progress baseline (i18n/Progress/ar.json). npm run i18n:apply --
 * --same-as-english records a text there (Locales/README.md).
 */
const DASHBOARD_TRACKING: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/i18n",
);

interface LocaleProgressFile {
  baseline: { keys: number; untranslated: number };
  sameAsEnglish: Array<string>;
}

const readJson: <T>(file: string) => T = <T>(file: string): T => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
};

// One Arabic letter, from hamza to yeh.
const ARABIC_LETTER: RegExp = /[ء-ي]/;
const LETTER: RegExp = /\p{L}/u;
const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

/*
 * A text with no letter once its {{placeholders}} are gone - "{{count}}%",
 * "{{a}} - {{b}}" - reads the same in every language, as npm run i18n:check
 * counts it.
 */
const hasLetters: (text: string) => boolean = (text: string): boolean => {
  return LETTER.test(text.replace(PLACEHOLDER, ""));
};

/*
 * Code inside an English sentence: `quoted`, a {{placeholder}}, a dotted
 * metric or attribute name (vcenter.host.disk.latency.max), key=value and a
 * CamelCase identifier (ServerSendLatency). A word there is a name, not
 * the word the glossary translates.
 */
const CODE_IN_PROSE: RegExp =
  /`[^`]*`|\{\{[^{}]*\}\}|\b[\w-]+(?:\.[\w-]+)+\b|\b\w+=\w+|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;

interface GlossaryWordInProse {
  name: string;
  english: RegExp;
  arabic: RegExp;
}

/*
 * ARABIC.md's words for three things the Dashboard names in well over a
 * hundred texts each, which two translations made side by side said
 * differently: latency had also been زمن الاستجابة (a monitor's response
 * time), a datastore Datastore and the inventory المخزون.
 */
const GLOSSARY_WORDS_IN_PROSE: Array<GlossaryWordInProse> = [
  { name: "Latency", english: /\blatenc(?:y|ies)\b/i, arabic: /انتقال/ },
  { name: "Datastore", english: /\bdata ?stores?\b/i, arabic: /مخزن|مخازن/ },
  { name: "Inventory", english: /\binventor(?:y|ies)\b/i, arabic: /جرد/ },
];

// Texts that name one of them as code would, though no code marks it so.
const NAMED_AS_CODE: Record<string, string> = {
  "e.g. latency": "an example of a log attribute's name",
};

// A function an English sentence names with its brackets: track(), grantConsent().
const FUNCTION_WITH_BRACKETS: RegExp = /[A-Za-z_][\w.]*\(\)/g;

/*
 * The small apps' texts Arabic writes as English does, on purpose: product
 * and vendor names, example values a person types over, and templates that
 * are only their values. The Test LLM Provider dialog's HTTP {{status}} is a
 * protocol name with a status code, kept in Latin letters as HTTPS is. The
 * shared time picker's HH and mm, and a time's {{time}} (UTC), are the
 * Admin Dashboard's copies of the Dashboard's words, which its own Arabic
 * list keeps as written (i18n/Progress/ar.json, #7567). So are the names of
 * the keys a shortcut is said with (keyboardKeys: Command, Shift, Tab ...),
 * which Arabic keyboards and Arabic Windows and macOS help print in Latin
 * letters (#7484).
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  Accounts: ["OneUptime"],
  PublicDashboard: [],
  StatusPage: [
    "+11234567890",
    "Apple Calendar / Outlook",
    "Google Calendar",
    "MS Teams",
    "Slack",
    "email@yourcompany.com",
    "https://example.com/webhook",
    "https://hooks.slack.com/services/...",
    "https://outlook.office.com/webhook/...",
    "my-company-workspace",
    "subscriber@company.com",
  ],
  Server: [
    "{{first}} {{second}}",
    "{{hours}} {{minutes}}",
    "{{lead}}: {{record}}",
    "{{startDate}} - {{endDate}}",
    "{{title}}.",
  ],
  AdminDashboard: [
    "8012345678:ABCdefGHIjklMNOpqrsTUVwxyz-0987654321",
    "Alt",
    "Amazon S3",
    "Azure Blob Storage",
    "Azure China",
    "Backblaze B2",
    "Backspace",
    "Ceph",
    "ClickHouse",
    "Cloudflare R2",
    "Command",
    "Company, Inc.",
    "Delete",
    "Docker",
    "Docker Swarm",
    "EAAG...",
    "EU (Frankfurt)",
    "Enter",
    "Google Cloud Storage",
    "HH",
    "HTTP {{status}}",
    "HTTPS",
    "HackerBay, Inc.",
    "IoT",
    "John Smith",
    "Kubernetes",
    "MinIO",
    "OneUptimeAlertsBot",
    "OpenStack",
    "Option",
    "Podman",
    "PostgreSQL",
    "Proxmox",
    "Shift",
    "Syslog",
    "Tab",
    "Telegram",
    "VMware",
    "Valkey",
    "Wasabi",
    "WhatsApp",
    "Windows",
    "gpt-4o, claude-3-opus, llama-3.3-70b-versatile",
    "mm",
    "test@example.com",
    "vCenter",
    "{{size}} GB",
    "{{size}} KB",
    "{{size}} MB",
    "{{time}} (UTC)",
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
      // Intl's short unit for a millisecond is two words, matched whole.
      "ملي ث",
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
        // What follows the count, from its first Arabic word on.
        const after: string = translated.slice(
          (match.index as number) +
            match[0].length -
            (match[1] as string).length,
        );
        const allowed: boolean = allowedAfterCount.some(
          (words: string): boolean => {
            return (
              after.startsWith(words) &&
              !ARABIC_LETTER_FIRST.test(after.slice(words.length))
            );
          },
        );

        if (!allowed) {
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

  // The Dashboard's lists live beside its locales: see below.
  if (app !== "Dashboard") {
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

describe("the Dashboard, translated through", () => {
  const english: Map<string, string> = leaves(readLocale("Dashboard", "en"));
  const arabic: Map<string, string> = leaves(readLocale("Dashboard", "ar"));
  const progress: LocaleProgressFile = readJson<LocaleProgressFile>(
    path.join(DASHBOARD_TRACKING, "Progress", "ar.json"),
  );
  const everyLanguagesList: Array<string> = readJson<Array<string>>(
    path.join(DASHBOARD_TRACKING, "SameAsEnglish.json"),
  );
  const rightInEnglish: Set<string> = new Set<string>([
    ...everyLanguagesList,
    ...progress.sameAsEnglish,
  ]);

  /*
   * A new Dashboard string arrives in ar.json as its English. Translate it
   * by ARABIC.md's rules (npm run i18n:apply -- --locale ar, as
   * Locales/README.md says) - or, for a name, a code or an example that
   * stays as written, record it with --same-as-english.
   */
  test("reads as English only where a same-as-English list says English is right", () => {
    const untranslated: Array<string> = [];

    for (const [key, text] of english) {
      if (
        arabic.get(key) === text &&
        hasLetters(text) &&
        !rightInEnglish.has(text)
      ) {
        untranslated.push(key);
      }
    }

    expect(untranslated).toEqual([]);
    // The check reads the whole file: tens of thousands of keys.
    expect(english.size).toBeGreaterThan(40000);
    expect(arabic.size).toBe(english.size);
  });

  test("its progress baseline counts nothing untranslated, so a translation turned back into English fails", () => {
    expect(progress.baseline.untranslated).toBe(0);
    expect(progress.baseline.keys).toBeGreaterThan(40000);
  });

  /*
   * The lists are for names, codes and examples: a word the glossary gives
   * an Arabic word for never passes as right in English.
   */
  test("no word the glossary translates is on a same-as-English list", () => {
    const glossary: string = fs
      .readFileSync(
        path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
        "utf8",
      )
      .split("## Glossary")[1] as string;
    const translatedTerms: Set<string> = new Set<string>();

    for (const row of glossary.matchAll(/^\| (.+?) \| (.+?) \|$/gm)) {
      const englishTerms: string = row[1] as string;
      const arabicWords: string = row[2] as string;

      // A term kept in Latin letters (OneUptime AI, huddle) is not translated.
      if (englishTerms === "English" || !ARABIC_LETTER.test(arabicWords)) {
        continue;
      }

      for (const term of englishTerms
        .replace(/\s*\([^)]*\)/g, "")
        .split(/ \/ |, /)) {
        translatedTerms.add(term.trim().toLowerCase());
      }
    }

    expect(translatedTerms).toContain("monitor");
    expect(translatedTerms).toContain("triage");
    expect(translatedTerms.size).toBeGreaterThan(80);
    expect(
      Array.from(rightInEnglish).filter((text: string): boolean => {
        return translatedTerms.has(text.toLowerCase());
      }),
    ).toEqual([]);
  });
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
      "On-Call": "المناوبة",
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

  /*
   * The UI review looked at an incident, an alert and both kinds of episode
   * in Arabic: these still showed in English - the line under Ask OneUptime
   * AI and its keyboard hint, the video call card, the sentence saying how
   * the monitor's criteria matched, the roles card's counts, the episode's
   * header facts and the card listing its incidents, and the alert's own
   * versions of what the incident page already said in Arabic.
   */
  test("what the incident, alert and episode pages still showed in English is Arabic", () => {
    const expected: Record<string, string> = {
      "Ask a follow-up question, or ask it to act.":
        "اطرح سؤال متابعة، أو اطلب منه اتخاذ إجراء.",
      "Everyone on this incident sees this conversation.":
        "يرى هذه المحادثة كل من يعمل على هذه الحادثة.",
      "Everyone on this alert sees this conversation.":
        "يرى هذه المحادثة كل من يعمل على هذا التنبيه.",
      "{{enter}} to send · {{shiftEnter}} for a new line":
        "{{enter}} للإرسال · {{shiftEnter}} لسطر جديد",
      "OneUptime AI has not tried to fix this alert.":
        "لم يحاول OneUptime AI إصلاح هذا التنبيه.",
      "Where this alert's responders talk it through.":
        "حيث يناقش المستجيبون لهذا التنبيه ما يجري.",
      "Your team's measurements, worked out for this alert.":
        "قياسات فريقك، محسوبة لهذا التنبيه.",
      "{{criteria}} matched when all of its filters did.":
        "تطابق المعيار {{criteria}} عندما تطابقت كل عوامل التصفية فيه.",
      "{{count}} members assigned": "الأعضاء المعيّنون: {{count}}",
      "{{count}} members assigned_one": "{{count}} عضو معيّن",
      "The last {{count}} minutes, {{type}}":
        "الدقائق الـ{{count}} الماضية، {{type}}",
      "Last incident added": "آخر حادثة أُضيفت",
      Grouping: "التجميع",
      "View all {{itemsName}}": "عرض كل {{itemsName}}",
      incidents: "الحوادث",
      alerts: "التنبيهات",
      "Response Status Code": "رمز حالة الاستجابة",
    };

    for (const [key, word] of Object.entries(expected)) {
      expect([key, english[key]]).not.toEqual([key, undefined]);
      expect([key, arabic[key]]).toEqual([key, word]);
    }

    /*
     * The video call card's sentence names its event through a placeholder
     * ("incident" or "alert"), so it is named after a fixed noun and keeps
     * the placeholder, as Locales/ARABIC.md asks.
     */
    expect(
      arabic[
        "Start a dedicated call so the {{eventNoun}}'s responders can talk it through."
      ],
    ).toContain("هذا الحدث ({{eventNoun}})");
  });

  /*
   * Degraded is a service that still works, but worse: متدهور, the word
   * Arabic status pages and monitoring tools use. متراجع ("receding") read
   * as a trend, not a state. It is the same word on the status page, in the
   * Dashboard and in the server's messages.
   */
  test("Degraded is متدهور everywhere OneUptime names the state", () => {
    const statusPage: LocaleTree = readLocale("StatusPage", "ar");

    expect(
      ((statusPage["statusNames"] as LocaleTree)["degraded"] as string) || "",
    ).toBe("متدهور");
    expect(arabic["Degraded"]).toBe("متدهور");
    expect(readLocale("Server", "ar")["Degraded"]).toBe("متدهور");

    const receding: Array<string> = [];

    for (const app of APPS) {
      for (const [key, text] of leaves(readLocale(app, "ar"))) {
        if (text.includes("متراجع")) {
          receding.push(`${app}: ${key}`);
        }
      }
    }

    expect(receding).toEqual([]);

    const glossary: string = fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
      "utf8",
    );

    expect(glossary).toContain(
      "| Operational / Degraded / Offline | يعمل بشكل طبيعي / متدهور / غير متصل |",
    );
  });

  /*
   * "Code" is OneUptime's Code product (a tab of Home's Explore OneUptime
   * card, a menu item) and the Markdown toolbar's code button: never الرمز,
   * which is a symbol or a token.
   */
  test("Code is التعليمات البرمجية, never a symbol", () => {
    const navbar: LocaleTree = arabic["navbar"] as LocaleTree;

    expect(arabic["Code"]).toBe("التعليمات البرمجية");
    expect((navbar["categories"] as LocaleTree)["code"]).toBe(
      "التعليمات البرمجية",
    );
    expect((navbar["items"] as LocaleTree)["codeTitle"]).toBe(
      "التعليمات البرمجية",
    );
    expect(readLocale("Accounts", "ar")["Code"]).toBe("التعليمات البرمجية");
  });

  /*
   * Wherever the Dashboard's English names latency, a datastore or the
   * inventory in its prose, the Arabic says it in the glossary's words,
   * so one metric is never called two things on two pages.
   */
  test("latency, a datastore and the inventory are said in the glossary's words", () => {
    const arabicTexts: Map<string, string> = leaves(arabic);
    const englishTexts: Map<string, string> = leaves(english);
    const missed: Array<string> = [];
    const named: Record<string, number> = {};

    for (const word of GLOSSARY_WORDS_IN_PROSE) {
      named[word.name] = 0;

      for (const [key, text] of englishTexts) {
        if (!word.english.test(text.replace(CODE_IN_PROSE, " "))) {
          continue;
        }

        named[word.name] = (named[word.name] || 0) + 1;

        if (key in NAMED_AS_CODE) {
          continue;
        }

        if (!word.arabic.test(arabicTexts.get(key) || "")) {
          missed.push(`${word.name}: ${key} -> ${arabicTexts.get(key)}`);
        }
      }
    }

    expect(missed).toEqual([]);

    // Each is named in over a hundred texts, so a slip has somewhere to show.
    for (const word of GLOSSARY_WORDS_IN_PROSE) {
      expect([word.name, (named[word.name] || 0) > 100]).toEqual([
        word.name,
        true,
      ]);
    }

    // A name the guard skips is still named in the Dashboard's English.
    for (const key of Object.keys(NAMED_AS_CODE)) {
      expect([key, englishTexts.get(key)]).toEqual([key, key]);
    }

    const glossary: string = fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
      "utf8",
    );

    expect(glossary).toContain("| Latency | زمن الانتقال |");
    expect(glossary).toContain(
      "| Data store, Datastore (VMware) | مخزن البيانات (مخازن البيانات) |",
    );
    expect(glossary).toContain("| Inventory | الجرد |");
  });

  /*
   * A function the English names with its brackets keeps them in Arabic, as
   * ARABIC.md says and Session Replay's suite holds code: الدالة track(),
   * never الدالة track.
   */
  test("a function keeps its brackets", () => {
    const arabicTexts: Map<string, string> = leaves(arabic);
    const dropped: Array<string> = [];
    let named: number = 0;

    for (const [key, text] of leaves(english)) {
      for (const name of text.match(FUNCTION_WITH_BRACKETS) || []) {
        named += 1;

        if (!(arabicTexts.get(key) || "").includes(name)) {
          dropped.push(`${key} -> ${name}`);
        }
      }
    }

    expect(dropped).toEqual([]);
    // identify(), start(), grantConsent(), oneuptime.captureMetric(), ...
    expect(named).toBeGreaterThan(40);

    const glossary: string = fs.readFileSync(
      path.join(PACKAGES, LOCALE_DIRS["Dashboard"] as string, "ARABIC.md"),
      "utf8",
    );

    expect(glossary).toContain("`استدعِ الدالة grantConsent()`");
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
