import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Workflow runs moved in the Dashboard: "Runs & Logs" - a row under
 * Workflows, and an Advanced entry in a workflow's own menu - became Runs, in
 * a Logs section of its own, in both menus. Every page that sends a reader to
 * the runs has to name the new place, in each language's own Dashboard words
 * (Protokolle → Ausführungen, ログ → 実行履歴), or it points at a menu entry
 * nobody can find. There are seventeen copies of each page, and most of them
 * nobody on the team can proofread, so this reads all of them.
 *
 * The runs page keeps its URL, /docs/workflows/runs-and-logs: links to it
 * from outside the docs keep working.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const DOCS_LOCALES_DIR: string = path.join(DOCS_DIR, "Locales");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const RUNS_PAGE: string = "workflows/runs-and-logs.md";
const RUNS_URL: string = "/docs/workflows/runs-and-logs";
const OVERVIEW_PAGE: string = "workflows/index.md";

/*
 * Pages that sent readers to "Runs & Logs" by name. Most languages have
 * them all; the circuit-breaker guide exists in English and Persian only.
 */
const PAGES_THAT_NAME_THE_RUNS: Array<string> = [
  RUNS_PAGE,
  OVERVIEW_PAGE,
  "workflows/authoring.md",
  "workflows/components.md",
  "workflows/triggers.md",
  "workflows/variables.md",
  "integrations/jira.md",
  "integrations/microsoft-dynamics-365.md",
  "telemetry/ai-agent-circuit-breaker.md",
];

/*
 * Only the English pages name the Dashboard's labels in English. The Persian
 * workflow pages name them as the Persian Dashboard draws them
 * (**لاگ‌ها → اجراها**), like every other language.
 */
const ENGLISH_UI_LABELS: Set<string> = new Set(["en"]);

/*
 * What each language called the old menu entry: the Dashboard's
 * "Runs & Logs", and the docs' own titles for the page. The Dashboard
 * strings are gone from its locale files, so they are spelled out here.
 */
const OLD_NAMES: Record<string, Array<string>> = {
  en: ["Runs & Logs", "Workflow Runs & Logs"],
  da: ["Kørsler og logs", "Kørsler & logfiler", "Workflow-kørsler & logfiler"],
  de: ["Ausführungen & Protokolle", "Workflow-Ausführungen & Protokolle"],
  es: [
    "Ejecuciones y Registros",
    "Ejecuciones y registros",
    "Ejecuciones y registros de flujo de trabajo",
  ],
  fa: ["Runs & Logs", "اجراها و گزارش‌ها", "اجراها و لاگ‌های گردش کاری"],
  fr: [
    "Exécutions & journaux",
    "Exécutions et journaux",
    "Exécutions et journaux de workflow",
  ],
  hi: ["रन और लॉग", "वर्कफ़्लो रन और लॉग"],
  it: [
    "Esecuzioni e registri",
    "Esecuzioni e log",
    "Esecuzioni e log del workflow",
  ],
  ja: ["実行とログ", "ワークフロー 実行とログ"],
  ko: ["실행 및 로그", "워크플로우 실행 및 로그"],
  nl: [
    "Runs & logboeken",
    "Uitvoeringen en logboeken",
    "Workflow-uitvoeringen en logboeken",
  ],
  no: ["Kjøringer og logger", "Arbeidsflyt-kjøringer & logger"],
  pt: ["Execuções e registros", "Execuções e registros de workflow"],
  ru: [
    "Запуски и журналы",
    "Запусках и журналах",
    "Запуски и журналы рабочего процесса",
  ],
  sv: ["Körningar och loggar", "Arbetsflödeskörningar & loggar"],
  "zh-CN": ["运行和日志", "运行与日志", "工作流运行与日志"],
  "zh-TW": ["執行與日誌", "工作流程執行與日誌"],
};

/*
 * Each language's word for "logs", as the old titles used it. A link to the
 * runs page, or the page's nav title, that still has it in still says
 * "Runs & Logs".
 */
const LOGS_WORD: Record<string, RegExp> = {
  en: /\blogs?\b/i,
  da: /\blog/i,
  de: /protokoll/i,
  es: /registro/i,
  fa: /گزارش|لاگ/,
  fr: /journa/i,
  hi: /लॉग/,
  it: /\b(?:log|registri)/i,
  ja: /ログ/,
  ko: /로그/,
  nl: /logboek/i,
  no: /\blogg/i,
  pt: /registro/i,
  ru: /журнал/i,
  sv: /\blogg/i,
  "zh-CN": /日志/,
  "zh-TW": /日誌/,
};

type ReadJsonFunction = (file: string) => Record<string, unknown>;

const readJson: ReadJsonFunction = (file: string): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
};

interface MenuWords {
  logs: string;
  runs: string;
}

type MenuWordsFunction = (language: string) => MenuWords;

// The words the reader sees in the Dashboard's menu, in their language.
const menuWords: MenuWordsFunction = (language: string): MenuWords => {
  if (ENGLISH_UI_LABELS.has(language)) {
    return { logs: "Logs", runs: "Runs" };
  }

  const strings: Record<string, unknown> = readJson(
    path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
  );

  return { logs: String(strings["Logs"]), runs: String(strings["Runs"]) };
};

type PageExistsFunction = (language: string, page: string) => boolean;

const pageExists: PageExistsFunction = (
  language: string,
  page: string,
): boolean => {
  return fs.existsSync(path.join(CONTENT_DIR, language, page));
};

type ReadPageFunction = (language: string, page: string) => string;

const readPage: ReadPageFunction = (language: string, page: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
};

type CountFunction = (text: string, needle: string) => number;

const count: CountFunction = (text: string, needle: string): number => {
  return text.split(needle).length - 1;
};

const LINK_TO_RUNS: RegExp =
  /\[([^\]]+)\]\(\/docs\/(?:[a-zA-Z-]+\/)?workflows\/runs-and-logs(?:#[^)]*)?\)/g;

type LinkTextsFunction = (text: string) => Array<string>;

const linkTextsToRuns: LinkTextsFunction = (text: string): Array<string> => {
  return Array.from(text.matchAll(LINK_TO_RUNS)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
};

interface Mention {
  page: string;
  line: number;
  text: string;
}

type ListPagesFunction = (directory: string) => Array<string>;

// Every page under a directory, as paths relative to it.
const listPages: ListPagesFunction = (directory: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      if (entry.isDirectory()) {
        return listPages(path.join(directory, entry.name)).map(
          (page: string): string => {
            return `${entry.name}/${page}`;
          },
        );
      }

      return entry.name.endsWith(".md") ? [entry.name] : [];
    });
};

type OldNameMentionsFunction = (language: string) => Array<Mention>;

/*
 * The old name used as a name, on any page of the language: bold (a menu
 * label or path), as a link's text, or as a page's title. Plain prose may use
 * the same words for other things - the GitHub integration's "workflow runs
 * and logs" permission row, and Korean's "첫 실행 및 로그인" (first launch and
 * sign-in) - and stays.
 */
const oldNameMentions: OldNameMentionsFunction = (
  language: string,
): Array<Mention> => {
  const mentions: Array<Mention> = [];

  for (const page of listPages(path.join(CONTENT_DIR, language))) {
    readPage(language, page)
      .split("\n")
      .forEach((text: string, index: number) => {
        const named: boolean = OLD_NAMES[language]!.some(
          (name: string): boolean => {
            return (
              text.includes(`**${name}**`) ||
              text.includes(`→ ${name}**`) ||
              text.includes(`[${name}](`) ||
              text.trim() === `# ${name}`
            );
          },
        );

        if (named) {
          mentions.push({ page, line: index + 1, text: text.trim() });
        }
      });
  }

  return mentions;
};

describe("the suite reads the docs it claims to", () => {
  test("there are seventeen languages, English among them", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain(DEFAULT_DOCS_LANGUAGE);
    expect(Object.keys(OLD_NAMES).sort()).toEqual([...LANGUAGES].sort());
    expect(Object.keys(LOGS_WORD).sort()).toEqual([...LANGUAGES].sort());
  });

  test.each(LANGUAGES)(
    "%s has the pages that name the runs",
    (language: string) => {
      PAGES_THAT_NAME_THE_RUNS.filter((page: string): boolean => {
        return !page.startsWith("telemetry/");
      }).forEach((page: string) => {
        expect({ page, exists: pageExists(language, page) }).toEqual({
          page,
          exists: true,
        });
      });
    },
  );

  test("the old names are caught where they used to be", () => {
    // Guards the matcher: the replaced English line, as it read before.
    const before: string =
      "| **Workflows → Runs & Logs** | Every run from every workflow in the project. |";

    expect(
      OLD_NAMES["en"]!.some((name: string): boolean => {
        return before.includes(`→ ${name}**`);
      }),
    ).toBe(true);
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  const words: MenuWords = menuWords(language);
  const path_: string = `→ ${words.logs} → ${words.runs}**`;

  /*
   * Titled as its nav link, Workflow Runs, as every docs page is: a bare
   * "Runs" said nothing about whose runs among the docs' other runs (a
   * runbook's, a probe's). The link's title never says logs (below).
   */
  test("the runs page keeps its URL and is titled as its nav link", () => {
    expect(pageExists(language, RUNS_PAGE)).toBe(true);

    const title: string = readPage(language, RUNS_PAGE).split("\n")[0] || "";
    const navLinks: Record<string, string> = readJson(
      path.join(DOCS_LOCALES_DIR, `${language}.json`),
    )["navLinks"] as Record<string, string>;

    expect(title).toBe(`# ${navLinks["Workflow Runs"]}`);
    expect(LOGS_WORD[language]!.test(title)).toBe(false);
  });

  test("the runs page sends readers to Logs → Runs in both menus", () => {
    const page: string = readPage(language, RUNS_PAGE);

    // One row for the Workflows menu, one for a workflow's own menu.
    expect(count(page, path_)).toBe(2);
  });

  test("the overview lists Logs → Runs in both menus", () => {
    const page: string = readPage(language, OVERVIEW_PAGE);

    expect(count(page, `**${words.logs} → ${words.runs}**`)).toBe(2);
  });

  test("no page names the old menu entry any more", () => {
    expect(oldNameMentions(language)).toEqual([]);
  });

  test("links to the runs page no longer call it runs and logs", () => {
    const texts: Array<string> = PAGES_THAT_NAME_THE_RUNS.filter(
      (page: string): boolean => {
        return pageExists(language, page);
      },
    ).flatMap((page: string): Array<string> => {
      return linkTextsToRuns(readPage(language, page));
    });

    // The workflow pages all link to it.
    expect(texts.length).toBeGreaterThanOrEqual(6);
    texts.forEach((text: string) => {
      expect({ text, saysLogs: LOGS_WORD[language]!.test(text) }).toEqual({
        text,
        saysLogs: false,
      });
    });
  });

  test("the docs nav calls the page Workflow Runs", () => {
    const navLinks: Record<string, string> = readJson(
      path.join(DOCS_LOCALES_DIR, `${language}.json`),
    )["navLinks"] as Record<string, string>;

    expect(navLinks["Workflow Runs & Logs"]).toBeUndefined();
    expect(typeof navLinks["Workflow Runs"]).toBe("string");
    expect(navLinks["Workflow Runs"]!.trim().length).toBeGreaterThan(0);
    expect(LOGS_WORD[language]!.test(navLinks["Workflow Runs"]!)).toBe(false);
  });
});

describe("the docs nav", () => {
  test("lists the runs page as Workflow Runs, at its old URL", () => {
    const workflows: NavGroup | undefined = DocsNav.find(
      (group: NavGroup): boolean => {
        return group.title === "Workflows";
      },
    );

    expect(workflows).toBeDefined();

    const runs: Array<NavLink> = workflows!.links.filter(
      (link: NavLink): boolean => {
        return link.url === RUNS_URL;
      },
    );

    expect(runs).toEqual([{ title: "Workflow Runs", url: RUNS_URL }]);
  });

  test("no nav entry is called Runs & Logs", () => {
    const titles: Array<string> = DocsNav.flatMap(
      (group: NavGroup): Array<string> => {
        return group.links.map((link: NavLink): string => {
          return link.title;
        });
      },
    );

    expect(
      titles.filter((title: string): boolean => {
        return title.includes("Runs & Logs");
      }),
    ).toEqual([]);
  });
});
