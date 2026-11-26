import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { SecurityCaseAiResponseStage } from "./SecurityCaseAiResponseModel";

/*
 * WHAT THE CASE'S ONEUPTIME AI CARD SAYS OF ONEUPTIME AI WORKING THE CASE
 * (#10352): the heading of each stage, the buttons, and the lines under each
 * step of its log. The steps' own titles and reasons are the shared words
 * (Common/Types/SecurityCase/SecurityCaseAiWords), so the card, the timeline
 * and the docs say the same.
 *
 * React-free; every sentence goes through translationKey() so npm run
 * i18n:extract finds it, and is looked up where it is drawn.
 */

export interface SecurityCaseAiResponseStageCopy {
  title: string;
  description: string;
}

export const SECURITY_CASE_AI_RESPONSE_STAGE_COPY: Readonly<
  Record<SecurityCaseAiResponseStage, SecurityCaseAiResponseStageCopy>
> = {
  [SecurityCaseAiResponseStage.Off]: {
    title: translationKey("OneUptime AI does not work cases here"),
    description: translationKey(
      "Turn it on in Security Events → AI → Settings, and choose what it may do on its own.",
    ),
  },
  [SecurityCaseAiResponseStage.NotWorking]: {
    title: translationKey("OneUptime AI is not working this case"),
    description: translationKey(
      "Respond with AI takes the case and works its Response Plan within your settings, asking you for the rest.",
    ),
  },
  [SecurityCaseAiResponseStage.Working]: {
    title: translationKey("Working this case"),
    description: translationKey(
      "OneUptime AI works the Response Plan within your settings, and asks a person for the rest.",
    ),
  },
  [SecurityCaseAiResponseStage.WaitingForPeople]: {
    title: translationKey("Waiting for a person"),
    description: translationKey(
      "OneUptime AI asked a person to approve a step. It goes on once someone answers.",
    ),
  },
  [SecurityCaseAiResponseStage.HandedToPeople]: {
    title: translationKey("Handed to people"),
    description: translationKey(
      "OneUptime AI stopped working the case. Its steps so far are below.",
    ),
  },
  [SecurityCaseAiResponseStage.Finished]: {
    title: translationKey("The case is closed"),
    description: translationKey(
      "What OneUptime AI did on the case is below, with its closing report.",
    ),
  },
};

export const SecurityCaseAiResponseCopy: {
  sectionTitle: string;
  respondButton: string;
  takeOverButton: string;
  takeOverDescription: string;
  approveButton: string;
  declineButton: string;
  openRun: string;
  settingsLink: string;
  noActionsYet: string;
  closingReportTitle: string;
  approvedBy: string;
  declinedBy: string;
  undoneBy: string;
  askedWhen: string;
  doneWhen: string;
  waitingOnRun: string;
  whoCanRespond: string;
  logLabel: string;
  trackRecord: PluralTemplate;
} = {
  sectionTitle: translationKey("Working the case"),
  respondButton: translationKey("Respond with AI"),
  takeOverButton: translationKey("Take Over"),
  takeOverDescription: translationKey(
    "OneUptime AI stops working the case, and it is yours.",
  ),
  approveButton: translationKey("Approve"),
  declineButton: translationKey("Decline"),
  openRun: translationKey("Open the run"),
  settingsLink: translationKey("What OneUptime AI may do"),
  noActionsYet: translationKey("Nothing yet."),
  closingReportTitle: translationKey("Closing report"),
  approvedBy: translationKey("Approved by {{name}}"),
  declinedBy: translationKey("Declined by {{name}}"),
  undoneBy: translationKey("Undone by {{name}}"),
  askedWhen: translationKey("Asked {{when}}"),
  doneWhen: translationKey("Done {{when}}"),
  waitingOnRun: translationKey(
    "Approve or decline it here, on the case's Playbooks page, or in Slack or Microsoft Teams.",
  ),
  whoCanRespond: translationKey(
    "Someone who can edit this case can ask OneUptime AI to respond.",
  ),
  logLabel: translationKey("What OneUptime AI did, asked or left"),
  trackRecord: {
    one: translationKey("It held on {{held}} of {{count}} similar case."),
    other: translationKey("It held on {{held}} of {{count}} similar cases."),
  },
};

// The data-testid of the card's response section, and of each step of its log.
export const SECURITY_CASE_AI_RESPONSE_TEST_ID: string =
  "security-case-ai-response";

export function getSecurityCaseAiActionTestId(id: string): string {
  return `security-case-ai-action-${id}`;
}
