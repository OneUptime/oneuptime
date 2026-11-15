import {
  getVerifiedFixRunbookRefusal,
  VerifiedFixRunbookInput,
  VerifiedFixRunbookRefusal,
} from "../AiRemediation/VerifiedFixRunbook";
import SuggestionOffer from "./SuggestionOffer";

/*
 * WHEN A FIX OFFERS "SAVE AS RUNBOOK" (issue #6801).
 *
 * A fix OneUptime AI ran on its own commands or MCP calls, once verified,
 * can be written down as a runbook (VerifiedFixRunbook). The fix's card on
 * the incident or alert asks this, and the server's save asks the same
 * refusal, so the card never offers what the server would refuse:
 *
 *   - Saved already: Done. The card names the runbook and links to it,
 *     instead of offering a second one.
 *   - Not verified, a runbook's own run, or nothing of it ran: None. Only
 *     what worked is written down, and a runbook's run is a runbook
 *     already.
 *   - The reader may not create runbooks: None. Saving is creating a
 *     runbook, which their role does not allow; the fix's card has nothing
 *     for them to press.
 *   - Otherwise: Act.
 *
 * Not an AI action: saving calls no model - the runbook is written from
 * what ran - so it is offered whether AI is on now or not.
 */
export function getVerifiedFixRunbookOffer(
  input: VerifiedFixRunbookInput & {
    // The reader may create runbooks (PermissionGate on Runbook, Create).
    mayCreateRunbook: boolean;
  },
): SuggestionOffer {
  const refusal: VerifiedFixRunbookRefusal | null =
    getVerifiedFixRunbookRefusal(input);

  if (refusal === VerifiedFixRunbookRefusal.AlreadySaved) {
    return SuggestionOffer.Done;
  }

  if (refusal || !input.mayCreateRunbook) {
    return SuggestionOffer.None;
  }

  return SuggestionOffer.Act;
}
