import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_PLAYBOOK_ACTION_TITLES,
  SELF_APPROVAL_SENTENCE,
  WAITING_FOR_APPROVAL,
  describePlaybookTarget,
  didStartPlaybookRun,
  getKeptTargetValues,
  getPlaybookActionTitle,
  readPlaybookTargets,
  readWaitingPlaybookStep,
  type PlaybookRunRecord,
  type PlaybookTarget,
  type WaitingPlaybookStep,
} from "./playbookApproval";

/*
 * A playbook run waiting for somebody to approve its next step, as the case's
 * screen shows it and as the approval route reads the answer. The run's
 * stored steps and results come straight off the API, so every reading here
 * is defensive: a run written by an older version, or an entry that does not
 * read, shows what can be read rather than failing the screen a page landed
 * on.
 */

const RUN_ID: string = "7a6b0000-0001-4000-8000-000000000001";
const CASE_ID: string = "5ec0ca5e-0142-4d1a-9a00-000000000142";
const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";

function waitingRun(
  overrides: Partial<PlaybookRunRecord> = {},
): PlaybookRunRecord {
  return {
    _id: RUN_ID,
    securityCaseId: CASE_ID,
    playbookName: "Contain a compromised account",
    status: WAITING_FOR_APPROVAL,
    trigger: "Case Opened",
    currentStepIndex: 1,
    steps: [
      { id: "step-1", action: "Check Threat Intel" },
      { id: "step-2", action: "Suspend Okta User" },
    ],
    stepResults: [
      { stepId: "step-1", action: "Check Threat Intel", status: "Succeeded" },
      {
        stepId: "step-2",
        action: "Suspend Okta User",
        status: WAITING_FOR_APPROVAL,
        targets: [
          {
            type: "User",
            value: "alice@acme.test",
            reason: "Grouped On",
            state: "Proposed",
          },
          {
            type: "User",
            value: "mallory@acme.test",
            reason: "Threat Intel",
            state: "Proposed",
          },
          {
            type: "User",
            value: "breakglass-admin@acme.test",
            reason: "Threat Intel",
            state: "Protected",
            protectedBy: "breakglass-*",
          },
        ],
      },
    ],
    triggeredByUserId: null,
    startedAt: "2026-09-10T09:47:00.000Z",
    ...overrides,
  };
}

function read(run: PlaybookRunRecord): WaitingPlaybookStep {
  const step: WaitingPlaybookStep | null = readWaitingPlaybookStep(run);
  if (!step) {
    throw new Error("Expected a waiting step");
  }
  return step;
}

describe("the step a run waits on", () => {
  test("is its current step, by the title the dashboard reads", () => {
    const step: WaitingPlaybookStep = read(waitingRun());

    expect(step).toMatchObject({
      runId: RUN_ID,
      caseId: CASE_ID,
      playbookName: "Contain a compromised account",
      stepNumber: 2,
      stepTitle: "Suspend the user in Okta",
      startedBy: "Started on its own when the case opened",
      startedByUserId: null,
      startedAt: "2026-09-10T09:47:00.000Z",
    });
  });

  test("lists the targets to tick apart from the protected ones", () => {
    const step: WaitingPlaybookStep = read(waitingRun());

    expect(
      step.proposed.map((target: PlaybookTarget) => {
        return target.value;
      }),
    ).toEqual(["alice@acme.test", "mallory@acme.test"]);
    expect(step.protectedTargets).toEqual([
      {
        type: "User",
        value: "breakglass-admin@acme.test",
        reason: "Threat Intel",
        state: "Protected",
        protectedBy: "breakglass-*",
      },
    ]);
  });

  test("a run that is not waiting has no step to decide", () => {
    for (const status of ["Queued", "Running", "Succeeded", "Cancelled"]) {
      expect(readWaitingPlaybookStep(waitingRun({ status }))).toBeNull();
    }
  });

  test("a run without an id cannot be decided, so it is not offered", () => {
    expect(readWaitingPlaybookStep(waitingRun({ _id: undefined }))).toBeNull();
  });

  test("a step whose snapshot no longer reads still shows from its result", () => {
    const step: WaitingPlaybookStep = read(
      waitingRun({ steps: "not a list", currentStepIndex: 1 }),
    );

    expect(step.stepTitle).toBe("Suspend the user in Okta");
    expect(step.proposed).toHaveLength(2);
  });

  test("an action this build does not know reads by its own name", () => {
    const step: WaitingPlaybookStep = read(
      waitingRun({
        steps: [{ id: "s", action: "Quarantine Mailbox" }],
        stepResults: [],
        currentStepIndex: 0,
      }),
    );

    expect(step.stepTitle).toBe("Quarantine Mailbox");
    expect(step.proposed).toEqual([]);
  });

  test("a step with no action at all is named by its place", () => {
    const step: WaitingPlaybookStep = read(
      waitingRun({ steps: [], stepResults: [], currentStepIndex: 2 }),
    );

    expect(step.stepTitle).toBe("Step 3");
    expect(step.stepNumber).toBe(3);
  });

  test("a current step index that is not a whole number reads as the first", () => {
    for (const currentStepIndex of [undefined, null, -1, 1.5, "1"]) {
      expect(
        read(waitingRun({ currentStepIndex: currentStepIndex as unknown }))
          .stepNumber,
      ).toBe(1);
    }
  });

  test("a playbook with no name is still a playbook", () => {
    expect(read(waitingRun({ playbookName: "" })).playbookName).toBe(
      "Playbook",
    );
  });
});

describe("who started the run", () => {
  test("a person, by name, else by email", () => {
    expect(
      read(
        waitingRun({
          triggeredByUserId: ME,
          triggeredByUser: { name: "Priya Shah" },
        }),
      ).startedBy,
    ).toBe("Run by Priya Shah");
    expect(
      read(
        waitingRun({
          triggeredByUserId: ME,
          triggeredByUser: { email: "priya@example.test" },
        }),
      ).startedBy,
    ).toBe("Run by priya@example.test");
  });

  test("a person the reader cannot see is still a person", () => {
    expect(
      read(waitingRun({ triggeredByUserId: ME, triggeredByUser: null }))
        .startedBy,
    ).toBe("Run by hand");
  });

  test.each([
    ["Case Opened", "Started on its own when the case opened"],
    ["Detection Added", "Started on its own for a new detection"],
    [
      "Triaged as Likely Malicious",
      "Started on its own when OneUptime AI read the case as likely malicious",
    ],
    ["Manual", "Started by hand"],
    [undefined, "Started by hand"],
  ])("a run started by %s", (trigger: unknown, words: string) => {
    expect(read(waitingRun({ trigger })).startedBy).toBe(words);
  });

  test("the starter of a run cannot approve it, matched whatever the id's case", () => {
    const step: WaitingPlaybookStep = read(
      waitingRun({ triggeredByUserId: ME.toUpperCase() }),
    );

    expect(didStartPlaybookRun(step, ME)).toBe(true);
    expect(didStartPlaybookRun(step, "someone-else")).toBe(false);
    expect(didStartPlaybookRun(step, null)).toBe(false);
  });

  test("a run that started on its own may be approved by anybody who may", () => {
    expect(didStartPlaybookRun(read(waitingRun()), ME)).toBe(false);
  });

  test("the refusal is said in the server's words", () => {
    expect(SELF_APPROVAL_SENTENCE).toBe(
      "You started this run, so someone else must approve its steps.",
    );
  });
});

describe("a step's stored targets", () => {
  test("are read defensively: a malformed entry is dropped", () => {
    expect(
      readPlaybookTargets([
        { type: "Host", value: "web-01", reason: "Grouped On", state: "Done" },
        { type: "Host", value: "", reason: "Grouped On", state: "Proposed" },
        { type: "Host", value: "web-02", reason: "Grouped On", state: "Bogus" },
        { type: "Mainframe", value: "z15", reason: "Elsewhere", state: "Proposed" },
        null,
        "web-03",
      ]),
    ).toEqual([
      { type: "Host", value: "web-01", reason: "Grouped On", state: "Done" },
      { type: "Other", value: "z15", reason: null, state: "Proposed" },
    ]);
  });

  test("nothing that is not a list reads as no targets", () => {
    expect(readPlaybookTargets(undefined)).toEqual([]);
    expect(readPlaybookTargets({ value: "web-01" })).toEqual([]);
  });

  test("what a proposed target is to the case, as the approval says it", () => {
    const step: WaitingPlaybookStep = read(waitingRun());

    expect(describePlaybookTarget(step.proposed[0]!)).toBe(
      "What the case is grouped on",
    );
    expect(describePlaybookTarget(step.proposed[1]!)).toBe(
      "Known to threat intel",
    );
    expect(describePlaybookTarget(step.protectedTargets[0]!)).toBe(
      "Protected (matches breakglass-*): never acted on",
    );
    expect(
      describePlaybookTarget({
        ...step.protectedTargets[0]!,
        protectedBy: "BREAKGLASS-ADMIN@acme.test",
      }),
    ).toBe("Protected: never acted on");
  });
});

describe("the targets an approval keeps", () => {
  test("the ticked ones, by value, in the step's order", () => {
    const step: WaitingPlaybookStep = read(waitingRun());

    expect(
      getKeptTargetValues(step, new Set(["mallory@acme.test", "alice@acme.test"])),
    ).toEqual(["alice@acme.test", "mallory@acme.test"]);
    expect(getKeptTargetValues(step, new Set(["mallory@acme.test"]))).toEqual([
      "mallory@acme.test",
    ]);
  });

  test("a value ticked that is not one of the step's is never sent", () => {
    const step: WaitingPlaybookStep = read(waitingRun());

    expect(
      getKeptTargetValues(
        step,
        new Set(["breakglass-admin@acme.test", "eve@acme.test"]),
      ),
    ).toEqual([]);
  });

  test("a step that acts on nobody in particular sends no targets at all", () => {
    const step: WaitingPlaybookStep = read(
      waitingRun({ stepResults: [], currentStepIndex: 0 }),
    );

    expect(getKeptTargetValues(step, new Set())).toBeUndefined();
  });
});

describe("action titles", () => {
  test("every containment step reads as the verb an analyst would use", () => {
    expect(getPlaybookActionTitle("Contain CrowdStrike Host")).toBe(
      "Contain the host in CrowdStrike",
    );
    expect(getPlaybookActionTitle("Isolate Defender Device")).toBe(
      "Isolate the device in Microsoft Defender",
    );
    expect(getPlaybookActionTitle("End Okta Sessions")).toBe(
      "End the user's Okta sessions",
    );
  });

  test("every action has a title a reader understands, as a sentence starts", () => {
    const entries: Array<[string, string]> = Object.entries(
      SECURITY_PLAYBOOK_ACTION_TITLES,
    );

    // Common's parity suite holds the list to the server's, one for one.
    expect(entries.length).toBeGreaterThanOrEqual(21);
    for (const [action, title] of entries) {
      expect({
        action,
        readable: title.length > 3 && title[0] === title[0]!.toUpperCase(),
      }).toEqual({ action, readable: true });
    }
  });

  test("nothing to name reads as nothing", () => {
    expect(getPlaybookActionTitle("")).toBe("");
    expect(getPlaybookActionTitle(undefined)).toBe("");
    expect(getPlaybookActionTitle(42)).toBe("");
  });
});
