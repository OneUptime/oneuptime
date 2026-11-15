import {
  DOCS_SEARCH_ASKING_WORDS,
  DOCS_SEARCH_COMPOUNDING_LANGUAGES,
  DOCS_SEARCH_QUESTION_WORDS,
  DOCS_SEARCH_SYNONYMS,
  DOCS_SEARCH_WORD_ENDINGS,
  DocsSearchSynonym,
  DocsVocabulary,
  DocsVocabularyMatch,
  DocsWordEndings,
  ENGLISH_ENDINGS,
  foldDocsSearchWord,
  getDocsSearchAskingWords,
  getDocsSearchQuestionPhrases,
  getDocsSearchQuestionWords,
  getDocsSearchSynonyms,
  getDocsWordEndings,
  getTypoAllowance,
  isDocsSearchAskingWord,
  isWithinEditDistance,
} from "../../../FeatureSet/Docs/Utils/DocsSearchWords";
import { tokenizeForDocs } from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";

/*
 * The words docs search forgives (issue #6822): a reader's other word for
 * a docs word, one or two wrong letters, and a word half typed. The docs'
 * search box, Search (Cmd/Ctrl+K)'s Docs group and Ask AI all read these.
 */

const terms: (matches: Array<DocsVocabularyMatch>) => Array<string> = (
  matches: Array<DocsVocabularyMatch>,
): Array<string> => {
  return matches.map((match: DocsVocabularyMatch): string => {
    return match.term;
  });
};

describe("foldDocsSearchWord", () => {
  it("lowers a word, and takes the accents off a Latin-script one", () => {
    expect(foldDocsSearchWord("Caída")).toBe("caida");
    expect(foldDocsSearchWord("  Störung ")).toBe("storung");
    expect(foldDocsSearchWord("ON-CALL")).toBe("on-call");
  });

  it("keeps the marks of other scripts: they are part of their letters", () => {
    expect(foldDocsSearchWord("ऑन-कॉल")).toBe("ऑन-कॉल");
    expect(foldDocsSearchWord("ДЕЖУРСТВО")).toBe("дежурство");
    expect(foldDocsSearchWord("ステータス")).toBe("ステータス");
  });
});

/*
 * The endings a word is compared without, per language (#7875): a page's
 * word and a question's alike.
 */
describe("the word endings", () => {
  it("are listed by docs language, each ending once", () => {
    for (const [language, forms] of Object.entries(DOCS_SEARCH_WORD_ENDINGS)) {
      expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(language);
      expect(forms.endings.length).toBeGreaterThan(0);
      expect(new Set<string>(forms.endings).size).toBe(forms.endings.length);
      expect(forms.shortestStem).toBeGreaterThanOrEqual(2);
    }
  });

  it("are every spaced language's, and English's for English and German", () => {
    expect(Object.keys(DOCS_SEARCH_WORD_ENDINGS).sort()).toEqual(
      SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
        // Written without spaces: no endings to take off.
        return !["ja", "zh-CN", "zh-TW"].includes(language);
      }).sort(),
    );
    expect(DOCS_SEARCH_WORD_ENDINGS["en"]).toBe(ENGLISH_ENDINGS);
    expect(DOCS_SEARCH_WORD_ENDINGS["de"]).toBe(ENGLISH_ENDINGS);
    expect(ENGLISH_ENDINGS.endings).toEqual([
      "ing",
      "ers",
      "ed",
      "es",
      "en",
      "er",
      "s",
      "e",
    ]);
  });

  it("are a language's own for a word of its script, English's for a Latin-script word, and none otherwise", () => {
    const russian: DocsWordEndings = DOCS_SEARCH_WORD_ENDINGS["ru"]!;

    expect(getDocsWordEndings("сайта", "ru")).toBe(russian);
    expect(getDocsWordEndings("monitors", "ru")).toBe(ENGLISH_ENDINGS);
    expect(getDocsWordEndings("monitors", "sv")).toBe(
      DOCS_SEARCH_WORD_ENDINGS["sv"],
    );
    expect(getDocsWordEndings("сайта", "en")).toBeNull();
    expect(getDocsWordEndings("監視", "ja")).toBeNull();
    expect(getDocsWordEndings("monitors", "ja")).toBe(ENGLISH_ENDINGS);
    expect(getDocsWordEndings("monitors", undefined)).toBe(ENGLISH_ENDINGS);
    expect(getDocsWordEndings("monitors", "constructor")).toBe(ENGLISH_ENDINGS);
  });

  it("join words into the compounds of the languages that write them, not German's", () => {
    for (const language of DOCS_SEARCH_COMPOUNDING_LANGUAGES) {
      expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(language);
    }
    // German's results are as they were (#7875).
    expect(DOCS_SEARCH_COMPOUNDING_LANGUAGES.has("de")).toBe(false);
  });
});

describe("getTypoAllowance", () => {
  it("forgives nothing in a word of three letters or fewer", () => {
    expect(getTypoAllowance("sms")).toBe(0);
    expect(getTypoAllowance("api")).toBe(0);
    expect(getTypoAllowance("")).toBe(0);
  });

  it("forgives one letter up to seven, and two from eight", () => {
    expect(getTypoAllowance("page")).toBe(1);
    expect(getTypoAllowance("monitor")).toBe(1);
    expect(getTypoAllowance("escalaton")).toBe(2);
    expect(getTypoAllowance("notifcations")).toBe(2);
  });

  it("counts characters, not bytes", () => {
    // Four characters each, in Cyrillic and in Devanagari.
    expect(getTypoAllowance("сбой")).toBe(1);
    expect(getTypoAllowance("घटना")).toBe(1);
  });
});

describe("isWithinEditDistance", () => {
  it("is 0 for the same word", () => {
    expect(isWithinEditDistance("monitor", "monitor", 1)).toBe(0);
  });

  it("counts a letter added, dropped or changed as one", () => {
    expect(isWithinEditDistance("escalaton", "escalation", 2)).toBe(1);
    expect(isWithinEditDistance("monitorr", "monitor", 1)).toBe(1);
    expect(isWithinEditDistance("monitar", "monitor", 1)).toBe(1);
  });

  it("counts two neighbours swapped as one", () => {
    expect(isWithinEditDistance("moniotr", "monitor", 1)).toBe(1);
    expect(isWithinEditDistance("teh", "the", 1)).toBe(1);
  });

  it("is null when it takes more than it may", () => {
    expect(isWithinEditDistance("monitor", "mentors", 1)).toBeNull();
    expect(isWithinEditDistance("incident", "accident", 1)).toBeNull();
    expect(isWithinEditDistance("incident", "accident", 2)).toBe(2);
    expect(isWithinEditDistance("a", "abcd", 2)).toBeNull();
  });

  it("measures other scripts by their characters", () => {
    expect(isWithinEditDistance("инцидетн", "инцидент", 1)).toBe(1);
    expect(isWithinEditDistance("घटना", "घटनाएँ", 2)).toBe(2);
  });
});

describe("DocsVocabulary", () => {
  const vocabulary: DocsVocabulary = new DocsVocabulary(
    new Map<string, number>([
      ["kubernet", 60],
      ["kubectl", 8],
      ["kube", 10],
      ["escalation", 30],
      ["escalat", 12],
      ["monitor", 300],
      ["mentor", 1],
      ["notification", 90],
      ["notifications", 5],
    ]),
  );

  it("knows the words it holds, and on how many pages", () => {
    expect(vocabulary.has("monitor")).toBe(true);
    expect(vocabulary.has("monitors")).toBe(false);
    expect(vocabulary.pagesHolding("kubernet")).toBe(60);
    expect(vocabulary.pagesHolding("nothing")).toBe(0);
  });

  it("finds the words a start begins, most used first, and not the start itself", () => {
    expect(terms(vocabulary.startingWith("kube", 10))).toEqual([
      "kubernet",
      "kubectl",
    ]);
    expect(terms(vocabulary.startingWith("kube", 1))).toEqual(["kubernet"]);
    expect(terms(vocabulary.startingWith("zz", 10))).toEqual([]);
    expect(terms(vocabulary.startingWith("", 10))).toEqual([]);
  });

  it("finds the words a typo nearly spells, closest first, then most used", () => {
    expect(terms(vocabulary.near("escalaton", 2, 10))).toEqual([
      "escalation",
      "escalat",
    ]);
    expect(terms(vocabulary.near("notifcation", 2, 10))).toEqual([
      "notification",
      "notifications",
    ]);
    expect(
      vocabulary.near("escalaton", 2, 10).map((match: DocsVocabularyMatch) => {
        return match.distance;
      }),
    ).toEqual([1, 2]);
  });

  it("keeps a typo's first letter: 'nonitor' is not 'monitor'", () => {
    expect(terms(vocabulary.near("monitar", 1, 10))).toEqual(["monitor"]);
    expect(terms(vocabulary.near("nonitor", 1, 10))).toEqual([]);
  });

  it("forgives nothing when it may not, and keeps to the limit", () => {
    expect(vocabulary.near("monitar", 0, 10)).toEqual([]);
    expect(terms(vocabulary.near("notifcations", 2, 1))).toEqual([
      "notifications",
    ]);
  });
});

describe("the synonyms", () => {
  it("has a list for every docs language", () => {
    expect(Object.keys(DOCS_SEARCH_SYNONYMS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  it("gives every language the issue's four pairs: pager, uptime, outage and 2FA", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const synonyms: Map<
        string,
        Array<DocsSearchSynonym>
      > = getDocsSearchSynonyms(language);

      for (const word of ["pager", "uptime", "outage", "2fa"]) {
        expect({ language, word, has: synonyms.has(word) }).toEqual({
          language,
          word,
          has: true,
        });
      }
    }
  });

  it("reads English as English: pager is on-call, outage an incident, 2FA two-factor", () => {
    const english: Map<
      string,
      Array<DocsSearchSynonym>
    > = getDocsSearchSynonyms("en");

    expect(english.get("pager")).toEqual([
      { words: "on-call", isWordStart: false },
    ]);
    expect(english.get("outage")).toEqual([
      { words: "incident", isWordStart: false },
    ]);
    expect(english.get("2fa")).toEqual([
      { words: "two-factor", isWordStart: false },
      { words: "two factor", isWordStart: false },
    ]);
    expect(english.get("text")).toEqual([{ words: "sms", isWordStart: false }]);
  });

  it("lets a language's own list answer a word, and the English list the rest", () => {
    const german: Map<string, Array<DocsSearchSynonym>> = getDocsSearchSynonyms(
      "de",
    );

    // German's own "pager": a word start, Bereitschaft*.
    expect(german.get("pager")).toEqual([
      { words: "bereitschaft", isWordStart: true },
    ]);
    // Typed with or without its accent.
    expect(german.get("storung")).toEqual([
      { words: "vorfall", isWordStart: false },
    ]);
    // English's "k8s", which German's list does not answer.
    expect(german.get("k8s")).toEqual([
      { words: "kubernetes", isWordStart: false },
    ]);
  });

  it("reads a language the docs do not have as English", () => {
    expect(getDocsSearchSynonyms("xx").get("pager")).toEqual(
      getDocsSearchSynonyms("en").get("pager"),
    );
  });

  it("reads a Nordic reader's word for a website as the docs' (#7875)", () => {
    expect(getDocsSearchSynonyms("da").get("hjemmeside")).toEqual([
      { words: "websted", isWordStart: false },
    ]);
    expect(getDocsSearchSynonyms("no").get("hjemmeside")).toEqual([
      { words: "nettsted", isWordStart: false },
    ]);
    expect(getDocsSearchSynonyms("sv").get("hemsida")).toEqual([
      { words: "webbplats", isWordStart: false },
    ]);
  });
});

/*
 * The words a question is phrased with, which Ask AI's search and the
 * docs' search box both leave out of what is asked (#7799, #7874).
 */
describe("the question words", () => {
  it("are a language's own, folded as a typed word is compared", () => {
    const german: ReadonlySet<string> = getDocsSearchQuestionWords("de");

    for (const word of ["wie", "ich", "meine", "ein"]) {
      expect({ word, has: german.has(word) }).toEqual({ word, has: true });
    }
    // Listed as "für" and "können": typed with or without the accent.
    expect(german.has("fur")).toBe(true);
    expect(german.has(foldDocsSearchWord("Können"))).toBe(true);
  });

  it("are none in English, or a language the docs do not have", () => {
    // English's are left out of every page and every question, by the reader's tokenizer.
    expect(getDocsSearchQuestionWords("en").size).toBe(0);
    expect(getDocsSearchQuestionWords("xx").size).toBe(0);
    expect(getDocsSearchQuestionWords("constructor").size).toBe(0);
  });

  it("are listed for every docs language but English (#7875)", () => {
    expect(Object.keys(DOCS_SEARCH_QUESTION_WORDS).sort()).toEqual(
      SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
        return language !== "en";
      }).sort(),
    );
  });

  it.each([
    ["fr", ["comment", "je", "mon", "puis-je"]],
    ["es", ["como", "puedo", "mi"]],
    ["it", ["come", "posso", "mio"]],
    ["pt", ["como", "faco", "para", "meu"]],
    ["nl", ["hoe", "ik", "mijn"]],
    ["da", ["hvordan", "jeg", "mit", "min"]],
    ["no", ["hvordan", "jeg", "mitt"]],
    ["sv", ["hur", "jag", "min", "kan"]],
    ["ru", ["как", "мой", "моего", "свой"]],
    ["ko", ["어떻게", "내", "해야", "하나요"]],
    ["hi", ["मैं", "अपनी", "कैसे", "करूँ"]],
    ["fa", ["چطور", "را", "کنم"]],
    ["ja", ["どうすればいいですか", "するには", "を"]],
    ["zh-CN", ["如何", "我的"]],
    ["zh-TW", ["如何", "我的"]],
  ] as Array<[string, Array<string>]>)(
    "%s: the question's own words are %p",
    (language: string, words: Array<string>) => {
      const listed: ReadonlySet<string> = getDocsSearchQuestionWords(language);

      expect(
        words.filter((word: string): boolean => {
          return !listed.has(word);
        }),
      ).toEqual([]);
    },
  );

  it("never hold a word a page is named for", () => {
    // "Website", "monitor" and "site" are what is asked, in any language.
    for (const language of Object.keys(DOCS_SEARCH_QUESTION_WORDS)) {
      const listed: ReadonlySet<string> = getDocsSearchQuestionWords(language);

      for (const word of [
        "website",
        "monitor",
        "site",
        "web",
        "сайт",
        "监控",
      ]) {
        expect({ language, word, listed: listed.has(word) }).toEqual({
          language,
          word,
          listed: false,
        });
      }
    }
  });

  it("are cut out of Chinese and Japanese longest first, and are none for a spaced language", () => {
    const chinese: ReadonlyArray<string> =
      getDocsSearchQuestionPhrases("zh-CN");

    expect(chinese).toContain("如何");
    expect(chinese.indexOf("我们的")).toBeLessThan(chinese.indexOf("我"));
    expect(getDocsSearchQuestionPhrases("ja")[0]).toBe(
      "どうすればいいでしょうか",
    );
    expect(getDocsSearchQuestionPhrases("fr")).toEqual([]);
    expect(getDocsSearchQuestionPhrases("en")).toEqual([]);
  });

  it("are listed by docs language, and none is a word a synonym reads", () => {
    for (const [language, words] of Object.entries(
      DOCS_SEARCH_QUESTION_WORDS,
    )) {
      const synonyms: Map<
        string,
        Array<DocsSearchSynonym>
      > = getDocsSearchSynonyms(language);

      expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(language);
      // A question word is left out before its synonyms are read: they never would be.
      expect(
        words.filter((word: string): boolean => {
          return synonyms.has(foldDocsSearchWord(word));
        }),
      ).toEqual([]);
    }
  });
});

/*
 * The words that make what was typed a question, not keywords (#8334):
 * the docs search box lets a question's results miss a word or two (its
 * verb, mostly), never keywords'. Each is a question word of its
 * language, so it is never looked for itself.
 */
describe("the asking words", () => {
  it("are listed for every docs language, English too", () => {
    expect(Object.keys(DOCS_SEARCH_ASKING_WORDS).sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );

    for (const words of Object.values(DOCS_SEARCH_ASKING_WORDS)) {
      expect(words.length).toBeGreaterThan(0);
      expect(new Set<string>(words).size).toBe(words.length);
    }
  });

  it("are each a question word of their language, so a question never looks for one", () => {
    for (const [language, words] of Object.entries(DOCS_SEARCH_ASKING_WORDS)) {
      const questionWords: ReadonlySet<string> =
        getDocsSearchQuestionWords(language);

      expect({
        language,
        notLeftOut: words.filter((word: string): boolean => {
          // English's are left out by the reader's own list (QUESTION_WORDS).
          return language === "en"
            ? tokenizeForDocs(word, "en").length > 0
            : !questionWords.has(foldDocsSearchWord(word));
        }),
      }).toEqual({ language, notLeftOut: [] });
    }
  });

  it.each([
    ["en", ["how", "what", "my"]],
    ["de", ["wie", "ich", "meine"]],
    ["fr", ["comment", "je", "mon"]],
    ["es", ["como", "mi"]],
    ["it", ["come", "mio"]],
    ["pt", ["como", "meu"]],
    ["nl", ["hoe", "mijn"]],
    ["da", ["hvordan", "min"]],
    ["no", ["hvordan", "mitt"]],
    ["sv", ["hur", "min"]],
    ["ru", ["как", "мой", "свой"]],
    ["ja", ["どうすればいいですか", "どうやって"]],
    ["ko", ["어떻게", "내", "하나요"]],
    ["zh-CN", ["如何", "怎么"]],
    ["zh-TW", ["如何", "怎麼"]],
    ["hi", ["कैसे", "मैं"]],
    ["fa", ["چطور", "چگونه"]],
  ] as Array<[string, Array<string>]>)(
    "%s: hold its 'how' and its asker's 'my': %p",
    (language: string, words: Array<string>) => {
      const asking: ReadonlySet<string> = getDocsSearchAskingWords(language);

      expect(
        words.filter((word: string): boolean => {
          return !asking.has(word);
        }),
      ).toEqual([]);
    },
  );

  it.each([
    ["en", ["the", "a", "for", "to", "i", "and"]],
    ["de", ["der", "die", "das", "für", "und"]],
    ["fr", ["le", "la", "de", "pour"]],
    ["es", ["el", "la", "de", "para", "que", "qué"]],
    ["it", ["il", "di", "per", "che"]],
    ["pt", ["o", "de", "para", "que"]],
    ["ru", ["в", "на", "и", "что", "который"]],
    ["zh-CN", ["一个"]],
  ] as Array<[string, Array<string>]>)(
    "%s: never hold what keywords are written with: %p",
    (language: string, words: Array<string>) => {
      const asking: ReadonlySet<string> = getDocsSearchAskingWords(language);

      expect(
        words.filter((word: string): boolean => {
          return asking.has(foldDocsSearchWord(word));
        }),
      ).toEqual([]);
    },
  );

  it("never hold a word a page is named for", () => {
    for (const language of Object.keys(DOCS_SEARCH_ASKING_WORDS)) {
      const asking: ReadonlySet<string> = getDocsSearchAskingWords(language);

      for (const word of ["website", "monitor", "site", "сайт", "监控"]) {
        expect({ language, word, asking: asking.has(word) }).toEqual({
          language,
          word,
          asking: false,
        });
      }
    }
  });

  it("are read in what was typed: a whole word, or wherever it stands where words are not spaced", () => {
    expect(isDocsSearchAskingWord("Wie", "de")).toBe(true);
    expect(isDocsSearchAskingWord("Cómo", "es")).toBe(true);
    // Typed without its accent, as many do.
    expect(isDocsSearchAskingWord("como", "es")).toBe(true);
    expect(isDocsSearchAskingWord("如何监控我的网站", "zh-CN")).toBe(true);
    expect(
      isDocsSearchAskingWord(
        "ウェブサイトを監視するにはどうすればいいですか",
        "ja",
      ),
    ).toBe(true);
    // Part of a spaced word is not one: "comment" is, "commentaire" is not.
    expect(isDocsSearchAskingWord("comment", "fr")).toBe(true);
    expect(isDocsSearchAskingWord("commentaire", "fr")).toBe(false);
    expect(isDocsSearchAskingWord("监控网站", "zh-CN")).toBe(false);
    // Only the index's language's: German "wie" in English is a word.
    expect(isDocsSearchAskingWord("wie", "en")).toBe(false);
    expect(isDocsSearchAskingWord("how", "de")).toBe(false);
    // A language the docs do not have, or a key every object has, has none.
    expect(getDocsSearchAskingWords("xx").size).toBe(0);
    expect(getDocsSearchAskingWords("constructor").size).toBe(0);
  });
});
