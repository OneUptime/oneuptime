import {
  parseCriticalAlertFlag,
  parseCriticalAlertFlagStrict,
} from "../../../Server/API/UserPushAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Two parsers, deliberately different, for the two ways this flag arrives.
 *
 * REGISTRATION is a bulk operation the app performs on its own - once per
 * project, on login, on every token refresh - and the field is frequently
 * absent (an older app build, a web client, a hand-rolled integration).
 * Absent has to mean "off", because a device registration is not a place a
 * person decides to be woken through Do Not Disturb.
 *
 * The TOGGLE is a person moving a switch. There, an unrecognised value is a
 * bug in the caller, and reading it as "off" would tell that person their
 * phone will not wake them - or worse, quietly disable an override they had
 * working. It is refused instead.
 */

describe("parseCriticalAlertFlag - device registration", () => {
  test.each([
    ["a JSON boolean true", true],
    ['the string "true", as form posts send it', "true"],
  ])("treats %s as opted in", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertFlag(raw)).toBe(true);
  });

  test.each([
    ["undefined - the field was not sent at all", undefined],
    ["null", null],
    ["a JSON boolean false", false],
    ['the string "false"', "false"],
    ["an empty string", ""],
  ])("treats %s as not opted in", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertFlag(raw)).toBe(false);
  });

  test.each([
    ['the string "TRUE"', "TRUE"],
    ['the string "yes"', "yes"],
    ['the string "1"', "1"],
    ["the number 1", 1],
    ["an object", { enabled: true }],
    ["an array", [true]],
  ])(
    "does not let %s turn the override on by accident",
    (_label: string, raw: unknown) => {
      /*
       * Every one of these is truthy in JavaScript. A `Boolean(raw)` here
       * would silently opt devices in from junk input, which is the wrong
       * direction for a setting that defeats a phone's silent mode.
       */
      expect(parseCriticalAlertFlag(raw)).toBe(false);
    },
  );

  test("always returns a real boolean, never a truthy value", () => {
    expect(typeof parseCriticalAlertFlag("true")).toBe("boolean");
    expect(typeof parseCriticalAlertFlag(undefined)).toBe("boolean");
  });
});

describe("parseCriticalAlertFlagStrict - the settings toggle", () => {
  test.each([
    ["a JSON boolean true", true],
    ['the string "true"', "true"],
  ])("accepts %s as on", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertFlagStrict(raw)).toBe(true);
  });

  test.each([
    ["a JSON boolean false", false],
    ['the string "false"', "false"],
  ])("accepts %s as off", (_label: string, raw: unknown) => {
    expect(parseCriticalAlertFlagStrict(raw)).toBe(false);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ['"yes"', "yes"],
    ['"TRUE"', "TRUE"],
    ["1", 1],
    ["0", 0],
    ["an object", {}],
    ["an array", []],
    ["an empty string", ""],
  ])("refuses %s rather than guessing", (_label: string, raw: unknown) => {
    expect(() => {
      return parseCriticalAlertFlagStrict(raw);
    }).toThrow(BadDataException);
  });

  test("the refusal says what a valid value looks like", () => {
    expect(() => {
      return parseCriticalAlertFlagStrict("maybe");
    }).toThrow("isEnabled must be either true or false.");
  });

  test("turning the setting OFF is never mistaken for a malformed request", () => {
    /*
     * `false` is falsy, so any guard written as `if (!isEnabled) throw` would
     * make the switch impossible to turn off - it would appear to work in the
     * UI and revert on the next screen load.
     */
    expect(parseCriticalAlertFlagStrict(false)).toBe(false);
    expect(() => {
      return parseCriticalAlertFlagStrict(false);
    }).not.toThrow();
  });
});
