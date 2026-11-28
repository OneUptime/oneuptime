/*
 * WHAT AN AUTOMATIC RESPONSE POLICY DID ABOUT ONE ADDRESS (#10350), one
 * SecurityAutomaticResponseAction each: it challenged or blocked it (or, in
 * its trial run, would have), or a guardrail spared it, or it could not.
 *
 *   Challenged / Blocked  the block was made (in a trial run: it would have
 *                         been), for the ladder's length;
 *   SparedProtected       one of the project's own or protected addresses
 *                         (#10338): never touched;
 *   SparedSignedIn        a signed-in user used it in the last 30 days:
 *                         an office's NAT, a customer's proxy, a person;
 *   SparedCannotTell      OneUptime could not tell whether a signed-in user
 *                         used it (its requests could not be read, or the
 *                         address is hidden and its vault could not be
 *                         read): left for a person;
 *   SparedUnvouchedProxy  its requests came through a proxy the project
 *                         trusts only because it is private, which may be a
 *                         TCP proxy that passed on the X-Forwarded-For the
 *                         client wrote (#11389): the address may be the
 *                         client's own words, so it is left for a person;
 *   StoppedAtLimit        the project's policies had made their 50 blocks of
 *                         the hour: they stopped, and paged the project's
 *                         security owners;
 *   Failed                the block could not be made, and why.
 */
export enum SecurityAutomaticResponseOutcome {
  Challenged = "Challenged",
  Blocked = "Blocked",
  SparedProtected = "SparedProtected",
  SparedSignedIn = "SparedSignedIn",
  SparedCannotTell = "SparedCannotTell",
  SparedUnvouchedProxy = "SparedUnvouchedProxy",
  StoppedAtLimit = "StoppedAtLimit",
  Failed = "Failed",
}

export const SECURITY_AUTOMATIC_RESPONSE_OUTCOMES: ReadonlyArray<SecurityAutomaticResponseOutcome> =
  [
    SecurityAutomaticResponseOutcome.Challenged,
    SecurityAutomaticResponseOutcome.Blocked,
    SecurityAutomaticResponseOutcome.SparedProtected,
    SecurityAutomaticResponseOutcome.SparedSignedIn,
    SecurityAutomaticResponseOutcome.SparedCannotTell,
    SecurityAutomaticResponseOutcome.SparedUnvouchedProxy,
    SecurityAutomaticResponseOutcome.StoppedAtLimit,
    SecurityAutomaticResponseOutcome.Failed,
  ];

// The outcomes that are a block made (or, in a trial run, one it would have made).
export const SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES: ReadonlyArray<SecurityAutomaticResponseOutcome> =
  [
    SecurityAutomaticResponseOutcome.Challenged,
    SecurityAutomaticResponseOutcome.Blocked,
  ];

// The outcomes a guardrail decided: the address was left alone.
export const SECURITY_AUTOMATIC_RESPONSE_SPARED_OUTCOMES: ReadonlyArray<SecurityAutomaticResponseOutcome> =
  [
    SecurityAutomaticResponseOutcome.SparedProtected,
    SecurityAutomaticResponseOutcome.SparedSignedIn,
    SecurityAutomaticResponseOutcome.SparedCannotTell,
    SecurityAutomaticResponseOutcome.SparedUnvouchedProxy,
    SecurityAutomaticResponseOutcome.StoppedAtLimit,
  ];

export function isSecurityAutomaticResponseOutcome(
  value: unknown,
): value is SecurityAutomaticResponseOutcome {
  return (
    typeof value === "string" &&
    (SECURITY_AUTOMATIC_RESPONSE_OUTCOMES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

export function isSecurityAutomaticResponseActedOutcome(
  value: unknown,
): boolean {
  return (
    typeof value === "string" &&
    (
      SECURITY_AUTOMATIC_RESPONSE_ACTED_OUTCOMES as ReadonlyArray<string>
    ).includes(value)
  );
}
