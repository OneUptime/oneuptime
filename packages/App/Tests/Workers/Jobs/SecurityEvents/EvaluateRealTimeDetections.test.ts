import JobDictionary, {
  WorkerJobFunction,
} from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import { evaluateRealTimeDetection } from "../../../../FeatureSet/Workers/Jobs/DetectionRules/EvaluateRealTimeDetections";
import RealTimeDetectionJob from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob";
import { REAL_TIME_DETECTION_JOB } from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The Worker's handler for DetectionRules:EvaluateRealTime: a real-time
 * rule's confirmation, queued by every path that writes security events
 * when its screen let some of them through. It hands the job's project,
 * rule and events to RealTimeDetectionJob, and refuses a job that names
 * none of them.
 */

jest.mock(
  "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob",
    );

    return {
      __esModule: true,
      ...actual,
      default: { evaluate: jest.fn() },
    };
  },
);

const PROJECT_ID: string = "71717171-7171-4717-8717-717171717171";
const RULE_ID: string = "72727272-7272-4727-8727-727272727272";

function job(data: Record<string, unknown>): QueueJob {
  return { name: REAL_TIME_DETECTION_JOB, data } as unknown as QueueJob;
}

describe("EvaluateRealTimeDetections", () => {
  test("is the job function for the real-time detection job", () => {
    const registered: WorkerJobFunction | undefined =
      JobDictionary.getJobFunction(REAL_TIME_DETECTION_JOB);

    expect(registered).toBe(evaluateRealTimeDetection);
    expect(REAL_TIME_DETECTION_JOB).toBe("DetectionRules:EvaluateRealTime");
  });

  test("hands the job's project, rule and events to the confirmation", async () => {
    await evaluateRealTimeDetection(
      job({
        projectId: PROJECT_ID,
        ruleId: RULE_ID,
        events: [{ id: "row-1", time: "2026-10-30T09:00:00.000Z" }],
        attempt: 2,
      }),
    );

    expect(RealTimeDetectionJob.evaluate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      ruleId: RULE_ID,
      events: [{ id: "row-1", time: "2026-10-30T09:00:00.000Z" }],
      attempt: 2,
    });
  });

  test("refuses a job that names no project or rule", async () => {
    await expect(
      evaluateRealTimeDetection(job({ ruleId: RULE_ID, events: [] })),
    ).rejects.toThrow(
      "A real-time detection job needs a project, a rule and its events.",
    );
    await expect(evaluateRealTimeDetection(undefined)).rejects.toThrow();
  });
});
