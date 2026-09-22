import {
  AI_COMMAND_STEP_TYPES,
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
  APPROVED_COMMAND_STEP_ID_PREFIX,
  DEFAULT_COMMAND_TIMEOUT_MS,
  INLINE_COMMAND_STEP_ID_PREFIX,
  MAX_COMMAND_LENGTH_CHARS,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_PLAN_COMMANDS,
  MIN_COMMAND_TIMEOUT_MS,
  ROLLBACK_COMMAND_STEP_ID_PREFIX,
  getForwardCommandStepId,
  getRollbackCommandStepId,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the fail-closed parser for AI-composed command plans.
 *
 * AutoRemediationSuggestion.commandPlan is a jsonb column whose content was
 * authored by an AI run and frozen at settle time. Everything that later acts
 * on a plan — the approve API, the plan executor, the verifier — acts on what
 * AiRemediationCommandPlanUtil.parse returns, so parse is the last line of
 * defense between arbitrary stored JSON and commands running on customer
 * infrastructure.
 *
 * The invariant is fail-closed: ANY structural problem in ANY command rejects
 * the WHOLE plan with null — never a partially-valid plan. A Denied verdict,
 * a step type outside Bash/SSH/Kubectl, an SSH command without a credential,
 * a Kubectl command without a cluster, an over-long or empty command, or
 * more than MAX_PLAN_COMMANDS entries must all return null. Cosmetic fields
 * (snapshots, rationale, timeouts, the kubectl tier, execution bookkeeping)
 * instead degrade to safe defaults, because a stale display string must not
 * brick an otherwise executable plan.
 */

const RUNNER_ID: string = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID: string = "33333333-3333-4333-8333-333333333333";
const CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";

function makeCommand(overrides: JSONObject = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: RUNNER_ID,
    runnerNameSnapshot: "prod-runner-1",
    command: "systemctl restart nginx",
    timeoutInMs: 30000,
    rationale: "nginx is not serving requests",
    expectedEffect: "nginx restarts and serves traffic again",
    policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
    ...overrides,
  };
}

function makePlan(
  commands: Array<JSONObject>,
  overrides: JSONObject = {},
): JSONObject {
  return {
    commands: commands,
    ...overrides,
  };
}

function parseOk(json: JSONObject): AiRemediationCommandPlan {
  const plan: AiRemediationCommandPlan | null =
    AiRemediationCommandPlanUtil.parse(json);

  expect(plan).not.toBeNull();

  return plan as AiRemediationCommandPlan;
}

function onlyCommand(json: JSONObject): AiRemediationCommand {
  const plan: AiRemediationCommandPlan = parseOk(json);

  expect(plan.commands).toHaveLength(1);

  return plan.commands[0] as AiRemediationCommand;
}

/*
 * The RunnerJob.stepId prefixes are wire-level: the per-cluster circuit
 * breaker counts inline kubectl jobs by the first, and the rollback arm
 * resolves an interrupted command by the one its lane used. A drift between
 * the lanes would silently exempt a real change from rollback or from the
 * breaker, so the three values and the helpers that build ids are pinned.
 */
describe("AI command step id prefixes", () => {
  test("are pinned literals that end in a dash", () => {
    expect(INLINE_COMMAND_STEP_ID_PREFIX).toBe("ai-command-");
    expect(APPROVED_COMMAND_STEP_ID_PREFIX).toBe("ai-approved-");
    expect(ROLLBACK_COMMAND_STEP_ID_PREFIX).toBe("ai-rollback-");
  });

  test("none is a prefix of another — a startsWith count on one never sees the others", () => {
    const prefixes: Array<string> = [
      INLINE_COMMAND_STEP_ID_PREFIX,
      APPROVED_COMMAND_STEP_ID_PREFIX,
      ROLLBACK_COMMAND_STEP_ID_PREFIX,
    ];
    expect(new Set(prefixes).size).toBe(3);
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) {
          expect(a.startsWith(b)).toBe(false);
        }
      }
    }
  });

  test("getForwardCommandStepId uses the inline prefix only for a command a FullAuto run executed inline", () => {
    expect(
      getForwardCommandStepId({ sequence: 1, wasAutoExecuted: true }),
    ).toBe("ai-command-1");
    expect(
      getForwardCommandStepId({ sequence: 3, wasAutoExecuted: false }),
    ).toBe("ai-approved-3");
    expect(
      getForwardCommandStepId({ sequence: 5, wasAutoExecuted: undefined }),
    ).toBe("ai-approved-5");
  });

  test("getRollbackCommandStepId appends the sequence to the rollback prefix, whichever lane ran the command", () => {
    expect(getRollbackCommandStepId({ sequence: 2 })).toBe("ai-rollback-2");

    // An inline-executed command's undo is a rollback job like any other.
    const inlineCommand: Pick<
      AiRemediationCommand,
      "sequence" | "wasAutoExecuted"
    > = { sequence: 4, wasAutoExecuted: true };
    expect(getRollbackCommandStepId(inlineCommand)).toBe("ai-rollback-4");
  });

  test("forward and rollback ids of the same command never collide", () => {
    for (const wasAutoExecuted of [true, false]) {
      expect(
        getForwardCommandStepId({ sequence: 1, wasAutoExecuted }),
      ).not.toBe(getRollbackCommandStepId({ sequence: 1 }));
    }
  });
});

describe("AI_COMMAND_STEP_TYPES", () => {
  test("permits exactly Bash, SSH and Kubectl, in that order", () => {
    /*
     * This array IS the whitelist parse checks against. Widening it (to
     * Kubernetes, JavaScript, ...) would let the AI compose step types the
     * command lane was never reviewed for. Kubectl is the one cluster lane
     * that was: a single kubectl argv, tiered by KubectlPolicy, on a Runner
     * the cluster's AI page bound.
     */
    expect(AI_COMMAND_STEP_TYPES).toEqual([
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubectl,
    ]);
  });

  test("places Kubectl last, after the two host lanes, with no duplicates", () => {
    expect(AI_COMMAND_STEP_TYPES.indexOf(RunbookStepType.Kubectl)).toBe(
      AI_COMMAND_STEP_TYPES.length - 1,
    );
    expect(AI_COMMAND_STEP_TYPES.indexOf(RunbookStepType.SSH)).toBeLessThan(
      AI_COMMAND_STEP_TYPES.indexOf(RunbookStepType.Kubectl),
    );
    expect(new Set(AI_COMMAND_STEP_TYPES).size).toBe(
      AI_COMMAND_STEP_TYPES.length,
    );
  });

  test("admits Kubectl but never the structured Kubernetes runbook step", () => {
    /*
     * The structured Kubernetes step (restart/scale with a credential) is
     * runbook-only. AI reaches a cluster through Kubectl, whose every argv
     * passes the tier policy — the structured step has no such policy.
     */
    expect(AI_COMMAND_STEP_TYPES).toContain(RunbookStepType.Kubectl);
    expect(AI_COMMAND_STEP_TYPES).not.toContain(RunbookStepType.Kubernetes);
  });

  test("excludes every other runbook step type", () => {
    const excluded: Array<RunbookStepType> = Object.values(
      RunbookStepType,
    ).filter((type: RunbookStepType) => {
      return !AI_COMMAND_STEP_TYPES.includes(type);
    });

    expect(excluded.slice().sort()).toEqual(
      [
        RunbookStepType.Manual,
        RunbookStepType.JavaScript,
        RunbookStepType.HttpRequest,
        RunbookStepType.AI,
        RunbookStepType.Kubernetes,
      ]
        .slice()
        .sort(),
    );
  });
});

describe("hard caps", () => {
  test("the caps are pinned to their reviewed values", () => {
    /*
     * These are enforcement values, not tuning knobs — the policy review of
     * this feature was done against exactly these numbers.
     */
    expect(MAX_PLAN_COMMANDS).toBe(5);
    expect(MAX_COMMAND_LENGTH_CHARS).toBe(2000);
    expect(MIN_COMMAND_TIMEOUT_MS).toBe(1000);
    expect(MAX_COMMAND_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(60 * 1000);
  });
});

describe("AiRemediationCommandPlanUtil.parse — top-level input", () => {
  test("null returns null", () => {
    expect(AiRemediationCommandPlanUtil.parse(null)).toBeNull();
  });

  test("undefined returns null", () => {
    expect(AiRemediationCommandPlanUtil.parse(undefined)).toBeNull();
  });

  test("non-object primitives return null", () => {
    // jsonb can hold a bare string or number; parse must not choke on it.
    const nonObjects: Array<unknown> = ["plan", 42, true, 0, ""];

    for (const input of nonObjects) {
      expect(
        AiRemediationCommandPlanUtil.parse(input as unknown as JSONObject),
      ).toBeNull();
    }
  });

  test("a top-level array returns null", () => {
    // typeof [] === "object", so the commands lookup is the real guard.
    expect(
      AiRemediationCommandPlanUtil.parse([
        makeCommand(),
      ] as unknown as JSONObject),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — commands field", () => {
  test("missing commands returns null", () => {
    expect(AiRemediationCommandPlanUtil.parse({})).toBeNull();
  });

  test("non-array commands returns null", () => {
    const nonArrays: Array<unknown> = [
      {},
      "systemctl restart nginx",
      7,
      true,
      null,
    ];

    for (const commands of nonArrays) {
      expect(
        AiRemediationCommandPlanUtil.parse({
          commands: commands,
        } as JSONObject),
      ).toBeNull();
    }
  });

  test("an empty commands array returns null", () => {
    // A plan with nothing to execute is not a plan.
    expect(AiRemediationCommandPlanUtil.parse(makePlan([]))).toBeNull();
  });

  test("exactly MAX_PLAN_COMMANDS commands parses", () => {
    const commands: Array<JSONObject> = [];

    for (let i: number = 0; i < MAX_PLAN_COMMANDS; i++) {
      commands.push(makeCommand({ sequence: i + 1 }));
    }

    const plan: AiRemediationCommandPlan = parseOk(makePlan(commands));

    expect(plan.commands).toHaveLength(MAX_PLAN_COMMANDS);
  });

  test("one command over MAX_PLAN_COMMANDS rejects the whole plan", () => {
    const commands: Array<JSONObject> = [];

    for (let i: number = 0; i < MAX_PLAN_COMMANDS + 1; i++) {
      commands.push(makeCommand({ sequence: i + 1 }));
    }

    expect(AiRemediationCommandPlanUtil.parse(makePlan(commands))).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — command entries", () => {
  test("non-object entries return null", () => {
    const nonObjects: Array<unknown> = [
      null,
      "systemctl restart nginx",
      42,
      true,
    ];

    for (const entry of nonObjects) {
      expect(
        AiRemediationCommandPlanUtil.parse({
          commands: [entry],
        } as JSONObject),
      ).toBeNull();
    }
  });

  test("one invalid entry among valid ones poisons the whole plan", () => {
    /*
     * Fail-closed means all-or-nothing: the executor must never see a plan
     * with the bad command silently dropped, because sequence numbers and
     * rollback pairing would then refer to commands that no longer exist.
     */
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({ sequence: 1 }),
          makeCommand({ sequence: 2, command: "   " }),
          makeCommand({ sequence: 3 }),
        ]),
      ),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — stepType", () => {
  test("Bash parses and carries every provided field through", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand()]),
    );

    expect(command).toEqual({
      sequence: 1,
      stepType: RunbookStepType.Bash,
      runnerId: RUNNER_ID,
      runnerNameSnapshot: "prod-runner-1",
      credentialId: undefined,
      credentialNameSnapshot: undefined,
      command: "systemctl restart nginx",
      timeoutInMs: 30000,
      rationale: "nginx is not serving requests",
      expectedEffect: "nginx restarts and serves traffic again",
      rollbackCommand: undefined,
      policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      wasAutoExecuted: false,
      execution: undefined,
      rollbackExecution: undefined,
    });
  });

  test("SSH parses when a credentialId is present", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          stepType: RunbookStepType.SSH,
          credentialId: CREDENTIAL_ID,
          credentialNameSnapshot: "web-01 root key",
        }),
      ]),
    );

    expect(command.stepType).toBe(RunbookStepType.SSH);
    expect(command.credentialId).toBe(CREDENTIAL_ID);
    expect(command.credentialNameSnapshot).toBe("web-01 root key");
  });

  test("Kubectl parses with its cluster, and carries the cluster snapshot and tier through", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          stepType: RunbookStepType.Kubectl,
          command: "kubectl rollout restart deployment/web -n web",
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterNameSnapshot: "prod-us",
          kubectlTier: KubectlCommandTier.SafeWrite,
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        }),
      ]),
    );

    expect(command.stepType).toBe(RunbookStepType.Kubectl);
    expect(command.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(command.kubernetesClusterNameSnapshot).toBe("prod-us");
    expect(command.kubectlTier).toBe(KubectlCommandTier.SafeWrite);
    // The cluster's bound Runner still travels on the command.
    expect(command.runnerId).toBe(RUNNER_ID);
    expect(command.credentialId).toBeUndefined();
  });

  test("Kubectl without a kubernetesClusterId returns null", () => {
    /*
     * The executor enqueues a kubectl job against the cluster the command
     * names; a command with no cluster has nowhere safe to run.
     */
    for (const clusterId of [undefined, "", "   ", 42, null]) {
      expect(
        AiRemediationCommandPlanUtil.parse(
          makePlan([
            makeCommand({
              stepType: RunbookStepType.Kubectl,
              command: "kubectl rollout restart deployment/web -n web",
              kubernetesClusterId: clusterId,
            } as JSONObject),
          ]),
        ),
      ).toBeNull();
    }
  });

  test("a Kubectl command without a runnerId still returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({
            stepType: RunbookStepType.Kubectl,
            command: "kubectl rollout restart deployment/web -n web",
            kubernetesClusterId: CLUSTER_ID,
            runnerId: "",
          }),
        ]),
      ),
    ).toBeNull();
  });

  test("an unknown kubectlTier degrades to undefined rather than rejecting the plan", () => {
    /*
     * The tier is informational on the card; execution re-evaluates the
     * command. A junk tier must not brick an otherwise executable plan.
     */
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          stepType: RunbookStepType.Kubectl,
          command: "kubectl rollout restart deployment/web -n web",
          kubernetesClusterId: CLUSTER_ID,
          kubectlTier: "Harmless",
        }),
      ]),
    );

    expect(command.kubectlTier).toBeUndefined();
  });

  test("Bash and SSH commands ignore cluster fields", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          kubernetesClusterId: CLUSTER_ID,
          kubectlTier: KubectlCommandTier.Read,
        }),
      ]),
    );

    // Parsed verbatim (the fields are optional), but the lane is still Bash.
    expect(command.stepType).toBe(RunbookStepType.Bash);
    expect(command.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(command.kubectlTier).toBe(KubectlCommandTier.Read);
  });

  test.each([
    RunbookStepType.Kubernetes,
    RunbookStepType.JavaScript,
    RunbookStepType.Manual,
    RunbookStepType.HttpRequest,
    RunbookStepType.AI,
  ])(
    "real step type %s outside the whitelist returns null",
    (stepType: RunbookStepType) => {
      /*
       * Kubernetes and JavaScript are legitimate Runner step types, which is
       * exactly why they must be refused here — the AI command lane was only
       * reviewed for Bash, SSH and the policy-tiered Kubectl lane.
       */
      expect(
        AiRemediationCommandPlanUtil.parse(
          makePlan([makeCommand({ stepType: stepType })]),
        ),
      ).toBeNull();
    },
  );

  test("junk step type strings return null", () => {
    const junk: Array<unknown> = [
      "bash",
      "Shell",
      "",
      " SSH",
      "SSH ",
      "kubectl",
      "KUBECTL",
      "Kubectl ",
      42,
    ];

    for (const stepType of junk) {
      expect(
        AiRemediationCommandPlanUtil.parse(
          makePlan([makeCommand({ stepType: stepType } as JSONObject)]),
        ),
      ).toBeNull();
    }
  });

  test("a missing stepType returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ stepType: undefined })]),
      ),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — command string", () => {
  test("a missing command returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ command: undefined })]),
      ),
    ).toBeNull();
  });

  test("a non-string command returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ command: 42 })]),
      ),
    ).toBeNull();
  });

  test("an empty command returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ command: "" })]),
      ),
    ).toBeNull();
  });

  test("a whitespace-only command returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ command: " \t\n " })]),
      ),
    ).toBeNull();
  });

  test("a command of exactly MAX_COMMAND_LENGTH_CHARS parses", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({ command: "x".repeat(MAX_COMMAND_LENGTH_CHARS) }),
      ]),
    );

    expect(command.command).toHaveLength(MAX_COMMAND_LENGTH_CHARS);
  });

  test("a command one char over MAX_COMMAND_LENGTH_CHARS returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({ command: "x".repeat(MAX_COMMAND_LENGTH_CHARS + 1) }),
        ]),
      ),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — runnerId", () => {
  test("a missing runnerId returns null", () => {
    // A command with no target is unexecutable; there is no default Runner.
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ runnerId: undefined })]),
      ),
    ).toBeNull();
  });

  test("a whitespace-only runnerId returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ runnerId: "   " })]),
      ),
    ).toBeNull();
  });

  test("a non-string runnerId returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ runnerId: 7 })]),
      ),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — SSH credential requirement", () => {
  test("SSH without a credentialId returns null", () => {
    // The Runner cannot open a session without a credential to resolve.
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ stepType: RunbookStepType.SSH })]),
      ),
    ).toBeNull();
  });

  test("SSH with a whitespace-only credentialId returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({
            stepType: RunbookStepType.SSH,
            credentialId: "   ",
          }),
        ]),
      ),
    ).toBeNull();
  });

  test("SSH with a non-string credentialId returns null", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({ stepType: RunbookStepType.SSH, credentialId: 42 }),
        ]),
      ),
    ).toBeNull();
  });

  test("Bash needs no credentialId and parses it to undefined", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ credentialNameSnapshot: 42 })]),
    );

    expect(command.credentialId).toBeUndefined();
    expect(command.credentialNameSnapshot).toBeUndefined();
  });
});

describe("AiRemediationCommandPlanUtil.parse — policyVerdict", () => {
  test("AutoApproved is preserved", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        }),
      ]),
    );

    expect(command.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.AutoApproved,
    );
  });

  test("RequiresApproval is preserved", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        }),
      ]),
    );

    expect(command.policyVerdict).toBe(
      AiRemediationCommandPolicyVerdict.RequiresApproval,
    );
  });

  test("a Denied verdict rejects the whole plan", () => {
    /*
     * Denied commands must never have been stored — a plan carrying one is
     * evidence of a bug or tampering upstream, so nothing in it may run.
     */
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({
            policyVerdict: AiRemediationCommandPolicyVerdict.Denied,
          }),
        ]),
      ),
    ).toBeNull();
  });

  test("one Denied command among approved ones still rejects everything", () => {
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([
          makeCommand({ sequence: 1 }),
          makeCommand({
            sequence: 2,
            policyVerdict: AiRemediationCommandPolicyVerdict.Denied,
          }),
        ]),
      ),
    ).toBeNull();
  });

  test("junk verdicts return null", () => {
    const junk: Array<unknown> = ["Approved", "denied", "", 1, true];

    for (const verdict of junk) {
      expect(
        AiRemediationCommandPlanUtil.parse(
          makePlan([makeCommand({ policyVerdict: verdict } as JSONObject)]),
        ),
      ).toBeNull();
    }
  });

  test("a missing verdict returns null", () => {
    // No verdict means policy never ran — that must not read as approval.
    expect(
      AiRemediationCommandPlanUtil.parse(
        makePlan([makeCommand({ policyVerdict: undefined })]),
      ),
    ).toBeNull();
  });
});

describe("AiRemediationCommandPlanUtil.parse — timeoutInMs", () => {
  function timeoutOf(timeoutInMs: unknown): number {
    return onlyCommand(
      makePlan([makeCommand({ timeoutInMs: timeoutInMs } as JSONObject)]),
    ).timeoutInMs;
  }

  test("an in-range timeout is preserved", () => {
    expect(timeoutOf(30000)).toBe(30000);
  });

  test.each([0, 5, -100])(
    "below-minimum timeout %p clamps to MIN",
    (timeoutInMs: number) => {
      expect(timeoutOf(timeoutInMs)).toBe(MIN_COMMAND_TIMEOUT_MS);
    },
  );

  test("an above-maximum timeout clamps to MAX", () => {
    expect(timeoutOf(MAX_COMMAND_TIMEOUT_MS + 1)).toBe(MAX_COMMAND_TIMEOUT_MS);
    expect(timeoutOf(Number.MAX_SAFE_INTEGER)).toBe(MAX_COMMAND_TIMEOUT_MS);
  });

  test("exactly MIN and exactly MAX pass through unclamped", () => {
    expect(timeoutOf(MIN_COMMAND_TIMEOUT_MS)).toBe(MIN_COMMAND_TIMEOUT_MS);
    expect(timeoutOf(MAX_COMMAND_TIMEOUT_MS)).toBe(MAX_COMMAND_TIMEOUT_MS);
  });

  test("a fractional timeout is floored", () => {
    expect(timeoutOf(1500.9)).toBe(1500);
  });

  test.each(["60000", true, null])(
    "non-number timeout %p falls back to the default",
    (timeoutInMs: unknown) => {
      expect(timeoutOf(timeoutInMs)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
    },
  );

  test("a missing timeout falls back to the default", () => {
    expect(timeoutOf(undefined)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
  });

  test("NaN falls back to the default", () => {
    // typeof NaN === "number"; the finite check is what catches it.
    expect(timeoutOf(NaN)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
  });

  test("Infinity and -Infinity fall back to the default", () => {
    expect(timeoutOf(Infinity)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
    expect(timeoutOf(-Infinity)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
  });
});

describe("AiRemediationCommandPlanUtil.parse — sequence ordering", () => {
  test("out-of-order sequences sort ascending", () => {
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([
        makeCommand({ sequence: 3, command: "third" }),
        makeCommand({ sequence: 1, command: "first" }),
        makeCommand({ sequence: 2, command: "second" }),
      ]),
    );

    expect(
      plan.commands.map((command: AiRemediationCommand) => {
        return command.command;
      }),
    ).toEqual(["first", "second", "third"]);
    expect(
      plan.commands.map((command: AiRemediationCommand) => {
        return command.sequence;
      }),
    ).toEqual([1, 2, 3]);
  });

  test("a non-number sequence defaults to the 1-based position", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ sequence: "first" })]),
    );

    expect(command.sequence).toBe(1);
  });

  test("all-missing sequences keep input order via positional defaults", () => {
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([
        makeCommand({ sequence: undefined, command: "a" }),
        makeCommand({ sequence: undefined, command: "b" }),
      ]),
    );

    expect(
      plan.commands.map((command: AiRemediationCommand) => {
        return command.command;
      }),
    ).toEqual(["a", "b"]);
    expect(
      plan.commands.map((command: AiRemediationCommand) => {
        return command.sequence;
      }),
    ).toEqual([1, 2]);
  });

  test("duplicate sequences keep input order (stable sort)", () => {
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([
        makeCommand({ sequence: 1, command: "a" }),
        makeCommand({ sequence: 1, command: "b" }),
      ]),
    );

    expect(
      plan.commands.map((command: AiRemediationCommand) => {
        return command.command;
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("AiRemediationCommandPlanUtil.parse — cosmetic field defaulting", () => {
  test("a minimal command parses with every default applied", () => {
    const command: AiRemediationCommand = onlyCommand({
      commands: [
        {
          stepType: RunbookStepType.Bash,
          command: "uptime",
          runnerId: RUNNER_ID,
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        },
      ],
    });

    expect(command).toEqual({
      sequence: 1,
      stepType: RunbookStepType.Bash,
      runnerId: RUNNER_ID,
      runnerNameSnapshot: "Runner",
      credentialId: undefined,
      credentialNameSnapshot: undefined,
      command: "uptime",
      timeoutInMs: DEFAULT_COMMAND_TIMEOUT_MS,
      rationale: "",
      expectedEffect: "",
      rollbackCommand: undefined,
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      wasAutoExecuted: false,
      execution: undefined,
      rollbackExecution: undefined,
    });
  });

  test('a non-string runnerNameSnapshot defaults to "Runner"', () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ runnerNameSnapshot: 42 })]),
    );

    expect(command.runnerNameSnapshot).toBe("Runner");
  });

  test("non-string rationale and expectedEffect default to empty strings", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ rationale: 1, expectedEffect: false })]),
    );

    expect(command.rationale).toBe("");
    expect(command.expectedEffect).toBe("");
  });
});

describe("AiRemediationCommandPlanUtil.parse — rollbackCommand", () => {
  test("a whitespace-only rollbackCommand becomes undefined", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ rollbackCommand: " \t " })]),
    );

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("a non-string rollbackCommand becomes undefined", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ rollbackCommand: 42 })]),
    );

    expect(command.rollbackCommand).toBeUndefined();
  });

  test("a valid rollbackCommand is kept verbatim", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ rollbackCommand: "systemctl stop nginx" })]),
    );

    expect(command.rollbackCommand).toBe("systemctl stop nginx");
  });
});

describe("AiRemediationCommandPlanUtil.parse — wasAutoExecuted", () => {
  test("boolean true is preserved", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ wasAutoExecuted: true })]),
    );

    expect(command.wasAutoExecuted).toBe(true);
  });

  test("anything that is not literally true parses to false", () => {
    /*
     * "true", 1, etc. must not read as auto-executed — this flag drives what
     * the approve API is allowed to skip.
     */
    const notTrue: Array<unknown> = ["true", 1, false, undefined, null];

    for (const value of notTrue) {
      const command: AiRemediationCommand = onlyCommand(
        makePlan([makeCommand({ wasAutoExecuted: value } as JSONObject)]),
      );

      expect(command.wasAutoExecuted).toBe(false);
    }
  });
});

describe("AiRemediationCommandPlanUtil.parse — execution state", () => {
  test("a fully-populated execution state parses field by field", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          execution: {
            status: AiRemediationCommandExecutionStatus.Failed,
            runnerJobId: "job-1",
            output: "connection refused",
            exitCode: 1,
            errorMessage: "exited with code 1",
            startedAt: "2026-08-04T10:00:00.000Z",
            completedAt: "2026-08-04T10:00:05.000Z",
          },
        }),
      ]),
    );

    expect(command.execution).toEqual({
      status: AiRemediationCommandExecutionStatus.Failed,
      runnerJobId: "job-1",
      output: "connection refused",
      exitCode: 1,
      errorMessage: "exited with code 1",
      startedAt: "2026-08-04T10:00:00.000Z",
      completedAt: "2026-08-04T10:00:05.000Z",
    });
  });

  test.each(Object.values(AiRemediationCommandExecutionStatus))(
    "execution status %s parses",
    (status: AiRemediationCommandExecutionStatus) => {
      const command: AiRemediationCommand = onlyCommand(
        makePlan([makeCommand({ execution: { status: status } })]),
      );

      expect(command.execution?.status).toBe(status);
    },
  );

  test("an invalid execution status drops the execution state, not the plan", () => {
    /*
     * Execution state is bookkeeping about the past, not authorization for
     * the future — corrupt bookkeeping degrades to "no state" instead of
     * rejecting a plan whose commands are themselves valid.
     */
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ execution: { status: "Cancelled" } })]),
    );

    expect(command.execution).toBeUndefined();
  });

  test("a command-level status does not accept plan-level enum values", () => {
    // "NotStarted" belongs to AiRemediationPlanExecutionStatus only.
    const command: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ execution: { status: "NotStarted" } })]),
    );

    expect(command.execution).toBeUndefined();
  });

  test("a non-object execution value parses to undefined", () => {
    const nonObjects: Array<unknown> = ["Running", 42, true, null];

    for (const execution of nonObjects) {
      const command: AiRemediationCommand = onlyCommand(
        makePlan([makeCommand({ execution: execution } as JSONObject)]),
      );

      expect(command.execution).toBeUndefined();
    }
  });

  test("wrongly-typed execution fields are dropped individually", () => {
    const command: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          execution: {
            status: AiRemediationCommandExecutionStatus.Succeeded,
            runnerJobId: 42,
            output: { nested: true },
            exitCode: "0",
            errorMessage: 3,
            startedAt: 1720000000,
            completedAt: false,
          },
        }),
      ]),
    );

    expect(command.execution).toEqual({
      status: AiRemediationCommandExecutionStatus.Succeeded,
      runnerJobId: undefined,
      output: undefined,
      exitCode: undefined,
      errorMessage: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
  });

  test("rollbackExecution follows the same rules as execution", () => {
    const parsed: AiRemediationCommand = onlyCommand(
      makePlan([
        makeCommand({
          rollbackExecution: {
            status: AiRemediationCommandExecutionStatus.Skipped,
            output: "never ran",
          },
        }),
      ]),
    );

    expect(parsed.rollbackExecution).toEqual({
      status: AiRemediationCommandExecutionStatus.Skipped,
      runnerJobId: undefined,
      output: "never ran",
      exitCode: undefined,
      errorMessage: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });

    const invalid: AiRemediationCommand = onlyCommand(
      makePlan([makeCommand({ rollbackExecution: { status: "nope" } })]),
    );

    expect(invalid.rollbackExecution).toBeUndefined();
  });
});

describe("AiRemediationCommandPlanUtil.parse — plan-level fields", () => {
  test.each(Object.values(AiRemediationPlanExecutionStatus))(
    "executionStatus %s parses",
    (status: AiRemediationPlanExecutionStatus) => {
      const plan: AiRemediationCommandPlan = parseOk(
        makePlan([makeCommand()], { executionStatus: status }),
      );

      expect(plan.executionStatus).toBe(status);
    },
  );

  test("an invalid executionStatus is dropped, not the plan", () => {
    const invalid: Array<unknown> = ["Cancelled", "", 42, true, null];

    for (const status of invalid) {
      const plan: AiRemediationCommandPlan = parseOk(
        makePlan([makeCommand()], { executionStatus: status } as JSONObject),
      );

      expect(plan.executionStatus).toBeUndefined();
    }
  });

  test("a command-level status is not a valid plan executionStatus", () => {
    // "Pending" belongs to AiRemediationCommandExecutionStatus only.
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([makeCommand()], { executionStatus: "Pending" }),
    );

    expect(plan.executionStatus).toBeUndefined();
  });

  test("string timestamps are preserved", () => {
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([makeCommand()], {
        executionStartedAt: "2026-08-04T10:00:00.000Z",
        executionCompletedAt: "2026-08-04T10:05:00.000Z",
      }),
    );

    expect(plan.executionStartedAt).toBe("2026-08-04T10:00:00.000Z");
    expect(plan.executionCompletedAt).toBe("2026-08-04T10:05:00.000Z");
  });

  test("non-string timestamps are dropped", () => {
    const plan: AiRemediationCommandPlan = parseOk(
      makePlan([makeCommand()], {
        executionStartedAt: 1720000000,
        executionCompletedAt: true,
      } as JSONObject),
    );

    expect(plan.executionStartedAt).toBeUndefined();
    expect(plan.executionCompletedAt).toBeUndefined();
  });

  test.each(Object.values(AiRemediationRollbackStatus))(
    "rollbackStatus %s parses",
    (status: AiRemediationRollbackStatus) => {
      const plan: AiRemediationCommandPlan = parseOk(
        makePlan([makeCommand()], { rollbackStatus: status }),
      );

      expect(plan.rollbackStatus).toBe(status);
    },
  );

  test("an invalid rollbackStatus is dropped, not the plan", () => {
    // "Skipped" is a command execution status, not a rollback status.
    const invalid: Array<unknown> = ["Skipped", "", 42, null];

    for (const status of invalid) {
      const plan: AiRemediationCommandPlan = parseOk(
        makePlan([makeCommand()], { rollbackStatus: status } as JSONObject),
      );

      expect(plan.rollbackStatus).toBeUndefined();
    }
  });

  test("plan-level fields are absent when the raw JSON omits them", () => {
    const plan: AiRemediationCommandPlan = parseOk(makePlan([makeCommand()]));

    expect(plan.executionStatus).toBeUndefined();
    expect(plan.executionStartedAt).toBeUndefined();
    expect(plan.executionCompletedAt).toBeUndefined();
    expect(plan.rollbackStatus).toBeUndefined();
  });
});

describe("AiRemediationCommandPlanUtil.toJSON", () => {
  function richPlanJson(): JSONObject {
    return makePlan(
      [
        makeCommand({
          sequence: 2,
          command: "systemctl restart nginx",
          rollbackCommand: "systemctl stop nginx",
          wasAutoExecuted: true,
          execution: {
            status: AiRemediationCommandExecutionStatus.Succeeded,
            runnerJobId: "job-2",
            output: "ok",
            exitCode: 0,
            startedAt: "2026-08-04T10:00:00.000Z",
            completedAt: "2026-08-04T10:00:03.000Z",
          },
        }),
        makeCommand({
          sequence: 1,
          stepType: RunbookStepType.SSH,
          credentialId: CREDENTIAL_ID,
          credentialNameSnapshot: "web-01 root key",
          command: "df -h /var",
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          rollbackExecution: {
            status: AiRemediationCommandExecutionStatus.Failed,
            errorMessage: "rollback refused",
            exitCode: 1,
          },
        }),
      ],
      {
        executionStatus: AiRemediationPlanExecutionStatus.Completed,
        executionStartedAt: "2026-08-04T10:00:00.000Z",
        executionCompletedAt: "2026-08-04T10:00:10.000Z",
        rollbackStatus: AiRemediationRollbackStatus.NotApplicable,
      },
    );
  }

  test("a parsed plan round-trips through toJSON and parse unchanged", () => {
    /*
     * This is the storage cycle: parse at read, toJSON at write, parse again
     * at the next read. Anything lost or mutated here would drift the stored
     * plan away from what was approved.
     */
    const first: AiRemediationCommandPlan = parseOk(richPlanJson());
    const json: JSONObject = AiRemediationCommandPlanUtil.toJSON(first);
    const second: AiRemediationCommandPlan = parseOk(json);

    expect(second).toEqual(first);
    // The sort must have put the SSH command (sequence 1) first.
    expect(second.commands[0]?.stepType).toBe(RunbookStepType.SSH);
    expect(second.commands[1]?.wasAutoExecuted).toBe(true);
  });

  test("toJSON returns a deep copy, not a live view of the plan", () => {
    const plan: AiRemediationCommandPlan = parseOk(richPlanJson());
    const json: JSONObject = AiRemediationCommandPlanUtil.toJSON(plan);

    const commands: Array<JSONObject> = json["commands"] as Array<JSONObject>;
    (commands[0] as JSONObject)["command"] = "rm -rf /";

    expect(plan.commands[0]?.command).toBe("df -h /var");
  });

  test("toJSON drops undefined optional keys from the stored JSON", () => {
    // jsonb should not accumulate explicit nulls for every optional field.
    const plan: AiRemediationCommandPlan = parseOk(makePlan([makeCommand()]));
    const json: JSONObject = AiRemediationCommandPlanUtil.toJSON(plan);

    const commands: Array<JSONObject> = json["commands"] as Array<JSONObject>;
    const keys: Array<string> = Object.keys(commands[0] as JSONObject);

    expect(keys).not.toContain("credentialId");
    expect(keys).not.toContain("rollbackCommand");
    expect(keys).not.toContain("execution");
    expect(Object.keys(json)).not.toContain("executionStatus");
  });
});
