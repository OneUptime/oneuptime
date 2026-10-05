import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export const SESSION_REPLAY_RETENTION_OPTIONS: Array<DropdownOption> =
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS.map((days: number): DropdownOption => {
    return {
      label:
        days === DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS
          ? `${days} days (default)`
          : `${days} day${days === 1 ? "" : "s"}`,
      value: days,
    };
  });

/*
 * How many days recordings are actually kept. The column is NOT NULL with a
 * default, so an unset value only shows up on a row read before it was
 * written; the server keeps such recordings for the default.
 */
export function getEffectiveSessionReplayRetentionDays(
  days: number | null | undefined,
): number {
  return typeof days === "number" && days > 0
    ? days
    : DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS;
}

export function formatSessionReplayRetention(days: number | undefined): string {
  if (!days) {
    return `not set (defaults to ${DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS} days)`;
  }

  return `${days} day${days === 1 ? "" : "s"}`;
}
