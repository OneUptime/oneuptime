import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What an AI log's status pill says, by the status the log stores (issue
 * #6495). The pill drew the stored value as it is, so a call a daily AI
 * limit refused said "Budget Exceeded" - the word #6440 took out of
 * OneUptime AI - and a call the AI credits refused said "Insufficient
 * Balance", in English in every language. The stored values stay as they
 * are, for the logs already written and the API: each is drawn here in the
 * words the product uses for it, as a key looked up in the reader's
 * language, and the Status filter offers the same words.
 */
export const LLM_LOG_STATUS_LABELS: Readonly<Record<LlmLogStatus, string>> = {
  [LlmLogStatus.Success]: translationKey("Success"),
  [LlmLogStatus.Error]: translationKey("Error"),
  // The project's AI credits are used up (Project Settings → AI → AI Credits).
  [LlmLogStatus.InsufficientBalance]: translationKey("AI Credits Used Up"),
  /*
   * A daily AI limit refused the call: the project's daily token or spend
   * limit, or an incident's or alert's Daily AI Token Limit.
   */
  [LlmLogStatus.BudgetExceeded]: translationKey("Daily Limit Reached"),
};

const LLM_LOG_STATUS_COLORS: Readonly<Record<LlmLogStatus, Color>> = {
  [LlmLogStatus.Success]: Green,
  [LlmLogStatus.Error]: Red,
  // Refused before the call, by a setting someone chose: not a failure.
  [LlmLogStatus.InsufficientBalance]: Yellow,
  [LlmLogStatus.BudgetExceeded]: Yellow,
};

function isLlmLogStatus(value: unknown): value is LlmLogStatus {
  return (
    typeof value === "string" &&
    (Object.values(LlmLogStatus) as Array<string>).includes(value)
  );
}

/*
 * The key a log's status is drawn with: its label, or the stored value as
 * it is for a status this Dashboard does not know (a newer server's).
 */
export function getLlmLogStatusLabel(status: string): string {
  return isLlmLogStatus(status) ? LLM_LOG_STATUS_LABELS[status] : status;
}

export function getLlmLogStatusColor(status: string): Color {
  return isLlmLogStatus(status) ? LLM_LOG_STATUS_COLORS[status] : Green;
}

// Whether the log's Status Message says why the call did not go through.
export function hasLlmLogStatusMessage(status: string | undefined): boolean {
  return (
    status === LlmLogStatus.Error ||
    status === LlmLogStatus.InsufficientBalance ||
    status === LlmLogStatus.BudgetExceeded
  );
}

/*
 * The Status filter's options: each status in the words its pill draws,
 * filtering by the value the log stores.
 */
export function getLlmLogStatusFilterOptions(): Array<DropdownOption> {
  return Object.values(LlmLogStatus).map(
    (status: LlmLogStatus): DropdownOption => {
      return { label: LLM_LOG_STATUS_LABELS[status], value: status };
    },
  );
}
