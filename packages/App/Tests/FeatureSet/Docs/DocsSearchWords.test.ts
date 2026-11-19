import {
  DOCS_SEARCH_ASKING_WORDS,
  DOCS_SEARCH_COMPOUNDING_LANGUAGES,
  DOCS_SEARCH_QUESTION_WORDS,
  DOCS_SEARCH_SEPARABLE_PARTICLES,
  DOCS_SEARCH_SYNONYMS,
  DOCS_SEARCH_WORD_ENDINGS,
  DocsSearchSynonym,
  DocsVocabulary,
  DocsVocabularyMatch,
  DocsWordEndings,
  DocsWordForms,
  ENGLISH_ENDINGS,
  foldDocsSearchWord,
  getDocsSearchAskingWords,
  getDocsSearchQuestionPhrases,
  getDocsSearchQuestionWords,
  getDocsSearchSeparableParticles,
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

  it("are every spaced language's, English's for English, and English's and a verb's in -ieren for German", () => {
    expect(Object.keys(DOCS_SEARCH_WORD_ENDINGS).sort()).toEqual(
      SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
        // Written without spaces: no endings to take off.
        return !["ja", "zh-CN", "zh-TW"].includes(language);
      }).sort(),
    );
    expect(DOCS_SEARCH_WORD_ENDINGS["en"]).toBe(ENGLISH_ENDINGS);
    // German keeps every one of English's, as it had them (#7875), and adds a verb's in -ieren (#8775).
    expect(DOCS_SEARCH_WORD_ENDINGS["de"]!.endings).toEqual(
      expect.arrayContaining([
        ...ENGLISH_ENDINGS.endings,
        "ieren",
        "ation",
        "ierung",
      ]),
    );
    expect(
      DOCS_SEARCH_WORD_ENDINGS["de"]!.compoundJoint!.exec("eskalationsregeln"),
    ).toEqual(expect.arrayContaining(["eskalation", "regeln"]));
    // Only at the "s" after -ung, -tion, -heit, -keit, -schaft or -ität, with a word on either side.
    expect(
      DOCS_SEARCH_WORD_ENDINGS["de"]!.compoundJoint!.test("versionsnummer"),
    ).toBe(false);
    expect(
      DOCS_SEARCH_WORD_ENDINGS["de"]!.compoundJoint!.test("rechnungs"),
    ).toBe(false);
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
    /*
     * Dutch writes its names and its separable verbs so (#8335).
     * Dutch joins only the first part of a verb to it (#8335): DOCS_SEARCH_SEPARABLE_PARTICLES.
     */
    expect(DOCS_SEARCH_COMPOUNDING_LANGUAGES.has("nl")).toBe(false);
  });

  /*
   * The forms no ending meets (#8335): an ending read as another, one
   * kept after some letters, and the verbs and nouns whose stems differ.
   */
  it("read an ending as another only where it is no ending of their own, and keep only endings they have", () => {
    for (const [language, forms] of Object.entries(DOCS_SEARCH_WORD_ENDINGS)) {
      for (const ending of Object.keys(forms.rewrites || {})) {
        expect({
          language,
          ending,
          both: forms.endings.includes(ending),
        }).toEqual({ language, ending, both: false });
      }

      const endings: Array<string> = [
        ...forms.endings,
        ...Object.keys(forms.rewrites || {}),
      ];

      for (const ending of Object.keys(forms.keptAfter || {})) {
        expect({ language, ending, has: endings.includes(ending) }).toEqual({
          language,
          ending,
          has: true,
        });
      }
    }
  });

  it("list each form once, written in its language's script", () => {
    for (const [language, endings] of Object.entries(
      DOCS_SEARCH_WORD_ENDINGS,
    )) {
      const forms: DocsWordForms | undefined = endings.forms;

      if (!forms) {
        continue;
      }

      expect(new Set<string>(forms.endings).size).toBe(forms.endings.length);
      expect(new Set<string>(forms.prefixes).size).toBe(forms.prefixes.length);

      for (const [stem, readAs] of Object.entries(forms.stems)) {
        expect({ language, stem, written: endings.script.test(stem) }).toEqual({
          language,
          stem,
          written: true,
        });
        expect({
          language,
          readAs,
          written: endings.script.test(readAs),
        }).toEqual({ language, readAs, written: true });
      }
    }
  });

  it("are given to Persian, Korean and Russian verbs, Hindi and Swedish plurals, and Korean's particles on a Latin name", () => {
    expect(DOCS_SEARCH_WORD_ENDINGS["fa"]!.forms!.stems["ساز"]).toBe("ساخت");
    expect(DOCS_SEARCH_WORD_ENDINGS["fa"]!.stacksEndings).toBe(true);
    expect(DOCS_SEARCH_WORD_ENDINGS["ko"]!.forms!.stems["만드"]).toBe("만들");
    expect(DOCS_SEARCH_WORD_ENDINGS["ru"]!.forms!.stems["настройк"]).toBe(
      "настро",
    );
    expect(DOCS_SEARCH_WORD_ENDINGS["hi"]!.rewrites!["ियाँ"]).toBe("ि");
    expect(
      DOCS_SEARCH_WORD_ENDINGS["sv"]!.keptAfter!["or"]!.test("monit"),
    ).toBe(true);
    expect(
      DOCS_SEARCH_WORD_ENDINGS["sv"]!.keptAfter!["or"]!.test("statussid"),
    ).toBe(false);
    expect(DOCS_SEARCH_WORD_ENDINGS["ko"]!.writtenOnto!.test("slack을")).toBe(
      true,
    );
    // Only a Latin name: a Korean word with its particle is its own script's.
    expect(DOCS_SEARCH_WORD_ENDINGS["ko"]!.writtenOnto!.test("모니터를")).toBe(
      false,
    );
    // Persian does not read "دادن" (give): its "داده" (given) is the docs' "داده" (data).
    expect(
      Object.prototype.hasOwnProperty.call(
        DOCS_SEARCH_WORD_ENDINGS["fa"]!.forms!.stems,
        "داد",
      ),
    ).toBe(false);
  });

  /*
   * A Russian noun in "-ние" meets itself in every case, the plural's too:
   * the genitive plural ("Настройки уведомлений", Notification Settings)
   * was read as "уведомлен" and the question's "уведомления" as "уведомл",
   * so "Как настроить уведомления?" found the page named for it 9th to
   * 11th, as other Russian pages came and went.
   */
  it("read a Russian noun in -ние as one word in every case, the plural's too, and its verb with it", () => {
    for (const [forms, stem] of [
      [
        [
          "уведомление",
          "уведомления",
          "уведомлению",
          "уведомлением",
          "уведомлении",
          "уведомлений",
          "уведомлениям",
          "уведомлениями",
          "уведомлениях",
          "уведомлять",
        ],
        "уведомл",
      ],
      [
        [
          "расписание",
          "расписания",
          "расписаний",
          "расписаниям",
          "расписаниями",
          "расписаниях",
        ],
        "распис",
      ],
    ] as Array<[Array<string>, string]>) {
      for (const form of forms) {
        expect({ form, terms: tokenizeForDocs(form, "ru") }).toEqual({
          form,
          terms: [stem],
        });
      }
    }

    // A word whose "-ений" is no ending keeps the stem it had.
    expect(tokenizeForDocs("гений", "ru")).toEqual(["ген"]);
    // Nor do the endings reach words they would join wrongly: a token is no current.
    expect(tokenizeForDocs("токен", "ru")).toEqual(["токен"]);
    expect(tokenizeForDocs("ток", "ru")).toEqual(["ток"]);
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

  /*
   * What a review of each list added (#8335): "how much/many", "I want",
   * "should", the rest of a verb a question writes apart where the docs
   * write the verb some other way, and spoken Persian's "یه" (a).
   */
  it.each([
    ["de", ["an", "aus", "ab", "muss", "möchte"]],
    ["fr", ["combien", "veux", "voudrais"]],
    ["es", ["cuanto", "cuantos", "quiero", "necesito"]],
    ["it", ["quanto", "voglio", "vorrei"]],
    ["pt", ["quanto", "quero", "gostaria", "preciso"]],
    ["nl", ["hoeveel", "wil", "zou"]],
    ["da", ["op"]],
    ["no", ["opp"]],
    ["sv", ["upp"]],
    ["ru", ["могут", "можете", "хочу"]],
    ["ja", ["ばいいですか", "いいですか"]],
    ["zh-CN", ["怎么办", "能不能"]],
    ["zh-TW", ["怎麼辦", "能不能"]],
    ["hi", ["लूँ", "लें", "दूँ", "चाहता", "मिलेगा"]],
    ["fa", ["آیا", "چقدر", "یه", "نمی", "کنید", "میتوانم", "خواهم", "شوند"]],
  ] as Array<[string, Array<string>]>)(
    "%s: a review added %p (#8335)",
    (language: string, words: Array<string>) => {
      const listed: ReadonlySet<string> = getDocsSearchQuestionWords(language);

      expect(
        words.filter((word: string): boolean => {
          return !listed.has(foldDocsSearchWord(word));
        }),
      ).toEqual([]);
    },
  );

  it("leave Dutch 'aan' and 'in' to be read with the verb a question writes them after (#8335)", () => {
    const dutch: ReadonlySet<string> = getDocsSearchQuestionWords("nl");

    // "maak ... aan" is "aanmaken", "stel ... in" is "instellen".
    expect(dutch.has("aan")).toBe(false);
    expect(dutch.has("in")).toBe(false);

    const particles: ReadonlySet<string> =
      getDocsSearchSeparableParticles("nl");

    for (const particle of ["aan", "in", "uit", "af", "toe"]) {
      expect({ particle, has: particles.has(particle) }).toEqual({
        particle,
        has: true,
      });
    }

    // Every particle is there to join: none is a question word, which a question leaves out first.
    expect(
      Array.from(particles).filter((particle: string): boolean => {
        return dutch.has(particle);
      }),
    ).toEqual([]);
    // Only Dutch has them; Danish, Norwegian and Swedish join any two words.
    expect(Object.keys(DOCS_SEARCH_SEPARABLE_PARTICLES)).toEqual(["nl"]);
    expect(getDocsSearchSeparableParticles("de").size).toBe(0);
    expect(getDocsSearchSeparableParticles("constructor").size).toBe(0);
  });

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
