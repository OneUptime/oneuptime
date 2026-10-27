import { classifyDeviceRole } from "../../../Utils/Monitor/NetworkDeviceRoleUtil";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { patternWith } from "../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A DEVICE'S DESCRIPTION IS CLASSIFIED IN TIME IN LINE WITH ITS LENGTH, AND
 * GIVEN THE ROLE IT WAS GIVEN BEFORE.
 *
 * The role of a device on the topology comes from what it says about itself
 * (sysDescr, an LLDP or CDP neighbour's description), which the server reads
 * for every topology it draws. The rule for an IQ Engine access point - a
 * word holding "ap" where a part of it starts, then ", hiveos" or ", iq
 * engine" - was tried from every such "ap" of a long word, each try reading
 * the rest of the word again. It now reads each word once.
 * ---------------------------------------------------------------------------
 */

const ROLE_FILE: string =
  "packages/Common/Utils/Monitor/NetworkDeviceRoleUtil.ts";

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("a description is classified in time in line with its length", () => {
  test.each([
    [
      "an access point word over and over",
      repeat("hiveos-ap-", LENGTH) + "hiveos",
    ],
    ["word parts that start with ap", "x " + repeat("ap-", LENGTH) + "x"],
    ["one long word after ap", "ap" + repeat("w", LENGTH) + ", hive"],
  ])("%s", (_label: string, sysDescr: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        classifyDeviceRole({ sysDescr });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("a description is given the role it was given before", () => {
  test.each([
    ["AP230, HiveOS 8.2r1 build-190112", "wirelessAccessPoint"],
    ["HiveAP330, HiveOS 6.5r8b build-171544", "wirelessAccessPoint"],
    ["AP305C-1, HiveOS 10.6r2 build-a41c0e9", "wirelessAccessPoint"],
    ["AP4000, IQ Engine 10.7r1", "wirelessAccessPoint"],
    ["U6+ 6.6.62", "wirelessAccessPoint"],
  ])("%s", (sysDescr: string, role: string) => {
    expect(classifyDeviceRole({ sysDescr })).toBe(role);
  });

  test("an Aerohive switch on the same platform is not an access point", () => {
    expect(
      classifyDeviceRole({
        sysDescr: "SR2024P, HiveOS 6.5r5 Honolulu build-133702",
      }),
    ).not.toBe("wirelessAccessPoint");
  });
});

describe("the access point rule finds exactly what it found before", () => {
  test("on forty thousand drawn descriptions", () => {
    const before: RegExp =
      /\b(?:u6\+|u7-|uk-ultra|(?:hive)?ap[\w-]*, (?:hiveos|iq engine))/;
    const now: RegExp = patternWith(ROLE_FILE, "iq engine");
    const mismatches: Array<{ text: string; now: boolean; before: boolean }> =
      [];
    let found: number = 0;

    for (const text of generatedTexts(
      40000,
      8118,
      [
        "ap",
        "hive",
        "hiveap",
        "ap230",
        "-",
        "_",
        " ",
        ", ",
        ", hiveos",
        ", iq engine",
        "hiveos",
        "u6+",
        "u7-",
        "uk-ultra",
        "x",
        "1",
        ".",
        "a",
        "p",
      ],
      10,
    )) {
      const expected: boolean = before.test(text);
      const actual: boolean = now.test(text);

      if (expected) {
        found++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(found).toBeGreaterThan(5000);
  });
});
