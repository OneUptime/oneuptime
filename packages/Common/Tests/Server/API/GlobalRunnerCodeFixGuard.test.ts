import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY CODE-FIX ROUTE HOLDS A GLOBAL RUNNER TO ITS RUN, HELD.
 *
 * Global Runners take OneUptime AI's code fixes, so a global Runner's key -
 * on a host that also runs every project's JavaScript steps, or on one a
 * master admin started - authenticates on the code-fix protocol, and a
 * global identity passes every project check. What keeps its key to the
 * work it was handed is one rule every route asks
 * (CodeFixAgentAuth.deniesAccessToRun), and two the server applies to what it
 * hands a global Runner (getRepositoryCommands, getOfferedTools). A new
 * route, or a new read of a run in an old one, that checks the project
 * alone would hand a global Runner every project's work again. This reads
 * the sources and fails on one:
 *
 *   - every code-fix route file (the ones that authenticate a worker with
 *     CodeFixAgentAuth.authenticate) checks the runs it reads with
 *     deniesAccessToRun, never with the project check alone - but for the
 *     telemetry routes, whose scope holds every worker to the run it
 *     claimed itself (CodeAgentTelemetryScope);
 *   - the project check is only ever asked of an exception or a repository,
 *     and the exception routes then hold a global Runner to its run's
 *     exception;
 *   - no route writes a repository's setup, build or test command into what
 *     it answers but through getRepositoryCommands;
 *   - the completion route offers the model getOfferedTools' tools;
 *   - the token a Runner is handed for a GitHub repository is minted for
 *     that one repository (getRepositoryAccessToken), never for the whole
 *     installation.
 */

const COMMON: string = path.resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON, relativePath), "utf8");
}

// The source with its comments taken out and its whitespace made single spaces.
function codeOf(relativePath: string): string {
  const source: string = read(relativePath);
  let code: string = "";
  let index: number = 0;

  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const end: number = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    if (source.startsWith("//", index)) {
      const end: number = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }

    code += source[index];
    index++;
  }

  /*
   * Whitespace made single spaces, and none just inside a call's
   * parentheses or before a trailing comma's closing one, so a call reads
   * the same however prettier wraps it: f( a, b, ) is f(a, b).
   */
  return code
    .split(/\s+/)
    .join(" ")
    .split("( ")
    .join("(")
    .split(", )")
    .join(")")
    .split(" )")
    .join(")");
}

const API_DIRECTORY: string = "Server/API";

// A code-fix route file: one that authenticates a worker's id and key.
const AUTHENTICATES_A_WORKER: string = "CodeFixAgentAuth.authenticate(";

/*
 * Route files that read runs and leave the hold to a helper that holds every
 * worker to the run it claimed, with the reason.
 */
const HOLDS_THROUGH_A_HELPER: Record<string, string> = {
  "Server/API/AIAgentTelemetryAPI.ts":
    "CodeAgentTelemetryScope.readRun serves only a Running run claimed by the worker, for every worker",
};

function codeFixRouteFiles(): Array<string> {
  return fs
    .readdirSync(path.join(COMMON, API_DIRECTORY))
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .map((name: string): string => {
      return `${API_DIRECTORY}/${name}`;
    })
    .filter((file: string): boolean => {
      return codeOf(file).includes(AUTHENTICATES_A_WORKER);
    })
    .sort();
}

// Every `CodeFixAgentAuth.deniesAccessToProject(identity, X)` in the code, as X.
function projectChecksOf(code: string): Array<string> {
  const checks: Array<string> = [];
  const opening: string = "CodeFixAgentAuth.deniesAccessToProject(";
  let at: number = code.indexOf(opening);

  while (at !== -1) {
    const argumentsStart: number = at + opening.length;
    const close: number = code.indexOf(")", argumentsStart);
    const argumentList: string = code.substring(argumentsStart, close);
    const comma: number = argumentList.indexOf(",");

    checks.push(
      argumentList
        .substring(comma + 1)
        .trim()
        .replace(/,$/, "")
        .trim(),
    );

    at = code.indexOf(opening, close);
  }

  return checks;
}

describe("the code-fix route files", () => {
  test("are the ones this guard knows: a new one is read by every rule below", () => {
    expect(codeFixRouteFiles()).toEqual([
      "Server/API/AIAgentCodeTaskAPI.ts",
      "Server/API/AIAgentDataAPI.ts",
      "Server/API/AIAgentGitHubAPI.ts",
      "Server/API/AIAgentTaskAPI.ts",
      "Server/API/AIAgentTaskLogAPI.ts",
      "Server/API/AIAgentTelemetryAPI.ts",
    ]);
  });

  test("every one that reads a run holds a global Runner to it with deniesAccessToRun", () => {
    for (const file of codeFixRouteFiles()) {
      const code: string = codeOf(file);
      const readsARun: boolean = code.includes("AIRunService.findOneById(");

      if (HOLDS_THROUGH_A_HELPER[file]) {
        expect(code).not.toContain("AIRunService.findOneById(");
        continue;
      }

      if (readsARun) {
        expect({ file, holds: code.includes("deniesAccessToRun(") }).toEqual({
          file,
          holds: true,
        });
      }
    }
  });

  test("every run they read for the rule is read with who claimed it and its state", () => {
    for (const file of codeFixRouteFiles()) {
      const code: string = codeOf(file);

      if (code.includes("deniesAccessToRun(")) {
        expect({
          file,
          readsTheHold: code.includes("CODE_FIX_RUN_HOLD_SELECT"),
        }).toEqual({ file, readsTheHold: true });
      }
    }
  });

  test("the project check alone is asked only of an exception or a repository, never of a run", () => {
    const allowed: Set<string> = new Set<string>([
      "exception.projectId",
      "codeRepository.projectId",
    ]);

    for (const file of codeFixRouteFiles()) {
      for (const subject of projectChecksOf(codeOf(file))) {
        expect({ file, subject, allowed: allowed.has(subject) }).toEqual({
          file,
          subject,
          allowed: true,
        });
      }
    }
  });

  test("the exception routes hold a global Runner to its run's exception", () => {
    const code: string = codeOf("Server/API/AIAgentDataAPI.ts");

    // Once for get-exception-details, once for get-code-repositories.
    expect(
      code.split("AIAgentDataAPI.deniesGlobalRunnerAccessToException(").length -
        1,
    ).toBe(2);
    expect(code).toContain(
      "run.triggeredByTelemetryExceptionId.toString() !== data.exceptionId.toString()",
    );
  });

  test("the token route hands a global Runner a token only for the run it holds", () => {
    const code: string = codeOf("Server/API/AIAgentDataAPI.ts");

    expect(code).toContain(
      "if (CodeFixAgentAuth.isGlobalIdentity(aiAgent) && !tokenRun) {",
    );
  });

  test("no route writes a repository's command into its answer but through getRepositoryCommands", () => {
    const directCommand: RegExp =
      /\b(setupCommand|buildCommand|testCommand)\s*:\s*[A-Za-z_][\w.!?]*\.(setupCommand|buildCommand|testCommand)\b/;

    for (const file of codeFixRouteFiles()) {
      expect({ file, found: directCommand.exec(codeOf(file))?.[0] }).toEqual({
        file,
        found: undefined,
      });
    }
  });

  test("the routes that hand a repository to a worker hand its commands through getRepositoryCommands", () => {
    expect(
      codeOf("Server/API/AIAgentDataAPI.ts").split(
        "CodeFixAgentAuth.getRepositoryCommands(aiAgent, repository)",
      ).length - 1,
    ).toBe(4);
    expect(codeOf("Server/API/AIAgentGitHubAPI.ts")).toContain(
      "CodeFixAgentAuth.getRepositoryCommands(aiAgent, codeRepository)",
    );
    // The code task brief is built with them, then answered without them.
    expect(codeOf("Server/API/AIAgentCodeTaskAPI.ts")).toContain(
      "...CodeFixAgentAuth.getRepositoryCommands(aiAgent, brief.repository)",
    );
  });

  test("the completion route offers the model getOfferedTools' tools", () => {
    expect(codeOf("Server/API/AIAgentDataAPI.ts")).toContain(
      'CodeFixAgentAuth.getOfferedTools(aiAgent, this.parseCompletionTools(data["tools"]))',
    );
  });

  test("a Runner's GitHub token is minted for one repository, never for the whole installation", () => {
    const code: string = codeOf("Server/API/AIAgentDataAPI.ts");

    expect(code).toContain("GitHubUtil.getRepositoryAccessToken(");
    expect(code).not.toContain("getInstallationAccessToken(");
  });
});

describe("the helpers that hold every worker to its run themselves", () => {
  test("the telemetry scope serves only a Running run the worker claimed", () => {
    const code: string = codeOf(
      "Server/Utils/AI/CodeFix/CodeAgentTelemetryScope.ts",
    );

    expect(code).toContain("if (run.status !== AIRunStatus.Running) {");
    expect(code).toContain(
      "run.aiAgentId.toString() !== data.aiAgent.id.toString()",
    );
  });

  test("a completion is served only for a Running run the worker claimed", () => {
    const code: string = codeOf(
      "Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
    );

    expect(code).toContain("if (run.status !== AIRunStatus.Running) {");
    expect(code).toContain(
      "run.aiAgentId.toString() !== request.aiAgentId.toString()",
    );
  });
});
