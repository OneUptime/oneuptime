import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A JOB THAT RUNS EVERY MINUTE, OR MORE OFTEN, MAY COST AT IDLE.
 *
 * Every OneUptime install runs every worker job on its schedule whether or
 * not anything changed, so what a frequent job reads is paid every minute
 * by every install, idle or not. On a stack of 49 projects and 980 monitors
 * (Scripts/Perf job-cost.js, 2026-10-27) the bodies of all the jobs cost 28
 * CPU seconds an hour between them, under 1% of a core, because each reads
 * only the records that are due; the one that runs every 30 seconds over
 * the heartbeat monitors that are due made half of their Postgres calls.
 *
 * Two rules keep it that way, read from the jobs' source:
 *
 *  - a job that runs more often than every minute is listed below with why
 *    it must;
 *  - a job that runs every minute or more often lists no projects
 *    (ProjectService.findBy / findAllBy / countBy): that is a read of every
 *    project, every minute, on every install. Work a project at a time is
 *    queued once for the projects that have it due (Utils/SecurityProjectJob),
 *    or reads the records that are due across projects. A job that must is
 *    listed below with why.
 */

const JOBS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Workers",
  "Jobs",
);

const SUB_MINUTE_SCHEDULES: Array<string> = [
  "EVERY_TEN_SECONDS",
  "EVERY_THIRTY_SECONDS",
];
const FREQUENT_SCHEDULES: Array<string> = [
  ...SUB_MINUTE_SCHEDULES,
  "EVERY_MINUTE",
];

// The jobs that run more often than every minute, and why they must.
const SUB_MINUTE_JOBS: Record<string, string> = {
  "IncomingRequestMonitor/CheckHeartbeat.ts":
    "A heartbeat monitor goes offline the moment its window passes without a request; a minute late is a page a minute late. Reads only the monitors not checked since the sweep began.",
  "IncomingEmailMonitor/CheckOnlineStatus.ts":
    "The same for monitors that expect an email: offline as soon as the window passes.",
  "Telegram/PollUpdates.ts":
    "A Telegram long poll for the bot's messages while polling is on; with it off, one read of the settings.",
};

// Jobs that run every minute or more often and list projects, and why.
const FREQUENT_JOBS_THAT_LIST_PROJECTS: Record<string, string> = {};

const PROJECT_LIST_READ: RegExp =
  /\bProjectService\s*\.\s*(?:findBy|findAllBy|countBy)\s*\(/;

function jobFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return jobFiles(full);
      }

      return entry.name.endsWith(".ts") ? [full] : [];
    });
}

// The schedule constants a job file runs on, production branch of a ternary.
function schedulesOf(source: string): Array<string> {
  const schedules: Array<string> = [];
  const pattern: RegExp = /schedule:([^,\n}]+)/g;
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    const value: string = match[1]!.trim();
    const production: string = value.includes("?")
      ? value.split(":").pop()!.trim()
      : value;

    schedules.push(production);
    match = pattern.exec(source);
  }

  return schedules;
}

function relative(file: string): string {
  return path.relative(JOBS_DIRECTORY, file).split(path.sep).join("/");
}

describe("worker jobs that run every minute or more often", () => {
  const files: Array<string> = jobFiles(JOBS_DIRECTORY);
  const scheduled: Array<{ file: string; schedules: Array<string> }> = files
    .map((file: string) => {
      return {
        file: relative(file),
        schedules: schedulesOf(fs.readFileSync(file, "utf8")),
      };
    })
    .filter((job: { file: string; schedules: Array<string> }) => {
      return job.schedules.length > 0;
    });

  test("the jobs are read", () => {
    expect(scheduled.length).toBeGreaterThan(150);
    // Every minute is the common cadence: about a hundred jobs.
    expect(
      scheduled.filter((job: { schedules: Array<string> }) => {
        return job.schedules.includes("EVERY_MINUTE");
      }).length,
    ).toBeGreaterThan(80);
  });

  test("a job that runs more often than every minute is listed with why", () => {
    const subMinute: Array<string> = scheduled
      .filter((job: { schedules: Array<string> }) => {
        return job.schedules.some((schedule: string) => {
          return SUB_MINUTE_SCHEDULES.includes(schedule);
        });
      })
      .map((job: { file: string }) => {
        return job.file;
      })
      .sort();

    expect(subMinute).toEqual(Object.keys(SUB_MINUTE_JOBS).sort());
  });

  test("a job that runs every minute or more often lists no projects", () => {
    const listing: Array<string> = scheduled
      .filter((job: { file: string; schedules: Array<string> }) => {
        return (
          job.schedules.some((schedule: string) => {
            return FREQUENT_SCHEDULES.includes(schedule);
          }) &&
          PROJECT_LIST_READ.test(
            fs.readFileSync(path.join(JOBS_DIRECTORY, job.file), "utf8"),
          )
        );
      })
      .map((job: { file: string }) => {
        return job.file;
      })
      .sort();

    expect(listing).toEqual(
      Object.keys(FREQUENT_JOBS_THAT_LIST_PROJECTS).sort(),
    );
  });

  test("the schedule reader reads what job files write", () => {
    expect(
      schedulesOf("{ schedule: EVERY_MINUTE, runOnStartup: false }"),
    ).toEqual(["EVERY_MINUTE"]);
    expect(
      schedulesOf(
        "{\n    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIVE_MINUTE,\n",
      ),
    ).toEqual(["EVERY_FIVE_MINUTE"]);
    expect(PROJECT_LIST_READ.test("await ProjectService.findBy({")).toBe(true);
    expect(PROJECT_LIST_READ.test("await ProjectService.findOneById({")).toBe(
      false,
    );
  });
});
