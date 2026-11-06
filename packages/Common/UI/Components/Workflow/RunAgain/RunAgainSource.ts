/*
 * Run again's calls: starting the new run, and the reads the run views follow
 * it with. Run again itself is explained in Types/Workflow/WorkflowRunAgain.
 */

import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { parseTrace } from "../../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import { WORKFLOW_URL } from "../../../Config";
import API from "../../../Utils/API/API";
import ModelAPI, { ListResult } from "../../../Utils/ModelAPI/ModelAPI";
import { WatchedRunDetail } from "../UseRunWatch";
import { getWorkflowRunStartedBy } from "../WorkflowRunExport";

export type SendRunAgainFunction = (runId: string) => Promise<void>;

// Starts the new run. Rejects with the API's error when it is refused.
export const sendRunAgain: SendRunAgainFunction = async (
  runId: string,
): Promise<void> => {
  const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.post({
    url: URL.fromString(WORKFLOW_URL.toString()).addRoute(
      "/manual/run-again/" + runId,
    ),
    data: {},
    // A custom route gets no tenant header unless the call adds one.
    headers: ModelAPI.getCommonHeaders(),
  });

  if (result instanceof HTTPErrorResponse) {
    throw result;
  }
};

export type FetchLatestWorkflowRunFunction = (
  workflowId: ObjectID,
) => Promise<WatchedRunDetail | null>;

/*
 * A workflow's newest run, with what the run's window shows: what a page polls
 * while it follows a run it just started (UseRunWatch).
 */
export const fetchLatestWorkflowRun: FetchLatestWorkflowRunFunction = async (
  workflowId: ObjectID,
): Promise<WatchedRunDetail | null> => {
  const result: ListResult<WorkflowLog> = await ModelAPI.getList<WorkflowLog>({
    modelType: WorkflowLog,
    query: { workflowId: workflowId },
    limit: 1,
    skip: 0,
    select: {
      _id: true,
      workflowStatus: true,
      logs: true,
      stepTrace: true,
      // A run downloaded from the window is named and headed with these.
      createdAt: true,
      startedAt: true,
      completedAt: true,
      /*
       * A run started while the workflow is off is a test run, and the window
       * says so, with who started it.
       */
      isTestRun: true,
      startedByUser: {
        name: true,
        email: true,
      },
      canRunAgain: true,
    },
    sort: { createdAt: SortOrder.Descending },
  });

  const latest: WorkflowLog | undefined = result.data[0];

  if (!latest || !latest._id) {
    return null;
  }

  return {
    runId: latest._id.toString(),
    status: latest.workflowStatus as WorkflowStatus,
    logs: latest.logs || "",
    stepTrace: parseTrace((latest.stepTrace as JSONValue) || null),
    scheduledAt: latest.createdAt || null,
    startedAt: latest.startedAt || null,
    completedAt: latest.completedAt || null,
    isTestRun: latest.isTestRun === true,
    startedBy: getWorkflowRunStartedBy(latest.startedByUser),
    canRunAgain: latest.canRunAgain === true,
  };
};

export interface LastRunToRunAgain {
  runId: string;
  scheduledAt: Date | null;
}

export type LoadLastRunToRunAgainFunction = (
  workflowId: ObjectID,
) => Promise<LastRunToRunAgain | null>;

// The newest run of a workflow that can be run again, or null when none can.
export const loadLastRunToRunAgain: LoadLastRunToRunAgainFunction = async (
  workflowId: ObjectID,
): Promise<LastRunToRunAgain | null> => {
  const result: ListResult<WorkflowLog> = await ModelAPI.getList<WorkflowLog>({
    modelType: WorkflowLog,
    query: { workflowId: workflowId, canRunAgain: true },
    limit: 1,
    skip: 0,
    select: {
      _id: true,
      createdAt: true,
    },
    sort: { createdAt: SortOrder.Descending },
  });

  const latest: WorkflowLog | undefined = result.data[0];

  if (!latest || !latest._id) {
    return null;
  }

  return {
    runId: latest._id.toString(),
    scheduledAt: latest.createdAt || null,
  };
};
