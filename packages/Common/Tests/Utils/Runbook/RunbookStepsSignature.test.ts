import { describe, expect, test } from "@jest/globals";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import getRunbookStepsSignatureDefault, {
  getRunbookStepsSignature,
} from "../../../Utils/Runbook/RunbookStepsSignature";

/*
 * What a runbook's Steps page compares to know its steps are unsaved
 * (issue #7401): the steps as Save Steps would write them, in one string.
 * The same steps give the same string however their objects were built;
 * anything Save Steps would write differently gives another. So a change
 * undone - a step moved and moved back, a switch flipped twice - leaves
 * nothing unsaved, and leaving the page asks nothing.
 */

function steps(): Array<RunbookStep> {
  return [
    {
      id: "check",
      order: 0,
      type: RunbookStepType.Manual,
      title: "Check the dashboards",
      description: "Confirm the error rate is falling.",
      config: {},
    },
    {
      id: "primary",
      order: 1,
      type: RunbookStepType.JavaScript,
      title: "Work out the new primary",
      config: { script: "return 1;", agentId: "" },
      continueOnFailure: false,
    },
    {
      id: "page",
      order: 2,
      type: RunbookStepType.HttpRequest,
      title: "Page the database team",
      config: {
        method: "POST",
        url: "https://events.example.com/v2/enqueue",
        headersJson: '{ "Content-Type": "application/json" }',
      },
    },
  ];
}

const signature: (value: Array<RunbookStep>) => string = (
  value: Array<RunbookStep>,
): string => {
  return getRunbookStepsSignature(value);
};

function moved(
  value: Array<RunbookStep>,
  from: number,
  to: number,
): Array<RunbookStep> {
  const copy: Array<RunbookStep> = [...value];
  const [step] = copy.splice(from, 1);
  copy.splice(to, 0, step!);
  return copy;
}

describe("the same steps give the same signature", () => {
  test("built twice", () => {
    expect(signature(steps())).toBe(signature(steps()));
  });

  test("however each object's keys were ordered: a config spread into a copy, keys read back from jsonb", () => {
    const reordered: Array<RunbookStep> = steps().map(
      (step: RunbookStep): RunbookStep => {
        const keys: Array<string> = Object.keys(step).reverse();
        const copy: Record<string, unknown> = {};

        for (const key of keys) {
          copy[key] = (step as unknown as Record<string, unknown>)[key];
        }

        copy["config"] = Object.fromEntries(
          Object.entries(step.config as Record<string, unknown>).reverse(),
        );
        return copy as unknown as RunbookStep;
      },
    );

    expect(signature(reordered)).toBe(signature(steps()));
  });

  test("a key left undefined is left out, as the JSON Save Steps writes leaves it out", () => {
    const withUndefined: Array<RunbookStep> = steps();
    // As a spread copy can carry them: present, and undefined.
    Object.assign(withUndefined[0]!, { continueOnFailure: undefined });
    Object.assign(withUndefined[1]!, { description: undefined });
    expect(Object.keys(withUndefined[0]!)).toContain("continueOnFailure");

    expect(signature(withUndefined)).toBe(signature(steps()));
  });

  test("each step is numbered by its place, as Save Steps numbers them, whatever order it carried", () => {
    const stale: Array<RunbookStep> = steps().map(
      (step: RunbookStep): RunbookStep => {
        return { ...step, order: 7 };
      },
    );

    expect(signature(stale)).toBe(signature(steps()));
    expect(signature([])).toBe("[]");
  });

  test("a step moved and moved back", () => {
    const there: Array<RunbookStep> = moved(steps(), 0, 2);
    const back: Array<RunbookStep> = moved(there, 2, 0);

    expect(signature(there)).not.toBe(signature(steps()));
    expect(signature(back)).toBe(signature(steps()));
  });

  test("a switch flipped twice", () => {
    const flipped: Array<RunbookStep> = steps();
    flipped[1] = { ...flipped[1]!, continueOnFailure: true };
    const flippedBack: Array<RunbookStep> = [...flipped];
    flippedBack[1] = { ...flipped[1]!, continueOnFailure: false };

    expect(signature(flipped)).not.toBe(signature(steps()));
    expect(signature(flippedBack)).toBe(signature(steps()));
  });

  test("the steps it is handed are left as they were", () => {
    const value: Array<RunbookStep> = steps().map(
      (step: RunbookStep): RunbookStep => {
        return { ...step, order: 9 };
      },
    );

    signature(value);

    expect(
      value.map((step: RunbookStep): number => {
        return step.order;
      }),
    ).toEqual([9, 9, 9]);
  });
});

describe("any change Save Steps would write gives another signature", () => {
  const changes: Array<[string, (value: Array<RunbookStep>) => void]> = [
    [
      "a step added",
      (value: Array<RunbookStep>): void => {
        value.push({
          id: "new",
          order: 3,
          type: RunbookStepType.Manual,
          title: "",
          config: {},
        });
      },
    ],
    [
      "a step removed",
      (value: Array<RunbookStep>): void => {
        value.splice(1, 1);
      },
    ],
    [
      "the last step removed",
      (value: Array<RunbookStep>): void => {
        value.splice(0, value.length);
      },
    ],
    [
      "a title edited",
      (value: Array<RunbookStep>): void => {
        value[0]!.title = "Check the graphs";
      },
    ],
    [
      "a description cleared",
      (value: Array<RunbookStep>): void => {
        value[0]!.description = "";
      },
    ],
    [
      "a switch turned on",
      (value: Array<RunbookStep>): void => {
        value[1]!.requireApprovalBeforeRunning = true;
      },
    ],
    [
      "a script edited",
      (value: Array<RunbookStep>): void => {
        value[1]!.config = { script: "return 2;", agentId: "" };
      },
    ],
    [
      "a Runner picked",
      (value: Array<RunbookStep>): void => {
        value[1]!.config = { script: "return 1;", agentId: "runner-1" };
      },
    ],
    [
      "a nested value changed",
      (value: Array<RunbookStep>): void => {
        (value[2]!.config as Record<string, unknown>)["headersJson"] = "{}";
      },
    ],
    [
      "a step's type changed",
      (value: Array<RunbookStep>): void => {
        value[0]!.type = RunbookStepType.Bash;
      },
    ],
    [
      "two steps swapped",
      (value: Array<RunbookStep>): void => {
        const first: RunbookStep = value[0]!;
        value[0] = value[1]!;
        value[1] = first;
      },
    ],
  ];

  test.each(changes)(
    "%s",
    (_: string, change: (v: Array<RunbookStep>) => void) => {
      const changed: Array<RunbookStep> = steps();
      change(changed);

      expect(signature(changed)).not.toBe(signature(steps()));
    },
  );
});

test("the default export is the same function", () => {
  expect(getRunbookStepsSignatureDefault).toBe(getRunbookStepsSignature);
});
