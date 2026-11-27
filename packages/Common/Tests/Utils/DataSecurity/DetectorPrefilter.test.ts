import { describe, expect, test } from "@jest/globals";
import { DATA_TYPE_CATALOG } from "../../../Types/DataSecurity/DataTypeCatalog";
import { compileCustomDataType } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import {
  DIGIT_OF_EVERY_SCRIPT_PREFILTER,
  expandBackReferences,
  getDataTypePrefilter,
  getDetectorPrefilter,
  MAX_PREFILTER_LENGTH,
  PERCENT_ESCAPE_PREFILTER,
  RE2_MAX_REPEAT,
  toRe2Prefilter,
} from "../../../Utils/DataSecurity/DetectorPrefilter";
import {
  findSensitiveValues,
  ScanDetector,
} from "../../../Utils/DataSecurity/TextScanner";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { positivesOf } from "./DetectorPositives";

/*
 * A DATA TYPE'S PATTERNS, FOR THE DATABASE TO NARROW A SEARCH BY (issue
 * #9549).
 *
 * The records a telemetry finding was seen in are looked for in ClickHouse,
 * which runs RE2: the search hands over only records whose value could hold
 * the finding's type, and each is still checked with the detector. So the
 * expression must match at least what the detector's pattern does - a
 * record it misses is a record nobody is shown.
 *
 * Proved here as a property of every built-in detector: texts drawn from
 * the detector's own pattern, kept only where the pattern finds a
 * candidate, are matched by the expression too. The expression is run as
 * JavaScript with the u flag - RE2's \x{...} written as \u{...}, RE2's
 * (?i:...) a modifier group - and is held to the syntax RE2 takes.
 */

const random: SeededRandom = seededRandom(9549);

// What the writer may put in an expression: RE2's syntax, nothing of JavaScript's own.
const RE2_TOKEN: RegExp =
  /\\x\{[0-9A-F]{1,6}\}|\(\?(?:i|-i|s):|\(\?:|[()|*+?^\]\-[]|\{\d+(?:,\d*)?\}|[A-Za-z0-9.]/y;

function isRe2Syntax(expression: string): boolean {
  RE2_TOKEN.lastIndex = 0;

  while (RE2_TOKEN.lastIndex < expression.length) {
    const before: number = RE2_TOKEN.lastIndex;

    if (!RE2_TOKEN.test(expression) || RE2_TOKEN.lastIndex === before) {
      return false;
    }
  }

  return true;
}

// An RE2 expression the writer made, run as JavaScript.
function asJavaScript(expression: string): RegExp {
  return new RegExp(expression.replace(/\\x\{/g, "\\u{"), "u");
}

describe("every built-in detector", () => {
  test("is written for RE2, in RE2's syntax, within the length a search takes", () => {
    const refused: Array<string> = [];

    for (const detector of BUILT_IN_DETECTORS) {
      // Its own expression, for a pattern of Unicode classes (the u flag).
      const expression: string | null = getDetectorPrefilter(detector);

      if (!expression) {
        refused.push(`${detector.dataTypeId}: /${detector.pattern.source}/`);
        continue;
      }

      expect([detector.dataTypeId, isRe2Syntax(expression)]).toEqual([
        detector.dataTypeId,
        true,
      ]);
      expect(expression.length).toBeLessThanOrEqual(MAX_PREFILTER_LENGTH);
      // Not one look-around, back-reference or JavaScript escape is left.
      expect(expression).not.toMatch(/\(\?<?[=!]|\\[1-9]|\\k<|\\[sSdDwWbBu]/);
    }

    expect(refused).toEqual([]);
  });

  test("matches every text the detector's own pattern finds a candidate in", () => {
    let checked: number = 0;

    for (const detector of BUILT_IN_DETECTORS) {
      const expression: RegExp = asJavaScript(getDetectorPrefilter(detector)!);
      const positives: Array<string> = positivesOf(detector, 40, random);

      // Each detector's pattern is drawn from often enough to say something.
      expect([detector.dataTypeId, positives.length > 0]).toEqual([
        detector.dataTypeId,
        true,
      ]);

      for (const text of positives) {
        expect([detector.dataTypeId, text, expression.test(text)]).toEqual([
          detector.dataTypeId,
          text,
          true,
        ]);
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(BUILT_IN_DETECTORS.length * 10);
  });

  test("narrows: a type's expression does not match text with nothing of it", () => {
    const plain: string =
      "GET /health returned 200 in 12ms for the checkout service";

    for (const dataTypeId of [
      "email-address",
      "credit-card-number",
      "ip-address",
      "github-token",
      "aws-access-key-id",
    ]) {
      const expression: string | null = getDataTypePrefilter({ dataTypeId });

      expect([dataTypeId, asJavaScript(expression!).test(plain)]).toEqual([
        dataTypeId,
        false,
      ]);
    }
  });

  test("every data type found by value has an expression", () => {
    const missing: Array<string> = DATA_TYPE_CATALOG.filter(
      (info: { id: string }): boolean => {
        return (
          getBuiltInDetectorsOf(info.id).length > 0 &&
          getDataTypePrefilter({ dataTypeId: info.id }) === null
        );
      },
    ).map((info: { id: string }): string => {
      return info.id;
    });

    expect(missing).toEqual([]);
  });
});

describe("how a pattern is written for RE2", () => {
  test("a negative look-around is left out: it only ever narrows a match", () => {
    expect(toRe2Prefilter("(?<![0-9])[0-9]{4}(?![0-9])", "g")).toBe(
      "(?:[\\x{30}-\\x{39}]){4}",
    );
  });

  test("a look-behind at the start and a look-ahead at the end are read as part of the match", () => {
    const expression: string = toRe2Prefilter("(?<=key=)[a-z]{2}(?=;)", "g")!;

    expect(expression).toBe(
      "(?:key\\x{3D})(?:[\\x{61}-\\x{7A}]){2}(?:\\x{3B})",
    );
    expect(asJavaScript(expression).test("x key=ab; y")).toBe(true);
    expect(asJavaScript(expression).test("x ab; y")).toBe(false);

    // A card code narrows by its words, not by any three digits.
    const code: RegExp = asJavaScript(
      getDataTypePrefilter({ dataTypeId: "card-verification-code" })!,
    );

    expect(code.test('{"cvv": "123"}')).toBe(true);
    expect(code.test("Card Security Code: 4321")).toBe(true);
    expect(code.test("took 123 ms")).toBe(false);
  });

  test("a look-around anywhere else, or a second one at the same edge, is left out", () => {
    // Read in the middle it would overlap what is around it.
    expect(toRe2Prefilter("x(?<=x)y(?=y)z", "g")).toBe("xyz");
    // Two look-behinds end where the match starts: only one is read.
    expect(toRe2Prefilter("(?<=a)(?<=b)c", "g")).toBe("(?:a)c");
    // A whole pattern of look-arounds matches the empty text, and is none.
    expect(toRe2Prefilter("(?<=a)(?=b)", "g")).toBe(null);
  });

  test("^, $, \\b and \\B are left out", () => {
    expect(toRe2Prefilter("^\\bab\\B$", "g")).toBe("ab");
  });

  test("JavaScript's \\s is written out whole: RE2's knows no Unicode space", () => {
    const expression: string = toRe2Prefilter("a\\sb", "g")!;

    expect(expression).toContain("\\x{A0}");
    expect(expression).toContain("\\x{3000}");
    expect(expression).toContain("\\x{FEFF}");
    expect(asJavaScript(expression).test("a b")).toBe(true);
    expect(asJavaScript(expression).test("a　b")).toBe(true);
  });

  test("a back-reference is an optional copy of the group it names", () => {
    expect(expandBackReferences("([ -])[0-9]\\1[0-9]")).toBe(
      "([ -])[0-9](?:[ -])?[0-9]",
    );
    expect(expandBackReferences("(?<sep>[.:])x\\k<sep>y")).toBe(
      "(?<sep>[.:])x(?:[.:])?y",
    );
    // In a class, \1 is no back-reference; a number past the groups is none.
    expect(expandBackReferences("(a)[\\1]\\5")).toBe("(a)[\\1]\\5");

    const card: string = toRe2Prefilter(
      "(?<![0-9])[0-9]{4}([ -])[0-9]{4}\\1[0-9]{4}(?![0-9])",
      "g",
    )!;

    expect(asJavaScript(card).test("4539 1488 0343")).toBe(true);
    // The copy matches any separator the group could, or none.
    expect(asJavaScript(card).test("4539 1488-0343")).toBe(true);
    expect(asJavaScript(card).test("4539 14880343")).toBe(true);
    // The group itself still takes one.
    expect(asJavaScript(card).test("453914880343")).toBe(false);
  });

  test("a repeat past RE2's limit has no upper bound, and its lower bound is RE2's most", () => {
    expect(toRe2Prefilter("a{1,2000}", "g")).toBe("(?:a)+");
    expect(toRe2Prefilter("a{1500,1600}", "g")).toBe(
      `(?:a){${RE2_MAX_REPEAT},}`,
    );
    expect(toRe2Prefilter("a{2,5}?b*?c+", "g")).toBe("(?:a){2,5}(?:b)*(?:c)+");
  });

  test("case-insensitivity is RE2's (?i), for the whole pattern or a part", () => {
    expect(toRe2Prefilter("secret", "gi")).toBe("(?i:secret)");
    expect(toRe2Prefilter("a(?i:b)c", "g")).toBe("a(?i:b)c");
    expect(asJavaScript(toRe2Prefilter("secret", "gi")!).test("SeCrEt")).toBe(
      true,
    );
  });

  test("a character beyond U+FFFF is one code point; a lone surrogate any of them", () => {
    expect(toRe2Prefilter("x😀", "g")).toBe("x\\x{1F600}");
    expect(toRe2Prefilter("x\\ud83d", "g")).toBe("x[\\x{10000}-\\x{10FFFF}]");
    expect(asJavaScript(toRe2Prefilter(".", "g")!).test("\u{1F600}")).toBe(
      true,
    );
  });

  test("a negated class takes everything beyond U+FFFF too", () => {
    const expression: string = toRe2Prefilter("[^a-z]", "g")!;

    expect(expression).toBe("[^\\x{61}-\\x{7A}]");
    expect(asJavaScript(expression).test("\u{1F600}")).toBe(true);
  });

  test("what cannot be written - a u or v flag, a pattern that is none, one that matches the empty text - gives none", () => {
    expect(toRe2Prefilter("a", "gu")).toBe(null);
    expect(toRe2Prefilter("a", "gv")).toBe(null);
    expect(toRe2Prefilter("(", "g")).toBe(null);
    expect(toRe2Prefilter("a?", "g")).toBe(null);
    expect(toRe2Prefilter("(?=abc)", "g")).toBe(null);
    expect(toRe2Prefilter("(?:a|)", "g")).toBe(null);
    expect(toRe2Prefilter("[]x", "g")).toBe(null);
  });

  test("an expression longer than a search takes gives none", () => {
    // Each "-" is written \x{2D}: eight characters an option.
    expect(toRe2Prefilter(`(?:${"a-|".repeat(5000)}c)`, "g")).toBe(null);
    expect(toRe2Prefilter(`(?:${"a-|".repeat(100)}c)`, "g")).not.toBe(null);
  });
});

describe("a data type's expression", () => {
  test("is every one of its detectors', any of them", () => {
    const phone: string = getDataTypePrefilter({
      dataTypeId: "phone-number",
    })!;
    const detectors: ReadonlyArray<DataTypeDetector> =
      getBuiltInDetectorsOf("phone-number");

    expect(detectors.length).toBeGreaterThan(1);

    for (const detector of detectors) {
      expect(phone).toContain(
        toRe2Prefilter(detector.pattern.source, detector.pattern.flags)!,
      );
    }

    expect(asJavaScript(phone).test("Call +44 20 7946 0958 now")).toBe(true);
    expect(asJavaScript(phone).test("Call (212) 555-0147 now")).toBe(true);
  });

  /*
   * #10467: the IP address detectors read a text with its percent-escapes
   * read too, so an address in an encoded URL is found though its colons
   * are written %3A. A search narrowed by the patterns alone would never
   * hand such a record over - not to Show the records it was seen in, not
   * to a scrub rule's proof - so the expression takes a text holding an
   * escape too.
   */
  test("a type whose detectors read percent-encoded text also takes a text holding an escape (#10467)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "ip-address",
    })!;
    const encoded: Array<string> = [
      "target=http%3A%2F%2F%5B2001%3Adb8%3A%3A1%5D%2F",
      "u=http%3a%2f%2f%5b2606%3a4700%3a%3a1111%5d",
      "u=8%2E8%2E8%2E8",
      "u=%38%2E%38%2E%38%2E%38",
      "u=%32%30%30%31%3A%3A%31",
      "to%3Dhttp%253A%252F%252F%255B2606%253A%253A1%255D",
      "peer=%3A%3Affff%3A8.8.8.8",
    ];

    expect(isRe2Syntax(expression)).toBe(true);
    expect(expression).toContain(PERCENT_ESCAPE_PREFILTER);

    for (const text of encoded) {
      // The detectors find an address in it, and the expression takes it.
      expect([
        text,
        findSensitiveValues(text, {
          detectors: getBuiltInDetectorsOf("ip-address"),
        }).length > 0,
        asJavaScript(expression).test(text),
      ]).toEqual([text, true, true]);
    }

    // Still narrows: no address, no escape.
    expect(
      asJavaScript(expression).test(
        "GET /health returned 200 in 12ms for the checkout service",
      ),
    ).toBe(false);
    // An escape of a byte beyond ASCII is one the reading reads, as UTF-8 (#11032).
    expect(asJavaScript(PERCENT_ESCAPE_PREFILTER).test("caf%C3%A9")).toBe(true);
    expect(asJavaScript(PERCENT_ESCAPE_PREFILTER).test("%EF%BC%94")).toBe(true);
    expect(asJavaScript(PERCENT_ESCAPE_PREFILTER).test("cpu 100% busy")).toBe(
      false,
    );
    expect(asJavaScript(PERCENT_ESCAPE_PREFILTER).test("%zz %g1 x%4")).toBe(
      false,
    );
  });

  test("a text whose only escapes spell a character beyond ASCII is taken: what the reading finds there, the search hands over (#11032)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "email-address",
    })!;
    const text: string = "/signup?email=jos%C3%A9%40example.com";

    expect(
      findSensitiveValues(text, {
        detectors: getBuiltInDetectorsOf("email-address"),
      }).length,
    ).toBeGreaterThan(0);
    expect(asJavaScript(expression).test(text)).toBe(true);
  });

  /*
   * #10935: the email detectors read percent-encoded text too, so the type
   * takes a text holding an escape, as the IP address type does. #10960:
   * one of them reads an address in any script, which the database cannot
   * read with JavaScript's Unicode classes, so it narrows by its own
   * expression: an "@" beside a character beyond ASCII.
   */
  test("the email address type takes an encoded address and one in any script (#10935, #10960)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "email-address",
    })!;

    expect(isRe2Syntax(expression)).toBe(true);
    expect(expression).toContain(PERCENT_ESCAPE_PREFILTER);
    expect(expression.length).toBeLessThanOrEqual(MAX_PREFILTER_LENGTH);

    for (const text of [
      "GET /signup?email=jane.doe%40acmecorp.io HTTP/1.1",
      "u=Jane.Doe%2Bnews%40AcmeCorp.io",
      "next=%2Fsignup%3Femail%3Djane%2540acmecorp.io",
      "email 张伟@acmecorp.io",
      "email josé.garcía@acmecorp.io",
      "email user@例え.jp",
      "email почта@пример.рф",
      "email user@пример.xn--p1ai",
      "邮箱jane@acmecorp.io已发送",
    ]) {
      expect([
        text,
        findSensitiveValues(text, {
          detectors: getBuiltInDetectorsOf("email-address"),
        }).length > 0,
        asJavaScript(expression).test(text),
      ]).toEqual([text, true, true]);
    }

    // Still narrows: no address, no escape, no "@" beside another script.
    expect(
      asJavaScript(expression).test(
        "GET /health returned 200 in 12ms for the checkout service",
      ),
    ).toBe(false);
    expect(asJavaScript(expression).test("用户 已登录 @ 12:00")).toBe(false);
  });

  /*
   * #10960: the card detectors read every script's digits by their values,
   * so a card in fullwidth, Arabic-Indic or Persian digits holds no ASCII
   * digit the patterns' expressions read: the type takes a text holding a
   * digit of another script too.
   */
  test("the card number type takes a card in any script's digits (#10960)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "credit-card-number",
    })!;

    expect(isRe2Syntax(expression)).toBe(true);
    expect(expression).toContain(DIGIT_OF_EVERY_SCRIPT_PREFILTER);
    // And one in a URL, with %20 between its groups (#11199).
    expect(expression).toContain(PERCENT_ESCAPE_PREFILTER);

    for (const text of [
      "カード番号：４１１１ １１１１ １１１１ １１１１",
      "رقم البطاقة ٤١١١١١١١١١١١١١١١",
      "شماره کارت ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱",
      "card ４１１１ 1111 1111 1111",
      "कार्ड ४१११ ११११ ११११ ११११",
    ]) {
      expect([
        text,
        findSensitiveValues(text, {
          detectors: getBuiltInDetectorsOf("credit-card-number"),
        }).length > 0,
        asJavaScript(expression).test(text),
      ]).toEqual([text, true, true]);
    }

    // Every digit of the 36 scripts beyond ASCII, and no ASCII one.
    const digit: RegExp = asJavaScript(DIGIT_OF_EVERY_SCRIPT_PREFILTER);

    expect(digit.test("0123456789")).toBe(false);
    expect(digit.test("x")).toBe(false);

    for (const zero of [0x0660, 0x06f0, 0x0966, 0x0e50, 0xff10]) {
      for (let value: number = 0; value < 10; value++) {
        expect(digit.test(String.fromCharCode(zero + value))).toBe(true);
      }
    }

    expect(
      asJavaScript(expression).test(
        "GET /health returned 200 in 12ms for the checkout service",
      ),
    ).toBe(false);
  });

  test("a secret's type takes a text holding an escape: a token after an encoded = (#11031)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "github-token",
    })!;
    const token: string = ["ghp", "Zx8Kq2Lm9Pw4Rt6Hy3Nc8Vb5Jm1Df7Gs0AeQ"].join(
      "_",
    );
    const text: string = `/login?next=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3D${token}`;

    expect(expression.includes(PERCENT_ESCAPE_PREFILTER)).toBe(true);
    expect(asJavaScript(expression).test(text)).toBe(true);
    expect(
      findSensitiveValues(text, {
        detectors: getBuiltInDetectorsOf("github-token"),
      }).length,
    ).toBe(1);
  });

  /*
   * #11199: a detector of a value written in groups reads a text as a URL's
   * query string reads it, a "+" for a space - card=4111+1111+1111+1111 -
   * so the search must hand such a record over too: its pattern's
   * expression takes a "+" wherever it takes a space. Proved for every
   * such detector, with texts drawn from its own pattern, their spaces
   * written "+", that it finds a candidate in.
   */
  test("a type whose detectors read a query string's '+'s takes a value written with them (#11199)", () => {
    const plusReaders: Array<DataTypeDetector> = BUILT_IN_DETECTORS.filter(
      (detector: DataTypeDetector): boolean => {
        return detector.readsPlusAsSpace === true;
      },
    );
    let checked: number = 0;

    expect(plusReaders.length).toBeGreaterThan(60);

    for (const detector of plusReaders) {
      // A detector that reads "+"s reads escapes too: %20 between its groups.
      expect([detector.dataTypeId, detector.readsPercentEncoded]).toEqual([
        detector.dataTypeId,
        true,
      ]);

      const expression: RegExp = asJavaScript(
        getDataTypePrefilter({ dataTypeId: detector.dataTypeId })!,
      );

      for (const text of positivesOf(detector, 30, random)) {
        const written: string = text.replace(
          /(?<=[A-Za-z0-9)]) (?=[A-Za-z0-9(])/g,
          "+",
        );

        if (written === text) {
          continue;
        }

        const found: boolean =
          findSensitiveValues(written, {
            detectors: [detector],
            hintedDataTypeIds: new Set([detector.dataTypeId]),
          }).length > 0;

        if (found) {
          expect([
            detector.dataTypeId,
            written,
            expression.test(written),
          ]).toEqual([detector.dataTypeId, written, true]);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
  });

  test("the card number type takes a card typed into a form, and still narrows past a timestamp's '+' (#11199)", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "credit-card-number",
    })!;

    expect(isRe2Syntax(expression)).toBe(true);

    for (const text of [
      "GET /pay?card=4539+1488+0343+6467&step=2",
      "GET /pay?card=3782+822463+10005",
      "GET /pay?card=4539%201488%200343%206467",
    ]) {
      expect([text, asJavaScript(expression).test(text)]).toEqual([text, true]);
    }

    // A "+" alone - a time zone's offset, a sum - is no card's.
    for (const text of [
      "2026-11-27T10:15:02+00:00 INFO GET /health returned 200 in 12ms",
      "computed 2+2 and C++ in 12ms",
    ]) {
      expect([text, asJavaScript(expression).test(text)]).toEqual([
        text,
        false,
      ]);
    }
  });

  test("a '+' is taken where a pattern takes a space, and only there", () => {
    const withPlus: RegExp = asJavaScript(
      toRe2Prefilter("[0-9]{4} [0-9]{4}", "g", { plusAsSpace: true })!,
    );
    const negated: RegExp = asJavaScript(
      toRe2Prefilter("a[^x]b", "g", { plusAsSpace: true })!,
    );
    const asWritten: RegExp = asJavaScript(
      toRe2Prefilter("[0-9]{4} [0-9]{4}", "g")!,
    );

    expect(withPlus.test("4111+1111")).toBe(true);
    expect(withPlus.test("4111 1111")).toBe(true);
    expect(withPlus.test("4111-1111")).toBe(false);
    expect(asWritten.test("4111+1111")).toBe(false);
    // A class that takes a space takes a "+" too, even one written [^...].
    expect(negated.test("a+b")).toBe(true);
    expect(
      asJavaScript(toRe2Prefilter("a[^ +]b", "g", { plusAsSpace: true })!).test(
        "a+b",
      ),
    ).toBe(false);
    expect(
      asJavaScript(toRe2Prefilter("a\\sb", "g", { plusAsSpace: true })!).test(
        "a+b",
      ),
    ).toBe(true);
    // A pattern that takes no space takes no "+".
    expect(
      asJavaScript(
        toRe2Prefilter("[0-9]{8}", "g", { plusAsSpace: true })!,
      ).test("4111+1111"),
    ).toBe(false);
  });

  test("a type whose detectors read only what is written takes no escape alone", () => {
    for (const dataTypeId of ["mac-address", "bitcoin-address"]) {
      const expression: string = getDataTypePrefilter({ dataTypeId })!;

      expect([
        dataTypeId,
        expression.includes(PERCENT_ESCAPE_PREFILTER),
      ]).toEqual([dataTypeId, false]);
      expect([dataTypeId, asJavaScript(expression).test("a%20b%3Ac")]).toEqual([
        dataTypeId,
        false,
      ]);
    }
  });

  test("a project's own type is narrowed by the pattern the project wrote", () => {
    const employee: ScanDetector | null = compileCustomDataType({
      dataTypeId: "custom:employee",
      pattern: "EMP-[0-9]{6}",
      ignoreCase: true,
    });
    const expression: string | null = getDataTypePrefilter({
      dataTypeId: "custom:employee",
      customDetectors: [employee!],
    });

    expect(expression).toBe("(?i:EMP\\x{2D}(?:[\\x{30}-\\x{39}]){6})");
    expect(asJavaScript(expression!).test("staff emp-123456 joined")).toBe(
      true,
    );
    expect(asJavaScript(expression!).test("staff EMP-12 joined")).toBe(false);
  });

  test("a type with no detector, or one that cannot be written, has none", () => {
    expect(getDataTypePrefilter({ dataTypeId: "person-name" })).toBe(null);
    expect(getDataTypePrefilter({ dataTypeId: "custom:missing" })).toBe(null);
    expect(
      getDataTypePrefilter({
        dataTypeId: "custom:opaque",
        customDetectors: [
          {
            dataTypeId: "custom:opaque",
            findCandidates: (): Array<{
              start: number;
              end: number;
              value: string;
            }> => {
              return [];
            },
            confidenceWithoutContext: "Low",
            specificity: 1,
          } as unknown as ScanDetector,
        ],
      }),
    ).toBe(null);
  });
});
