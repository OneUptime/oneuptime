import { deleteIdleSampleProjects } from "../../FeatureSet/Workers/Jobs/SampleProject/DeleteIdleSampleProjects";
import RunCron from "../../FeatureSet/Workers/Utils/Cron";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_DAY } from "Common/Utils/CronTime";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ON ONEUPTIME CLOUD, A SAMPLE NOBODY VISITS GOES AWAY (issue #6808): once a
 * day, every sample project nobody has opened for two weeks is deleted, as
 * Delete Sample Project would delete it. Never a real project, never on a
 * self-hosted server, and one that fails to delete leaves the others to go.
 */

interface Flags {
  billingEnabled: boolean;
}

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const flags: Flags = { billingEnabled: true };

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    mockFlags: flags,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return flags.billingEnabled;
    },
  });

  return mocked;
});

// RunCron registers a repeatable job at import time.
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Logger");

const registrations: Array<Array<unknown>> = [
  ...(RunCron as unknown as jest.Mock).mock.calls,
];

const flags: Flags = (
  jest.requireMock("Common/Server/EnvironmentConfig") as { mockFlags: Flags }
).mockFlags;

const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

const sample: (
  name: string,
  data: { lastActiveDaysAgo: number | null; createdDaysAgo: number },
) => Project = (
  name: string,
  data: { lastActiveDaysAgo: number | null; createdDaysAgo: number },
): Project => {
  const project: Project = new Project();
  project._id = new ObjectID(
    `5a3c0000-0000-4000-8000-${Buffer.from(name).toString("hex").padEnd(12, "0").slice(0, 12)}`,
  ).toString();
  project.createdAt = new Date(NOW.getTime() - data.createdDaysAgo * DAY_MS);

  if (data.lastActiveDaysAgo !== null) {
    project.lastActive = new Date(
      NOW.getTime() - data.lastActiveDaysAgo * DAY_MS,
    );
  }

  return project;
};

let findBy: jest.SpyInstance;
let deleteOneById: jest.SpyInstance;

beforeEach(() => {
  flags.billingEnabled = true;
  findBy = jest
    .spyOn(ProjectService, "findBy")
    .mockResolvedValue([
      sample("idle", { lastActiveDaysAgo: 20, createdDaysAgo: 30 }),
      sample("visited", { lastActiveDaysAgo: 1, createdDaysAgo: 30 }),
      sample("never", { lastActiveDaysAgo: null, createdDaysAgo: 15 }),
      sample("new", { lastActiveDaysAgo: null, createdDaysAgo: 2 }),
    ] as never);
  deleteOneById = jest
    .spyOn(ProjectService, "deleteOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SampleProject:DeleteIdleSampleProjects", () => {
  test("runs once a day, not on startup", () => {
    expect(registrations).toHaveLength(1);
    expect(registrations[0]![0]).toBe("SampleProject:DeleteIdleSampleProjects");
    expect(registrations[0]![1]).toEqual(
      expect.objectContaining({ schedule: EVERY_DAY, runOnStartup: false }),
    );
  });

  test("reads only sample projects", async () => {
    await deleteIdleSampleProjects(NOW);

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { isSampleProject: true },
        props: { isRoot: true },
      }),
    );
  });

  test("deletes the ones nobody opened for two weeks, and keeps the rest", async () => {
    await expect(deleteIdleSampleProjects(NOW)).resolves.toBe(2);

    const deleted: Array<string> = deleteOneById.mock.calls.map(
      (args: Array<unknown>) => {
        return ((args[0] as { id: ObjectID }).id as ObjectID).toString();
      },
    );

    expect(deleted).toEqual([
      sample("idle", {
        lastActiveDaysAgo: 20,
        createdDaysAgo: 30,
      }).id!.toString(),
      sample("never", {
        lastActiveDaysAgo: null,
        createdDaysAgo: 15,
      }).id!.toString(),
    ]);
    expect(deleteOneById).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  test("one that fails to delete leaves the others to go", async () => {
    deleteOneById.mockRejectedValueOnce(new Error("busy"));

    await expect(deleteIdleSampleProjects(NOW)).resolves.toBe(1);
    expect(deleteOneById).toHaveBeenCalledTimes(2);
  });

  test("a self-hosted server deletes nothing", async () => {
    flags.billingEnabled = false;

    await expect(deleteIdleSampleProjects(NOW)).resolves.toBe(0);
    expect(findBy).not.toHaveBeenCalled();
    expect(deleteOneById).not.toHaveBeenCalled();
  });
});
