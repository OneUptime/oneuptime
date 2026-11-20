import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import {
  listenForUserActivity,
  type HeardUserActivity,
} from "../../__tests__/userActivityHeard";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  ContainedTargetsSection,
  PlaybookApprovalCard,
  PlaybookApprovalDecidedNotice,
  PlaybookApprovalEvidence,
  PlaybookDecisionSheet,
  describeTargetLine,
} from "./PlaybookApproval";
import { ThemeProvider, darkColors, lightColors } from "../../theme";
import { withAlpha } from "../../utils/color";
import {
  readContainedPlaybookTargets,
  readWaitingPlaybookStep,
  type ContainedPlaybookTarget,
  type WaitingPlaybookStep,
} from "../../security/playbookApproval";
import type { PlaybookApprovalReadout } from "../../api/securityCases";
import {
  makeContainedPlaybookRun,
  makeWaitingPlaybookRun,
} from "../../__tests__/testSupport";

/*
 * A playbook step held for a decision: often why the phone rang. The card
 * says which step of which playbook, what it would act on - apart from the
 * protected entries it leaves alone - and offers Reject and Approve. The
 * sheet behind each takes the decision: an approval lists the users or
 * hosts, every one ticked, to untick any the step should leave alone (one
 * at least stays, or the step is rejected instead), and both take a comment.
 * Whoever started a run cannot approve it.
 */

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

beforeEach(() => {
  mockColorScheme = "light";
});

type RenderedElement = ReturnType<typeof screen.getByTestId>;

function isDisabled(element: RenderedElement): boolean | undefined {
  return (
    element.props.accessibilityState as { disabled?: boolean } | undefined
  )?.disabled;
}

function isChecked(element: RenderedElement): boolean | undefined {
  return (element.props.accessibilityState as { checked?: boolean } | undefined)
    ?.checked;
}

function waitingStep(
  overrides: Parameters<typeof makeWaitingPlaybookRun>[0] = {},
): WaitingPlaybookStep {
  return readWaitingPlaybookStep(makeWaitingPlaybookRun(overrides))!;
}

function twoTargetStep(): WaitingPlaybookStep {
  return waitingStep({
    stepResults: [
      {
        stepId: "step-1",
        action: "Suspend Okta User",
        status: "Waiting for Approval",
        targets: [
          {
            type: "User",
            value: "alice@acme.test",
            reason: "Grouped On",
            state: "Proposed",
          },
          {
            type: "User",
            value: "Mallory@acme.test",
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
  });
}

describe("the approval card", () => {
  test("leads with the step to decide on, and whose playbook it is", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("header", { name: "Approval needed" }),
    ).toBeTruthy();
    expect(screen.getByTestId("playbook-approval-step")).toHaveTextContent(
      "Suspend the user in Okta",
    );
    expect(screen.getByTestId("playbook-approval-where")).toHaveTextContent(
      "Playbook Contain a compromised account waits at step 1 until someone approves or rejects it.",
    );
    // The playbook's name reads as a name inside the sentence.
    expect(screen.getByText("Contain a compromised account")).toHaveStyle({
      fontWeight: "600",
      color: lightColors.textPrimary,
    });
  });

  test("a playbook with no name is the playbook", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep({ playbookName: "" })}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );

    expect(screen.getByTestId("playbook-approval-where")).toHaveTextContent(
      "The playbook waits at step 1 until someone approves or rejects it.",
    );
  });

  test("lists what it acts on apart from what it leaves alone as protected", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );

    expect(screen.getByText("Acts on")).toBeTruthy();
    expect(screen.getAllByTestId("playbook-target")).toHaveLength(1);
    expect(screen.getByText("alice@acme.test")).toBeTruthy();
    expect(screen.getByText("User · What the case is grouped on")).toBeTruthy();
    expect(screen.getByText("Protected, never acted on")).toBeTruthy();
    expect(screen.getAllByTestId("playbook-target-protected")).toHaveLength(1);
    expect(screen.getByText("User · Matches breakglass-*")).toBeTruthy();
  });

  test("a step that acts on nobody in particular lists nothing", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep({ stepResults: [] })}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );

    expect(screen.queryByText("Acts on")).toBeNull();
    expect(screen.queryByText("Protected, never acted on")).toBeNull();
  });

  test("says how the run started", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep({ startedAt: null, createdAt: null })}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );

    expect(screen.getByTestId("playbook-approval-started")).toHaveTextContent(
      "Started on its own when the case opened",
    );
  });

  test("Reject and Approve hand the decision to the screen", async () => {
    const onDecide: jest.Mock = jest.fn();
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={onDecide}
      />,
    );

    await fireEvent.press(screen.getByTestId("playbook-reject"));
    await fireEvent.press(screen.getByTestId("playbook-approve"));

    expect(onDecide.mock.calls).toEqual([["reject"], ["approve"]]);
  });

  test("whoever started the run may reject it, never approve it, and is told why", async () => {
    const onDecide: jest.Mock = jest.fn();
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun
        busy={false}
        onDecide={onDecide}
      />,
    );

    expect(screen.getByTestId("playbook-approval-own-run")).toHaveTextContent(
      "You started this run, so someone else must approve its steps.",
    );
    // The sentence says who started it: no "Run by" line naming the reader too.
    expect(screen.queryByTestId("playbook-approval-started")).toBeNull();
    expect(isDisabled(screen.getByTestId("playbook-approve"))).toBe(true);
    expect(isDisabled(screen.getByTestId("playbook-reject"))).toBe(false);
    await fireEvent.press(screen.getByTestId("playbook-approve"));
    expect(onDecide).not.toHaveBeenCalled();
  });

  test("while a decision is on its way, neither button takes another", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy
        onDecide={jest.fn()}
      />,
    );

    expect(isDisabled(screen.getByTestId("playbook-approve"))).toBe(true);
    expect(isDisabled(screen.getByTestId("playbook-reject"))).toBe(true);
  });

  test("is outlined in the warning colour, in light and dark", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
      />,
    );
    expect(screen.getByTestId("playbook-approval-card")).toHaveStyle({
      borderColor: withAlpha(lightColors.statusWarning, 0.55),
      backgroundColor: lightColors.backgroundElevated,
    });

    mockColorScheme = "dark";
    await view.rerender(
      <ThemeProvider>
        <PlaybookApprovalCard
          step={waitingStep()}
          isOwnRun={false}
          busy={false}
          onDecide={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("playbook-approval-card")).toHaveStyle({
      borderColor: withAlpha(darkColors.statusWarning, 0.55),
      backgroundColor: darkColors.backgroundElevated,
    });
  });
});

describe("approving a step that acts on one user", () => {
  test("lists it with no box to untick, and approving acts on it", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(
      <PlaybookDecisionSheet
        step={waitingStep()}
        decision="approve"
        submitting={false}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByRole("header", { name: "Act on" })).toBeTruthy();
    const row: RenderedElement = screen.getByTestId(
      "playbook-target-fixed-alice@acme.test",
    );
    expect(within(row).getByText("alice@acme.test")).toBeTruthy();
    expect(
      within(row).getByText("User · What the case is grouped on"),
    ).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByText(
        "Every one is ticked. Untick any the step should leave alone.",
      ),
    ).toBeNull();

    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      comment: "",
      targets: ["alice@acme.test"],
    });
  });
});

describe("approving a step", () => {
  function approve(
    props: Partial<React.ComponentProps<typeof PlaybookDecisionSheet>> = {},
  ): React.JSX.Element {
    return (
      <PlaybookDecisionSheet
        step={twoTargetStep()}
        decision="approve"
        submitting={false}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
        {...props}
      />
    );
  }

  test("says what approving does, and lists every target ticked", async () => {
    await render(approve());

    expect(
      screen.getByText(
        "Every one is ticked. Untick any the step should leave alone.",
      ),
    ).toBeTruthy();

    expect(
      screen.getByRole("header", { name: "Approve: Suspend the user in Okta" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The run carries on from this step. Your decision is kept on the step, on the case's timeline and in the audit log.",
      ),
    ).toBeTruthy();
    const boxes: Array<RenderedElement> = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(isChecked(box)).toBe(true);
    }
    expect(
      screen.getByText(
        "Protected, never acted on: breakglass-admin@acme.test.",
      ),
    ).toBeTruthy();
  });

  test("approving with everything ticked sends every target and the comment", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(approve({ onSubmit }));

    await fireEvent.changeText(
      screen.getByTestId("playbook-decision-comment"),
      "  Alice confirmed she did not sign in.  ",
    );
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      comment: "Alice confirmed she did not sign in.",
      targets: ["alice@acme.test", "Mallory@acme.test"],
    });
  });

  test("typing the comment counts as using the app, which the idle timeout counts from", async () => {
    const activity: HeardUserActivity = listenForUserActivity();

    try {
      await render(approve());

      await fireEvent.changeText(
        screen.getByTestId("playbook-decision-comment"),
        "Alice confirmed.",
      );

      await waitFor((): void => {
        expect(activity.heard.length).toBeGreaterThan(0);
      });
      expect(screen.getByTestId("playbook-decision-comment").props.value).toBe(
        "Alice confirmed.",
      );
    } finally {
      activity.stop();
    }
  });

  test("an unticked target is left out of what the step acts on", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(approve({ onSubmit }));

    await fireEvent.press(
      screen.getByTestId("playbook-target-toggle-Mallory@acme.test"),
    );
    expect(
      isChecked(screen.getByTestId("playbook-target-toggle-Mallory@acme.test")),
    ).toBe(false);
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      comment: "",
      targets: ["alice@acme.test"],
    });
  });

  test("with every target unticked it cannot approve, and says what to do instead", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(approve({ onSubmit }));

    await fireEvent.press(
      screen.getByTestId("playbook-target-toggle-alice@acme.test"),
    );
    await fireEvent.press(
      screen.getByTestId("playbook-target-toggle-Mallory@acme.test"),
    );

    expect(screen.getByTestId("playbook-no-target-kept")).toHaveTextContent(
      "Keep at least one, or reject the step instead.",
    );
    expect(isDisabled(screen.getByTestId("playbook-decision-submit"))).toBe(
      true,
    );
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByTestId("playbook-target-toggle-alice@acme.test"),
    );
    expect(screen.queryByTestId("playbook-no-target-kept")).toBeNull();
  });

  test("a step that acts on nobody in particular sends no targets", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(approve({ onSubmit, step: waitingStep({ stepResults: [] }) }));

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    expect(onSubmit).toHaveBeenCalledWith({ comment: "", targets: undefined });
  });

  test("while the decision is on its way, it cannot be cancelled or changed", async () => {
    const onClose: jest.Mock = jest.fn();
    const onSubmit: jest.Mock = jest.fn();
    await render(approve({ onClose, onSubmit, submitting: true }));

    expect(isDisabled(screen.getByTestId("playbook-decision-cancel"))).toBe(
      true,
    );
    expect(
      isDisabled(screen.getByTestId("playbook-target-toggle-alice@acme.test")),
    ).toBe(true);
    await fireEvent.press(
      screen.getByTestId("playbook-approve-sheet-dismiss-area", {
        includeHiddenElements: true,
      }),
    );
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("opened again for another step, it starts with every target ticked and no comment", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(approve());
    await fireEvent.press(
      screen.getByTestId("playbook-target-toggle-alice@acme.test"),
    );
    await fireEvent.changeText(
      screen.getByTestId("playbook-decision-comment"),
      "Draft",
    );

    await view.rerender(approve({ step: null, decision: null }));
    await view.rerender(approve());

    expect(
      isChecked(screen.getByTestId("playbook-target-toggle-alice@acme.test")),
    ).toBe(true);
    expect(screen.getByTestId("playbook-decision-comment").props.value).toBe(
      "",
    );
  });
});

describe("rejecting a step", () => {
  test("says the run stops, asks only for a comment, and rejects in red", async () => {
    const onSubmit: jest.Mock = jest.fn();
    await render(
      <PlaybookDecisionSheet
        step={twoTargetStep()}
        decision="reject"
        submitting={false}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("header", { name: "Reject: Suspend the user in Okta" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The run stops here and nothing after this step runs. Your decision is kept on the step, on the case's timeline and in the audit log.",
      ),
    ).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByTestId("playbook-decision-submit")).toHaveStyle({
      backgroundColor: lightColors.actionDestructive,
    });

    await fireEvent.changeText(
      screen.getByTestId("playbook-decision-comment"),
      "Alice is travelling.",
    );
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      comment: "Alice is travelling.",
      targets: undefined,
    });
  });

  test("without a step there is no sheet", async () => {
    await render(
      <PlaybookDecisionSheet
        step={null}
        decision={null}
        submitting={false}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("playbook-approve-sheet")).toBeNull();
    expect(screen.queryByTestId("playbook-reject-sheet")).toBeNull();
  });
});

/*
 * The evidence the approval's Slack and Microsoft Teams messages carry, on
 * the phone too (#10341): what will be done and through what, who asked,
 * the evidence behind the case, and whether it can be undone - in the
 * server's own words.
 */
const READOUT: PlaybookApprovalReadout = {
  runId: "7a6b0000-0001-4000-8000-000000000001",
  stepIndex: 0,
  stepId: "step-1",
  standing: "Waiting",
  headline: "Approval needed on CASE-142: Credential stuffing",
  action: "Suspend the user in Okta, through Okta (acme)",
  targets: ["alice@acme.test: the case is grouped on it"],
  leftAlone: [],
  source:
    "Asked by playbook Contain a compromised account, which started when the case opened.",
  evidence: [
    "12 requests behind the case: Turned away: 9, Reached the app: 3",
    "Nothing it acts on is on your protected list.",
  ],
  undo: "Can be undone: each one, with Unsuspend the user in Okta on the case.",
};

describe("the approval card's evidence", () => {
  test("what will be done and through what, who asked, the evidence and the undo", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
        evidence={READOUT}
      />,
    );

    expect(screen.getByText("Will do")).toBeTruthy();
    expect(screen.getByTestId("playbook-approval-action")).toHaveTextContent(
      "Suspend the user in Okta, through Okta (acme)",
    );
    expect(screen.getByTestId("playbook-approval-source")).toHaveTextContent(
      READOUT.source,
    );
    expect(
      screen
        .getAllByTestId("playbook-approval-evidence-line")
        .map((line: RenderedElement): string => {
          return String(line.props.children);
        }),
    ).toEqual([
      "• 12 requests behind the case: Turned away: 9, Reached the app: 3",
      "• Nothing it acts on is on your protected list.",
    ]);
    expect(screen.getByTestId("playbook-approval-undo")).toHaveTextContent(
      READOUT.undo,
    );
  });

  test("before it is read, the card asks all the same: Reject and Approve do not wait for it", async () => {
    await render(
      <PlaybookApprovalCard
        step={waitingStep()}
        isOwnRun={false}
        busy={false}
        onDecide={jest.fn()}
        evidence={null}
      />,
    );

    expect(screen.queryByTestId("playbook-approval-evidence")).toBeNull();
    expect(isDisabled(screen.getByTestId("playbook-approve"))).toBeFalsy();
  });

  test("evidence with nothing to say leaves its lines out", async () => {
    await render(
      <PlaybookApprovalEvidence
        readout={{ ...READOUT, evidence: [], source: "", undo: "" }}
      />,
    );

    expect(screen.getByTestId("playbook-approval-action")).toBeTruthy();
    expect(screen.queryByText("Evidence")).toBeNull();
    expect(screen.queryByTestId("playbook-approval-source")).toBeNull();
    expect(screen.queryByTestId("playbook-approval-undo")).toBeNull();
  });
});

describe("an approval somebody decided since the push", () => {
  test("says who decided and when, how the step went, and what became of each target", async () => {
    await render(
      <PlaybookApprovalDecidedNotice
        readout={{
          ...READOUT,
          standing: "Approved",
          headline: "Approved by Jane Doe at 10:43 UTC",
          progress: "Done at 10:44 UTC.",
          targets: ["alice@acme.test: done · suspended"],
        }}
      />,
    );

    expect(
      screen.getByRole("header", { name: "No longer waiting for you" }),
    ).toBeTruthy();
    expect(
      screen.getByTestId("playbook-approval-decided-headline"),
    ).toHaveTextContent("Approved by Jane Doe at 10:43 UTC");
    expect(
      screen.getByTestId("playbook-approval-decided-progress"),
    ).toHaveTextContent("Done at 10:44 UTC.");
    expect(screen.getByText("• alice@acme.test: done · suspended")).toBeTruthy();
  });

  test("a rejection, or a run that stopped waiting, has no progress to tell", async () => {
    await render(
      <PlaybookApprovalDecidedNotice
        readout={{
          ...READOUT,
          standing: "Rejected",
          headline: "Rejected by Jane Doe at 10:43 UTC. Nothing was done.",
          targets: [],
        }}
      />,
    );

    expect(
      screen.getByTestId("playbook-approval-decided-headline"),
    ).toHaveTextContent("Rejected by Jane Doe at 10:43 UTC. Nothing was done.");
    expect(screen.queryByTestId("playbook-approval-decided-progress")).toBeNull();
  });
});

describe("what the case's playbooks contained", () => {
  function contained(): Array<ContainedPlaybookTarget> {
    return readContainedPlaybookTargets([
      makeContainedPlaybookRun(),
      makeContainedPlaybookRun({
        _id: "7a6b0000-0003-4000-8000-000000000003",
        playbookName: "",
        steps: [{ id: "contain", action: "Contain CrowdStrike Host" }],
        stepResults: [
          {
            stepId: "contain",
            action: "Contain CrowdStrike Host",
            status: "Succeeded",
            targets: [{ type: "Host", value: "web-01", state: "Done" }],
          },
        ],
      }),
    ]);
  }

  test("each target, with the step and the playbook that contained it, and an Undo", async () => {
    await render(
      <ContainedTargetsSection
        contained={contained()}
        undoing={null}
        onUndo={jest.fn()}
      />,
    );

    expect(screen.getByText("Contained by playbooks")).toBeTruthy();
    const alice: RenderedElement = screen.getByTestId(
      "playbook-contained-alice@acme.test",
    );
    expect(within(alice).getByText("alice@acme.test")).toBeTruthy();
    expect(
      within(alice).getByText(
        "Suspend the user in Okta · Contain a compromised account, step 2",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("playbook-contained-web-01")).getByText(
        "Contain the host in CrowdStrike · Step 1",
      ),
    ).toBeTruthy();
  });

  test("Undo hands the target to the screen, which asks first", async () => {
    const onUndo: jest.Mock = jest.fn();
    const items: Array<ContainedPlaybookTarget> = contained();

    await render(
      <ContainedTargetsSection
        contained={items}
        undoing={null}
        onUndo={onUndo}
      />,
    );
    await fireEvent.press(screen.getByTestId("playbook-undo-web-01"));

    expect(onUndo).toHaveBeenCalledWith(items[1]);
  });

  test("while one undo is on its way, no other Undo takes a press", async () => {
    const onUndo: jest.Mock = jest.fn();
    const items: Array<ContainedPlaybookTarget> = contained();

    await render(
      <ContainedTargetsSection
        contained={items}
        undoing={items[0]!}
        onUndo={onUndo}
      />,
    );

    expect(
      isDisabled(screen.getByTestId("playbook-undo-alice@acme.test")),
    ).toBe(true);
    expect(isDisabled(screen.getByTestId("playbook-undo-web-01"))).toBe(true);
    await fireEvent.press(screen.getByTestId("playbook-undo-web-01"));
    expect(onUndo).not.toHaveBeenCalled();
  });

  test("nothing contained, no section", async () => {
    await render(
      <ContainedTargetsSection contained={[]} undoing={null} onUndo={jest.fn()} />,
    );

    expect(screen.queryByTestId("playbook-contained-section")).toBeNull();
  });
});

describe("a target's second line", () => {
  test("what it is and why the step picked it", () => {
    const step: WaitingPlaybookStep = twoTargetStep();

    expect(describeTargetLine(step.proposed[0]!)).toBe(
      "User · What the case is grouped on",
    );
    expect(describeTargetLine(step.proposed[1]!)).toBe(
      "User · Known to threat intel",
    );
  });

  test("a protected one names the entry it matches, unless that is itself", () => {
    const step: WaitingPlaybookStep = twoTargetStep();

    expect(describeTargetLine(step.protectedTargets[0]!)).toBe(
      "User · Matches breakglass-*",
    );
    expect(
      describeTargetLine({
        ...step.protectedTargets[0]!,
        protectedBy: "BREAKGLASS-ADMIN@ACME.TEST",
      }),
    ).toBe("User");
  });
});
