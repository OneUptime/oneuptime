import {
  NAME_PATTERN_PROBLEMS,
  NAME_PLACEHOLDERS,
  NameFilter,
  NamePatternProblem,
  NamePatternRendering,
  NamePatternValues,
  NamePlaceholder,
  ParsedNamePattern,
  applyNameFilter,
  composeName,
  formatNameCounter,
  formatNamePatternProblem,
  getExampleName,
  getNamePatternError,
  getNamePatternProblem,
  parseNamePattern,
  readIpv4Octets,
  readMacAddressDigits,
  readNameCounter,
  renderNamePattern,
} from "../../../../Utils/NetworkDevice/Naming/NamePattern";
import { MAX_NAME_PATTERN_LENGTH } from "../../../../Types/NetworkDevice/DeviceNaming";
import { seededRandom, SeededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A naming rule's name pattern (OneUptime issue #6619): what it accepts,
 * what it refuses and says why, and the name it makes for a device. Every
 * import and every rename reads a pattern through this, so a pattern that
 * saves must name devices exactly as the rule form's example shows.
 */

function parse(pattern: string): ParsedNamePattern {
  const read: { pattern: ParsedNamePattern } | { problem: NamePatternProblem } =
    parseNamePattern(pattern);

  if ("problem" in read) {
    throw new Error(
      `Expected "${pattern}" to parse: ${formatNamePatternProblem(read.problem)}`,
    );
  }

  return read.pattern;
}

function render(pattern: string, values: NamePatternValues): string | null {
  const rendering: NamePatternRendering = renderNamePattern(
    parse(pattern),
    values,
  );

  return rendering.isComplete ? composeName(rendering, 1) : null;
}

const UNIT_1216_MENU_PLAYER: NamePatternValues = {
  discoveredName: "dmb-5",
  ipAddress: "10.48.145.51",
  macAddress: "00:05:0b:b0:7f:fc",
  vendor: "SICOM Systems",
  siteName: "Unit 1216",
  siteCode: "1216",
  lookupValue: "MNUPLR01",
};

describe("parseNamePattern", () => {
  test("reads text, placeholders and a counter into segments", () => {
    const parsed: ParsedNamePattern = parse("UN{site.code}DRTSCR{nn}");

    expect(parsed.segments).toEqual([
      { kind: "text", text: "UN" },
      { kind: "value", placeholder: NamePlaceholder.SiteCode, filters: [] },
      { kind: "text", text: "DRTSCR" },
      { kind: "counter", width: 2 },
    ]);
    expect(parsed.placeholders).toEqual([NamePlaceholder.SiteCode]);
    expect(parsed.counterWidth).toBe(2);
  });

  test("a pattern of text alone is a pattern (one device by its address)", () => {
    const parsed: ParsedNamePattern = parse("UN1216MNUPLR01");

    expect(parsed.segments).toEqual([
      { kind: "text", text: "UN1216MNUPLR01" },
    ]);
    expect(parsed.counterWidth).toBeNull();
  });

  test("every placeholder of the catalogue parses, and each is listed once", () => {
    for (const info of NAME_PLACEHOLDERS) {
      expect(parse(`{${info.placeholder}}`).placeholders).toEqual([
        info.placeholder,
      ]);
    }

    expect(
      NAME_PLACEHOLDERS.map((info: { placeholder: NamePlaceholder }) => {
        return info.placeholder;
      }).sort(),
    ).toEqual(Object.values(NamePlaceholder).sort());
  });

  test("placeholders and filters are read without case or surrounding spaces", () => {
    expect(parse("{ Site.Code }").placeholders).toEqual([
      NamePlaceholder.SiteCode,
    ]);
    expect(parse("{VENDOR | First:3 | UPPER}").segments).toEqual([
      {
        kind: "value",
        placeholder: NamePlaceholder.Vendor,
        filters: [
          { filter: NameFilter.First, count: 3 },
          { filter: NameFilter.Upper },
        ],
      },
    ]);
  });

  test("each counter width", () => {
    expect(parse("{n}").counterWidth).toBe(1);
    expect(parse("{nn}").counterWidth).toBe(2);
    expect(parse("{nnn}").counterWidth).toBe(3);
    expect(parse("{NNNN}").counterWidth).toBe(4);
  });

  test("doubled braces are braces of the name itself", () => {
    expect(render("{{x}}-{site.code}", UNIT_1216_MENU_PLAYER)).toBe("{x}-1216");
    expect(render("a{{b", {})).toBe("a{b");
    expect(render("a}}b", {})).toBe("a}b");
  });

  test("a placeholder used twice is listed once", () => {
    expect(parse("{site.code}-{site.code}").placeholders).toEqual([
      NamePlaceholder.SiteCode,
    ]);
  });

  const refusals: Array<[string, unknown, string]> = [
    ["an empty pattern", "", NAME_PATTERN_PROBLEMS.empty],
    ["only spaces", "   ", NAME_PATTERN_PROBLEMS.empty],
    ["not text", 42, NAME_PATTERN_PROBLEMS.empty],
    ["null", null, NAME_PATTERN_PROBLEMS.empty],
    [
      "a pattern over the limit",
      "x".repeat(MAX_NAME_PATTERN_LENGTH + 1),
      NAME_PATTERN_PROBLEMS.tooLong,
    ],
    ["a line break", "UN\n{site}", NAME_PATTERN_PROBLEMS.controlCharacter],
    ["a tab", "UN\t{site}", NAME_PATTERN_PROBLEMS.controlCharacter],
    ["an unclosed brace", "UN{site.code", NAME_PATTERN_PROBLEMS.unclosedBrace],
    [
      "a brace opened inside another",
      "UN{site{site.code}",
      NAME_PATTERN_PROBLEMS.unclosedBrace,
    ],
    ["a stray closing brace", "UN}site", NAME_PATTERN_PROBLEMS.strayClosingBrace],
    ["empty braces", "UN{}", NAME_PATTERN_PROBLEMS.emptyPlaceholder],
    ["braces of spaces", "UN{  }", NAME_PATTERN_PROBLEMS.emptyPlaceholder],
    ["an unknown placeholder", "UN{unit}", NAME_PATTERN_PROBLEMS.unknownPlaceholder],
    [
      "a near miss of a placeholder",
      "{sitecode}",
      NAME_PATTERN_PROBLEMS.unknownPlaceholder,
    ],
    ["an unknown filter", "{site|title}", NAME_PATTERN_PROBLEMS.unknownFilter],
    ["first without a count", "{site|first}", NAME_PATTERN_PROBLEMS.filterNeedsCount],
    [
      "last with a word for a count",
      "{site|last:x}",
      NAME_PATTERN_PROBLEMS.filterNeedsCount,
    ],
    [
      "first with a negative count",
      "{site|first:-1}",
      NAME_PATTERN_PROBLEMS.filterNeedsCount,
    ],
    [
      "first with a zero count",
      "{site|first:0}",
      NAME_PATTERN_PROBLEMS.filterCountOutOfRange,
    ],
    [
      "first with a count over the limit",
      "{site|first:81}",
      NAME_PATTERN_PROBLEMS.filterCountOutOfRange,
    ],
    [
      "upper with a count",
      "{site|upper:2}",
      NAME_PATTERN_PROBLEMS.filterTakesNoCount,
    ],
    ["two counters", "{n}-{nn}", NAME_PATTERN_PROBLEMS.twoCounters],
    ["the same counter twice", "{nn}{nn}", NAME_PATTERN_PROBLEMS.twoCounters],
    [
      "a counter with a filter",
      "{nn|upper}",
      NAME_PATTERN_PROBLEMS.counterTakesNoFilters,
    ],
    ["an empty filter", "{site|}", NAME_PATTERN_PROBLEMS.unknownFilter],
  ];

  test.each(refusals)(
    "refuses %s, saying why",
    (_title: string, pattern: unknown, template: string) => {
      const found: NamePatternProblem | null = getNamePatternProblem(pattern);

      expect(found).not.toBeNull();
      expect(found!.template).toBe(template);
      expect(getNamePatternError(pattern)).toBe(
        formatNamePatternProblem(found!),
      );
      // Every value the sentence names is filled in.
      expect(getNamePatternError(pattern)).not.toMatch(/\{\{[a-z]+\}\}/i);
    },
  );

  test("the unknown-placeholder refusal names the placeholder and lists the real ones", () => {
    const message: string | null = getNamePatternError("UN{unit}");

    expect(message).toContain('"{unit}"');
    expect(message).toContain("{site.code}");
    expect(message).toContain("{lookup}");
    expect(message).toContain("{nn}");
  });

  test("a pattern at the limit is a pattern", () => {
    expect(getNamePatternProblem("x".repeat(MAX_NAME_PATTERN_LENGTH))).toBe(
      null,
    );
  });

  test("no problem sentence carries a literal double brace a translation would read as a value", () => {
    for (const template of Object.values(NAME_PATTERN_PROBLEMS)) {
      const withoutValues: string = template.replace(/\{\{[a-zA-Z]+\}\}/g, "");

      expect(withoutValues).not.toContain("{{");
      expect(withoutValues).not.toContain("}}");
    }
  });
});

describe("renderNamePattern", () => {
  test("the reporter's convention: UN, the unit, then the device's code", () => {
    expect(render("UN{site.code}{lookup}", UNIT_1216_MENU_PLAYER)).toBe(
      "UN1216MNUPLR01",
    );
    expect(render("UN{site.code}MNUPLR01", UNIT_1216_MENU_PLAYER)).toBe(
      "UN1216MNUPLR01",
    );
  });

  test("every placeholder reads its value", () => {
    expect(render("{discoveredName}", UNIT_1216_MENU_PLAYER)).toBe("dmb-5");
    expect(render("{ip}", UNIT_1216_MENU_PLAYER)).toBe("10.48.145.51");
    expect(render("{ip.1}-{ip.2}-{ip.3}-{ip.4}", UNIT_1216_MENU_PLAYER)).toBe(
      "10-48-145-51",
    );
    expect(render("{mac}", UNIT_1216_MENU_PLAYER)).toBe("00050BB07FFC");
    expect(render("{vendor}", UNIT_1216_MENU_PLAYER)).toBe("SICOM Systems");
    expect(render("{site}", UNIT_1216_MENU_PLAYER)).toBe("Unit 1216");
    expect(render("{site.code}", UNIT_1216_MENU_PLAYER)).toBe("1216");
    expect(render("{lookup}", UNIT_1216_MENU_PLAYER)).toBe("MNUPLR01");
  });

  test("filters change a value, one after the other", () => {
    expect(render("{vendor|first:3|upper}", UNIT_1216_MENU_PLAYER)).toBe("SIC");
    expect(render("{vendor|upper|first:3}", UNIT_1216_MENU_PLAYER)).toBe("SIC");
    expect(render("{site|digits}", UNIT_1216_MENU_PLAYER)).toBe("1216");
    expect(render("{site|nospaces}", UNIT_1216_MENU_PLAYER)).toBe("Unit1216");
    expect(render("{site|lower|nospaces}", UNIT_1216_MENU_PLAYER)).toBe(
      "unit1216",
    );
    expect(render("{mac|last:4}", UNIT_1216_MENU_PLAYER)).toBe("7FFC");
    expect(render("{mac|lower}", UNIT_1216_MENU_PLAYER)).toBe("00050bb07ffc");
    expect(render("{discoveredName|upper}", UNIT_1216_MENU_PLAYER)).toBe(
      "DMB-5",
    );
  });

  test("a value a filter empties is a missing value, never a shorter name", () => {
    const rendering: NamePatternRendering = renderNamePattern(
      parse("UN{site|digits}"),
      { siteName: "Main Office" },
    );

    expect(rendering).toEqual({
      isComplete: false,
      missing: NamePlaceholder.Site,
    });
  });

  test("the first placeholder without a value is the one reported", () => {
    const rendering: NamePatternRendering = renderNamePattern(
      parse("{site.code}-{mac}-{vendor}"),
      { siteCode: "1216" },
    );

    expect(rendering).toEqual({
      isComplete: false,
      missing: NamePlaceholder.MacAddress,
    });
  });

  test("a value that is only spaces or control characters is missing", () => {
    expect(render("{site.code}", { siteCode: "   " })).toBeNull();
    expect(render("{site.code}", { siteCode: "\u0000\u0007" })).toBeNull();
    expect(render("{site.code}", { siteCode: undefined })).toBeNull();
    expect(
      render("{site.code}", { siteCode: 1216 as unknown as string }),
    ).toBeNull();
  });

  test("control characters inside a value are dropped", () => {
    expect(render("{discoveredName}", { discoveredName: "kds\u000103" })).toBe(
      "kds03",
    );
  });

  test("an IPv6 address has no parts, so {ip.4} is missing for it", () => {
    expect(render("{ip.4}", { ipAddress: "fe80::1" })).toBeNull();
    expect(render("{ip}", { ipAddress: "fe80::1" })).toBe("fe80::1");
  });

  test("the parts of an address are written without leading zeros", () => {
    expect(render("{ip.3}-{ip.4}", { ipAddress: "10.48.045.051" })).toBe(
      "45-51",
    );
  });

  test("a MAC in any spelling, and not a MAC at all", () => {
    for (const mac of [
      "00:05:0b:b0:7f:fc",
      "00-05-0B-B0-7F-FC",
      "0005.0bb0.7ffc",
      "00050BB07FFC",
    ]) {
      expect(render("{mac}", { macAddress: mac })).toBe("00050BB07FFC");
    }

    expect(render("{mac}", { macAddress: "00:05:0b" })).toBeNull();
    expect(render("{mac}", { macAddress: "zz:05:0b:b0:7f:fc" })).toBeNull();
  });

  test("spaces around the name are trimmed, with and without a counter", () => {
    expect(render("  {site.code} SW  ", UNIT_1216_MENU_PLAYER)).toBe("1216 SW");

    const rendering: NamePatternRendering = renderNamePattern(
      parse("  SW-{nn}  "),
      {},
    );

    expect(rendering).toEqual({
      isComplete: true,
      prefix: "SW-",
      suffix: "",
      counterWidth: 2,
    });
  });

  test("a counter splits the name into the text before and after it", () => {
    const rendering: NamePatternRendering = renderNamePattern(
      parse("UN{site.code}-{nn}-SCR"),
      UNIT_1216_MENU_PLAYER,
    );

    expect(rendering).toEqual({
      isComplete: true,
      prefix: "UN1216-",
      suffix: "-SCR",
      counterWidth: 2,
    });

    if (rendering.isComplete) {
      expect(composeName(rendering, 7)).toBe("UN1216-07-SCR");
      expect(composeName(rendering, 123)).toBe("UN1216-123-SCR");
    }
  });
});

describe("counters", () => {
  test("formatNameCounter pads to the width and never cuts", () => {
    expect(formatNameCounter(1, 1)).toBe("1");
    expect(formatNameCounter(1, 2)).toBe("01");
    expect(formatNameCounter(7, 3)).toBe("007");
    expect(formatNameCounter(1234, 2)).toBe("1234");
  });

  test("readNameCounter reads the number a name carries in the counter's place", () => {
    const rendering: NamePatternRendering = renderNamePattern(
      parse("UN{site.code}LANSWI{nn}"),
      UNIT_1216_MENU_PLAYER,
    );

    if (!rendering.isComplete) {
      throw new Error("expected a rendering");
    }

    expect(readNameCounter("UN1216LANSWI03", rendering)).toBe(3);
    expect(readNameCounter("un1216lanswi03", rendering)).toBe(3);
    expect(readNameCounter("UN1216LANSWI120", rendering)).toBe(120);
    // Too few digits for {nn}, no digits, or other text.
    expect(readNameCounter("UN1216LANSWI3", rendering)).toBeNull();
    expect(readNameCounter("UN1216LANSWI", rendering)).toBeNull();
    expect(readNameCounter("UN1216LANSWIab", rendering)).toBeNull();
    expect(readNameCounter("UN1188LANSWI03", rendering)).toBeNull();
    // A number the counter never writes: zero, or padded past its width.
    expect(readNameCounter("UN1216LANSWI00", rendering)).toBeNull();
    expect(readNameCounter("UN1216LANSWI003", rendering)).toBeNull();
  });

  test("readNameCounter reads nothing for a pattern without a counter", () => {
    const rendering: NamePatternRendering = renderNamePattern(
      parse("UN{site.code}"),
      UNIT_1216_MENU_PLAYER,
    );

    if (!rendering.isComplete) {
      throw new Error("expected a rendering");
    }

    expect(readNameCounter("UN1216", rendering)).toBeNull();
  });

  test("every number composeName writes, readNameCounter reads back (seeded)", () => {
    const random: SeededRandom = seededRandom(6619);

    for (let attempt: number = 0; attempt < 500; attempt++) {
      const width: number = 1 + random(4);
      const value: number = 1 + random(20000);
      const prefix: string = ["SW-", "UN1216DRTSCR", "", "ap"][random(4)]!;
      const suffix: string = ["", "-A", "x"][random(3)]!;
      const rendering: Extract<NamePatternRendering, { isComplete: true }> = {
        isComplete: true,
        prefix: prefix,
        suffix: suffix,
        counterWidth: width,
      };
      const name: string = composeName(rendering, value);

      if (/\d$/.test(prefix)) {
        continue;
      }

      expect(readNameCounter(name, rendering)).toBe(value);
    }
  });
});

describe("filters", () => {
  test("first and last count characters as people see them", () => {
    expect(applyNameFilter("Bürö-🙂-Switch", { filter: NameFilter.First, count: 6 })).toBe(
      "Bürö-🙂",
    );
    expect(applyNameFilter("ab🙂", { filter: NameFilter.Last, count: 1 })).toBe(
      "🙂",
    );
    expect(applyNameFilter("ab", { filter: NameFilter.Last, count: 5 })).toBe(
      "ab",
    );
  });

  test("digits keeps only digits, nospaces drops every space", () => {
    expect(applyNameFilter("Unit 1216 / 3", { filter: NameFilter.Digits })).toBe(
      "12163",
    );
    expect(
      applyNameFilter(" Samsung  Electronics Co ", {
        filter: NameFilter.NoSpaces,
      }),
    ).toBe("SamsungElectronicsCo");
  });
});

describe("helpers", () => {
  test("readIpv4Octets", () => {
    expect(readIpv4Octets("10.48.145.51")).toEqual(["10", "48", "145", "51"]);
    expect(readIpv4Octets(" 10.0.0.1 ")).toEqual(["10", "0", "0", "1"]);
    expect(readIpv4Octets("10.48.145")).toBeNull();
    expect(readIpv4Octets("10.48.145.256")).toBeNull();
    expect(readIpv4Octets("10.48.145.x")).toBeNull();
    expect(readIpv4Octets(undefined)).toBeNull();
  });

  test("readMacAddressDigits", () => {
    expect(readMacAddressDigits("00:05:0b:b0:7f:fc")).toBe("00050BB07FFC");
    expect(readMacAddressDigits("00 05 0b b0 7f fc")).toBeNull();
    expect(readMacAddressDigits("")).toBeNull();
    expect(readMacAddressDigits(null)).toBeNull();
  });

  test("the rule form's example names the example device", () => {
    expect(getExampleName("UN{site.code}{lookup}")).toBe("UN1216MNUPLR01");
    expect(getExampleName("UN{site.code}{lookup}", "DRTSCR04")).toBe(
      "UN1216DRTSCR04",
    );
    expect(getExampleName("{site.code}-SW-{nn}")).toBe("1216-SW-01");
    expect(getExampleName("UN{site.code")).toBeNull();
  });
});
