import {
  SecurityPlaybookApprovalButtonWords,
  getSecurityPlaybookApprovalButtonWords,
} from "../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import { getServerTranslator } from "../ServerTranslation";
import SlackActionType from "./Slack/Actions/ActionTypes";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspacePressDescription,
} from "./WorkspaceConnectRequest";

/*
 * WHAT A PRESS ON A PLAYBOOK STEP'S APPROVAL ASKS TO BE CONNECTED FOR
 * (#10341), told to somebody whose chat account is not connected to
 * OneUptime yet (SlackConnectPrompt, MicrosoftTeamsConnectPrompt).
 *
 * Never decided for them once they are connected: containment is decided
 * by a press made knowing who they are, so they press again - and it is
 * decided then only while the step still waits. Apart from the approval's
 * message (WorkspaceSecurityPlaybookApproval), which every chat reads, so
 * that only the connect prompts, which read the connect requests, read
 * them.
 */
export default class WorkspaceSecurityPlaybookApprovalPress {
  public static describe(data: {
    actionType: string | undefined;
  }): WorkspacePressDescription | null {
    // The buttons as the prompt names them: in English, as the prompt is.
    const english: SecurityPlaybookApprovalButtonWords =
      getSecurityPlaybookApprovalButtonWords(getServerTranslator(undefined));

    switch (data.actionType) {
      case SlackActionType.ApproveSecurityPlaybookStep:
        return {
          purpose: "approve this playbook step",
          again: {
            kind: WorkspaceConnectRequestAgainKind.Button,
            label: english.approve,
          },
        };
      case SlackActionType.ViewApproveSomeSecurityPlaybookStep:
      case SlackActionType.SubmitApproveSomeSecurityPlaybookStep:
        return {
          purpose: "approve this playbook step",
          again: {
            kind: WorkspaceConnectRequestAgainKind.Button,
            label: english.approveSome,
          },
        };
      case SlackActionType.RejectSecurityPlaybookStep:
        return {
          purpose: "reject this playbook step",
          again: {
            kind: WorkspaceConnectRequestAgainKind.Button,
            label: english.reject,
          },
        };
      default:
        return null;
    }
  }
}
