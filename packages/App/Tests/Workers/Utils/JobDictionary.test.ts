import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type JobDictionaryType from "../../../FeatureSet/Workers/Utils/JobDictionary";
import type { WorkerJobFunction } from "../../../FeatureSet/Workers/Utils/JobDictionary";

/*
 * JobDictionary.has() is what lets core register no-op placeholders only for
 * enterprise-owned cron names nothing else registered. JobDictionary is a
 * process-wide static, so each case starts from a fresh module registry.
 */

let JobDictionary: typeof JobDictionaryType;

const noop: WorkerJobFunction = async (): Promise<void> => {
  return undefined;
};

beforeEach(async () => {
  jest.resetModules();
  JobDictionary = (
    await import("../../../FeatureSet/Workers/Utils/JobDictionary")
  ).default;
});

describe("JobDictionary.has", () => {
  test("is false for a name nothing registered", () => {
    expect(JobDictionary.has("EnterpriseLicense:ReportUserCount")).toBe(false);
  });

  test("is true once a handler is registered, and agrees with getJobFunction", () => {
    JobDictionary.setJobFunction("InstanceHealth:EvaluateRedisHealth", noop);

    expect(JobDictionary.has("InstanceHealth:EvaluateRedisHealth")).toBe(true);
    expect(
      JobDictionary.getJobFunction("InstanceHealth:EvaluateRedisHealth"),
    ).toBe(noop);
  });

  test("is exact: no prefix or case matching", () => {
    JobDictionary.setJobFunction("EnterpriseLicense:ReportUserCount", noop);

    expect(JobDictionary.has("EnterpriseLicense:")).toBe(false);
    expect(JobDictionary.has("EnterpriseLicense:*")).toBe(false);
    expect(JobDictionary.has("enterpriselicense:reportusercount")).toBe(false);
    expect(JobDictionary.has("")).toBe(false);
  });

  test.each(["toString", "constructor", "hasOwnProperty", "__proto__"])(
    "never reports the inherited object member %s as a registered job",
    (name: string) => {
      expect(JobDictionary.has(name)).toBe(false);
    },
  );

  test("does not register anything itself", () => {
    JobDictionary.has("EnterpriseLicense:ReconcileInstanceUsage");

    expect(() => {
      JobDictionary.getJobFunction("EnterpriseLicense:ReconcileInstanceUsage");
    }).toThrow("No job found with name");
  });

  test("a job registered in one registry is not seen by a fresh one", async () => {
    JobDictionary.setJobFunction("EnterpriseLicense:ReportUserCount", noop);

    jest.resetModules();
    const fresh: typeof JobDictionaryType = (
      await import("../../../FeatureSet/Workers/Utils/JobDictionary")
    ).default;

    expect(fresh.has("EnterpriseLicense:ReportUserCount")).toBe(false);
  });
});
