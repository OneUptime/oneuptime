import AndroidAgentRedactor, {
  REDACTOR_MAX_LENGTH,
} from "../../../Utils/Host/AndroidAgentRedactor";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  JavaScriptPattern,
  KotlinStringLiteral,
  javaScriptForm,
  kotlinStringLiterals,
} from "../../Helpers/KotlinPatterns";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Android agent's redaction, as OneUptime runs it over what it sends to
 * a device (a log session's note, #9966). Every case is one of the agent's
 * own (agents/AndroidAgent RedactorTest.kt), with the same answer: a text
 * reads the same on the device whichever of the two redacted it. Only the
 * token's own block and the patterns' at the end are ours: they hold the
 * server's patterns to the agent's, read from its Kotlin.
 */

const AGENT_REDACTOR: string =
  "agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/logs/Redactor.kt";
const SERVER_REDACTOR: string =
  "packages/Common/Utils/Host/AndroidAgentRedactor.ts";

const JWT: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

function redact(text: string | null | undefined): string {
  return AndroidAgentRedactor.redact(text);
}

describe("a card number", () => {
  test("is taken out, whichever way it is written", () => {
    expect(redact("Declined 4111111111111111 at terminal 4")).toBe(
      "Declined [card number] at terminal 4",
    );
    expect(redact("card=4111 1111 1111 1111;")).toBe("card=[card number];");
    expect(redact("pan 5500-0000-0000-0004")).toBe("pan [card number]");
    expect(redact("Amex 378282246310005 ok")).toBe("Amex [card number] ok");
  });

  test("a long number that is not a card is kept", () => {
    // Fails the Luhn check.
    expect(redact("order 4111111111111112")).toBe("order 4111111111111112");
    // Millisecond and nanosecond timestamps start with 1, which no card number does.
    expect(redact("at 1795076857467")).toBe("at 1795076857467");
    expect(redact("t=1795076857467123456")).toBe("t=1795076857467123456");
    // Too short, and inside a word.
    expect(redact("id 411111111111")).toBe("id 411111111111");
    expect(redact("x4111111111111111y")).toBe("x4111111111111111y");
  });

  test("the Luhn check", () => {
    expect(AndroidAgentRedactor.passesLuhn("4111111111111111")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398713")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398710")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("41a1")).toBe(false);
    expect(AndroidAgentRedactor.looksLikeCardNumber("4111111111111111")).toBe(
      true,
    );
    expect(AndroidAgentRedactor.looksLikeCardNumber("1111111111111117")).toBe(
      false,
    );
    // A digit of any script is read by its value, as the card search reads it (#10877): "٤" is 4, "１" is 1.
    expect(
      AndroidAgentRedactor.passesLuhn(
        "\u0664\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661",
      ),
    ).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("411111111111111\u0661")).toBe(true);
    expect(
      AndroidAgentRedactor.looksLikeCardNumber("411111111111111\uff11"),
    ).toBe(true);
    // Anything else is no digit: a letter, and a digit beyond the Basic Multilingual Plane (Adlam's one, U+1E951).
    expect(AndroidAgentRedactor.looksLikeCardNumber("411111111111111x")).toBe(
      false,
    );
    expect(AndroidAgentRedactor.passesLuhn("411111111111111\u{1e951}")).toBe(
      false,
    );
  });

  test("beside another number is taken out", () => {
    // Its expiry date, an amount or a code after it, one space or dash between.
    expect(redact("4111 1111 1111 1111 12/25")).toBe("[card number] 12/25");
    expect(redact("card 4111111111111111 123")).toBe("card [card number] 123");
    expect(redact("有效 4111111111111111 123元")).toBe(
      "有效 [card number] 123元",
    );
    expect(redact("卡号 4111 1111 1111 1111 12月到期")).toBe(
      "卡号 [card number] 12月到期",
    );
    expect(redact("4111-1111-1111-1111-1号")).toBe("[card number]-1号");
    // A number before it.
    expect(redact("1 4111 1111 1111 1111")).toBe("1 [card number]");
    expect(redact("号12 4111 1111 1111 1111")).toBe("号12 [card number]");
    expect(redact("订单号1234 4111 1111 1111 1111")).toBe(
      "订单号1234 [card number]",
    );
    // Two in one run, and a run too long for one.
    expect(redact("4111 1111 1111 1111 5500 0000 0000 0004")).toBe(
      "[card number] [card number]",
    );
    expect(redact("4111 1111 1111 1111 1111 1111")).toBe(
      "[card number] 1111 1111",
    );
    // Numbers that hold no card stay, whole.
    expect(redact("1795076857467 1795076857467")).toBe(
      "1795076857467 1795076857467",
    );
    expect(redact("12 34 56 78 90 12 34")).toBe("12 34 56 78 90 12 34");
    expect(redact("4111 1111 1111 1112 12/25")).toBe(
      "4111 1111 1111 1112 12/25",
    );
  });
});

describe("a secret written right against a letter of another script", () => {
  test("is taken out, as on the device (#10835)", () => {
    expect(redact("支付失败，卡号4111111111111111")).toBe(
      "支付失败，卡号[card number]",
    );
    expect(redact("4111111111111111已拒绝")).toBe("[card number]已拒绝");
    expect(redact("邮箱jane@example.com")).toBe("邮箱[email]");
    expect(redact("jane@example.com已发送")).toBe("[email]已发送");
    expect(redact("令牌Bearer abcdefghijklmnop")).toBe(
      "令牌Bearer [credential]",
    );
    expect(redact(`令牌${JWT}`)).toBe("令牌[token]");
    expect(redact("用户password=hunter2")).toBe("用户password=[redacted]");
    expect(redact("カード番号4111 1111 1111 1111です")).toBe(
      "カード番号[card number]です",
    );
    expect(redact(`トークン${JWT}を送信`)).toBe("トークン[token]を送信");
    expect(redact("メールjane.doe+kiosk@example.co.ukに送信しました")).toBe(
      "メール[email]に送信しました",
    );
    // Korean, Arabic, Cyrillic, Thai and Devanagari.
    expect(redact("카드번호4111111111111111승인거절")).toBe(
      "카드번호[card number]승인거절",
    );
    expect(redact("이메일jane@example.com으로")).toBe("이메일[email]으로");
    expect(redact("토큰Bearer abcdefghijklmnop")).toBe(
      "토큰Bearer [credential]",
    );
    expect(redact("رقم البطاقة5500-0000-0000-0004")).toBe(
      "رقم البطاقة[card number]",
    );
    expect(redact("البريدjane@example.com")).toBe("البريد[email]");
    expect(redact("номер4111111111111111отклонён")).toBe(
      "номер[card number]отклонён",
    );
    expect(redact("ключBasic dXNlcjpwYXNzd29yZA==")).toBe(
      "ключBasic [credential]",
    );
    expect(redact(`токен${JWT}`)).toBe("токен[token]");
    expect(redact("บัตร378282246310005")).toBe("บัตร[card number]");
    expect(redact("कार्ड4111111111111111")).toBe("कार्ड[card number]");
    // A secret's value after a long run of another script's letters.
    expect(redact(`${"中".repeat(41)}password=hunter2`)).toBe(
      `${"中".repeat(41)}password=[redacted]`,
    );
  });

  test("a mark, a joiner, a digit of another script or a folded letter beside it is no word's part either", () => {
    expect(redact(`x\u200b${JWT}`)).toBe("x\u200b[token]");
    expect(redact("x\u200bBearer abcdefghijklmnop")).toBe(
      "x\u200bBearer [credential]",
    );
    expect(redact("\u200d4111111111111111")).toBe("\u200d[card number]");
    expect(redact("jane@example.com\u200d")).toBe("[email]\u200d");
    expect(redact(`e\u0301${JWT}`)).toBe("e\u0301[token]");
    expect(redact("e\u0301Bearer abcdefghijklmnop")).toBe(
      "e\u0301Bearer [credential]",
    );
    expect(redact("jane@example.com\u0301")).toBe("[email]\u0301");
    expect(redact("4111111111111111\u0663")).toBe("[card number]\u0663");
    expect(redact("\u09674111111111111111")).toBe("\u0967[card number]");
    expect(redact("4111111111111111\uff11\uff12")).toBe(
      "[card number]\uff11\uff12",
    );
    expect(redact("\u017fBearer abcdefghijklmnop")).toBe(
      "\u017fBearer [credential]",
    );
    expect(redact("\u212apassword=hunter2")).toBe("\u212apassword=[redacted]");
    expect(redact(`\u{1d49c}${JWT}`)).toBe("\u{1d49c}[token]");
  });

  test("inside a longer ASCII word, is kept", () => {
    for (const text of [
      "x4111111111111111",
      "4111111111111111_",
      "v1.4111111111111111",
      "4111111111111111.5",
      "xBearer abcdefghijklmnop",
      "_basic abcdefghijklmnop",
      `${"a".repeat(41)}password=hunter2`,
      "卡号4111111111111111x",
      "x4111111111111111已拒绝",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });
});

describe("an email address", () => {
  test("is taken out", () => {
    expect(redact("Receipt sent to jane.doe+kiosk@example.co.uk.")).toBe(
      "Receipt sent to [email].",
    );
    expect(redact("user=a@b.io")).toBe("user=[email]");
  });
});

describe("credentials and tokens", () => {
  test("are taken out, their names kept", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: Bearer [credential]",
    );
    expect(redact("authorization=Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "authorization=Basic [credential]",
    );
    expect(redact("password=hunter2&user=7")).toBe(
      "password=[redacted]&user=7",
    );
    expect(redact('{"api_key": "sk_live_123", "n": 1}')).toBe(
      '{"api_key": "[redacted]", "n": 1}',
    );
    expect(redact("csrf_token: abc123 next")).toBe(
      "csrf_token: [redacted] next",
    );
    expect(redact("GET /pay?session_id=XYZ123&amount=5")).toBe(
      "GET /pay?session_id=[redacted]&amount=5",
    );
    expect(redact("pin=1234")).toBe("pin=[redacted]");

    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redact(`token ${jwt} expired`)).toBe("token [token] expired");
    expect(redact(`id_token=${jwt}`)).toBe("id_token=[token]");
  });

  test("a name that only holds a secret's word, or a value already taken out, is kept", () => {
    expect(redact("max_tokens=5 spinner=3 mapping=x")).toBe(
      "max_tokens=5 spinner=3 mapping=x",
    );
    expect(redact("password=[redacted]")).toBe("password=[redacted]");
    expect(redact('password="[redacted]"')).toBe('password="[redacted]"');
  });
});

describe("what a crash is read by", () => {
  test("is kept", () => {
    const stack: string = [
      "java.lang.IllegalStateException: Printer offline (job 1234, pid 4321)",
      "\tat com.example.kiosk.TokenManager.refresh(TokenManager.kt:42)",
      "\tat com.example.kiosk.MainActivity.onCreate(MainActivity.kt:20)",
      "\tat android.app.Activity.performCreate(Activity.java:8595)",
    ].join("\n");

    expect(redact(stack)).toBe(stack);
    expect(
      redact(
        "  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190",
      ),
    ).toBe("  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190");
  });
});

describe("its bounds", () => {
  test("nothing in, nothing out, and a huge text is cut first", () => {
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
    expect(redact("")).toBe("");
    expect(redact("a".repeat(REDACTOR_MAX_LENGTH + 10))).toHaveLength(
      REDACTOR_MAX_LENGTH,
    );
  });

  test("a long text costs time in proportion to its length", () => {
    // A long word before a secret's name, a long number, a long run of "@".
    const texts: Array<string> = [
      "a".repeat(200_000) + " password" + "b".repeat(50_000) + "=x",
      "1".repeat(200_000),
      "x@".repeat(100_000),
    ];
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // None of them holds a secret, a card number or an address.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });

  test("the same text twice reads the same: no pattern keeps a place between calls", () => {
    const text: string = "Call dana@example.com about 4111 1111 1111 1111";

    expect(redact(text)).toBe("Call [email] about [card number]");
    expect(redact(text)).toBe("Call [email] about [card number]");
  });
});

describe("a token, looked for once per run of its characters", () => {
  const jwt: string =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  test("is taken out where no ASCII word runs into it, and only there", () => {
    // After a "-" in a run: the run's text before it stays.
    expect(redact(`trace-${jwt}`)).toBe("trace-[token]");
    expect(redact(`req a-b-${jwt}.more`)).toBe("req a-b-[token].more");
    // From the first place in the run a token may start: the token from there holds the later one.
    expect(redact(`x-eyJab-${jwt}`)).toBe("x-[token]");
    // Glued to a word, no token starts: the agent keeps it too.
    expect(redact(`x${jwt}`)).toBe(`x${jwt}`);
    expect(redact(`_${jwt}`)).toBe(`_${jwt}`);
    // Each token of a line, and a segment of fewer than five characters is none.
    expect(redact(`${jwt} ${jwt}`)).toBe("[token] [token]");
    expect(redact(`a=${jwt};b=${jwt}`)).toBe("a=[token];b=[token]");
    expect(redact("eyJabcd.efghi.jklmn")).toBe("eyJabcd.efghi.jklmn");
    expect(redact("eyJabcde.efghi.jklmn")).toBe("[token]");
  });

  test("every match of a long text is replaced, and the text between them kept", () => {
    expect(redact("4111111111111111 x ".repeat(1000))).toBe(
      "[card number] x ".repeat(1000),
    );
    expect(redact("password=hunter2&".repeat(1000))).toBe(
      "password=[redacted]&".repeat(1000),
    );
    expect(redact("Bearer abcdefghijklmnop ".repeat(1000))).toBe(
      "Bearer [credential] ".repeat(1000),
    );
    expect(redact("1795076857467 ".repeat(1000))).toBe(
      "1795076857467 ".repeat(1000),
    );
    expect(
      redact(
        "a 4111111111111111, password=hunter2; Bearer abcdefghijklmnop a@b.io end",
      ),
    ).toBe(
      "a [card number], password=[redacted]; Bearer [credential] [email] end",
    );
  });

  test("a long run of a token's characters costs time in proportion to its length", () => {
    // Read once more from each "eyJ", these took seconds (TokenPatternsGuard).
    const texts: Array<string> = [
      "-eyJ-".repeat(40_000),
      "eyJab-".repeat(40_000),
      "eyJ".repeat(80_000),
    ];
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // No token is whole in any of them.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });
});

// The first of each script's ten decimal digits in Unicode's Basic Multilingual Plane, as the agent's RedactorTest lists them.
const DIGIT_ZEROS: ReadonlyArray<number> = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66,
  0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040,
  0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
  0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
  0xff10,
];

// The characters Android's \s takes (ICU's), which both copies write out.
const ANDROID_SPACES: ReadonlyArray<string> = [
  "\t",
  "\n",
  "\u000b",
  "\u000c",
  "\r",
  " ",
  "\u0085",
  "\u00a0",
  "\u1680",
  ...Array.from({ length: 11 }, (_value: unknown, index: number): string => {
    return String.fromCharCode(0x2000 + index);
  }),
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
];

// ASCII digits, and the spaces and dashes between them, written in the script whose zero is given.
function inScript(digits: string, zero: number): string {
  return Array.from(digits, (char: string): string => {
    return char >= "0" && char <= "9"
      ? String.fromCharCode(zero + char.charCodeAt(0) - 48)
      : char;
  }).join("");
}

// Each code point of the Basic Multilingual Plane, but the surrogates.
function basicMultilingualPlane(): Array<string> {
  const chars: Array<string> = [];

  for (let code: number = 0; code <= 0xffff; code++) {
    if (code < 0xd800 || code > 0xdfff) {
      chars.push(String.fromCharCode(code));
    }
  }

  return chars;
}

const hex: (char: string) => string = (char: string): string => {
  return `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
};

describe("a card number in another script's digits", () => {
  test("is taken out, as on the device (#10877)", () => {
    // Japanese text often writes a card number in fullwidth digits, Arabic and Persian text in their own.
    expect(redact("カード番号：４１１１ １１１１ １１１１ １１１１")).toBe(
      "カード番号：[card number]",
    );
    expect(redact("٤١١١١١١١١١١١١١١١")).toBe("[card number]");
    expect(redact("شماره کارت ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱ رد شد")).toBe(
      "شماره کارت [card number] رد شد",
    );
    expect(redact("کارت ۵۵۰۰ ۰۰۰۰ ۰۰۰۰ ۰۰۰۴")).toBe("کارت [card number]");
    expect(redact("कार्ड ४१११ ११११ ११११ ११११ अस्वीकृत")).toBe(
      "कार्ड [card number] अस्वीकृत",
    );
    expect(redact("বাতিল ৩৭৮২৮২২৪৬৩১০০০৫")).toBe("বাতিল [card number]");
    expect(redact("บัตร ๔๑๑๑๑๑๑๑๑๑๑๑๑๑๑๑ ถูกปฏิเสธ")).toBe(
      "บัตร [card number] ถูกปฏิเสธ",
    );
    expect(redact("ကတ် ၄၁၁၁၁၁၁၁၁၁၁၁၁၁၁၁")).toBe("ကတ် [card number]");
    expect(redact("កាត ៥៥០០ ០០០០ ០០០០ ០០០៤")).toBe("កាត [card number]");
    // Right against a letter, as an ASCII card is since #10835.
    expect(redact("卡号４１１１１１１１１１１１１１１１已拒绝")).toBe(
      "卡号[card number]已拒绝",
    );
    expect(redact("رقم البطاقة٤١١١١١١١١١١١١١١١مرفوض")).toBe(
      "رقم البطاقة[card number]مرفوض",
    );
  });

  test("is taken out in the digits of each script of the Basic Multilingual Plane", () => {
    for (const zero of DIGIT_ZEROS) {
      for (const card of [
        "4111111111111111",
        "5500 0000 0000 0004",
        "6011-1111-1111-1117",
        "378282246310005",
      ]) {
        const written: string = inScript(card, zero);

        expect({
          written,
          redacted: redact(`Card ${written} declined`),
        }).toEqual({ written, redacted: "Card [card number] declined" });
        expect({ written, redacted: redact(`卡号${written}已拒绝`) }).toEqual({
          written,
          redacted: "卡号[card number]已拒绝",
        });
      }

      // A number in the same digits that fails the Luhn check, or starts as a timestamp does, stays.
      for (const number of ["4111111111111112", "1795076857467"]) {
        expect(redact(inScript(number, zero))).toBe(inScript(number, zero));
      }
    }
  });

  test("each decimal digit of the Basic Multilingual Plane, as JavaScript's \\p{Nd} reads it, is read by its value", () => {
    const digit: RegExp = /^\p{Nd}$/u;
    const zeros: Array<number> = [];
    const misread: Array<string> = [];

    for (const char of basicMultilingualPlane()) {
      const code: number = char.charCodeAt(0);
      const isDigit: boolean = digit.test(char);

      // Each script's ten follow its zero, so a digit's value is how far it is from the first of its run.
      if (isDigit && !digit.test(String.fromCharCode(code - 1))) {
        zeros.push(code);
      }

      const value: number = isDigit ? code - zeros[zeros.length - 1]! : -1;

      // Fifteen digits and a last one: a card when the last reads as 1, whatever its script.
      if (
        AndroidAgentRedactor.looksLikeCardNumber(`411111111111111${char}`) !==
        (value === 1)
      ) {
        misread.push(hex(char));
      }
    }

    expect(misread).toEqual([]);
    expect(zeros).toEqual(DIGIT_ZEROS);
  });

  test("that is no card is kept", () => {
    for (const text of [
      // It fails the Luhn check, starts as a timestamp does, or is too short.
      "٤١١١١١١١١١١١١١١٢",
      "١٧٩٥٠٧٦٨٥٧٤٦٧",
      "٤١١١١١١١١١١١",
      // A digit of its own script beside it: a longer number.
      "٤١١١١١١١١١١١١١١١١١١١١",
      "٤١١١١١١١١١١١١١١١٤",
      "١٤١١١١١١١١١١١١١١١",
      // An ASCII letter, "_" or "." beside it: a word, or a decimal.
      "x٤١١١١١١١١١١١١١١١",
      "٤١١١١١١١١١١١١١١١x",
      "_٤١١١١١١١١١١١١١١١",
      "v1.٤١١١١١١١١١١١١١١١",
      "٤١١١١١١١١١١١١١١١.٥",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  test("beside a digit of another script is no part of it, and in mixed digits is read whole", () => {
    // A card is looked for in one script's digits first, as an ASCII card was (#10835).
    expect(redact("4111111111111111１２")).toBe("[card number]１２");
    expect(redact("１２4111111111111111")).toBe("１２[card number]");
    expect(redact("٤١١١١١١١١١١١١١١١12")).toBe("[card number]12");
    expect(redact("12٤١١١١١١١١١١١١١١١")).toBe("12[card number]");
    expect(redact("４１１１１１１１１１１１１１１１٣")).toBe("[card number]٣");
    expect(redact("٣4111111111111111")).toBe("٣[card number]");
    expect(redact("4111111111111111 ١٢/٢٥")).toBe("[card number] ١٢/٢٥");
    // Then, among the digits left, a number that mixes scripts: a Persian card typed with Arabic-Indic digits among its own.
    expect(redact("４１１１ 1111 1111 1111")).toBe("[card number]");
    expect(redact("4111 1111 1111 ١١١١")).toBe("[card number]");
    expect(redact("۴۱۱۱١١١١۱۱۱۱١١١١")).toBe("[card number]");
    expect(redact("۴١۱١۱١۱١۱١۱١۱١۱١")).toBe("[card number]");
    expect(redact("۵۵۰۰-٠٠٠٠-۰۰۰۰-٠٠٠٤")).toBe("[card number]");
    // Read whole, a mixed number with more digits is a longer one, and no card.
    expect(redact("١٢4111 1111 1111 ١١١١")).toBe("١٢4111 1111 1111 ١١١١");
  });

  test("beside another number is taken out", () => {
    expect(redact("٤١١١ ١١١١ ١١١١ ١١١١ ١٢/٢٥")).toBe("[card number] ١٢/٢٥");
    expect(redact("４１１１ １１１１ １１１１ １１１１ １２３")).toBe(
      "[card number] １２３",
    );
    expect(redact("１ ４１１１ １１１１ １１１１ １１１１")).toBe(
      "１ [card number]",
    );
    expect(redact("٤١١١ ١١١١ ١١١١ ١١١١ ٥٥٠٠ ٠٠٠٠ ٠٠٠٠ ٠٠٠٤")).toBe(
      "[card number] [card number]",
    );
    expect(redact("٤١١١ ١١١١ ١١١١ ١١١١ ١١١١ ١١١١")).toBe(
      "[card number] ١١١١ ١١١١",
    );
  });

  test("in digits beyond the Basic Multilingual Plane is left", () => {
    // Adlam's and the mathematical bold digits stay as they were, and an ASCII card beside one is taken out.
    const adlam: string = `\u{1e954}${"\u{1e951}".repeat(15)}`;
    const bold: string = `\u{1d7d2}${"\u{1d7cf}".repeat(15)}`;

    expect(redact(adlam)).toBe(adlam);
    expect(redact(bold)).toBe(bold);
    expect(redact("4111111111111111\u{1e951}")).toBe("[card number]\u{1e951}");
    expect(redact("\u{1e951}4111111111111111")).toBe("\u{1e951}[card number]");
  });
});

describe("an email address in any script", () => {
  test("is taken out whole, as on the device (#10878)", () => {
    for (const address of [
      "张伟@example.com",
      "josé@example.com",
      "josé.garcia@example.com",
      "müller@bücher.de",
      "user@例え.jp",
      "user@xn--r8jz45g.jp",
      "почта@пример.рф",
      "user@xn--e1afmkfd.xn--p1ai",
      "山田たろう@例え.jp",
      "δοκιμή@παράδειγμα.δοκιμή",
      "उपयोगकर्ता@उदाहरण.भारत",
      "用户123@example.com",
      "jose\u0301@example.com",
      "ｊａｎｅ@example.com",
    ]) {
      expect({ address, redacted: redact(address) }).toEqual({
        address,
        redacted: "[email]",
      });
      expect({
        address,
        redacted: redact(`Receipt sent to ${address}, thanks`),
      }).toEqual({ address, redacted: "Receipt sent to [email], thanks" });
    }

    // Whole: the name's first part was kept.
    expect(redact("Écrire à françois.dupont@exemple.fr")).toBe(
      "Écrire à [email]",
    );
    expect(redact("Отправлено на почта@пример.рф.")).toBe(
      "Отправлено на [email].",
    );
  });

  test("is taken out in its domain's Unicode form and in punycode alike", () => {
    for (const [unicode, punycode] of [
      ["例え.jp", "xn--r8jz45g.jp"],
      ["пример.рф", "xn--e1afmkfd.xn--p1ai"],
      ["bücher.de", "xn--bcher-kva.de"],
    ] as Array<[string, string]>) {
      for (const name of ["user", "张伟", "josé"]) {
        expect(redact(`${name}@${unicode}`)).toBe("[email]");
        expect(redact(`${name}@${punycode}`)).toBe("[email]");
      }
    }
  });

  test("beside a letter of another script is still no part of it", () => {
    expect(redact("邮箱jane@example.com")).toBe("邮箱[email]");
    expect(redact("Email张伟@example.com")).toBe("Email[email]");
    expect(redact("张伟@example.com已发送")).toBe("[email]已发送");
    expect(redact("用户@例え.jpに送信")).toBe("[email]に送信");
    expect(redact("이메일张伟@example.com으로")).toBe("[email]으로");
    /*
     * A name in the script of the word before it cannot be told from that word, and a top-level domain in another script
     * takes in the letters of its script written after it: more is taken out, not less.
     */
    expect(redact("邮件张伟@example.com")).toBe("[email]");
    expect(redact("jane@例子.中国已发送")).toBe("[email]");
  });

  test("that is no address is kept", () => {
    // No top-level domain, one of a letter, punycode with no letter, and an ASCII "_" or digit right after it.
    for (const text of [
      "张伟@localhost",
      "张伟@例え",
      "user@例え.j",
      "user@example.xn--4111",
      "张伟@example.com_x",
      "张伟@example.com7",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  test("beside a card takes no part of it", () => {
    // A card's last group is no address's name, nor its first group an address's top-level domain.
    expect(redact("4111 1111 1111 1111é@例え.jp")).toBe(
      "[card number]é@例え.jp",
    );
    expect(redact("4111 1111 1111 1111 user@例え.jp")).toBe(
      "[card number] [email]",
    );
    expect(redact("x@x.xn--4111 1111 1111 1111")).toBe("x@x.xn--[card number]");
    // A card in an address's name goes with the address.
    expect(redact("٤١١١١١١١١١١١١١١١@example.com")).toBe("[email]");
    // An ASCII address takes a card's last group as it did, and two addresses written as one are taken out whole.
    expect(redact("4111 1111 1111 1111@example.com")).toBe(
      "4111 1111 1111 [email]",
    );
    expect(redact("中@x.jane@example.com")).toBe("[email]");
  });
});

describe("a space", () => {
  test("is one of the characters Android's \\s takes, as on the device (#10876)", () => {
    expect(redact("令牌：Bearer\u3000abcdefghijklmnop")).toBe(
      "令牌：Bearer [credential]",
    );
    expect(redact("password=hunter2\u3000次の")).toBe(
      "password=[redacted]\u3000次の",
    );

    for (const space of ANDROID_SPACES) {
      expect({
        space: hex(space),
        redacted: [
          redact(`Bearer${space}abcdefghijklmnop`),
          redact(`password${space}=${space}hunter2`),
          redact(`password=hunter2${space}next`),
        ],
      }).toEqual({
        space: hex(space),
        redacted: [
          "Bearer [credential]",
          `password${space}=${space}[redacted]`,
          `password=[redacted]${space}next`,
        ],
      });
    }

    /*
     * None of these: the zero-width no-break space JavaScript's \s takes, a zero-width space, the Mongolian vowel
     * separator, and controls the JVM calls white space. A value runs on through each.
     */
    for (const other of [
      "\ufeff",
      "\u200b",
      "\u180e",
      "\u001c",
      "\u001f",
      "\u0000",
    ]) {
      expect({
        other: hex(other),
        redacted: [
          redact(`Bearer${other}abcdefghijklmnop`),
          redact(`password=hun${other}ter2`),
        ],
      }).toEqual({
        other: hex(other),
        redacted: [`Bearer${other}abcdefghijklmnop`, "password=[redacted]"],
      });
    }
  });

  test("is exactly one of those, which JavaScript's own \\s reads otherwise at U+0085 and U+FEFF alone", () => {
    const javaScriptSpace: RegExp = /^\s$/;
    const taken: Array<string> = [];
    const javaScriptSpaces: Array<string> = [];

    for (const char of basicMultilingualPlane()) {
      if (redact(`Bearer${char}abcdefghijklmnop`) === "Bearer [credential]") {
        taken.push(hex(char));
      }

      if (javaScriptSpace.test(char)) {
        javaScriptSpaces.push(hex(char));
      }
    }

    expect(taken).toEqual(ANDROID_SPACES.map(hex).sort());
    expect(
      [...taken, ...javaScriptSpaces]
        .filter((code: string): boolean => {
          return !(taken.includes(code) && javaScriptSpaces.includes(code));
        })
        .sort(),
    ).toEqual(["U+0085", "U+FEFF"]);
  });
});

// Each text's redaction, timed: the fastest of up to three attempts, as one timing on a busy runner is noisy.
function timedRedaction(texts: Array<string>): FastestRun<Array<string>> {
  return fastestRun({
    run: (): Array<string> => {
      return texts.map(redact);
    },
    limitInMs: 5_000,
  });
}

describe("a long run of another script's digits", () => {
  test("costs time in proportion to its length", () => {
    const redacted: FastestRun<Array<string>> = timedRedaction([
      // Each digit a place a card may start, inside a longer number of its own script.
      "٣".repeat(131_000),
      // Each a one-digit group, tried at seven lengths; scripts that change at each digit.
      "٣ ".repeat(65_000),
      "4٣".repeat(65_000),
      "１ ٣-".repeat(32_000),
      "٤١١١١١١١١١١١١١١٢ ".repeat(7_000),
    ]);

    // None of them holds a card.
    expect(redacted.result).toEqual([
      "٣".repeat(131_000),
      "٣ ".repeat(65_000),
      "4٣".repeat(65_000),
      "１ ٣-".repeat(32_000),
      "٤١١١١١١١١١١١١١١٢ ".repeat(7_000),
    ]);
    expect(redacted.inMs).toBeLessThan(5_000);
  });
});

describe("a long run of an address's characters, or of spaces", () => {
  test("costs time in proportion to its length", () => {
    const texts: Array<string> = [
      // A name that runs on too long before its "@".
      `${"٣".repeat(262_000)}@example.com`,
      // Names, labels and top-level domains in other scripts, and a long run of Latin letters before an "@".
      "张@".repeat(131_000),
      `${"é".repeat(262_000)}@example.com`,
      `a@${"例.".repeat(131_000)}`,
      `${"中".repeat(262_000)}@x.中国`,
      // A run of spaces between a scheme and no credential.
      `Bearer${"\u3000".repeat(262_000)}x`,
    ];
    const redacted: FastestRun<Array<string>> = timedRedaction(texts);

    // None of them holds an address or a credential.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });
});

/*
 * OneUptime's copy before #10876, #10877 and #10878: JavaScript's \s, a card
 * in ASCII digits and an address in ASCII alone, each pattern as it was.
 */
const BEFORE_JWT: RegExp =
  /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const BEFORE_AUTHORIZATION: RegExp =
  /(?<![A-Za-z0-9_])(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const BEFORE_SECRET_ASSIGNMENT: RegExp =
  /(?<![A-Za-z0-9_-])(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]}]+)/gi;
const BEFORE_EMAIL_ADDRESS: RegExp =
  /(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])/g;
const BEFORE_CARD_START: RegExp =
  /(?<![A-Za-z0-9_.])(?=([2-6](?:[ -]?[0-9]){12,18})(?![A-Za-z0-9_.]))/g;
const BEFORE_CARD_DIGITS: RegExp = /^[2-6][0-9]{12,18}$/;
// Two addresses written as one hold two "@".
const TWO_AT_SIGNS: RegExp = /@.*@/;

function beforeLooksLikeCardNumber(digits: string): boolean {
  if (!BEFORE_CARD_DIGITS.test(digits)) {
    return false;
  }

  let sum: number = 0;
  let double: boolean = false;

  for (let index: number = digits.length - 1; index >= 0; index--) {
    let digit: number = digits.charCodeAt(index) - 48;

    if (double) {
      digit *= 2;
      digit = digit > 9 ? digit - 9 : digit;
    }

    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

function beforeCardLength(run: string): number {
  const digits: string = run.replace(/[^0-9]/g, "");
  let end: number = run.length;
  let count: number = digits.length;

  while (count >= 13) {
    if (beforeLooksLikeCardNumber(digits.slice(0, count))) {
      return end;
    }

    const separator: number = Math.max(
      run.lastIndexOf(" ", end - 1),
      run.lastIndexOf("-", end - 1),
    );

    if (separator < 0) {
      return 0;
    }

    count -= end - separator - 1;
    end = separator;
  }

  return 0;
}

function before(text: string): string {
  let result: string = text.replace(BEFORE_JWT, "$1[token]");

  result = result.replace(
    BEFORE_AUTHORIZATION,
    (_match: string, scheme: string): string => {
      return `${scheme} [credential]`;
    },
  );
  result = result.replace(
    BEFORE_SECRET_ASSIGNMENT,
    (match: string, name: string, value: string): string => {
      if (
        !value ||
        (value.startsWith("[") && value.endsWith("]")) ||
        value === '"[redacted]"' ||
        ["bearer", "basic"].includes(value.toLowerCase())
      ) {
        return match;
      }

      const quote: string =
        value.length >= 2 && (value[0] === '"' || value[0] === "'")
          ? value[0]
          : "";

      return `${name}${quote}[redacted]${quote}`;
    },
  );
  result = result.replace(BEFORE_EMAIL_ADDRESS, "[email]");

  let cards: string = "";
  let last: number = 0;

  for (const match of result.matchAll(BEFORE_CARD_START)) {
    if (match.index < last) {
      continue;
    }

    const length: number = beforeCardLength(match[1] ?? "");

    if (length > 0) {
      cards += `${result.slice(last, match.index)}[card number]`;
      last = match.index + length;
    }
  }

  return last === 0 ? result : cards + result.slice(last);
}

describe("no secret OneUptime's copy took out before", () => {
  test("is kept, and an ASCII text reads as it did", () => {
    const secrets: Array<string> = [
      "4111111111111111",
      "4111 1111 1111 1111",
      "5500-0000-0000-0004",
      "378282246310005",
      "jane@example.com",
      "jane.doe+kiosk@example.co.uk",
      "Bearer abcdefghijklmnop",
      "basic dXNlcjpwYXNzd29yZA==",
      JWT,
      "password=hunter2",
      "api_key: sk_live_123",
      '"token": "abc123def"',
      "pin=1234",
      inScript("4111 1111 1111 1111", 0xff10),
      inScript("4111111111111111", 0x0660),
      inScript("5500-0000-0000-0004", 0x06f0),
      "４１１１ 1111 1111 1111",
      "张伟@example.com",
      "josé.garcia@example.com",
      "user@例え.jp",
      "почта@пример.рф",
      "Bearer\u3000abcdefghijklmnop",
      "password\u00a0=\u00a0hunter2",
    ];
    const neighbours: Array<string> = [
      "",
      " ",
      "x",
      "_",
      ".",
      "-",
      "=",
      "@",
      "12 ",
      " 12/25",
      "5",
      "中",
      "卡号",
      "已拒绝",
      "é",
      "\u0301",
      "\u200b",
      "\u0661",
      "\u06f4",
      "\uff11",
      "\u3000",
      "\u00a0",
      "\ufeff",
      "例え",
      "@例え.jp",
      "ü",
    ];
    const asciiNeighbours: Array<string> = neighbours.filter(
      (neighbour: string): boolean => {
        return Array.from(neighbour).every((char: string): boolean => {
          return char.charCodeAt(0) < 128;
        });
      },
    );
    const random: SeededRandom = seededRandom(10878);
    const draw: (pool: Array<string>) => string = (
      pool: Array<string>,
    ): string => {
      return Array.from({ length: 1 + random(2) }, (): string => {
        return pool[random(pool.length)]!;
      }).join("");
    };
    let ascii: number = 0;
    let newlyTakenOut: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      // A third of them ASCII alone.
      const pool: Array<string> =
        index % 3 === 0 ? asciiNeighbours : neighbours;
      const secret: string =
        secrets[random(index % 3 === 0 ? 13 : secrets.length)]!;
      const text: string = draw(pool) + secret + draw(pool);
      const now: string = redact(text);
      const then: string = before(text);

      // On ASCII text, as before: but for two addresses written as one, now taken out whole.
      if (index % 3 === 0 && !TWO_AT_SIGNS.test(text)) {
        ascii++;
        expect({ text, now }).toEqual({ text, now: then });
      }

      if (!then.includes(secret)) {
        expect({ text, now, kept: now.includes(secret) }).toEqual({
          text,
          now,
          kept: false,
        });
      } else if (!now.includes(secret)) {
        newlyTakenOut++;
      }
    }

    expect(ascii).toBeGreaterThan(5000);
    expect(newlyTakenOut).toBeGreaterThan(2000);
  });
});

// Each of the agent's patterns by its name: the first pattern after its `val NAME: Regex =`.
function agentPatterns(): Map<string, string> {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, AGENT_REDACTOR),
    "utf8",
  );
  const literals: Array<KotlinStringLiteral> = kotlinStringLiterals(
    text,
  ).filter((literal: KotlinStringLiteral): boolean => {
    return literal.isPattern;
  });
  const patterns: Map<string, string> = new Map<string, string>();

  for (const declaration of text.matchAll(
    /\bval\s+([A-Z_]+)\s*:\s*Regex\s*=/g,
  )) {
    const literal: KotlinStringLiteral | undefined = literals.find(
      (candidate: KotlinStringLiteral): boolean => {
        return candidate.start > declaration.index;
      },
    );

    if (literal) {
      patterns.set(declaration[1]!, literal.value);
    }
  }

  return patterns;
}

// Each of the server's patterns by its name, as written.
function serverPatterns(): Map<string, JavaScriptPattern> {
  const text: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, SERVER_REDACTOR),
    "utf8",
  );
  const source: ts.SourceFile = ts.createSourceFile(
    SERVER_REDACTOR,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const patterns: Map<string, JavaScriptPattern> = new Map<
    string,
    JavaScriptPattern
  >();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer?.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      const literal: string = node.initializer.getText(source);
      const end: number = literal.lastIndexOf("/");

      patterns.set(node.name.text, {
        source: literal.slice(1, end),
        flags: literal.slice(end + 1),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return patterns;
}

describe("its patterns", () => {
  test("are the agent's, as JavaScript writes them", () => {
    const agent: Map<string, string> = agentPatterns();
    const server: Map<string, JavaScriptPattern> = serverPatterns();

    expect([...agent.keys()].sort()).toEqual([
      "ASCII_EMAIL_ADDRESS",
      "AUTHORIZATION",
      "CARD_START",
      "EMAIL_ADDRESS",
      "JWT",
      "SECRET_ASSIGNMENT",
    ]);

    for (const [name, kotlin] of agent) {
      // The token's is written otherwise for each engine (Redactor.kt says why): the next test reads it.
      if (name === "JWT") {
        continue;
      }

      const caseInsensitive: boolean = kotlin.includes("(?i)");
      // Unicode's own classes (\p{Nd}, \p{L}) read alike on the three engines, and JavaScript reads them under the u flag alone.
      const unicode: boolean =
        kotlin.includes("\\p{") || kotlin.includes("\\P{");

      expect({
        name,
        source: server.get(name)?.source,
        caseInsensitive: server.get(name)?.flags.includes("i"),
        unicode: server.get(name)?.flags.includes("u"),
      }).toEqual({
        name,
        // Kotlin turns (?i) on in the pattern, after its look-behind, and JavaScript with a flag; ICU refuses a bare "}" in a class.
        source: kotlin.split("(?i)").join("").split("\\}").join("}"),
        caseInsensitive,
        unicode,
      });
    }
  });

  test("the agent's token pattern and the server's take out the same tokens", () => {
    const form: JavaScriptPattern = javaScriptForm(agentPatterns().get("JWT")!);
    const agent: RegExp = new RegExp(form.source, `${form.flags}g`);
    const server: RegExp = new RegExp(serverPatterns().get("JWT")!.source, "g");
    // A token's pieces more than once each, so that many texts hold one.
    const texts: Array<string> = generatedTexts(20000, 10835, [
      "eyJ",
      "eyJabcde",
      "eyJabcde",
      "-",
      "-eyJ",
      ".",
      ".abcde",
      ".abcde",
      "a",
      "abcde",
      "_",
      " ",
      "é",
      "中",
      "e\u0301",
      "\u200b",
      "\u017f",
      "eyJab-",
    ]);
    let withToken: number = 0;

    for (const text of texts) {
      const expected: string = text.replace(server, "$1[token]");

      if (expected !== text) {
        withToken++;
      }

      expect({ text, agent: text.replace(agent, "$1[token]") }).toEqual({
        text,
        agent: expected,
      });
    }

    expect(withToken).toBeGreaterThan(texts.length / 50);
  });
});
