import ProductBrandingText from "../ProductBrandingText";
import SlackActionType from "../Workspace/Slack/Actions/ActionTypes";

/*
 * THE WORDS OF A FIX'S SLACK AND MICROSOFT TEAMS MESSAGE, AND OF ITS
 * BUTTONS - the same in both chats, kept apart from the code that acts on
 * them (RemediationChatMessage, WorkspaceRemediationActions) so the chats'
 * connect prompts can read them without loading what approving a fix needs.
 * The product is named as the installation names it (ProductBrandingText).
 */

export const REMEDIATION_CHAT_WORDS: {
  reviewAndApprove: string;
  dismiss: string;
  dialogTitle: string;
  approveAndRun: string;
  cancel: string;
} = {
  reviewAndApprove: "Review and approve",
  dismiss: "Dismiss",
  dialogTitle: "Approve this fix?",
  approveAndRun: "Approve and run",
  cancel: "Cancel",
};

// "View in OneUptime": the record's page, where its Remediation step is.
export function getViewInProductTitle(): string {
  return `View in ${ProductBrandingText.getProductName()}`;
}

// The quiet line under a fix's buttons.
export function getApprovalMessageNote(): string {
  return `Review and approve shows everything the fix runs before anything runs. You approve as your own ${ProductBrandingText.getProductName()} account.`;
}

/*
 * The buttons of a fix's message, by the action id both chats press them
 * by: what each asks a person whose chat account is not connected to
 * connect it for, and the button to press again once it is. A fix is
 * never approved or dismissed for somebody once they connect: they read
 * what it runs and press again.
 */
export interface RemediationPress {
  purpose: string;
  button: string;
}

export const REMEDIATION_PRESSES: ReadonlyMap<string, RemediationPress> =
  new Map<string, RemediationPress>([
    [
      SlackActionType.ViewApproveRemediation,
      {
        purpose: "approve this fix",
        button: REMEDIATION_CHAT_WORDS.reviewAndApprove,
      },
    ],
    [
      SlackActionType.SubmitApproveRemediation,
      {
        purpose: "approve this fix",
        button: REMEDIATION_CHAT_WORDS.reviewAndApprove,
      },
    ],
    [
      SlackActionType.DismissRemediation,
      { purpose: "dismiss this fix", button: REMEDIATION_CHAT_WORDS.dismiss },
    ],
  ]);
