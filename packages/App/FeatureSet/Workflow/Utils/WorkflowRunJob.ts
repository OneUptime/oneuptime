import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { RunProps } from "Common/Server/Types/Workflow/Workflow";

/*
 * What a run carries through the Workflow queue: written by QueueWorkflow when
 * it queues a run, read back by the worker (FeatureSet/Workflow/Index.ts) into
 * the RunProps RunWorkflow runs it with. Both sides live here so they cannot
 * drift apart - a key written under one name and read under another is a run
 * that quietly loses what it was meant to be: a test run whose log no longer
 * says so, or a step test that runs the whole workflow.
 *
 * A resumed run (a Sleep step waking up) is queued by
 * QueueWorkflow.addResumeJobToQueue with `isResume` and none of the rest:
 * whether it is a test run is read from its WorkflowLog row instead.
 */

export interface WorkflowRunJob {
  workflowId: ObjectID | string;
  workflowLogId: ObjectID | string | null;
  // The trigger's values.
  returnValues: JSONObject;
  callChain?: Array<string> | undefined;
  runOnlyComponentId?: string | undefined;
  /*
   * A person started it by hand while the workflow was turned off, and who:
   * see Types/Workflow/WorkflowEnabled.
   */
  isTestRun?: boolean | undefined;
  testRunStartedBy?: string | undefined;
}

export type BuildWorkflowRunJobDataFunction = (
  job: WorkflowRunJob,
) => JSONObject;

export const buildWorkflowRunJobData: BuildWorkflowRunJobDataFunction = (
  job: WorkflowRunJob,
): JSONObject => {
  const data: JSONObject = {
    data: job.returnValues,
    workflowLogId: job.workflowLogId ? job.workflowLogId.toString() : null,
    workflowId: job.workflowId.toString(),
    callChain: job.callChain || [],
    runOnlyComponentId: job.runOnlyComponentId || null,
  };

  /*
   * Only a test run carries the two keys, so every other run's job stays
   * exactly as it was.
   */
  if (job.isTestRun) {
    data["isTestRun"] = true;
    data["testRunStartedBy"] = job.testRunStartedBy || null;
  }

  return data;
};

export type GetRunPropsFromJobDataFunction = (
  data: JSONObject,
  timeout: number,
) => RunProps;

export const getRunPropsFromJobData: GetRunPropsFromJobDataFunction = (
  data: JSONObject,
  timeout: number,
): RunProps => {
  const testRunStartedBy: unknown = data["testRunStartedBy"];

  return {
    workflowId: new ObjectID(data["workflowId"] as string),
    workflowLogId: data["workflowLogId"]
      ? new ObjectID(data["workflowLogId"] as string)
      : null,
    arguments: (data["data"] as JSONObject) || {},
    timeout: timeout,
    callChain: (data["callChain"] as Array<string> | undefined) || [],
    isResume: data["isResume"] === true,
    runOnlyComponentId:
      (data["runOnlyComponentId"] as string | undefined) || undefined,
    // Only true itself: a job queued before test runs existed has no key.
    isTestRun: data["isTestRun"] === true,
    testRunStartedBy:
      typeof testRunStartedBy === "string" && testRunStartedBy
        ? testRunStartedBy
        : undefined,
  };
};
