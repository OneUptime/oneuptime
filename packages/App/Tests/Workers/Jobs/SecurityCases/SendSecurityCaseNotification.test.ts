import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the DashboardCertsJobs
 * pattern).
 */
import { describe, expect, test } from "@jest/globals";

/*
 * The job that tells people about security cases is REGISTERED AT ALL.
 * JobDictionary.setJobFunction runs purely as a module side effect, so the
 * import line in App/FeatureSet/Workers/Index.ts is load-bearing: delete it
 * and every service suite stays green while every case, assignment and
 * approval queues a job no worker knows - nobody is told about a Critical
 * case again. The REAL JobDictionary runs here; only the notifier the job
 * hands its data to is replaced.
 */

const mockRunJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});

jest.mock("Common/Server/Utils/SecurityCase/SecurityCaseNotifications", () => {
  return {
    __esModule: true,
    SECURITY_CASE_NOTIFICATION_JOB: "SecurityCases:SendNotification",
    default: {
      runJob: mockRunJob,
    },
  };
});

// Imported AFTER the mock; the job's side effect is what this file is about.
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import { sendSecurityCaseNotification } from "../../../../FeatureSet/Workers/Jobs/SecurityCases/SendSecurityCaseNotification";

describe("SendSecurityCaseNotification job", () => {
  test("is registered under the name the notifier queues it by", () => {
    expect(JobDictionary.has("SecurityCases:SendNotification")).toBe(true);
    expect(JobDictionary.getJobFunction("SecurityCases:SendNotification")).toBe(
      sendSecurityCaseNotification,
    );
  });

  test("hands the job's data to the notifier as it is", async () => {
    const data: Record<string, string> = {
      kind: "PriorityReached",
      projectId: "11111111-1111-4111-8111-111111111111",
      securityCaseId: "22222222-2222-4222-8222-222222222222",
    };

    await JobDictionary.getJobFunction("SecurityCases:SendNotification")({
      data,
    } as never);

    expect(mockRunJob).toHaveBeenCalledWith(data);
  });

  test("a job without data is handed nothing to read, not undefined", async () => {
    mockRunJob.mockClear();

    await sendSecurityCaseNotification(undefined);

    expect(mockRunJob).toHaveBeenCalledWith({});
  });

  test("is imported by the Workers entry point, so a worker registers it", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import "./Jobs/SecurityCases/SendSecurityCaseNotification";',
    );
  });
});
