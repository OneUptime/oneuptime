import { describe, expect, test } from "@jest/globals";
import { digitsOnly } from "../../../Utils/DataSecurity/Detector";
import {
  DIGIT_ZEROS,
  digitValueOf,
  digitZeroOf,
  foldDigits,
  hasDigitBeyondAscii,
  MAX_SCRIPTS_READ_ALONE,
  MIN_DIGITS_OF_A_SCRIPT_READ_ALONE,
  readDigitsOfEveryScript,
} from "../../../Utils/DataSecurity/DigitReadings";
import AndroidAgentRedactor from "../../../Utils/Host/AndroidAgentRedactor";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * EVERY SCRIPT'S DIGITS, READ BY THEIR VALUES (#10960).
 *
 * The card detectors read a card in fullwidth, Arabic-Indic or Persian
 * digits through these readings: each digit of the 37 scripts of the Basic
 * Multilingual Plane as the ASCII digit of its value, each script alone
 * first and then all of them together, every reading as long as the text.
 * Held here to Unicode's own \p{Nd}, and to the OneUptime Android agent's
 * redactor (#10937), so the two read every digit alike.
 */

const NUL: string = "\u0000";

// A digit string written in the digits of the script whose zero is given.
function inScript(digits: string, zero: number): string {
  return digits.replace(/[0-9]/g, (digit: string): string => {
    return String.fromCharCode(zero + Number(digit));
  });
}

describe("the digits of every script of the Basic Multilingual Plane", () => {
  test("are the 37 runs of ten JavaScript's \\p{Nd} reads there, each from its zero", () => {
    const digit: RegExp = /^\p{Nd}$/u;
    const zeros: Array<number> = [];

    for (let code: number = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) {
        continue;
      }

      const char: string = String.fromCharCode(code);
      const isDigit: boolean = digit.test(char);

      if (isDigit && !digit.test(String.fromCharCode(code - 1))) {
        zeros.push(code);
      }

      expect([code, digitValueOf(code) >= 0]).toEqual([code, isDigit]);

      if (isDigit) {
        expect([code, digitValueOf(code)]).toEqual([
          code,
          code - zeros[zeros.length - 1]!,
        ]);
      }
    }

    expect(zeros).toEqual(DIGIT_ZEROS);
    expect(DIGIT_ZEROS).toHaveLength(37);
  });

  test("are read as the Android agent's redactor reads them, each by its value", () => {
    for (const zero of DIGIT_ZEROS) {
      for (let value: number = 0; value < 10; value++) {
        const char: string = String.fromCharCode(zero + value);

        // Fifteen digits and a last one: a card when the last reads as 1.
        expect([
          char,
          AndroidAgentRedactor.looksLikeCardNumber(`411111111111111${char}`),
        ]).toEqual([char, digitValueOf(zero + value) === 1]);
      }
    }
  });

  test("a digit's zero and value, and none for any other character", () => {
    expect(digitZeroOf("7".charCodeAt(0))).toBe(0x30);
    expect(digitValueOf("7".charCodeAt(0))).toBe(7);
    expect(digitZeroOf("٤".charCodeAt(0))).toBe(0x0660);
    expect(digitValueOf("٤".charCodeAt(0))).toBe(4);
    expect(digitValueOf("۴".charCodeAt(0))).toBe(4);
    expect(digitValueOf("４".charCodeAt(0))).toBe(4);
    expect(digitValueOf("४".charCodeAt(0))).toBe(4);
    expect(digitValueOf("๔".charCodeAt(0))).toBe(4);

    for (const char of ["a", "Z", " ", "/", ":", "٫", "＋", "：", "Ⅳ", "①"]) {
      expect([char, digitValueOf(char.charCodeAt(0))]).toEqual([char, -1]);
      expect([char, digitZeroOf(char.charCodeAt(0))]).toEqual([char, -1]);
    }

    // Each half of a digit beyond the Basic Multilingual Plane (Adlam's) is none.
    const adlamFour: string = String.fromCodePoint(0x1e954);

    expect(digitValueOf(adlamFour.charCodeAt(0))).toBe(-1);
    expect(digitValueOf(adlamFour.charCodeAt(1))).toBe(-1);
  });
});

describe("hasDigitBeyondAscii", () => {
  test("is false for ASCII digits alone and true for any other script's", () => {
    expect(hasDigitBeyondAscii("")).toBe(false);
    expect(hasDigitBeyondAscii("card 4111 1111 1111 1111")).toBe(false);
    expect(hasDigitBeyondAscii("卡号已拒绝 ①②③")).toBe(false);

    for (const zero of DIGIT_ZEROS.slice(1)) {
      expect(hasDigitBeyondAscii(`x${String.fromCharCode(zero + 9)}y`)).toBe(
        true,
      );
    }
  });
});

describe("foldDigits", () => {
  test("writes every script's digit as the ASCII one of its value, and nothing else changes", () => {
    expect(foldDigits("カード番号：４１１１ １１１１")).toBe(
      "カード番号：4111 1111",
    );
    expect(foldDigits("رقم ٤١١١-١١١١")).toBe("رقم 4111-1111");
    expect(foldDigits("۴۱۱۱ and ४१११")).toBe("4111 and 4111");
    expect(foldDigits("plain 123 text")).toBe("plain 123 text");
    expect(foldDigits("😀٤")).toBe("😀4");

    for (const zero of DIGIT_ZEROS) {
      expect(foldDigits(inScript("0123456789", zero))).toBe("0123456789");
    }
  });

  test("keeps the text's length, so every position is where it is written", () => {
    const text: string = `a${inScript("4111", 0xff10)}b${inScript("1111", 0x0660)}c😀`;

    expect(foldDigits(text)).toHaveLength(text.length);
  });
});

describe("readDigitsOfEveryScript", () => {
  test("reads nothing more of a text with no digit beyond ASCII", () => {
    expect(readDigitsOfEveryScript("")).toEqual([]);
    expect(readDigitsOfEveryScript("card 4111 1111 1111 1111")).toEqual([]);
  });

  test("reads one script's digits as every digit, once", () => {
    expect(readDigitsOfEveryScript("كارت ٤١١١١١١١١١١١١١١١")).toEqual([
      "كارت 4111111111111111",
    ]);
    // A few digits of one script hold no run, and are read once too.
    expect(readDigitsOfEveryScript("رقم ٤٢")).toEqual(["رقم 42"]);
  });

  test("reads a script holding a card's run alone, another's digits as none, then all of them together", () => {
    const text: string = "۴۱۱۱۱۱۱۱۱۱۱۱۱۱۱۱١ 7";

    expect(readDigitsOfEveryScript(text)).toEqual([
      // Persian alone: the Arabic-Indic digit and the ASCII one are none.
      `4111111111111111${NUL} ${NUL}`,
      // Every script together. One Arabic-Indic digit holds no run of its own.
      "41111111111111111 7",
    ]);
  });

  test("reads each of two scripts that hold a card's run alone", () => {
    const text: string = "۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱ and ٥١٠٥-١٠٥١-٠٥١٠-٥١٠٠";

    expect(readDigitsOfEveryScript(text)).toEqual([
      `4111 1111 1111 1111 and ${NUL.repeat(4)}-${NUL.repeat(4)}-${NUL.repeat(4)}-${NUL.repeat(4)}`,
      `${NUL.repeat(4)} ${NUL.repeat(4)} ${NUL.repeat(4)} ${NUL.repeat(4)} and 5105-1051-0510-5100`,
      "4111 1111 1111 1111 and 5105-1051-0510-5100",
    ]);
  });

  test("reads a number typed in two scripts whole, ASCII digits among them", () => {
    expect(readDigitsOfEveryScript("card ４１１１ 1111 1111 1111")).toEqual([
      // Four fullwidth digits hold no run of a card's: read with the others alone.
      "card 4111 1111 1111 1111",
    ]);
  });

  test("a run is a script's own digits, each group apart by one space or dash at most", () => {
    const eleven: string = inScript("41111111111", 0xff10);
    const twelve: string = inScript("411111111111", 0xff10);

    // Eleven fullwidth digits and an ASCII one: no run of twelve, so one reading of all.
    expect(readDigitsOfEveryScript(`${eleven}1`)).toHaveLength(1);
    // Twelve: a reading of their own, and one of all.
    expect(readDigitsOfEveryScript(`${twelve}1`)).toHaveLength(2);
    // Two spaces end a run; one does not.
    expect(
      readDigitsOfEveryScript(
        `${inScript("411111", 0xff10)}  ${inScript("111111", 0xff10)}1`,
      ),
    ).toHaveLength(1);
    expect(
      readDigitsOfEveryScript(
        `${inScript("411111", 0xff10)} ${inScript("111111", 0xff10)}1`,
      ),
    ).toHaveLength(2);
    // Another script's digit ends a run too.
    expect(
      readDigitsOfEveryScript(
        `${inScript("411111", 0xff10)}٤${inScript("111111", 0xff10)}`,
      ),
    ).toHaveLength(1);
  });

  test("reads at most four scripts alone, and every script with all the others", () => {
    const text: string = DIGIT_ZEROS.slice(1, 7)
      .map((zero: number): string => {
        return inScript("411111111111", zero);
      })
      .join(" x ");
    const readings: Array<string> = readDigitsOfEveryScript(text);

    expect(MAX_SCRIPTS_READ_ALONE).toBe(4);
    expect(MIN_DIGITS_OF_A_SCRIPT_READ_ALONE).toBe(12);
    expect(readings).toHaveLength(MAX_SCRIPTS_READ_ALONE + 1);
    expect(readings[readings.length - 1]).toBe(foldDigits(text));
  });

  test("every reading is as long as the text", () => {
    const text: string = `x${inScript("12", 0x0966)}y${inScript("34", 0xff10)}z56😀`;

    for (const reading of readDigitsOfEveryScript(text)) {
      expect(reading).toHaveLength(text.length);
    }
  });

  test("reads a text of many scripts' digits in time in line with its length", () => {
    // Twelve digits of each script in turn: each holds a run of its own.
    const unit: string = DIGIT_ZEROS.map((zero: number): string => {
      return String.fromCharCode(zero + 4).repeat(12);
    }).join(" x ");
    const text: string = unit.repeat(Math.ceil(200_000 / unit.length));
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return readDigitsOfEveryScript(text).length;
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    // The first four scripts beyond ASCII alone, then all of them together.
    expect(timed.result).toBe(MAX_SCRIPTS_READ_ALONE + 1);
  });
});

describe("digitsOnly", () => {
  test("reads a digit of any script by its value, and keeps the rest out", () => {
    expect(digitsOnly("4111 1111-1111 1111")).toBe("4111111111111111");
    expect(digitsOnly("４１１１ １１１１ １１１１ １１１１")).toBe(
      "4111111111111111",
    );
    expect(digitsOnly("۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱")).toBe("4111111111111111");
    expect(digitsOnly("４１１１ 1111 ٤١١١")).toBe("411111114111");
    expect(digitsOnly("no digits ①")).toBe("");
  });
});
