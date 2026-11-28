import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/*
 * WHO RUNS THE READ CHECK OUTSIDE DATABASESERVICE, AND WITH WHAT SELECT
 * (#11438).
 *
 * A column a reader reads on some labels only narrows a read that selects
 * it to the records it is read on - unless the read leaves the column out
 * of the others instead (RecordScopeOptions.columnsWithheldPerRecord, which
 * only DatabaseService's reads pass: they withhold it per row). A caller
 * that runs the read check (ModelPermission.checkReadQueryPermission) and
 * then its own query or aggregate withholds nothing, so it must keep the
 * narrowing - and it narrows by a selected column only when it hands one
 * in. Every such caller today hands in no select, or asks only whether the
 * read is allowed and reads nothing:
 *
 *   - a select of null: the query's own filters narrow, as they must, and no
 *     selected column can (DataObservabilityReadScope, NetworkSummaryCache,
 *     TelemetryExceptionService);
 *   - a yes or no: WorkflowProbeTools asks whether an AI workflow's step may
 *     read a model, and reads nothing with the answer.
 *
 * A new caller with a select fails this guard: switching it to per-record
 * withholding would hand it the values of the records the column's grant
 * does not reach, so it must withhold them itself before it may.
 */

const COMMON: string = path.join(__dirname, "../../../../..");
const REPOSITORY: string = path.join(COMMON, "../..");

const ROOTS: ReadonlyArray<string> = [
  path.join(COMMON, "Server"),
  path.join(REPOSITORY, "packages/App/FeatureSet"),
].filter((root: string): boolean => {
  return fs.existsSync(root);
});

// The callers that hand in a select, and why that withholds nothing they read.
const CALLERS_WITH_A_SELECT: Record<string, string> = {
  "Utils/AI/Toolbox/WorkflowProbeTools.ts":
    "asks whether the step may read the model, and reads nothing with the answer",
};

const CALL: string = "ModelPermission.checkReadQueryPermission(";

const listFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
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

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }

  return files;
};

// The call's arguments, split at the commas of its own parentheses.
const getArguments: (source: string, start: number) => Array<string> = (
  source: string,
  start: number,
): Array<string> => {
  const args: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "(" || character === "{" || character === "[") {
      depth++;
    } else if (character === ")" || character === "}" || character === "]") {
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }

      depth--;
    } else if (character === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  return args;
};

describe("the callers of the read check outside DatabaseService", () => {
  const calls: Array<{ file: string; select: string }> = [];

  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      if (file.endsWith(path.join("Services", "DatabaseService.ts"))) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");
      let at: number = source.indexOf(CALL);

      while (at >= 0) {
        const args: Array<string> = getArguments(source, at + CALL.length);

        calls.push({
          file: path
            .relative(path.join(COMMON, "Server"), file)
            .split(path.sep)
            .join("/"),
          select: args[2] || "",
        });

        at = source.indexOf(CALL, at + CALL.length);
      }
    }
  }

  test("there are callers to look at", () => {
    expect(calls.length).toBeGreaterThan(2);
  });

  test("each hands in no select, or is listed with why its select withholds nothing it reads", () => {
    const unexpected: Array<string> = calls
      .filter((call: { file: string; select: string }): boolean => {
        return call.select !== "null" && !CALLERS_WITH_A_SELECT[call.file];
      })
      .map((call: { file: string; select: string }): string => {
        return `${call.file}: select ${call.select}`;
      });

    expect(unexpected).toEqual([]);
  });

  test("every caller listed still calls it", () => {
    for (const file of Object.keys(CALLERS_WITH_A_SELECT)) {
      expect([
        file,
        calls.some((call: { file: string }): boolean => {
          return call.file === file;
        }),
      ]).toEqual([file, true]);
    }
  });
});
