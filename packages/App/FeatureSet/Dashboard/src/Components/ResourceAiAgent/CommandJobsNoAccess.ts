import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { buildNoAccessState } from "Common/UI/Components/ModelTable/ModelTableEmptyState";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHY A CLUSTER'S OR A RESOURCE'S AI LOGS PAGE SHOWS NO COMMANDS.
 *
 * The command history is Runner job rows, which the roles that may open a
 * cluster's or a resource's AI pages (the Settings roles, Read Kubernetes
 * Cluster, Read Ceph Cluster, ...) may not read: a Runner job of a runbook
 * carries its script and what it printed. The commands card says so instead
 * of drawing a table that could only fail - as every list a reader may not
 * read says it (BaseModelTable's no-access state): its lock, "You don't have
 * access to this list", and the one permission to ask for - "You need this
 * permission: Read Runbook Execution. Ask a project admin for access." - or
 * the team that blocks it. It used to be a sentence of its own that listed
 * every role and permission that reads Runner jobs: "(one of: Project Owner,
 * Project Admin, Project Member, Viewer, Runbook Admin, Runbook Member,
 * Runbook Viewer, Read Runbook Execution)".
 */
export function getCommandJobsNoAccessState(
  translator: Translator,
): TableEmptyStateProps {
  return buildNoAccessState({
    neededPermissions: PermissionGate.getAllowingSentence({
      permissions: PermissionGate.getReadPermissionsOfItsKind(new RunnerJob()),
    }),
    translate: (text: string): string => {
      return translator.translateText(text);
    },
  });
}
