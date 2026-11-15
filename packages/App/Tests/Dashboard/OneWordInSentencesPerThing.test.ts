// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";
import {
  ONE_WORD_RULES,
  SentenceRule,
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

// The strings of `rule.language` whose English names the thing and still say the dropped word.
function stillDropped(rule: SentenceRule): Array<string> {
  const words: Record<string, string> = readDashboardLocale(rule.language);

  return Object.keys(words).filter((key: string): boolean => {
    const value: unknown = words[key];

    return (
      typeof value === "string" &&
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
 * them) names the thing says the language's word in its prose. What a line
 * quotes is read elsewhere: a bold label or a quote is the words of the
 * product that draws it, which the docs suites check against that product's
 * locale, and a link's text is the title of the page or heading it opens.
 * Headings and the docs navigation keep their titles here, for the anchors
 * and the cards that name them, and so do fenced blocks and code spans.
 */
const DOCS_CONTENT: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Content",
);

// What a docs line quotes: code, a link, a bold label, a quote or an address.
const NOT_DOCS_WORDS: RegExp =
  /`[^`]*`|\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|«[^»]*»|“[^”]*”|„[^“”]*[“”]|「[^」]*」|『[^』]*』|"[^"]*"|https?:\/\/\S+|\{\{[^}]*\}\}/g;

// A fenced block's first or last line.
const FENCE: RegExp = /^\s*(```|~~~)/;

// A heading, whose words are its anchor's.
const HEADING: RegExp = /^\s*#/;

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
    let inFence: boolean = false;

    lines.forEach((line: string, index: number): void => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return;
      }

      const englishLine: string = english[index] || "";

      if (
        inFence ||
        HEADING.test(line) ||
        !(rule.docsEnglish || rule.english).test(englishLine) ||
        (except && except.test(englishLine))
      ) {
        return;
      }

      if (rule.dropped.test(line.replace(NOT_DOCS_WORDS, " "))) {
        found.push(`${page}:${index + 1}`);
      }
    });
  }

  return found;
}

describe("a thing's docs in each language", () => {
  test("read a line's prose, not what it quotes or its headings", () => {
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
    expect(HEADING.test("### Registri")).toBe(true);
    expect(docsPages("it")).toEqual(
      expect.arrayContaining(["telemetry/logs-explorer.md"]),
    );
  });

  test.each(
    RULES.map((rule: SentenceRule): [string, string, SentenceRule] => {
      return [rule.language, rule.thing, rule];
    }),
  )(
    "%s's docs name %s with its one word",
    (_language: string, _thing: string, rule: SentenceRule) => {
      expect(docsLinesStillDropped(rule)).toEqual([]);
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
