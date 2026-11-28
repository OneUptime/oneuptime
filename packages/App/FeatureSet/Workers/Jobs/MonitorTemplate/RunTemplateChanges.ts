import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import MonitorTemplateChangeRunner, {
  MONITOR_TEMPLATE_CHANGE_JOB,
  MONITOR_TEMPLATE_CHANGE_JOB_TIMEOUT_MS,
} from "Common/Server/Utils/Monitor/MonitorTemplateChangeRunner";

/*
 * Runs a project's changes of monitors' template (a template's Linked
 * Monitors moved or unlinked, the Monitors list's Link to Template: issues
 * #11260, #11266), oldest first, until none is waiting. The job carries the
 * project's id only; each change says what it does and as whom. The queue
 * keeps one job per project waiting at most, so a project's changes run one
 * after another, never side by side (MonitorTemplateChangeRunner).
 */
export async function runTemplateChanges(job?: QueueJob): Promise<void> {
  const projectId: unknown = job?.data?.["projectId"];

  if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
    throw new BadDataException("A valid project ID is required.");
  }

  await MonitorTemplateChangeRunner.runProjectChanges(new ObjectID(projectId));
}

JobDictionary.setJobFunction(MONITOR_TEMPLATE_CHANGE_JOB, runTemplateChanges);
JobDictionary.setTimeoutInMs(
  MONITOR_TEMPLATE_CHANGE_JOB,
  MONITOR_TEMPLATE_CHANGE_JOB_TIMEOUT_MS,
);
