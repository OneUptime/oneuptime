import BadDataException from "../../../Types/Exception/BadDataException";
import { MerakiRegion } from "../../../Types/NetworkController/MerakiRegion";
import {
  DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES,
  MAX_API_KEY_LENGTH,
  MAX_ORGANIZATION_NAME_LENGTH,
  NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES,
  cleanOrganizationName,
  readMerakiApiKey,
  readMerakiOrganizationId,
  readNetworkControllerConfig,
  readNetworkControllerReadInterval,
  toNetworkControllerConfigJson,
  validateNetworkControllerConfig,
} from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Meraki connection keeps besides its key, and the checks every
 * writer is held to: a save refuses what a read could not use (a region
 * that is not Meraki's, an interval that is not a choice, an organization
 * ID that cannot be one, a key that cannot be a key) - while a read of what
 * is stored never throws.
 */

const KEY: string = "0123456789abcdef0123456789abcdef01234567";

describe("the API key", () => {
  test("a Meraki key is kept, trimmed", () => {
    expect(readMerakiApiKey(`  ${KEY}\n`)).toBe(KEY);
  });

  test.each([
    [undefined, "Enter the Meraki dashboard API key"],
    ["", "Enter the Meraki dashboard API key"],
    ["   ", "Enter the Meraki dashboard API key"],
    [42, "Enter the Meraki dashboard API key"],
    ["short", "not a Meraki dashboard API key"],
    ["0123456789abcdef 0123456789abcdef", "not a Meraki dashboard API key"],
    ["0123456789abcdefé0123456789abcdef", "not a Meraki dashboard API key"],
    ["x".repeat(MAX_API_KEY_LENGTH + 1), "not a Meraki dashboard API key"],
  ])("%p is refused with what to do", (value: unknown, words: string) => {
    expect(() => {
      return readMerakiApiKey(value);
    }).toThrow(BadDataException);
    expect(() => {
      return readMerakiApiKey(value);
    }).toThrow(words);
  });

  test("a key of a future shape (not 40 hex characters) is not refused", () => {
    expect(readMerakiApiKey("AbCdEf-0123456789_xyz.ABCDEF")).toBe(
      "AbCdEf-0123456789_xyz.ABCDEF",
    );
  });
});

describe("the organization", () => {
  test("an ID is letters, digits, '_' and '-'", () => {
    expect(readMerakiOrganizationId(" 123456 ")).toBe("123456");
    expect(readMerakiOrganizationId(549236)).toBe("549236");
    expect(readMerakiOrganizationId("L_123-abc")).toBe("L_123-abc");
    expect(readMerakiOrganizationId(undefined)).toBe("");
    expect(readMerakiOrganizationId("")).toBe("");
  });

  test.each([["12/34"], ["../networks"], ["123 456"], ["x".repeat(65)], [{}]])(
    "%p cannot be one: it would reach a URL path",
    (value: unknown) => {
      expect(() => {
        return readMerakiOrganizationId(value);
      }).toThrow(BadDataException);
    },
  );

  test("a name is cleaned of control characters and cut", () => {
    expect(cleanOrganizationName("  Acme\u0000 Corp\n ")).toBe("Acme  Corp");
    expect(cleanOrganizationName("A".repeat(500))).toHaveLength(
      MAX_ORGANIZATION_NAME_LENGTH,
    );
    expect(cleanOrganizationName(7)).toBe("");
  });
});

describe("how often uplinks are read", () => {
  test("five minutes by default, one of the choices otherwise", () => {
    expect(DEFAULT_NETWORK_CONTROLLER_READ_INTERVAL_IN_MINUTES).toBe(5);
    expect(NETWORK_CONTROLLER_READ_INTERVALS_IN_MINUTES).toEqual([
      5, 10, 15, 30, 60,
    ]);
    expect(readNetworkControllerReadInterval(30)).toBe(30);
    expect(readNetworkControllerReadInterval("60")).toBe(60);
    expect(readNetworkControllerReadInterval(7)).toBe(5);
    expect(readNetworkControllerReadInterval("soon")).toBe(5);
    expect(readNetworkControllerReadInterval(undefined)).toBe(5);
  });
});

describe("validating what is saved", () => {
  test("a full config is kept as asked", () => {
    expect(
      validateNetworkControllerConfig(
        {
          region: "canada",
          organizationId: "123",
          organizationName: "Acme",
          readIntervalInMinutes: 15,
        },
        { requireOrganization: true },
      ),
    ).toEqual({
      region: MerakiRegion.Canada,
      organizationId: "123",
      organizationName: "Acme",
      readIntervalInMinutes: 15,
    });
  });

  test("left out, the region is the global dashboard's and the interval five minutes", () => {
    expect(
      validateNetworkControllerConfig(
        { organizationId: "9" },
        { requireOrganization: true },
      ),
    ).toEqual({
      region: MerakiRegion.Global,
      organizationId: "9",
      organizationName: "",
      readIntervalInMinutes: 5,
    });
  });

  test("a test before an organization is picked needs none", () => {
    expect(
      validateNetworkControllerConfig({}, { requireOrganization: false })
        .organizationId,
    ).toBe("");
    expect(() => {
      return validateNetworkControllerConfig({}, { requireOrganization: true });
    }).toThrow("Pick the Meraki organization to read");
  });

  test.each([
    [{ region: "mars", organizationId: "1" }, "Region must be one of"],
    [{ readIntervalInMinutes: 7, organizationId: "1" }, "Read every must be"],
    [{ organizationId: "1/2" }, "not one Meraki gives"],
    [{ organizationId: "1", baseUrl: "https://evil.example" }, 'no "baseUrl"'],
    [["region"], "Settings must be an object"],
  ])(
    "%p is refused, never quietly replaced",
    (value: unknown, words: string) => {
      expect(() => {
        return validateNetworkControllerConfig(value, {
          requireOrganization: true,
        });
      }).toThrow(words);
    },
  );

  test("no host is ever taken from what is sent: a config cannot name one", () => {
    expect(() => {
      return validateNetworkControllerConfig(
        { organizationId: "1", apiHost: "attacker.example" },
        { requireOrganization: true },
      );
    }).toThrow(BadDataException);
  });
});

describe("reading what is stored", () => {
  test("never throws: unknown values read as defaults", () => {
    expect(
      readNetworkControllerConfig({
        region: "mars",
        organizationId: "12/3",
        organizationName: 5,
        readIntervalInMinutes: "never",
      }),
    ).toEqual({
      region: MerakiRegion.Global,
      organizationId: "",
      organizationName: "",
      readIntervalInMinutes: 5,
    });
    expect(readNetworkControllerConfig(null).region).toBe(MerakiRegion.Global);
    expect(readNetworkControllerConfig([1, 2]).organizationId).toBe("");
  });

  test("round-trips through the JSON it is stored as", () => {
    const config: ReturnType<typeof readNetworkControllerConfig> = {
      region: MerakiRegion.India,
      organizationId: "777",
      organizationName: "Branches",
      readIntervalInMinutes: 10,
    };

    expect(
      readNetworkControllerConfig(toNetworkControllerConfigJson(config)),
    ).toEqual(config);
  });
});
