import RunbookStepType, {
  PAYLOAD_CARRYING_STEP_TYPES,
  RUNNER_EXECUTED_STEP_TYPES,
  isPayloadCarryingStepType,
  isRunnerExecutedStepType,
} from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the one list that decides where a runbook step runs.
 *
 * Every step type is in exactly one of two lanes: it executes on a Runner
 * inside the customer's network (JavaScript, Bash, SSH, Kubernetes), or it
 * executes on the OneUptime Worker (Manual, HttpRequest, AI). The lane is not
 * a preference — a Runner has no implementation for an AI step, and the
 * Worker has no route to a customer's SSH host.
 *
 * Getting the lane wrong is not a graceful failure. Classifying a Worker type
 * as Runner work enqueues a RunnerJob a Runner will claim and cannot
 * execute; classifying a Runner type as Worker work drops the step's agentId
 * on the floor and tries to run customer infrastructure commands on shared
 * OneUptime infrastructure. RunnerJobService.enqueue is the gate, and
 * it asks this function.
 *
 * So the list is pinned member by member, and the partition is checked to be
 * total and disjoint — a new step type must be placed deliberately rather
 * than defaulting into a lane.
 */

const WORKER_EXECUTED_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.Manual,
  RunbookStepType.HttpRequest,
  RunbookStepType.AI,
];

describe("RunbookStepType enum", () => {
  test("the full set of step types is what these tests assume", () => {
    /*
     * If this fails, a step type was added. Decide which lane it belongs in,
     * add it to RUNNER_EXECUTED_STEP_TYPES or to WORKER_EXECUTED_STEP_TYPES
     * above, and only then update this list. Leaving it unplaced is what the
     * partition tests below exist to prevent.
     */
    expect(Object.values(RunbookStepType).sort()).toEqual(
      ["AI", "Bash", "HttpRequest", "JavaScript", "Kubernetes", "Manual", "SSH"]
        .slice()
        .sort(),
    );
  });

  test("each member's value matches its name", () => {
    /*
     * stepType is persisted as a plain string column and travels to the
     * Runner as JSON, so the string IS the wire contract. Renaming a member
     * without keeping the value would orphan every stored step.
     */
    expect(RunbookStepType.Manual).toBe("Manual");
    expect(RunbookStepType.JavaScript).toBe("JavaScript");
    expect(RunbookStepType.HttpRequest).toBe("HttpRequest");
    expect(RunbookStepType.Bash).toBe("Bash");
    expect(RunbookStepType.AI).toBe("AI");
    expect(RunbookStepType.SSH).toBe("SSH");
    expect(RunbookStepType.Kubernetes).toBe("Kubernetes");
  });
});

describe("RUNNER_EXECUTED_STEP_TYPES", () => {
  test("contains exactly JavaScript, Bash, SSH and Kubernetes", () => {
    /*
     * Pinned as an exact list, order included. This array is the whole
     * definition of "work a Runner may be handed" — a silent addition would
     * widen it everywhere at once.
     */
    expect(RUNNER_EXECUTED_STEP_TYPES).toEqual([
      RunbookStepType.JavaScript,
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
    ]);
  });

  test("has exactly four entries and no duplicates", () => {
    expect(RUNNER_EXECUTED_STEP_TYPES).toHaveLength(4);
    expect(new Set(RUNNER_EXECUTED_STEP_TYPES).size).toBe(
      RUNNER_EXECUTED_STEP_TYPES.length,
    );
  });

  test("every entry is a real member of the enum", () => {
    /*
     * The array is typed Array<RunbookStepType>, but the values reach the
     * database and the Runner as strings. A typo'd literal that widened past
     * the type (or arrived through a cast) would be a lane nobody can enter.
     */
    const members: Array<string> = Object.values(RunbookStepType);

    for (const type of RUNNER_EXECUTED_STEP_TYPES) {
      expect(members).toContain(type);
    }
  });

  test("contains no Worker-executed type", () => {
    for (const type of WORKER_EXECUTED_STEP_TYPES) {
      expect(RUNNER_EXECUTED_STEP_TYPES).not.toContain(type);
    }
  });

  test("holds the two step types the credential store exists for", () => {
    // SSH and Kubernetes are useless unless a Runner can be handed them.
    expect(RUNNER_EXECUTED_STEP_TYPES).toContain(RunbookStepType.SSH);
    expect(RUNNER_EXECUTED_STEP_TYPES).toContain(RunbookStepType.Kubernetes);
  });
});

describe("isRunnerExecutedStepType", () => {
  test.each([
    RunbookStepType.JavaScript,
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])("%s runs on a Runner", (type: RunbookStepType) => {
    expect(isRunnerExecutedStepType(type)).toBe(true);
  });

  test.each([
    RunbookStepType.Manual,
    RunbookStepType.HttpRequest,
    RunbookStepType.AI,
  ])("%s runs on the Worker, not a Runner", (type: RunbookStepType) => {
    /*
     * Manual waits on a human, HttpRequest is an outbound call the Worker can
     * already make, and AI needs the model provider and the project's budget
     * — none of which exist on a Runner. Answering true here would hand a
     * Runner a step it has no executor for, and the job would sit claimed
     * until it timed out.
     */
    expect(isRunnerExecutedStepType(type)).toBe(false);
  });

  test("returns a boolean for every member of the enum", () => {
    /*
     * No member may fall through to undefined: RunnerJobService.enqueue
     * branches on `!isRunnerExecutedStepType(...)`, so an undefined answer
     * would read as "the Worker handles it" and quietly refuse to dispatch.
     */
    for (const type of Object.values(RunbookStepType)) {
      const answer: boolean = isRunnerExecutedStepType(type);

      expect(typeof answer).toBe("boolean");
    }
  });

  test("the two lanes together cover every member exactly once", () => {
    /*
     * Total and disjoint. A future step type that is added to the enum but to
     * neither lane fails here rather than being discovered by whichever
     * dispatcher happens to see it first.
     */
    const members: Array<RunbookStepType> = Object.values(RunbookStepType);
    const runner: Array<RunbookStepType> = members.filter(
      (type: RunbookStepType) => {
        return isRunnerExecutedStepType(type);
      },
    );
    const worker: Array<RunbookStepType> = members.filter(
      (type: RunbookStepType) => {
        return !isRunnerExecutedStepType(type);
      },
    );

    expect(runner.length + worker.length).toBe(members.length);
    expect(runner.slice().sort()).toEqual(
      RUNNER_EXECUTED_STEP_TYPES.slice().sort(),
    );
    expect(worker.slice().sort()).toEqual(
      WORKER_EXECUTED_STEP_TYPES.slice().sort(),
    );
  });

  test("agrees with the exported list for every member", () => {
    /*
     * The point of exporting both is that callers may read either one. They
     * must never disagree — the list is the source, the function is a lookup
     * over it.
     */
    for (const type of Object.values(RunbookStepType)) {
      expect(isRunnerExecutedStepType(type)).toBe(
        RUNNER_EXECUTED_STEP_TYPES.includes(type),
      );
    }
  });

  test("does not match on anything that is not a step type", () => {
    /*
     * stepType arrives from a stored JSON step config, so at run time it is
     * whatever string is in the row — not necessarily an enum member.
     */
    const notStepTypes: Array<string> = [
      "",
      " ",
      "Runner",
      "Shell",
      "Docker",
      "undefined",
      "null",
    ];

    for (const value of notStepTypes) {
      expect(isRunnerExecutedStepType(value as RunbookStepType)).toBe(false);
    }
  });

  test("is case- and whitespace-sensitive", () => {
    /*
     * "ssh" is not SSH. A near-miss must be refused outright rather than
     * normalised here, so that the mismatch surfaces at enqueue with a
     * message naming the bad type instead of silently selecting a lane.
     */
    const nearMisses: Array<string> = [
      "ssh",
      "Ssh",
      "SSH ",
      " SSH",
      "kubernetes",
      "KUBERNETES",
      "bash",
      "JAVASCRIPT",
    ];

    for (const value of nearMisses) {
      expect(isRunnerExecutedStepType(value as RunbookStepType)).toBe(false);
    }
  });

  test("null and undefined are not Runner work", () => {
    // Older step rows can carry no stepType at all.
    expect(
      isRunnerExecutedStepType(undefined as unknown as RunbookStepType),
    ).toBe(false);
    expect(isRunnerExecutedStepType(null as unknown as RunbookStepType)).toBe(
      false,
    );
  });
});

/*
 * The second partition, inside the Runner lane: how a job carries its
 * instruction.
 *
 * A Bash or JavaScript job carries a script. An SSH or Kubernetes job carries
 * structured instructions plus a credential resolved at claim time, and an
 * EMPTY script — which is the whole reason this split has to be named
 * somewhere. Issue #3209 was RunnerJob.script being declared a required
 * column: an empty string is falsy, so the required-column check rejected
 * every SSH and Kubernetes job at create() with "script is required". The rule
 * is per-type and cannot be written as column metadata, so it lives in
 * RunnerJobService.enqueue and reads this list.
 */
describe("PAYLOAD_CARRYING_STEP_TYPES", () => {
  test("contains exactly SSH and Kubernetes", () => {
    expect(PAYLOAD_CARRYING_STEP_TYPES).toEqual([
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
    ]);
    expect(new Set(PAYLOAD_CARRYING_STEP_TYPES).size).toBe(
      PAYLOAD_CARRYING_STEP_TYPES.length,
    );
  });

  test("every entry is also a Runner-executed type", () => {
    /*
     * A payload-carrying type that the Worker executes would be a
     * contradiction: the payload exists to be handed to a Runner.
     */
    for (const type of PAYLOAD_CARRYING_STEP_TYPES) {
      expect(RUNNER_EXECUTED_STEP_TYPES).toContain(type);
    }
  });
});

describe("isPayloadCarryingStepType", () => {
  test.each([RunbookStepType.SSH, RunbookStepType.Kubernetes])(
    "%s carries a payload rather than a script",
    (type: RunbookStepType) => {
      expect(isPayloadCarryingStepType(type)).toBe(true);
    },
  );

  test.each([RunbookStepType.Bash, RunbookStepType.JavaScript])(
    "%s carries a script rather than a payload",
    (type: RunbookStepType) => {
      /*
       * Answering true for a script type would let a Bash job with no script
       * through enqueue, and the Runner would spawn an empty shell and report
       * success — indistinguishable from a step that actually ran.
       */
      expect(isPayloadCarryingStepType(type)).toBe(false);
    },
  );

  test("the Runner lane splits cleanly into script-carrying and payload-carrying", () => {
    /*
     * Total and disjoint within the Runner lane. enqueue treats the two as
     * complementary — anything not payload-carrying is required to bring a
     * script — so a new Runner type that belongs in neither set does not
     * exist, and a new one added to the enum must be placed here deliberately.
     */
    const payload: Array<RunbookStepType> = RUNNER_EXECUTED_STEP_TYPES.filter(
      (type: RunbookStepType) => {
        return isPayloadCarryingStepType(type);
      },
    );
    const script: Array<RunbookStepType> = RUNNER_EXECUTED_STEP_TYPES.filter(
      (type: RunbookStepType) => {
        return !isPayloadCarryingStepType(type);
      },
    );

    expect(payload.slice().sort()).toEqual(
      PAYLOAD_CARRYING_STEP_TYPES.slice().sort(),
    );
    expect(script.slice().sort()).toEqual(
      [RunbookStepType.JavaScript, RunbookStepType.Bash].slice().sort(),
    );
    expect(payload.length + script.length).toBe(
      RUNNER_EXECUTED_STEP_TYPES.length,
    );
  });

  test("agrees with the exported list for every member of the enum", () => {
    for (const type of Object.values(RunbookStepType)) {
      const answer: boolean = isPayloadCarryingStepType(type);

      expect(typeof answer).toBe("boolean");
      expect(answer).toBe(PAYLOAD_CARRYING_STEP_TYPES.includes(type));
    }
  });

  test("no Worker-executed type carries a payload", () => {
    for (const type of WORKER_EXECUTED_STEP_TYPES) {
      expect(isPayloadCarryingStepType(type)).toBe(false);
    }
  });

  test("near misses, null and undefined do not carry a payload", () => {
    /*
     * Falling back to false is the safe direction: an unrecognised type is
     * then required to bring a script, and enqueue rejects it rather than
     * creating a job with nothing in it.
     */
    const notPayloadTypes: Array<unknown> = [
      "",
      " ",
      "ssh",
      "SSH ",
      "kubernetes",
      "Docker",
      null,
      undefined,
    ];

    for (const value of notPayloadTypes) {
      expect(isPayloadCarryingStepType(value as RunbookStepType)).toBe(false);
    }
  });
});
