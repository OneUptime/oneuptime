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
 * whose card says "Stop paging".
 */
describe("the readers of a run's repeats", () => {
  /*
   * What decides whether a run starts again, or says it will: moving a run
   * on (OnCallEscalationAdvance, which the worker and a page passed on both
   * use), what passing a page on would do, and the run's chat message.
   */
  const DECIDERS: ReadonlyArray<string> = [
    "Common/Server/Utils/OnCall/OnCallEscalationAdvance.ts",
    "Common/Server/Utils/OnCall/OnCallPagePassOn.ts",
    "Common/Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage.ts",
  ];

  // What reads the run they are decided on: the switch, with the number.
  const FETCHERS: ReadonlyArray<string> = [
    "App/FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
    "Common/Server/Utils/OnCall/OnCallPagePassOn.ts",
    "Common/Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage.ts",
  ];

  /*
   * The dashboard's Repeat Policy card: the shared RepeatChoiceCard, drawn
   * from the on-call policy's RepeatChoice config.
   */
  const REPEAT_CHOICE: string =
    "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoice.ts";
  const REPEAT_CHOICE_CARD: string =
    "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoiceCard.tsx";

  const READERS: ReadonlyArray<string> = Array.from(
    new Set<string>([
      ...DECIDERS,
      ...FETCHERS,
      REPEAT_CHOICE,
      REPEAT_CHOICE_CARD,
    ]),
  );

  test.each(DECIDERS)(
    "%s reads them through getOnCallPolicyRepeatsAllowed",
    (file: string) => {
      expect(readPackageFile(file)).toContain("getOnCallPolicyRepeatsAllowed(");
    },
  );

  test.each(FETCHERS)(
    "%s fetches the switch with the number",
    (file: string) => {
      const source: string = readPackageFile(file);

      expect(source).toContain("repeatPolicyIfNoOneAcknowledges: true,");
      expect(source).toContain(
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,",
      );
    },
  );

  test("the worker hands the run it read, policy settings and all, to the one way a run moves on", () => {
    const worker: string = readPackageFile(
      "App/FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts",
    );

    expect(worker).toContain("OnCallEscalationAdvance.advance({");
    expect(worker).toContain("run: executionLog,");
  });

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

  /*
   * The card fetches the switch with the number and says what the pair does
   * through ON_CALL_POLICY_REPEAT.getRepeatsAllowed, which is this helper,
   * so it shows "Stop paging" exactly when a run would not start again.
   * Tests/App/Dashboard/RepeatChoice.test.ts holds that reading against the
   * helper for every switch and number.
   */
  test("the dashboard's Repeat Policy card reads the switch as the switch, as the run now does", () => {
    const card: string = readPackageFile(
      "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy.tsx",
    );
    const choice: string = readPackageFile(REPEAT_CHOICE);
    const choiceCard: string = readPackageFile(REPEAT_CHOICE_CARD);

    expect(card).toContain("<RepeatChoiceCard<OnCallDutyPolicy>");
    expect(card).toContain("config={ON_CALL_POLICY_REPEAT}");

    const onCallStart: number = choice.indexOf(
      "export const ON_CALL_POLICY_REPEAT",
    );
    const onCallEnd: number = choice.indexOf(
      "export const INCOMING_CALL_POLICY_REPEAT",
    );

    expect(onCallStart).toBeGreaterThanOrEqual(0);
    expect(onCallEnd).toBeGreaterThan(onCallStart);

    const onCallConfig: string = choice.slice(onCallStart, onCallEnd);

    expect(onCallConfig).toContain(
      'repeat: "repeatPolicyIfNoOneAcknowledges",',
    );
    expect(onCallConfig).toContain(
      'times: "repeatPolicyIfNoOneAcknowledgesNoOfTimes",',
    );
    expect(onCallConfig).toContain("return getOnCallPolicyRepeatsAllowed({");
    expect(choice).toContain(
      "return config.getRepeatsAllowed(asRecord(values)) > 0",
    );

    expect(choiceCard).toContain("[props.config.columns.repeat]: true,");
    expect(choiceCard).toContain("[props.config.columns.times]: true,");
    expect(choiceCard).toContain("getRepeatChoice(props.config, props.item)");
  });
});
