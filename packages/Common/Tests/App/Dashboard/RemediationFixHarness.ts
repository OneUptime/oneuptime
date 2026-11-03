import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/*
 * Opens every fix on the AI card's Remediation step, as a reader does. A
 * fix reads as the steps it went through (issue #5598) - planned,
 * approved, ran, recovered, rolled back - and each step with more to read
 * opens on its own press: the plan to its reasoning and each command, the
 * run to each command's output, the rollback to each undo. A fix that
 * waits for approval opens its plan with Review and approve, which puts
 * Approve & Run under it. Suites about what an open fix shows open all of
 * it first.
 *
 * Waits for the step's fixes to be read. A step with nothing more to read
 * has no press and is left as it is.
 */
export async function openRemediationFixes(): Promise<void> {
  await screen.findAllByTestId("remediation-fix");
  openRemediationFixesNow();
}

// The presses that open a fix's steps: each step's own, and Review and approve.
const OPENING_PRESSES: ReadonlyArray<string> = [
  "remediation-fix-details-toggle",
  "remediation-fix-step-toggle",
];

// The same, on the fixes drawn right now, without waiting.
export function openRemediationFixesNow(): void {
  /*
   * One press at a time, read again after each: Review and approve and a
   * plan step's own press open the same step, so one of them opens what
   * the other would, and pressing both would close it again.
   */
  for (let round: number = 0; round < 50; round++) {
    const closed: Array<HTMLElement> = OPENING_PRESSES.flatMap(
      (testId: string): Array<HTMLElement> => {
        return screen.queryAllByTestId(testId);
      },
    ).filter((press: HTMLElement): boolean => {
      return press.getAttribute("aria-expanded") === "false";
    });

    if (closed.length === 0) {
      return;
    }

    fireEvent.click(closed[0]!);
  }
}

/*
 * One command's lines on an open fix: what it is and why, in its plan step
 * (its tier, whether it needs approval, its command, why, its undo, a cloud
 * change's words, dry run and track record); how it ran, in its run step
 * (how it went, its exit code, its error, its output); and its undo as it
 * ran, in its rollback step. Null for a step the fix has not reached.
 */
export interface RemediationCommandLines {
  plan: HTMLElement;
  run: HTMLElement | null;
  rollback: HTMLElement | null;
}

export async function findRemediationCommandLines(
  command: string,
): Promise<RemediationCommandLines> {
  const plan: HTMLElement = await waitFor((): HTMLElement => {
    const matches: Array<HTMLElement> = screen
      .getAllByTestId("remediation-command")
      .filter((line: HTMLElement): boolean => {
        return Boolean(line.textContent?.includes(command));
      });

    if (matches.length !== 1) {
      throw new Error(
        `${matches.length} planned commands read "${command}", not one.`,
      );
    }

    return matches[0]!;
  });
  const sequence: string | null = plan.getAttribute("data-sequence");
  const fix: HTMLElement | null = plan.closest(
    "[data-testid='remediation-fix']",
  );
  const sameCommand: (testId: string) => HTMLElement | null = (
    testId: string,
  ): HTMLElement | null => {
    return (
      (fix ? within(fix).queryAllByTestId(testId) : []).find(
        (line: HTMLElement): boolean => {
          return line.getAttribute("data-sequence") === sequence;
        },
      ) || null
    );
  };

  return {
    plan,
    run: sameCommand("remediation-command-run"),
    rollback: sameCommand("remediation-rollback-outcome"),
  };
}
