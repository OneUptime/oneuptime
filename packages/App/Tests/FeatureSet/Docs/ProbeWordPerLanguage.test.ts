// UX rule: Docs/ux/README.md#in-every-language
import {
  KeptPhrase,
  OneName,
  otherWordIn,
  wordsOf,
} from "../../Dashboard/OneNamePerThing";
import {
  PROBE_LANGUAGES,
  PROBE_WORDS,
  ProbeWords,
} from "../../Dashboard/ProbeWords";
import {
  DocsBlock,
  PairedBlock,
  blocksOf,
  diagramWordsOf,
  ownWordsOf,
  pairedBlocksOf,
} from "./DocsBlocks";
import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";

/*
 * THE TRANSLATED DOCS, AND THE DASHBOARD, CALL A PROBE BY THE DASHBOARD'S
 * WORD (#7976).
 *
 * A reader saw Sonder in the Danish side menu and on a monitor's Probes
 * card, and read probes, prober and proben in the docs - sometimes on one
 * page - and the Dashboard's own sentences said "Globale probes" over a
 * list of Sonder. Simplified Chinese drew 探测器 and wrote 探针, Traditional
 * Chinese 探測器 and 探針, Persian پراب beside کاوشگر (its word for an
 * explorer), پروب and the English probe. PR #7961 fixed one docs page; this
 * holds every page, and every app's locale file, to the Dashboard's word:
 *
 *   - the Dashboard's word is its "Probe" key's translation, read from its
 *     locale file, so a rename moves the docs with it;
 *   - no translated string of the Dashboard, the Admin Dashboard, the
 *     sign-in pages, the status page, the public dashboards, the API
 *     reference, the server or the docs navigation says another word
 *     (ProbeWords: others), and no block of a docs page does - prose,
 *     headings, table rows, bold leads and diagram labels;
 *   - a Persian block says کاوشگر only where its English says explorer;
 *   - nearly every block whose English names a probe says the Dashboard's
 *     word, so a page cannot drop it for a third one.
 *
 * Code, link targets, placeholders and tags are not words (wordsOf), and
 * what a block has word for word from its English block - a row not
 * translated yet, a criteria's name in a table, a Dashboard label drawn in
 * English, a quoted message the product writes in English - is the English
 * kept as written (ownWordsOf). An English copy in a locale file is the
 * i18n ratchet's business. A phrase whose other word names something that is
 * not a OneUptime probe - a cloud's startup or health probe, the eBPF probe
 * OBI attaches - is in ProbeWords' keptPhrases with why.
 *
 * A failure names the page and line, or the app and key, and the word:
 * write the Dashboard's word there, in the form the sentence needs (da:
 * sonde, sonden, sonder, sonderne, sondes; nl: sonde, sondes; fa: پراب,
 * پراب‌ها, پراب‌های, پرابی).
 */

const APPS_DIR: string = path.resolve(__dirname, "../../../FeatureSet");
const COMMON_DIR: string = path.resolve(__dirname, "../../../../Common");

// Every app's locale folder, by the app's name, and the docs navigation's.
const LOCALE_DIRS: Readonly<Record<string, string>> = {
  Dashboard: path.join(APPS_DIR, "Dashboard/src/Locales"),
  "Admin Dashboard": path.join(APPS_DIR, "AdminDashboard/src/Locales"),
  "Sign-in pages": path.join(APPS_DIR, "Accounts/src/Locales"),
  "Status page": path.join(APPS_DIR, "StatusPage/src/Locales"),
  "Public dashboards": path.join(APPS_DIR, "PublicDashboard/src/Locales"),
  "API reference": path.join(APPS_DIR, "APIReference/Locales"),
  Server: path.join(COMMON_DIR, "Server/Locales"),
  "Docs navigation": path.join(APPS_DIR, "Docs/Locales"),
};

// The Dashboard's word for a probe, and for probes, in each language.
const DASHBOARD_WORDS: Readonly<
  Record<string, { probe: string; probes: string }>
> = {
  fa: { probe: "پراب", probes: "پراب‌ها" },
  "zh-CN": { probe: "探测器", probes: "探测器" },
  "zh-TW": { probe: "探測器", probes: "探測器" },
  da: { probe: "Sonde", probes: "Sonder" },
  nl: { probe: "Sonde", probes: "Sondes" },
};

// English that names a OneUptime probe: not a cloud's, a kernel's or a query.
const NAMES_A_PROBE: RegExp = /(?<![\p{L}\p{N}_-])probes?(?![\p{L}\p{N}_-])/iu;
const NAMES_ANOTHER_PROBE: RegExp =
  /startup probe|health probe|attaches a probe|probe query|a couple of probes|runs its probes/i;
const SAYS_EXPLORER: RegExp = /explor/i;
// The Persian Dashboard's word for an explorer.
const PERSIAN_EXPLORER: RegExp = /کاوشگر/;

// The Dashboard's word for a probe in a language, as its locale says it.
function dashboardWordOf(language: string): RegExp {
  return new RegExp(
    escapeRegExp(readDashboardLocale(language)["Probe"]!),
    "iu",
  );
}

// ProbeWords as the name OneNamePerThing reads a text for.
function asName(words: ProbeWords): OneName {
  return {
    title: "Probes",
    word: /./u,
    others: words.others,
    keptPhrases: words.keptPhrases,
  };
}

/*
 * Names a text writes that are not words, beside the ones wordsOf knows: an
 * environment variable (PROBE_KEY), and a list of a JSON object's fields
 * ({probeName, isConnected}).
 */
const NAMES_NOT_WORDS: RegExp =
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\{[A-Za-z_][\w]*(?:,\s*[A-Za-z_][\w]*)+\}/g;

/*
 * The other word a text says for a probe, or the explorer word where its
 * English names no explorer: null when it says neither.
 */
function otherProbeWordIn(
  language: string,
  english: string,
  rawText: string,
): string | null {
  const words: ProbeWords = PROBE_WORDS[language]!;
  const text: string = rawText.replace(NAMES_NOT_WORDS, " ");
  const other: string | null = otherWordIn(asName(words), text);

  if (other) {
    return other;
  }

  if (!words.explorer || SAYS_EXPLORER.test(english)) {
    return null;
  }

  return otherWordIn(
    {
      title: "Explorers",
      word: /./u,
      others: words.explorer.word,
      keptPhrases: words.explorer.keptPhrases,
    },
    text,
  );
}

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

function stringsIn(directory: string, language: string): Strings {
  const file: string = path.join(directory, `${language}.json`);

  return fs.existsSync(file)
    ? flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map())
    : new Map();
}

interface TranslatedString {
  key: string;
  english: string;
  text: string;
}

/*
 * The strings of a locale folder a language has translated, beside their
 * English: a string that is its English copy is left to the i18n ratchet.
 */
function translatedStrings(
  directory: string,
  language: string,
): Array<TranslatedString> {
  const english: Strings = stringsIn(directory, "en");
  const found: Array<TranslatedString> = [];

  for (const [key, text] of stringsIn(directory, language)) {
    const englishText: string = english.get(key) ?? key.split(".").pop() ?? key;

    if (text !== englishText) {
      found.push({ key, english: englishText, text });
    }
  }

  return found;
}

function localeSightings(app: string, language: string): Array<string> {
  return translatedStrings(LOCALE_DIRS[app]!, language).flatMap(
    (entry: TranslatedString): Array<string> => {
      const says: string | null = otherProbeWordIn(
        language,
        entry.english,
        entry.text,
      );

      return says ? [`${app} ${JSON.stringify(entry.key)}: ${says}`] : [];
    },
  );
}

function sighting(
  language: string,
  page: string,
  line: number,
  says: string,
): string {
  return `packages/App/FeatureSet/Docs/Content/${language}/${page}.md:${line}: ${says}`;
}

/*
 * The docs lines that say another word. A page that does not pair with its
 * English page (a block more or less) is read on its own, every word of it.
 */
function docsSightings(language: string): Array<string> {
  const { paired, unpaired } = pairedBlocksOf(language);
  const sightings: Array<string> = paired.flatMap(
    (block: PairedBlock): Array<string> => {
      const says: string | null = otherProbeWordIn(
        language,
        wordsOf(block.english.text),
        ownWordsOf(block.english, block.translation),
      );

      return says ? [sighting(language, block.page, block.line, says)] : [];
    },
  );

  for (const page of unpaired) {
    for (const own of blocksOf(readPage(language, page))) {
      const says: string | null = own.code
        ? null
        : otherWordIn(
            asName(PROBE_WORDS[language]!),
            (own.diagram ? diagramWordsOf(own.text) : own.text).replace(
              NAMES_NOT_WORDS,
              " ",
            ),
          );

      if (says) {
        sightings.push(sighting(language, page, own.line + 1, says));
      }
    }
  }

  return sightings;
}

// The pages that do not pair with their English page, and name a probe.
function unpairedNamingAProbe(language: string): Array<string> {
  return pairedBlocksOf(language).unpaired.filter((page: string): boolean => {
    return NAMES_A_PROBE.test(wordsOf(readPage("en", page)));
  });
}

// The blocks whose English names a OneUptime probe, with their own words.
function blocksNamingAProbe(
  language: string,
): Array<{ block: PairedBlock; words: string }> {
  return pairedBlocksOf(language)
    .paired.filter((block: PairedBlock): boolean => {
      const english: string = block.english.diagram
        ? diagramWordsOf(block.english.text)
        : wordsOf(block.english.text);

      return NAMES_A_PROBE.test(english) && !NAMES_ANOTHER_PROBE.test(english);
    })
    .map((block: PairedBlock) => {
      return { block, words: ownWordsOf(block.english, block.translation) };
    })
    .filter((entry: { block: PairedBlock; words: string }): boolean => {
      return entry.words.trim() !== "";
    });
}

function block(text: string, diagram: boolean = false): DocsBlock {
  return { line: 0, text, code: false, diagram };
}

describe("the Dashboard's word for a probe", () => {
  test.each(PROBE_LANGUAGES)(
    "%s: is its Probe and Probes keys' translation",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        probe: words["Probe"],
        probes: words["Probes"],
      }).toEqual({ language, ...DASHBOARD_WORDS[language] });
    },
  );

  test.each([
    ["da", "Custom Probes", "Brugerdefinerede sonder"],
    ["da", "Global Probes", "Globale sonder"],
    ["da", "Probe Key", "Sondenøgle"],
    ["da", "No probes found.", "Ingen sonder fundet."],
    ["nl", "Custom Probes", "Aangepaste sondes"],
    ["nl", "Probe Key", "Sondesleutel"],
    ["zh-CN", "Custom Probes", "自定义探测器"],
    ["zh-CN", "Global Probes", "全局探测器"],
    ["zh-CN", "Probe Key", "探测器密钥"],
    ["zh-TW", "Custom Probes", "自訂探測器"],
    ["zh-TW", "Global Probes", "全域探測器"],
    ["fa", "Probe default (usually 3)", "مقدار پیش‌فرض پراب (معمولاً ۳)"],
  ])(
    "%s: the Dashboard's %p reads %p",
    (language: string, key: string, worded: string) => {
      expect(readDashboardLocale(language)[key]).toBe(worded);
    },
  );

  test.each([
    ["da", "Custom Probes", "Brugerdefinerede sonder"],
    ["nl", "Custom Probes", "Aangepaste sondes"],
    ["zh-CN", "Custom Probes", "自定义探测器"],
    ["zh-TW", "Custom Probes", "自訂探測器"],
    ["da", "Probe Status Monitor", "Sondestatusmonitor"],
    ["zh-CN", "Probe Status Monitor", "探测器状态监控"],
  ])(
    "%s: the docs menu's %p reads %p, as the page's title does",
    (language: string, link: string, worded: string) => {
      const strings: Strings = stringsIn(
        LOCALE_DIRS["Docs navigation"]!,
        language,
      );

      expect(strings.get(`navLinks.${link}`)).toBe(worded);
    },
  );
});

describe.each(PROBE_LANGUAGES)("a probe in %s", (language: string) => {
  test.each(Object.keys(LOCALE_DIRS))(
    "no translated string of the %s says another word",
    (app: string) => {
      expect(localeSightings(app, language)).toEqual([]);
    },
  );

  test("no docs page says another word", () => {
    expect({
      language,
      // A page that names a probe is read beside its English page.
      unpaired: unpairedNamingAProbe(language),
      sightings: docsSightings(language),
    }).toEqual({ language, unpaired: [], sightings: [] });
  });

  /*
   * A translation may say "it" where the English repeats the noun, so a
   * few blocks name a probe without the word; a page that called probes
   * by a third word would sink this well below.
   */
  test("nearly every block whose English names a probe says the Dashboard's word", () => {
    const naming: Array<{ block: PairedBlock; words: string }> =
      blocksNamingAProbe(language);
    const word: RegExp = dashboardWordOf(language);
    const saying: number = naming.filter(
      (entry: { block: PairedBlock; words: string }): boolean => {
        return word.test(entry.words);
      },
    ).length;

    // The check reads the pages it is about (control).
    expect(naming.length).toBeGreaterThan(900);
    expect({ language, share: saying / naming.length >= 0.98 }).toEqual({
      language,
      share: true,
    });
  });

  test("every kept phrase still keeps something", () => {
    const texts: Array<string> = [
      ...pairedBlocksOf(language).paired.map((block: PairedBlock): string => {
        return wordsOf(ownWordsOf(block.english, block.translation));
      }),
      ...Object.values(LOCALE_DIRS).flatMap(
        (directory: string): Array<string> => {
          return translatedStrings(directory, language).map(
            (entry: TranslatedString): string => {
              return wordsOf(entry.text);
            },
          );
        },
      ),
    ];
    const words: ProbeWords = PROBE_WORDS[language]!;
    const stale: Array<string> = [
      ...words.keptPhrases,
      ...(words.explorer?.keptPhrases || []),
    ]
      .filter((kept: KeptPhrase): boolean => {
        return !texts.some((text: string): boolean => {
          return kept.phrase.test(text);
        });
      })
      .map((kept: KeptPhrase): string => {
        return kept.phrase.source;
      });

    expect(stale).toEqual([]);
  });
});

describe("Persian keeps کاوشگر for an explorer", () => {
  test("the Dashboard's explorers are کاوشگر", () => {
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(words["Metric Explorer"]).toMatch(/^کاوشگر /);
    expect(words["Trace Explorer"]).toMatch(/^کاوشگر /);
  });

  test("the docs say کاوشگر for dozens of explorers, and for nothing else (control)", () => {
    const explorerBlocks: Array<PairedBlock> = pairedBlocksOf(
      "fa",
    ).paired.filter((block: PairedBlock): boolean => {
      return PERSIAN_EXPLORER.test(
        ownWordsOf(block.english, block.translation),
      );
    });

    expect(explorerBlocks.length).toBeGreaterThan(50);
    expect(
      explorerBlocks.filter((block: PairedBlock): boolean => {
        return !SAYS_EXPLORER.test(block.english.text);
      }),
    ).toEqual([]);
  });
});

describe("the check of a text for another word (controls)", () => {
  test("finds the old words in prose", () => {
    expect(otherProbeWordIn("da", "", "Start en probe i dit netværk.")).toBe(
      "probe",
    );
    expect(otherProbeWordIn("da", "", "Proberne er forbundet.")).toBe("Probe");
    expect(otherProbeWordIn("da", "", "Se probestatusmonitoren.")).toBe(
      "probe",
    );
    expect(otherProbeWordIn("nl", "", "Kies een probe.")).toBe("probe");
    expect(otherProbeWordIn("nl", "", "Twee probes zijn verbonden.")).toBe(
      "probe",
    );
    expect(otherProbeWordIn("zh-CN", "", "选择一个探针。")).toBe("探针");
    expect(otherProbeWordIn("zh-CN", "", "只有探测点会发送它。")).toBe(
      "探测点",
    );
    expect(otherProbeWordIn("zh-TW", "", "選擇一個探針。")).toBe("探針");
    expect(otherProbeWordIn("fa", "", "یک پروب سراسری")).toBe("پروب");
    expect(otherProbeWordIn("fa", "", "فقط probe این را می‌فرستد.")).toBe(
      "probe",
    );
    expect(
      otherProbeWordIn("fa", "DNS names from the probe", "نام‌ها از کاوشگر"),
    ).toBe("کاوشگر");
  });

  test("passes the Dashboard's word", () => {
    expect(otherProbeWordIn("da", "", "Start en sonde; sonderne svarer.")).toBe(
      null,
    );
    expect(otherProbeWordIn("nl", "", "Kies een sonde of twee sondes.")).toBe(
      null,
    );
    expect(otherProbeWordIn("zh-CN", "", "选择一个探测器。")).toBeNull();
    expect(otherProbeWordIn("zh-TW", "", "選擇一個探測器。")).toBeNull();
    expect(otherProbeWordIn("fa", "", "یک پراب سراسری و پراب‌های خودتان")).toBe(
      null,
    );
  });

  test("code, a link's target and a placeholder are not words", () => {
    expect(
      otherProbeWordIn(
        "da",
        "",
        wordsOf(
          "Sæt `PROBE_KEY` på [sonden](/docs/probe/custom-probe) {{probeName}}.",
        ),
      ),
    ).toBeNull();
    expect(
      otherProbeWordIn(
        "fa",
        "",
        wordsOf("`oneuptime/probe` را روی پراب اجرا کنید"),
      ),
    ).toBeNull();
    // An environment variable and a JSON object's fields are names, not words.
    expect(
      otherProbeWordIn("nl", "", "Stel PROBE_KEY in en herstart de sonde."),
    ).toBeNull();
    expect(
      otherProbeWordIn(
        "da",
        "",
        "Array af {probeName, isConnected, lastAliveAt}.",
      ),
    ).toBeNull();
    expect(otherProbeWordIn("da", "", "Array af {probeName}, en probe.")).toBe(
      "probe",
    );
  });

  test("Dutch keeps its verb: proberen is to try", () => {
    expect(
      otherProbeWordIn("nl", "", "Probeer het opnieuw; ze proberen het."),
    ).toBeNull();
    expect(otherProbeWordIn("nl", "", "Het is geprobeerd.")).toBeNull();
  });

  test("a probe that is not OneUptime's keeps its word", () => {
    expect(
      otherProbeWordIn("da", "", "Collectoren har ingen opstartsprobe."),
    ).toBeNull();
    expect(
      otherProbeWordIn("zh-CN", "", "等待它的启动探针通过后再启动应用"),
    ).toBeNull();
    expect(
      otherProbeWordIn("fa", "", "منتظر پروب راه‌اندازی آن بماند"),
    ).toBeNull();
    expect(
      otherProbeWordIn(
        "fa",
        "Health probes {{percent}} up",
        "کاوشگرهای سلامت {{percent}} فعال",
      ),
    ).toBeNull();
    // A kept phrase keeps only itself.
    expect(
      otherProbeWordIn(
        "da",
        "",
        "Collectoren har ingen opstartsprobe; en probe.",
      ),
    ).toBe("probe");
  });

  test("Persian keeps کاوشگر where the English says explorer", () => {
    expect(
      otherProbeWordIn(
        "fa",
        "Open the logs explorer.",
        "کاوشگر لاگ را باز کنید.",
      ),
    ).toBeNull();
    expect(
      otherProbeWordIn("fa", "Open a probe.", "کاوشگر لاگ را باز کنید."),
    ).toBe("کاوشگر");
  });
});

describe("the words a translated block says itself (controls)", () => {
  test("an English copy, a cell, a bold label and a quote it has word for word are left out", () => {
    expect(
      ownWordsOf(
        block("| Probe | It runs each check. |"),
        block("| Probe | It runs each check. |"),
      ),
    ).toBe("");
    expect(
      ownWordsOf(
        block("| Check if a probe is disconnected | Marks it offline. |"),
        block("| Check if a probe is disconnected | Sætter den offline. |"),
      ),
    ).not.toMatch(/probe/);
    expect(
      ownWordsOf(
        block("Use **Switch to Probe Polling** to ping it."),
        block("Brug **Switch to Probe Polling** til at pinge den."),
      ),
    ).not.toMatch(/Probe/);
    expect(
      ownWordsOf(
        block('It fails with "This probe could not resolve" for the host.'),
        block('Det fejler med "This probe could not resolve" for værten.'),
      ),
    ).not.toMatch(/probe/);
    expect(
      ownWordsOf(
        block('JSON "Probe environment" is logged.'),
        block("JSON ‏«Probe environment» ثبت می‌شود."),
      ),
    ).not.toMatch(/Probe/);
  });

  test("a bold lead and a quote in the reader's language are read", () => {
    expect(
      ownWordsOf(
        block("- A **probe** that can reach the endpoints."),
        block("- En **probe**, der kan nå endpoints."),
      ),
    ).toMatch(/En probe/);
    expect(
      ownWordsOf(block('The "Your probe" box.'), block('Boksen "Din probe".')),
    ).toMatch(/Din probe/);
  });

  test("a diagram line says its labels, not its node ids", () => {
    expect(
      ownWordsOf(
        block(
          '    Probe["Probe on the<br/>network"] -->|"checks"| Device',
          true,
        ),
        block(
          '    Probe["Sonde på<br/>netværket"] -->|"tjekker"| Device',
          true,
        ),
      ),
    ).not.toMatch(/Probe/);
    // A label left in English is read: the reader sees it in the diagram.
    expect(
      ownWordsOf(
        block('    Probe["Probes"] -->|"fetch work"| App', true),
        block('    Probe["Probes"] -->|"hente arbejde"| App', true),
      ),
    ).toMatch(/Probes/);
    expect(diagramWordsOf("    O->>S: TLS, port 6697")).toBe(" TLS, port 6697");
    expect(diagramWordsOf("    participant P as Your probe")).toBe(
      "Your probe",
    );
  });

  test("reads a real page's blocks in pairs", () => {
    expect(
      blocksOf("Para.\n\n```mermaid\nA --> B\n```\n").map(
        (entry: DocsBlock): [string, boolean, boolean] => {
          return [entry.text, entry.code, entry.diagram];
        },
      ),
    ).toEqual([
      ["Para.", false, false],
      ["```mermaid", true, false],
      ["A --> B", false, true],
      ["```", true, false],
    ]);
  });
});
