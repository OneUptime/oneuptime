import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY A CLUSTER'S OR A RESOURCE'S AI LOGS PAGE SHOWS NO COMMANDS.
 *
 * The command history is Runner job rows, which the roles that may open a
 * cluster's or a resource's AI pages (the Settings roles, Read Kubernetes
 * Cluster, Read Ceph Cluster, ...) may not read: a Runner job of a runbook
 * carries its script and what it printed. The page says so instead of
 * drawing a table that could only fail, and names what would let them see
 * the commands the way every lock in the product does
 * (PermissionGate.getRefusalReason): the one permission to ask for - "You
 * need this permission: Read Runbook Execution." - or the team that blocks
 * it. It used to list every role and permission that reads Runner jobs:
 * "(one of: Project Owner, Project Admin, Project Member, Viewer, Runbook
 * Admin, Runbook Member, Runbook Viewer, Read Runbook Execution)".
 */
export const COMMAND_JOBS_NOTE_TEXT: { needs: string; alsoOn: string } = {
  needs: translationKey(
    "Seeing the commands needs permission to read Runner jobs.",
  ),
  alsoOn: translationKey(
    "Commands AI ran while investigating or fixing an incident or alert also appear on that incident or alert.",
  ),
};

// The note, in the reader's language.
export function getCommandJobsPermissionNote(translator: Translator): string {
  const refusal: string = PermissionGate.getRefusalReason({
    sentence: COMMAND_JOBS_NOTE_TEXT.needs,
    permissions: new RunnerJob().getReadPermissions(),
  });

  return `${refusal} ${
    translator.translateText(COMMAND_JOBS_NOTE_TEXT.alsoOn) ||
    COMMAND_JOBS_NOTE_TEXT.alsoOn
  }`;
}
