import { describe, expect, test } from "@jest/globals";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import fs from "fs";
import path from "path";
import {
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { dashboardLocale, drawnDashboardLabel } from "./DocsDashboardLabels";

/*
 * THE DASHBOARD LABELS THE TRANSLATED DOCS QUOTE, AND THE PAGES THAT QUOTE
 * THEM.
 *
 * A translated docs page names a Dashboard label exactly as that language's
 * Dashboard draws it (Dashboard/src/Locales/README.md, "Not covered yet"), so
 * a label and every page that quotes it change together. #5295 translated the
 * resource showcases in every language but left thirteen of the labels they
 * draw in English in most languages, because translating them alone broke
 * 242 docs tests: Stale, Devices, Broker health, Queries, Queries from
 * applications, Stacks, Online, OK, p95 latency, Page loads, Page load time
 * (p95), Performance and Session Replay. They were translated together with
 * the pages that quote them. This holds the two together:
 *
 *   - each label reads in every language's own words, or is on that
 *     language's same-as-English list for a reason written here (OK is the
 *     health word every language's monitoring screens show);
 *   - the cloud Instances description quotes the Stale pill as its language
 *     draws it, and every other Dashboard sentence that names one of the
 *     labels - the empty Broker health section's link among them - calls it
 *     what that language's Dashboard draws; a link named after a docs
 *     heading says that heading;
 *   - every English line that quotes one of the labels in bold has the drawn
 *     words in bold on the same line of each translation, and no translation
 *     still quotes in English a label its language translates;
 *   - the storage array templates' category reads as the template picker
 *     draws it;
 *   - the two troubleshooting headings named after a section name it in the
 *     section's own words.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard",
);
const PROGRESS: string = path.join(DASHBOARD, "i18n", "Progress");

const LABELS: ReadonlyArray<string> = [
  "Stale",
  "Devices",
  "Broker health",
  "Queries",
  "Queries from applications",
  "Stacks",
  "Online",
  "OK",
  "p95 latency",
  "Page loads",
  "Page load time (p95)",
  "Performance",
  "Session Replay",
];

// The cloud Instances tab's description, which names the Stale pill.
const INSTANCES_DESCRIPTION: string =
  "Running tasks and instances of this environment, as last reported. Those not seen in the last {{minutes}} minutes are Stale.";

interface SentenceNamingALabel {
  sentence: string;
  label: string;
}

/*
 * The Dashboard's own sentences that name one of the labels: the link under
 * an empty Broker health section to the docs entry named after it, the queue
 * guide's summaries, the descriptions beside a Stale pill. A language that
 * words such a sentence calls the label in it what its Dashboard draws: the
 * German section "Broker-Zustand" used to send its reader on with
 * "Broker-Integrität bleibt leer", the Spanish "Salud del broker" with "El
 * estado del broker sigue vacío", and the Japanese "ブローカーの正常性" with
 * "ブローカーのヘルス".
 */
const SENTENCES_NAMING_A_LABEL: ReadonlyArray<SentenceNamingALabel> = [
  { sentence: INSTANCES_DESCRIPTION, label: "Stale" },
  {
    sentence:
      "Monitors show In Quorum when they agree with the majority on the cluster map, and Out of Quorum when they do not. Other daemons show Reporting if seen in the last 15 minutes; any daemon silent for longer shows Stale.",
    label: "Stale",
  },
  { sentence: "Broker health stays empty →", label: "Broker health" },
  {
    sentence: "Broker health metrics in the Queues guide →",
    label: "Broker health",
  },
  {
    sentence:
      "No broker metrics chart under Broker health for this system; where its metrics show instead.",
    label: "Broker health",
  },
  {
    sentence:
      "The broker metrics Broker health charts, and which of them offer Create monitor.",
    label: "Broker health",
  },
];

/*
 * The labels a sentence can only name: inside an English sentence, past its
 * first word, they are the label (a lowercase "p95 latency" or a "Network
 * Devices" is not). Every such sentence is listed above.
 */
const LABELS_NAMED_IN_SENTENCES: ReadonlyArray<string> = [
  "Stale",
  "Broker health",
  "Queries from applications",
  "Page loads",
  "Page load time (p95)",
];

interface LinkToDocsHeading {
  link: string;
  page: string;
  heading: string;
  // The source file that gives the link its address, the heading's anchor.
  source: string;
  // The link says the heading and nothing else (and its arrow).
  isTheHeading: boolean;
}

/*
 * The Dashboard links named after the docs heading they open. In a language
 * that words the link, it says that heading as the language's guide words
 * it, so the reader finds the entry the link promised.
 */
const LINKS_TO_DOCS_HEADINGS: ReadonlyArray<LinkToDocsHeading> = [
  {
    link: "Broker health stays empty →",
    page: "telemetry/queues",
    heading: "### Broker health stays empty",
    source: "src/Components/MessageQueue/MessageQueueOverviewPresentation.ts",
    isTheHeading: true,
  },
  {
    link: "Broker health metrics in the Queues guide →",
    page: "telemetry/queues",
    heading: "## Broker health metrics",
    source: "src/Components/MessageQueue/MessageQueueOverviewPresentation.ts",
    isTheHeading: false,
  },
];

const HEADING_MARKS: RegExp = /^#+\s+/;
const WORD_CHARACTER_AT_END: RegExp = /[\p{L}\p{N}]$/u;
const WORD_CHARACTER_AT_START: RegExp = /^[\p{L}\p{N}]/u;
const SENTENCE_END: RegExp = /[.!?:;]\s*$/;

// Whether an English sentence names the label inside it, past its first word.
function namesInside(sentence: string, label: string): boolean {
  let from: number = 0;

  for (;;) {
    const index: number = sentence.indexOf(label, from);

    if (index < 0) {
      return false;
    }

    const before: string = sentence.slice(0, index);
    const after: string = sentence.slice(index + label.length);
    const isWholeWords: boolean =
      !WORD_CHARACTER_AT_END.test(before) &&
      !WORD_CHARACTER_AT_START.test(after);
    const startsASentence: boolean =
      before.trim() === "" || SENTENCE_END.test(before);

    if (isWholeWords && !startsASentence) {
      return true;
    }

    from = index + 1;
  }
}

interface KeptAsWritten {
  languages: ReadonlyArray<string>;
  reason: string;
}

/*
 * The labels a language writes as the English does, and why. Each is on that
 * language's same-as-English list (i18n/Progress/<code>.json); every other
 * language words the label its own way.
 */
const KEPT_AS_WRITTEN: Readonly<Record<string, KeptAsWritten>> = {
  Stacks: {
    languages: ["de", "fr", "es", "it", "pt", "nl", "da", "no", "sv"],
    reason:
      "Docker's own name for a group of services, which these languages' Docker tools keep as it is.",
  },
  Online: {
    languages: ["de", "it", "pt", "nl", "da", "no", "sv"],
    reason:
      "The word these languages' screens use for a device or a monitor that answers.",
  },
  OK: {
    languages: [
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
    ],
    reason:
      "The health word monitoring screens show in every language, and the same key is a dialog's OK button, which a status word such as Russian 'В норме' would get wrong.",
  },
};

interface NotTheLabel {
  page: string;
  label: string;
  reason: string;
}

/*
 * English pages whose bold word spells one of the labels without quoting
 * that Dashboard label: their translations word it their own way.
 */
const NOT_THE_LABEL: ReadonlyArray<NotTheLabel> = [
  {
    page: "monitor/database-health-monitor",
    label: "Queries",
    reason:
      "The metric table names the catalog's metric, which the monitor form draws as written in every language.",
  },
  ...["api", "dns", "ip", "ntp", "ping", "port", "website"].map(
    (kind: string): NotTheLabel => {
      return {
        page: `monitor/${kind}-monitor`,
        label: "Online",
        reason:
          "The docs' name for the monitor's default online criteria, which the criteria list calls 'Check if (name) is online'.",
      };
    },
  ),
];

/*
 * The pages the translation pass found quoting each label, which the scan
 * below must find too (it may find more).
 */
const KNOWN_QUOTES: Readonly<Record<string, ReadonlyArray<string>>> = {
  Stale: [
    "inventory/overview",
    "monitor/network-device-monitor",
    "telemetry/cloud-aws-ecs",
    "telemetry/cloud-troubleshooting",
  ],
  Devices: [
    "monitor/network-device-monitor",
    "monitor/network-vendor-guides",
    "telemetry/iot-devices",
  ],
  "Broker health": ["telemetry/queues"],
  Queries: ["telemetry/databases"],
  "Queries from applications": ["telemetry/databases"],
  Stacks: ["telemetry/docker-swarm"],
  Online: ["monitor/database-health-monitor", "telemetry/proxmox"],
  OK: [
    "monitor/network-device-monitor",
    "monitor/traces-monitor",
    "telemetry/storage-arrays",
  ],
  "p95 latency": ["telemetry/cloud-environments"],
  "Page loads": ["rum/index"],
  "Page load time (p95)": ["rum/index"],
  "Session Replay": ["rum/index", "telemetry/session-replay"],
};

// Troubleshooting entries named after a Dashboard section.
const SECTION_HEADINGS: ReadonlyArray<{
  page: string;
  heading: string;
  label: string;
}> = [
  {
    page: "telemetry/databases",
    heading: "### Queries from applications is empty",
    label: "Queries from applications",
  },
  {
    page: "telemetry/queues",
    heading: "### Broker health stays empty",
    label: "Broker health",
  },
];

const STORAGE_ARRAY_PAGE: string = "monitor/storage-array-monitor";
const STORAGE_ARRAY_TEMPLATE_TABLES: ReadonlyArray<string> = [
  "### FlashArray",
  "### FlashBlade",
];

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`[^`\n]*`/g;
const FENCE: RegExp = /^\s*(?:```|~~~)/;
// A menu path's separators: "Network → Devices", Persian "شبکه > دستگاه‌ها".
const PATH_SEPARATOR: RegExp = / → | > /;
const COLONS: ReadonlyArray<string> = [":", "："];

function valueOf(language: string, key: string): string {
  const value: unknown = dashboardLocale(language)[key];

  return typeof value === "string" ? value : key;
}

function sameAsEnglishIn(language: string): Array<string> {
  return (
    (
      JSON.parse(
        fs.readFileSync(path.join(PROGRESS, `${language}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || []
  );
}

// A page's lines with its fenced code blocks blanked, so line numbers hold.
function proseLines(markdown: string): Array<string> {
  let inCode: boolean = false;

  return markdown.split("\n").map((line: string): string => {
    if (FENCE.test(line)) {
      inCode = !inCode;
      return "";
    }

    return inCode ? "" : line;
  });
}

// A bold span's words: a label, each step of a menu path, a bullet's "Stale:".
function wordsOfSpan(span: string): Array<string> {
  return span.split(PATH_SEPARATOR).map((part: string): string => {
    let word: string = part.trim();

    for (const colon of COLONS) {
      if (word.endsWith(colon)) {
        word = word.slice(0, -colon.length).trim();
      }
    }

    return word;
  });
}

// The words a line writes in bold, outside its code spans.
function boldWords(line: string): Array<string> {
  const masked: string = line.replace(INLINE_CODE, (code: string): string => {
    return "\u0000".repeat(code.length);
  });
  const words: Array<string> = [];

  for (const match of Array.from(masked.matchAll(BOLD))) {
    if ((match[0] as string).includes("\u0000")) {
      continue;
    }

    words.push(...wordsOfSpan(match[1] as string));
  }

  return words;
}

function isNotTheLabel(page: string, label: string): boolean {
  return NOT_THE_LABEL.some((entry: NotTheLabel): boolean => {
    return entry.page === page && entry.label === label;
  });
}

interface Quote {
  page: string;
  line: number;
  label: string;
}

// Every English line that quotes one of the labels in bold.
function englishQuotes(): Array<Quote> {
  const quotes: Array<Quote> = [];

  for (const page of listPages("en")) {
    proseLines(readPage("en", page)).forEach(
      (line: string, index: number): void => {
        const words: Array<string> = boldWords(line);

        for (const label of LABELS) {
          if (words.includes(label) && !isNotTheLabel(page, label)) {
            quotes.push({ page, line: index, label });
          }
        }
      },
    );
  }

  return quotes;
}

const QUOTES: Array<Quote> = englishQuotes();

function quotesOn(page: string): Array<Quote> {
  return QUOTES.filter((quote: Quote): boolean => {
    return quote.page === page;
  });
}

const QUOTING_PAGES: Array<string> = Array.from(
  new Set(
    QUOTES.map((quote: Quote): string => {
      return quote.page;
    }),
  ),
).sort();

describe("the labels the translated docs quote", () => {
  test.each(
    TRANSLATED_LANGUAGES.flatMap(
      (language: string): Array<[string, string]> => {
        return LABELS.map((label: string): [string, string] => {
          return [language, label];
        });
      },
    ),
  )(
    "%s: %s reads in the language's own words, or is kept as written for a reason",
    (language: string, label: string) => {
      const kept: boolean = Boolean(
        KEPT_AS_WRITTEN[label]?.languages.includes(language),
      );

      expect({
        label,
        language,
        drawn: valueOf(language, label) === label ? "as written" : "own words",
        onTheSameAsEnglishList: sameAsEnglishIn(language).includes(label),
      }).toEqual({
        label,
        language,
        drawn: kept ? "as written" : "own words",
        onTheSameAsEnglishList: kept,
      });
    },
  );

  test("are labels the English Dashboard draws", () => {
    for (const label of LABELS) {
      expect({ label, english: valueOf("en", label) }).toEqual({
        label,
        english: label,
      });
    }
  });

  test("keep as written only these labels, in languages the docs have, each with a reason", () => {
    for (const [label, kept] of Object.entries(KEPT_AS_WRITTEN)) {
      expect(LABELS).toContain(label);
      expect(kept.reason.length).toBeGreaterThan(20);
      expect(new Set(kept.languages).size).toBe(kept.languages.length);

      for (const language of kept.languages) {
        expect(TRANSLATED_LANGUAGES).toContain(language);
      }
    }
  });
});

describe("the cloud Instances description", () => {
  test("is the one the Instances tab draws, beside its Stale pill", () => {
    const instances: string = fs.readFileSync(
      path.join(DASHBOARD, "src/Pages/Cloud/View/Instances.tsx"),
      "utf8",
    );

    expect(instances).toContain(INSTANCES_DESCRIPTION);
    expect(instances).toContain('text={isLive ? "Running" : "Stale"}');
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s quotes the Stale pill its Dashboard draws",
    (language: string) => {
      const description: string = valueOf(language, INSTANCES_DESCRIPTION);
      const stale: string = valueOf(language, "Stale");

      expect(description).not.toBe(INSTANCES_DESCRIPTION);
      expect(stale).not.toBe("Stale");
      expect({ language, quotesItsPill: description.includes(stale) }).toEqual({
        language,
        quotesItsPill: true,
      });
      expect({
        language,
        quotesEnglish: description.includes("Stale"),
      }).toEqual({ language, quotesEnglish: false });
    },
  );
});

describe("the Dashboard's own sentences that name a label", () => {
  test("are English Dashboard keys, and every sentence that names one of these labels inside it is listed", () => {
    const english: Record<string, unknown> = dashboardLocale("en");
    const listed: Array<string> = SENTENCES_NAMING_A_LABEL.map(
      (entry: SentenceNamingALabel): string => {
        return entry.sentence;
      },
    );

    for (const entry of SENTENCES_NAMING_A_LABEL) {
      expect({
        ...entry,
        isAKey: english[entry.sentence] === entry.sentence,
      }).toEqual({ ...entry, isAKey: true });
      expect(LABELS).toContain(entry.label);
      expect(entry.sentence).toContain(entry.label);
    }

    const unlisted: Array<string> = Object.keys(english).filter(
      (key: string): boolean => {
        return (
          !listed.includes(key) &&
          LABELS_NAMED_IN_SENTENCES.some((label: string): boolean => {
            return key !== label && namesInside(key, label);
          })
        );
      },
    );

    expect(unlisted).toEqual([]);
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s: a sentence it words calls the label what its Dashboard draws",
    (language: string) => {
      const misnamed: Array<string> = [];

      for (const entry of SENTENCES_NAMING_A_LABEL) {
        const worded: string = valueOf(language, entry.sentence);
        const drawn: string = valueOf(language, entry.label);

        // An English sentence names the label in English, as written.
        if (worded === entry.sentence) {
          continue;
        }

        if (
          !worded
            .toLocaleLowerCase(language)
            .includes(drawn.toLocaleLowerCase(language))
        ) {
          misnamed.push(`${entry.sentence} -> ${worded} (not ${drawn})`);
        }

        if (drawn !== entry.label && worded.includes(entry.label)) {
          misnamed.push(`${entry.sentence} -> ${worded} (English label)`);
        }
      }

      expect({ language, misnamed }).toEqual({ language, misnamed: [] });
    },
  );

  test("lead, as links, to the docs heading they are named after", () => {
    for (const entry of LINKS_TO_DOCS_HEADINGS) {
      const anchor: string = slugifyMarkdownHeading(
        entry.heading.replace(HEADING_MARKS, ""),
      );
      const source: string = fs.readFileSync(
        path.join(DASHBOARD, entry.source),
        "utf8",
      );

      expect(readPage("en", entry.page).split("\n")).toContain(entry.heading);
      expect({
        ...entry,
        linksTheAnchor: source.includes(`"${anchor}"`),
      }).toEqual({ ...entry, linksTheAnchor: true });
      expect(valueOf("en", entry.link)).toBe(entry.link);
    }
  });

  test.each(
    TRANSLATED_LANGUAGES.flatMap(
      (language: string): Array<[string, string]> => {
        return LINKS_TO_DOCS_HEADINGS.map(
          (entry: LinkToDocsHeading): [string, string] => {
            return [language, entry.link];
          },
        );
      },
    ),
  )("%s: '%s' says the heading it opens", (language: string, link: string) => {
    const entry: LinkToDocsHeading = LINKS_TO_DOCS_HEADINGS.find(
      (candidate: LinkToDocsHeading): boolean => {
        return candidate.link === link;
      },
    ) as LinkToDocsHeading;
    const worded: string = valueOf(language, entry.link);
    const index: number = readPage("en", entry.page)
      .split("\n")
      .indexOf(entry.heading);
    const heading: string =
      readPage(language, entry.page).split("\n")[index] || "";
    const marks: string = (entry.heading.match(HEADING_MARKS) || [""])[0];

    // The guide's entry, on the English entry's line, at its level.
    expect(heading.startsWith(marks)).toBe(true);

    const words: string = heading.slice(marks.length).trim();

    // An English link names the English heading.
    if (worded === entry.link) {
      return;
    }

    expect({ language, link: worded }).toEqual({
      language,
      link: entry.isTheHeading ? `${words} →` : expect.stringContaining(words),
    });
  });
});

describe("the docs pages that quote them", () => {
  test("are found where the translation pass found them", () => {
    for (const [label, pages] of Object.entries(KNOWN_QUOTES)) {
      const found: Array<string> = QUOTES.filter((quote: Quote): boolean => {
        return quote.label === label;
      }).map((quote: Quote): string => {
        return quote.page;
      });

      for (const page of pages) {
        expect({ label, page, quoted: found.includes(page) }).toEqual({
          label,
          page,
          quoted: true,
        });
      }
    }

    expect(QUOTES.length).toBeGreaterThanOrEqual(50);
  });

  test("leave alone only lines the English pages still have", () => {
    for (const entry of NOT_THE_LABEL) {
      const quoted: boolean = proseLines(readPage("en", entry.page)).some(
        (line: string): boolean => {
          return boldWords(line).includes(entry.label);
        },
      );

      expect({ ...entry, quoted }).toEqual({ ...entry, quoted: true });
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  test.each(
    QUOTING_PAGES.flatMap((page: string): Array<[string, string]> => {
      return TRANSLATED_LANGUAGES.filter((language: string): boolean => {
        return hasPage(language, page);
      }).map((language: string): [string, string] => {
        return [language, page];
      });
    }),
  )(
    "%s %s quotes each label in bold as its Dashboard draws it, on the English line's line",
    (language: string, page: string) => {
      const english: Array<string> = proseLines(readPage("en", page));
      const translated: Array<string> = proseLines(readPage(language, page));
      const missing: Array<string> = [];

      for (const quote of quotesOn(page)) {
        const drawn: string = drawnDashboardLabel(language, quote.label);

        if (translated.length === english.length) {
          if (!boldWords(translated[quote.line] as string).includes(drawn)) {
            missing.push(`line ${quote.line + 1}: ${drawn}`);
          }
        } else {
          // A translation laid out apart from its English page: by count.
          const times: number = quotesOn(page).filter((other: Quote) => {
            return other.label === quote.label;
          }).length;
          const found: number = translated.filter((line: string) => {
            return boldWords(line).includes(drawn);
          }).length;

          if (found < times) {
            missing.push(`${times} times, found ${found}: ${drawn}`);
          }
        }
      }

      expect({ language, page, missing }).toEqual({
        language,
        page,
        missing: [],
      });
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s quotes none of them in English where its Dashboard translates it",
    (language: string) => {
      const english: Array<string> = [];

      for (const page of listPages(language)) {
        proseLines(readPage(language, page)).forEach(
          (line: string, index: number): void => {
            const words: Array<string> = boldWords(line);

            for (const label of LABELS) {
              if (
                words.includes(label) &&
                drawnDashboardLabel(language, label) !== label &&
                !isNotTheLabel(page, label)
              ) {
                english.push(`${page}:${index + 1} ${label}`);
              }
            }
          },
        );
      }

      expect(english).toEqual([]);
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s storage array template tables name the Performance category as the picker draws it",
    (language: string) => {
      const english: Array<string> = readPage("en", STORAGE_ARRAY_PAGE).split(
        "\n",
      );
      const translated: Array<string> = readPage(
        language,
        STORAGE_ARRAY_PAGE,
      ).split("\n");
      const drawn: string = drawnDashboardLabel(language, "Performance");
      let rows: number = 0;

      for (const heading of STORAGE_ARRAY_TEMPLATE_TABLES) {
        const start: number = english.indexOf(heading);

        expect(start).toBeGreaterThan(-1);
        expect(translated[start]).toBe(heading);

        for (
          let index: number = start + 1;
          index < english.length && !english[index]?.startsWith("#");
          index++
        ) {
          const cells: Array<string> = (english[index] as string)
            .split("|")
            .map((cell: string): string => {
              return cell.trim();
            });

          if (cells[2] !== "Performance") {
            continue;
          }

          rows++;
          expect({
            language,
            template: cells[1],
            category: (translated[index] as string).split("|")[2]?.trim(),
          }).toEqual({ language, template: cells[1], category: drawn });
        }
      }

      expect(rows).toBe(3);
    },
  );

  test.each(
    SECTION_HEADINGS.flatMap(
      (
        entry: (typeof SECTION_HEADINGS)[number],
      ): Array<[string, string, string, string]> => {
        return TRANSLATED_LANGUAGES.map(
          (language: string): [string, string, string, string] => {
            return [language, entry.page, entry.heading, entry.label];
          },
        );
      },
    ),
  )(
    "%s %s: the heading for '%s' names the section in its own words",
    (language: string, page: string, heading: string, label: string) => {
      const index: number = readPage("en", page).split("\n").indexOf(heading);
      const translated: string =
        readPage(language, page).split("\n")[index] || "";
      const drawn: string = drawnDashboardLabel(language, label);

      expect(index).toBeGreaterThan(-1);
      expect(translated.startsWith("### ")).toBe(true);
      expect({
        language,
        heading: translated,
        namesTheSection: translated
          .toLocaleLowerCase(language)
          .includes(drawn.toLocaleLowerCase(language)),
      }).toEqual({ language, heading: translated, namesTheSection: true });
    },
  );
});

describe("the checks above", () => {
  test("read a bold label, a menu path's steps and a bullet's label", () => {
    expect(
      boldWords("Go to **Network → Devices** and click **Add Device**."),
    ).toEqual(["Network", "Devices", "Add Device"]);
    expect(boldWords("- **Stale:** the **Instances** tab")).toEqual([
      "Stale",
      "Instances",
    ]);
    expect(boldWords("- **Obsolète :** l'onglet")).toEqual(["Obsolète"]);
    expect(boldWords("- **已过时：** 如果")).toEqual(["已过时"]);
    expect(boldWords("به **شبکه** > **دستگاه‌ها** بروید")).toEqual([
      "شبکه",
      "دستگاه‌ها",
    ]);
  });

  test("tell a label a sentence names from the same word that starts a sentence", () => {
    expect(
      namesInside(
        "No broker metrics chart under Broker health for this system.",
        "Broker health",
      ),
    ).toBe(true);
    expect(
      namesInside("Those not seen in the last 15 minutes are Stale.", "Stale"),
    ).toBe(true);
    expect(namesInside("Stale values indicate issues.", "Stale")).toBe(false);
    expect(
      namesInside(
        "Timestamp of the last sync. Stale values indicate issues.",
        "Stale",
      ),
    ).toBe(false);
    expect(namesInside("Broker health stays empty →", "Broker health")).toBe(
      false,
    );
    expect(namesInside("Rows go Stalest first.", "Stale")).toBe(false);
  });

  test("leave code alone: a code span, and a fenced block's lines", () => {
    expect(boldWords("`**Stale**` is not bold here")).toEqual([]);
    expect(
      proseLines(
        ["**Stale**", "```text", "**Stale**", "```", "**Stale**"].join("\n"),
      ),
    ).toEqual(["**Stale**", "", "", "", "**Stale**"]);
  });

  test("catch a translation that still quotes the English label, or lost it", () => {
    // A Danish line from before the labels were translated.
    const before: string =
      "Gå til **Netværk → Devices**, og klik på **Tilføj enhed**.";
    const after: string =
      "Gå til **Netværk → Enheder**, og klik på **Tilføj enhed**.";

    expect(boldWords(before)).toContain("Devices");
    expect(boldWords(before)).not.toContain(
      drawnDashboardLabel("da", "Devices"),
    );
    expect(boldWords(after)).toContain(drawnDashboardLabel("da", "Devices"));
    expect(boldWords(after)).not.toContain("Devices");
  });
});
