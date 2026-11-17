// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { PairedLine, pairedLines } from "../FeatureSet/Docs/DocsLinePairing";
import {
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  EVERY_LOCALE_FOLDER,
  INGESTION_KEY_WORDS,
  LOCALE_FOLDERS,
  LocaleFolder,
  ONE_WORD_RULES,
  SentenceRule,
  foldersOf,
} from "Common/Tests/Helpers/OneWordPerThingRules";

/*
 * THE SENTENCES SAY THE WORD THE MENU AND THE PAGE SAY (#8628).
 *
 * #8229 made every Products-menu title its page's title, word for word
 * (OneNamePerThingGuard). The sentences of several languages still named
 * the same thing with the other word, sometimes more often than the page
 * title did:
 *
 *   - Korean said 알림 (also its word for a notification) for an alert in
 *     600 strings, beside 경고 in 1,100 and in its singular "Alert" key;
 *   - Simplified Chinese said 跟踪 for a trace beside 追踪, Hindi कतार for a
 *     queue beside क्यू;
 *   - Italian said "registro" for a log in 300 strings, beside "log" in 760
 *     and in its docs;
 *   - Danish said "overvågning" and Norwegian "overvåking" and "overvåker"
 *     for a monitor in 500 strings each, and their singular "Monitor" key
 *     read "monitoring", as German's and Swedish's did;
 *   - Danish said "måling" and Swedish "mått" for a metric beside "metrik"
 *     and "mätvärde";
 *   - Swedish named a monitor group "övervakningsgrupp", Russian a runbook
 *     "сценарий" and Traditional Chinese 操作手冊 beside their Runbooks
 *     pages' сборник инструкций and 運行手冊;
 *   - French and Persian titled the SLOs page "SLOs" where their sentences
 *     say "SLO" and "SLOها".
 *
 * Each language now says one word. A word like 알림 or "overvågning" also
 * has a meaning of its own (a notification, the act of monitoring), so the
 * check reads the strings whose English names the thing, and only those: a
 * string whose English names the thing says the language's word and not
 * the dropped one. The rules are Common/Tests/Helpers/OneWordPerThingRules,
 * which every setup guide's words are held to as well
 * (SetupGuideDocumentationInLocale).
 */

const RULES: ReadonlyArray<SentenceRule> = ONE_WORD_RULES;

// What a text says in words: a placeholder's name and code are not words.
const NOT_WORDS: RegExp = /\{\{[^{}]*\}\}|`[^`]*`/g;

// A plural form's key ("..._one") names what its English names.
const PLURAL_FORM: RegExp = /_(?:zero|one|two|few|many|other)$/;

function englishOf(key: string): string {
  return key.replace(PLURAL_FORM, "");
}

/*
 * The strings of `rule.language` whose English names the thing and still say
 * the dropped word. A string still in English is the i18n ratchet's, not
 * this rule's: Italian's untranslated "Generate with AI" is not an Italian
 * word for AI (#8768).
 */
function stillDropped(rule: SentenceRule): Array<string> {
  const words: Record<string, string> = readDashboardLocale(rule.language);
  const english: Record<string, string> = readDashboardLocale("en");

  return Object.keys(words).filter((key: string): boolean => {
    const value: unknown = words[key];

    return (
      typeof value === "string" &&
      value !== key &&
      value !== english[key] &&
      rule.english.test(englishOf(key)) &&
      !(rule.except && rule.except.test(englishOf(key))) &&
      rule.dropped.test(value.replace(NOT_WORDS, " "))
    );
  });
}

// The strings whose English names the thing and that say the language's word.
function sayingTheWord(rule: SentenceRule): number {
  const words: Record<string, string> = readDashboardLocale(rule.language);

  return Object.keys(words).filter((key: string): boolean => {
    const value: unknown = words[key];

    return (
      typeof value === "string" &&
      rule.english.test(englishOf(key)) &&
      rule.word.test(value)
    );
  }).length;
}

describe("the check of the sentences", () => {
  test("reads only the strings whose English names the thing", () => {
    const korean: SentenceRule = RULES[0]!;

    expect(korean.english.test("Active Alerts")).toBe(true);
    expect(korean.except!.test("Notification Settings")).toBe(true);
    expect(korean.english.test("Notification Settings")).toBe(false);
    expect(korean.except!.test("Alert notification rules")).toBe(true);
    expect(korean.except!.test("Turn on critical alerts")).toBe(true);
    expect(korean.except!.test("Create Alert")).toBe(false);
  });

  test("lets Norwegian keep its verb overvåker (it monitors)", () => {
    const norwegian: SentenceRule = RULES.find((rule: SentenceRule) => {
      return rule.language === "no";
    })!;

    expect(norwegian.dropped.test("Monitoren overvåker tjenesten.")).toBe(
      false,
    );
    expect(norwegian.dropped.test("Alle overvåkere")).toBe(true);
    expect(norwegian.dropped.test("Denne overvåkingen")).toBe(true);
  });

  test("reads OneUptime's Runner, not another agent or another product's runner", () => {
    const russian: SentenceRule = RULES.find((rule: SentenceRule) => {
      return rule.language === "ru" && rule.thing === "Runners";
    })!;

    expect(russian.english.test("Runner Status")).toBe(true);
    expect(russian.dropped.test("Статус агента сценария")).toBe(true);
    expect(russian.dropped.test("Статус Runner-а")).toBe(false);
    // A key that names an agent too, and AWS's App Runner, are not the Runner.
    expect(
      russian.except!.test(
        "Upgrade the Kubernetes agent chart. The {{agent}} replaces the previous in-cluster Runner.",
      ),
    ).toBe(true);
    expect(russian.except!.test("Configure the App Runner service")).toBe(true);
    // The docs write the Runner with a capital R; a CI's runner is another.
    expect(russian.docsEnglish!.test("Open the Runner's page.")).toBe(true);
    expect(
      russian.docsEnglish!.test("Add it to every CI runner's trust store."),
    ).toBe(false);
    /*
     * The AI agent is a thing of its own, which a sentence may name beside
     * the Runner, as the Dashboard names it: ИИ-агент, агенты ИИ, AI 代理.
     */
    expect(russian.dropped.test("зонды, Runner и агенты ИИ")).toBe(false);
    expect(russian.dropped.test("Агенты ИИ")).toBe(false);
    expect(russian.dropped.test("ИИ-агент проекта")).toBe(false);
    expect(russian.dropped.test("агент сценария и агенты ИИ")).toBe(true);

    const traditionalChinese: SentenceRule = RULES.find(
      (rule: SentenceRule) => {
        return rule.language === "zh-TW" && rule.thing === "Runners";
      },
    )!;

    expect(traditionalChinese.dropped.test("Runner 和 AI 代理")).toBe(false);
    expect(traditionalChinese.dropped.test("Runbook 代理")).toBe(true);
    expect(traditionalChinese.dropped.test("執行器")).toBe(true);
  });

  const ruleOf: (language: string, thing: string) => SentenceRule = (
    language: string,
    thing: string,
  ): SentenceRule => {
    return RULES.find((rule: SentenceRule) => {
      return rule.language === language && rule.thing === thing;
    })!;
  };

  test("lets Italian say IA and keep the names that say AI as written (#8768)", () => {
    const italian: SentenceRule = ruleOf("it", "AI");

    expect(italian.dropped.test("Avvia un'indagine AI")).toBe(true);
    expect(italian.dropped.test("le correzioni di codice AI")).toBe(true);
    expect(italian.dropped.test("Avvia un'indagine IA")).toBe(false);
    // Names: the product's, other products', code's, the permissions', and labels drawn in English.
    for (const name of [
      "Chiedi a OneUptime AI",
      "AI SRE",
      "Se Ask AI ha letto il file",
      "il vecchio AI Agent",
      "Google Vertex AI",
      "Vercel AI SDK",
      "Azure AI Inference",
      "AI Search Service",
      "Zoom AI Companion",
      "JetBrains AI",
      "Il modello Nemo di Mistral AI",
      "Azure.AI.OpenAI",
      "Microsoft.Extensions.AI",
      "Edit AI Rule",
      "Generate with AI",
    ]) {
      expect({ name, dropped: italian.dropped.test(name) }).toEqual({
        name,
        dropped: false,
      });
    }
    // A runbook's AI step and the workflow builder's AI section, which every Dashboard draws in English.
    for (const english of [
      "### AI",
      "## AI",
      "AI",
      "| AI | The OneUptime Worker | A call to the project's LLM provider. |",
      "Manual, JavaScript, HTTP request, Bash, SSH, kubectl and AI.",
      "Bash, SSH, kubectl or AI), a title",
    ]) {
      expect({ english, except: italian.docsExcept!.test(english) }).toEqual({
        english,
        except: true,
      });
    }
    expect(italian.docsExcept!.test("Start an AI investigation.")).toBe(false);
  });

  test("lets Chinese, German and Swedish say an alert one way, and keep the words that name something else (#8769)", () => {
    const chinese: SentenceRule = ruleOf("zh-CN", "Alerts");
    const german: SentenceRule = ruleOf("de", "Alerts");
    const swedish: SentenceRule = ruleOf("sv", "Alerts");

    expect(chinese.dropped.test("新告警")).toBe(true);
    expect(chinese.dropped.test("新警报")).toBe(false);
    // A warning alert, 警告警报, holds 告警 across its two words.
    expect(chinese.dropped.test("警告警报")).toBe(false);

    expect(german.dropped.test("Ein offener Alarm")).toBe(true);
    expect(german.dropped.test("Alarmvorlagen")).toBe(true);
    expect(german.dropped.test("Eine offene Warnung")).toBe(false);
    // Paging, alarmieren and its Alarmierung, stays.
    expect(german.dropped.test("Niemand wird alarmiert")).toBe(false);
    expect(german.dropped.test("Alarmierung")).toBe(false);
    // An English that names an alarm too keeps the German Alarm for it.
    expect(german.except!.test("Alarm sound for critical alerts")).toBe(true);
    expect(german.except!.test("Alertmanager alerts")).toBe(true);
    expect(german.except!.test("Create Alert")).toBe(false);

    expect(swedish.dropped.test("Nya aviseringar")).toBe(true);
    expect(swedish.dropped.test("Nya larm")).toBe(false);
    // A notification is avisering, so a text that names one too keeps it.
    expect(swedish.except!.test("Alert notification settings")).toBe(true);
    expect(swedish.except!.test("Turn on critical alerts")).toBe(true);
    expect(swedish.except!.test("Create Alert")).toBe(false);
  });

  test("lets Norwegian and Arabic give Offline, Disconnected and Not connected each its own word (#8767, #8781)", () => {
    const norwegian: SentenceRule = ruleOf("no", "Offline");
    const disconnected: SentenceRule = ruleOf("ar", "Disconnected");
    const notConnected: SentenceRule = ruleOf("ar", "Not connected");

    expect(norwegian.dropped.test("Noden er frakoblet")).toBe(true);
    expect(norwegian.dropped.test("Noden er offline")).toBe(false);
    // A text that names Disconnected too keeps Frakoblet for it.
    expect(norwegian.except!.test("Offline or disconnected nodes")).toBe(true);
    expect(norwegian.except!.test("Offline nodes")).toBe(false);

    expect(disconnected.dropped.test("الوكيل غير متصل")).toBe(true);
    expect(disconnected.word.test("الوكيل منقطع الاتصال")).toBe(true);
    expect(notConnected.dropped.test("Slack غير متصل")).toBe(true);
    expect(notConnected.word.test("Slack غير مرتبط")).toBe(true);
    // Each reads only its own state: a text naming two of them is worded by hand.
    expect(disconnected.except!.test("Offline or disconnected")).toBe(true);
    expect(notConnected.except!.test("Not connected or disconnected")).toBe(
      true,
    );
    expect(disconnected.english.test("Not connected")).toBe(false);
  });

  test("holds the prose and headings to the Dashboard's word for the control plane and engine metrics, not only the bold labels (#8812)", () => {
    const persian: SentenceRule = ruleOf("fa", "Control Plane");
    const danish: SentenceRule = ruleOf("da", "Engine metrics");
    const dutch: SentenceRule = ruleOf("nl", "Engine metrics");

    expect(persian.english.test("Turn on control plane monitoring")).toBe(true);
    expect(persian.english.test("A worker or control-plane node")).toBe(true);
    expect(persian.dropped.test("### روشن کردن پایش Control Plane")).toBe(true);
    expect(persian.dropped.test("گره‌های control-plane")).toBe(true);
    expect(persian.dropped.test("### روشن کردن پایش صفحه کنترل")).toBe(false);
    // Code is no word: a script's name and a resource's kind.
    expect(persian.dropped.test("OpenStackControlPlane")).toBe(false);

    expect(danish.english.test("Engine Metrics Last Received")).toBe(true);
    expect(danish.english.test("an engine metric")).toBe(true);
    for (const text of [
      "Engine metrics viser Afbrudt",
      "Engine-metrikker viser Afbrudt",
      "en engine-metrik",
    ]) {
      expect({ text, dropped: danish.dropped.test(text) }).toEqual({
        text,
        dropped: true,
      });
    }
    expect(danish.dropped.test("Motormetrikker viser Afbrudt")).toBe(false);
    expect(danish.word.test("en motormetrik")).toBe(true);

    for (const text of [
      "Enginemetrics gestopt",
      "de enginemetrieken",
      "Engine-metrics komen altijd",
      "Engine metrics toont",
    ]) {
      expect({ text, dropped: dutch.dropped.test(text) }).toEqual({
        text,
        dropped: true,
      });
    }
    expect(dutch.dropped.test("Engine-metrieken toont")).toBe(false);
    expect(dutch.word.test("een engine-metriek")).toBe(true);
  });

  test("lets Hindi spell an event one way, इवेंट (#8824)", () => {
    const hindi: SentenceRule = ruleOf("hi", "Events");

    expect(hindi.english.test("Event Labels")).toBe(true);
    expect(hindi.english.test("Failed to fetch events")).toBe(true);
    // Negative control: the dropped spelling is caught, and only it.
    expect(hindi.dropped.test("ईवेंट लेबल")).toBe(true);
    expect(hindi.dropped.test("ईवेंटों का नाम")).toBe(true);
    expect(hindi.dropped.test("इवेंट लेबल")).toBe(false);
    expect(hindi.word.test("इवेंट लेबल")).toBe(true);
    // The Dashboard's Event key reads the kept spelling.
    expect(hindi.dropped.test(readDashboardLocale("hi")["Event"] || "")).toBe(
      false,
    );
  });

  test("reads a plural form's key by its English", () => {
    expect(englishOf("Sync Criteria to {{count}} Linked Monitors_one")).toBe(
      "Sync Criteria to {{count}} Linked Monitors",
    );
    expect(englishOf("Monitors")).toBe("Monitors");
  });

  test("reads a placeholder or code as no word", () => {
    expect("Open {{registro}} `registro`".replace(NOT_WORDS, " ")).not.toMatch(
      /registro/,
    );
  });
});

describe("a thing's sentences in each language", () => {
  test.each(
    RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s names %s with its one word",
    (_language: string, _thing: string, rule: SentenceRule) => {
      expect(stillDropped(rule)).toEqual([]);
      expect(sayingTheWord(rule)).toBeGreaterThan(10);
    },
  );
});

/*
 * THE DOCS SAY THE WORD TOO (#8692).
 *
 * A docs page names the thing as the Dashboard does: every line whose
 * English line (the same line of the English page, as the docs suites read
 * them) names the thing says the language's word, in its prose, its
 * headings and its links' texts. What a line quotes is read elsewhere: a
 * bold label or a quote is the words of the product that draws it, which
 * the docs suites check against that product's locale. Fenced blocks and
 * code spans keep their words.
 *
 * The titles say it too (#8705): a page's title in the docs navigation, its
 * heading, and every card and link that names it. A heading's words are its
 * anchor's, so a renamed heading takes its anchor with it, and every link
 * to it follows (docs:check-anchors, DocsLinksResolve).
 */
const DOCS_CONTENT: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Content",
);

// The rules of the languages the docs are written in.
const DOCS_RULES: ReadonlyArray<SentenceRule> = RULES.filter(
  (rule: SentenceRule): boolean => {
    return fs.existsSync(path.join(DOCS_CONTENT, rule.language));
  },
);

// What a docs line quotes: code, a link, a bold label, a quote or an address.
const NOT_DOCS_WORDS: RegExp =
  /`[^`]*`|\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|«[^»]*»|“[^”]*”|„[^“”]*[“”]|「[^」]*」|『[^』]*』|"[^"]*"|https?:\/\/\S+|\{\{[^}]*\}\}/g;

/*
 * A link, whose text is the title of the page or heading it opens. It is
 * read by its own English, the same link of the English line: "see
 * [Criteria](#criteria)" on a line about a monitor names no monitor.
 */
const LINK: RegExp = /\[([^\]]*)\]\([^)]*\)/g;

function linkTexts(line: string): Array<string> {
  return Array.from(line.matchAll(LINK), (match: RegExpMatchArray): string => {
    return match[1]!.replace(/`[^`]*`/g, " ");
  });
}

// The docs navigation's titles, by their English (Docs/Locales/<code>.json).
const DOCS_LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Locales",
);

function navTitles(language: string): Record<string, string> {
  const locale: Record<string, Record<string, unknown>> = JSON.parse(
    fs.readFileSync(path.join(DOCS_LOCALES, `${language}.json`), "utf8"),
  );
  const titles: Record<string, string> = {};

  for (const group of ["navGroups", "navLinks"]) {
    for (const [english, title] of Object.entries(locale[group] || {})) {
      if (typeof title === "string") {
        titles[english] = title;
      }
    }
  }

  return titles;
}

// The titles of `rule.language`'s docs navigation that name the thing and still say the dropped word.
function navTitlesStillDropped(rule: SentenceRule): Array<string> {
  const except: RegExp | undefined = rule.docsExcept || rule.except;
  const titles: Record<string, string> = navTitles(rule.language);

  return Object.keys(titles).filter((english: string): boolean => {
    return (
      (rule.docsEnglish || rule.english).test(english) &&
      !(except && except.test(english)) &&
      rule.dropped.test(titles[english]!)
    );
  });
}

function docsPages(language: string): Array<string> {
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(path.join(DOCS_CONTENT, language), full));
      }
    }
  };

  walk(path.join(DOCS_CONTENT, language));

  return pages;
}

// The lines of `rule.language`'s docs that name the thing and still say the dropped word.
function docsLinesStillDropped(rule: SentenceRule): Array<string> {
  const found: Array<string> = [];
  const except: RegExp | undefined = rule.docsExcept || rule.except;

  for (const page of docsPages(rule.language)) {
    const englishFile: string = path.join(DOCS_CONTENT, "en", page);

    if (!fs.existsSync(englishFile)) {
      continue;
    }

    const english: Array<string> = fs
      .readFileSync(englishFile, "utf8")
      .split("\n");
    const lines: Array<string> = fs
      .readFileSync(path.join(DOCS_CONTENT, rule.language, page), "utf8")
      .split("\n");

    /*
     * Each line with the English it says: the English line in its place, or
     * on the upgrade guide, whose English wraps, the English paragraph in
     * its place (DocsLinePairing).
     */
    pairedLines(english, lines).forEach((paired: PairedLine): void => {
      if (paired.code) {
        return;
      }

      const line: string = paired.text;
      const index: number = paired.line;
      const englishLine: string = paired.english;
      const names: (text: string) => boolean = (text: string): boolean => {
        return (
          (rule.docsEnglish || rule.english).test(text) &&
          !(except && except.test(text))
        );
      };

      /*
       * A line still the English line word for word (a table row of names)
       * is not translated yet: the translations' ratchet holds it.
       */
      if (line === englishLine) {
        return;
      }

      if (
        names(englishLine) &&
        rule.dropped.test(line.replace(NOT_DOCS_WORDS, " "))
      ) {
        found.push(`${page}:${index + 1}`);
      }

      const englishLinks: Array<string> = linkTexts(englishLine);

      linkTexts(line).forEach((text: string, link: number): void => {
        if (names(englishLinks[link] || "") && rule.dropped.test(text)) {
          found.push(`${page}:${index + 1} [${text}]`);
        }
      });
    });
  }

  return found;
}

describe("a thing's docs in each language", () => {
  test("read a line's words and its headings, not what it quotes", () => {
    expect(
      "See `registro` at [Registri](/docs/a#registri), **Registri** and «registro».".replace(
        NOT_DOCS_WORDS,
        " ",
      ),
    ).not.toMatch(/registr/i);
    // The prose around them is read.
    expect(
      "Apri i registri da [Log](/docs/a) o **Log**.".replace(
        NOT_DOCS_WORDS,
        " ",
      ),
    ).toMatch(/registri/);
  });

  test("read each link's text by its own English link", () => {
    expect(
      linkTexts("Vedi [Registri di audit](/docs/a) e [`registro`](#b)."),
    ).toEqual(["Registri di audit", " "]);
    expect(linkTexts("See [Audit Logs](/docs/a) and [`log`](#b).")).toEqual([
      "Audit Logs",
      " ",
    ]);
    expect(docsPages("it")).toEqual(
      expect.arrayContaining(["telemetry/logs-explorer.md"]),
    );
  });

  // The docs are read in fewer languages than the Dashboard: Arabic has none.
  test("hold every rule of a language the docs are read in", () => {
    expect(DOCS_RULES.length).toBeGreaterThan(10);
    expect(
      RULES.filter((rule: SentenceRule): boolean => {
        return !DOCS_RULES.includes(rule);
      }).map((rule: SentenceRule): string => {
        return rule.language;
      }),
    ).not.toContain("it");
    expect(fs.existsSync(path.join(DOCS_CONTENT, "ar"))).toBe(false);
  });

  test("read the docs navigation's titles by their English", () => {
    expect(navTitles("it")["Audit Logs"]).toBe("Log di audit");
    expect(navTitles("no")["Website Monitor"]).toBe("Nettsted-monitor");
    expect(navTitles("en")["Audit Logs"]).toBe("Audit Logs");
  });

  test.each(
    DOCS_RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s's docs navigation titles %s with its one word",
    (_language: string, _thing: string, rule: SentenceRule) => {
      expect(navTitlesStillDropped(rule)).toEqual([]);
    },
  );

  test.each(
    DOCS_RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s's docs name %s with its one word",
    (_language: string, _thing: string, rule: SentenceRule) => {
      expect(docsLinesStillDropped(rule)).toEqual([]);
    },
  );
});

/*
 * THE ADMIN DASHBOARD SAYS THE WORD TOO (#8740).
 *
 * The Admin Dashboard names the same things as the Dashboard: an instance's
 * monitors, logs, queues and runbooks. A string of its locale
 * (AdminDashboard/src/Locales/<code>.json) whose English names the thing
 * says the language's word: the key's English, or for a nested key the
 * English locale's string at the same place. Italian still called the
 * audit log "registro di audit" there after the Dashboard and the docs said
 * "log di audit".
 */
const PACKAGES: string = path.resolve(__dirname, "../../..");

function folderOf(folder: LocaleFolder): string {
  return path.join(PACKAGES, LOCALE_FOLDERS[folder]);
}

const ADMIN_LOCALES: string = folderOf("Admin Dashboard");

// Each string of an Admin locale, by its place in the file ("pages.home.title").
function adminWords(language: string): Record<string, string> {
  return localeWords("Admin Dashboard", language);
}

// Each string of a folder's locale, by its place in the file ("pages.home.title").
function localeWords(
  folder: LocaleFolder,
  language: string,
): Record<string, string> {
  const words: Record<string, string> = {};
  const walk: (node: Record<string, unknown>, prefix: string) => void = (
    node: Record<string, unknown>,
    prefix: string,
  ): void => {
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        walk(value as Record<string, unknown>, `${prefix}${key}.`);
      } else if (typeof value === "string") {
        words[`${prefix}${key}`] = value;
      }
    }
  };

  walk(
    JSON.parse(
      fs.readFileSync(path.join(folderOf(folder), `${language}.json`), "utf8"),
    ),
    "",
  );

  return words;
}

// The Admin strings of `rule.language` whose English names the thing and still say the dropped word.
function adminStillDropped(rule: SentenceRule): Array<string> {
  return foldersOf(rule).includes("Admin Dashboard")
    ? folderStillDropped(rule, "Admin Dashboard")
    : [];
}

/*
 * The strings of a folder in `rule.language` whose English names the thing
 * and still say the dropped word; `overrides` words some strings otherwise,
 * as a control's fixture.
 */
function folderStillDropped(
  rule: SentenceRule,
  folder: LocaleFolder,
  overrides: Record<string, string> = {},
): Array<string> {
  if (!fs.existsSync(path.join(folderOf(folder), `${rule.language}.json`))) {
    return [];
  }

  const english: Record<string, string> = localeWords(folder, "en");
  const words: Record<string, string> = {
    ...localeWords(folder, rule.language),
    ...overrides,
  };

  return Object.keys(words).filter((place: string): boolean => {
    const named: string = englishOf(english[place] ?? place);

    return (
      rule.english.test(named) &&
      !(rule.except && rule.except.test(named)) &&
      rule.dropped.test(words[place]!.replace(NOT_WORDS, " "))
    );
  });
}

describe("a thing's Admin Dashboard strings in each language", () => {
  test("read a nested string by the English at its place", () => {
    expect(adminWords("en")["pages.settings.dataRetention.logCardTitle"]).toBe(
      "Monitor Log Retention",
    );
    expect(
      adminWords("it")["pages.settings.dataRetention.logCardTitle"],
    ).toMatch(/\blog\b/);
  });

  test.each(
    RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s's Admin Dashboard names %s with its one word",
    (_language: string, _thing: string, rule: SentenceRule) => {
      expect(adminStillDropped(rule)).toEqual([]);
    },
  );
});

/*
 * THE STATUS PAGES, THE SIGN-IN PAGES, THE PUBLIC DASHBOARDS, THE API
 * REFERENCE AND THE SERVER SAY IT TOO (#8828).
 *
 * A customer's own users read a status page; anyone signing in reads the
 * sign-in pages; every email and server message is written from the
 * server's locale. They name the Dashboard's things, but no one-word rule
 * read them: a status page's webhook described an event with Hindi's
 * minority ईवेंट, Norwegian status pages said Frakoblet for Offline, and
 * the Korean sign-in pages named two-factor authentication 이중 인증 under
 * the Dashboard's 2단계 인증 (#8827). Each rule reads the folders it names
 * (foldersOf: every one, unless a rule says otherwise).
 */
const NEWLY_READ: ReadonlyArray<LocaleFolder> = [
  "Status page",
  "Sign-in pages",
  "Public dashboards",
  "API reference",
  "Server",
];

describe("a thing's strings in every other app's locale folder", () => {
  test("every folder a rule may read is one of the apps' locale folders", () => {
    expect([...EVERY_LOCALE_FOLDER].sort()).toEqual(
      ["Admin Dashboard", ...NEWLY_READ].sort(),
    );

    for (const folder of EVERY_LOCALE_FOLDER) {
      expect({
        folder,
        english: fs.existsSync(path.join(folderOf(folder), "en.json")),
      }).toEqual({ folder, english: true });
    }

    for (const rule of RULES) {
      for (const folder of foldersOf(rule)) {
        expect(EVERY_LOCALE_FOLDER).toContain(folder);
      }
    }
  });

  test.each(
    RULES.flatMap(
      (
        rule: SentenceRule,
      ): Array<[string, string, LocaleFolder, SentenceRule]> => {
        return foldersOf(rule)
          .filter((folder: LocaleFolder): boolean => {
            return NEWLY_READ.includes(folder);
          })
          .map(
            (
              folder: LocaleFolder,
            ): [string, string, LocaleFolder, SentenceRule] => {
              return [rule.language, rule.thing, folder, rule];
            },
          );
      },
    ),
  )(
    "%s names %s with its one word in the %s folder",
    (
      _language: string,
      _thing: string,
      folder: LocaleFolder,
      rule: SentenceRule,
    ) => {
      expect(folderStillDropped(rule, folder)).toEqual([]);
    },
  );

  /*
   * Each newly read folder, read for real (control): one of its strings
   * whose English names the thing is worded with the dropped word, and the
   * guard finds it.
   */
  test.each([
    ["Status page", "hi", "Events", "ईवेंट"],
    ["Sign-in pages", "ko", "Two-factor authentication", "이중 인증"],
    ["Public dashboards", "no", "Offline", "Du er frakoblet"],
    ["API reference", "zh-CN", "Traces", "堆栈跟踪"],
    ["Server", "da", "Monitors", "Overvågning: {{monitorName}}"],
  ])(
    "the %s folder: a %s string about %s said %p is caught",
    (folder: string, language: string, thing: string, minority: string) => {
      const rule: SentenceRule = RULES.find((candidate: SentenceRule) => {
        return candidate.language === language && candidate.thing === thing;
      })!;
      const english: Record<string, string> = localeWords(
        folder as LocaleFolder,
        "en",
      );
      const place: string | undefined = Object.keys(
        localeWords(folder as LocaleFolder, language),
      ).find((candidate: string): boolean => {
        const named: string = englishOf(english[candidate] ?? candidate);

        return (
          rule.english.test(named) && !(rule.except && rule.except.test(named))
        );
      });

      expect(foldersOf(rule)).toContain(folder);
      expect(place).toBeDefined();
      expect(
        folderStillDropped(rule, folder as LocaleFolder, {
          [place!]: minority,
        }),
      ).toEqual([place]);
    },
  );
});

/*
 * AN INGESTION KEY IS ONE WORD, ON ITS PAGE AND EVERYWHERE (#8806).
 *
 * The Ingestion Keys card titled its list one way and its Create button
 * another: Swedish Intagningsnycklar over Skapa ingestion-nyckel, Danish
 * Indtagelsesnøgler over Opret ingestion-nøgle, Italian Chiavi di
 * acquisizione over Crea chiave di ingestione. A reader could not tell the
 * button makes one of the keys the title lists. Every string whose English
 * names an ingestion key, in the Dashboard and the Admin Dashboard, says the
 * language's word, in all 17 languages; the words they dropped are held out
 * of the docs and the setup guides by the shared rules.
 */
const NAMES_AN_INGESTION_KEY: RegExp = /\bingestion[ -]keys?\b/i;

// The strings whose English names an ingestion key and that do not say the language's word.
function notSayingIngestionKey(
  language: string,
  strings: Record<string, string>,
  english: (place: string) => string,
): Array<string> {
  const word: RegExp = INGESTION_KEY_WORDS[language]!;

  return Object.keys(strings).filter((place: string): boolean => {
    const named: string = englishOf(english(place));
    const text: string = strings[place]!;

    return (
      NAMES_AN_INGESTION_KEY.test(named.replace(NOT_WORDS, " ")) &&
      text !== named &&
      !word.test(text.replace(NOT_WORDS, " "))
    );
  });
}

describe("an ingestion key in each language", () => {
  test("every Dashboard language has its word", () => {
    expect(Object.keys(INGESTION_KEY_WORDS).sort()).toEqual(
      fs
        .readdirSync(
          path.resolve(__dirname, "../../FeatureSet/Dashboard/src/Locales"),
        )
        .filter((file: string): boolean => {
          return file.endsWith(".json") && file !== "en.json";
        })
        .map((file: string): string => {
          return file.replace(/\.json$/, "");
        })
        .sort(),
    );
  });

  test.each(Object.keys(INGESTION_KEY_WORDS))(
    "%s: the Ingestion Keys title and its Create button say one word",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const word: RegExp = INGESTION_KEY_WORDS[language]!;

      expect({
        language,
        title: word.test(words["Ingestion Keys"]!),
        button: word.test(words["Create Ingestion Key"]!),
        key: word.test(words["Ingestion Key"]!),
      }).toEqual({ language, title: true, button: true, key: true });
    },
  );

  test.each(Object.keys(INGESTION_KEY_WORDS))(
    "%s: every Dashboard and Admin Dashboard string about an ingestion key says it",
    (language: string) => {
      const dashboard: Record<string, string> = readDashboardLocale(language);
      const adminEnglish: Record<string, string> = adminWords("en");

      expect({
        language,
        dashboard: notSayingIngestionKey(
          language,
          dashboard,
          (place: string): string => {
            return place;
          },
        ),
        admin: fs.existsSync(path.join(ADMIN_LOCALES, `${language}.json`))
          ? notSayingIngestionKey(
              language,
              adminWords(language),
              (place: string): string => {
                return adminEnglish[place] ?? place;
              },
            )
          : [],
      }).toEqual({ language, dashboard: [], admin: [] });
    },
  );

  test("a string that names an ingestion key another way is caught (control)", () => {
    expect(
      notSayingIngestionKey(
        "sv",
        { "Create Ingestion Key": "Skapa ingestion-nyckel" },
        (place: string): string => {
          return place;
        },
      ),
    ).toEqual(["Create Ingestion Key"]);
    expect(
      notSayingIngestionKey(
        "sv",
        { "Create Ingestion Key": "Skapa intagningsnyckel" },
        (place: string): string => {
          return place;
        },
      ),
    ).toEqual([]);
  });
});

/*
 * A THING'S OWN WORD THAT READS AS ITS ENGLISH IS KEPT ON PURPOSE (#8836).
 *
 * Where a language's one word for a thing is the English word itself -
 * Norwegian's Offline, Danish's and Norwegian's Monitor, Italian's Log, the
 * Russian and Traditional Chinese Runner - its key reads exactly as its
 * English. The toolchain (npm run i18n:check) and the suites that ask
 * whether a language words a key count such a key as untranslated unless
 * the language's same-as-English list keeps it
 * (Dashboard/i18n/Progress/<code>.json). #8797 made Norwegian's Offline read
 * "Offline" without keeping it, so DefaultStatusNamesInDashboardLocales read
 * Norwegian's Offline status as never worded.
 */
describe("a thing's own word that reads as English", () => {
  test.each(
    RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s keeps %s's own key, where it reads as English, on its same-as-English list",
    (_language: string, _thing: string, rule: SentenceRule) => {
      const english: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(rule.language);
      const asEnglish: Array<string> = [
        rule.thing,
        rule.thing.replace(/s$/, ""),
      ].filter((key: string): boolean => {
        return words[key] !== undefined && words[key] === english[key];
      });

      expect(
        asEnglish.filter((key: string): boolean => {
          return !isWordedInDashboardLocale(key, rule.language);
        }),
      ).toEqual([]);
    },
  );

  test.each([
    ["no", "Offline"],
    ["no", "Monitor"],
    ["da", "Monitor"],
    ["it", "Log"],
    ["ru", "Runner"],
    ["zh-TW", "Runner"],
  ])(
    "%s reads %p as English, and keeps it on purpose",
    (language: string, key: string) => {
      expect(readDashboardLocale(language)[key]).toBe(key);
      expect(isWordedInDashboardLocale(key, language)).toBe(true);
    },
  );
});

describe("the single keys and the titles", () => {
  test.each([
    ["de", "Monitor", "Monitor"],
    ["da", "Monitor", "Monitor"],
    ["no", "Monitor", "Monitor"],
    ["sv", "Monitor", "Monitor"],
    ["ko", "Alert", "경고"],
    ["ko", "Alerts", "경고"],
    ["ko", "alerts", "경고"],
    ["zh-CN", "Trace", "追踪"],
    ["hi", "queue", "क्यू"],
    ["hi", "Queue", "क्यू"],
    ["it", "Logs", "Log"],
    ["it", "logs", "log"],
    ["ru", "Runbook", "Сборник инструкций"],
    ["zh-TW", "Runbook", "運行手冊"],
    // The Runbooks menu's Runners, as 200 sentences name a Runner (#8706).
    ["ru", "Runners", "Runner-ы"],
    ["zh-TW", "Runners", "Runner"],
    ["ru", "Runner Status", "Статус Runner-а"],
    ["zh-TW", "Runner Status", "Runner 狀態"],
    ["fr", "SLOs", "SLO"],
    ["fa", "SLOs", "SLOها"],
    ["sv", "Monitor Group", "Monitorgrupp"],
    // Norwegian's two-factor authentication, as its account docs now say it too (#8701).
    ["no", "Two Factor Authentication", "Tofaktorautentisering"],
    ["no", "Enable Two Factor Authentication", "Aktiver tofaktorautentisering"],
    // The Security page's label, English in twelve languages until #8774, in each one's word.
    ["no", "Two-factor authentication", "Tofaktorautentisering"],
    ["da", "Two-factor authentication", "Tofaktorgodkendelse"],
    ["fr", "Two-factor authentication", "Authentification à deux facteurs"],
    ["hi", "Two-factor authentication", "दो-कारक प्रमाणीकरण"],
    ["it", "Two-factor authentication", "Autenticazione a due fattori"],
    ["ko", "Two-factor authentication", "2단계 인증"],
    ["ko", "Two Factor Authentication", "2단계 인증"],
    ["nl", "Two-factor authentication", "Tweefactorauthenticatie"],
    ["pt", "Two-factor authentication", "Autenticação de dois fatores"],
    ["ru", "Two-factor authentication", "Двухфакторная аутентификация"],
    ["sv", "Two-factor authentication", "Tvåfaktorsautentisering"],
    ["zh-CN", "Two-factor authentication", "双因素身份验证"],
    ["zh-TW", "Two-factor authentication", "雙重驗證"],
    // Norwegian's noun alone, which is also its verb (it monitors).
    ["no", "Assign Monitor", "Tildel monitor"],
    [
      "no",
      "Sync Criteria to {{count}} Linked Monitors_one",
      "Synkroniser kriterier til {{count}} koblet monitor",
    ],
    [
      "da",
      "Sync Criteria to {{count}} Linked Monitors_one",
      "Synkronisér kriterier til {{count}} tilknyttet monitor",
    ],
  ])("%s words %p as %p", (language: string, key: string, word: string) => {
    expect(readDashboardLocale(language)[key]).toBe(word);
  });
});

/*
 * THE STATES A PAGE DRAWS SIDE BY SIDE READ APART (#8767, #8781).
 *
 * A Proxmox node that stopped reporting is Offline; a cluster whose
 * connection dropped is Disconnected; an integration never linked is Not
 * connected. Norwegian said Offline and Disconnected both Frakoblet, and
 * Arabic all three غير متصل, so a page told a node's state from a cluster's
 * with one word. In every language the Dashboard is read in, the four keys
 * read four ways.
 */
const STATES_DRAWN_TOGETHER: ReadonlyArray<string> = [
  "Online",
  "Offline",
  "Disconnected",
  "Not connected",
];

function statesSharingAWord(words: Record<string, string>): Array<string> {
  const seen: Map<string, string> = new Map<string, string>();
  const shared: Array<string> = [];

  for (const key of STATES_DRAWN_TOGETHER) {
    const value: string | undefined = words[key];

    if (value === undefined) {
      continue;
    }

    if (seen.has(value)) {
      shared.push(`${seen.get(value)} = ${key}: ${value}`);
    } else {
      seen.set(value, key);
    }
  }

  return shared;
}

const DASHBOARD_LOCALE_LANGUAGES: Array<string> = fs
  .readdirSync(
    path.resolve(__dirname, "../../FeatureSet/Dashboard/src/Locales"),
  )
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

describe("the states a page draws side by side", () => {
  test.each(DASHBOARD_LOCALE_LANGUAGES)(
    "%s words Online, Offline, Disconnected and Not connected four ways",
    (language: string) => {
      expect({
        language,
        shared: statesSharingAWord(readDashboardLocale(language)),
      }).toEqual({ language, shared: [] });
    },
  );

  test("Norwegian and Arabic word them as #8767 settled", () => {
    expect(readDashboardLocale("no")["Offline"]).toBe("Offline");
    expect(readDashboardLocale("no")["Disconnected"]).toBe("Frakoblet");
    expect(readDashboardLocale("ar")["Offline"]).toBe("غير متصل");
    expect(readDashboardLocale("ar")["Disconnected"]).toBe("منقطع الاتصال");
    expect(readDashboardLocale("ar")["Not connected"]).toBe("غير مرتبط");
  });

  // What the check would see if two states went back to one word.
  test("finds two states that share a word (negative control)", () => {
    expect(
      statesSharingAWord({
        Online: "Online",
        Offline: "Frakoblet",
        Disconnected: "Frakoblet",
        "Not connected": "Ikke tilkoblet",
      }),
    ).toEqual(["Offline = Disconnected: Frakoblet"]);
    expect(
      statesSharingAWord({
        Online: "En línea",
        Offline: "Sin conexión",
        Disconnected: "Desconectado",
        "Not connected": "No conectado",
      }),
    ).toEqual([]);
  });
});
