import {
  DOCS_SEARCH_QUESTION_WORDS,
  DOCS_SEARCH_SYNONYMS,
  DocsSearchSynonym,
  DocsVocabulary,
  DocsVocabularyMatch,
  foldDocsSearchWord,
  getDocsSearchQuestionWords,
  getDocsSearchSynonyms,
  getTypoAllowance,
  isWithinEditDistance,
} from "../../../FeatureSet/Docs/Utils/DocsSearchWords";
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

  it("are none in a language without a list, or one the docs do not have", () => {
    // English's are left out of every page and every question, by the reader's tokenizer.
    expect(getDocsSearchQuestionWords("en").size).toBe(0);
    expect(getDocsSearchQuestionWords("xx").size).toBe(0);
    expect(getDocsSearchQuestionWords("constructor").size).toBe(0);
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
