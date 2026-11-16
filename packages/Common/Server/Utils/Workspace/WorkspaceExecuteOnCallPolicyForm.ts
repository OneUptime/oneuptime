import { OnCallPageRecordType } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";

/*
 * WHAT THE CHATS' EXECUTE ON-CALL POLICY FORM SAYS UNDER ITS POLICY (issue
 * #9006).
 *
 * A policy started by hand (OnCallPolicyStartedByHand) pages its people,
 * level by level, until one of them answers or the record is resolved:
 * somebody else acknowledging the record does not stop it. The Dashboard's
 * form says so (ExecuteOnCallPolicyWords, issue #7839). Slack's modal,
 * Microsoft Teams' card and Mattermost's dialog said nothing under their
 * policy dropdown, so whoever started a policy from a chat could not tell
 * how long it would page.
 *
 * Now each says it under the dropdown - Slack's hint, a note on the card,
 * the dialog's help text - in the Dashboard's words: the sentence its form
 * shows on a record nobody acknowledged yet. It holds whatever the record's
 * state, so a chat need not read it to open the form: on an acknowledged
 * record the people are still paged until one of them answers, and a
 * resolved one is refused in its own words when the form is sent
 * (WorkspaceLatePress.ExecuteOnCallPolicy).
 *
 * One table, so the three chats say it the same way. Each sentence fits
 * every chat: Mattermost shows at most 150 characters of a field's help
 * text (MattermostUtil.DIALOG_HELP_TEXT_MAX_LENGTH), Slack 2000 of a hint,
 * and a card's note has no limit of its own.
 */
export const WORKSPACE_EXECUTE_ON_CALL_POLICY_DESCRIPTIONS: Readonly<
  Record<OnCallPageRecordType, string>
> = {
  [OnCallPageRecordType.Incident]:
    "Pages the people of the policy you pick about this incident, level by level, until one of them answers or the incident is resolved.",
  [OnCallPageRecordType.Alert]:
    "Pages the people of the policy you pick about this alert, level by level, until one of them answers or the alert is resolved.",
  [OnCallPageRecordType.IncidentEpisode]:
    "Pages the people of the policy you pick about this incident episode, level by level, until one of them answers or the episode is resolved.",
  [OnCallPageRecordType.AlertEpisode]:
    "Pages the people of the policy you pick about this alert episode, level by level, until one of them answers or the episode is resolved.",
};

// What the form says under its policy dropdown, for a kind of record.
export function getExecuteOnCallPolicyFormDescription(
  recordType: OnCallPageRecordType,
): string {
  return WORKSPACE_EXECUTE_ON_CALL_POLICY_DESCRIPTIONS[recordType];
}
