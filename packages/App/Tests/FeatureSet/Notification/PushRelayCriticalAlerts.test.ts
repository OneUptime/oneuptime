import {
  parseRelaySound,
  parseRelayInterruptionLevel,
} from "../../../FeatureSet/Notification/API/PushRelay";
import BadDataException from "Common/Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The relay is how a self-hosted OneUptime without its own EXPO_ACCESS_TOKEN
 * gets pages onto phones: it re-sends the payload through a gateway that has
 * one. Two things make its parsing worth pinning.
 *
 * First, it is the only hop where a critical alert can quietly lose the fields
 * that make it critical. A relay that dropped `sound` would deliver every page
 * as an ordinary notification - no error, no log, just a responder who sleeps
 * through the incident.
 *
 * Second, the endpoint is unauthenticated (rate limited by client IP alone),
 * so whatever it forwards is forwarded under this deployment's Expo
 * credentials. Structures it does not understand are refused rather than
 * passed along.
 */

describe("parseRelaySound - the shapes a real page arrives in", () => {
  test("passes a critical alert sound object through intact", () => {
    expect(
      parseRelaySound({ critical: true, name: "default", volume: 1 }),
    ).toEqual({
      critical: true,
      name: "default",
      volume: 1,
    });
  });

  test('passes the ordinary "default" string through', () => {
    expect(parseRelaySound("default")).toBe("default");
  });

  test("undefined means the caller said nothing", () => {
    /*
     * Distinct from null. The send path turns undefined into "default" and
     * leaves null alone, so collapsing the two here would make it impossible
     * to request a silent notification.
     */
    expect(parseRelaySound(undefined)).toBeUndefined();
  });

  test("null is honoured as an explicit request for a silent notification", () => {
    expect(parseRelaySound(null)).toBeNull();
  });

  test("a partial critical object keeps only the fields that were sent", () => {
    expect(parseRelaySound({ critical: true })).toEqual({ critical: true });
  });

  test("an empty object is accepted and carries nothing", () => {
    expect(parseRelaySound({})).toEqual({});
  });

  test("critical: false survives, so a caller can explicitly de-escalate", () => {
    expect(parseRelaySound({ critical: false })).toEqual({ critical: false });
  });

  test("a custom sound name is preserved", () => {
    expect(parseRelaySound({ critical: true, name: "klaxon.wav" })).toEqual({
      critical: true,
      name: "klaxon.wav",
    });
  });

  test("a null sound name inside the object is preserved", () => {
    expect(parseRelaySound({ critical: true, name: null })).toEqual({
      critical: true,
      name: null,
    });
  });
});

describe("parseRelaySound - volume", () => {
  test("keeps a volume inside the valid range", () => {
    expect(parseRelaySound({ volume: 0.5 })).toEqual({ volume: 0.5 });
  });

  test("clamps a volume above 1 rather than dropping the page", () => {
    /*
     * Out of range is a caller bug, not an attack. Refusing would turn a
     * cosmetic mistake into an undelivered page, which is the wrong trade for
     * an on-call product.
     */
    expect(parseRelaySound({ volume: 11 })).toEqual({ volume: 1 });
  });

  test("clamps a negative volume to zero", () => {
    expect(parseRelaySound({ volume: -3 })).toEqual({ volume: 0 });
  });

  test("accepts zero volume without treating it as absent", () => {
    expect(parseRelaySound({ volume: 0 })).toEqual({ volume: 0 });
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ['the string "1"', "1"],
    ["null", null],
    ["an object", {}],
  ])("refuses a volume of %s", (_label: string, volume: unknown) => {
    expect(() => {
      return parseRelaySound({ volume: volume });
    }).toThrow(BadDataException);
  });
});

describe("parseRelaySound - structures it will not forward", () => {
  test.each([
    ["a number", 7],
    ["a boolean", true],
    ["an array", ["default"]],
  ])("refuses %s", (_label: string, raw: unknown) => {
    expect(() => {
      return parseRelaySound(raw);
    }).toThrow(BadDataException);
  });

  test("refuses a non-boolean critical flag", () => {
    expect(() => {
      return parseRelaySound({ critical: "true" });
    }).toThrow("Push notification sound 'critical' must be a boolean.");
  });

  test("refuses a non-string sound name", () => {
    expect(() => {
      return parseRelaySound({ name: 42 });
    }).toThrow("Push notification sound 'name' must be a string or null.");
  });

  test("refuses an absurdly long sound name string", () => {
    expect(() => {
      return parseRelaySound("x".repeat(101));
    }).toThrow("Push notification sound name is too long.");
  });

  test("refuses an absurdly long sound name inside the object", () => {
    expect(() => {
      return parseRelaySound({ name: "x".repeat(101) });
    }).toThrow("Push notification sound name is too long.");
  });

  test("accepts a name exactly at the length limit", () => {
    const name: string = "x".repeat(100);

    expect(parseRelaySound(name)).toBe(name);
  });

  test("ignores unknown keys rather than forwarding them to Expo", () => {
    /*
     * The parser rebuilds the object from the three fields it knows. Anything
     * else a caller attaches is dropped here rather than sent onward under
     * this deployment's Expo credentials.
     */
    expect(
      parseRelaySound({
        critical: true,
        somethingElse: "surprise",
        __proto__: { polluted: true },
      }),
    ).toEqual({ critical: true });
  });
});

describe("parseRelayInterruptionLevel", () => {
  test.each(["active", "critical", "passive", "time-sensitive"])(
    "accepts %s",
    (level: string) => {
      expect(parseRelayInterruptionLevel(level)).toBe(level);
    },
  );

  test("critical is accepted, because it is the whole point on iOS", () => {
    expect(parseRelayInterruptionLevel("critical")).toBe("critical");
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("treats %s as not specified", (_label: string, raw: unknown) => {
    expect(parseRelayInterruptionLevel(raw)).toBeUndefined();
  });

  test.each([
    ["an unknown level", "urgent"],
    ["a differently-cased level", "Critical"],
    ["a number", 1],
    ["a boolean", true],
    ["an object", {}],
    ["an empty string", ""],
  ])("refuses %s", (_label: string, raw: unknown) => {
    expect(() => {
      return parseRelayInterruptionLevel(raw);
    }).toThrow(BadDataException);
  });

  test("the refusal lists the levels that are allowed", () => {
    expect(() => {
      return parseRelayInterruptionLevel("urgent");
    }).toThrow("active, critical, passive, time-sensitive");
  });
});
