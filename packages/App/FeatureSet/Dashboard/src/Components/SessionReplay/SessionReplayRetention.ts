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

export function formatSessionReplayRetention(days: number | undefined): string {
  if (!days) {
    return `not set (defaults to ${DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS} days)`;
  }

  return `${days} day${days === 1 ? "" : "s"}`;
}
