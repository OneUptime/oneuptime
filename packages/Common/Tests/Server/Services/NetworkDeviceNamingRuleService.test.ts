import { Service as NetworkDeviceNamingRuleServiceType } from "../../../Server/Services/NetworkDeviceNamingRuleService";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  MAX_NAMING_LOOKUP_ENTRIES,
  NamingLookupEntry,
  NamingLookupKey,
} from "../../../Types/NetworkDevice/DeviceNaming";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { describe, expect, test } from "@jest/globals";

/*
 * What a naming rule must be to save (OneUptime issue #6619): every way a
 * rule could save and then name nothing - a pattern with a typo, a lookup
 * table nothing reads, a pattern reading an empty table, a condition that
 * cannot run - is refused with a sentence that says what is wrong, where
 * the person can still fix it.
 */

type RuleState = Parameters<
  typeof NetworkDeviceNamingRuleServiceType.validateRule
>[0];

function validate(state: RuleState): Array<NamingLookupEntry> {
  return NetworkDeviceNamingRuleServiceType.validateRule(state);
}

function refusal(state: RuleState): string {
  try {
    validate(state);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("expected the rule to be refused");
}

function criteria(filters: Array<RuleCriteriaFilter>): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

const DMB_TABLE: Array<NamingLookupEntry> = [
  { key: "51", value: "MNUPLR01" },
  { key: "151", value: "MNUSCR01" },
];

describe("a rule that saves", () => {
  test("the reporter's rule: a pattern reading a lookup table, keyed by the last part of the address", () => {
    expect(
      validate({
        namePattern: "UN{site.code}{lookup}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: DMB_TABLE,
      }),
    ).toEqual(DMB_TABLE);
  });

  test("a pattern without a table, and no conditions at all: every device", () => {
    expect(validate({ namePattern: "{site.code}-SW-{nn}" })).toEqual([]);
    expect(
      validate({ namePattern: "{site.code}-SW-{nn}", criteria: criteria([]) }),
    ).toEqual([]);
  });

  test("the table's rows are stored trimmed", () => {
    expect(
      validate({
        namePattern: "UN{site.code}{lookup}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: [{ key: " 51 ", value: " MNUPLR01 " }],
      }),
    ).toEqual([{ key: "51", value: "MNUPLR01" }]);
  });

  test("every condition the form offers, with every operator it offers", () => {
    expect(
      validate({
        namePattern: "{discoveredName}",
        criteria: criteria([
          {
            field: "ipMatchTarget",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "10.*.*.150-159",
          },
          {
            field: "ipMatchTarget",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: "10.48.0.0/16",
          },
          {
            field: "discoveredNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "dmb-",
          },
          {
            field: "macAddressPattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "00:05:0b*",
          },
          {
            field: "vendorPattern",
            operator: RuleCriteriaOperator.Contains,
            value: "Samsung",
          },
          {
            field: "sites",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ["22222222-2222-4222-8222-222222222222"],
          },
        ]),
      }),
    ).toEqual([]);
  });

  test("the never-matching pattern the form leaves in a column for older servers saves", () => {
    expect(
      validate({
        namePattern: "{discoveredName}",
        criteria: criteria([]),
        discoveredNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
      }),
    ).toEqual([]);
  });

  test("columns an API client writes, instead of conditions", () => {
    expect(
      validate({
        namePattern: "{discoveredName}",
        ipMatchTarget: "10.*.*.51",
        vendorPattern: "Samsung*",
      }),
    ).toEqual([]);
  });
});

describe("a rule that is refused, with what is wrong", () => {
  test("no name pattern", () => {
    expect(refusal({})).toBe("Enter the name pattern devices are named by.");
  });

  test("a pattern with an unknown placeholder names it", () => {
    expect(refusal({ namePattern: "UN{unit}" })).toContain('"{unit}"');
  });

  test("a pattern that reads {lookup} from an empty table", () => {
    expect(
      refusal({ namePattern: "UN{site.code}{lookup}", lookupEntries: [] }),
    ).toContain("add a row to the lookup table");
  });

  test("a table the pattern never reads", () => {
    expect(
      refusal({
        namePattern: "UN{site.code}",
        lookupKey: NamingLookupKey.LastIpOctet,
        lookupEntries: DMB_TABLE,
      }),
    ).toContain("Put {lookup} in the name pattern");
  });

  test("a table with no key kind", () => {
    expect(
      refusal({ namePattern: "{lookup}", lookupEntries: DMB_TABLE }),
    ).toContain("Choose what the lookup table is keyed by");
  });

  test("a table row whose key is not of its kind", () => {
    expect(
      refusal({
        namePattern: "{lookup}",
        lookupKey: NamingLookupKey.MacAddress,
        lookupEntries: [{ key: "51", value: "X" }],
      }),
    ).toContain('Row 1: "51" is not a MAC address, such as 00:05:0b:b0:7f:fc.');
  });

  test("a table over the limit", () => {
    expect(
      refusal({
        namePattern: "{lookup}",
        lookupKey: NamingLookupKey.DiscoveredName,
        lookupEntries: Array.from(
          { length: MAX_NAMING_LOOKUP_ENTRIES + 1 },
          (_value: unknown, index: number) => {
            return { key: `h${index}`, value: "X" };
          },
        ),
      }),
    ).toContain("at most");
  });

  const badConditions: Array<[string, RuleCriteriaFilter, string]> = [
    [
      "an IP condition that is not a range",
      {
        field: "ipMatchTarget",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "printers",
      },
      "is not an IP address range",
    ],
    [
      "an IP condition compared as text",
      {
        field: "ipMatchTarget",
        operator: RuleCriteriaOperator.Contains,
        value: "10.",
      },
      '"is in" or "is not in"',
    ],
    [
      "a site condition with a text value",
      {
        field: "sites",
        operator: RuleCriteriaOperator.Contains,
        value: "Unit 1216",
      },
      "picks sites from the list",
    ],
    [
      "a site that is not an id",
      {
        field: "sites",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["unit-1216"],
      },
      "Pick each site from the list.",
    ],
    [
      "a field a naming rule does not have",
      {
        field: "sysObjectIdPattern",
        operator: RuleCriteriaOperator.Contains,
        value: "1.3",
      },
      "is not a condition a naming rule can have",
    ],
    [
      "a text field with a list operator",
      {
        field: "vendorPattern",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ["Samsung"],
      },
      "is not a comparison Vendor can use",
    ],
    [
      "a pattern that cannot run",
      {
        field: "discoveredNamePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "(a",
      },
      "valid regular expression or wildcard pattern",
    ],
  ];

  test.each(badConditions)(
    "%s",
    (_title: string, filter: RuleCriteriaFilter, expected: string) => {
      expect(
        refusal({
          namePattern: "{discoveredName}",
          criteria: criteria([filter]),
        }),
      ).toContain(expected);
    },
  );

  test("criteria that are not criteria", () => {
    expect(() => {
      validate({
        namePattern: "{discoveredName}",
        criteria: { filters: "everything" },
      });
    }).toThrow(BadDataException);
  });

  test("a column an API client wrote that cannot match", () => {
    expect(
      refusal({ namePattern: "{discoveredName}", ipMatchTarget: "10.*.51" }),
    ).toContain('"10.*.51" is not an IP address range');
    expect(
      refusal({ namePattern: "{discoveredName}", vendorPattern: "(a" }),
    ).toContain("Vendor");
  });
});
