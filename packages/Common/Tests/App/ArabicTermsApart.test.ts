// UX rule: Docs/ux/README.md#in-every-language
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * TWO OF ONEUPTIME'S OWN THINGS NEVER SHARE ONE ARABIC WORD (#8581).
 *
 * Arabic's glossary (Dashboard/src/Locales/ARABIC.md) gave the collector an
 * agent runs and a pool - Ceph's, vSphere's resource pool, a connection or
 * a thread pool - one word, المجمّع (المجمّعات). A Ceph cluster's pages and
 * its setup guide name both, often in one paragraph: "the collector reads
 * CEPH_MGR_ENDPOINTS" beside the **Pool** row of what it collects. An
 * Arabic reader could not tell which a sentence meant, and the Arabic Ceph
 * guide had worked round it by calling the collector أداة التجميع, a third
 * word for it.
 *
 * A pool is التجمّع now, and the collector stays المجمّع, in the locale and
 * in every setup guide. This holds:
 *
 *   - no two rows of the glossary give one Arabic word;
 *   - the locale words a collector and a pool as the glossary does;
 *   - every Dashboard text whose English names a pool says التجمّع for it,
 *     and never المجمّع unless it names a collector too; every text that
 *     names a collector says المجمّع (or the Latin name the glossary keeps,
 *     OpenTelemetry Collector) and never التجمّع;
 *   - every Arabic setup guide does the same, and none calls the collector
 *     anything else.
 *
 * Arabic writes its vowels only now and then (المُجمِّع is المجمّع): a word
 * is compared without them, its doubling mark (shadda) kept.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const DASHBOARD_SOURCE: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src",
);

const LOCALES: string = path.join(DASHBOARD_SOURCE, "Locales");

const GLOSSARY_FILE: string = path.join(LOCALES, "ARABIC.md");

type LocaleTree = { [key: string]: string | LocaleTree };

// The collector's word, and the pool's, as the glossary gives them.
const COLLECTOR: string = "المجمّع";
const COLLECTOR_STEM: string = "مجمّع";
const POOL: string = "التجمّع";
const POOL_STEM: string = "تجمّع";

/*
 * Arabic's short vowels, their doubled (tanween) forms, the sukun and the
 * dagger alif: written now and then, never what tells two words apart here.
 * The shadda (U+0651) stays, since المجمّع and المجمع are two words.
 */
const VOWEL_MARKS: RegExp = /[ً-ِْٰ]/g;

const ARABIC_LETTER: RegExp = /[ء-ي]/;

const LATIN_LETTER: RegExp = /[A-Za-z]/;

/*
 * Code and names inside an English text, which a translation keeps as
 * written: `quoted`, a {{placeholder}}, a dotted or snake_case name
 * (pool_id, ceph.pool.stored), key=value, a CamelCase identifier and a
 * file's name (otel-collector-config*.yaml).
 */
const CODE_IN_PROSE: RegExp =
  /`[^`]*`|\{\{[^{}]*\}\}|[\w*-]+\.(?:ya?ml|json|env)\b|\b[\w-]+(?:\.[\w-]+)+\b|\b\w+=\w+|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b|\b\w+_\w+\b/g;

/*
 * Collectors that are a product's own name, which the glossary keeps in
 * Latin letters (OpenTelemetry Collector, Splunk's HTTP Event Collector, a
 * device's NetFlow collector fields), or another thing: a runtime's garbage
 * collector is جامع البيانات المهملة.
 */
const NAMED_COLLECTOR: RegExp =
  /\b(?:OpenTelemetry|OTel|HTTP Event|NetFlow|garbage) collectors?\b/gi;

const NAMES_A_POOL: RegExp = /\bpools?\b/i;

const NAMES_A_COLLECTOR: RegExp = /\bcollectors?\b/i;

/*
 * The collector's word anywhere but in مجمّعة, "aggregated" (مجمّعة حسب
 * البصمة, grouped by fingerprint), which is spelled as it is.
 */
const COLLECTOR_WORD: RegExp = /مجمّع(?!ة)/;

/*
 * The collector called by another name: أداة التجميع ("the collecting
 * tool") and its plural, which the Arabic Ceph guide wrote for it.
 */
const COLLECTOR_OTHERWISE: RegExp =
  /أدا[ةت]\s*(?:ال)?تجميع|أدوات\s*(?:ال)?تجميع/;

/*
 * Texts that name a pool or a collector in other words, each with why. A
 * text only goes here when what its English names is not the thing.
 */
const NOT_THE_THING: Record<string, string> = {
  "Number of vSphere clusters: groups of ESXi hosts that pool their CPU and memory. Clustered hosts in maintenance mode or not responding are counted in red beside the number.":
    "pool is a verb here: the hosts pool (تجمع) their CPU and memory",
  "e.g. Host Collector Key":
    "an example of a key's name, typed over and kept in English",
};

function asCompared(text: string): string {
  return text.replace(VOWEL_MARKS, "");
}

function prose(english: string): string {
  return english.replace(NAMED_COLLECTOR, " ").replace(CODE_IN_PROSE, " ");
}

function readLocale(code: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as LocaleTree;
}

// Every leaf, keyed by its path of keys (joined by a character no key has).
function leaves(tree: LocaleTree, prefix: string = ""): Map<string, string> {
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
}

export interface TermsProblem {
  key: string;
  problem: string;
}

/*
 * What is wrong with one Arabic text, given its English: the words it uses
 * for a pool and for the collector. Pure, so the negative control below can
 * hand it texts of its own.
 */
export function getTermsProblems(
  key: string,
  english: string,
  arabic: string,
): Array<TermsProblem> {
  if (NOT_THE_THING[english] !== undefined) {
    return [];
  }

  const said: string = asCompared(arabic);
  const words: string = prose(english);
  const namesAPool: boolean = NAMES_A_POOL.test(words);
  const namesACollector: boolean = NAMES_A_COLLECTOR.test(words);
  const problems: Array<TermsProblem> = [];

  if (COLLECTOR_OTHERWISE.test(said)) {
    problems.push({
      key,
      problem: `calls the collector otherwise than ${COLLECTOR}`,
    });
  }

  if (namesAPool && !said.includes(POOL_STEM)) {
    problems.push({ key, problem: `names a pool without ${POOL}` });
  }

  if (namesAPool && !namesACollector && COLLECTOR_WORD.test(said)) {
    problems.push({
      key,
      problem: `names a pool and no collector, but says ${COLLECTOR}`,
    });
  }

  if (namesACollector && !said.includes(COLLECTOR_STEM)) {
    problems.push({ key, problem: `names a collector without ${COLLECTOR}` });
  }

  if (namesACollector && !namesAPool && said.includes(POOL_STEM)) {
    problems.push({
      key,
      problem: `names a collector and no pool, but says ${POOL}`,
    });
  }

  return problems;
}

interface GlossaryRow {
  english: string;
  arabic: Array<string>;
}

/*
 * The glossary's rows, each with its Arabic words: the cell split at "/",
 * ";", "," and brackets, keeping the pieces written in Arabic letters only
 * (a note such as "OpenTelemetry Collector stays Latin" is not a word).
 */
export function getGlossaryRows(markdown: string): Array<GlossaryRow> {
  const glossary: string = markdown.split("## Glossary")[1] || "";
  const rows: Array<GlossaryRow> = [];

  for (const row of glossary.matchAll(/^\| (.+?) \| (.+?) \|$/gm)) {
    const english: string = row[1] as string;

    if (english === "English" || english.startsWith("---")) {
      continue;
    }

    const arabic: Array<string> = (row[2] as string)
      .split(/[/;,،()]/)
      .map((piece: string): string => {
        return asCompared(piece.trim());
      })
      .filter((piece: string): boolean => {
        return ARABIC_LETTER.test(piece) && !LATIN_LETTER.test(piece);
      });

    rows.push({ english, arabic });
  }

  return rows;
}

// Each Arabic word two or more rows give, with those rows.
export function getSharedGlossaryWords(
  rows: Array<GlossaryRow>,
): Record<string, Array<string>> {
  const byWord: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const row of rows) {
    for (const word of new Set<string>(row.arabic)) {
      byWord.set(word, [...(byWord.get(word) || []), row.english]);
    }
  }

  const shared: Record<string, Array<string>> = {};

  for (const [word, english] of byWord) {
    if (english.length > 1) {
      shared[word] = english;
    }
  }

  return shared;
}

const ENGLISH: Map<string, string> = leaves(readLocale("en"));
const ARABIC: Map<string, string> = leaves(readLocale("ar"));
const ARABIC_TREE: LocaleTree = readLocale("ar");
const GLOSSARY: string = fs.readFileSync(GLOSSARY_FILE, "utf8");

describe("Arabic's glossary", () => {
  test("gives no two rows one word", () => {
    const rows: Array<GlossaryRow> = getGlossaryRows(GLOSSARY);

    expect(getSharedGlossaryWords(rows)).toEqual({});
    // The table is read whole: some ninety rows, these two among them.
    expect(rows.length).toBeGreaterThan(80);
    expect(
      rows.find((row: GlossaryRow): boolean => {
        return row.english === "Collector";
      })?.arabic,
    ).toEqual([COLLECTOR]);
    expect(
      rows.find((row: GlossaryRow): boolean => {
        return row.english === "Pool";
      })?.arabic,
    ).toEqual([POOL, "التجمّعات"]);
  });

  test("says why a pool is not the collector, and which guard holds it", () => {
    expect(GLOSSARY).toContain("| Pool | التجمّع (التجمّعات) |");
    expect(GLOSSARY).toContain(
      "| Collector | المجمّع (OpenTelemetry Collector stays Latin) |",
    );
    expect(GLOSSARY).toContain("Common/Tests/App/ArabicTermsApart");
  });
});

describe("the Dashboard's Arabic, a collector and a pool apart", () => {
  test("names them as the glossary does", () => {
    const expected: Record<string, string> = {
      Collector: COLLECTOR,
      "Collector Status": "حالة المجمّع",
      Pool: POOL,
      Pools: "التجمّعات",
      pool: "تجمّع",
      pools: "التجمّعات",
      "Pool ID": "معرّف التجمّع",
      "Pool Count": "عدد التجمّعات",
      "Resource Pool": "تجمّع الموارد",
      "Resource Pools": "تجمّعات الموارد",
      "{{count}} pools": "{{count}} من التجمّعات",
      "{{count}} pools_one": "{{count}} تجمّع",
      "{{count}} if it were one pool": "{{count}} لو كان تجمّعًا واحدًا",
    };

    for (const [key, word] of Object.entries(expected)) {
      expect([key, ENGLISH.get(key)]).not.toEqual([key, undefined]);
      expect([key, ARABIC.get(key)]).toEqual([key, word]);
    }

    // The Products menu's line for Ceph, a nested key.
    expect(
      ((ARABIC_TREE["navbar"] as LocaleTree)["items"] as LocaleTree)[
        "cephDescription"
      ],
    ).toBe("راقب عناقيد Ceph وأقراص OSD والتجمّعات.");
  });

  test("every text that names a pool or a collector says it in its own word", () => {
    const problems: Array<TermsProblem> = [];
    let pools: number = 0;
    let collectors: number = 0;

    for (const [key, english] of ENGLISH) {
      const words: string = prose(english);

      pools += NAMES_A_POOL.test(words) ? 1 : 0;
      collectors += NAMES_A_COLLECTOR.test(words) ? 1 : 0;
      problems.push(
        ...getTermsProblems(
          key.split("\u0000").join(" › "),
          english,
          ARABIC.get(key) || "",
        ),
      );
    }

    expect(problems).toEqual([]);
    // Each is named in hundreds of texts, so a slip has somewhere to show.
    expect(pools).toBeGreaterThan(200);
    expect(collectors).toBeGreaterThan(200);
  });

  test("a text listed as naming neither is still the Dashboard's", () => {
    for (const english of Object.keys(NOT_THE_THING)) {
      expect([english, ENGLISH.get(english)]).toEqual([english, english]);
    }
  });
});

/*
 * Each product's Help > Documentation page in Arabic: a setup guide's
 * pieces (Pages/<Product>/DocumentationTranslations/ar.ts, English piece to
 * Arabic piece), or a page that is one Arabic text.
 */
const GUIDE_MODULES: Array<string> = fs
  .readdirSync(path.join(DASHBOARD_SOURCE, "Pages"))
  .filter((page: string): boolean => {
    return fs.existsSync(
      path.join(
        DASHBOARD_SOURCE,
        "Pages",
        page,
        "DocumentationTranslations",
        "ar.ts",
      ),
    );
  })
  .sort();

const GUIDES: Record<string, Record<string, string> | string> = {};

beforeAll(async () => {
  for (const page of GUIDE_MODULES) {
    const loaded: { default: Record<string, string> | string } = (await import(
      path.join(DASHBOARD_SOURCE, "Pages", page, "DocumentationTranslations/ar")
    )) as { default: Record<string, string> | string };

    GUIDES[page] = loaded.default;
  }
});

describe("the Arabic documentation pages", () => {
  test("are every product's that has one, Ceph's among them", () => {
    expect(GUIDE_MODULES).toEqual(
      expect.arrayContaining([
        "Ceph",
        "Docker",
        "DockerSwarm",
        "IoT",
        "Podman",
      ]),
    );
  });

  test.each(GUIDE_MODULES)(
    "%s's names a pool and the collector as the locale does",
    (page: string) => {
      const guide: Record<string, string> | string = GUIDES[page]!;

      if (typeof guide === "string") {
        // A page that is one text has no English beside it to read.
        expect(COLLECTOR_OTHERWISE.test(asCompared(guide))).toBe(false);
        return;
      }

      const problems: Array<TermsProblem> = [];

      for (const [english, arabic] of Object.entries(guide)) {
        problems.push(
          ...getTermsProblems(english.slice(0, 80), english, arabic),
        );
      }

      expect(problems).toEqual([]);
    },
  );

  test("Ceph's says what the agent collects for a pool with the pool's word", () => {
    const ceph: Record<string, string> = GUIDES["Ceph"] as Record<
      string,
      string
    >;

    expect(
      ceph[
        "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |"
      ],
    ).toBe(
      "| **التجمّع** | البايتات المخزنة، والحد الأقصى المتاح، وعدد الكائنات، وعمليات القراءة والكتابة والإنتاجية لكل تجمّع |",
    );
    expect(
      ceph[
        "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target."
      ],
    ).toContain("يعامل المجمّع");
  });
});

describe("the checks above (negative control)", () => {
  test("a pool said with the collector's word, or not at all, is caught", () => {
    expect(
      getTermsProblems("Pool", "Pool", "المجمّع").map(
        (problem: TermsProblem): string => {
          return problem.problem;
        },
      ),
    ).toEqual([
      `names a pool without ${POOL}`,
      `names a pool and no collector, but says ${COLLECTOR}`,
    ]);
    expect(
      getTermsProblems("x", "{{count}} if it were one pool", "لو كان مجمّعًا"),
    ).toHaveLength(2);
    expect(getTermsProblems("x", "Thread pool", "thread pool")).toHaveLength(1);
  });

  test("a collector said with the pool's word, another word or none is caught", () => {
    expect(
      getTermsProblems("x", "Check the collector logs", "سجلات التجمّع"),
    ).toHaveLength(2);
    expect(
      getTermsProblems(
        "x",
        "Then restart the collector",
        "ثم أعد تشغيل أداة التجميع",
      ).map((problem: TermsProblem): string => {
        return problem.problem;
      }),
    ).toEqual([
      `calls the collector otherwise than ${COLLECTOR}`,
      `names a collector without ${COLLECTOR}`,
    ]);
  });

  test("what is right passes: vowels written, aggregated, both named, a name in Latin", () => {
    expect(
      getTermsProblems(
        "x",
        "Check that the collector is running.",
        "تحقق من أن المُجمِّع يعمل.",
      ),
    ).toEqual([]);
    expect(
      getTermsProblems(
        "x",
        "Stored bytes aggregated across pools",
        "البايتات المخزنة مجمّعةً عبر التجمّعات",
      ),
    ).toEqual([]);
    expect(
      getTermsProblems(
        "x",
        "The shared pool, off in the collector's receiver",
        "التجمّع المشترك، معطّل في مستقبِل المجمّع",
      ),
    ).toEqual([]);
    expect(
      getTermsProblems(
        "x",
        "Install the OpenTelemetry Collector",
        "ثبّت OpenTelemetry Collector",
      ),
    ).toEqual([]);
    expect(
      getTermsProblems("x", "Filter by `pool_id`", "صفِّ حسب `pool_id`"),
    ).toEqual([]);
  });

  test("two glossary rows that give one word are caught, and a Latin note is no word", () => {
    const rows: Array<GlossaryRow> = getGlossaryRows(
      [
        "## Glossary",
        "",
        "| English | Arabic |",
        "| --- | --- |",
        "| Collector | المجمّع (OpenTelemetry Collector stays Latin) |",
        "| Pool | المُجمَّع (المجمّعات) |",
        "| Bucket | حاوية التخزين; الحاوية alone once S3 is named |",
        "| Container | الحاوية (الحاويات) |",
      ].join("\n"),
    );

    expect(
      rows.map((row: GlossaryRow): string => {
        return row.english;
      }),
    ).toEqual(["Collector", "Pool", "Bucket", "Container"]);
    expect(getSharedGlossaryWords(rows)).toEqual({
      [COLLECTOR]: ["Collector", "Pool"],
    });
  });
});
