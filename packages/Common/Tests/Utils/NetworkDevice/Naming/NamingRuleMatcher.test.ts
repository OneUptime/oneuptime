import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import NamingRuleMatcher, {
  DeviceNamingFacts,
  NamingRuleConditionColumns,
  addressIsInNamingRange,
  getMacAddressSpellings,
  isValidNamingAddressRange,
  normalizeNamingAddressRange,
} from "../../../../Utils/NetworkDevice/Naming/NamingRuleMatcher";
import { describe, expect, test } from "@jest/globals";

/*
 * Which devices a naming rule names (OneUptime issue #6619). The conditions
 * are the rule builder's own, read through RuleCriteriaMatcher like every
 * rule kind's, so these pin each of the five fields, each operator the form
 * offers on it, the columns an API client may write instead, and how
 * conditions combine.
 */

const UNIT_SITE: string = "7c0a8b5e-0d2a-4d4e-9f2b-1a2b3c4d5e61";
const REGION_SITE: string = "7c0a8b5e-0d2a-4d4e-9f2b-1a2b3c4d5e62";
const OTHER_SITE: string = "7c0a8b5e-0d2a-4d4e-9f2b-1a2b3c4d5e63";

const MENU_PLAYER: DeviceNamingFacts = {
  ipAddress: "10.48.145.51",
  macAddress: "00:05:0B:B0:7F:FC",
  vendor: "SICOM Systems",
  discoveredName: "dmb-5",
  siteId: UNIT_SITE,
  siteIds: [UNIT_SITE, REGION_SITE],
  siteName: "Unit 1216",
  siteCode: "1216",
};

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function matches(
  rule: NamingRuleConditionColumns,
  facts: DeviceNamingFacts = MENU_PLAYER,
): boolean {
  return NamingRuleMatcher.ruleMatches(rule, facts);
}

function condition(
  field: string,
  operator: RuleCriteriaOperator,
  value: string | Array<string>,
): NamingRuleConditionColumns {
  return { criteria: criteria([{ field, operator, value }]) };
}

describe("a rule with no conditions", () => {
  test("names every device: with no criteria and no columns", () => {
    expect(matches({})).toBe(true);
    expect(matches({}, {})).toBe(true);
  });

  test("names every device: with an empty conditions list", () => {
    expect(matches({ criteria: criteria([]) })).toBe(true);
  });

  test("criteria that are not criteria match nothing", () => {
    expect(matches({ criteria: { filters: "everything" } })).toBe(false);
  });
});

describe("IP Address", () => {
  test("is in a CIDR, an octet range, and a range with * for any number", () => {
    for (const range of [
      "10.48.145.0/24",
      "10.0.0.0/8",
      "10.48.145.51",
      "10.0-255.0-255.51",
      "10.*.*.51",
      "*.*.*.51",
      "10.48.145.50-59",
    ]) {
      expect(
        matches(condition("ipMatchTarget", RuleCriteriaOperator.MatchesPattern, range)),
      ).toBe(true);
    }
  });

  test("is not in a range that leaves the device out", () => {
    for (const range of ["10.48.146.0/24", "10.*.*.151", "10.48.145.150-159"]) {
      expect(
        matches(condition("ipMatchTarget", RuleCriteriaOperator.MatchesPattern, range)),
      ).toBe(false);
      expect(
        matches(
          condition("ipMatchTarget", RuleCriteriaOperator.DoesNotMatchPattern, range),
        ),
      ).toBe(true);
    }
  });

  test("a device without an address is in no range", () => {
    expect(
      matches(
        condition("ipMatchTarget", RuleCriteriaOperator.MatchesPattern, "10.0.0.0/8"),
        { ...MENU_PLAYER, ipAddress: undefined },
      ),
    ).toBe(false);
  });

  test("the column an API client writes matches the same way", () => {
    expect(matches({ ipMatchTarget: "10.*.*.51" })).toBe(true);
    expect(matches({ ipMatchTarget: "10.*.*.52" })).toBe(false);
  });

  test("the range syntax", () => {
    expect(normalizeNamingAddressRange("10.*.*.51")).toBe("10.0-255.0-255.51");
    expect(normalizeNamingAddressRange(" 10.48.145.0/24 ")).toBe(
      "10.48.145.0/24",
    );
    expect(isValidNamingAddressRange("10.*.*.51")).toBe(true);
    expect(isValidNamingAddressRange("10.0.0.0/8")).toBe(true);
    expect(isValidNamingAddressRange("10.0.0.0/33")).toBe(false);
    expect(isValidNamingAddressRange("10.*.51")).toBe(false);
    expect(isValidNamingAddressRange("printers")).toBe(false);
    expect(isValidNamingAddressRange("")).toBe(false);
    expect(isValidNamingAddressRange(undefined)).toBe(false);
    expect(addressIsInNamingRange("10.1.2.51", "10.*.*.51")).toBe(true);
    expect(addressIsInNamingRange(undefined, "10.*.*.51")).toBe(false);
  });
});

describe("Discovered Name", () => {
  const operatorCases: Array<[RuleCriteriaOperator, string, boolean]> = [
    [RuleCriteriaOperator.Equals, "DMB-5", true],
    [RuleCriteriaOperator.Equals, "dmb", false],
    [RuleCriteriaOperator.NotEquals, "dmb-6", true],
    [RuleCriteriaOperator.Contains, "MB", true],
    [RuleCriteriaOperator.DoesNotContain, "kds", true],
    [RuleCriteriaOperator.DoesNotContain, "dmb", false],
    [RuleCriteriaOperator.StartsWith, "dmb-", true],
    [RuleCriteriaOperator.EndsWith, "-5", true],
    [RuleCriteriaOperator.EndsWith, "-6", false],
    [RuleCriteriaOperator.MatchesPattern, "dmb-*", true],
    [RuleCriteriaOperator.MatchesPattern, "^dmb-\\d+$", true],
    [RuleCriteriaOperator.MatchesPattern, "kds*", false],
    [RuleCriteriaOperator.DoesNotMatchPattern, "kds*", true],
  ];

  test.each(operatorCases)(
    "%s %s is %s for dmb-5",
    (operator: RuleCriteriaOperator, value: string, expected: boolean) => {
      expect(matches(condition("discoveredNamePattern", operator, value))).toBe(
        expected,
      );
    },
  );

  test("a device with no discovered name matches no positive condition", () => {
    expect(
      matches(
        condition("discoveredNamePattern", RuleCriteriaOperator.Contains, "dmb"),
        { ...MENU_PLAYER, discoveredName: undefined },
      ),
    ).toBe(false);
  });
});

describe("MAC Address", () => {
  test("matches whichever spelling the condition is written in", () => {
    for (const prefix of ["00:05:0b", "00-05-0B", "0005.0b", "00050b"]) {
      expect(
        matches(
          condition("macAddressPattern", RuleCriteriaOperator.StartsWith, prefix),
        ),
      ).toBe(true);
    }
  });

  test("a negated condition holds only when no spelling matches", () => {
    expect(
      matches(
        condition("macAddressPattern", RuleCriteriaOperator.DoesNotContain, "00-05-0b"),
      ),
    ).toBe(false);
    expect(
      matches(
        condition("macAddressPattern", RuleCriteriaOperator.DoesNotContain, "00-05-0c"),
      ),
    ).toBe(true);
  });

  test("every spelling of a MAC", () => {
    expect(getMacAddressSpellings("00:05:0B:B0:7F:FC")).toEqual([
      "00:05:0b:b0:7f:fc",
      "00-05-0b-b0-7f-fc",
      "0005.0bb0.7ffc",
      "00050bb07ffc",
    ]);
    expect(getMacAddressSpellings("not a mac")).toEqual([]);
    expect(getMacAddressSpellings(undefined)).toEqual([]);
  });
});

describe("Vendor", () => {
  test("contains, without case", () => {
    expect(
      matches(condition("vendorPattern", RuleCriteriaOperator.Contains, "sicom")),
    ).toBe(true);
    expect(
      matches(condition("vendorPattern", RuleCriteriaOperator.Contains, "samsung")),
    ).toBe(false);
  });

  test("the column an API client writes is a pattern", () => {
    expect(matches({ vendorPattern: "SICOM*" })).toBe(true);
    expect(matches({ vendorPattern: "Samsung*" })).toBe(false);
  });
});

describe("Site", () => {
  test("has any of: the device's own site, or any site above it", () => {
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasAnyOf, [UNIT_SITE])),
    ).toBe(true);
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasAnyOf, [REGION_SITE])),
    ).toBe(true);
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasAnyOf, [OTHER_SITE])),
    ).toBe(false);
  });

  test("has all of, and has none of", () => {
    expect(
      matches(
        condition("sites", RuleCriteriaOperator.HasAllOf, [UNIT_SITE, REGION_SITE]),
      ),
    ).toBe(true);
    expect(
      matches(
        condition("sites", RuleCriteriaOperator.HasAllOf, [UNIT_SITE, OTHER_SITE]),
      ),
    ).toBe(false);
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasNoneOf, [OTHER_SITE])),
    ).toBe(true);
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasNoneOf, [REGION_SITE])),
    ).toBe(false);
  });

  test("a device in no site is in none of them", () => {
    const noSite: DeviceNamingFacts = {
      ...MENU_PLAYER,
      siteId: undefined,
      siteIds: undefined,
    };

    expect(
      matches(condition("sites", RuleCriteriaOperator.HasAnyOf, [UNIT_SITE]), noSite),
    ).toBe(false);
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasNoneOf, [UNIT_SITE]), noSite),
    ).toBe(true);
  });

  test("the sites column, as a rule row holds it, matches by id", () => {
    expect(matches({ sites: [{ _id: UNIT_SITE }] })).toBe(true);
    expect(matches({ sites: [UNIT_SITE] })).toBe(true);
    expect(matches({ sites: [{ _id: OTHER_SITE }] })).toBe(false);
    expect(matches({ sites: [] })).toBe(true);
  });

  test("a device known only by its own site matches it", () => {
    expect(
      matches(condition("sites", RuleCriteriaOperator.HasAnyOf, [UNIT_SITE]), {
        siteId: UNIT_SITE,
      }),
    ).toBe(true);
  });
});

describe("conditions together", () => {
  const vendorIsSicom: RuleCriteriaFilter = {
    field: "vendorPattern",
    operator: RuleCriteriaOperator.Contains,
    value: "sicom",
  };
  const inScreensRange: RuleCriteriaFilter = {
    field: "ipMatchTarget",
    operator: RuleCriteriaOperator.MatchesPattern,
    value: "10.*.*.150-159",
  };

  test("all of them must hold, by default", () => {
    expect(matches({ criteria: criteria([vendorIsSicom, inScreensRange]) })).toBe(
      false,
    );
    expect(
      matches(
        { criteria: criteria([vendorIsSicom, inScreensRange]) },
        { ...MENU_PLAYER, ipAddress: "10.48.145.154" },
      ),
    ).toBe(true);
  });

  test("or any one of them", () => {
    expect(
      matches({
        criteria: criteria([vendorIsSicom, inScreensRange], FilterCondition.Any),
      }),
    ).toBe(true);
  });

  test("a condition on a field the rule does not have matches nothing", () => {
    expect(
      matches(condition("sysObjectIdPattern", RuleCriteriaOperator.Contains, "1.3")),
    ).toBe(false);
  });

  test("criteria win over columns: a rule saved with conditions ignores stale columns", () => {
    expect(
      matches({
        criteria: criteria([vendorIsSicom]),
        ipMatchTarget: "192.168.0.0/16",
      }),
    ).toBe(true);
  });
});
