import VersionRangeUtil, {
  MAX_LISTED_VERSIONS,
  MAX_RANGE_LENGTH,
  VersionComparator,
  VersionComparatorOperator,
  VersionRange,
} from "../../Utils/VersionRange";
import VersionUtil from "../../Utils/VersionUtil";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The vulnerable version ranges OneUptime's published security advisories
 * write, read as GitHub documents them and as people type them, so the
 * daily update check tells an installation it is affected exactly when it
 * is. Every range OneUptime has published so far is in the fixture
 * (Fixtures/OneUptimePublishedSecurityAdvisories.json, read from GitHub on
 * 2026-10-30), and a seeded sweep holds the reader to an oracle written
 * apart from it.
 */

type Fixture = Array<{
  ghsa_id: string;
  vulnerabilities: Array<{
    vulnerable_version_range: string | null;
    patched_versions: string | null;
  }>;
}>;

const PUBLISHED: Fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "Fixtures",
      "OneUptimePublishedSecurityAdvisories.json",
    ),
    "utf8",
  ),
) as Fixture;

const parse: (text: unknown) => VersionRange = (
  text: unknown,
): VersionRange => {
  const range: VersionRange | null = VersionRangeUtil.parse(text);

  if (!range) {
    throw new Error(`Expected ${JSON.stringify(text)} to read as a range.`);
  }

  return range;
};

const takes: (text: string, version: string) => boolean | null = (
  text: string,
  version: string,
): boolean | null => {
  return VersionRangeUtil.matches(parse(text), version);
};

describe("the ranges GitHub documents", () => {
  test("= X takes that version alone", () => {
    expect(takes("= 0.2.0", "0.2.0")).toBe(true);
    expect(takes("= 0.2.0", "0.2.1")).toBe(false);
    expect(takes("= 0.2.0", "0.1.9")).toBe(false);
  });

  test("<= X takes X and everything before it", () => {
    expect(takes("<= 1.0.8", "1.0.8")).toBe(true);
    expect(takes("<= 1.0.8", "0.0.1")).toBe(true);
    expect(takes("<= 1.0.8", "1.0.9")).toBe(false);
  });

  test("< X leaves X out", () => {
    expect(takes("< 0.1.11", "0.1.10")).toBe(true);
    expect(takes("< 0.1.11", "0.1.11")).toBe(false);
    expect(takes("< 0.1.11", "0.1.12")).toBe(false);
  });

  test(">= A, < B is a window, A in and B out", () => {
    expect(takes(">= 4.3.0, < 4.3.5", "4.2.9")).toBe(false);
    expect(takes(">= 4.3.0, < 4.3.5", "4.3.0")).toBe(true);
    expect(takes(">= 4.3.0, < 4.3.5", "4.3.4")).toBe(true);
    expect(takes(">= 4.3.0, < 4.3.5", "4.3.5")).toBe(false);
  });

  test(">= X has no end", () => {
    expect(takes(">= 0.0.1", "0.0.1")).toBe(true);
    expect(takes(">= 0.0.1", "99.0.0")).toBe(true);
    expect(takes(">= 0.0.1", "0.0.0")).toBe(false);
  });

  test("> X leaves X out", () => {
    expect(takes("> 2.0.0", "2.0.0")).toBe(false);
    expect(takes("> 2.0.0", "2.0.1")).toBe(true);
  });
});

describe("the ranges as OneUptime's advisories write them", () => {
  test.each([
    ["<=11.0.1", "11.0.1", true],
    ["<=11.0.1", "11.0.2", false],
    ["<10.0.98", "10.0.97", true],
    ["<10.0.98", "10.0.98", false],
    [" < 10.0.19", "10.0.18", true],
    [" < 10.0.19", "10.0.19", false],
    [">= 6.0.1, < 12.0.34", "6.0.0", false],
    [">= 6.0.1, < 12.0.34", "6.0.1", true],
    [">= 6.0.1, < 12.0.34", "12.0.33", true],
    [">= 6.0.1, < 12.0.34", "12.0.34", false],
    [">= 7.0.4699, < 13.0.8", "7.0.4698", false],
    [">= 7.0.4699, < 13.0.8", "7.0.4699", true],
    [">= 7.0.4699, < 13.0.8", "10.0.99", true],
    [">= 11.0.5, <= 14.0.66", "11.0.4", false],
    [">= 11.0.5, <= 14.0.66", "14.0.66", true],
    [">= 11.0.5, <= 14.0.66", "14.0.67", false],
    ["< 3.0.2", "14.0.1", false],
    ["< 12.0.0", "11.99.99", true],
    ["< 12.0.0", "12.0.0", false],
  ] as Array<[string, string, boolean]>)(
    "%j takes %s: %s",
    (range: string, version: string, expected: boolean) => {
      expect(takes(range, version)).toBe(expected);
    },
  );

  test("compares as versions, never as text: 12.0.9 is below 12.0.10", () => {
    expect(takes("< 12.0.10", "12.0.9")).toBe(true);
    expect(takes("< 12.0.10", "12.0.100")).toBe(false);
    expect(takes("<= 9.9.9", "10.0.0")).toBe(false);
  });

  test("a version with no operator is that version, and says so", () => {
    const range: VersionRange = parse("10.0.23");

    expect(range.singleVersion).toBe("10.0.23");
    expect(VersionRangeUtil.matches(range, "10.0.23")).toBe(true);
    expect(VersionRangeUtil.matches(range, "10.0.22")).toBe(false);
    expect(parse("v8.0.5581").singleVersion).toBe("8.0.5581");
  });

  test("a range with an operator is never a single version", () => {
    expect(parse("= 10.0.23").singleVersion).toBeNull();
    expect(parse("<= 10.0.23").singleVersion).toBeNull();
    expect(parse("10.0.23 || 11.0.1").singleVersion).toBeNull();
  });

  test("every range OneUptime has published reads, but the one sentence", () => {
    const unread: Array<string> = [];

    for (const advisory of PUBLISHED) {
      for (const vulnerability of advisory.vulnerabilities) {
        if (
          VersionRangeUtil.parse(vulnerability.vulnerable_version_range) ===
          null
        ) {
          unread.push(String(vulnerability.vulnerable_version_range));
        }
      }
    }

    // Read with the patched versions instead (SecurityAdvisoryMatcher).
    expect(unread).toEqual(["All versions including 10.0.23"]);
  });

  test("every patched version OneUptime has published reads as versions, or as none", () => {
    for (const advisory of PUBLISHED) {
      for (const vulnerability of advisory.vulnerabilities) {
        const patched: Array<string> = VersionRangeUtil.parseVersionList(
          vulnerability.patched_versions,
        );

        if (
          vulnerability.patched_versions === null ||
          ["", "none"].includes(vulnerability.patched_versions.trim())
        ) {
          expect(patched).toEqual([]);
        } else {
          expect(patched).toHaveLength(1);
          expect(VersionUtil.isValid(patched[0])).toBe(true);
        }
      }
    }
  });
});

describe("spellings people type", () => {
  test.each([
    ["≤ 1.2.3", "1.2.3", true],
    ["≥ 1.2.3", "1.2.2", false],
    ["=< 1.2.3", "1.2.3", true],
    ["=> 1.2.3", "1.2.3", true],
    ["== 1.2.3", "1.2.3", true],
    ["<  1.2.3", "1.2.2", true],
    [">=1.0.0 <2.0.0", "1.5.0", true],
    [">=1.0.0 <2.0.0", "2.0.0", false],
    [">=1.0.0,<2.0.0", "1.9.9", true],
    [">= 1.0.0 , < 2.0.0", "0.9.9", false],
    ["< v12.0.0", "11.0.0", true],
    ["< V12.0.0", "12.0.0", false],
    ["<= 1.2.3,", "1.2.3", true],
    ["<\t1.2.3", "1.2.2", true],
  ] as Array<[string, string, boolean]>)(
    "%j takes %s: %s",
    (range: string, version: string, expected: boolean) => {
      expect(takes(range, version)).toBe(expected);
    },
  );

  test("|| separates alternatives", () => {
    const range: string = "< 1.0.5 || >= 2.0.0, < 2.0.3";

    expect(takes(range, "1.0.4")).toBe(true);
    expect(takes(range, "1.0.5")).toBe(false);
    expect(takes(range, "2.0.2")).toBe(true);
    expect(takes(range, "2.0.3")).toBe(false);
  });

  test("a hyphen range takes both ends", () => {
    expect(takes("1.2.3 - 2.3.4", "1.2.3")).toBe(true);
    expect(takes("1.2.3 - 2.3.4", "2.3.4")).toBe(true);
    expect(takes("1.2.3 - 2.3.4", "2.3.5")).toBe(false);
    expect(takes("1.2.3 - 2.3.4", "1.2.2")).toBe(false);
    // A partial end takes all of it, as npm reads it.
    expect(takes("1.2 - 2.3", "2.3.99")).toBe(true);
    expect(takes("1.2 - 2.3", "2.4.0")).toBe(false);
    expect(takes("1.2 - 2.3", "1.2.0")).toBe(true);
  });
});

describe("partial versions and wildcards, as npm reads them", () => {
  test.each([
    ["1.2", "1.2.0", true],
    ["1.2", "1.2.99", true],
    ["1.2", "1.3.0", false],
    ["1.2.x", "1.2.7", true],
    ["1.2.*", "1.1.9", false],
    ["1", "1.99.0", true],
    ["1.x", "2.0.0", false],
    ["< 12.0", "11.9.9", true],
    ["< 12.0", "12.0.0", false],
    ["< 12.0", "12.0.0-rc.1", false],
    ["<= 12.0", "12.0.99", true],
    ["<= 12.0", "12.1.0", false],
    ["<= 12.0", "12.1.0-rc.1", false],
    ["> 12.0", "12.0.99", false],
    ["> 12.0", "12.1.0", true],
    [">= 12.0", "12.0.0", true],
    [">= 12.0", "11.99.0", false],
    ["*", "0.0.1", true],
    ["x", "99.99.99", true],
    [">= *", "1.2.3", true],
    ["< *", "1.2.3", false],
    ["> *", "1.2.3", false],
  ] as Array<[string, string, boolean]>)(
    "%j takes %s: %s",
    (range: string, version: string, expected: boolean) => {
      expect(takes(range, version)).toBe(expected);
    },
  );

  test("a number after a wildcard is not a version", () => {
    expect(VersionRangeUtil.parse("1.x.3")).toBeNull();
    expect(VersionRangeUtil.parse("< *.2")).toBeNull();
  });

  test("a pre-release belongs to one release, so a partial version cannot carry one", () => {
    expect(VersionRangeUtil.parse("1.2-rc.1")).toBeNull();
  });
});

describe("pre-releases and build metadata", () => {
  test("a pre-release is below its release", () => {
    expect(takes("< 14.0.67", "14.0.67-rc.1")).toBe(true);
    expect(takes("<= 14.0.66", "14.0.67-rc.1")).toBe(false);
    expect(takes(">= 14.0.67", "14.0.67-rc.1")).toBe(false);
  });

  test("pre-releases order by their identifiers", () => {
    expect(takes("< 2.0.0-rc.2", "2.0.0-rc.1")).toBe(true);
    expect(takes("< 2.0.0-rc.2", "2.0.0-rc.10")).toBe(false);
    expect(takes(">= 2.0.0-alpha, < 2.0.0-beta", "2.0.0-alpha.7")).toBe(true);
  });

  test("build metadata takes no part", () => {
    expect(takes("= 1.2.3", "1.2.3+build.9")).toBe(true);
    expect(takes("< 1.2.3+zzz", "1.2.3")).toBe(false);
  });
});

describe("what is not a range", () => {
  test.each([
    [null],
    [undefined],
    [42],
    [{ range: "< 1.0.0" }],
    [["< 1.0.0"]],
    [""],
    ["   "],
    [","],
    ["||"],
    ["< 1.0.0 ||"],
    ["All versions including 10.0.23"],
    ["latest"],
    ["unknown"],
    ["< 1.0.0 and later"],
    ["<"],
    ["< >= 1.0.0"],
    ["~1.2.3"],
    ["^1.2.3"],
    ["1.2.3.4"],
    ["01.2.3x"],
    ["< 1.0.0 - 2.0.0"],
    ["1.0.0 -"],
    [">= 1.0.0, ; < 2.0.0"],
    ["< 99999999999.0.0"],
  ] as Array<[unknown]>)("%j", (value: unknown) => {
    expect(VersionRangeUtil.parse(value)).toBeNull();
  });

  test("a range longer than any GitHub takes is refused before it is read", () => {
    const longest: string = `< 1.0.0${" ".repeat(MAX_RANGE_LENGTH - 7)}`;

    expect(longest).toHaveLength(MAX_RANGE_LENGTH);
    expect(VersionRangeUtil.parse(longest)).not.toBeNull();
    expect(VersionRangeUtil.parse(`${longest} `)).toBeNull();

    const megabytes: string = "<= 1.0.0, ".repeat(400000);
    const startedAt: number = Date.now();

    expect(VersionRangeUtil.parse(megabytes)).toBeNull();
    expect(VersionRangeUtil.parseVersionList(megabytes)).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("a version that is not one is neither in nor out", () => {
    const range: VersionRange = parse("< 12.0.0");

    for (const version of ["unknown", "", "12", "12.0", "dev", null, 12, "v"]) {
      expect(VersionRangeUtil.matches(range, version)).toBeNull();
    }
  });
});

describe("patched versions", () => {
  test.each([
    ["12.0.34", ["12.0.34"]],
    [">= 12.0.14", ["12.0.14"]],
    ["v13.0.8", ["13.0.8"]],
    ["9.0.10, 10.0.5", ["9.0.10", "10.0.5"]],
    ["10.0.5, 9.0.10", ["9.0.10", "10.0.5"]],
    ["10.0.5 || 10.0.5", ["10.0.5"]],
    ["12.0.34 or later", ["12.0.34"]],
    ["14.0.70-rc.1", ["14.0.70-rc.1"]],
    ["12.0.34+build", ["12.0.34"]],
    ["", []],
    ["none", []],
    ["None yet", []],
    ["12.0", []],
    ["12.0.34.5", []],
    ["v1.2.3x", []],
  ] as Array<[string, Array<string>]>)(
    "%j -> %j",
    (value: string, expected: Array<string>) => {
      expect(VersionRangeUtil.parseVersionList(value)).toEqual(expected);
    },
  );

  test("anything that is not text names no version", () => {
    for (const value of [null, undefined, 12, ["12.0.34"], { v: "1.0.0" }]) {
      expect(VersionRangeUtil.parseVersionList(value)).toEqual([]);
    }
  });

  test("a list names at most MAX_LISTED_VERSIONS versions", () => {
    const many: string = Array.from({ length: 30 }, (_: unknown, i: number) => {
      return `1.0.${i}`;
    }).join(",");

    expect(VersionRangeUtil.parseVersionList(many)).toHaveLength(
      MAX_LISTED_VERSIONS,
    );
  });
});

describe("the first release a range leaves out", () => {
  test.each([
    ["< 12.0.34", "12.0.34"],
    [">= 6.0.1, < 12.0.34", "12.0.34"],
    ["< 12.0", "12.0.0"],
    ["<= 12.0", "12.1.0"],
    ["1.2.x", "1.3.0"],
    ["< 2.0.0-rc.2", "2.0.0-rc.2"],
  ] as Array<[string, string]>)("%j -> %s", (range: string, bound: string) => {
    expect(VersionRangeUtil.getExclusiveUpperBound(parse(range))).toBe(bound);
  });

  test.each([
    ["<= 12.0.5"],
    [">= 1.0.0"],
    ["10.0.23"],
    ["= 10.0.23"],
    ["< 1.0.0 || < 2.0.0"],
    ["*"],
  ])("%j has none", (range: string) => {
    expect(VersionRangeUtil.getExclusiveUpperBound(parse(range))).toBeNull();
  });
});

/*
 * THE SWEEP. Random versions against random ranges of one or two
 * comparators, written in every spacing people use, checked against an
 * oracle that compares the numbers itself. The versions keep to plain
 * releases and "rc.N" pre-releases, which the oracle can order on its own.
 */
describe("a seeded sweep against an oracle", () => {
  interface Generated {
    major: number;
    minor: number;
    patch: number;
    rc: number | null;
  }

  const OPERATORS: Array<VersionComparatorOperator> = [
    VersionComparatorOperator.LessThan,
    VersionComparatorOperator.LessThanOrEqual,
    VersionComparatorOperator.GreaterThan,
    VersionComparatorOperator.GreaterThanOrEqual,
    VersionComparatorOperator.Equal,
  ];

  const generate: (random: SeededRandom) => Generated = (
    random: SeededRandom,
  ): Generated => {
    return {
      major: random(16),
      minor: random(4),
      patch: random(40),
      rc: random(5) === 0 ? random(4) : null,
    };
  };

  const write: (version: Generated) => string = (
    version: Generated,
  ): string => {
    return `${version.major}.${version.minor}.${version.patch}${
      version.rc === null ? "" : `-rc.${version.rc}`
    }`;
  };

  // -1, 0 or 1, without VersionUtil.
  const oracleCompare: (a: Generated, b: Generated) => number = (
    a: Generated,
    b: Generated,
  ): number => {
    for (const [left, right] of [
      [a.major, b.major],
      [a.minor, b.minor],
      [a.patch, b.patch],
    ] as Array<[number, number]>) {
      if (left !== right) {
        return left < right ? -1 : 1;
      }
    }

    if (a.rc === b.rc) {
      return 0;
    }

    if (a.rc === null) {
      return 1;
    }

    if (b.rc === null) {
      return -1;
    }

    return a.rc < b.rc ? -1 : 1;
  };

  const oracleSatisfies: (
    version: Generated,
    operator: VersionComparatorOperator,
    bound: Generated,
  ) => boolean = (
    version: Generated,
    operator: VersionComparatorOperator,
    bound: Generated,
  ): boolean => {
    const comparison: number = oracleCompare(version, bound);

    switch (operator) {
      case VersionComparatorOperator.LessThan:
        return comparison < 0;
      case VersionComparatorOperator.LessThanOrEqual:
        return comparison <= 0;
      case VersionComparatorOperator.GreaterThan:
        return comparison > 0;
      case VersionComparatorOperator.GreaterThanOrEqual:
        return comparison >= 0;
      default:
        return comparison === 0;
    }
  };

  const SPACINGS: Array<(operator: string, version: string) => string> = [
    (operator: string, version: string): string => {
      return `${operator} ${version}`;
    },
    (operator: string, version: string): string => {
      return `${operator}${version}`;
    },
    (operator: string, version: string): string => {
      return ` ${operator}  v${version} `;
    },
  ];

  const JOINERS: Array<string> = [", ", ",", " , ", " "];

  test("20,000 ranges take exactly what the oracle takes", () => {
    const random: SeededRandom = seededRandom(20261030);
    const mismatches: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      const count: number = 1 + random(2);
      const parts: Array<{
        operator: VersionComparatorOperator;
        bound: Generated;
      }> = [];

      for (let part: number = 0; part < count; part++) {
        parts.push({
          operator: OPERATORS[
            random(OPERATORS.length)
          ] as VersionComparatorOperator,
          bound: generate(random),
        });
      }

      const text: string = parts
        .map(
          (part: {
            operator: VersionComparatorOperator;
            bound: Generated;
          }): string => {
            const spacing: (operator: string, version: string) => string =
              SPACINGS[random(SPACINGS.length)] as (
                operator: string,
                version: string,
              ) => string;
            return spacing(part.operator, write(part.bound));
          },
        )
        .join(JOINERS[random(JOINERS.length)]);

      const version: Generated = generate(random);
      const expected: boolean = parts.every(
        (part: {
          operator: VersionComparatorOperator;
          bound: Generated;
        }): boolean => {
          return oracleSatisfies(version, part.operator, part.bound);
        },
      );

      const range: VersionRange | null = VersionRangeUtil.parse(text);
      const actual: boolean | null = range
        ? VersionRangeUtil.matches(range, write(version))
        : null;

      if (actual !== expected) {
        mismatches.push(`${JSON.stringify(text)} with ${write(version)}`);
      }
    }

    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  test("|| takes what any of its alternatives takes", () => {
    const random: SeededRandom = seededRandom(1414);

    for (let index: number = 0; index < 5000; index++) {
      const first: string = `${OPERATORS[random(OPERATORS.length)]} ${write(generate(random))}`;
      const second: string = `${OPERATORS[random(OPERATORS.length)]} ${write(generate(random))}`;
      const version: string = write(generate(random));

      expect(takes(`${first} || ${second}`, version)).toBe(
        Boolean(takes(first, version)) || Boolean(takes(second, version)),
      );
    }
  });

  test("whatever is typed, reading it never throws, and what it reads is versions", () => {
    const ALPHABET: Array<string> = [
      "<",
      "<=",
      ">",
      ">=",
      "=",
      "==",
      " ",
      ",",
      "||",
      " - ",
      "1",
      "12",
      ".",
      "0",
      "x",
      "*",
      "-",
      "rc",
      ".1",
      "v",
      "+b",
      "all versions",
      "≤",
      "\t",
      "12.0.34",
    ];

    for (const text of generatedTexts(20000, 7919, ALPHABET)) {
      let range: VersionRange | null = null;

      expect(() => {
        range = VersionRangeUtil.parse(text);
        VersionRangeUtil.parseVersionList(text);
      }).not.toThrow();

      if (range) {
        for (const alternative of (range as VersionRange).alternatives) {
          for (const comparator of alternative as Array<VersionComparator>) {
            expect(VersionUtil.isValid(comparator.version)).toBe(true);
          }
        }

        expect(
          typeof VersionRangeUtil.matches(range as VersionRange, "1.2.3"),
        ).toBe("boolean");
      }
    }
  });
});
