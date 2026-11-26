/*
 * WHAT ONEUPTIME FOUND WHEN IT CHECKED A STEP OF A CASE'S RESPONSE PLAN
 * ITSELF (#10340). Stored on the step's check (SecurityCaseStepCheck.state).
 *
 * A step is done when the case says so or a person ticks it off - a tick is
 * a promise. A check is what OneUptime sees: the app's own requests, the
 * identity provider's and the EDR's state. Only Verified and Not Needed
 * count a step done by the check; anything else needs a person.
 */
enum SecurityCaseStepCheckState {
  // OneUptime confirmed it: the account is suspended in Okta, every request was turned away.
  Verified = "Verified",
  /*
   * What OneUptime sees fits it being done, but it cannot prove who did it:
   * an address that went quiet may have been blocked by hand, or may simply
   * have stopped. A person confirms it.
   */
  LooksDone = "Looks Done",
  // OneUptime sees it is not done: requests still arrive, the account is still active.
  NotDone = "Not Done",
  // OneUptime has no data to check with, and its evidence says why.
  CannotTell = "Cannot Tell",
  // It was done, and stopped holding: the address got through again.
  Regressed = "Regressed",
  // The evidence says the step does not apply: no incident is needed so far.
  NotNeeded = "Not Needed",
}

export const SECURITY_CASE_STEP_CHECK_STATES: ReadonlyArray<SecurityCaseStepCheckState> =
  [
    SecurityCaseStepCheckState.Verified,
    SecurityCaseStepCheckState.LooksDone,
    SecurityCaseStepCheckState.NotDone,
    SecurityCaseStepCheckState.CannotTell,
    SecurityCaseStepCheckState.Regressed,
    SecurityCaseStepCheckState.NotNeeded,
  ];

export function isSecurityCaseStepCheckState(
  value: unknown,
): value is SecurityCaseStepCheckState {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_STEP_CHECK_STATES as ReadonlyArray<string>).includes(value)
  );
}

// The states that count a step done by OneUptime's own check.
export function isStepCheckDone(
  state: SecurityCaseStepCheckState | undefined | null,
): boolean {
  return (
    state === SecurityCaseStepCheckState.Verified ||
    state === SecurityCaseStepCheckState.NotNeeded
  );
}

/*
 * The states in which OneUptime last saw the step done (or holding): what a
 * later check that finds it not holding calls Regressed.
 */
export function isStepCheckHolding(
  state: SecurityCaseStepCheckState | undefined | null,
): boolean {
  return (
    state === SecurityCaseStepCheckState.Verified ||
    state === SecurityCaseStepCheckState.LooksDone
  );
}

export default SecurityCaseStepCheckState;
