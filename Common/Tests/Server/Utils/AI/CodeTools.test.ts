import {
  FindCodeForExceptionTool,
  ListCodeRepositoriesTool,
  ReadCodeFileTool,
  SearchCodeTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import GitHubUtil from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryModel from "../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The code tools are the bridge from a telemetry signal to the source that
 * produced it. These tests mock the repository/exception services and the
 * GitHub Contents API (no network, no clone) to lock in the behaviours that
 * are load-bearing for trust:
 *   (a) a repository that is not readable (GitLab, or a GitHub row whose App
 *       installation is gone) is invisible to the model — it must never look
 *       readable;
 *   (b) ambiguity between several repositories is an error the model can fix,
 *       never a guess at which codebase the question is about;
 *   (c) read_code_file's line window resolves and clamps correctly, and lines
 *       carry their real file line numbers so the model can cite them;
 *   (d) secrets in source are redacted before they egress to the provider;
 *   (e) an exception with no stack trace, or that matches no repository, is
 *       reported honestly instead of guessed at.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const REPO_ID: ObjectID = ObjectID.generate();

function buildRepository(data?: {
  id?: ObjectID;
  name?: string;
  hostedAt?: CodeRepositoryType;
  installationId?: string | undefined;
}): CodeRepositoryModel {
  const repository: CodeRepositoryModel = new CodeRepositoryModel();
  repository._id = (data?.id ?? REPO_ID).toString();
  repository.name = data?.name ?? "checkout";
  repository.organizationName = "acme";
  repository.repositoryName = "checkout";
  repository.mainBranchName = "main";
  repository.repositoryHostedAt = data?.hostedAt ?? CodeRepositoryType.GitHub;

  if (data?.installationId !== undefined) {
    repository.gitHubAppInstallationId = data.installationId;
  } else {
    repository.gitHubAppInstallationId = "12345";
  }

  return repository;
}

function mockRepositories(repositories: Array<CodeRepositoryModel>): void {
  jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockResolvedValue(repositories as never);
}

function mockFileContent(content: string): void {
  const lines: Array<string> = content === "" ? [] : content.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  jest.spyOn(GitHubUtil, "getFileContent").mockResolvedValue({
    content: content,
    filePath: "src/billing/charge.ts",
    sizeInBytes: content.length,
    totalLines: lines.length,
    htmlUrl: "https://github.com/acme/checkout/blob/main/src/billing/charge.ts",
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("list_code_repositories", () => {
  test("hides repositories that cannot actually be read", async () => {
    mockRepositories([
      buildRepository({ name: "readable" }),
      // GitHub row whose App installation was uninstalled.
      buildRepository({
        id: ObjectID.generate(),
        name: "uninstalled",
        installationId: "",
      }),
      // GitLab has no read path yet.
      buildRepository({
        id: ObjectID.generate(),
        name: "gitlab-repo",
        hostedAt: CodeRepositoryType.GitLab,
      }),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm).toContain("readable");
    expect(result.dataForLlm).not.toContain("uninstalled");
    expect(result.dataForLlm).not.toContain("gitlab-repo");
    expect(result.rowCount).toBe(1);
  });

  test("says plainly when no repository is connected", async () => {
    mockRepositories([]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain(
      "no GitHub-connected code repositories",
    );
  });
});

describe("read_code_file — repository targeting", () => {
  test("refuses to guess when several repositories could match", async () => {
    mockRepositories([
      buildRepository({ id: REPO_ID, name: "checkout" }),
      buildRepository({ id: ObjectID.generate(), name: "billing" }),
    ]);

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/index.ts" }, ctx),
    ).rejects.toThrow(/repositoryId is required/);
  });

  test("does not require repositoryId when exactly one repository exists", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent("const a = 1;");

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts" },
      ctx,
    );

    expect(result.dataForLlm).toContain("const a = 1;");
  });

  test("explains when the project has no connected repository at all", async () => {
    mockRepositories([]);

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/index.ts" }, ctx),
    ).rejects.toThrow(/no GitHub-connected code repositories/);
  });

  test("reports a missing file as fixable rather than crashing", async () => {
    mockRepositories([buildRepository()]);
    jest.spyOn(GitHubUtil, "getFileContent").mockResolvedValue(null);

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/nope.ts" }, ctx),
    ).rejects.toThrow(/No readable file at "src\/nope.ts"/);
  });
});

describe("read_code_file — line windows", () => {
  const file: string = Array.from({ length: 500 }, (_v: unknown, i: number) => {
    return `line ${i + 1}`;
  }).join("\n");

  test("numbers lines with their real file line numbers", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(file);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts", startLine: 10, endLine: 12 },
      ctx,
    );

    expect(result.dataForLlm).toContain("10| line 10");
    expect(result.dataForLlm).toContain("12| line 12");
    expect(result.dataForLlm).not.toContain("line 13");
    expect(result.dataForLlm).toContain("showing lines 10-12 of 500");
    expect(result.rowCount).toBe(3);
  });

  test("aroundLine centres a window on a stack-trace line", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(file);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts", aroundLine: 200 },
      ctx,
    );

    // 60 lines either side of 200.
    expect(result.dataForLlm).toContain("showing lines 140-260 of 500");
    expect(result.dataForLlm).toContain("200| line 200");
  });

  test("aroundLine near the top of a file does not run off the start", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(file);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts", aroundLine: 3 },
      ctx,
    );

    expect(result.dataForLlm).toContain("showing lines 1-63 of 500");
    expect(result.dataForLlm).toContain("1| line 1");
  });

  test("caps an oversized window and tells the model how to read on", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(file);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts", startLine: 1, endLine: 500 },
      ctx,
    );

    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("showing lines 1-400 of 500");
    // The hint must resume exactly where the read stopped — no skipped lines.
    expect(result.dataForLlm).toContain("startLine=401");
  });

  test("redacts secrets found in source before they reach the provider", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(
      'const stripeKey = "sk_live_x";\nconst password = "hunter2000";',
    );

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/config.ts" },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("hunter2000");
    expect(result.dataForLlm).toContain("[redacted]");
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  test("an explicit endLine survives being combined with aroundLine", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent(file);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts", aroundLine: 200, endLine: 210 },
      ctx,
    );

    expect(result.dataForLlm).toContain("showing lines 140-210 of 500");
  });

  test("a trailing newline does not invent a phantom last line", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent("alpha\nbravo\n");

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/two.ts" },
      ctx,
    );

    expect(result.dataForLlm).toContain("showing lines 1-2 of 2");
    expect(result.rowCount).toBe(2);
  });

  test("an empty file reads as empty, not as an error", async () => {
    mockRepositories([buildRepository()]);
    mockFileContent("");

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/empty.ts" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("this file is empty");
  });

  /*
   * The bug this locks: the serializer hard-slices at its own 16KB payload cap.
   * If the window is trimmed only by line count, the header advertises a range
   * the payload does not contain, and the "read on" hint then skips exactly the
   * lines the slice ate.
   */
  test("reports the range it actually returned when lines are long", async () => {
    mockRepositories([buildRepository()]);
    // 400 lines x ~200 bytes = ~80KB, far over the byte budget.
    const fat: string = Array.from({ length: 400 }, (_v: unknown, i: number) => {
      return `${i + 1}:${"x".repeat(200)}`;
    }).join("\n");
    mockFileContent(fat);

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/fat.ts", startLine: 1, endLine: 400 },
      ctx,
    );

    expect(result.isTruncated).toBe(true);

    // The advertised range must match what is really in the payload.
    const header: RegExpMatchArray | null = result.dataForLlm.match(
      /showing lines 1-(\d+) of 400/,
    );
    expect(header).not.toBeNull();
    const advertisedEnd: number = Number(header![1]);
    expect(advertisedEnd).toBeLessThan(400);
    expect(result.rowCount).toBe(advertisedEnd);
    expect(result.dataForLlm).toContain(`${advertisedEnd}| `);
    expect(result.dataForLlm).not.toContain(`${advertisedEnd + 1}| `);

    // The pagination hint must resume exactly where it stopped — no skipped lines.
    expect(result.dataForLlm).toContain(`startLine=${advertisedEnd + 1}`);
  });
});

describe("search_code", () => {
  test("returns shortest paths first so the likely file is not cut off", async () => {
    mockRepositories([buildRepository()]);
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue([
        "src/billing/__tests__/charge.fixture.ts",
        "src/billing/charge.ts",
        "docs/unrelated.md",
      ]);

    const result: ToolExecutionResult = await SearchCodeTool.execute(
      { query: "charge" },
      ctx,
    );

    const firstIndex: number = result.dataForLlm.indexOf(
      "src/billing/charge.ts",
    );
    const fixtureIndex: number = result.dataForLlm.indexOf("charge.fixture.ts");

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(fixtureIndex);
    expect(result.dataForLlm).not.toContain("docs/unrelated.md");
  });

  test("reports no matches honestly", async () => {
    mockRepositories([buildRepository()]);
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts"]);

    const result: ToolExecutionResult = await SearchCodeTool.execute(
      { query: "nonexistent" },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("no file paths");
  });
});

describe("find_code_for_exception", () => {
  function mockException(
    stackTrace: string | undefined,
    message?: string,
  ): void {
    const exception: TelemetryException = new TelemetryException();
    exception._id = ObjectID.generate().toString();
    exception.message = message ?? "Cannot read property 'id' of undefined";
    exception.exceptionType = "TypeError";
    exception.occuranceCount = 42;

    if (stackTrace !== undefined) {
      exception.stackTrace = stackTrace;
    }

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(exception as never);
  }

  function mockResolution(): void {
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: REPO_ID.toString(),
        organizationName: "acme",
        repositoryName: "checkout",
        servicePathInRepository: null,
        method: "stack-trace",
        evidence: "Matched src/billing/charge.ts in acme/checkout",
      });
  }

  test("maps a stack trace to a repository and its implicated frames", async () => {
    mockException(
      [
        "TypeError: Cannot read property 'id' of undefined",
        "    at chargeCustomer (/app/src/billing/charge.ts:42:15)",
        "    at processPayment (/app/node_modules/express/lib/router.js:10:5)",
      ].join("\n"),
    );

    mockRepositories([buildRepository()]);
    mockResolution();
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts", "src/index.ts"]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("acme/checkout");
    expect(result.dataForLlm).toContain(REPO_ID.toString());
    expect(result.dataForLlm).toContain("stack-trace");
    expect(result.dataForLlm).toContain("line=42");
    // Library frames are dropped when application frames exist.
    expect(result.dataForLlm).not.toContain("router.js");
  });

  /*
   * The bug this locks: StackTraceParser reports the RUNTIME path
   * (/app/src/billing/charge.ts), but the Contents API needs the REPOSITORY
   * path (src/billing/charge.ts). Emitting the runtime path made every
   * read_code_file follow-up 404 — the feature's whole point.
   */
  test("rewrites runtime stack-trace paths to real repository paths", async () => {
    mockException("    at chargeCustomer (/app/src/billing/charge.ts:42:15)");
    mockRepositories([buildRepository()]);
    mockResolution();
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts"]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("file=src/billing/charge.ts");
    expect(result.dataForLlm).not.toContain("/app/src/billing/charge.ts");
    expect(result.dataForLlm).toContain("openableWithReadCodeFile=true");
  });

  test("marks a frame unopenable rather than guessing when it is not in the tree", async () => {
    mockException("    at helper (/app/src/mystery/ghost.ts:7:1)");
    mockRepositories([buildRepository()]);
    mockResolution();
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts"]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("openableWithReadCodeFile=true");
    expect(result.dataForLlm).toContain(
      "None of these frames could be matched",
    );
  });

  test("refuses to pick between two equally-plausible tree matches", async () => {
    mockException("    at handler (/app/charge.ts:9:1)");
    mockRepositories([buildRepository()]);
    mockResolution();
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts", "src/legacy/charge.ts"]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("openableWithReadCodeFile=true");
  });

  /*
   * exception.message is populated verbatim from the monitored app's thrown
   * error — the most attacker-influenceable string in the tool belt. It must
   * get the same redaction top_exceptions applies to the identical field.
   */
  test("redacts secrets in the exception message before they egress", async () => {
    mockException(
      "    at auth (/app/src/auth.ts:1:1)",
      "auth failed for admin@acme.com password=hunter2xyz key AKIAIOSFODNN7EXAMPLE",
    );
    mockRepositories([buildRepository()]);
    mockResolution();
    jest.spyOn(GitHubUtil, "getRepositoryTreePaths").mockResolvedValue([]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("admin@acme.com");
    expect(result.dataForLlm).not.toContain("hunter2xyz");
    expect(result.dataForLlm).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  test("redacts the exception message on the no-stack-trace path too", async () => {
    mockException(undefined, "boom for admin@acme.com");

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain("admin@acme.com");
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  /*
   * resolveRepositoryForException queries as isRoot (it serves the autonomous
   * agent). A label-restricted user must not learn a repository's identity
   * through it.
   */
  test("does not disclose a repository the user cannot read", async () => {
    mockException("    at chargeCustomer (/app/src/billing/charge.ts:42:15)");
    mockResolution();
    // The user's own readable set is empty — the label ACL excludes this repo.
    mockRepositories([]);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("resolvedRepository: none");
    expect(result.dataForLlm).not.toContain("acme/checkout");
    expect(result.dataForLlm).not.toContain(REPO_ID.toString());
  });

  test("says the code could not be located rather than guessing a repository", async () => {
    mockException("    at chargeCustomer (/app/src/billing/charge.ts:42:15)");

    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(null);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain("resolvedRepository: none");
    expect(result.dataForLlm).toContain("rather than guessing");
  });

  test("an exception with no stack trace is reported honestly", async () => {
    mockException(undefined);

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("no stack trace recorded");
  });

  test("a missing exception is an error the model can act on", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(null as never);

    await expect(
      FindCodeForExceptionTool.execute(
        { exceptionId: ObjectID.generate().toString() },
        ctx,
      ),
    ).rejects.toThrow(/No exception found/);
  });
});
