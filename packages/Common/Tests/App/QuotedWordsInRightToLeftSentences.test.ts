import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import { BidiClass, getBidiClass } from "../Helpers/BidiLayout";

/*
 * A WORD QUOTED IN AN ARABIC OR PERSIAN SENTENCE IS THE WORD THE PAGE SHOWS.
 *
 * A help text names the page's own labels and states: "Use 'Client
 * Credentials'", "Powered off when ...". English quotes the English word.
 * Arabic and Persian quote the word their page draws - «بيانات اعتماد
 * العميل» - never the English one, which no one reading the page in Arabic
 * or Persian finds on it. What the page does show in Latin letters stays
 * so, isolated as code is: a vendor's own label, a value as a log or a tool
 * writes it, a name a person gives something (#6659, Locales/ARABIC.md).
 *
 * The guard reads every sentence of every frontend's locale file in a
 * language read from the right, takes each phrase quoted in Latin letters
 * and fails when the same app translates that phrase into the language.
 * A phrase matches the app's English as written or, when it has a capital
 * letter, in any letter case: a help text writes a label in Title Case as
 * often as the page writes it in sentence case. A lowercase phrase matches
 * only as written - "home" typed to a Teams bot is a command, not the
 * page's Home. Each phrase the page does show as written is listed below,
 * with the reason.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const FRONTEND_LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
};

type LocaleTree = { [key: string]: string | LocaleTree };

// Every leaf of a locale file, by its path of keys.
const leavesOf: (tree: LocaleTree, prefix?: string) => Map<string, string> = (
  tree: LocaleTree,
  prefix: string = "",
): Map<string, string> => {
  const found: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix} > ${key}` : key;

    if (typeof value === "string") {
      found.set(at, value);
    } else {
      for (const [inner, text] of leavesOf(value, at)) {
        found.set(inner, text);
      }
    }
  }

  return found;
};

const readLocale: (app: string, language: string) => Map<string, string> = (
  app: string,
  language: string,
): Map<string, string> => {
  return leavesOf(
    JSON.parse(
      fs.readFileSync(
        path.join(
          PACKAGES,
          FRONTEND_LOCALE_DIRS[app] as string,
          `${language}.json`,
        ),
        "utf8",
      ),
    ) as LocaleTree,
  );
};

const LETTER: RegExp = /\p{L}/u;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const CAPITAL_LETTER: RegExp = /[A-Z]/;

// A letter of a script read from the right: Arabic, Persian, Hebrew, ...
const isRightToLeftLetter: (character: string) => boolean = (
  character: string,
): boolean => {
  const bidiClass: BidiClass = getBidiClass(character);

  return (bidiClass === "R" || bidiClass === "AL") && LETTER.test(character);
};

const hasRightToLeftLetter: (text: string) => boolean = (
  text: string,
): boolean => {
  for (const character of text) {
    if (isRightToLeftLetter(character)) {
      return true;
    }
  }

  return false;
};

/*
 * A phrase in quotes: «», “”, ‘’, "" or ''. A straight single quote opens
 * and closes only beside no Latin letter, so an apostrophe (Let's) is
 * none.
 */
const QUOTED: RegExp =
  /«([^«»\n]{1,120})»|“([^“”\n]{1,120})”|‘([^‘’\n]{1,120})’|"([^"\n]{1,120})"|(?<![A-Za-z])'([^'\n]{1,120})'(?![A-Za-z])/gu;

// The words an app's page shows in one language, by their English.
interface PageWords {
  // Each English text the page shows in the language, with its words there.
  translated: Map<string, string>;
  // The same, by the English text in lower case.
  translatedInAnyCase: Map<string, string>;
  // Every English text the app has.
  english: Set<string>;
}

const getPageWords: (
  english: Map<string, string>,
  translation: Map<string, string>,
) => PageWords = (
  english: Map<string, string>,
  translation: Map<string, string>,
): PageWords => {
  const words: PageWords = {
    translated: new Map<string, string>(),
    translatedInAnyCase: new Map<string, string>(),
    english: new Set<string>(english.values()),
  };

  for (const [key, text] of english) {
    const translated: string | undefined = translation.get(key);

    if (
      translated === undefined ||
      translated === text ||
      !hasRightToLeftLetter(translated)
    ) {
      continue;
    }

    if (!words.translated.has(text)) {
      words.translated.set(text, translated);
    }

    if (!words.translatedInAnyCase.has(text.toLowerCase())) {
      words.translatedInAnyCase.set(text.toLowerCase(), translated);
    }
  }

  return words;
};

// What the page shows for a phrase quoted in Latin letters, if it translates it.
const getPageWord: (phrase: string, words: PageWords) => string | null = (
  phrase: string,
  words: PageWords,
): string | null => {
  const translated: string | undefined = words.translated.get(phrase);

  if (translated !== undefined) {
    return translated;
  }

  // The page shows the phrase as written: "OK" stays OK, whatever "Ok" is.
  if (words.english.has(phrase) || !CAPITAL_LETTER.test(phrase)) {
    return null;
  }

  return words.translatedInAnyCase.get(phrase.toLowerCase()) ?? null;
};

interface QuotedPageWord {
  // The phrase as the sentence quotes it.
  phrase: string;
  // What the page shows for it.
  pageWord: string;
}

/*
 * The phrases a sentence in the language quotes in Latin letters that the
 * page shows translated. A sentence still in English is not looked at:
 * English quotes English.
 */
const findQuotedPageWords: (
  text: string,
  words: PageWords,
) => Array<QuotedPageWord> = (
  text: string,
  words: PageWords,
): Array<QuotedPageWord> => {
  if (!hasRightToLeftLetter(text)) {
    return [];
  }

  const found: Array<QuotedPageWord> = [];

  for (const match of text.matchAll(QUOTED)) {
    const phrase: string = (
      match.slice(1).find((group: string | undefined): boolean => {
        return group !== undefined;
      }) as string
    ).trim();

    if (
      phrase.includes("{{") ||
      !LATIN_LETTER.test(phrase) ||
      hasRightToLeftLetter(phrase)
    ) {
      continue;
    }

    const pageWord: string | null = getPageWord(phrase, words);

    if (pageWord !== null) {
      found.push({ phrase, pageWord });
    }
  }

  return found;
};

// A phrase a translation quotes in Latin letters, and why the page shows it so.
interface ShownAsWritten {
  // A piece of the English text whose translations quote the words.
  english: string;
  // The words, as the translations quote them.
  words: Array<string>;
  // The languages the reason holds for: every one, when left out.
  languages?: Array<string>;
  reason: string;
}

const SHOWN_AS_WRITTEN: Array<ShownAsWritten> = [
  {
    english: "Fires the database on-call rotation whenever an",
    words: ["database"],
    reason: "A label's name, which the page shows as a person wrote it.",
  },
  {
    english: "Reads a raw value (e.g. 'warn') from a log attribute",
    words: ["warn"],
    reason: "A severity as a log writes it, before it is mapped.",
  },
  {
    english: 'Value to match (e.g. "warn", "err")',
    words: ["warn"],
    reason: "A severity as a log writes it, typed to match it.",
  },
  {
    english: 'The field to match on. Use "name" for the span name itself',
    words: ["name"],
    reason: "A span field, typed as it is.",
  },
  {
    english: "attributes object that contains the raw severity value",
    words: ["level"],
    reason: "The attribute key logging libraries write, typed as it is.",
  },
  {
    english: "Only watch one component group, e.g. 'APIs'.",
    words: ["APIs"],
    reason:
      "A component group on another service's status page, named as that page names it.",
  },
  {
    english: "Proxmox high-availability (HA) state",
    words: ["error"],
    reason:
      "A Proxmox HA state, which the page shows as Proxmox reports it (HA {{state}}).",
  },
  {
    english: "This guest's state in Proxmox high availability (HA)",
    words: ["error"],
    reason:
      "A Proxmox HA state, which the page shows as Proxmox reports it (HA {{state}}).",
  },
  {
    english: "agent's docs have the command, under AI agent.",
    words: ["AI agent"],
    languages: ["ar"],
    reason:
      "A heading of the docs, which have no Arabic pages: an Arabic reader finds it in English. Persian has docs of its own and quotes their heading.",
  },
  {
    english: 'Letter by letter, and capital letters count: "Error" is not',
    words: ["Error", "error"],
    reason: "Two values compared letter by letter, as they are typed.",
  },
  {
    english: 'Write the body as a JSON object, such as {"host"',
    words: ["host"],
    reason: "A key of a JSON body, typed as it is.",
  },
  {
    english: 'narrow the collector\'s "process" scraper',
    words: ["process"],
    reason: "The collector's scraper, by the name its configuration gives it.",
  },
  {
    english: 'traceContextInjection: "all"',
    words: ["all"],
    reason: "A value of another vendor's setting, as its code writes it.",
  },
  {
    english: "In Huntress, open Integrations, choose Add an Integration",
    words: ["Integrations", "Webhooks", "Incident Reports"],
    reason: "Huntress's own labels: Huntress shows them in English.",
  },
  {
    english: "Huntress, choose Send Test on the endpoint.",
    words: ["Send Test"],
    reason: "Huntress's own button: Huntress shows it in English.",
  },
  {
    english: "the Read-Only role on the top-level vCenter object",
    words: ["Read-Only"],
    reason: "vSphere's role, by the name vCenter gives it.",
  },
  {
    english: "What the priority is called, like High or P1.",
    words: ["High"],
    reason:
      "An example of a name a person gives a priority: the page shows names as they are written.",
  },
  {
    english: "Guest Down",
    words: ["Guest Down"],
    reason:
      "A Proxmox alert template, which the template picker names as the template does.",
  },
  {
    english: "SNMP Table Value on the Wi-Fi Radios table (for example TX Power",
    words: ["Wi-Fi Radios", "TX Power", "Clients"],
    reason:
      "A vendor template's table and columns, which the criterion's pickers name as the template does.",
  },
];

interface Sentence {
  app: string;
  language: string;
  key: string;
  english: string;
  text: string;
}

interface Finding {
  sentence: Sentence;
  quoted: QuotedPageWord;
}

interface LanguageOfApp {
  app: string;
  language: string;
  words: PageWords;
  sentences: Array<Sentence>;
}

// Every frontend's locale file in a language read from the right.
const LANGUAGES_OF_APPS: Array<LanguageOfApp> = Object.entries(
  FRONTEND_LOCALE_DIRS,
).flatMap(([app, directory]: [string, string]): Array<LanguageOfApp> => {
  const english: Map<string, string> = readLocale(app, "en");

  return fs
    .readdirSync(path.join(PACKAGES, directory))
    .filter((file: string): boolean => {
      return (
        file.endsWith(".json") &&
        isRightToLeftLanguage(file.slice(0, -".json".length))
      );
    })
    .map((file: string): LanguageOfApp => {
      const language: string = file.slice(0, -".json".length);
      const translation: Map<string, string> = readLocale(app, language);
      const sentences: Array<Sentence> = [];

      for (const [key, text] of translation) {
        sentences.push({
          app,
          language,
          key,
          english: english.get(key) ?? key,
          text,
        });
      }

      return {
        app,
        language,
        words: getPageWords(english, translation),
        sentences,
      };
    });
});

const FINDINGS: Array<Finding> = LANGUAGES_OF_APPS.flatMap(
  (languageOfApp: LanguageOfApp): Array<Finding> => {
    return languageOfApp.sentences.flatMap(
      (sentence: Sentence): Array<Finding> => {
        return findQuotedPageWords(sentence.text, languageOfApp.words).map(
          (quoted: QuotedPageWord): Finding => {
            return { sentence, quoted };
          },
        );
      },
    );
  },
);

const isShownAsWritten: (entry: ShownAsWritten, finding: Finding) => boolean = (
  entry: ShownAsWritten,
  finding: Finding,
): boolean => {
  return (
    finding.sentence.english.includes(entry.english) &&
    entry.words.includes(finding.quoted.phrase) &&
    (entry.languages === undefined ||
      entry.languages.includes(finding.sentence.language))
  );
};

const describeFinding: (finding: Finding) => string = (
  finding: Finding,
): string => {
  return `${finding.sentence.app} ${finding.sentence.language} "${finding.sentence.key}": quotes "${finding.quoted.phrase}", which the page shows as «${finding.quoted.pageWord}»`;
};

describe("a phrase quoted in Latin letters in a sentence read from the right", () => {
  test("there are such sentences, quoting hundreds of phrases", () => {
    const languages: Set<string> = new Set<string>(
      LANGUAGES_OF_APPS.map((languageOfApp: LanguageOfApp): string => {
        return languageOfApp.language;
      }),
    );
    let phrases: number = 0;

    for (const languageOfApp of LANGUAGES_OF_APPS) {
      for (const sentence of languageOfApp.sentences) {
        if (!hasRightToLeftLetter(sentence.text)) {
          continue;
        }

        for (const match of sentence.text.matchAll(QUOTED)) {
          if (LATIN_LETTER.test(match[0]) && !hasRightToLeftLetter(match[0])) {
            phrases += 1;
          }
        }
      }
    }

    expect([...languages]).toEqual(expect.arrayContaining(["ar", "fa"]));
    expect(phrases).toBeGreaterThan(250);
  });

  test("is one the page shows in Latin letters, or a reason here says why it stays", () => {
    const wrong: Array<string> = FINDINGS.filter(
      (finding: Finding): boolean => {
        return !SHOWN_AS_WRITTEN.some((entry: ShownAsWritten): boolean => {
          return isShownAsWritten(entry, finding);
        });
      },
    ).map(describeFinding);

    expect(wrong).toEqual([]);
  });

  test("each reason is still needed: its words are still quoted where it says", () => {
    const unused: Array<string> = [];

    for (const entry of SHOWN_AS_WRITTEN) {
      for (const word of entry.words) {
        const used: boolean = FINDINGS.some((finding: Finding): boolean => {
          return (
            finding.quoted.phrase === word && isShownAsWritten(entry, finding)
          );
        });

        if (!used) {
          unused.push(`${word} in "${entry.english}"`);
        }
      }
    }

    expect(unused).toEqual([]);
  });

  /*
   * Arabic quotes the docs' English heading only while the docs have no
   * Arabic pages: when they do, Arabic quotes the Arabic heading.
   */
  test("the docs have Persian pages and no Arabic ones, as the AI agent reason says", () => {
    const docs: string = path.join(PACKAGES, "App/FeatureSet/Docs/Content");

    expect(fs.existsSync(path.join(docs, "fa"))).toBe(true);
    expect(fs.existsSync(path.join(docs, "ar"))).toBe(false);
  });
});

/*
 * The negative control. Every word a sentence quotes as its page shows it
 * in Arabic or Persian - «متوقف عن التشغيل» - is quoted back in its
 * English - «Powered off» - and the guard must see each one.
 */
describe("the guard sees an English word the page shows translated", () => {
  interface Swap {
    languageOfApp: LanguageOfApp;
    text: string;
    english: string;
  }

  const swaps: Array<Swap> = [];
  // A quotation mark, a placeholder's brace or a line break: no word to swap in.
  const QUOTE_OR_BREAK: RegExp = /[«»"'“”‘’{}\n]/u;

  for (const languageOfApp of LANGUAGES_OF_APPS) {
    const englishOf: Map<string, string> = new Map<string, string>();

    for (const [english, translated] of languageOfApp.words.translated) {
      if (
        !englishOf.has(translated) &&
        LATIN_LETTER.test(english) &&
        !QUOTE_OR_BREAK.test(english) &&
        english.length <= 120
      ) {
        englishOf.set(translated, english);
      }
    }

    for (const sentence of languageOfApp.sentences) {
      for (const match of sentence.text.matchAll(/«([^«»\n]{1,120})»/gu)) {
        const english: string | undefined = englishOf.get(match[1] as string);

        if (english === undefined) {
          continue;
        }

        swaps.push({
          languageOfApp,
          text: sentence.text.replace(match[0], (): string => {
            return `«${english}»`;
          }),
          english,
        });
      }
    }
  }

  test("quoted back as written, in every sentence that quotes the page's word", () => {
    const missed: Array<string> = swaps
      .filter((swap: Swap): boolean => {
        return !findQuotedPageWords(swap.text, swap.languageOfApp.words).some(
          (quoted: QuotedPageWord): boolean => {
            return quoted.phrase === swap.english;
          },
        );
      })
      .map((swap: Swap): string => {
        return `${swap.languageOfApp.language}: ${swap.english}`;
      });

    expect(missed).toEqual([]);
    expect(swaps.length).toBeGreaterThan(1000);
  });

  test("quoted back in Title Case, as a help text may write a label", () => {
    let titled: number = 0;
    const missed: Array<string> = [];

    for (const swap of swaps) {
      const titleCase: string = swap.english.replace(
        /\b[a-z]/g,
        (letter: string): string => {
          return letter.toUpperCase();
        },
      );

      if (
        titleCase === swap.english ||
        swap.languageOfApp.words.english.has(titleCase)
      ) {
        continue;
      }

      titled += 1;

      const found: Array<QuotedPageWord> = findQuotedPageWords(
        swap.text.replace(`«${swap.english}»`, (): string => {
          return `«${titleCase}»`;
        }),
        swap.languageOfApp.words,
      );

      if (
        !found.some((quoted: QuotedPageWord): boolean => {
          return quoted.phrase === titleCase;
        })
      ) {
        missed.push(`${swap.languageOfApp.language}: ${titleCase}`);
      }
    }

    expect(missed).toEqual([]);
    expect(titled).toBeGreaterThan(100);
  });
});

/*
 * The sentences #6659 found quoting the English of a word the page shows
 * in Arabic or Persian: each quotes the page's word now, and quoted back
 * in English it is what the guard reports.
 */
describe("the sentences #6659 put right", () => {
  interface PutRight {
    language: string;
    english: string;
    quoted: string;
  }

  const PUT_RIGHT: Array<PutRight> = [
    {
      language: "ar",
      english: "Select the OAuth grant type. Use 'Client Credentials'",
      quoted: "Client Credentials",
    },
    {
      language: "ar",
      english: "Whether this VM is on, inferred from whether it sent CPU data",
      quoted: "Powered off",
    },
    {
      language: "ar",
      english: "The drive's latest status: Healthy and Empty are fine",
      quoted: "Missing",
    },
    {
      language: "ar",
      english: "Connected while vCenter reports the host's CPU and memory",
      quoted: "In standby",
    },
    {
      language: "fa",
      english: "Always uploads every sampled session.",
      quoted: "On error or frustration",
    },
    {
      language: "fa",
      english: "SMS is off in this project. A project owner, a Billing Admin",
      quoted: "Billing Admin",
    },
    {
      language: "fa",
      english: "Require Explicit uploads nothing until your page calls",
      quoted: "Require Explicit",
    },
    {
      language: "fa",
      english: "Its run is under the case's Playbooks.",
      quoted: "Playbooks",
    },
  ];

  const dashboard: Map<string, LanguageOfApp> = new Map<string, LanguageOfApp>(
    LANGUAGES_OF_APPS.filter((languageOfApp: LanguageOfApp): boolean => {
      return languageOfApp.app === "Dashboard";
    }).map((languageOfApp: LanguageOfApp): [string, LanguageOfApp] => {
      return [languageOfApp.language, languageOfApp];
    }),
  );

  test.each(PUT_RIGHT)(
    "$language quotes the page's word for $quoted",
    (putRight: PutRight) => {
      const languageOfApp: LanguageOfApp = dashboard.get(
        putRight.language,
      ) as LanguageOfApp;
      const sentence: Sentence = languageOfApp.sentences.find(
        (candidate: Sentence): boolean => {
          return candidate.english.includes(putRight.english);
        },
      ) as Sentence;
      const pageWord: string = getPageWord(
        putRight.quoted,
        languageOfApp.words,
      ) as string;

      expect(pageWord).toEqual(expect.any(String));
      expect(sentence.text).toContain(`«${pageWord}»`);
      expect(sentence.text).not.toContain(putRight.quoted);
      expect(
        findQuotedPageWords(
          sentence.text.replace(`«${pageWord}»`, (): string => {
            return `«${putRight.quoted}»`;
          }),
          languageOfApp.words,
        ),
      ).toContainEqual({ phrase: putRight.quoted, pageWord });
    },
  );

  /*
   * Manage Billing is a permission, which the Dashboard names by its title
   * (Common/Types/Permission.ts) and translates only when the title is one
   * of its texts - this one is not, so the page shows it in English, and
   * every sentence naming it in Arabic or Persian names it so. When the
   * page translates it, the guard above holds the quote to its word.
   */
  test("Manage Billing, a permission the page shows in English, is named in English", () => {
    const named: Array<string> = [];
    const translatedAway: Array<string> = [];

    for (const languageOfApp of dashboard.values()) {
      if (languageOfApp.words.english.has("Manage Billing")) {
        continue;
      }

      for (const sentence of languageOfApp.sentences) {
        if (!sentence.english.includes("someone with Manage Billing")) {
          continue;
        }

        named.push(sentence.key);

        if (!sentence.text.includes("Manage Billing")) {
          translatedAway.push(
            `${languageOfApp.language} "${sentence.key}": ${sentence.text}`,
          );
        }
      }
    }

    expect(translatedAway).toEqual([]);
    expect(named.length).toBeGreaterThan(20);
  });
});

describe("what the guard counts as quoting the page's word", () => {
  const words: PageWords = getPageWords(
    new Map<string, string>([
      ["Home", "Home"],
      ["Powered off", "Powered off"],
      ["OK", "OK"],
      ["Ok", "Ok"],
      ["Status", "Status"],
    ]),
    new Map<string, string>([
      ["Home", "الرئيسية"],
      ["Powered off", "متوقف عن التشغيل"],
      ["OK", "OK"],
      ["Ok", "حسنًا"],
      ["Status", "Status"],
    ]),
  );

  test("a phrase the page translates, quoted as written, in any kind of quotes", () => {
    for (const quoted of [
      "«Powered off»",
      "“Powered off”",
      "‘Powered off’",
      '"Powered off"',
      "'Powered off'",
    ]) {
      expect(findQuotedPageWords(`الحالة ${quoted} هنا`, words)).toEqual([
        { phrase: "Powered off", pageWord: "متوقف عن التشغيل" },
      ]);
    }
  });

  test("a label with a capital letter, in any letter case", () => {
    expect(findQuotedPageWords("الحالة «Powered Off» هنا", words)).toEqual([
      { phrase: "Powered Off", pageWord: "متوقف عن التشغيل" },
    ]);
    expect(findQuotedPageWords("افتح «HOME»", words)).toEqual([
      { phrase: "HOME", pageWord: "الرئيسية" },
    ]);
  });

  test("a lowercase phrase only as written: a command or a value is no label", () => {
    expect(findQuotedPageWords("اكتب «home» في Teams", words)).toEqual([]);
    expect(findQuotedPageWords("الحالة «powered off»", words)).toEqual([]);
  });

  test("not a phrase the page shows as written, though another case of it is translated", () => {
    expect(findQuotedPageWords("اضغط «OK»", words)).toEqual([]);
    expect(findQuotedPageWords("العمود «Status»", words)).toEqual([]);
  });

  test("not the page's own word, a placeholder, or an English sentence", () => {
    expect(findQuotedPageWords("الحالة «متوقف عن التشغيل»", words)).toEqual([]);
    expect(findQuotedPageWords("الحالة «{{state}}»", words)).toEqual([]);
    expect(findQuotedPageWords("Choose 'Powered off'.", words)).toEqual([]);
  });

  test("an apostrophe inside a word opens and closes no quote", () => {
    expect(findQuotedPageWords("متجر O'Home's للأجهزة", words)).toEqual([]);
    expect(findQuotedPageWords("شهادة Let's Encrypt و'Home'", words)).toEqual([
      { phrase: "Home", pageWord: "الرئيسية" },
    ]);
  });
});
