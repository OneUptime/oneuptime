import { describe, expect, test } from "@jest/globals";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import fs from "fs";
import path from "path";

/*
 * How many times an on-call policy starts again after its last escalation
 * rule: what its Repeat Policy card says, so the run and every screen that
 * describes it agree. "Repeat if no one acknowledges" is the switch, and
 * "Number of times to repeat" is how many times - while the switch is off,
 * the policy runs once, whatever number was left behind.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

describe("the repeats a policy allows", () => {
  test("are its number while the switch is on", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).toBe(3);
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 1,
      }),
    ).toBe(1);
  });

  test("are none while the switch is off, whatever the number was left at", () => {
    for (const times of [0, 1, 3, 10]) {
      expect({
        times,
        allowed: getOnCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAcknowledges: false,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
        }),
      }).toEqual({ times, allowed: 0 });
    }
  });

  test("are none for a switch that was never set: a new policy runs once", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).toBe(0);
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: null,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).toBe(0);
    expect(getOnCallPolicyRepeatsAllowed({})).toBe(0);
  });

  test("are none when the switch is on but the number is not set or not above zero", () => {
    for (const times of [undefined, null, 0, -2, Number.NaN]) {
      expect({
        times: String(times),
        allowed: getOnCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAcknowledges: true,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
        }),
      }).toEqual({ times: String(times), allowed: 0 });
    }
  });

  test("are a whole number of repeats", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2.7,
      }),
    ).toBe(2);
  });

  test("are none without a policy: a direct page has none to repeat", () => {
    expect(getOnCallPolicyRepeatsAllowed(undefined)).toBe(0);
    expect(getOnCallPolicyRepeatsAllowed(null)).toBe(0);
  });

  test("take the switch as stored, never a truthy stand-in for it", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: "true" as unknown as boolean,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
      }),
    ).toBe(0);
  });
});

/*
 * Everything that runs a policy, or tells people about a run, reads the
 * repeats through the helper and fetches the switch with the number: a
 * reader that fetched only the number would go back to repeating a policy
 * whose card says "Repeat disabled".
 */
describe("the readers of a run's repeats", () => {
  const READERS: ReadonlyArray<string> = [
    "App/FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
    "Common/Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage.ts",
  ];

  test.each(READERS)(
    "%s reads them through getOnCallPolicyRepeatsAllowed",
    (file: string) => {
      const source: string = readPackageFile(file);

      expect(source).toContain("getOnCallPolicyRepeatsAllowed(");
      expect(source).toContain("repeatPolicyIfNoOneAcknowledges: true,");
      expect(source).toContain(
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,",
      );
    },
  );

  test.each(READERS)(
    "%s never compares against the number on its own",
    (file: string) => {
      const source: string = readPackageFile(file);

      expect(source).not.toContain(
        ".repeatPolicyIfNoOneAcknowledgesNoOfTimes!",
      );
      expect(source).not.toContain(
        "?.repeatPolicyIfNoOneAcknowledgesNoOfTimes ||",
      );
    },
  );

  test("the dashboard's Repeat Policy card reads the switch as the switch, as the run now does", () => {
    const card: string = readPackageFile(
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy.tsx",
    );

    expect(card).toContain(
      "const enabledAndHasCount: boolean = isEnabled && repeatCount > 0;",
    );
    expect(card).toContain(
      '"The policy runs once through all escalation levels. If no one acknowledges, escalation stops here."',
    );
  });
});
