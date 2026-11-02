import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A page's trail is a list of titles (BuildBreadcrumbLinksByTitles) that
 * Breadcrumbs translates when it draws them. The extractor did not read
 * those lists, so a title no other place happened to use - "View Runbook",
 * "Pod Detail", "View MCP Server" - was no key, and read in English in
 * every language (#5042, #5112, #5150). It reads them now; this holds every
 * trail in the Dashboard to it: each title is a key of en.json, so it is in
 * every locale to translate. A trail added without running
 * `npm run i18n:extract` fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const CALL: string = "BuildBreadcrumbLinksByTitles(";
// A title with a letter in it has words to translate.
const LATIN_LETTER: RegExp = /[A-Za-z]/;

// The Dashboard's sixteen languages besides English.
const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function sourceFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return sourceFiles(full);
      }

      return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
    });
}

const TRAIL_FILES: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
  (file: string): boolean => {
    return (
      fs.readFileSync(file, "utf8").includes(CALL) &&
      // The helper itself builds the trails; it holds no titles.
      !file.endsWith(path.join("Breadcrumbs", "Helper.ts"))
    );
  },
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

// Every title a trail file hands BuildBreadcrumbLinksByTitles, with its file.
function trailTitles(): Array<{ file: string; title: string }> {
  return TRAIL_FILES.flatMap(
    (file: string): Array<{ file: string; title: string }> => {
      const relative: string = path
        .relative(REPOSITORY_ROOT, file)
        .split(path.sep)
        .join("/");

      return scanSourceText(relative, fs.readFileSync(file, "utf8"), {
        kind: "ui",
      })
        .strings.filter((entry: ExtractedString): boolean => {
          return entry.kind === "prop";
        })
        .map((entry: ExtractedString): { file: string; title: string } => {
          return { file: relative, title: entry.text };
        });
    },
  );
}

// A row's page's own crumb: "Route Detail" after "Routes".
const ROW_TITLE_ENDING: string = " Detail";
// One list of titles a trail file hands BuildBreadcrumbLinksByTitles.
const TITLE_LIST: RegExp = /\[([^[\]]*)\]/g;
const QUOTED_TITLE: RegExp = /"([^"\n]+)"/g;

interface RowTrailPair {
  list: string;
  row: string;
}

// Every trail that ends on a row's page, as its list's title and the row's.
function rowTrailPairs(): Array<RowTrailPair> {
  const pairs: Map<string, RowTrailPair> = new Map<string, RowTrailPair>();

  for (const file of TRAIL_FILES) {
    const text: string = fs.readFileSync(file, "utf8");

    for (const list of text.matchAll(TITLE_LIST)) {
      const titles: Array<string> = Array.from(
        (list[1] || "").matchAll(QUOTED_TITLE),
      ).map((title: RegExpMatchArray): string => {
        return title[1] || "";
      });

      titles.forEach((title: string, index: number): void => {
        const previous: string | undefined = titles[index - 1];

        if (previous && title.endsWith(ROW_TITLE_ENDING)) {
          pairs.set(`${previous} > ${title}`, { list: previous, row: title });
        }
      });
    }
  }

  return Array.from(pairs.values());
}

const LOCALES: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>();

function readLocale(language: string): Record<string, string> {
  const read: Record<string, string> =
    LOCALES.get(language) ||
    (JSON.parse(
      fs.readFileSync(
        path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
        "utf8",
      ),
    ) as Record<string, string>);

  LOCALES.set(language, read);

  return read;
}

/*
 * Kinds whose English word is also the language's own (Italian "volume",
 * Spanish "volumen"): a row's crumb that says it is not left in English.
 */
const KINDS_THAT_ARE_THE_LANGUAGES_OWN_WORD: Record<
  string,
  ReadonlyArray<string>
> = {
  es: ["volume"],
  it: ["volume"],
};

/*
 * List and row told apart by two words of the language itself, now one -
 * which no check for the English kind can see - and the rows that were
 * left in English, by the word list and row now share.
 */
const ROWS_IN_THEIR_LISTS_WORDS: ReadonlyArray<{
  language: string;
  list: string;
  row: string;
  word: string;
}> = [
  { language: "de", list: "Tasks", row: "Task Detail", word: "aufgabe" },
  { language: "ko", list: "Tasks", row: "Task Detail", word: "작업" },
  {
    language: "ko",
    list: "Deployments",
    row: "Deployment Detail",
    word: "배포",
  },
  { language: "ko", list: "Routes", row: "Route Detail", word: "라우트" },
  {
    language: "pt",
    list: "Deployments",
    row: "Deployment Detail",
    word: "implanta",
  },
  { language: "pt", list: "Routes", row: "Route Detail", word: "rota" },
  {
    language: "hi",
    list: "Deployments",
    row: "Deployment Detail",
    word: "डिप्लॉयमेंट",
  },
  { language: "hi", list: "Routes", row: "Route Detail", word: "रूट" },
  {
    language: "no",
    list: "Deployments",
    row: "Deployment Detail",
    word: "distribusjon",
  },
  { language: "no", list: "Routes", row: "Route Detail", word: "rute" },
  { language: "da", list: "Routes", row: "Route Detail", word: "rute" },
  { language: "da", list: "Volumes", row: "Volume Detail", word: "diskenhed" },
  { language: "sv", list: "Routes", row: "Route Detail", word: "rutt" },
  {
    language: "sv",
    list: "Containers",
    row: "Container Detail",
    word: "behållar",
  },
  {
    language: "it",
    list: "Containers",
    row: "Container Detail",
    word: "contenitor",
  },
  {
    language: "it",
    list: "Namespaces",
    row: "Namespace Detail",
    word: "dei nomi",
  },
  { language: "nl", list: "Nodes", row: "Node Detail", word: "knooppunt" },
  { language: "ru", list: "Routes", row: "Route Detail", word: "маршрут" },
  { language: "zh-CN", list: "Routes", row: "Route Detail", word: "路由" },
  { language: "zh-CN", list: "Jobs", row: "Job Detail", word: "任务" },
  { language: "zh-TW", list: "Routes", row: "Route Detail", word: "路由" },
  { language: "fa", list: "Routes", row: "Route Detail", word: "مسیر" },
  {
    language: "ja",
    list: "Deployments",
    row: "Deployment Detail",
    word: "deployment",
  },
];

describe("every breadcrumb title in the Dashboard is a translation key", () => {
  test("the trails are found: the breadcrumb utilities and the pages' own", () => {
    expect(TRAIL_FILES.length).toBeGreaterThan(40);
    expect(
      TRAIL_FILES.some((file: string): boolean => {
        return file.endsWith(
          path.join("Breadcrumbs", "RunbooksBreadcrumbs.ts"),
        );
      }),
    ).toBe(true);
    expect(trailTitles().length).toBeGreaterThan(1000);
  });

  test("each title is a key of en.json", () => {
    const missing: Array<string> = trailTitles()
      .filter((entry: { file: string; title: string }): boolean => {
        return ENGLISH[entry.title] !== entry.title;
      })
      .map((entry: { file: string; title: string }): string => {
        return `${entry.file}: ${entry.title}`;
      });

    expect(missing).toEqual([]);
  });

  /*
   * A key is not yet a translation: forty-odd trail titles - Delete Storage
   * Array, Site Types, Reminder Rules, Replay Users, Device Registry,
   * Latency Matrix, Video Calls - were keys of every locale and still read
   * in English in twelve languages (#5305's follow-up). Each title now
   * reads in every language: translated, or listed as reading the same
   * there (i18n/SameAsEnglish.json for every language - product names,
   * protocols - and each locale's i18n/Progress list for its own borrowed
   * words, as "Dashboards" is in Dutch). A title added to a trail needs
   * its words in every language, or a reason it reads the same.
   */
  test("each title reads in every language: translated, or the same there on purpose", () => {
    const i18nDirectory: string = path.join(
      REPOSITORY_ROOT,
      "packages",
      "App",
      "FeatureSet",
      "Dashboard",
      "i18n",
    );
    const everywhereTheSame: Set<string> = new Set<string>(
      JSON.parse(
        fs.readFileSync(path.join(i18nDirectory, "SameAsEnglish.json"), "utf8"),
      ) as Array<string>,
    );
    const titles: Array<string> = Array.from(
      new Set<string>(
        trailTitles().map((entry: { file: string; title: string }): string => {
          return entry.title;
        }),
      ),
    ).filter((title: string): boolean => {
      // "{{count}}"-like titles have no words to translate.
      return LATIN_LETTER.test(title);
    });

    expect(LANGUAGES).toHaveLength(16);
    expect(titles.length).toBeGreaterThan(400);

    for (const language of LANGUAGES) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
        fs.readFileSync(
          path.join(i18nDirectory, "Progress", `${language}.json`),
          "utf8",
        ),
      ) as { sameAsEnglish?: Array<string> };
      const theSameHere: Set<string> = new Set<string>(
        progress.sameAsEnglish || [],
      );

      const inEnglish: Array<string> = titles.filter(
        (title: string): boolean => {
          return (
            locale[title] === title &&
            !everywhereTheSame.has(title) &&
            !theSameHere.has(title)
          );
        },
      );

      expect({ language, inEnglish }).toEqual({ language, inEnglish: [] });
    }
  });

  /*
   * A row's page ends its trail with the row: "... > Routes > Route
   * Detail", and the side menu beside it lights the list the row is one of
   * (SideMenuRowPage). Where a language translated the list but not the
   * row, the two crumbs side by side named one thing in two words: Russian
   * read "Маршруты > Сведения о Route", Korean "배포 > Deployment 세부
   * 정보", German "Aufgaben > Task-Details", Portuguese "Implantações >
   * Detalhes do deployment" - in ten languages for an OpenShift route alone.
   * So where a language translates a list's title, the crumb of one of its
   * rows does not fall back on the English kind; and where two words of the
   * language itself told list and row apart ("Distribusjoner >
   * Utrullingsdetaljer"), the row reads the list's word.
   */
  test("a row's page names the row in the words of its list, in every language", () => {
    const pairs: Array<RowTrailPair> = rowTrailPairs();

    // Kubernetes, OpenShift, Docker, Swarm, Podman, Proxmox, Ceph, VMware...
    expect(pairs.length).toBeGreaterThan(20);
    expect(pairs).toContainEqual({ list: "Routes", row: "Route Detail" });
    expect(pairs).toContainEqual({ list: "Tasks", row: "Task Detail" });

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);
      const ownWords: ReadonlyArray<string> =
        KINDS_THAT_ARE_THE_LANGUAGES_OWN_WORD[language] || [];

      const englishKindLeftIn: Array<string> = pairs
        .filter((pair: RowTrailPair): boolean => {
          const list: string = locale[pair.list] || pair.list;
          const row: string = locale[pair.row] || pair.row;
          const kind: string = pair.row
            .slice(0, -ROW_TITLE_ENDING.length)
            .toLowerCase();

          return (
            list !== pair.list &&
            !ownWords.includes(kind) &&
            row.toLowerCase().includes(kind) &&
            !list.toLowerCase().includes(kind)
          );
        })
        .map((pair: RowTrailPair): string => {
          return `${locale[pair.list]} > ${locale[pair.row]}`;
        });

      expect({ language, englishKindLeftIn }).toEqual({
        language,
        englishKindLeftIn: [],
      });
    }

    for (const { language, list, row, word } of ROWS_IN_THEIR_LISTS_WORDS) {
      const locale: Record<string, string> = readLocale(language);
      const drawn: { list: string; row: string } = {
        list: locale[list] || list,
        row: locale[row] || row,
      };

      expect({
        language,
        ...drawn,
        listSaysIt: drawn.list.toLowerCase().includes(word),
        rowSaysIt: drawn.row.toLowerCase().includes(word),
      }).toEqual({
        language,
        ...drawn,
        listSaysIt: true,
        rowSaysIt: true,
      });
    }
  });

  test("the titles that read in English everywhere before are among them", () => {
    const titles: Set<string> = new Set<string>(
      trailTitles().map((entry: { file: string; title: string }): string => {
        return entry.title;
      }),
    );

    for (const title of [
      "View Runbook",
      "Pod Detail",
      "Node Detail",
      "View MCP Server",
      "View Provider",
      "Host Detail",
      "View Monitor Group",
    ]) {
      expect({ title, isTrailTitle: titles.has(title) }).toEqual({
        title,
        isTrailTitle: true,
      });
      expect(ENGLISH[title]).toBe(title);
    }
  });
});
