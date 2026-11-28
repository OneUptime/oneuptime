import { describe, expect, test } from "@jest/globals";
import { mayReadOtherwise } from "../../../Types/Telemetry/ScrubRule";
import { DIGIT_ZEROS } from "../../../Utils/DataSecurity/DigitReadings";
import {
  FULLWIDTH_FORM_PREFILTER,
  FULLWIDTH_LETTERS_PREFILTER,
} from "../../../Utils/DataSecurity/DetectorPrefilter";
import {
  foldFullwidthForms,
  foldFullwidthLetters,
  FULLWIDTH_FORMS,
  holdsFullwidthFormOfANumber,
  holdsFullwidthLettersOfAValue,
  isFullwidthLetter,
  isNumberDash,
  NUMBER_DASHES,
  readFullwidthForms,
  readFullwidthLetters,
} from "../../../Utils/DataSecurity/FullwidthForms";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * A NUMBER'S GROUPS SET APART BY ANOTHER DASH, AND A VALUE TYPED IN
 * FULLWIDTH LETTERS, READ AS ASCII (#11385).
 *
 * The fullwidth reading reads the dashes a number's groups are set apart
 * by - the prolonged sound mark ー and its halfwidth form ｰ, the hyphen ‐,
 * the non-breaking hyphen ‑, the figure dash ‒, the en dash – and the
 * minus sign − - as "-", and only between two digits of any script. A
 * second reading folds the fullwidth ASCII block, letters and all, as NFKC
 * does, for a text that holds some of a value typed in fullwidth letters,
 * and never for CJK prose. Both are one UTF-16 unit for one.
 * ---------------------------------------------------------------------------
 */

const random: SeededRandom = seededRandom(11385);

// The dashes, as the characters they are.
const DASHES: Array<string> = NUMBER_DASHES.map((dash: number): string => {
  return String.fromCharCode(dash);
});

// One letter of the Latin alphabet, as ASCII writes it.
const ASCII_LETTER: RegExp = /^[A-Za-z]$/;

// One digit of each script the digit readings read.
const DIGIT_OF_EVERY_SCRIPT: Array<string> = DIGIT_ZEROS.map(
  (zero: number): string => {
    return String.fromCharCode(zero + 3);
  },
);

describe("the dashes read between two digits", () => {
  test("are the prolonged sound mark, its halfwidth form, the hyphen, the non-breaking hyphen, the figure dash, the en dash and the minus sign", () => {
    expect(
      NUMBER_DASHES.map((dash: number): string => {
        return dash.toString(16);
      }).sort(),
    ).toEqual(["2010", "2011", "2012", "2013", "2212", "30fc", "ff70"]);

    for (const dash of NUMBER_DASHES) {
      expect(isNumberDash(dash)).toBe(true);
    }
  });

  test("none is a dash already read: the hyphen-minus, its fullwidth form, nor a dash of sentences", () => {
    for (const character of ["-", "－", "—", "―", "~", "〜", "_", "‧", "・"]) {
      expect([character, isNumberDash(character.charCodeAt(0))]).toEqual([
        character,
        false,
      ]);
    }
  });

  test.each(
    DASHES.map((dash: string): [string] => {
      return [dash];
    }),
  )(
    "%s between two digits is read as a hyphen, one unit for one",
    (dash: string) => {
      const text: string = `03${dash}1234${dash}5678`;
      const read: string | null = readFullwidthForms(text);

      expect(read).toBe("03-1234-5678");
      expect(read!.length).toBe(text.length);
      expect(foldFullwidthForms(text)).toBe("03-1234-5678");
    },
  );

  test.each(
    DASHES.map((dash: string): [string] => {
      return [dash];
    }),
  )("%s between digits of every script is read so too", (dash: string) => {
    for (const left of DIGIT_OF_EVERY_SCRIPT) {
      for (const right of [DIGIT_OF_EVERY_SCRIPT[0]!, "５", "٥"]) {
        const text: string = `${left}${dash}${right}`;

        expect([text, holdsFullwidthFormOfANumber(text)]).toEqual([text, true]);
        expect(foldFullwidthForms(text)).toBe(`${left}-${right}`);
      }
    }
  });

  test.each(
    DASHES.map((dash: string): [string] => {
      return [dash];
    }),
  )(
    "%s beside no digit, or beside one alone, is left as it is",
    (dash: string) => {
      for (const text of [
        `サ${dash}バ${dash}`,
        `${dash}5`,
        `5${dash}`,
        `a${dash}b`,
        `5 ${dash} 6`,
        `${dash}${dash}`,
        `5${dash}${dash}6`,
      ]) {
        expect([text, readFullwidthForms(text)]).toEqual([text, null]);
        expect(foldFullwidthForms(text)).toBe(text);
      }
    },
  );

  test("a katakana word, a minus before a number and a range keep what is not between two digits", () => {
    expect(readFullwidthForms("サーバー3台")).toBeNull();
    expect(readFullwidthForms("気温−5度")).toBeNull();
    expect(readFullwidthForms("pages 10–20")).toBe("pages 10-20");
    // A range is read as a hyphen: what a range of digits reads as, which no detector takes.
    expect(foldFullwidthForms("データ2ー3件")).toBe("データ2-3件");
  });

  test("a text with a dash between two digits is read with every fullwidth form in it folded too", () => {
    expect(readFullwidthForms("（注）０３ー１２３４ー５６７８")).toBe(
      "(注)０３-１２３４-５６７８",
    );
  });

  test("a fullwidth form beside a digit is read as before, a dash elsewhere in the text left", () => {
    expect(readFullwidthForms("＋８１ ー ３－１２３４")).toBe(
      "+８１ ー ３-１２３４",
    );
  });
});

describe("the fullwidth letters' reading", () => {
  test("reads every character of the fullwidth ASCII block, and the ideographic space, as NFKC folds it", () => {
    for (let code: number = 0xff01; code <= 0xff5e; code++) {
      const character: string = String.fromCharCode(code);
      const ascii: string = character.normalize("NFKC");

      expect([code.toString(16), foldFullwidthLetters(character)]).toEqual([
        code.toString(16),
        ascii,
      ]);
      expect(ascii.length).toBe(1);
      expect(ascii.charCodeAt(0)).toBeLessThan(0x80);
    }

    expect(foldFullwidthLetters("　")).toBe("　".normalize("NFKC"));
    expect(foldFullwidthLetters("　")).toBe(" ");
  });

  test("folds nothing else NFKC would: no kana, kanji, halfwidth katakana, CJK punctuation or compatibility form", () => {
    for (const character of [
      "あ",
      "ア",
      "漢",
      "ｱ",
      "ﾊﾞ",
      "、",
      "。",
      "「",
      "」",
      "・",
      "￥",
      "￡",
      "⦅",
      "①",
      "㈱",
      "ﬁ",
      "Ⅻ",
      "²",
      "é",
      "Ａ́",
    ]) {
      const folded: string = foldFullwidthLetters(character);
      // Each unit of the fullwidth ASCII block folded alone, by NFKC.
      const expected: string = Array.from(character)
        .map((unit: string): string => {
          const code: number = unit.charCodeAt(0);

          return code >= 0xff01 && code <= 0xff5e
            ? unit.normalize("NFKC")
            : unit;
        })
        .join("");

      expect([character, folded]).toEqual([character, expected]);
    }
  });

  test("is one unit for one: as long as the text, every character where it was", () => {
    const text: string =
      "メール：ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ　ＩＢＡＮ　ＤＥ８９";
    const folded: string = foldFullwidthLetters(text);

    expect(folded).toBe("メール:jane@example.com IBAN DE89");
    expect(folded.length).toBe(text.length);
  });

  test("reads the dashes between two digits as hyphens too", () => {
    expect(foldFullwidthLetters("ＴＥＬ　０３ー１２３４ー５６７８")).toBe(
      "TEL 03-1234-5678",
    );
  });

  test.each([
    ["an email address typed in fullwidth", "ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ"],
    ["an IBAN typed in fullwidth", "ＤＥ８９　３７０４　００４４"],
    ["a UK postcode typed in fullwidth", "ＳＷ１Ａ　２ＡＡ"],
    ["a word typed in fullwidth", "ＴＥＬ"],
    ["a fullwidth at sign in an ASCII address", "jane＠example.com"],
    ["a fullwidth at sign before fullwidth digits", "＠１２３"],
    ["a fullwidth letter after a fullwidth digit", "１Ａ"],
  ])(
    "is read for a text with some of a value typed in fullwidth: %s",
    (_label: string, text: string) => {
      expect(holdsFullwidthLettersOfAValue(text)).toBe(true);
      expect(readFullwidthLetters(text)).toBe(foldFullwidthLetters(text));
    },
  );

  test.each([
    ["CJK prose", "設定を確認してください。（注）以上です！"],
    ["prose with fullwidth digits", "合計１２３件、残り４５件"],
    [
      "prose with a number typed in fullwidth",
      "電話：＋８１　３－１２３４－５６７８",
    ],
    ["a lone fullwidth letter", "Ａ"],
    ["a fullwidth letter beside an ASCII one", "Ａb"],
    ["fullwidth letters apart by a space", "Ａ Ｂ"],
    ["a lone fullwidth at sign", "＠"],
    ["a fullwidth at sign beside punctuation", "（＠）"],
    ["halfwidth katakana", "ｱｲｳｴｵ"],
    ["an ASCII value", "jane@example.com DE89 3704"],
    ["nothing", ""],
  ])("is not read for a text with none: %s", (_label: string, text: string) => {
    expect(holdsFullwidthLettersOfAValue(text)).toBe(false);
    expect(readFullwidthLetters(text)).toBeNull();
  });

  test("fullwidth letters are the 52 of the Latin alphabet", () => {
    let letters: number = 0;

    for (let code: number = 0xff00; code <= 0xffef; code++) {
      if (isFullwidthLetter(code)) {
        letters++;
        expect(
          ASCII_LETTER.test(String.fromCharCode(code).normalize("NFKC")),
        ).toBe(true);
      }
    }

    expect(letters).toBe(52);
  });
});

describe("whatever text, each reading is null or its fold, as long as the text", () => {
  const ALPHABET: Array<string> = [
    ...DASHES,
    ...FULLWIDTH_FORMS.map((form: number): string => {
      return String.fromCharCode(form);
    }),
    "Ａ",
    "ｚ",
    "Ｑ",
    "＠",
    "１",
    "９",
    "1",
    "7",
    "٣",
    "a",
    "Z",
    "@",
    " ",
    "あ",
    "漢",
    "、",
    "-",
    "+",
  ];

  test("over 5,000 texts drawn from a seeded stream", () => {
    for (let draw: number = 0; draw < 5_000; draw++) {
      let text: string = "";

      for (let index: number = 0; index < random(12); index++) {
        text += ALPHABET[random(ALPHABET.length)];
      }

      const forms: string | null = readFullwidthForms(text);
      const letters: string | null = readFullwidthLetters(text);

      expect([
        text,
        forms === null || forms === foldFullwidthForms(text),
      ]).toEqual([text, true]);
      expect([
        text,
        letters === null || letters === foldFullwidthLetters(text),
      ]).toEqual([text, true]);
      expect(foldFullwidthForms(text).length).toBe(text.length);
      expect(foldFullwidthLetters(text).length).toBe(text.length);
      // The letters' fold folds all the forms' fold does, and more.
      expect(foldFullwidthLetters(foldFullwidthForms(text))).toBe(
        foldFullwidthLetters(text),
      );
    }
  });
});

describe("the texts a database search and a Custom Regex rule read again", () => {
  // RE2's \x{...} written as JavaScript's \u{...}, for asking JavaScript what RE2 takes.
  function asJavaScript(re2: string): RegExp {
    return new RegExp(re2.split("\\x{").join("\\u{"), "u");
  }

  const FORMS: RegExp = asJavaScript(FULLWIDTH_FORM_PREFILTER);
  const LETTERS: RegExp = asJavaScript(FULLWIDTH_LETTERS_PREFILTER);

  const TEXTS: ReadonlyArray<string> = [
    "０３ー１２３４ー５６７８",
    "536–22–8731",
    "+44 20 7946‑0958",
    "４１１１‒１１１１",
    "3−2",
    "サーバー3台",
    "気温−5度",
    "pages 10 – 20",
    "ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ",
    "jane＠example.com",
    "ＳＷ１Ａ　２ＡＡ",
    "ＴＥＬ",
    "Ａ",
    "（＠）",
    "設定を確認してください。（注）以上",
    "plain ASCII 536-22-8731",
  ];

  test.each(
    TEXTS.map((text: string): [string] => {
      return [text];
    }),
  )("are exactly those each reading reads: %s", (text: string) => {
    expect(FORMS.test(text)).toBe(holdsFullwidthFormOfANumber(text));
    expect(LETTERS.test(text)).toBe(holdsFullwidthLettersOfAValue(text));
    expect(mayReadOtherwise(text)).toBe(
      text.indexOf("+") !== -1 ||
        holdsFullwidthFormOfANumber(text) ||
        holdsFullwidthLettersOfAValue(text),
    );
  });
});
