import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

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
 * Two rules keep it that way:
 *
 *  - a job that runs more often than every minute is listed below with why
 *    it must;
 *  - a job that runs every minute or more often lists no projects
 *    (ProjectService.findBy / findAllBy / countBy): that is a read of every
 *    project, every minute, on every install. Work a project at a time is
 *    queued once for the projects that have it due (Utils/SecurityProjectJob),
 *    or reads the records that are due across projects. A job that must is
 *    listed below with why.
 *
 * Read from the jobs' syntax trees: every RunCron(name, { schedule }, ...)
 * call in the App's Workers jobs and, where ee/ is checked out, in
 * ee/Server's. A schedule is read to its cron text - a string, a constant
 * of the job's own file, or one of Common/Utils/CronTime's - and, behind
 * `IsDevelopment ? a : b`, to its production side (both sides of any other
 * condition). How often it runs is read from that text, not from a
 * constant's name, so a new constant or a written schedule counts as well.
 * A schedule the reader cannot read fails "the jobs are read", so no job
 * slips by unread. App Test deletes ee/ first; the Enterprise Edition Test
 * workflow (test.ee.yaml) runs this with ee/ present.
 */

const APP_DIRECTORY: string = path.join(__dirname, "..", "..");
const REPOSITORY_DIRECTORY: string = path.join(APP_DIRECTORY, "..", "..");
const JOBS_DIRECTORY: string = path.join(
  APP_DIRECTORY,
  "FeatureSet",
  "Workers",
  "Jobs",
);
const EE_SERVER_DIRECTORY: string = path.join(
  REPOSITORY_DIRECTORY,
  "ee",
  "Server",
);
const CRON_TIME_FILE: string = path.join(
  REPOSITORY_DIRECTORY,
  "packages",
  "Common",
  "Utils",
  "CronTime.ts",
);
const HAS_EE: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

// The jobs that run more often than every minute, and why they must.
const SUB_MINUTE_JOBS: Record<string, string> = {
  "packages/App/FeatureSet/Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat.ts":
    "A heartbeat monitor goes offline the moment its window passes without a request; a minute late is a page a minute late. Reads only the monitors not checked since the sweep began.",
  "packages/App/FeatureSet/Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus.ts":
    "The same for monitors that expect an email: offline as soon as the window passes.",
  "packages/App/FeatureSet/Workers/Jobs/Telegram/PollUpdates.ts":
    "A Telegram long poll for the bot's messages while polling is on; with it off, one read of the settings.",
};

// Jobs that run every minute or more often and list projects, and why.
const FREQUENT_JOBS_THAT_LIST_PROJECTS: Record<string, string> = {};

const PROJECT_LIST_READS: Array<string> = ["findBy", "findAllBy", "countBy"];

const CRON_FIELDS: RegExp = /\s+/;
const WHOLE_NUMBER: RegExp = /^\d+$/;
const CRON_TIME_MODULE: RegExp = /(?:^|\/)Utils\/CronTime$/;

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
];

function codeFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return SKIPPED_DIRECTORIES.includes(entry.name) ? [] : codeFiles(full);
      }

      return entry.name.endsWith(".ts") ? [full] : [];
    });
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

// A file's top-level constants: `const NAME = <initializer>`, by name.
function constantsOf(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const constants: Map<string, ts.Expression> = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  return constants;
}

// What each name a file imports from Common/Utils/CronTime stands for there.
function cronTimeImportsOf(sourceFile: ts.SourceFile): Map<string, string> {
  const imported: Map<string, string> = new Map();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !CRON_TIME_MODULE.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imported.set(
          element.name.text,
          (element.propertyName || element.name).text,
        );
      }
    }
  }

  return imported;
}

const CRON_TIME_SOURCE: ts.SourceFile = parse(
  CRON_TIME_FILE,
  fs.readFileSync(CRON_TIME_FILE, "utf8"),
);
const CRON_TIME: Map<string, ts.Expression> = constantsOf(CRON_TIME_SOURCE);

interface ScheduleScope {
  constants: Map<string, ts.Expression>;
  cronTimeImports: Map<string, string>;
}

const CRON_TIME_SCOPE: ScheduleScope = {
  constants: CRON_TIME,
  cronTimeImports: new Map(),
};

/*
 * The cron texts a schedule can be in production, or null where the reader
 * cannot tell.
 */
function productionSchedules(
  expression: ts.Expression,
  scope: ScheduleScope,
  depth: number = 0,
): Array<string> | null {
  if (depth > 10) {
    return null;
  }

  if (ts.isParenthesizedExpression(expression)) {
    return productionSchedules(expression.expression, scope, depth + 1);
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }

  if (ts.isConditionalExpression(expression)) {
    // Production is the false side of IsDevelopment; of anything else, either.
    if (
      ts.isIdentifier(expression.condition) &&
      expression.condition.text === "IsDevelopment"
    ) {
      return productionSchedules(expression.whenFalse, scope, depth + 1);
    }

    const whenTrue: Array<string> | null = productionSchedules(
      expression.whenTrue,
      scope,
      depth + 1,
    );
    const whenFalse: Array<string> | null = productionSchedules(
      expression.whenFalse,
      scope,
      depth + 1,
    );

    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }

  if (ts.isIdentifier(expression)) {
    const own: ts.Expression | undefined = scope.constants.get(expression.text);

    if (own) {
      return productionSchedules(own, scope, depth + 1);
    }

    const cronTimeName: string | undefined = scope.cronTimeImports.get(
      expression.text,
    );
    const shared: ts.Expression | undefined = cronTimeName
      ? CRON_TIME.get(cronTimeName)
      : undefined;

    return shared
      ? productionSchedules(shared, CRON_TIME_SCOPE, depth + 1)
      : null;
  }

  return null;
}

function runsMoreOftenThanEveryMinute(schedule: string): boolean {
  const fields: Array<string> = schedule.trim().split(CRON_FIELDS);

  return fields.length === 6 && !WHOLE_NUMBER.test(fields[0]!);
}

function runsEveryMinuteOrMoreOften(schedule: string): boolean {
  if (runsMoreOftenThanEveryMinute(schedule)) {
    return true;
  }

  const fields: Array<string> = schedule.trim().split(CRON_FIELDS);
  const minute: string | undefined =
    fields.length === 6 ? fields[1] : fields[0];

  return minute === "*" || minute === "*/1";
}

interface ReadJob {
  // Repository-relative path of the file.
  file: string;
  // The production schedules of each RunCron call; null where unreadable.
  schedules: Array<Array<string> | null>;
  listsProjects: boolean;
}

// Every RunCron call in a source, and whether it lists projects.
function readJob(file: string, source: string): ReadJob {
  const sourceFile: ts.SourceFile = parse(file, source);
  const scope: ScheduleScope = {
    constants: constantsOf(sourceFile),
    cronTimeImports: cronTimeImportsOf(sourceFile),
  };
  const schedules: Array<Array<string> | null> = [];
  let listsProjects: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;

      if (ts.isIdentifier(callee) && callee.text === "RunCron") {
        const options: ts.Expression | undefined = node.arguments[1];
        const schedule: ts.ObjectLiteralElementLike | undefined =
          options && ts.isObjectLiteralExpression(options)
            ? options.properties.find(
                (property: ts.ObjectLiteralElementLike): boolean => {
                  return (
                    property.name !== undefined &&
                    (ts.isIdentifier(property.name) ||
                      ts.isStringLiteral(property.name)) &&
                    property.name.text === "schedule"
                  );
                },
              )
            : undefined;

        schedules.push(
          schedule && ts.isPropertyAssignment(schedule)
            ? productionSchedules(schedule.initializer, scope)
            : null,
        );
      }

      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "ProjectService" &&
        PROJECT_LIST_READS.includes(callee.name.text)
      ) {
        listsProjects = true;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { file: file, schedules: schedules, listsProjects: listsProjects };
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIRECTORY, file).split(path.sep).join("/");
}

function readJobsIn(directory: string): Array<ReadJob> {
  return codeFiles(directory)
    .map((file: string): ReadJob => {
      return readJob(relative(file), fs.readFileSync(file, "utf8"));
    })
    .filter((job: ReadJob): boolean => {
      return job.schedules.length > 0;
    });
}

function allSchedulesOf(job: ReadJob): Array<string> {
  return job.schedules.flatMap((schedules: Array<string> | null) => {
    return schedules || [];
  });
}

describe("worker jobs that run every minute or more often", () => {
  const appJobs: Array<ReadJob> = readJobsIn(JOBS_DIRECTORY);
  const eeJobs: Array<ReadJob> = HAS_EE ? readJobsIn(EE_SERVER_DIRECTORY) : [];
  const jobs: Array<ReadJob> = [...appJobs, ...eeJobs];

  test("the jobs are read, every schedule to its cron text", () => {
    expect(appJobs.length).toBeGreaterThan(150);
    // Every minute is the common cadence: about a hundred jobs.
    expect(
      appJobs.filter((job: ReadJob): boolean => {
        return allSchedulesOf(job).includes("* * * * *");
      }).length,
    ).toBeGreaterThan(80);

    if (HAS_EE) {
      expect(eeJobs.length).toBeGreaterThan(10);
    }

    const unread: Array<string> = jobs
      .filter((job: ReadJob): boolean => {
        return job.schedules.some((schedules: Array<string> | null) => {
          return schedules === null;
        });
      })
      .map((job: ReadJob): string => {
        return job.file;
      });

    expect(unread).toEqual([]);
  });

  test("a job that runs more often than every minute is listed with why", () => {
    const subMinute: Array<string> = jobs
      .filter((job: ReadJob): boolean => {
        return allSchedulesOf(job).some(runsMoreOftenThanEveryMinute);
      })
      .map((job: ReadJob): string => {
        return job.file;
      })
      .sort();

    expect(subMinute).toEqual(Object.keys(SUB_MINUTE_JOBS).sort());
  });

  test("a job that runs every minute or more often lists no projects", () => {
    const listing: Array<string> = jobs
      .filter((job: ReadJob): boolean => {
        return (
          job.listsProjects &&
          allSchedulesOf(job).some(runsEveryMinuteOrMoreOften)
        );
      })
      .map((job: ReadJob): string => {
        return job.file;
      })
      .sort();

    expect(listing).toEqual(
      Object.keys(FREQUENT_JOBS_THAT_LIST_PROJECTS).sort(),
    );
  });

  test("how often a schedule runs is read from its cron text", () => {
    const value: (name: string) => string = (name: string): string => {
      const schedules: Array<string> | null = productionSchedules(
        ts.factory.createIdentifier(name),
        CRON_TIME_SCOPE,
      );

      expect(schedules).toHaveLength(1);
      return schedules![0]!;
    };

    for (const name of [
      "EVERY_FIVE_SECONDS",
      "EVERY_TEN_SECONDS",
      "EVERY_THIRTY_SECONDS",
    ]) {
      expect(runsMoreOftenThanEveryMinute(value(name))).toBe(true);
      expect(runsEveryMinuteOrMoreOften(value(name))).toBe(true);
    }

    expect(runsMoreOftenThanEveryMinute(value("EVERY_MINUTE"))).toBe(false);
    expect(runsEveryMinuteOrMoreOften(value("EVERY_MINUTE"))).toBe(true);

    for (const name of [
      "EVERY_FIVE_MINUTE",
      "EVERY_FIFTEEN_MINUTE",
      "EVERY_HOUR",
      "EVERY_DAY",
      "EVERY_WEEK",
    ]) {
      expect(runsEveryMinuteOrMoreOften(value(name))).toBe(false);
    }

    // Written out: a seconds field of one second runs once a minute.
    expect(runsMoreOftenThanEveryMinute("15 * * * * *")).toBe(false);
    expect(runsEveryMinuteOrMoreOften("15 * * * * *")).toBe(true);
    expect(runsMoreOftenThanEveryMinute("*/15 * * * * *")).toBe(true);
    expect(runsEveryMinuteOrMoreOften("*/1 * * * *")).toBe(true);
    expect(runsEveryMinuteOrMoreOften("15 * * * *")).toBe(false);
  });

  test("the reader reads what job files write", () => {
    const read: (source: string) => ReadJob = (source: string): ReadJob => {
      return readJob("Example.ts", source);
    };
    const header: string = [
      'import RunCron from "../../Utils/Cron";',
      'import { EVERY_MINUTE, EVERY_FIVE_MINUTE as FIVE, EVERY_TEN_SECONDS } from "Common/Utils/CronTime";',
      'import { IsDevelopment } from "Common/Server/EnvironmentConfig";',
    ].join("\n");

    expect(
      read(
        `${header}\nRunCron("a", { schedule: EVERY_MINUTE, runOnStartup: false }, async () => {});`,
      ).schedules,
    ).toEqual([["* * * * *"]]);
    // The production side of IsDevelopment, through an imported alias.
    expect(
      read(
        `${header}\nRunCron("a", { schedule: IsDevelopment ? EVERY_MINUTE : FIVE }, async () => {});`,
      ).schedules,
    ).toEqual([["*/5 * * * *"]]);
    // Both sides of another condition.
    expect(
      read(
        `${header}\nRunCron("a", { schedule: isBusy ? EVERY_TEN_SECONDS : "15 * * * *" }, async () => {});`,
      ).schedules,
    ).toEqual([["*/10 * * * * *", "15 * * * *"]]);
    // A constant of the file's own, naming a CronTime one.
    expect(
      read(
        `${header}\nexport const JOB_SCHEDULE: string = EVERY_TEN_SECONDS;\nRunCron("a", { schedule: JOB_SCHEDULE }, async () => {});`,
      ).schedules,
    ).toEqual([["*/10 * * * * *"]]);
    // What it cannot read, it says so.
    expect(
      read(
        `${header}\nRunCron("a", { schedule: scheduleFromSettings() }, async () => {});\nRunCron("b", { schedule: UNKNOWN }, async () => {});\nRunCron("c", options, async () => {});`,
      ).schedules,
    ).toEqual([null, null, null]);
    // Comments and other calls are not jobs, nor project reads.
    const quiet: ReadJob = read(
      `${header}\n// RunCron("a", { schedule: EVERY_MINUTE }) and ProjectService.findBy(\nconst schedule: string = "schedule: EVERY_MINUTE";\nawait ProjectService.findOneById({});`,
    );

    expect(quiet.schedules).toEqual([]);
    expect(quiet.listsProjects).toBe(false);
    expect(
      read(`${header}\nawait ProjectService.findAllBy({ query: {} });`)
        .listsProjects,
    ).toBe(true);
  });
});
