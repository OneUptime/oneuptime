import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RUNNER OF ANY AGE STOPS WHERE THE RUNBOOK SAYS.
 *
 * Customers update their Runners on their own schedule, so a step's
 * approval - before it runs now, after it in runs started before - is the
 * server's decision alone: the execution loop (RunRunbook) stops before a
 * step that asks for approval, and only once someone approves it does the
 * loop hand the step's job to a Runner at all. A Runner never reads a step's
 * approval flags, and no job carries them, so a Runner written before
 * approvals moved behaves exactly as one written after. Held here by the
 * source: the moment the loop asks is before the moment it dispatches.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../..");

const RUNNER_SOURCE: string = path.join(REPOSITORY, "packages/Runner");

const RUN_RUNBOOK: string = path.resolve(
  __dirname,
  "../../FeatureSet/Runbook/Services/RunRunbook.ts",
);

// Where a step becomes a Runner's job, and where a Runner takes it.
const JOB_SOURCES: Array<string> = [
  path.resolve(__dirname, "../../FeatureSet/Runbook/Services/StepExecutors.ts"),
  path.resolve(__dirname, "../../FeatureSet/Runbook/API/RunnerIngress.ts"),
];

const APPROVAL_FLAGS: Array<string> = [
  "requireApproval",
  "requireApprovalBeforeRunning",
  "approvedAt",
];

function sourceFilesUnder(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return ["node_modules", "build", "dist", "Tests"].includes(entry.name)
          ? []
          : sourceFilesUnder(full);
      }

      return entry.name.endsWith(".ts") ? [full] : [];
    });
}

describe("a step's approval is decided on the server, never on a Runner", () => {
  test("no Runner source reads a step's approval flags", () => {
    const files: Array<string> = sourceFilesUnder(RUNNER_SOURCE);

    // The walk reached the Runner's code.
    expect(files.length).toBeGreaterThan(20);

    const readers: Array<string> = files.filter((file: string): boolean => {
      const source: string = fs.readFileSync(file, "utf8");

      return APPROVAL_FLAGS.some((flag: string): boolean => {
        return source.includes(flag);
      });
    });

    expect(readers).toEqual([]);
  });

  test("no job handed to a Runner carries a step's approval flags", () => {
    for (const file of JOB_SOURCES) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const flag of APPROVAL_FLAGS) {
        expect({
          file: path.basename(file),
          flag,
          named: source.includes(flag),
        }).toEqual({ file: path.basename(file), flag, named: false });
      }
    }
  });

  test("the execution loop asks for the approval before it starts the step, and dispatches only after", () => {
    const source: string = fs.readFileSync(RUN_RUNBOOK, "utf8");

    const asks: number = source.indexOf(
      "if (isApprovalNeededBeforeRunning(stepExec)) {",
    );
    const starts: number = source.indexOf(
      "stepExec.status = RunbookStepExecutionStatus.Running;",
    );
    const dispatches: number = source.indexOf(
      "result = await this.runAutomatedStep(stepExec.step, {",
    );

    expect(asks).toBeGreaterThan(0);
    expect(starts).toBeGreaterThan(asks);
    expect(dispatches).toBeGreaterThan(starts);

    // While it waits, the loop returns: nothing after the check runs.
    const waiting: string = source.slice(asks, starts);
    expect(waiting).toContain(
      "stepExec.status = RunbookStepExecutionStatus.WaitingForUser;",
    );
    expect(waiting).toContain("RunbookExecutionStatus.WaitingForManualStep");
    expect(waiting).toContain("return;");
  });
});
