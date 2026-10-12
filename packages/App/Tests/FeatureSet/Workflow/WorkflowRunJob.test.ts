import {
  buildWorkflowRunJobData,
  getRunPropsFromJobData,
} from "../../../FeatureSet/Workflow/Utils/WorkflowRunJob";
import { RunProps } from "Common/Server/Types/Workflow/Workflow";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a run carries through the Workflow queue, from QueueWorkflow to the
 * worker. Both sides read the one pair of helpers, so a test run stays a test
 * run on the way: a key written under one name and read under another would
 * be a run whose log no longer says what it is.
 */

const WORKFLOW_ID: string = "7c000000-0000-4000-8000-000000000001";
const WORKFLOW_LOG_ID: string = "7c000000-0000-4000-8000-000000000002";

describe("the job a run is queued as", () => {
  test("an ordinary run is written exactly as before", () => {
    expect(
      buildWorkflowRunJobData({
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        returnValues: { value: "Hello" },
      }),
    ).toEqual({
      data: { value: "Hello" },
      workflowLogId: WORKFLOW_LOG_ID,
      workflowId: WORKFLOW_ID,
      callChain: [],
      runOnlyComponentId: null,
    });
  });

  test("ids are written as text, whether given as ids or as text", () => {
    const data: JSONObject = buildWorkflowRunJobData({
      workflowId: new ObjectID(WORKFLOW_ID),
      workflowLogId: new ObjectID(WORKFLOW_LOG_ID),
      returnValues: {},
    });

    expect(data["workflowId"]).toBe(WORKFLOW_ID);
    expect(data["workflowLogId"]).toBe(WORKFLOW_LOG_ID);
  });

  test("a scheduled run has no log yet", () => {
    expect(
      buildWorkflowRunJobData({
        workflowId: WORKFLOW_ID,
        workflowLogId: null,
        returnValues: {},
      })["workflowLogId"],
    ).toBeNull();
  });

  test("a test run says so, and who started it", () => {
    expect(
      buildWorkflowRunJobData({
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        returnValues: {},
        runOnlyComponentId: "log-1",
        callChain: [],
        isTestRun: true,
        testRunStartedBy: "Ada Lovelace",
      }),
    ).toEqual({
      data: {},
      workflowLogId: WORKFLOW_LOG_ID,
      workflowId: WORKFLOW_ID,
      callChain: [],
      runOnlyComponentId: "log-1",
      isTestRun: true,
      testRunStartedBy: "Ada Lovelace",
    });
  });

  test("a test run whose starter is not known names nobody", () => {
    const data: JSONObject = buildWorkflowRunJobData({
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      returnValues: {},
      isTestRun: true,
    });

    expect(data["isTestRun"]).toBe(true);
    expect(data["testRunStartedBy"]).toBeNull();
  });

  test("a run that is no test run carries neither key", () => {
    const data: JSONObject = buildWorkflowRunJobData({
      workflowId: WORKFLOW_ID,
      workflowLogId: WORKFLOW_LOG_ID,
      returnValues: {},
      isTestRun: false,
      testRunStartedBy: "Ada Lovelace",
    });

    expect(Object.keys(data)).not.toContain("isTestRun");
    expect(Object.keys(data)).not.toContain("testRunStartedBy");
  });
});

describe("the run the worker reads back", () => {
  test("a test run arrives as one, with who started it", () => {
    const props: RunProps = getRunPropsFromJobData(
      buildWorkflowRunJobData({
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        returnValues: { value: "Hello" },
        callChain: ["7c000000-0000-4000-8000-000000000009"],
        runOnlyComponentId: "log-1",
        isTestRun: true,
        testRunStartedBy: "Ada Lovelace",
      }),
      120_000,
    );

    expect(props.workflowId.toString()).toBe(WORKFLOW_ID);
    expect(props.workflowLogId?.toString()).toBe(WORKFLOW_LOG_ID);
    expect(props.arguments).toEqual({ value: "Hello" });
    expect(props.timeout).toBe(120_000);
    expect(props.callChain).toEqual(["7c000000-0000-4000-8000-000000000009"]);
    expect(props.runOnlyComponentId).toBe("log-1");
    expect(props.isResume).toBe(false);
    expect(props.isTestRun).toBe(true);
    expect(props.testRunStartedBy).toBe("Ada Lovelace");
  });

  test("an ordinary run arrives as no test run", () => {
    const props: RunProps = getRunPropsFromJobData(
      buildWorkflowRunJobData({
        workflowId: WORKFLOW_ID,
        workflowLogId: null,
        returnValues: {},
      }),
      5_000,
    );

    expect(props.workflowLogId).toBeNull();
    expect(props.isTestRun).toBe(false);
    expect(props.testRunStartedBy).toBeUndefined();
    expect(props.runOnlyComponentId).toBeUndefined();
  });

  test("a job queued before test runs existed reads as no test run", () => {
    const props: RunProps = getRunPropsFromJobData(
      {
        data: { value: "Hello" },
        workflowLogId: WORKFLOW_LOG_ID,
        workflowId: WORKFLOW_ID,
        callChain: [],
        runOnlyComponentId: null,
      },
      5_000,
    );

    expect(props.isTestRun).toBe(false);
    expect(props.arguments).toEqual({ value: "Hello" });
  });

  test("only true itself makes a test run", () => {
    for (const isTestRun of ["true", 1, "yes", {}]) {
      expect(
        getRunPropsFromJobData(
          {
            data: {},
            workflowId: WORKFLOW_ID,
            workflowLogId: null,
            isTestRun: isTestRun as never,
          },
          5_000,
        ).isTestRun,
      ).toBe(false);
    }
  });

  test("a resumed run is read as one, from the job the Sleep step queued", () => {
    const props: RunProps = getRunPropsFromJobData(
      {
        data: {},
        workflowId: WORKFLOW_ID,
        workflowLogId: WORKFLOW_LOG_ID,
        isResume: true,
      },
      5_000,
    );

    expect(props.isResume).toBe(true);
    // Whether it is a test run is read from its log row instead.
    expect(props.isTestRun).toBe(false);
    expect(props.arguments).toEqual({});
  });

  test("a job with no values hands the runner none, rather than nothing", () => {
    expect(
      getRunPropsFromJobData(
        { workflowId: WORKFLOW_ID, workflowLogId: null },
        5_000,
      ).arguments,
    ).toEqual({});
  });
});

describe("both sides use these helpers", () => {
  const WORKFLOW_DIR: string = path.resolve(
    __dirname,
    "../../../FeatureSet/Workflow",
  );

  test("QueueWorkflow writes the job with buildWorkflowRunJobData", () => {
    const source: string = fs.readFileSync(
      path.join(WORKFLOW_DIR, "Services", "QueueWorkflow.ts"),
      "utf8",
    );

    expect(source).toContain("buildWorkflowRunJobData({");
  });

  test("the worker reads it with getRunPropsFromJobData", () => {
    const source: string = fs.readFileSync(
      path.join(WORKFLOW_DIR, "Index.ts"),
      "utf8",
    );

    expect(source).toContain("getRunPropsFromJobData(");
    // And no longer picks the keys out by hand.
    expect(source).not.toContain('job.data["workflowLogId"]');
  });
});
