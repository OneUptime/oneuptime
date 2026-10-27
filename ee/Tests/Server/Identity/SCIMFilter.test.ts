import { describe, expect, test } from "@jest/globals";
import {
  MAX_SCIM_FILTER_LENGTH,
  ScimEqualityFilter,
  ScimFilterError,
  getScimFilterText,
  isScimAttribute,
  parseScimFilter,
} from "../../../Server/Identity/Utils/SCIMFilter";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * The filters identity providers send before they create or change anyone
 * (RFC 7644, section 3.4.2.2): Okta's userName eq, Microsoft Entra ID's
 * equalities on its matching attributes joined by "and", a group's
 * displayName, a value path on members. Anything else is refused as an
 * invalid filter, never read as "no filter".
 */

const parse: (filter: string) => Array<ScimEqualityFilter> = (
  filter: string,
): Array<ScimEqualityFilter> => {
  return parseScimFilter(filter);
};

const refusal: (filter: string) => string = (filter: string): string => {
  try {
    parseScimFilter(filter);
  } catch (err) {
    expect(err).toBeInstanceOf(ScimFilterError);
    return (err as Error).message;
  }

  throw new Error(`The filter was read: ${filter}`);
};

describe("parseScimFilter - what identity providers send", () => {
  test("Okta's userName lookup", () => {
    expect(parse('userName eq "dana.scully@example.com"')).toEqual([
      { attribute: "userName", value: "dana.scully@example.com" },
    ]);
  });

  test("Microsoft Entra ID's externalId lookup", () => {
    expect(
      parse('externalId eq "5f4dcc3b-5aa7-4d1c-9d1f-0123456789ab"'),
    ).toEqual([
      {
        attribute: "externalId",
        value: "5f4dcc3b-5aa7-4d1c-9d1f-0123456789ab",
      },
    ]);
  });

  test("equalities joined by and, in any case", () => {
    expect(
      parse('userName EQ "a@example.com" AND externalId eq "x-1"'),
    ).toEqual([
      { attribute: "userName", value: "a@example.com" },
      { attribute: "externalId", value: "x-1" },
    ]);
  });

  test("a group's displayName", () => {
    expect(parse('displayName eq "Engineering - On Call"')).toEqual([
      { attribute: "displayName", value: "Engineering - On Call" },
    ]);
  });

  test("a value path on members, with an id", () => {
    expect(parse('id eq "group-1" and members[value eq "user-1"]')).toEqual([
      { attribute: "id", value: "group-1" },
      { attribute: "members.value", value: "user-1" },
    ]);
  });

  test("the user schema's URN in front of an attribute is dropped", () => {
    expect(
      parse(
        'urn:ietf:params:scim:schemas:core:2.0:User:userName eq "a@example.com"',
      ),
    ).toEqual([{ attribute: "userName", value: "a@example.com" }]);
  });

  test("booleans, null and numbers compare as themselves", () => {
    expect(parse("active eq true")).toEqual([
      { attribute: "active", value: true },
    ]);
    expect(parse("active eq False")).toEqual([
      { attribute: "active", value: false },
    ]);
    expect(parse("externalId eq null")).toEqual([
      { attribute: "externalId", value: null },
    ]);
    expect(parse("externalId eq 42")).toEqual([
      { attribute: "externalId", value: 42 },
    ]);
  });

  test("JSON escapes in a string are read", () => {
    expect(parse('displayName eq "R\\u0026D \\"Ops\\""')).toEqual([
      { attribute: "displayName", value: 'R&D "Ops"' },
    ]);
  });

  test("extra whitespace is allowed around every part", () => {
    expect(parse('   userName   eq   "a@example.com"   ')).toEqual([
      { attribute: "userName", value: "a@example.com" },
    ]);
  });
});

describe("parseScimFilter - what it refuses", () => {
  test("another operator", () => {
    expect(refusal('userName co "example.com"')).toContain("equalities (eq)");
    expect(refusal('userName sw "dana"')).toContain("equalities (eq)");
  });

  test("or, not and grouping", () => {
    expect(
      refusal('userName eq "a@example.com" or userName eq "b@example.com"'),
    ).toContain('"or"');
    expect(refusal('not (userName eq "a@example.com")')).toBeTruthy();
    expect(refusal('(userName eq "a@example.com")')).toBeTruthy();
  });

  test("an unclosed string, a bad escape, a missing value", () => {
    expect(refusal('userName eq "a@example.com')).toContain("not closed");
    expect(refusal('userName eq "a\\q"')).toContain("bad escape");
    expect(refusal("userName eq")).toBeTruthy();
    expect(refusal("userName eq bare")).toBeTruthy();
  });

  test("an empty filter", () => {
    expect(refusal("")).toBe("The filter is empty.");
    expect(refusal("   ")).toBe("The filter is empty.");
  });

  test("a filter longer than any identity provider sends", () => {
    expect(
      refusal(`userName eq "${"a".repeat(MAX_SCIM_FILTER_LENGTH)}"`),
    ).toContain(String(MAX_SCIM_FILTER_LENGTH));
  });

  test("an unfinished value path", () => {
    expect(refusal('members[value eq "user-1"')).toBeTruthy();
    expect(refusal('members[value co "user-1"]')).toBeTruthy();
  });

  test("trailing text after an equality", () => {
    expect(refusal('userName eq "a@example.com" extra')).toContain(
      "equalities (eq)",
    );
  });

  test("a refusal never repeats the filter's text, which carries addresses", () => {
    for (const filter of [
      'userName co "dana.scully@example.com"',
      'userName eq "dana.scully@example.com" dana.scully',
      'userName eq "dana.scully@example.com',
      'userName eq "dana\\qscully"',
    ]) {
      expect(refusal(filter)).not.toContain("dana");
    }
  });
});

describe("parseScimFilter - long input is read in linear time", () => {
  test("a filter at the length limit made of one long value", () => {
    const value: string = "x".repeat(MAX_SCIM_FILTER_LENGTH - 20);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(parse(`userName eq "${value}"`)).toEqual([
          { attribute: "userName", value: value },
        ]);
      },
      limitInMs: 1000,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });

  test("many and-ed equalities up to the limit", () => {
    const filter: string = Array.from(
      { length: 150 },
      (_: unknown, i: number) => {
        return `externalId eq "${i}"`;
      },
    ).join(" and ");

    expect(filter.length).toBeLessThanOrEqual(MAX_SCIM_FILTER_LENGTH);
    expect(parse(filter)).toHaveLength(150);
  });
});

describe("isScimAttribute and getScimFilterText", () => {
  test("attribute names compare without regard to case", () => {
    expect(isScimAttribute("USERNAME", "userName")).toBe(true);
    expect(isScimAttribute("members.Value", "members.value")).toBe(true);
    expect(isScimAttribute("userName", "externalId")).toBe(false);
  });

  test("the compared text of each kind of value", () => {
    expect(getScimFilterText("a")).toBe("a");
    expect(getScimFilterText(42)).toBe("42");
    expect(getScimFilterText(true)).toBe("true");
    expect(getScimFilterText(null)).toBe(null);
  });
});
