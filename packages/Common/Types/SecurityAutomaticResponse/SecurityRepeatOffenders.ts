import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../SecurityBlocklist/SecurityBlock";

/*
 * THE REPEAT-OFFENDER LADDER (#10350): how many times an address or a
 * network was blocked in the last 30 days, and how long its next block
 * lasts. Addresses churn - a cloud VM, a NAT, a phone - so a first block is
 * short, and an address that comes back earns a longer one: 1 hour the
 * first time, then 24 hours, then 7 days.
 *
 * An automatic response policy climbs it from its own first length (Known-
 * Bad Addresses starts at 24 hours). Campaigns (#10354) read the same record
 * for their repeat offenders, and for "Blocked twice before, last on 12 Nov
 * (case #812)".
 *
 * Every block of the address in the window counts - a person's, a
 * playbook's, a policy's - or of a range around it; for a network, of the
 * network, a range around it, or an address or range inside it. A block
 * lifted counts for nothing: somebody ended it on purpose, which is no sign
 * the address did anything again. Shared by the server, which reads the
 * blocks, and the Dashboard, which words the record. Pure.
 */

export const SECURITY_REPEAT_OFFENDER_WINDOW_DAYS: number = 30;
export const SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS: number =
  SECURITY_REPEAT_OFFENDER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// The rungs, shortest first: where a ladder starts, and how far up it goes.
export const SECURITY_REPEAT_OFFENDER_LADDER: ReadonlyArray<SecurityBlockDuration> =
  [
    SecurityBlockDuration.OneHour,
    SecurityBlockDuration.OneDay,
    SecurityBlockDuration.SevenDays,
  ];

// One earlier block of the address or network, as the record keeps it.
export interface SecurityRepeatOffenderBlock {
  securityBlockId: string;
  // The value it blocked: the address, a range around it, or one inside the network.
  value: string;
  action: SecurityBlockAction;
  source: SecurityBlockSource;
  state: SecurityBlockState;
  createdAt: Date;
  // The case it was made from, and its number as the project shows it ("CASE-812").
  securityCaseId: string | null;
  caseNumber: string | null;
}

// How often an address or network was blocked lately, and what comes next.
export interface SecurityRepeatOffenderRecord {
  // The address or network asked about, as blocks are written.
  value: string;
  since: Date;
  // Every block of it in the window, the latest first, lifted ones too.
  blocks: Array<SecurityRepeatOffenderBlock>;
  // The ones that count: not lifted.
  offenceCount: number;
  // The latest that counts, for "last on 12 Nov (case #812)".
  last: SecurityRepeatOffenderBlock | null;
}

// Whether a block counts as an offence: one nobody lifted.
export function isSecurityRepeatOffence(block: {
  state?: SecurityBlockState | string | null | undefined;
}): boolean {
  return block.state !== SecurityBlockState.Lifted;
}

/*
 * How long the next block lasts: `firstDuration` for an address with no
 * offence in the window, a rung higher for each one, and 7 days at most. A
 * first length that is not a rung is where the ladder starts at its foot.
 */
export function getSecurityRepeatOffenderDuration(data: {
  firstDuration: SecurityBlockDuration;
  offenceCount: number;
}): SecurityBlockDuration {
  const start: number = Math.max(
    0,
    SECURITY_REPEAT_OFFENDER_LADDER.indexOf(data.firstDuration),
  );
  const offences: number = Number.isFinite(data.offenceCount)
    ? Math.max(0, Math.floor(data.offenceCount))
    : 0;
  const rung: number = Math.min(
    SECURITY_REPEAT_OFFENDER_LADDER.length - 1,
    start + offences,
  );

  return SECURITY_REPEAT_OFFENDER_LADDER[rung]!;
}

// Which rung of the ladder a length is, from 1; 0 for one off the ladder.
export function getSecurityRepeatOffenderRung(
  duration: SecurityBlockDuration,
): number {
  return SECURITY_REPEAT_OFFENDER_LADDER.indexOf(duration) + 1;
}
