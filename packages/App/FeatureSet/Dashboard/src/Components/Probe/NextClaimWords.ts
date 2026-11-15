import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ClaimDue, ClaimDueState } from "Common/Utils/Probe/ClaimDueTime";

/*
 * A probe claim's due time in a word or a time, for a "Next collection" or
 * "Next scan" line: a time only when something will take the row then
 * (Common/Utils/Probe/ClaimDueTime). The row's own due time is never shown
 * for a row nothing may take, since the claim moves it on a quarter of an
 * hour at a time: "in 17 minutes", again and again (OneUptime issue #8042).
 */
export function getNextClaimWords(
  due: ClaimDue<unknown>,
  translator: Translator,
): string {
  switch (due.state) {
    case ClaimDueState.Scheduled:
      return due.dueAt
        ? OneUptimeDate.fromNow(due.dueAt)
        : (translator.translateText("Due now") as string);
    case ClaimDueState.DueNow:
      return translator.translateText("Due now") as string;
    case ClaimDueState.Overdue:
      return translator.translateText("Overdue") as string;
    case ClaimDueState.Stopped:
    default:
      return translator.translateText("Not scheduled") as string;
  }
}
