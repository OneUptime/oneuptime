import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A run's status in a word - "Waiting", never the stored
 * "WaitingForManualStep" - for both Executions lists, their Status filter and
 * the schedule card's "Last scheduled run". Each word is a key of the
 * Dashboard's locales: a pill and a filter look it up in the reader's
 * language.
 */
export function getRunStatusLabel(status: RunbookExecutionStatus): string {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return translationKey("Completed");
    case RunbookExecutionStatus.Failed:
      return translationKey("Failed");
    case RunbookExecutionStatus.Running:
      return translationKey("Running");
    case RunbookExecutionStatus.WaitingForManualStep:
      return translationKey("Waiting");
    case RunbookExecutionStatus.Cancelled:
      return translationKey("Cancelled");
    case RunbookExecutionStatus.Scheduled:
    default:
      return translationKey("Scheduled");
  }
}

// Its pill's colour.
export function getRunStatusColor(status: RunbookExecutionStatus): Color {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return Green500;
    case RunbookExecutionStatus.Failed:
      return Red500;
    case RunbookExecutionStatus.Running:
      return Blue500;
    case RunbookExecutionStatus.WaitingForManualStep:
      return Yellow500;
    case RunbookExecutionStatus.Cancelled:
    case RunbookExecutionStatus.Scheduled:
    default:
      return Gray500;
  }
}

/*
 * The Executions lists' Status filter: every status in the words its pill
 * draws, so the filter's menu, its chip and the rows read the same.
 */
export function getRunStatusFilterOptions(): Array<DropdownOption> {
  return Object.values(RunbookExecutionStatus).map(
    (status: RunbookExecutionStatus): DropdownOption => {
      return { value: status, label: getRunStatusLabel(status) };
    },
  );
}
