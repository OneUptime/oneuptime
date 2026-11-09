import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_KEY_LENGTH,
  SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES,
  SECURITY_EVENT_SCOPE_MAX_OBSERVABLES,
  SECURITY_EVENT_SCOPE_MAX_VALUE_LENGTH,
  SECURITY_EVENT_SCOPE_QUERY_KEY,
  SecurityEventScope,
  hasSecurityEventScopeMatch,
  readSecurityEventScope,
} from "../../../Types/SecurityEvent/SecurityEventScope";

/*
 * The security events about one record (issue #5769): what a network
 * device's Security Events page reads every list, chart and facet under.
 * Read from an untrusted query, so every list is bounded and every value
 * checked before the statement generator compiles it.
 */

const DEVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000dd";

describe("the scope's query key", () => {
  test("is a key of its own, which no column of the table has", () => {
    expect(SECURITY_EVENT_SCOPE_QUERY_KEY).toBe("securityEventScope");
  });
});

describe("readSecurityEventScope", () => {
  test("reads a record's identities and its own logs' attribute", () => {
    expect(
      readSecurityEventScope({
        observables: ["core-fw-1", "CORE-FW-1", "203.0.113.7"],
        attributeKey: "networkDevice.id",
        attributeValues: [DEVICE_ID],
      }),
    ).toEqual({
      observables: ["core-fw-1", "CORE-FW-1", "203.0.113.7"],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID],
    });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "core-fw-1"],
    ["a number", 7],
    ["a list", ["core-fw-1"]],
    ["true", true],
  ])("%s is no scope at all", (_case: string, value: unknown) => {
    expect(readSecurityEventScope(value)).toBeNull();
  });

  test("an empty object is a scope that names nothing", () => {
    expect(readSecurityEventScope({})).toEqual({ observables: [] });
  });

  test("keeps the strings of the list, trimmed, each once, in order", () => {
    expect(
      readSecurityEventScope({
        observables: [
          " core-fw-1 ",
          "core-fw-1",
          "",
          "   ",
          7,
          null,
          { value: "x" },
          ["y"],
          "fw.example.com",
        ],
      })?.observables,
    ).toEqual(["core-fw-1", "fw.example.com"]);
  });

  test("keeps the case it was given: each spelling is searched for as stored", () => {
    expect(
      readSecurityEventScope({ observables: ["web-1", "WEB-1"] })?.observables,
    ).toEqual(["web-1", "WEB-1"]);
  });

  test("an observables value that is not a list reads as none", () => {
    expect(
      readSecurityEventScope({ observables: "core-fw-1" })?.observables,
    ).toEqual([]);
  });

  test("a value longer than any identity is dropped, never cut", () => {
    const longest: string = "a".repeat(SECURITY_EVENT_SCOPE_MAX_VALUE_LENGTH);
    const tooLong: string = `${longest}b`;

    expect(
      readSecurityEventScope({ observables: [tooLong, longest, "core-fw-1"] })
        ?.observables,
    ).toEqual([longest, "core-fw-1"]);
  });

  test("the list is bounded", () => {
    const values: Array<string> = Array.from(
      { length: SECURITY_EVENT_SCOPE_MAX_OBSERVABLES + 25 },
      (_: unknown, index: number): string => {
        return `host-${index}`;
      },
    );

    const scope: SecurityEventScope | null = readSecurityEventScope({
      observables: values,
    });

    expect(scope?.observables).toHaveLength(
      SECURITY_EVENT_SCOPE_MAX_OBSERVABLES,
    );
    expect(scope?.observables[0]).toBe("host-0");
  });

  test("the attribute's key is trimmed", () => {
    expect(
      readSecurityEventScope({
        observables: [],
        attributeKey: "  networkDevice.id ",
        attributeValues: [` ${DEVICE_ID} `],
      }),
    ).toEqual({
      observables: [],
      attributeKey: "networkDevice.id",
      attributeValues: [DEVICE_ID],
    });
  });

  test.each([
    ["no key", { attributeValues: [DEVICE_ID] }],
    ["an empty key", { attributeKey: "  ", attributeValues: [DEVICE_ID] }],
    [
      "a key that is not text",
      { attributeKey: 7, attributeValues: [DEVICE_ID] },
    ],
    [
      "a key longer than any",
      {
        attributeKey: "k".repeat(
          SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_KEY_LENGTH + 1,
        ),
        attributeValues: [DEVICE_ID],
      },
    ],
    ["no values", { attributeKey: "networkDevice.id" }],
    ["empty values", { attributeKey: "networkDevice.id", attributeValues: [] }],
    [
      "values that are not text",
      { attributeKey: "networkDevice.id", attributeValues: [1, null, ""] },
    ],
  ])(
    "%s leaves the attribute out",
    (_case: string, value: Record<string, unknown>) => {
      const scope: SecurityEventScope | null = readSecurityEventScope({
        observables: ["core-fw-1"],
        ...value,
      });

      expect(scope).toEqual({ observables: ["core-fw-1"] });
      expect(scope?.attributeKey).toBeUndefined();
      expect(scope?.attributeValues).toBeUndefined();
    },
  );

  test("the attribute's values are bounded", () => {
    const values: Array<string> = Array.from(
      { length: SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES + 5 },
      (_: unknown, index: number): string => {
        return `value-${index}`;
      },
    );

    expect(
      readSecurityEventScope({
        attributeKey: "networkDevice.id",
        attributeValues: values,
      })?.attributeValues,
    ).toHaveLength(SECURITY_EVENT_SCOPE_MAX_ATTRIBUTE_VALUES);
  });

  test("reads nothing it was not asked to", () => {
    expect(
      readSecurityEventScope({
        observables: ["core-fw-1"],
        projectId: "another project",
        sql: "1=1",
      }),
    ).toEqual({ observables: ["core-fw-1"] });
  });
});

describe("hasSecurityEventScopeMatch", () => {
  test.each([
    ["no scope", undefined],
    ["null", null],
    ["a scope naming nothing", { observables: [] }],
    [
      "an attribute with no values",
      {
        observables: [],
        attributeKey: "networkDevice.id",
        attributeValues: [],
      },
    ],
    [
      "values with no attribute",
      { observables: [], attributeValues: [DEVICE_ID] },
    ],
  ])("%s matches nothing", (_case: string, scope: unknown) => {
    expect(hasSecurityEventScopeMatch(scope as SecurityEventScope | null)).toBe(
      false,
    );
  });

  test("an identity to name matches", () => {
    expect(hasSecurityEventScopeMatch({ observables: ["core-fw-1"] })).toBe(
      true,
    );
  });

  test("the record's own logs match", () => {
    expect(
      hasSecurityEventScopeMatch({
        observables: [],
        attributeKey: "networkDevice.id",
        attributeValues: [DEVICE_ID],
      }),
    ).toBe(true);
  });
});
