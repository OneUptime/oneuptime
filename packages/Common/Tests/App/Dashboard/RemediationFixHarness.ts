import { fireEvent, screen } from "@testing-library/react";

/*
 * Opens every fix on the AI card's Remediation step, as a reader does. A
 * fix of commands or changes is folded to its sentence (#5413's UI review:
 * a lighter fixes block), and Review and approve - Show details, for a fix
 * that waits for nobody - opens its commands or changes, its reasoning and
 * Approve & Run. Suites about what an open fix shows open it first.
 *
 * Waits for the step's fixes to be read. A fix with nothing to fold (a
 * runbook, a fix still being worked out) has no toggle and is left as it is.
 */
export async function openRemediationFixes(): Promise<void> {
  await screen.findAllByTestId("remediation-fix");
  openRemediationFixesNow();
}

// The same, on the fixes drawn right now, without waiting.
export function openRemediationFixesNow(): void {
  for (const toggle of screen.queryAllByTestId(
    "remediation-fix-details-toggle",
  )) {
    if (toggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(toggle);
    }
  }
}
