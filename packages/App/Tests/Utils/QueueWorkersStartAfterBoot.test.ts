import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE APP'S QUEUE WORKERS TAKE JOBS ONLY ONCE IT HAS STARTED.
 *
 * A queue worker waits for QueueWorker.startProcessingJobs() before it takes
 * a job. App/Index.ts - the one process that runs queue workers - calls it
 * once, after it has connected to Postgres (which also waits for the schema
 * migrations its code needs), Valkey and both ClickHouse instances, and
 * after every feature set that builds a worker is initialized. Before, the
 * telemetry worker took jobs from the moment its module was imported, and
 * while a worker pod waited for a migration that could not finish it failed
 * them all and they were dropped: the probes' results and the logs, metrics
 * and traces of every project.
 *
 * Read from the source with comments removed, so prose cannot satisfy it.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const INDEX_PATH: string = path.join(APP_ROOT, "Index.ts");
const START_CALL: string = "QueueWorker.startProcessingJobs()";

function code(filePath: string): string {
  const source: string = fs.readFileSync(filePath, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(filePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

function indexOfOnly(haystack: string, needle: string): number {
  const first: number = haystack.indexOf(needle);
  expect({ needle, found: first >= 0 }).toEqual({ needle, found: true });
  expect({
    needle,
    unique: haystack.indexOf(needle, first + 1) === -1,
  }).toEqual({ needle, unique: true });
  return first;
}

// Every TypeScript file under `directory`, tests and dependencies left out.
function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "Tests" ||
      entry.name === "build" ||
      entry.name === "dist"
    ) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(entryPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

describe("App/Index.ts starts its queue workers once it has started", () => {
  const source: string = code(INDEX_PATH);

  test("it starts them, once", () => {
    indexOfOnly(source, START_CALL);
  });

  test("after it has connected to every datastore its jobs use", () => {
    const start: number = indexOfOnly(source, START_CALL);

    for (const connect of [
      "await PostgresAppInstance.connect();",
      "await Redis.connect();",
      "await ClickhouseAppInstance.connect(",
      "await ClickhouseIngestInstance.connect(",
    ]) {
      expect({ connect, before: indexOfOnly(source, connect) < start }).toEqual(
        { connect, before: true },
      );
    }
  });

  test("after every feature set that builds a queue worker is initialized", () => {
    const start: number = indexOfOnly(source, START_CALL);

    for (const init of [
      "await WorkersRoutes.init();",
      "await TelemetryRoutes.init();",
      "await WorkflowRoutes.init();",
      "await RunbookRoutes.init();",
    ]) {
      expect({ init, before: indexOfOnly(source, init) < start }).toEqual({
        init,
        before: true,
      });
    }
  });

  test("once the startup gate is open, so it serves and works from the same moment", () => {
    expect(indexOfOnly(source, "StartupGate.open();")).toBeLessThan(
      indexOfOnly(source, START_CALL),
    );
  });

  test("and nothing else in the App starts them", () => {
    const callers: Array<string> = sourceFilesUnder(APP_ROOT)
      .filter((filePath: string) => {
        // Cheap first: only a file that names it is read without comments.
        return (
          fs.readFileSync(filePath, "utf8").includes(".startProcessingJobs(") &&
          code(filePath).includes(".startProcessingJobs(")
        );
      })
      .map((filePath: string) => {
        return path.relative(APP_ROOT, filePath);
      });

    expect(callers).toEqual(["Index.ts"]);
  });
});
