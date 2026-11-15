// UX rule: Docs/ux/README.md#in-every-language
import {
  KeptPhrase,
  ONE_NAME,
  OneName,
  otherWordIn,
  wordsOf,
} from "./OneNamePerThing";
import {
  DocsBlock,
  PairedBlock,
  blocksOf,
  diagramWordsOf,
  ownWordsOf,
  pairedBlocksOf,
} from "../FeatureSet/Docs/DocsBlocks";
import { readPage } from "../FeatureSet/Docs/DocsContentSupport";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { namesItsList } from "Common/Tests/Helpers/ListNames";
import { PRODUCT_TITLES } from "Common/Types/Product/ProductCatalog";

/*
 * ONE NAME FOR A THING IN EACH LANGUAGE (#8029, #8030, #8031).
 *
 * A reader learns a thing's name from the side menu, the Products menu and
 * the page titles, and then reads it in every count, sentence and button.
 * Some languages named it one way there and another way on the page:
 *
 *   - "Flux de travail" in the French menu, "Archiver ce workflow" and some
 *     fifty other sentences on its pages; Italian and Danish the same
 *     (#8030);
 *   - 监视器 in the Simplified Chinese menu, 监控项 and 监控器 in 40
 *     sentences; Traditional Chinese 監測器 beside 監視器 and 監控器;
 *     Swedish "Monitorer" beside 240 sentences saying "övervakare" (#8031);
 *   - "Страницы состояния" in the Russian menu beside "страница статуса"
 *     on 500 pages and "статус-страницы" in its counts, "Панели" beside
 *     "дашборды"; Hindi "स्थिति पृष्ठ" beside "स्टेटस पेज"; Norwegian
 *     "Målinger" beside "metrikker"; "profiles" still English in twelve
 *     languages (#8029);
 *   - the Products menu said "Övervakare" (Swedish), 监控 and 監測 (Chinese)
 *     and "Дашборды" (Russian) over pages titled "Monitorer", 监视器, 監測器
 *     and "Панели".
 *
 * This holds each language to its one name:
 *
 *   - every Products-menu title whose lower-case term is a Dashboard key
 *     ("Status Pages" and "status pages") names one noun in both, in every
 *     language, and no such term is left in English (the rule
 *     ArchiveWordsAgreeInLocale holds the archivable kinds to, widened to
 *     the whole menu);
 *   - the Products menu (navbar.items.*Title) names each product as the
 *     page it opens does, but for the pairs still to settle
 *     (PRODUCTS_MENU_STILL_APART);
 *   - each name in OneNamePerThing: its menu says the word, and no string of
 *     any app's locale file (Dashboard, Admin Dashboard, sign-in pages,
 *     status page, public dashboards, API reference, the server) says one of
 *     the words the language dropped;
 *   - the docs pages, their Mermaid diagrams' labels, and the docs
 *     navigation, of every language: each block of a page beside its English
 *     block, so what the English has word for word - a label the Dashboard
 *     draws in English, a message the product writes in English, a row not
 *     translated yet - is the English kept as written and not read
 *     (DocsBlocks' ownWordsOf), and a diagram's node ids, which a
 *     translation keeps as the English page has them, are not words. A name
 *     whose docs still say a dropped word would be DOCS_STILL_APART until
 *     they say the one name too; none is since #8230.
 *
 * A failure names the app, the key or page and the word: write the
 * language's one name there, minding its grammar (gender, case, plural). If
 * the word names something else - another product's workflow, a device's
 * monitored items - list it in OneNamePerThing (keptKeys or keptPhrases)
 * with why.
 */

const APPS_DIR: string = path.resolve(__dirname, "../../FeatureSet");
const COMMON_DIR: string = path.resolve(__dirname, "../../../Common");

// Every app's locale folder, by the app's name.
const LOCALE_DIRS: Readonly<Record<string, string>> = {
  Dashboard: path.join(APPS_DIR, "Dashboard/src/Locales"),
  "Admin Dashboard": path.join(APPS_DIR, "AdminDashboard/src/Locales"),
  "Sign-in pages": path.join(APPS_DIR, "Accounts/src/Locales"),
  "Status page": path.join(APPS_DIR, "StatusPage/src/Locales"),
  "Public dashboards": path.join(APPS_DIR, "PublicDashboard/src/Locales"),
  "API reference": path.join(APPS_DIR, "APIReference/Locales"),
  Server: path.join(COMMON_DIR, "Server/Locales"),
};

const DOCS_NAV_DIR: string = path.join(APPS_DIR, "Docs/Locales");

/*
 * The names whose translated docs - pages and navigation - still say a
 * dropped word, in pages written before the Dashboard settled on one. Every
 * other name's docs say the one name and are read for it. #8230 took the
 * last five off (French, Italian and Danish workflows, Russian dashboards,
 * Norwegian metrics): a name added to OneNamePerThing before its docs are
 * reworded goes here, and comes off when they say the one name - the test
 * fails while one is listed and clean.
 */
const DOCS_STILL_APART: ReadonlyArray<{ language: string; title: string }> = [];

/*
 * Products whose Products-menu title (navbar.items.*Title) still names
 * another noun than their page title, in languages that have not settled on
 * one yet (#8229): Danish "Overvågninger" over a page titled "Monitorer".
 * Each comes off when its pair agrees: the test fails while one is listed
 * and agrees.
 */
const PRODUCTS_MENU_STILL_APART: ReadonlyArray<{
  language: string;
  title: string;
}> = [
  { language: "es", title: "Insights" },
  { language: "it", title: "Logs" },
  { language: "it", title: "Insights" },
  { language: "da", title: "Monitors" },
  { language: "da", title: "Metrics" },
  { language: "no", title: "Monitors" },
  { language: "sv", title: "Metrics" },
  { language: "ru", title: "Logs" },
  { language: "ko", title: "Alerts" },
  { language: "zh-CN", title: "Traces" },
  { language: "zh-CN", title: "Inventory" },
  { language: "zh-TW", title: "Inventory" },
  { language: "hi", title: "Queues" },
];

type Strings = Map<string, string>;

function flatten(value: unknown, prefix: string, into: Strings): Strings {
  if (typeof value === "string") {
    into.set(prefix, value);
    return into;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
  }

  return into;
}

const stringsCache: Map<string, Strings | null> = new Map();

// Every string of a locale file, by its key path; null when there is none.
function stringsIn(directory: string, language: string): Strings | null {
  const file: string = path.join(directory, `${language}.json`);

  if (!stringsCache.has(file)) {
    stringsCache.set(
      file,
      fs.existsSync(file)
        ? flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map())
        : null,
    );
  }

  return stringsCache.get(file)!;
}

interface Sighting {
  where: string;
  text: string;
  says: string;
}

// The strings of a locale folder that say a word `name` dropped.
function sightingsInLocale(
  directory: string,
  language: string,
  name: OneName,
): Array<Sighting> {
  const strings: Strings | null = stringsIn(directory, language);
  const sightings: Array<Sighting> = [];

  for (const [key, text] of strings || []) {
    if (name.keptKeys && key in name.keptKeys) {
      continue;
    }

    const says: string | null = otherWordIn(name, text);

    if (says) {
      sightings.push({ where: key, text: text, says: says });
    }
  }

  return sightings;
}

/*
 * The words of a docs block a reader reads in the language's own words: a
 * diagram line's labels (its node ids are the English page's), and of a
 * block beside its English block, only what the English does not have word
 * for word (DocsBlocks' ownWordsOf).
 */
function ownTextOf(block: DocsBlock, english?: DocsBlock): string {
  if (english) {
    return ownWordsOf(english, block);
  }

  return block.diagram ? diagramWordsOf(block.text) : block.text;
}

// The blocks of a language's docs that say a word `name` dropped.
function sightingsInDocs(language: string, name: OneName): Array<Sighting> {
  const sightings: Array<Sighting> = [];
  const { paired, unpaired } = pairedBlocksOf(language);

  for (const block of paired as Array<PairedBlock>) {
    const says: string | null = otherWordIn(
      name,
      ownTextOf(block.translation, block.english),
    );

    if (says) {
      sightings.push({
        where: `${block.page}:${block.line}`,
        text: block.translation.text.trim(),
        says: says,
      });
    }
  }

  // A page that does not pair with its English page is read whole.
  for (const page of unpaired) {
    for (const block of blocksOf(readPage(language, page))) {
      const says: string | null = block.code
        ? null
        : otherWordIn(name, ownTextOf(block));

      if (says) {
        sightings.push({
          where: `${page}:${block.line + 1}`,
          text: block.text.trim(),
          says: says,
        });
      }
    }
  }

  return sightings;
}

function namesOf(language: string): ReadonlyArray<OneName> {
  return ONE_NAME[language] || [];
}

function nameOf(language: string, title: string): OneName {
  const name: OneName | undefined = namesOf(language).find(
    (candidate: OneName): boolean => {
      return candidate.title === title;
    },
  );

  expect({ language, title, found: Boolean(name) }).toEqual({
    language,
    title,
    found: true,
  });

  return name!;
}

// The side menu's nested key for a Products-menu title, if it has one.
function sideMenuKeyOf(title: string): string | undefined {
  const items: Record<string, string> = (
    JSON.parse(
      fs.readFileSync(path.join(LOCALE_DIRS["Dashboard"]!, "en.json"), "utf8"),
    ) as { navbar: { items: Record<string, string> } }
  ).navbar.items;

  const key: string | undefined = Object.keys(items).find(
    (candidate: string): boolean => {
      return candidate.endsWith("Title") && items[candidate] === title;
    },
  );

  return key ? `navbar.items.${key}` : undefined;
}

const PRODUCTS_MENU_TITLES: ReadonlyArray<string> = Object.values(
  PRODUCT_TITLES,
) as Array<string>;

/*
 * The Products menu's titles whose lower-case term is a Dashboard key of its
 * own: "Status Pages" and "status pages", "Workflows" and "workflows".
 */
function titlesWithATerm(): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");

  return PRODUCTS_MENU_TITLES.filter((title: string): boolean => {
    return title !== title.toLowerCase() && title.toLowerCase() in english;
  });
}

describe("the check of a text for a dropped word", () => {
  const french: OneName = nameOf("fr", "Workflows");
  const swedish: OneName = nameOf("sv", "Monitors");
  const chinese: OneName = nameOf("zh-CN", "Monitors");

  test("finds a dropped word in a sentence", () => {
    expect(otherWordIn(french, "Ce workflow est archivé.")).toBe("workflow");
    expect(otherWordIn(chinese, "此监控项已归档。")).toBe("监控项");
    expect(otherWordIn(swedish, "Arkivera 3 övervakare?")).toBe("övervakar");
    expect(otherWordIn(swedish, "Övervakarens status")).toBe("Övervakar");
  });

  test("passes the one name", () => {
    expect(otherWordIn(french, "Ce flux de travail est archivé.")).toBeNull();
    expect(otherWordIn(chinese, "此监视器已归档。")).toBeNull();
    expect(otherWordIn(swedish, "Arkivera 3 monitorer?")).toBeNull();
  });

  test("reads only the words: a placeholder's name, code and an address are not", () => {
    expect(
      otherWordIn(french, "Le flux de travail {{workflowName}} a échoué."),
    ).toBeNull();
    expect(
      otherWordIn(french, "Ajoutez `.github/workflows/deploy.yml` au dépôt."),
    ).toBeNull();
    expect(
      otherWordIn(
        french,
        "Voir [les flux de travail](/docs/workflows/overview) et https://example.com/workflows.",
      ),
    ).toBeNull();
    expect(wordsOf("<WorkflowCard /> {{workflow}}")).not.toMatch(/workflow/i);
  });

  test("Swedish keeps its verb: a monitor övervakar a service", () => {
    expect(otherWordIn(swedish, "Monitorn övervakar tjänsten.")).toBeNull();
    expect(otherWordIn(swedish, "Övervakar du tjänsten?")).toBeNull();
  });

  test("a kept phrase is taken out before the text is read", () => {
    const kept: KeptPhrase = {
      phrase: /GitHub Actions-workflow/,
      why: "GitHub's own name for its pipelines",
    };
    const withKept: OneName = { ...french, keptPhrases: [kept] };

    expect(
      otherWordIn(
        withKept,
        "Lancez le GitHub Actions-workflow depuis un flux de travail.",
      ),
    ).toBeNull();
    expect(
      otherWordIn(
        withKept,
        "Lancez le GitHub Actions-workflow depuis un workflow.",
      ),
    ).toBe("workflow");
  });
});

describe("the words of a docs block that are read", () => {
  function block(text: string, diagram: boolean = false): DocsBlock {
    return { line: 0, text, code: false, diagram };
  }

  const french: OneName = nameOf("fr", "Workflows");
  const russian: OneName = nameOf("ru", "Dashboards");

  test("a diagram says its labels, not the node ids it keeps from the English page", () => {
    const english: DocsBlock = block(
      '    declared["Incident declared"] --> workflow["Workflow:<br/>On Create Incident"]',
      true,
    );

    expect(
      otherWordIn(
        french,
        ownTextOf(
          block(
            '    declared["Incident déclaré"] --> workflow["Flux de travail :<br/>On Create Incident"]',
            true,
          ),
          english,
        ),
      ),
    ).toBeNull();
    // A label still in the dropped word is read.
    expect(
      otherWordIn(
        french,
        ownTextOf(
          block(
            '    declared["Incident déclaré"] --> workflow["Workflow :<br/>On Create Incident"]',
            true,
          ),
          english,
        ),
      ),
    ).toBe("Workflow");
    expect(
      otherWordIn(
        french,
        ownTextOf(block("    participant W as Workflow", true)),
      ),
    ).toBe("Workflow");
  });

  test("what the English block has word for word is the English kept as written", () => {
    const english: DocsBlock = block(
      "Add an **Execute Workflow** block. Another workflow starts.",
    );

    expect(
      otherWordIn(
        french,
        ownTextOf(
          block(
            "Ajoutez un bloc **Execute Workflow**. Un autre flux de travail démarre.",
          ),
          english,
        ),
      ),
    ).toBeNull();
    expect(
      otherWordIn(
        french,
        ownTextOf(
          block(
            "Ajoutez un bloc **Execute Workflow**. Un autre workflow démarre.",
          ),
          english,
        ),
      ),
    ).toBe("workflow");
    // A row not translated yet says nothing of its own.
    expect(
      otherWordIn(
        french,
        ownTextOf(
          block("- Decide what monitors, webhooks and workflows may reach."),
          block("- Decide what monitors, webhooks and workflows may reach."),
        ),
      ),
    ).toBeNull();
  });

  test("a word the reader reads alone in bold is read", () => {
    expect(
      otherWordIn(
        russian,
        ownTextOf(
          block("Откройте **Дашборды**."),
          block("Open **Dashboards**."),
        ),
      ),
    ).toBe("Дашборд");
  });

  test("another product's thing keeps its word", () => {
    expect(
      otherWordIn(
        french,
        "Vérifiez que le workflow dans New Relic est actif, puis le flux de travail OneUptime.",
      ),
    ).toBeNull();
    expect(
      otherWordIn(
        french,
        "Un ID de transition appartient au workflow Jira du ticket.",
      ),
    ).toBeNull();
    expect(
      otherWordIn(russian, "Наблюдаемость данных читает каждый BI-дашборд."),
    ).toBeNull();
    // Only the kept phrase keeps it.
    expect(
      otherWordIn(french, "Le workflow New Relic notifie le workflow."),
    ).toBe("workflow");
    expect(
      otherWordIn(russian, "Каждый BI-дашборд и каждый дашборд проекта."),
    ).toBe("дашборд");
  });
});

describe("the list's name, against the words it replaced", () => {
  test.each([
    ["статус-страницы", "Страницы состояния"],
    ["дашборды", "Панели"],
    ["स्टेटस पेज", "स्थिति पृष्ठ"],
    ["metrikker", "Målinger"],
    ["排程維護", "排定維護"],
    ["profiles", "Perfis"],
  ])("%p does not name %p", (term: string, list: string) => {
    expect(namesItsList(term, list)).toBe(false);
  });

  test.each([
    ["страницы статуса", "Страницы статуса"],
    ["панели", "Панели"],
    ["målinger", "Målinger"],
    ["个指标", "指标"],
    ["個指標", "指標"],
    ["perfis", "Perfis"],
  ])("%p names %p", (term: string, list: string) => {
    expect(namesItsList(term, list)).toBe(true);
  });
});

describe("the Products menu's titles and their lower-case terms", () => {
  test("are read from the catalog", () => {
    expect(titlesWithATerm()).toEqual(
      expect.arrayContaining([
        "Monitors",
        "Status Pages",
        "Scheduled Maintenance",
        "Metrics",
        "Profiles",
        "Dashboards",
        "Workflows",
      ]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)("name one noun in %s", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);
    const apart: Array<{ title: string; menu: string; term: string }> = [];

    for (const title of titlesWithATerm()) {
      const term: string = title.toLowerCase();

      if (!namesItsList(words[term] || term, words[title] || title)) {
        apart.push({
          title: title,
          menu: words[title] || title,
          term: words[term] || term,
        });
      }
    }

    expect(apart).toEqual([]);
  });

  /*
   * A term still in English reads as English in a translated sentence:
   * "profiles" was English in twelve languages, so Ask AI's page chip read
   * "Ask about these profiles" in the middle of a Russian sentence.
   */
  test.each(DASHBOARD_LANGUAGES)(
    "are worded in %s, not left in English",
    (language: string) => {
      const english: Array<string> = titlesWithATerm()
        .map((title: string): string => {
          return title.toLowerCase();
        })
        .filter((term: string): boolean => {
          return !isWordedInDashboardLocale(term, language);
        });

      expect(english).toEqual([]);
    },
  );
});

// A key of a Products-menu title.
const PRODUCTS_MENU_TITLE_KEY: RegExp = /^navbar\.items\.\w+Title$/;

// The Products menu's titles, by their English: navbar.items.*Title.
function productsMenuTitles(language: string): Map<string, string> {
  const english: Strings = stringsIn(LOCALE_DIRS["Dashboard"]!, "en")!;
  const words: Strings = stringsIn(LOCALE_DIRS["Dashboard"]!, language)!;
  const titles: Map<string, string> = new Map<string, string>();

  for (const [key, text] of english) {
    if (PRODUCTS_MENU_TITLE_KEY.test(key) && words.has(key)) {
      titles.set(text, words.get(key)!);
    }
  }

  return titles;
}

/*
 * The Products menu and a product's own page title name one noun: Swedish
 * offered "Övervakare" in the menu and opened a page titled "Monitorer",
 * Russian "Дашборды" and "Панели", Chinese 监控 and 监视器 (#8031, #8029).
 */
describe("the Products menu and the page it opens", () => {
  test("are read from the menu's keys", () => {
    expect(Array.from(productsMenuTitles("en").keys())).toEqual(
      expect.arrayContaining(["Monitors", "Status Pages", "Dashboards"]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)("name one noun in %s", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);
    const apart: Array<{ language: string; title: string }> = [];

    for (const [english, menu] of productsMenuTitles(language)) {
      const page: string | undefined = words[english];

      if (page === undefined || page === menu) {
        continue;
      }

      if (!namesItsList(menu, page) || !namesItsList(page, menu)) {
        apart.push({ language: language, title: english });
      }
    }

    expect(apart).toEqual(
      PRODUCTS_MENU_STILL_APART.filter(
        (entry: { language: string; title: string }): boolean => {
          return entry.language === language;
        },
      ),
    );
  });

  test.each([
    ["sv", "Monitors", "Monitorer"],
    ["zh-CN", "Monitors", "监视器"],
    ["zh-TW", "Monitors", "監測器"],
    ["ru", "Status Pages", "Страницы статуса"],
    ["ru", "Dashboards", "Панели"],
    ["no", "Metrics", "Målinger"],
    ["fr", "Workflows", "Flux de travail"],
  ])(
    "%s: the menu's %s and its page both read %p",
    (language: string, english: string, name: string) => {
      expect(productsMenuTitles(language).get(english)).toBe(name);
      expect(readDashboardLocale(language)[english]).toBe(name);
    },
  );
});

// Strings the issues named, as each language reads them now.
describe("the sentences that named a thing another way", () => {
  test.each([
    ["fr", "Problems with this workflow", "Problèmes de ce flux de travail"],
    [
      "it",
      "Problems with this workflow",
      "Problemi di questo flusso di lavoro",
    ],
    ["da", "Problems with this workflow", "Problemer med denne arbejdsgang"],
    ["sv", "this monitor", "denna monitor"],
    ["sv", "{{count}} monitors", "{{count}} monitorer"],
    ["zh-CN", "this monitor", "此监视器"],
    ["zh-TW", "this monitor", "此監測器"],
    ["zh-TW", "scheduled maintenance", "排定維護"],
    ["ru", "status pages", "страницы статуса"],
    ["ru", "Status Pages", "Страницы статуса"],
    ["ru", "dashboards", "панели"],
    ["ru", "This dashboard is archived", "Эта панель архивирована"],
    ["hi", "status pages", "स्थिति पृष्ठ"],
    ["hi", "metrics", "मेट्रिक्स"],
    ["no", "metrics", "målinger"],
    ["no", "Metric Explorer", "Målingsutforsker"],
    ["pt", "profiles", "perfis"],
    ["ru", "profiles", "профили"],
    ["ko", "profiles", "프로파일"],
    ["zh-CN", "profiles", "性能剖析"],
    ["zh-TW", "profiles", "效能剖析"],
    ["hi", "profiles", "प्रोफ़ाइल"],
  ])("%s: %p reads %p", (language: string, key: string, worded: string) => {
    expect(readDashboardLocale(language)[key]).toBe(worded);
  });
});

describe("every name in OneNamePerThing", () => {
  test("names a Products-menu title", () => {
    for (const [language, names] of Object.entries(ONE_NAME)) {
      for (const name of names) {
        expect({
          language,
          title: name.title,
          inMenu: PRODUCTS_MENU_TITLES.includes(name.title),
        }).toEqual({
          language,
          title: name.title,
          inMenu: true,
        });
      }
    }
  });

  test("is in a language the Dashboard speaks", () => {
    for (const language of Object.keys(ONE_NAME)) {
      expect(DASHBOARD_LANGUAGES).toContain(language);
    }
  });

  test("lists as still apart in the docs only its own names", () => {
    for (const entry of DOCS_STILL_APART) {
      expect(nameOf(entry.language, entry.title).title).toBe(entry.title);
    }
  });

  /*
   * The French, Italian and Danish docs said "workflow", the Russian
   * "дашборд" and the Norwegian "metrikk" in about 3,800 blocks and 35
   * navigation titles beside their Dashboard's word (#8230): they are read
   * for it like every other name's.
   */
  test.each([
    ["fr", "Workflows"],
    ["it", "Workflows"],
    ["da", "Workflows"],
    ["ru", "Dashboards"],
    ["no", "Metrics"],
  ])(
    "%s %s: its docs are read for the one name",
    (language: string, title: string) => {
      expect(nameOf(language, title).title).toBe(title);
      expect(
        DOCS_STILL_APART.some(
          (entry: { language: string; title: string }): boolean => {
            return entry.language === language && entry.title === title;
          },
        ),
      ).toBe(false);
    },
  );

  /*
   * A kept phrase that keeps nothing any more would let the word back in
   * unseen: each keeps a word in a docs block or a locale string of its
   * language.
   */
  test("keeps only phrases that still keep a dropped word", () => {
    const stale: Array<{ language: string; phrase: string }> = [];

    for (const [language, names] of Object.entries(ONE_NAME)) {
      const texts: Array<string> = [
        ...pairedBlocksOf(language).paired.map((block: PairedBlock): string => {
          return wordsOf(ownTextOf(block.translation, block.english));
        }),
        ...Object.values(LOCALE_DIRS).flatMap(
          (directory: string): Array<string> => {
            return Array.from(
              stringsIn(directory, language)?.values() || [],
            ).map((text: string): string => {
              return wordsOf(text);
            });
          },
        ),
      ];

      for (const name of names) {
        for (const kept of name.keptPhrases || []) {
          const keeps: boolean = texts.some((text: string): boolean => {
            const match: RegExpMatchArray | null = text.match(kept.phrase);

            return match !== null && name.others.test(match[0]);
          });

          if (!keeps) {
            stale.push({ language: language, phrase: kept.phrase.source });
          }
        }
      }
    }

    expect(stale).toEqual([]);
  });

  test("keeps only keys that exist and still say the dropped word", () => {
    const stale: Array<{ language: string; key: string }> = [];

    for (const [language, names] of Object.entries(ONE_NAME)) {
      for (const name of names) {
        for (const key of Object.keys(name.keptKeys || {})) {
          const saysIt: boolean = Object.values(LOCALE_DIRS).some(
            (directory: string): boolean => {
              const text: string | undefined = stringsIn(
                directory,
                language,
              )?.get(key);

              return (
                text !== undefined &&
                otherWordIn({ ...name, keptPhrases: [] }, text) !== null
              );
            },
          );

          if (!saysIt) {
            stale.push({ language: language, key: key });
          }
        }
      }
    }

    expect(stale).toEqual([]);
  });
});

describe.each(Object.keys(ONE_NAME))(
  "one name for each thing in %s",
  (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    describe.each(
      namesOf(language).map((name: OneName) => {
        return [name.title, name] as [string, OneName];
      }),
    )("%s", (_title: string, name: OneName) => {
      test("the menu, its page title and the lower-case term say the word", () => {
        const keys: Array<string> = [name.title, name.title.toLowerCase()];
        const sideMenuKey: string | undefined = sideMenuKeyOf(name.title);

        if (sideMenuKey) {
          keys.push(sideMenuKey);
        }

        const dashboard: Strings = stringsIn(
          LOCALE_DIRS["Dashboard"]!,
          language,
        )!;

        for (const key of keys) {
          expect({ key, worded: dashboard.get(key) }).toEqual({
            key,
            worded: expect.stringMatching(name.word),
          });
        }

        expect(words[name.title]).toMatch(name.word);
      });

      test.each(Object.keys(LOCALE_DIRS))(
        "no string of the %s says a dropped word",
        (app: string) => {
          expect(sightingsInLocale(LOCALE_DIRS[app]!, language, name)).toEqual(
            [],
          );
        },
      );

      const stillApartInDocs: boolean = DOCS_STILL_APART.some(
        (entry: { language: string; title: string }): boolean => {
          return entry.language === language && entry.title === name.title;
        },
      );

      if (!stillApartInDocs) {
        test("no docs page says a dropped word", () => {
          expect(sightingsInDocs(language, name)).toEqual([]);
        });

        test("no title of the docs navigation says a dropped word", () => {
          expect(sightingsInLocale(DOCS_NAV_DIR, language, name)).toEqual([]);
        });
      } else {
        test("its docs still say a dropped word, so it stays listed", () => {
          expect(
            sightingsInDocs(language, name).length +
              sightingsInLocale(DOCS_NAV_DIR, language, name).length,
          ).toBeGreaterThan(0);
        });
      }
    });
  },
);
