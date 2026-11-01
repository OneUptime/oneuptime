import { describe, expect, test } from "@jest/globals";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
} from "../../../Types/DataSecurity/ComplianceFramework";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  isPersonalDataCategory,
} from "../../../Types/DataSecurity/DataCategory";
import { ALL_DATA_CONFIDENCES } from "../../../Types/DataSecurity/DataConfidence";
import DataSensitivity, {
  ALL_DATA_SENSITIVITIES,
} from "../../../Types/DataSecurity/DataSensitivity";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
  getBuiltInDataType,
  isBuiltInDataType,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import { splitFieldName } from "../../../Utils/DataSecurity/FieldNameHints";
import {
  WINDOW_LEAD,
  WINDOW_OVERLAP,
} from "../../../Utils/DataSecurity/TextScanner";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";

/*
 * THE GUARD OVER EVERY DETECTOR AND EVERY DATA TYPE.
 *
 * Whoever adds a type or a detector - a country's ID, a provider's token -
 * gets these rules checked without writing a line: every type found by
 * value has a detector and every detector a type; every pattern is global,
 * bounded (no +, * or {n,}, so V8's backtracking stays shallow on
 * megabyte-long values, AGENTS.md "Megabyte-long values"), refers back to
 * no group but where it is allowed here, stands apart from longer tokens,
 * and says how sure it is; and every catalog entry is described, valid and
 * findable by the names it hints at.
 */

const BRACE_QUANTIFIER: RegExp = /^\{([0-9]+)(,([0-9]*))?\}/;
const TWO_CAPITALS: RegExp = /^[A-Z]{2}$/;
const ENDS_WITH_LOOKAHEAD: RegExp = /\(\?![^()]*\)$/;
const KEBAB_CASE: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOWER_CASE_WORDS: RegExp = /^[a-z0-9]+(?: [a-z0-9]+)*$/;

interface QuantifierProblems {
  // The unbounded quantifiers, as "position:quantifier".
  unbounded: Array<string>;
  // Where a back-reference (\1, \k<name>) sits.
  backReferences: Array<number>;
}

/*
 * Reads a pattern's source the way the engine does - an escaped character
 * is a literal, a character class is one atom whatever it holds - and lists
 * its unbounded quantifiers and back-references.
 */
function quantifierProblems(source: string): QuantifierProblems {
  const problems: QuantifierProblems = { unbounded: [], backReferences: [] };
  let inClass: boolean = false;

  for (let index: number = 0; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "\\") {
      const next: string = source[index + 1] || "";

      if (
        !inClass &&
        ((next >= "1" && next <= "9") ||
          (next === "k" && source[index + 2] === "<"))
      ) {
        problems.backReferences.push(index);
      }

      // \u{...}, \p{...} and \P{...} carry braces that are no quantifier.
      if (
        (next === "u" || next === "p" || next === "P") &&
        source[index + 2] === "{"
      ) {
        index = source.indexOf("}", index + 2);
        continue;
      }

      index++;
      continue;
    }

    if (inClass) {
      if (character === "]") {
        inClass = false;
      }

      continue;
    }

    if (character === "[") {
      inClass = true;
      continue;
    }

    if (character === "+" || character === "*") {
      problems.unbounded.push(`${index}:${character}`);
      continue;
    }

    if (character === "{") {
      const quantifier: RegExpExecArray | null = BRACE_QUANTIFIER.exec(
        source.slice(index),
      );

      if (quantifier) {
        if (quantifier[2] !== undefined && quantifier[3] === "") {
          problems.unbounded.push(`${index}:${quantifier[0]}`);
        }

        index += quantifier[0].length - 1;
      }
    }
  }

  return problems;
}

/*
 * The detectors allowed to refer back to a group, and why. A back-reference
 * cannot run in LinearRegExp and makes V8 backtrack, so each one is a
 * decision written down here.
 */
const BACK_REFERENCE_ALLOWED: ReadonlyArray<{
  dataTypeId: string;
  reason: string;
}> = [
  {
    dataTypeId: "credit-card-number",
    reason:
      "A card written in groups repeats its first separator (\\1), so 4111 1111-1111 1111 is no card; the group is one character, so the back-reference is as bounded as the rest.",
  },
];

function detectorName(detector: DataTypeDetector): string {
  return `${detector.dataTypeId} #${BUILT_IN_DETECTORS.indexOf(detector)}`;
}

function captureCount(pattern: RegExp): number {
  return new RegExp(`${pattern.source}|`).exec("")!.length - 1;
}

// Region codes Intl knows that are not ISO 3166-1 alpha-2 country codes.
const NOT_ISO_COUNTRIES: ReadonlySet<string> = new Set([
  "UK",
  "EU",
  "EZ",
  "UN",
]);

function isIsoCountryCode(code: string): boolean {
  if (!TWO_CAPITALS.test(code) || NOT_ISO_COUNTRIES.has(code)) {
    return false;
  }

  // Q and X codes are private use, but for Kosovo's XK, which banks and IDs use.
  if ((code.startsWith("Q") || code.startsWith("X")) && code !== "XK") {
    return false;
  }

  const name: string | undefined = new Intl.DisplayNames(["en"], {
    type: "region",
  }).of(code);

  return Boolean(name) && name !== code && name !== "Unknown Region";
}

const VALUE_TYPES: Array<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
  (info: DataTypeInfo) => {
    return info.foundBy === "value";
  },
);

describe("quantifierProblems, the reader this guard uses", () => {
  test.each([
    ["a+", ["1:+"], []],
    ["a*", ["1:*"], []],
    ["(?:ab)*?", ["6:*"], []],
    ["a{2,}", ["1:{2,}"], []],
    ["[a-z]{1,}", ["5:{1,}"], []],
    ["\\\\+", ["2:+"], []],
    ["\\p{L}+", ["5:+"], []],
    ["a{2,5}b{3}c?", [], []],
    ["\\+\\*\\{1,\\}", [], []],
    ["[+*]{1,4}", [], []],
    ["[\\]+]{1,4}", [], []],
    ["\\u{1F600}{1,2}", [], []],
    ["a{b", [], []],
    ["([ -])x\\1", [], [7]],
    ["(?<sep>-)x\\k<sep>", [], [10]],
    ["[\\1]", [], []],
  ])(
    "reads %j",
    (
      source: string,
      unbounded: Array<string>,
      backReferences: Array<number>,
    ) => {
      expect(quantifierProblems(source)).toEqual({ unbounded, backReferences });
    },
  );
});

describe("the detectors and the catalog cover each other", () => {
  test("every type found by value has at least one built-in detector", () => {
    const missing: Array<string> = VALUE_TYPES.filter((info: DataTypeInfo) => {
      return getBuiltInDetectorsOf(info.id).length === 0;
    }).map((info: DataTypeInfo) => {
      return info.id;
    });

    expect(missing).toEqual([]);
  });

  test("every detector names a type of the catalog that is found by value", () => {
    for (const detector of BUILT_IN_DETECTORS) {
      expect([
        detectorName(detector),
        getBuiltInDataType(detector.dataTypeId)?.foundBy,
      ]).toEqual([detectorName(detector), "value"]);
    }
  });

  test("getBuiltInDetectorsOf hands out every detector of a type, in the scanner's order", () => {
    for (const info of VALUE_TYPES) {
      expect(getBuiltInDetectorsOf(info.id)).toEqual(
        BUILT_IN_DETECTORS.filter((detector: DataTypeDetector) => {
          return detector.dataTypeId === info.id;
        }),
      );
    }

    expect(getBuiltInDetectorsOf("person-name")).toEqual([]);
    expect(getBuiltInDetectorsOf("no-such-type")).toEqual([]);
  });
});

describe.each(
  BUILT_IN_DETECTORS.map(
    (detector: DataTypeDetector): [string, DataTypeDetector] => {
      return [detectorName(detector), detector];
    },
  ),
)("detector %s", (_name: string, detector: DataTypeDetector) => {
  const problems: QuantifierProblems = quantifierProblems(
    detector.pattern.source,
  );

  test("is global and not sticky", () => {
    expect(detector.pattern.global).toBe(true);
    expect(detector.pattern.sticky).toBe(false);
  });

  test("has no unbounded quantifier", () => {
    expect(problems.unbounded).toEqual([]);
  });

  test("refers back to a group only where this guard allows it", () => {
    if (problems.backReferences.length === 0) {
      return;
    }

    expect(
      BACK_REFERENCE_ALLOWED.map((allowed: { dataTypeId: string }) => {
        return allowed.dataTypeId;
      }),
    ).toContain(detector.dataTypeId);
    // The one allowed shape: a one-character separator group, repeated.
    expect(detector.pattern.source).toContain("([ -])");
  });

  test("says how specific it is and how sure it is on its own", () => {
    expect([1, 2, 3]).toContain(detector.specificity);
    expect(ALL_DATA_CONFIDENCES).toContain(detector.confidenceWithoutContext);
  });

  test("stands apart from longer tokens: a look-behind first and a look-ahead last", () => {
    const source: string = detector.pattern.source;

    if (problems.backReferences.length > 0) {
      // LinearRegExp cannot read a back-reference; read the source instead.
      expect(source.startsWith("(?<!") || source.startsWith("(?<=")).toBe(true);
      expect(ENDS_WITH_LOOKAHEAD.test(source)).toBe(true);
      return;
    }

    const root: SyntaxNode = parsePattern(source, {
      ignoreCase: detector.pattern.ignoreCase,
      multiline: detector.pattern.multiline,
      dotAll: detector.pattern.dotAll,
    }).root;
    const items: Array<SyntaxNode> =
      root.kind === "Sequence" ? root.items : [root];
    const first: SyntaxNode = items[0]!;
    const last: SyntaxNode = items[items.length - 1]!;

    expect(
      (first.kind === "Lookaround" && first.behind) ||
        first.kind === "Character",
    ).toBe(true);
    expect(
      (last.kind === "Lookaround" && !last.behind) || last.kind === "Character",
    ).toBe(true);
  });

  test("matches no empty text", () => {
    const pattern: RegExp = new RegExp(
      detector.pattern.source,
      detector.pattern.flags,
    );

    for (const match of " a 1 - : @ . , x\n".matchAll(pattern)) {
      expect(match[0].length).toBeGreaterThan(0);
    }
  });

  test("names a value group its pattern has", () => {
    if (detector.valueGroup !== undefined) {
      expect(detector.valueGroup).toBeGreaterThan(0);
      expect(detector.valueGroup).toBeLessThanOrEqual(
        captureCount(detector.pattern),
      );
    }
  });

  test("writes its words in lower case, and needs them only when it has some", () => {
    for (const word of [
      ...(detector.keywords || []),
      ...(detector.negativeKeywords || []),
    ]) {
      expect([
        word,
        word.length > 0 && word === word.trim() && word === word.toLowerCase(),
      ]).toEqual([word, true]);
    }

    if (detector.requiresContext) {
      expect((detector.keywords || []).length).toBeGreaterThan(0);
    }
  });

  test("looks for its words no further than a window reads around a value", () => {
    if (detector.contextBefore !== undefined) {
      expect(Number.isInteger(detector.contextBefore)).toBe(true);
      expect(detector.contextBefore).toBeGreaterThan(0);
      expect(detector.contextBefore).toBeLessThanOrEqual(WINDOW_LEAD);
    }

    if (detector.contextAfter !== undefined) {
      expect(Number.isInteger(detector.contextAfter)).toBe(true);
      expect(detector.contextAfter).toBeGreaterThan(0);
      expect(detector.contextAfter).toBeLessThan(WINDOW_OVERLAP);
    }
  });

  test("judges a whole field value with an anchored, bounded, stateless pattern", () => {
    const shape: RegExp | undefined = detector.fieldValuePattern;

    if (!shape) {
      return;
    }

    expect(shape.source.startsWith("^")).toBe(true);
    expect(shape.source.endsWith("$")).toBe(true);
    expect(shape.global || shape.sticky).toBe(false);
    expect(quantifierProblems(shape.source)).toEqual({
      unbounded: [],
      backReferences: [],
    });
  });
});

describe("the back-references the guard allows", () => {
  test("are the grouped card detectors and nothing else", () => {
    const withBackReferences: Array<DataTypeDetector> =
      BUILT_IN_DETECTORS.filter((detector: DataTypeDetector) => {
        return (
          quantifierProblems(detector.pattern.source).backReferences.length > 0
        );
      });

    expect(withBackReferences.length).toBeGreaterThan(0);

    for (const detector of withBackReferences) {
      expect(detector.dataTypeId).toBe("credit-card-number");
    }

    for (const allowed of BACK_REFERENCE_ALLOWED) {
      expect(allowed.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("the data type catalog", () => {
  test("has unique, kebab-case ids that the lookups find", () => {
    const ids: Array<string> = DATA_TYPE_CATALOG.map((info: DataTypeInfo) => {
      return info.id;
    });

    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect([id, KEBAB_CASE.test(id)]).toEqual([id, true]);
      expect(isBuiltInDataType(id)).toBe(true);
      expect(getBuiltInDataType(id)?.id).toBe(id);
    }

    expect(isBuiltInDataType("custom:x")).toBe(false);
    expect(getBuiltInDataType("no-such-type")).toBeUndefined();
  });

  test.each(
    DATA_TYPE_CATALOG.map((info: DataTypeInfo): [string, DataTypeInfo] => {
      return [info.id, info];
    }),
  )(
    "%s is described, valid and findable by its hints",
    (_id: string, info: DataTypeInfo) => {
      expect(info.name.trim().length).toBeGreaterThan(0);
      expect(info.description.trim().length).toBeGreaterThan(10);
      expect(ALL_DATA_CATEGORIES).toContain(info.category);
      expect(ALL_DATA_SENSITIVITIES).toContain(info.sensitivity);
      expect(["value", "name"]).toContain(info.foundBy);

      for (const framework of info.frameworks) {
        expect(ALL_COMPLIANCE_FRAMEWORKS).toContain(framework);
      }

      expect(new Set(info.frameworks).size).toBe(info.frameworks.length);
      expect(new Set(info.nameHints).size).toBe(info.nameHints.length);

      // Lower-case words, split as a field's name is, so each one can match.
      for (const hint of info.nameHints) {
        expect([hint, LOWER_CASE_WORDS.test(hint)]).toEqual([hint, true]);
        expect([hint, splitFieldName(hint).join(" ")]).toEqual([hint, hint]);
      }

      if (info.foundBy === "name") {
        expect(info.nameHints.length).toBeGreaterThan(0);
      }

      if (info.country !== undefined) {
        expect([info.country, isIsoCountryCode(info.country)]).toEqual([
          info.country,
          true,
        ]);
      }
    },
  );

  test("puts every secret in Restricted, and every special category too", () => {
    for (const info of DATA_TYPE_CATALOG) {
      if (
        info.category === DataCategory.SecretsAndCredentials ||
        info.category === DataCategory.SpecialCategory
      ) {
        expect([info.id, info.sensitivity]).toEqual([
          info.id,
          DataSensitivity.Restricted,
        ]);
      }
    }
  });

  test("gives personal data of Brazil and India their own law", () => {
    for (const info of DATA_TYPE_CATALOG) {
      if (!isPersonalDataCategory(info.category)) {
        continue;
      }

      if (info.country === "BR") {
        expect([
          info.id,
          info.frameworks.includes(ComplianceFramework.LGPD),
        ]).toEqual([info.id, true]);
      }

      if (info.country === "IN") {
        expect([
          info.id,
          info.frameworks.includes(ComplianceFramework.DPDP),
        ]).toEqual([info.id, true]);
      }
    }
  });

  test("the country check itself refuses what is not an ISO country", () => {
    expect(isIsoCountryCode("GB")).toBe(true);
    expect(isIsoCountryCode("XK")).toBe(true);
    expect(isIsoCountryCode("UK")).toBe(false);
    expect(isIsoCountryCode("EU")).toBe(false);
    expect(isIsoCountryCode("XX")).toBe(false);
    expect(isIsoCountryCode("ZZ")).toBe(false);
    expect(isIsoCountryCode("us")).toBe(false);
    expect(isIsoCountryCode("USA")).toBe(false);
  });
});
