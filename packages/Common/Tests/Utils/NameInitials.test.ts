import getNameInitialsDefault, {
  NAME_INITIALS_FALLBACK,
  getNameForInitials,
  getNameInitials,
  getNameWordsForInitials,
} from "../../Utils/NameInitials";
import { fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The letters an avatar draws for a name it has no picture for
 * (Utils/NameInitials): the first letter of the name's first word and of
 * its last, read from its words only. A team named "Security Operations
 * Center (EMEA)" was drawn "S(" by the people picker's avatar, which took
 * the first character of the first and last bits of the name as written.
 */

describe("getNameInitials", () => {
  test.each([
    // The first and the last word, or the one word there is.
    ["Ada Byron Lovelace", "AL"],
    ["Maya Chen", "MC"],
    ["maya chen", "MC"],
    ["  platform  ", "P"],
    ["Platform", "P"],
    ["Maya\tChen", "MC"],
    ["Maya\nChen", "MC"],
    // Punctuation is never an initial: it ends a word or stands between two.
    ["Jean-Luc Picard", "JP"],
    ["O'Brien Patrick", "OP"],
    ["SOC - Tier 2", "S2"],
    ["Platform / On Call", "PC"],
    ["#incident-response", "IR"],
    ["... Security", "S"],
    ["SOC Tier 2", "S2"],
    ["Team 42", "T4"],
    ["42", "4"],
  ])("%j is %j", (name: string, initials: string) => {
    expect(getNameInitials(name)).toBe(initials);
  });

  test("what a name says in brackets is left out, while the rest has a word", () => {
    // The team the case list drew "S(".
    expect(getNameInitials("Security Operations Center (EMEA)")).toBe("SC");
    expect(
      getNameInitials("Security Operations Center - Tier 2 Escalations (EMEA)"),
    ).toBe("SE");
    // Someone's pronouns after their name.
    expect(getNameInitials("Maya Chen (she/her)")).toBe("MC");
    // In the middle, square and curly, and the full-width forms.
    expect(getNameInitials("SOC [night shift] Tier")).toBe("ST");
    expect(getNameInitials("Platform {EU} Ops")).toBe("PO");
    expect(getNameInitials("Sicherheitsteam （EMEA）")).toBe("S");
    expect(getNameInitials("Sicherheitsteam ［EMEA］ Nord")).toBe("SN");
    expect(getNameInitials("安全团队【欧洲】 值班")).toBe("安值");
  });

  test("a name that is all brackets is read as it is", () => {
    expect(getNameInitials("(EMEA)")).toBe("E");
    expect(getNameInitials("(Security Operations)")).toBe("SO");
    expect(getNameInitials("[on call] (EMEA)")).toBe("OE");
  });

  test("a bracket left open, or one inside another, never becomes an initial", () => {
    expect(getNameInitials("Security (EMEA")).toBe("SE");
    expect(getNameInitials("Security EMEA)")).toBe("SE");
    expect(getNameInitials("(a (b) c)")).toBe("AC");
    expect(getNameInitials("((((")).toBe(NAME_INITIALS_FALLBACK);
  });

  test("an address is read by the part before its @", () => {
    expect(getNameInitials("jane.doe@acme-commerce.example")).toBe("JD");
    expect(getNameInitials("maya@acme-commerce.example")).toBe("M");
    expect(getNameInitials("k_morgan+soc@acme-commerce.example")).toBe("KS");
    // Not an address: a name with a space in it, or an @ first.
    expect(getNameInitials("Maya @ SOC")).toBe("MS");
    expect(getNameInitials("@maya")).toBe("M");
  });

  test("symbols and emoji are never initials", () => {
    expect(getNameInitials("🚀 Rockets")).toBe("R");
    expect(getNameInitials("Rockets 🚀")).toBe("R");
    expect(getNameInitials("Payments 💳 Team")).toBe("PT");
    expect(getNameInitials("👩\u200d💻 Dev Team")).toBe("DT");
    expect(getNameInitials("© ® ™")).toBe(NAME_INITIALS_FALLBACK);
  });

  test("a name with no letter or digit in it, or no name, is a question mark", () => {
    expect(NAME_INITIALS_FALLBACK).toBe("?");

    for (const name of ["", "   ", "\t\n", "()", "---", "🚀", "@"]) {
      expect(getNameInitials(name)).toBe("?");
    }

    expect(getNameInitials(null)).toBe("?");
    expect(getNameInitials(undefined)).toBe("?");
  });

  test("each initial is one whole letter, in capitals, in every script", () => {
    expect(getNameInitials("Ünal Öz")).toBe("ÜÖ");
    expect(getNameInitials("élodie durand")).toBe("ÉD");
    // An accent typed as a letter and a mark is one letter, as typed whole.
    expect(getNameInitials("e\u0301lodie durand")).toBe("ÉD");
    expect(getNameInitials("ıgor yılmaz")).toBe("IY");
    // "ß" has no one-letter capital: its first stands for the word.
    expect(getNameInitials("ßeta Team")).toBe("ST");
    expect(getNameInitials("田中 太郎")).toBe("田太");
    expect(getNameInitials("김 민준")).toBe("김민");
    expect(getNameInitials("Алиса Смирнова")).toBe("АС");
    expect(getNameInitials("علی رضایی")).toBe("عر");
    // A vowel sign is part of its letter's syllable, never an initial of its own.
    expect(getNameInitials("सुरेश कुमार")).toBe("सक");
  });

  test("a word joined by a zero-width non-joiner or joiner stays one word", () => {
    expect(getNameWordsForInitials("عملیات\u200cهای امنیتی")).toEqual([
      "عملیات\u200cهای",
      "امنیتی",
    ]);
    expect(getNameInitials("عملیات\u200cهای امنیتی")).toBe("عا");
    expect(getNameWordsForInitials("क्\u200dष")).toEqual(["क्\u200dष"]);
  });

  test("never more than two characters, whatever the name", () => {
    const names: Array<string> = [
      "Ada Byron Lovelace",
      "Security Operations Center (EMEA)",
      "सुरेश कुमार",
      "e\u0301lodie durand",
      "ßeta Team",
      "👩\u200d💻 Dev Team",
      "a b c d e f g",
    ];

    for (const name of names) {
      expect(Array.from(getNameInitials(name)).length).toBeLessThanOrEqual(2);
    }
  });

  test("is the module's default export", () => {
    expect(getNameInitialsDefault).toBe(getNameInitials);
  });
});

describe("getNameForInitials", () => {
  test("an address's local part; anything else as written, trimmed", () => {
    expect(getNameForInitials(" jane.doe@acme-commerce.example ")).toBe(
      "jane.doe",
    );
    expect(getNameForInitials("Jane Doe")).toBe("Jane Doe");
    expect(getNameForInitials("Jane Doe <jane@acme-commerce.example>")).toBe(
      "Jane Doe <jane@acme-commerce.example>",
    );
    expect(getNameForInitials("@maya")).toBe("@maya");
    expect(getNameForInitials("")).toBe("");
  });
});

describe("getNameWordsForInitials", () => {
  test("the words outside brackets, in order", () => {
    expect(
      getNameWordsForInitials("Security Operations Center (EMEA)"),
    ).toEqual(["Security", "Operations", "Center"]);
    expect(getNameWordsForInitials("(EMEA) Security")).toEqual(["Security"]);
  });

  test("every word, when only brackets hold any", () => {
    expect(getNameWordsForInitials("(EMEA) [Nord]")).toEqual(["EMEA", "Nord"]);
  });
});

/*
 * A name is text somebody wrote: reading its words and its brackets takes
 * time in line with its length, never with its square - 400,000 characters
 * of each pattern's worst case within two seconds, timed as the fastest of
 * up to three attempts (Tests/Helpers/FastestRun).
 */
describe("a long name is read quickly", () => {
  const LENGTH: number = 400000;

  const repeat: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  };

  test.each([
    ["one word that never ends", repeat("a")],
    ["a word on every other character", repeat("a.")],
    ["opening brackets that never close", repeat("(")],
    ["an opening bracket before every letter", repeat("(a")],
    ["one bracket open to the end", "(" + repeat("a ")],
    ["brackets inside brackets", repeat("((a)")],
    ["full-width brackets that never close", repeat("（a")],
    ["an address with a long local part", repeat("a.") + "@example.com"],
    ["marks with no letter before them", repeat("\u0301")],
    ["zero-width joiners after one letter", "a" + repeat("\u200c")],
  ])("%s", (_label: string, name: string) => {
    expect(
      fastestRun({
        run: (): string => {
          return getNameInitials(name);
        },
        limitInMs: 2000,
      }).inMs,
    ).toBeLessThan(2000);
  });
});
