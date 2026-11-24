// UX rule: Docs/ux/README.md#in-every-language
import {
  KeptPhrase,
  NORWEGIAN_RETNINGSLINJE,
  NORWEGIAN_RETNINGSLINJE_KEPT,
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
import { listPages, readPage } from "../FeatureSet/Docs/DocsContentSupport";
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
 *   - the Products menu (navbar.items.*Title) names each product word for
 *     word as the page it opens titles it (the flat key of the menu's
 *     English): Danish "Overvågninger" opened a page titled "Monitorer",
 *     German "Status-Seiten" one titled "Statusseiten", and Hindi "लॉग्स"
 *     one titled "लॉग", in 19 pairs across 13 languages (#8229);
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
 * Norwegian metrics), and #8565 the Italian and Portuguese on-call policy
 * #8435 had put here: a name added to OneNamePerThing before its docs are
 * reworded goes here, and comes off when they say the one name - the test
 * fails while one is listed and clean.
 */
const DOCS_STILL_APART: ReadonlyArray<{ language: string; title: string }> = [];

/*
 * Products whose page draws no title of its own, so the Products menu's
 * title has no page title to agree with. None since #7474: the menu's Chat
 * opened the Ask AI panel (Pages/AICopilot forwards to it), and is Ask AI
 * now, the words of the panel and of the header's button. A product comes
 * off when its page gets a title key: the test fails while one is listed
 * and has one.
 */
const PRODUCTS_WITHOUT_A_PAGE_TITLE: ReadonlyArray<string> = [];

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

interface MenuApartFromPage {
  title: string;
  menu: string;
  page: string;
}

/*
 * The products whose Products-menu title is not, word for word, the title
 * of the page it opens: the flat key of the menu's English, which the
 * product's page, its side menu and its breadcrumbs draw. A page title left
 * in English is its English. A product with no page title of its own
 * (PRODUCTS_WITHOUT_A_PAGE_TITLE) is not read.
 */
function menuTitlesApartFromPages(
  menuTitles: Map<string, string>,
  words: Record<string, string>,
): Array<MenuApartFromPage> {
  const apart: Array<MenuApartFromPage> = [];

  for (const [english, menu] of menuTitles) {
    if (PRODUCTS_WITHOUT_A_PAGE_TITLE.includes(english)) {
      continue;
    }

    const page: string = words[english] ?? english;

    if (menu !== page) {
      apart.push({ title: english, menu: menu, page: page });
    }
  }

  return apart;
}

/*
 * The Products menu says the product's page title, word for word: Swedish
 * offered "Övervakare" in the menu and opened a page titled "Monitorer",
 * Russian "Дашборды" and "Панели", Chinese 监控 and 监视器 (#8031, #8029).
 * Comparing only the nouns let 19 more pairs through (#8229): Danish
 * "Overvågninger" over "Monitorer" and "Målinger" over "Metrikker",
 * Norwegian "Overvåkere", Swedish "Mått" over "Mätvärden", Italian "Log"
 * over "Registri", Russian "Логи" over "Журналы", Korean 경고 over 알림,
 * Chinese 跟踪 over 追踪 and 资产清单 over 清单 (資產清單 over 清單),
 * Hindi कतारें over क्यू,
 * Spanish "Hallazgos" over "Análisis", Italian "Insight" over
 * "Informazioni", and two forms of one noun: German "Status-Seiten" over
 * "Statusseiten", Hindi "लॉग्स" and "होस्ट्स" over "लॉग" and "होस्ट", Russian
 * "Трассировка" over "Трассировки", French "SLO" and Persian "SLOها" over
 * "SLOs".
 */
describe("the Products menu and the page it opens", () => {
  test("are read from the menu's keys", () => {
    expect(Array.from(productsMenuTitles("en").keys())).toEqual(
      expect.arrayContaining(["Monitors", "Status Pages", "Dashboards"]),
    );
  });

  test("find a menu title that is not its page's, in any form", () => {
    const menu: Map<string, string> = new Map<string, string>([
      ["Monitors", "Overvågninger"],
      ["Status Pages", "Status-Seiten"],
      ["Logs", "लॉग्स"],
      ["Traces", "Трассировки"],
    ]);
    const words: Record<string, string> = {
      Monitors: "Monitorer",
      "Status Pages": "Statusseiten",
      Logs: "लॉग",
      Traces: "Трассировки",
    };

    expect(menuTitlesApartFromPages(menu, words)).toEqual([
      { title: "Monitors", menu: "Overvågninger", page: "Monitorer" },
      { title: "Status Pages", menu: "Status-Seiten", page: "Statusseiten" },
      { title: "Logs", menu: "लॉग्स", page: "लॉग" },
    ]);
  });

  test("read a page title left in English as its English", () => {
    expect(
      menuTitlesApartFromPages(
        new Map<string, string>([["Monitors", "Monitorer"]]),
        {},
      ),
    ).toEqual([{ title: "Monitors", menu: "Monitorer", page: "Monitors" }]);
    expect(
      menuTitlesApartFromPages(
        new Map<string, string>([["Monitors", "Monitors"]]),
        {},
      ),
    ).toEqual([]);
  });

  test("leave out only the products whose page has no title of its own", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(
      Array.from(productsMenuTitles("en").keys()).filter(
        (title: string): boolean => {
          return !(title in english);
        },
      ),
    ).toEqual([...PRODUCTS_WITHOUT_A_PAGE_TITLE]);
  });

  test("hold English to it too", () => {
    expect(
      menuTitlesApartFromPages(
        productsMenuTitles("en"),
        readDashboardLocale("en"),
      ),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "say each product's page title word for word in %s",
    (language: string) => {
      expect(
        menuTitlesApartFromPages(
          productsMenuTitles(language),
          readDashboardLocale(language),
        ),
      ).toEqual([]);
    },
  );

  test.each([
    ["sv", "Monitors", "Monitorer"],
    ["zh-CN", "Monitors", "监视器"],
    ["zh-TW", "Monitors", "監測器"],
    ["ru", "Status Pages", "Страницы статуса"],
    ["ru", "Dashboards", "Панели"],
    ["no", "Metrics", "Målinger"],
    ["fr", "Workflows", "Flux de travail"],
    /*
     * #8229: the menu took its page's word. #8628 then moved Italian logs,
     * Korean alerts, Spanish insights and French and Persian SLOs, menu
     * and page together, to the word their sentences say most
     * (OneWordInSentencesPerThing).
     */
    ["da", "Monitors", "Monitorer"],
    ["da", "Metrics", "Metrikker"],
    ["no", "Monitors", "Monitorer"],
    ["sv", "Metrics", "Mätvärden"],
    ["it", "Logs", "Log"],
    ["ru", "Logs", "Журналы"],
    ["ko", "Alerts", "경고"],
    ["zh-CN", "Traces", "追踪"],
    ["hi", "Queues", "क्यू"],
    ["es", "AI Insights", "Hallazgos de IA"],
    ["de", "Status Pages", "Statusseiten"],
    ["hi", "Logs", "लॉग"],
    ["hi", "Hosts", "होस्ट"],
    ["ru", "Traces", "Трассировки"],
    ["fr", "SLOs", "SLO"],
    ["fa", "SLOs", "SLOها"],
    /*
     * #8229: the page took the menu's word. "Informazioni" is information;
     * 清单 and 清單 on their own are any list (the Users 清單), where the
     * menu and the docs name the product 资产清单 and 資產清單.
     */
    ["it", "AI Insights", "Insight IA"],
    ["zh-CN", "Inventory", "资产清单"],
    ["zh-TW", "Inventory", "資產清單"],
    /*
     * #7474: the menu said Chat over the Ask AI panel, and Insights over a
     * page titled AI Insights; it says the panel's and the page's words.
     */
    ["de", "Ask AI", "KI fragen"],
    ["ja", "Ask AI", "AI に質問"],
    ["ar", "Ask AI", "اسأل الذكاء الاصطناعي"],
    ["de", "AI Insights", "KI-Einblicke"],
    ["fr", "AI Insights", "Analyses IA"],
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
    /*
     * Strings added after #8230 in the words the language had dropped: the
     * Ask AI tool's sentences (Danish "Workflow-komponenter", Persian سیاست
     * کشیک, Norwegian "Metrikknavn") and the infrastructure lists' "Docker
     * monitors" (Swedish övervakare, Chinese 监控器 / 監控器).
     */
    ["da", "Workflow components", "Arbejdsgangskomponenter"],
    ["da", 'Created workflow "{{name}}"', 'Arbejdsgang "{{name}}" oprettet'],
    ["sv", "Docker monitors", "Docker-monitorer"],
    ["sv", "Podman monitors", "Podman-monitorer"],
    ["zh-CN", "Docker monitors", "Docker 监视器"],
    ["zh-TW", "Podman monitors", "Podman 監測器"],
    [
      "fa",
      'Created on-call policy "{{name}}"',
      "سیاست آنکال «{{name}}» ایجاد شد",
    ],
    ["no", "Metric names ({{count}} found)", "Målingsnavn ({{count}} funnet)"],
    // Norwegian's on-call policy: the list, one policy and the first one (#8527).
    ["no", "On-Call Policies", "Vaktpolicyer"],
    ["no", "on-call policies", "vaktpolicyer"],
    ["no", "On-Call Policy", "Vaktpolicy"],
    ["no", "Default on-call policy", "Standard vaktpolicy"],
    ["no", "Policies", "Policyer"],
    ["no", "My On-Call Policies", "Mine vaktpolicyer"],
    ["no", "Incoming Call Policies", "Policyer for innkommende anrop"],
    ["no", "Repeat Policy", "Gjentakelsespolicy"],
    [
      "no",
      "Execute the on-call policy for this incident. This will notify the on-call team members and start the on-call process.",
      "Kjør vaktpolicyen for denne hendelsen. Dette vil varsle teammedlemmene på vakt og starte vaktprosessen.",
    ],
  ])("%s: %p reads %p", (language: string, key: string, worded: string) => {
    expect(readDashboardLocale(language)[key]).toBe(worded);
  });
});

/*
 * NORWEGIAN CALLS AN ON-CALL POLICY A POLICY (#8527).
 *
 * The Norwegian Dashboard named an on-call policy five ways: Vaktpolicy for
 * one policy and the first one ("Standard vaktpolicy"), Vaktretningslinjer
 * for the list and the menu, and vakttjenesteretningslinje, vakttjeneste-
 * retningslinje and "retningslinjer for vakttjeneste" in sentences; the
 * Policies section above the list said Retningslinjer, and an incoming call
 * policy was a "retningslinje for innkommende anrop". OneNamePerThing holds
 * the compounds away; a "retningslinje" on its own is a word Norwegian keeps
 * (a guideline, a Kubernetes network policy), so it is held away only where
 * the English names an on-call or incoming call policy, and from the on-call
 * docs pages.
 */
describe("Norwegian calls an on-call policy a policy (#8527)", () => {
  // English that names an on-call or incoming call policy, or the On-Call menu's policies.
  const ON_CALL_POLICY_ENGLISH: RegExp =
    /\b(?:on-call|incoming call|escalation|repeat) polic|^(?:Archived |Delete |Execute |My On-Call )?Polic(?:y|ies)(?: Name| Settings| Execution Timeline| to Execute)?$/i;
  const RETNINGSLINJE: RegExp = /retningslinj/i;

  // The Norwegian strings whose English names an on-call policy, in a locale folder.
  function onCallPolicyStrings(directory: string): Array<Sighting> {
    const english: Strings | null = stringsIn(directory, "en");
    const norwegian: Strings | null = stringsIn(directory, "no");
    const found: Array<Sighting> = [];

    for (const [key, text] of norwegian || []) {
      const englishText: string = english?.get(key) || key;

      if (ON_CALL_POLICY_ENGLISH.test(englishText)) {
        found.push({ where: key, text: text, says: englishText });
      }
    }

    return found;
  }

  test("the dropped compounds are read, and the words that replaced them pass", () => {
    const name: OneName = nameOf("no", "On-Call");

    for (const dropped of [
      "Vaktretningslinjer",
      "Velg vaktretningslinjen som skal utføres.",
      "Kjør vakttjenesteretningslinje",
      "Hvis varselet har en vakttjeneste-retningslinje, utføres den.",
      "Fjernet fra vaktordning-retningslinje",
      "Kjør retningslinjer for vakttjeneste automatisk.",
      "Retningslinjer for innkommende anrop",
      "Velg etiketter for innkommende anropsretningslinje",
    ]) {
      expect({ dropped, says: otherWordIn(name, dropped) }).toEqual({
        dropped,
        says: expect.any(String),
      });
    }

    for (const kept of [
      "Vaktpolicyer",
      "Kjør vaktpolicyen for denne hendelsen.",
      "Policyer for innkommende anrop",
      "Gjentakelsespolicy",
      // A Kubernetes policy and a guideline keep their word.
      "Samtidighetsretningslinje",
      "Feil ved import av nettverksretningslinjer.",
      "sjekk Twilios SMS-retningslinjer",
    ]) {
      expect({ kept, says: otherWordIn(name, kept) }).toEqual({
        kept,
        says: null,
      });
    }
  });

  test("finds the Dashboard's on-call policy strings, nested keys included", () => {
    const strings: Array<Sighting> = onCallPolicyStrings(
      LOCALE_DIRS["Dashboard"]!,
    );

    expect(strings.length).toBeGreaterThan(150);
    expect(
      strings.map((sighting: Sighting): string => {
        return sighting.where;
      }),
    ).toEqual(
      expect.arrayContaining([
        "On-Call Policies",
        "Policies",
        "Delete Policy",
        "Incoming Call Policy",
        "commandPalette.sections.onCallPolicies",
      ]),
    );
    // A Kubernetes policy is not one.
    expect(ON_CALL_POLICY_ENGLISH.test("Concurrency Policy")).toBe(false);
    expect(
      ON_CALL_POLICY_ENGLISH.test(
        "Errors importing network policies. Non-zero values indicate misconfigured policies.",
      ),
    ).toBe(false);
  });

  test.each(Object.keys(LOCALE_DIRS))(
    "no Norwegian string of the %s whose English names an on-call policy says retningslinje",
    (app: string) => {
      expect(
        onCallPolicyStrings(LOCALE_DIRS[app]!).filter(
          (sighting: Sighting): boolean => {
            return RETNINGSLINJE.test(sighting.text);
          },
        ),
      ).toEqual([]);
    },
  );

  test("no Norwegian on-call docs page says retningslinje", () => {
    const pages: Array<string> = listPages("no").filter(
      (page: string): boolean => {
        return page.startsWith("on-call/");
      },
    );

    expect(pages.length).toBeGreaterThan(5);
    expect(
      pages.filter((page: string): boolean => {
        return RETNINGSLINJE.test(readPage("no", page));
      }),
    ).toEqual([]);
  });
});

/*
 * The Italian and Portuguese docs said the on-call words #8435 dropped from
 * their Dashboards: "Esegui criterio di reperibilità", "un criterio di
 * reperibilità archiviato", "Detalhes da política de Plantão" and "Regras
 * de Plantão" on 28 lines (#8565). They are read for the one name now.
 */
describe("the Italian and Portuguese on-call words (#8565)", () => {
  test("Italian: criterio di reperibilità is read, policy di reperibilità passes", () => {
    const italian: OneName = nameOf("it", "On-Call");

    expect(otherWordIn(italian, "**Esegui criterio di reperibilità**")).toBe(
      "criterio di reperibilità",
    );
    expect(
      otherWordIn(italian, "**Esegui policy di reperibilità**"),
    ).toBeNull();
  });

  test("Portuguese: Plantão mid-name is read, a menu path and Title Case keep it", () => {
    const portuguese: OneName = nameOf("pt", "On-Call");

    for (const dropped of [
      "**Detalhes da política de Plantão**",
      "Abra **Incidentes → Regras → Regras de Plantão**.",
      "- **Regras de Plantão** — executam uma política.",
    ]) {
      expect({
        dropped,
        read: otherWordIn(portuguese, dropped) !== null,
      }).toEqual({ dropped, read: true });
    }

    for (const kept of [
      "**Detalhes da política de plantão**",
      "Abra **Incidentes → Regras → Regras de plantão**.",
      "a página **Minhas Políticas de Plantão**",
      "Abra **Plantão > Prontidão**.",
    ]) {
      expect({ kept, read: otherWordIn(portuguese, kept) }).toEqual({
        kept,
        read: null,
      });
    }
  });

  test("the pages read as fixed", () => {
    expect(readPage("it", "on-call/policies")).toContain(
      "**Esegui policy di reperibilità**",
    );
    expect(readPage("it", "installation/upgrading")).toContain(
      "Eseguire una policy di reperibilità archiviata",
    );
    expect(readPage("pt", "on-call/policies")).toContain(
      "**Detalhes da política de plantão**",
    );
    expect(readPage("pt", "on-call/policies")).toContain(
      "**Incidentes → Regras → Regras de plantão**",
    );
  });
});

/*
 * NORWEGIAN CALLS EVERY PRODUCT'S POLICY A POLICY (#8562).
 *
 * After #8527 a few policies still said retningslinje beside the
 * Dashboard's policy: Session Replay's (its page is Avspillingspolicy, its
 * docs said retningslinjen some 60 times), the Network menu's Alert
 * Policies (Varslingsretningslinjer, beside a dozen sentences saying
 * varslingspolicy), Kubernetes' and Cilium's (Samtidighetsretningslinje,
 * nettverksretningslinjer, beside omstartspolicy and nettverkspolicyer),
 * and a page's Content Security Policy in the RUM docs. Retningslinje is
 * a guideline now, and is kept only where one is meant
 * (NORWEGIAN_RETNINGSLINJE_KEPT, with why).
 */
describe("Norwegian calls every product's policy a policy (#8562)", () => {
  // A text with the kept guidelines taken out.
  function withoutKept(text: string): string {
    return NORWEGIAN_RETNINGSLINJE_KEPT.phrases.reduce(
      (rest: string, kept: KeptPhrase): string => {
        return rest.replace(
          new RegExp(kept.phrase.source, `${kept.phrase.flags}g`),
          " ",
        );
      },
      text,
    );
  }

  test("reads a product's policy, and passes a guideline", () => {
    for (const policy of [
      "Varslingsretningslinjer",
      "Samtidighetsretningslinje",
      "Feil ved import av nettverksretningslinjer.",
      "henter applikasjonens retningslinje fra OneUptime",
      "Sidens retningslinje tillater ikke OneUptime ennå.",
    ]) {
      expect({
        policy,
        read: NORWEGIAN_RETNINGSLINJE.test(withoutKept(policy)),
      }).toEqual({
        policy,
        read: true,
      });
    }

    for (const guideline of [
      "sjekk med juridisk avdeling eller HR hva retningslinjene deres og lokal lov krever.",
      "Før du stoler på et nummer, sjekk [Twilios SMS-retningslinjer](https://www.twilio.com).",
    ]) {
      expect({
        guideline,
        read: NORWEGIAN_RETNINGSLINJE.test(withoutKept(guideline)),
      }).toEqual({ guideline, read: false });
    }
  });

  test.each(Object.keys(LOCALE_DIRS))(
    "no Norwegian string of the %s says retningslinje for a policy",
    (app: string) => {
      const found: Array<Sighting> = [];

      for (const [key, text] of stringsIn(LOCALE_DIRS[app]!, "no") || []) {
        if (key in NORWEGIAN_RETNINGSLINJE_KEPT.keys) {
          continue;
        }

        if (NORWEGIAN_RETNINGSLINJE.test(withoutKept(text))) {
          found.push({ where: key, text: text, says: "retningslinje" });
        }
      }

      expect(found).toEqual([]);
    },
  );

  test("no Norwegian docs page or navigation title says retningslinje for a policy", () => {
    const pages: Array<string> = listPages("no");

    expect(pages.length).toBeGreaterThan(100);
    expect(
      pages.filter((page: string): boolean => {
        return NORWEGIAN_RETNINGSLINJE.test(withoutKept(readPage("no", page)));
      }),
    ).toEqual([]);
    expect(
      Array.from(stringsIn(DOCS_NAV_DIR, "no")?.values() || []).filter(
        (text: string): boolean => {
          return NORWEGIAN_RETNINGSLINJE.test(withoutKept(text));
        },
      ),
    ).toEqual([]);
  });

  test("keeps only guidelines that are still there", () => {
    const dashboard: Strings = stringsIn(LOCALE_DIRS["Dashboard"]!, "no")!;
    const texts: Array<string> = [
      ...listPages("no").map((page: string): string => {
        return readPage("no", page);
      }),
      ...Array.from(dashboard.values()),
    ];

    for (const key of Object.keys(NORWEGIAN_RETNINGSLINJE_KEPT.keys)) {
      expect({ key, says: dashboard.get(key) }).toEqual({
        key,
        says: expect.stringMatching(NORWEGIAN_RETNINGSLINJE),
      });
    }

    for (const kept of NORWEGIAN_RETNINGSLINJE_KEPT.phrases) {
      expect({
        phrase: kept.phrase.source,
        found: texts.some((text: string): boolean => {
          return kept.phrase.test(text);
        }),
      }).toEqual({ phrase: kept.phrase.source, found: true });
    }
  });

  test.each([
    ["Replay Policy", "Avspillingspolicy"],
    ["Alert Policies", "Varslingspolicyer"],
    ["Concurrency Policy", "Samtidighetspolicy"],
    ["Reclaim Policy", "Gjenvinningspolicy"],
    ["Pod Management Policy", "Pod-administrasjonspolicy"],
    ["Policy Rules", "Policyregler"],
    [
      "Not required by this application's policy",
      "Ikke påkrevd av denne applikasjonens policy",
    ],
  ])("the Dashboard's %p reads %p", (key: string, worded: string) => {
    expect(readDashboardLocale("no")[key]).toBe(worded);
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
   * for it like every other name's. So are the Italian, Portuguese and
   * Norwegian on-call policy's (#8565, #8527).
   */
  test.each([
    ["fr", "Workflows"],
    ["it", "Workflows"],
    ["da", "Workflows"],
    ["ru", "Dashboards"],
    ["no", "Metrics"],
    ["it", "On-Call"],
    ["pt", "On-Call"],
    ["no", "On-Call"],
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
        // A title with no lower-case term of its own (On-Call) is checked by its title.
        const english: Strings = stringsIn(LOCALE_DIRS["Dashboard"]!, "en")!;

        for (const key of keys.filter((candidate: string): boolean => {
          return english.has(candidate);
        })) {
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
