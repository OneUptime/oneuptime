import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import { JSONObject } from "Common/Types/JSON";

/*
 * What the activity feed reads of the run its events belong to (issue
 * #6437): its status says whether a step can still be running, and its
 * times head the feed. Kept apart from the feed itself, so a page can read
 * a run's times without loading (or, in a test, mocking) the feed.
 */
export interface ActivityFeedRun {
  status?: AIRunStatus | undefined;
  createdAt?: Date | undefined;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  // When a run waiting between attempts tries again.
  retryAt?: Date | undefined;
}

// A run's status and times, from a run model.
export function toActivityFeedRun(run: AIRun): ActivityFeedRun {
  return {
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    retryAt: run.retryAt,
  };
}

// A run's status and times, as the API sends a run (JSON).
export function readActivityFeedRun(runJson: JSONObject): ActivityFeedRun {
  return toActivityFeedRun(AIRun.fromJSONObject(runJson, AIRun));
}

/*
 * A step can be running only while its run is: Running (or waiting for an
 * approval). A queued run - waiting for a worker, or between attempts -
 * and a run that is over have no step running. Without a run (Ask AI's
 * answers), the events alone say.
 */
export function canRunHaveRunningSteps(
  run: ActivityFeedRun | undefined,
): boolean {
  if (!run || !run.status) {
    return true;
  }

  return (
    run.status === AIRunStatus.Running ||
    run.status === AIRunStatus.WaitingForApproval
  );
}
