import { translationKey } from "../Translator";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "./SecurityPlaybookAction";

/*
 * EVERY PLAYBOOK ACTION'S TITLE, AS A SENTENCE A MESSAGE LOOKS UP.
 *
 * The step editor shows an action's title as SecurityPlaybookAction words
 * it, and the Dashboard's translators word every title in each language
 * (this folder is read by the Dashboard's extractor). A message the server
 * writes to a person in their own language - a step waiting for their
 * approval, in Slack or Microsoft Teams (SecurityPlaybookApprovalWords) -
 * names the action by the same title, so the server's locale set takes the
 * Dashboard's wording of each one (Scripts/I18n/ServerLocales'
 * DASHBOARD_SHARED_TEXT_SOURCES): never worded twice, and never apart.
 *
 * Each entry is the action's own title, byte for byte
 * (SecurityPlaybookActionWords.test.ts holds them together).
 */
export const SECURITY_PLAYBOOK_ACTION_TITLE_WORDS: Readonly<
  Record<SecurityPlaybookActionType, string>
> = {
  [SecurityPlaybookActionType.AssignCase]: translationKey("Assign the case"),
  [SecurityPlaybookActionType.SetCasePriority]:
    translationKey("Set the priority"),
  [SecurityPlaybookActionType.SetCaseStatus]: translationKey("Set the status"),
  [SecurityPlaybookActionType.AddCaseNote]: translationKey("Add a note"),
  [SecurityPlaybookActionType.AddCaseLabels]: translationKey("Add labels"),
  [SecurityPlaybookActionType.AddCaseTasks]: translationKey("Add tasks"),
  [SecurityPlaybookActionType.CheckThreatIntel]: translationKey(
    "Check entities against threat intel",
  ),
  [SecurityPlaybookActionType.LookUpEntityActivity]: translationKey(
    "Look up entity activity",
  ),
  [SecurityPlaybookActionType.PreserveEvidence]: translationKey(
    "Preserve the evidence",
  ),
  [SecurityPlaybookActionType.EmailPeople]: translationKey("Email people"),
  [SecurityPlaybookActionType.NotifyDataStoreOwners]: translationKey(
    "Notify data store owners",
  ),
  [SecurityPlaybookActionType.PostToSlack]: translationKey("Post to Slack"),
  [SecurityPlaybookActionType.PostToMicrosoftTeams]: translationKey(
    "Post to Microsoft Teams",
  ),
  [SecurityPlaybookActionType.PostStatusPageAnnouncement]: translationKey(
    "Post a status page announcement",
  ),
  [SecurityPlaybookActionType.PageOnCall]: translationKey("Page on-call"),
  [SecurityPlaybookActionType.DeclareIncident]: translationKey(
    "Declare an incident",
  ),
  [SecurityPlaybookActionType.SuspendOktaUser]: translationKey(
    "Suspend the user in Okta",
  ),
  [SecurityPlaybookActionType.EndOktaSessions]: translationKey(
    "End the user's Okta sessions",
  ),
  [SecurityPlaybookActionType.ContainCrowdStrikeHost]: translationKey(
    "Contain the host in CrowdStrike",
  ),
  [SecurityPlaybookActionType.IsolateDefenderDevice]: translationKey(
    "Isolate the device in Microsoft Defender",
  ),
  [SecurityPlaybookActionType.DisableEntraIdUser]: translationKey(
    "Disable the user in Microsoft Entra ID",
  ),
  [SecurityPlaybookActionType.SignOutEntraIdUser]: translationKey(
    "Sign the user out of Microsoft Entra ID",
  ),
  [SecurityPlaybookActionType.SuspendGoogleWorkspaceUser]: translationKey(
    "Suspend the user in Google Workspace",
  ),
  [SecurityPlaybookActionType.SignOutGoogleWorkspaceUser]: translationKey(
    "Sign the user out of Google Workspace",
  ),
  [SecurityPlaybookActionType.UnsuspendOktaUser]: translationKey(
    "Unsuspend the user in Okta",
  ),
  [SecurityPlaybookActionType.LiftCrowdStrikeContainment]: translationKey(
    "Lift containment in CrowdStrike",
  ),
  [SecurityPlaybookActionType.ReleaseDefenderDevice]: translationKey(
    "Release the device in Microsoft Defender",
  ),
  [SecurityPlaybookActionType.EnableEntraIdUser]: translationKey(
    "Enable the user in Microsoft Entra ID",
  ),
  [SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser]: translationKey(
    "Unsuspend the user in Google Workspace",
  ),
  [SecurityPlaybookActionType.BlockDataStorePublicAccess]: translationKey(
    "Block public access to data stores",
  ),
  [SecurityPlaybookActionType.RevokeDataStoreSharing]: translationKey(
    "Revoke data store sharing",
  ),
  [SecurityPlaybookActionType.BlockAddress]:
    translationKey("Block the address"),
  [SecurityPlaybookActionType.LiftAddressBlock]: translationKey(
    "Lift the block on the address",
  ),
  [SecurityPlaybookActionType.SendWebhook]: translationKey("Send a webhook"),
  [SecurityPlaybookActionType.RunWorkflow]: translationKey("Run a workflow"),
  [SecurityPlaybookActionType.RunRunbook]: translationKey("Run a runbook"),
  [SecurityPlaybookActionType.FixWithAi]: translationKey(
    "Fix the code with AI",
  ),
  [SecurityPlaybookActionType.StopRun]: translationKey("Stop the run"),
};

/*
 * The English title a message names an action by: its words above, the
 * definition's for an action they do not name, and the action's own name
 * for one this build does not know.
 */
export function getSecurityPlaybookActionTitleWords(
  type: SecurityPlaybookActionType | string | undefined | null,
): string {
  if (!type) {
    return "";
  }

  const words: string | undefined =
    SECURITY_PLAYBOOK_ACTION_TITLE_WORDS[type as SecurityPlaybookActionType];

  if (words) {
    return words;
  }

  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(type);

  return definition?.title || type;
}
