import { describe, expect, test } from "@jest/globals";
import { DATA_TYPE_CATALOG } from "../../../Types/DataSecurity/DataTypeCatalog";
import { compileCustomDataType } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import {
  expandBackReferences,
  getDataTypePrefilter,
  MAX_PREFILTER_LENGTH,
  RE2_MAX_REPEAT,
  toRe2Prefilter,
} from "../../../Utils/DataSecurity/DetectorPrefilter";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";
import CharacterSet from "../../../Utils/LinearRegExp/CharacterSet";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

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

const PREFERRED: string =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function charactersOf(set: CharacterSet, negate: boolean): Array<string> {
  const has: (code: number) => boolean = (code: number): boolean => {
    return set.has(code) !== negate;
  };
  const preferred: Array<string> = PREFERRED.split("").filter(
    (character: string): boolean => {
      return has(character.charCodeAt(0));
    },
  );

  if (preferred.length > 0 && random(4) > 0) {
    return preferred;
  }

  const printable: Array<string> = [];

  for (let code: number = 0x20; code < 0x7f; code++) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  // A space JavaScript's \s knows and RE2's does not, now and then.
  for (const code of [0xa0, 0x2003, 0x3000]) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  return printable.length > 0 ? printable : preferred;
}

// A text the node could match: each choice drawn at random.
function draw(node: SyntaxNode): string {
  switch (node.kind) {
    case "Character":
      return String.fromCharCode(node.codeUnit);
    case "Set": {
      const characters: Array<string> = charactersOf(node.set, node.negate);

      return characters.length > 0
        ? characters[random(characters.length)]!
        : "";
    }
    case "Group":
      return draw(node.body);
    case "Repeat": {
      const most: number = Number.isFinite(node.max)
        ? Math.min(node.max, node.min + 6)
        : node.min + 6;
      const times: number = node.min + random(most - node.min + 1);
      let text: string = "";

      for (let index: number = 0; index < times; index++) {
        text += draw(node.body);
      }

      return text;
    }
    case "Alternation":
      return draw(node.options[random(node.options.length)]!);
    case "Sequence":
      return node.items.map(draw).join("");
    case "Lookaround":
      /*
       * What must come before or after - a card code's "cvv: ", a private
       * key's body after its header - is drawn too.
       */
      return node.negate ? "" : draw(node.body);
    default:
      return "";
  }
}

const CONTEXTS: ReadonlyArray<[string, string]> = [
  ["", ""],
  ["user=", " status=ok"],
  ["The value is ", "."],
  ['{"field":"', '"}'],
  ["token: ", "\n"],
];

/*
 * Texts the detector's pattern finds a candidate in: drawn from the
 * pattern - its back-references copied, so a separator may differ - put in
 * a few contexts, and kept only where the pattern itself matches.
 */
function positivesOf(detector: DataTypeDetector, count: number): Array<string> {
  const pattern: RegExp = new RegExp(
    detector.pattern.source,
    detector.pattern.flags.replace("g", ""),
  );
  const root: SyntaxNode = parsePattern(
    expandBackReferences(detector.pattern.source),
    {
      ignoreCase: detector.pattern.flags.includes("i"),
      multiline: detector.pattern.flags.includes("m"),
      dotAll: detector.pattern.flags.includes("s"),
    },
  ).root;
  const texts: Array<string> = [];

  for (let attempt: number = 0; attempt < count * 8; attempt++) {
    if (texts.length >= count) {
      break;
    }

    const [before, after] = CONTEXTS[attempt % CONTEXTS.length]!;
    const text: string = before + draw(root) + after;

    if (pattern.test(text)) {
      texts.push(text);
    }
  }

  return texts;
}

describe("every built-in detector", () => {
  test("is written for RE2, in RE2's syntax, within the length a search takes", () => {
    const refused: Array<string> = [];

    for (const detector of BUILT_IN_DETECTORS) {
      const expression: string | null = toRe2Prefilter(
        detector.pattern.source,
        detector.pattern.flags,
      );

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
      const expression: RegExp = asJavaScript(
        toRe2Prefilter(detector.pattern.source, detector.pattern.flags)!,
      );
      const positives: Array<string> = positivesOf(detector, 40);

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
