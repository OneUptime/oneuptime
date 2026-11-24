import {
  getOtherSystemDetailsAnswer,
  toOtherSystemDetails,
} from "../../../Types/Exception/OtherSystemFailure";
import { JSONObject } from "../../../Types/JSON";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import WorkspaceRefusal, {
  WorkspaceRefusalReading,
} from "../../../Utils/Workspace/WorkspaceRefusal";

/*
 * WHAT A CHAT TOOL'S SEND TEST ANSWERS WHEN THE TEST MESSAGE WAS NOT SENT
 * (#7272, #7268).
 *
 * Slack's, Microsoft Teams' and Mattermost's Send Test (Notification
 * Methods) answer a test that did not go out as a successful request with
 * ok false (ChatTestAnswer in the Dashboard). What the person reads first is
 * OneUptime's words: a refusal of the tool's, said as WorkspaceRefusal says
 * it - "The Slack channel is archived. Unarchive it in Slack, or pick
 * another channel." - or OneUptime's own reason (the account not
 * connected, the project's notifications switched off). The tool's own
 * answer ("is_archived", Microsoft Graph's error) goes beside it in
 * otherSystemDetails, for the dialog to fold under Details
 * (OtherSystemDetails), instead of trailing the sentence ("... Slack said:
 * is_archived."). A tool that refused and said nothing is said so, with
 * what to do next.
 */
export const getWorkspaceTestSendFailureAnswer: (data: {
  error: unknown;
  workspaceType: WorkspaceType;
}) => JSONObject = (data: {
  error: unknown;
  workspaceType: WorkspaceType;
}): JSONObject => {
  const said: string =
    data.error instanceof Error && data.error.message ? data.error.message : "";

  const reading: WorkspaceRefusalReading = WorkspaceRefusal.read({
    message: said,
    workspaceType: data.workspaceType,
  });

  const statusMessage: string =
    reading.reason ||
    `The test message was not sent, and ${getWorkspaceTypeDisplayName(
      data.workspaceType,
    )} did not say why. Try again in a moment.`;

  return {
    ok: false,
    statusMessage: statusMessage,
    ...getOtherSystemDetailsAnswer(
      toOtherSystemDetails(reading.detail, statusMessage),
    ),
  };
};
