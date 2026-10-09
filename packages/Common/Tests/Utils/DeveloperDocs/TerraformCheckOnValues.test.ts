import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";

/*
 * The Terraform provider validates a filter's check_on against its own list
 * (monitorStepsCheckOnValues in Scripts/TerraformProvider/StaticFiles/
 * monitorsteps.go), so a value the API accepts but the list lacks is refused
 * at plan time: "check_on value must be one of ...".
 *
 * Thirteen values had drifted out of it (the Port timings, Security Event
 * Count, the SNMP walk, table, trap varbind and transceiver checks) by the
 * time the NTP monitor added six more (issue #4617). This holds the two
 * lists together, so the next CheckOn cannot be forgotten there.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const MONITOR_STEPS_GO: string = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts/TerraformProvider/StaticFiles/monitorsteps.go"),
  "utf8",
);

// One quoted value per line inside the Go slice literal.
const GO_STRING_LINE: RegExp = /^\s+"([^"]+)",$/gm;

function goCheckOnValues(): Array<string> {
  const start: number = MONITOR_STEPS_GO.indexOf(
    "var monitorStepsCheckOnValues = []string{",
  );

  if (start === -1) {
    throw new Error("monitorsteps.go has no monitorStepsCheckOnValues");
  }

  const end: number = MONITOR_STEPS_GO.indexOf("\n}\n", start);
  const body: string = MONITOR_STEPS_GO.slice(start, end);

  return Array.from(body.matchAll(GO_STRING_LINE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const ENUM_VALUES: Array<string> = Object.values(CheckOn) as Array<string>;

describe("the Terraform provider's check_on values", () => {
  test("include every CheckOn the API accepts", () => {
    const goValues: Array<string> = goCheckOnValues();

    expect(
      ENUM_VALUES.filter((value: string): boolean => {
        return !goValues.includes(value);
      }),
    ).toEqual([]);
  });

  test("name nothing the API no longer accepts", () => {
    expect(
      goCheckOnValues().filter((value: string): boolean => {
        return !ENUM_VALUES.includes(value);
      }),
    ).toEqual([]);
  });

  test("list each value once, in the enum's own order", () => {
    expect(goCheckOnValues()).toEqual(ENUM_VALUES);
  });

  test("include the NTP checks", () => {
    expect(goCheckOnValues()).toEqual(
      expect.arrayContaining([
        "NTP Is Online",
        "NTP Is Synchronized",
        "NTP Stratum",
        "NTP Clock Offset (in ms)",
        "NTP Response Time (in ms)",
        "NTP Root Dispersion (in ms)",
      ]),
    );
  });

  test("this test reads the list it means to", () => {
    // The provider's own Go test refuses a list shorter than 70.
    expect(goCheckOnValues().length).toBeGreaterThan(70);
  });
});
