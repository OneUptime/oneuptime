import {
  DrawnLine,
  drawLine,
  getBidiClass,
  getDrawnText,
  isDrawnAsWritten,
  ParagraphDirection,
} from "./BidiLayout";
import { describe, expect, test } from "@jest/globals";

/*
 * The test's copy of the bidi algorithm draws what the browser draws: the
 * cases below are the ones the locale guards lean on, each as UAX #9 lays
 * it out (and as Chromium draws it in the reading-direction E2E suite).
 */

const LRI: string = String.fromCharCode(0x2066);
const FSI: string = String.fromCharCode(0x2068);
const PDI: string = String.fromCharCode(0x2069);
const LRM: string = String.fromCharCode(0x200e);

// Whether `code`, where it first appears in `line`, is drawn as written.
const readsAsWritten: (
  line: string,
  code: string,
  direction?: ParagraphDirection,
) => boolean = (
  line: string,
  code: string,
  direction: ParagraphDirection = "rtl",
): boolean => {
  const from: number = line.indexOf(code);

  expect(from).toBeGreaterThanOrEqual(0);

  return isDrawnAsWritten(drawLine(line, direction), from, from + code.length);
};

describe("a character's bidi class", () => {
  test.each([
    ["a", "L"],
    ["Ж", "L"],
    ["ب", "AL"],
    ["پ", "AL"],
    ["א", "R"],
    ["7", "EN"],
    ["۴", "EN"],
    ["٤", "AN"],
    ["+", "ES"],
    ["-", "ES"],
    ["%", "ET"],
    ["$", "ET"],
    ["€", "ET"],
    ["/", "CS"],
    [".", "CS"],
    [":", "CS"],
    ["،", "CS"],
    ["(", "ON"],
    ["*", "ON"],
    ["«", "ON"],
    [" ", "WS"],
    ["\u{064E}", "NSM"],
    ["\u{200C}", "BN"],
    ["\u{200E}", "L"],
    ["\u{200F}", "R"],
    ["\u{2066}", "LRI"],
    ["\u{2068}", "FSI"],
    ["\u{2069}", "PDI"],
    // The Arabic letter mark, semicolon, question mark and Tatweel: N'Ko and Adlam use some too.
    ["\u{061C}", "AL"],
    ["\u{061B}", "AL"],
    ["\u{061F}", "AL"],
    ["\u{0640}", "AL"],
    // N'Ko's and Adlam's own letters are right-to-left ones.
    ["\u{07CA}", "R"],
    ["\u{1E900}", "R"],
  ])("%s is %s", (character: string, bidiClass: string) => {
    expect(getBidiClass(character)).toBe(bidiClass);
  });
});

describe("a line read from the right", () => {
  test("its words are drawn from the right, a Latin run from the left", () => {
    const line: DrawnLine = drawLine("abc ابج", "rtl");

    expect(getDrawnText(line)).toBe("جبا abc");
    expect(isDrawnAsWritten(line, 0, 3)).toBe(true);
  });

  test("a path's leading slash is drawn at its other end", () => {
    expect(getDrawnText(drawLine("قيمة /api/v1/users", "rtl"))).toBe(
      "api/v1/users/ ةميق",
    );
    expect(readsAsWritten("قيمة /api/v1/users", "/api/v1/users")).toBe(false);
  });

  test("a function's brackets, a flag's dashes and a sign before a number too", () => {
    expect(
      readsAsWritten(
        "باستخدام oneuptime.captureMetric().",
        "oneuptime.captureMetric()",
      ),
    ).toBe(false);
    expect(readsAsWritten("أضف --help إليه", "--help")).toBe(false);
    expect(readsAsWritten("مثلًا +1 555", "+1 555")).toBe(false);
    expect(readsAsWritten("في النهاية -2.", "-2")).toBe(false);
  });

  test("an expression that starts with a number is drawn back to front", () => {
    expect(readsAsWritten("مثلًا: 0 */18 * * *", "0 */18 * * *")).toBe(false);
    expect(readsAsWritten("تضم 2^64 عنوانًا", "2^64")).toBe(false);
  });

  test("what the bidi algorithm keeps together is drawn as written", () => {
    // Letters or digits at both ends.
    expect(readsAsWritten("استخدم Node.js هنا", "Node.js")).toBe(true);
    // A slash between two words of the code.
    expect(readsAsWritten("مثل GET /api/users)", "GET /api/users")).toBe(true);
    // Brackets round letters, after letters (N0).
    expect(
      readsAsWritten("استدعِ track('signup') عند", "track('signup')"),
    ).toBe(true);
    // A number with its common separators (W4).
    expect(readsAsWritten("مثل 192.168.1.0/24 هنا", "192.168.1.0/24")).toBe(
      true,
    );
  });

  test("after Arabic letters a number is an Arabic number (W2): its signs are the sentence's", () => {
    // Drawn "%99.9" and "1111-1111-4111": read from the right, in the sentence's order.
    expect(readsAsWritten("اكتمل 99.9% منها", "99.9%")).toBe(false);
    expect(readsAsWritten("الرقم 4111-1111-1111 هنا", "4111-1111-1111")).toBe(
      false,
    );
    // After Hebrew letters, or a Latin word, it stays a European number.
    expect(readsAsWritten("הושלם 99.9% מהם", "99.9%")).toBe(true);
    expect(
      readsAsWritten("البطاقة Visa 4111-1111-1111 هنا", "Visa 4111-1111-1111"),
    ).toBe(true);
  });

  test("after a Tatweel or an Arabic question mark too: they are Arabic letters to the algorithm", () => {
    expect(readsAsWritten("الـ 99.9% منها", "99.9%")).toBe(false);
    expect(readsAsWritten("لماذا؟ 99.9% منها", "99.9%")).toBe(false);
    expect(readsAsWritten("انتبه؛ 99.9% منها", "99.9%")).toBe(false);
  });

  test("two numbers with one separator between them are one number (W4), drawn as written", () => {
    // After Arabic letters they are Arabic numbers, and one slash or colon still joins them.
    expect(readsAsWritten("الأجهزة المتصلة: 3/5", "3/5")).toBe(true);
    expect(readsAsWritten("يبدأ عند 09:30 صباحًا", "09:30")).toBe(true);
    expect(readsAsWritten("دستگاه‌های متصل: ۳/۵", "۳/۵")).toBe(true);
    // A number sign joins a European number: after a right-to-left mark it stays one.
    expect(readsAsWritten("حادثه \u{200F}#۴۲", "#۴۲")).toBe(true);
    // After Arabic letters it does not: the sign is the sentence's, drawn after the number.
    expect(getDrawnText(drawLine("الحادثة #42", "rtl"))).toBe("42# ةثداحلا");
  });

  test("but each number set apart in an isolate of its own is cut off from its sign", () => {
    expect(
      getDrawnText(drawLine(`المتصلة: ${FSI}3${PDI}/${FSI}5${PDI}`, "rtl")),
    ).toBe("5/3 :ةلصتملا");
    expect(getDrawnText(drawLine(`حادثه \u{200F}#${FSI}۴۲${PDI}`, "rtl"))).toBe(
      "۴۲# هثداح",
    );
  });

  test("a left-to-right isolate draws what it holds as written", () => {
    for (const code of [
      "/api/v1/users",
      "oneuptime.captureMetric()",
      "--help",
      "+1 555",
      "0 */18 * * *",
    ]) {
      expect(readsAsWritten(`قيمة ${LRI}${code}${PDI}.`, code)).toBe(true);
    }
  });

  test("a value's isolate inside it keeps its own direction", () => {
    const line: string = `أرسل إلى ${LRI}${FSI}مرحبا${PDI}/otlp${PDI}، مع`;

    expect(readsAsWritten(line, "/otlp")).toBe(true);
    // The Arabic value reads from the right inside its own isolate.
    expect(readsAsWritten(line, "مرحبا")).toBe(false);
    expect(getDrawnText(drawLine(line, "rtl"))).toBe("عم ،ابحرم/otlp ىلإ لسرأ");
  });

  test("but a value's isolate on its own is a sign to the sentence", () => {
    // "{{url}}/otlp" with its value set apart: the value went to the other end.
    expect(
      readsAsWritten(`إلى ${FSI}https://x.example${PDI}/otlp، مع`, "/otlp"),
    ).toBe(false);
  });

  test("a mark placed by hand steadies the code after it", () => {
    expect(readsAsWritten(`أضف ${LRM}--help إليه`, "--help")).toBe(true);
  });
});

describe("a line read from the left", () => {
  test("code is drawn as written, Arabic words from the right", () => {
    const line: DrawnLine = drawLine("Use /api/v1 ابج now", "ltr");

    expect(getDrawnText(line)).toBe("Use /api/v1 جبا now");
    expect(isDrawnAsWritten(line, 4, 11)).toBe(true);
    expect(isDrawnAsWritten(line, 12, 15)).toBe(false);
  });
});
