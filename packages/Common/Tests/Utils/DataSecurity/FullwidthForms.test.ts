import { describe, expect, test } from "@jest/globals";
import { DIGIT_ZEROS } from "../../../Utils/DataSecurity/DigitReadings";
import {
  foldFullwidthForms,
  FULLWIDTH_FORMS,
  holdsFullwidthFormOfANumber,
  isFullwidthForm,
  readFullwidthForms,
} from "../../../Utils/DataSecurity/FullwidthForms";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";

/*
 * A NUMBER'S FULLWIDTH SIGNS AND SEPARATORS, READ AS ASCII (#11115).
 *
 * Japanese and Chinese text types a number wholly in fullwidth: its plus
 * sign, hyphens, parentheses, full stops, solidi and ideographic spaces
 * too. The reading folds each of those forms to the ASCII character it is
 * the form of - one UTF-16 unit for one, so every position stays where it
 * is - and leaves every other character, its digits among them, to the
 * digit readings. It reads only a text with a form right beside a digit of
 * any script: CJK prose is read as it is.
 */

const IDEOGRAPHIC_SPACE: string = "　";

const random: SeededRandom = seededRandom(11115);

describe("the fullwidth forms read", () => {
  test("are a number's plus sign, hyphen, parentheses, full stop, solidus and the ideographic space", () => {
    expect(
      FULLWIDTH_FORMS.map((form: number): string => {
        return form.toString(16);
      }).sort(),
    ).toEqual(["3000", "ff08", "ff09", "ff0b", "ff0d", "ff0e", "ff0f"]);
  });

  test("each reads as the ASCII character Unicode says it is the form of (NFKC)", () => {
    for (const form of FULLWIDTH_FORMS) {
      const character: string = String.fromCharCode(form);
      const ascii: string = character.normalize("NFKC");

      expect([form.toString(16), foldFullwidthForms(character)]).toEqual([
        form.toString(16),
        ascii,
      ]);
      expect(ascii.length).toBe(1);
      expect(ascii.charCodeAt(0)).toBeLessThan(0x80);
      expect(isFullwidthForm(form)).toBe(true);
    }
  });

  test("no other character is one: not fullwidth letters, digits, other punctuation, nor the ASCII forms", () => {
    for (const character of [
      "+",
      "-",
      "(",
      ")",
      ".",
      "/",
      " ",
      " ",
      "Ａ",
      "ｚ",
      "０",
      "９",
      "：",
      "，",
      "＠",
      "＃",
      "。",
      "、",
      "ー",
      "‐",
      "−",
      "–",
    ]) {
      expect([character, isFullwidthForm(character.charCodeAt(0))]).toEqual([
        character,
        false,
      ]);
      expect(foldFullwidthForms(character)).toBe(character);
    }
  });
});

describe("foldFullwidthForms", () => {
  test("folds every form of a number typed wholly in fullwidth, and leaves its digits to the digit readings", () => {
    expect(foldFullwidthForms("＋８１ ３－１２３４－５６７８")).toBe(
      "+８１ ３-１２３４-５６７８",
    );
    expect(foldFullwidthForms(`＋８１${IDEOGRAPHIC_SPACE}３－１２３４`)).toBe(
      "+８１ ３-１２３４",
    );
    expect(foldFullwidthForms("（０３）１２３４－５６７８")).toBe(
      "(０３)１２３４-５６７８",
    );
    expect(foldFullwidthForms("５３６．２２．８７３１")).toBe(
      "５３６.２２.８７３１",
    );
    expect(foldFullwidthForms("１９８５／０３／１２")).toBe(
      "１９８５/０３/１２",
    );
  });

  test("is one unit for one: as long as the text, every other character where it was", () => {
    const text: string = `電話：＋81${IDEOGRAPHIC_SPACE}3－1234－5678（自宅）. 😀 ok`;
    const folded: string = foldFullwidthForms(text);

    expect(folded).toHaveLength(text.length);

    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (!isFullwidthForm(code)) {
        expect([index, folded.charCodeAt(index)]).toEqual([index, code]);
      }
    }

    expect(folded).toBe("電話：+81 3-1234-5678(自宅). 😀 ok");
  });

  test("hands back the very text when it holds no form", () => {
    const text: string = "no forms here: +44 20 7946 0958 ４１１１";

    expect(foldFullwidthForms(text)).toBe(text);
    expect(foldFullwidthForms("")).toBe("");
  });

  test("folds a form at the text's start and at its end", () => {
    expect(foldFullwidthForms("＋1")).toBe("+1");
    expect(foldFullwidthForms("1－")).toBe("1-");
    expect(foldFullwidthForms("＋")).toBe("+");
  });
});

describe("holdsFullwidthFormOfANumber", () => {
  test("holds a form right before or right after a digit of any script", () => {
    for (const text of [
      "＋８１",
      "＋81",
      "3－",
      "－3",
      "（０３",
      "０３）",
      "５．",
      "／１２",
      `１２３４${IDEOGRAPHIC_SPACE}`,
      `${IDEOGRAPHIC_SPACE}５６７８`,
      // An Arabic-Indic digit, a Devanagari one, and an ASCII one.
      "＋٤٤",
      "४－",
      "x 7－y",
    ]) {
      expect([text, holdsFullwidthFormOfANumber(text)]).toEqual([text, true]);
    }
  });

  test("holds one beside a digit of every script the digit readings read", () => {
    for (const zero of DIGIT_ZEROS) {
      const digit: string = String.fromCharCode(zero + 7);

      expect([
        zero.toString(16),
        holdsFullwidthFormOfANumber(`a${digit}－b`),
        holdsFullwidthFormOfANumber(`a＋${digit}b`),
      ]).toEqual([zero.toString(16), true, true]);
    }
  });

  test("holds none in CJK prose, where forms sit beside letters, punctuation and other forms", () => {
    for (const text of [
      "",
      "no digits at all",
      "ASCII only: +44 20 7946 0958",
      "（注）設定を確認してください。",
      `東京${IDEOGRAPHIC_SPACE}大阪${IDEOGRAPHIC_SPACE}名古屋`,
      `${IDEOGRAPHIC_SPACE}本日は晴天なり。`,
      "合計（税込）：",
      "Ａ－Ｂ／Ｃ．Ｄ",
      "＋（－）",
      // A date's weekday in parentheses: after 日, a letter, not a digit.
      "2026年11月27日（金）",
    ]) {
      expect([text, holdsFullwidthFormOfANumber(text)]).toEqual([text, false]);
    }
  });

  test("a digit two characters from a form is not beside it", () => {
    expect(holdsFullwidthFormOfANumber("1 －")).toBe(false);
    expect(holdsFullwidthFormOfANumber("－ 1")).toBe(false);
    expect(holdsFullwidthFormOfANumber("1a－a1")).toBe(false);
  });
});

describe("readFullwidthForms", () => {
  test("reads a text with a number's form folded, every form in it", () => {
    expect(readFullwidthForms("（注）電話：＋81 3－1234－5678")).toBe(
      "(注)電話：+81 3-1234-5678",
    );
  });

  test("reads nothing more of a text with no form beside a digit", () => {
    expect(readFullwidthForms("（注）設定を確認してください。")).toBeNull();
    expect(readFullwidthForms("+44 20 7946 0958")).toBeNull();
    expect(readFullwidthForms("")).toBeNull();
  });

  test("is, for any text, null or the fold, and the fold is as long as the text", () => {
    const alphabet: Array<string> = [
      "1",
      "４",
      "٤",
      "a",
      "あ",
      " ",
      "-",
      ...FULLWIDTH_FORMS.map((form: number): string => {
        return String.fromCharCode(form);
      }),
    ];

    for (let attempt: number = 0; attempt < 500; attempt++) {
      let text: string = "";

      for (let index: number = random(12); index >= 0; index--) {
        text += alphabet[random(alphabet.length)]!;
      }

      const read: string | null = readFullwidthForms(text);

      expect([text, read]).toEqual([
        text,
        holdsFullwidthFormOfANumber(text) ? foldFullwidthForms(text) : null,
      ]);

      if (read !== null) {
        expect(read).toHaveLength(text.length);
      }
    }
  });
});
