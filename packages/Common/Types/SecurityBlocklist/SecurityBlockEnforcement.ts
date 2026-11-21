/*
 * WHERE A BLOCK IS ENFORCED, AND WHETHER THAT HOLDS (#10338).
 *
 * A block is only a wish until a destination holds it: Cloudflare's list,
 * an AWS WAF IP set, a firewall that read the feed. Each destination keeps
 * one enforcement row per block (SecurityBlockEnforcement), written by the
 * reconciler as it applies the block there and reads it back:
 *
 *   Pending   asked for, not yet seen at the destination;
 *   Applied   seen at the destination when it was read back;
 *   Failed    not applied, and why: the destination cannot challenge, it
 *             matches IPv4 only, it is full, or the provider refused;
 *   Removing  the block ended, and the destination still holds it;
 *   Removed   the destination no longer holds it.
 *
 * A block is enforced when at least one destination has Applied it and
 * confirmed it by reading it back recently. Anything else - no destination
 * at all, every one pending or failed, a confirmation gone stale because the
 * provider stopped answering - is not enforced, and a step or a page that
 * reads it says so: an analyst reading "blocked" must be able to trust that
 * the address is blocked.
 */

export enum SecurityBlockEnforcementState {
  Pending = "Pending",
  Applied = "Applied",
  Failed = "Failed",
  Removing = "Removing",
  Removed = "Removed",
}

export const SECURITY_BLOCK_ENFORCEMENT_STATES: ReadonlyArray<SecurityBlockEnforcementState> =
  [
    SecurityBlockEnforcementState.Pending,
    SecurityBlockEnforcementState.Applied,
    SecurityBlockEnforcementState.Failed,
    SecurityBlockEnforcementState.Removing,
    SecurityBlockEnforcementState.Removed,
  ];

/*
 * The kinds of destination. Only the test destination ships with the
 * blocklist; each provider's issue adds its own kind here as it adds its
 * destination: Cloudflare (#10343), AWS WAF (#10344), the feed (#10345),
 * Microsoft Defender and CrowdStrike (#10346), Azure WAF (#10348) and Cloud
 * Armor (#10349).
 */
export enum SecurityBlockDestinationProvider {
  Test = "Test",
  // Microsoft Defender for Endpoint's indicators, on every machine (#10346).
  MicrosoftDefender = "MicrosoftDefender",
  // CrowdStrike Falcon's custom IOCs, on every machine (#10346).
  CrowdStrike = "CrowdStrike",
}

/*
 * How long a confirmation holds: a destination read back within the last
 * ten minutes is known to hold the block. The reconciler reads every
 * destination every minute, so only a destination that stopped answering
 * goes this long; past it, the block is not known to be enforced there.
 */
export const SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS: number = 10 * 60 * 1000;

// An enforcement row as the summaries read it.
export interface SecurityBlockEnforcementShape {
  state?: SecurityBlockEnforcementState | string | undefined | null;
  destinationName?: string | undefined | null;
  appliedAt?: Date | string | undefined | null;
  lastConfirmedAt?: Date | string | undefined | null;
  error?: string | undefined | null;
}

export function isSecurityBlockEnforcementState(
  value: unknown,
): value is SecurityBlockEnforcementState {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_ENFORCEMENT_STATES as ReadonlyArray<string>).includes(value)
  );
}

function toTime(value: Date | string | undefined | null): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

/*
 * Whether one destination holds the block now: Applied, and confirmed by a
 * read back within SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS.
 */
export function isSecurityBlockEnforcementHolding(
  enforcement: SecurityBlockEnforcementShape,
  now: Date,
): boolean {
  if (enforcement.state !== SecurityBlockEnforcementState.Applied) {
    return false;
  }

  const confirmedAt: number | null = toTime(enforcement.lastConfirmedAt);

  return (
    confirmedAt !== null &&
    now.getTime() - confirmedAt <= SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS
  );
}

// Whether the block is enforced anywhere: at least one destination holds it now.
export function isSecurityBlockEnforced(
  enforcements: ReadonlyArray<SecurityBlockEnforcementShape>,
  now: Date,
): boolean {
  return enforcements.some(
    (enforcement: SecurityBlockEnforcementShape): boolean => {
      return isSecurityBlockEnforcementHolding(enforcement, now);
    },
  );
}

/*
 * What one destination's chip says of an active block, worked out once for
 * the Blocklist page, a case's step and OneUptime AI alike:
 *
 *   Enforced     the destination holds it, confirmed recently;
 *   Unconfirmed  it was applied, but the destination has not been read back
 *                for a while: not known to hold;
 *   Pending      asked for, not seen there yet;
 *   NotApplied   failed, with why;
 *   Removing     the block ended and the destination still holds it;
 *   Removed      gone from the destination.
 */
export enum SecurityBlockEnforcementView {
  Enforced = "Enforced",
  Unconfirmed = "Unconfirmed",
  Pending = "Pending",
  NotApplied = "NotApplied",
  Removing = "Removing",
  Removed = "Removed",
}

export function getSecurityBlockEnforcementView(
  enforcement: SecurityBlockEnforcementShape,
  now: Date,
): SecurityBlockEnforcementView {
  switch (enforcement.state) {
    case SecurityBlockEnforcementState.Applied:
      return isSecurityBlockEnforcementHolding(enforcement, now)
        ? SecurityBlockEnforcementView.Enforced
        : SecurityBlockEnforcementView.Unconfirmed;
    case SecurityBlockEnforcementState.Failed:
      return SecurityBlockEnforcementView.NotApplied;
    case SecurityBlockEnforcementState.Removing:
      return SecurityBlockEnforcementView.Removing;
    case SecurityBlockEnforcementState.Removed:
      return SecurityBlockEnforcementView.Removed;
    default:
      return SecurityBlockEnforcementView.Pending;
  }
}

/*
 * A block's enforcement in one line's worth: whether it is enforced, where
 * it holds, and where it does not. The Response Plan's step (#10342) and
 * OneUptime AI (#10352) read a block as done only when isEnforced.
 */
export interface SecurityBlockEnforcementSummary {
  isEnforced: boolean;
  // The destinations that hold it now, by name.
  enforcedAt: Array<string>;
  // The destinations asked to hold it that do not, by name, with why when known.
  notEnforcedAt: Array<{ name: string; reason: string | null }>;
}

export function getSecurityBlockEnforcementSummary(
  enforcements: ReadonlyArray<SecurityBlockEnforcementShape>,
  now: Date,
): SecurityBlockEnforcementSummary {
  const enforcedAt: Array<string> = [];
  const notEnforcedAt: Array<{ name: string; reason: string | null }> = [];

  for (const enforcement of enforcements) {
    const name: string = (enforcement.destinationName || "").trim();

    if (
      enforcement.state === SecurityBlockEnforcementState.Removed ||
      enforcement.state === SecurityBlockEnforcementState.Removing
    ) {
      continue;
    }

    if (isSecurityBlockEnforcementHolding(enforcement, now)) {
      enforcedAt.push(name);
      continue;
    }

    notEnforcedAt.push({
      name,
      reason: enforcement.error ? enforcement.error : null,
    });
  }

  return {
    isEnforced: enforcedAt.length > 0,
    enforcedAt,
    notEnforcedAt,
  };
}
