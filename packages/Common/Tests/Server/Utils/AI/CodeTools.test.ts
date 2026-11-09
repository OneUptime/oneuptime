import {
  FindCodeForExceptionTool,
  ListCodeRepositoriesTool,
  ReadCodeFileTool,
  SearchCodeTool,
  describePlainGitRepositories,
} from "../../../../Server/Utils/AI/Toolbox/CodeTools";
import CodeHostAccess from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import GitHubUtil from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryModel from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../Models/DatabaseModels/CodeRepositoryConnection";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeURL from "../../../../Types/API/URL";
import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import {
  CONNECTED_REPOSITORY_ID,
  CONNECTED_TOKEN,
  ConnectedRepository,
  connectRepository,
  disconnectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";
import { FakeAnswer, FakeRoute } from "../CodeRepository/CodeHost/FakeCodeHost";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

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

/*
 * findReadableRepositories now also proves each row's GitHub App installation
 * belongs to the row's project (GHSA-xx95-gmcf-7q86), which is a database
 * read. That guard has its own tests; here it would just be a Postgres
 * connection these tool tests do not need, so treat every fixture row as
 * bound.
 */
beforeEach(() => {
  jest
    .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
    .mockResolvedValue("12345");
});

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

  /*
   * GHSA-xx95-gmcf-7q86. A row can be in this project and still name a GitHub
   * App installation the project does not own — that combination used to be
   * creatable, and these tools would then read, commit and open pull requests
   * in another tenant's private repositories. Being in the project is not the
   * same as owning the installation, so an unbound row must be invisible here
   * exactly like an uninstalled one.
   */
  test("hides a repository whose installation is not bound to the project", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("12345");

    mockRepositories([
      buildRepository({ name: "our-repo", installationId: "12345" }),
      buildRepository({
        id: ObjectID.generate(),
        name: "someone-elses-repo",
        installationId: "99999999",
      }),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm).toContain("our-repo");
    expect(result.dataForLlm).not.toContain("someone-elses-repo");
    expect(result.rowCount).toBe(1);
  });

  test("says plainly when no repository is connected", async () => {
    mockRepositories([]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe(
      "(no code repository in this project whose source OneUptime can read — GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read)",
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

  test("explains when the project has no connected repository at all - and which hosts' code is read", async () => {
    mockRepositories([]);

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/index.ts" }, ctx),
    ).rejects.toThrow(
      "This project has no connected code repository whose source OneUptime can read. Connect one in Code: GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read (another Git server's files are not).",
    );
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
    const fat: string = Array.from(
      { length: 400 },
      (_v: unknown, i: number) => {
        return `${i + 1}:${"x".repeat(200)}`;
      },
    ).join("\n");
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

/*
 * An investigation (or a fix) reads only the code repositories the rules
 * that matched its incident name (ToolContext.codeRepositoryAllowance): "if
 * no code repo is selected - it should be able to read and investigate all
 * the repos that are connected" - the maintainer. Every code tool finds its
 * repositories through findReadableRepositories, so each one is held to it;
 * a person's own question (no allowance) reads every repository they may.
 */
describe("a run held to the code repositories its rules name", () => {
  const CHECKOUT_ID: ObjectID = new ObjectID(
    "c1111111-1111-4111-8111-111111111111",
  );
  const BILLING_ID: ObjectID = new ObjectID(
    "c2222222-2222-4222-8222-222222222222",
  );

  function heldTo(allowance: CodeRepositoryAllowance): ToolContext {
    return { ...ctx, codeRepositoryAllowance: allowance };
  }

  function onlyCheckout(): CodeRepositoryAllowance {
    return {
      isEveryRepository: false,
      repositoryIds: [CHECKOUT_ID.toString()],
    };
  }

  function named(id: ObjectID, name: string): CodeRepositoryModel {
    const repository: CodeRepositoryModel = buildRepository({ id, name });
    repository.repositoryName = name;
    return repository;
  }

  function twoRepositories(): Array<CodeRepositoryModel> {
    return [named(CHECKOUT_ID, "checkout"), named(BILLING_ID, "billing")];
  }

  /*
   * The project's repositories as the database reads them: a read for one
   * repository (findReadableRepositories names its id) finds that one alone.
   */
  function mockStoredRepositories(
    repositories: Array<CodeRepositoryModel>,
  ): void {
    jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockImplementation((async (args: {
        query: { _id?: unknown };
      }): Promise<Array<CodeRepositoryModel>> => {
        const id: string | undefined =
          typeof args.query._id === "string" ? args.query._id : undefined;

        return repositories.filter(
          (repository: CodeRepositoryModel): boolean => {
            return !id || repository.id?.toString() === id;
          },
        );
      }) as never);
  }

  test("list_code_repositories lists only the ones the rules name", async () => {
    mockRepositories(twoRepositories());

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      heldTo(onlyCheckout()),
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(CHECKOUT_ID.toString());
    expect(result.dataForLlm).not.toContain(BILLING_ID.toString());
    expect(result.dataForLlm).not.toContain("billing");
  });

  test("a rule's ids match whatever their case", async () => {
    mockRepositories(twoRepositories());

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      heldTo({
        isEveryRepository: false,
        repositoryIds: [BILLING_ID.toString().toLowerCase()],
      }),
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(BILLING_ID.toString());
  });

  test("every repository, and no allowance at all, lists them all", async () => {
    for (const context of [heldTo(EVERY_CODE_REPOSITORY), ctx]) {
      mockRepositories(twoRepositories());

      const result: ToolExecutionResult =
        await ListCodeRepositoriesTool.execute({}, context);

      expect(result.rowCount).toBe(2);
      jest.restoreAllMocks();
      jest
        .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
        .mockResolvedValue("12345");
    }
  });

  test("none allowed reads as no repository, never as all of them", async () => {
    mockRepositories(twoRepositories());

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      heldTo(NO_CODE_REPOSITORY),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe(
      "(no code repository in this project whose source OneUptime can read — GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read)",
    );
  });

  test("read_code_file reads the one repository allowed without asking which, and refuses another by id", async () => {
    mockStoredRepositories(twoRepositories());
    mockFileContent("export const charge = 1;");

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts" },
      heldTo(onlyCheckout()),
    );

    expect(result.dataForLlm).toContain("export const charge = 1;");

    await expect(
      ReadCodeFileTool.execute(
        {
          filePath: "src/billing/charge.ts",
          repositoryId: BILLING_ID.toString(),
        },
        heldTo(onlyCheckout()),
      ),
    ).rejects.toThrow(
      `No readable repository with id ${BILLING_ID.toString()} in this project.`,
    );
  });

  test("search_code searches only the repositories allowed", async () => {
    mockRepositories(twoRepositories());
    const tree: jest.SpyInstance<
      ReturnType<typeof GitHubUtil.getRepositoryTreePaths>,
      Parameters<typeof GitHubUtil.getRepositoryTreePaths>
    > = jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/billing/charge.ts"]);

    await SearchCodeTool.execute(
      { query: "charge" },
      heldTo({
        isEveryRepository: false,
        repositoryIds: [BILLING_ID.toString()],
      }),
    );

    expect(
      tree.mock.calls.map(
        (
          call: Parameters<typeof GitHubUtil.getRepositoryTreePaths>,
        ): string => {
          return call[0].repositoryName;
        },
      ),
    ).toEqual(["billing"]);
  });

  test("find_code_for_exception resolves among the allowed repositories only, and never names another", async () => {
    const exception: TelemetryException = new TelemetryException();
    exception._id = ObjectID.generate().toString();
    exception.message = "Cannot read property 'id' of undefined";
    exception.exceptionType = "TypeError";
    exception.occuranceCount = 3;
    exception.stackTrace =
      "    at chargeCustomer (/app/src/billing/charge.ts:42:15)";
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(exception as never);
    mockStoredRepositories(twoRepositories());

    const resolve: jest.SpyInstance<
      ReturnType<typeof CodeRepositoryService.resolveRepositoryForException>,
      Parameters<typeof CodeRepositoryService.resolveRepositoryForException>
    > = jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: BILLING_ID.toString(),
        organizationName: "acme",
        repositoryName: "billing",
        servicePathInRepository: null,
        method: "stack-trace",
        evidence: "Matched src/billing/charge.ts in acme/billing",
      });

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: ObjectID.generate().toString() },
      heldTo(onlyCheckout()),
    );

    // The resolver is told which repositories it may pick from.
    expect(resolve.mock.calls[0]![0].allowance).toEqual(onlyCheckout());
    // A repository outside them is never disclosed, whatever resolved.
    expect(result.dataForLlm).toContain("resolvedRepository: none");
    expect(result.dataForLlm).not.toContain(BILLING_ID.toString());
  });
});

/*
 * A plain Git repository - Azure DevOps Server, Bitbucket, any Git server
 * connected with a username and a password or token - is connected for
 * Code's tasks, which a Runner clones; a Git server has no API for its files,
 * so OneUptime reads only its branches (issue #6144). The code tools used to
 * leave it out as though nothing were connected - list_code_repositories said
 * there were "no GitHub-connected code repositories", and a repositoryId of
 * one was "No readable repository" - so the model could not tell the person
 * why. It is now named as a repository whose code cannot be opened, with
 * what still works in it - and never as readable.
 */
// The repositories as the database reads them, by id when one is named.
function mockStoredRepositories(
  repositories: Array<CodeRepositoryModel>,
): void {
  jest.spyOn(CodeRepositoryService, "findBy").mockImplementation((async (args: {
    query: { _id?: unknown };
  }): Promise<Array<CodeRepositoryModel>> => {
    const id: string | undefined =
      typeof args.query._id === "string" ? args.query._id : undefined;

    return repositories.filter((repository: CodeRepositoryModel): boolean => {
      return !id || repository.id?.toString() === id;
    });
  }) as never);
}

/*
 * A Git repository on a Git server that is not Azure DevOps: connected for
 * Code's tasks, but its files have no API to be read through.
 */
const PLAIN_GIT_ID: ObjectID = new ObjectID(
  "a3333333-3333-4333-8333-333333333333",
);
const BITBUCKET_ID: ObjectID = new ObjectID(
  "a4444444-4444-4444-8444-444444444444",
);

function plainGitRepository(
  id: ObjectID = PLAIN_GIT_ID,
  name: string = "instant-access-reporter",
): CodeRepositoryModel {
  const repository: CodeRepositoryModel = buildRepository({
    id,
    name,
    hostedAt: CodeRepositoryType.Git,
    installationId: "",
  });
  repository.organizationName = id === PLAIN_GIT_ID ? "scripts" : "team";
  repository.repositoryName =
    id === PLAIN_GIT_ID ? "InstantAccessReporter" : name;
  repository.repositoryUrl = OneUptimeURL.fromString(
    id === PLAIN_GIT_ID
      ? "https://git.example.com/scripts/InstantAccessReporter.git"
      : `https://bitbucket.org/team/${name}.git`,
  );
  return repository;
}

const PLAIN_GIT_SENTENCE: string =
  "instant-access-reporter (scripts/InstantAccessReporter) is a plain Git repository: OneUptime reads its branches, not its files, so search_code and read_code_file cannot open it. A task in Code still works in it - a Runner clones it - and AI pushes its change on a branch.";

describe("a plain Git repository", () => {
  test("list_code_repositories names it as one whose code cannot be opened, after the readable ones", async () => {
    const summaries: jest.SpyInstance = jest.spyOn(
      CodeHostAccess,
      "getConnectionSummaries",
    );

    mockRepositories([
      buildRepository({ name: "checkout" }),
      plainGitRepository(),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    // Only the readable repository is a row the model can pass on.
    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(REPO_ID.toString());
    expect(result.dataForLlm).not.toContain(PLAIN_GIT_ID.toString());
    expect(result.dataForLlm).toContain(`\n\n${PLAIN_GIT_SENTENCE}`);
    expect(
      result.dataForLlm.indexOf("checkout") <
        result.dataForLlm.indexOf("instant-access-reporter"),
    ).toBe(true);

    // A plain Git repository's connection is not even asked about.
    expect(summaries).not.toHaveBeenCalled();
  });

  test("with only plain Git repositories, the list says none is read, and why", async () => {
    mockRepositories([plainGitRepository()]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe(
      `(no code repository in this project whose source OneUptime can read — GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read)\n\n${PLAIN_GIT_SENTENCE}`,
    );
    expect(result.dataForLlm).not.toContain("GitHub-connected");
  });

  test("several are named together", async () => {
    mockRepositories([
      plainGitRepository(),
      plainGitRepository(BITBUCKET_ID, "billing"),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "instant-access-reporter (scripts/InstantAccessReporter), billing (team/billing) are plain Git repositories: OneUptime reads their branches, not their files, so search_code and read_code_file cannot open them. A task in Code still works in them - a Runner clones them - and AI pushes its change on a branch.",
    );
  });

  test("search_code with no readable repository says why the plain Git one cannot be searched", async () => {
    mockStoredRepositories([plainGitRepository()]);
    const tree: jest.SpyInstance = jest.spyOn(
      GitHubUtil,
      "getRepositoryTreePaths",
    );

    await expect(
      SearchCodeTool.execute({ query: "reporter" }, ctx),
    ).rejects.toThrow(
      `This project has no connected code repository whose source OneUptime can read: GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read. ${PLAIN_GIT_SENTENCE}`,
    );
    expect(tree).not.toHaveBeenCalled();
  });

  test("read_code_file on one, by its id, says why - not that there is no such repository", async () => {
    mockStoredRepositories([
      buildRepository({ name: "checkout" }),
      plainGitRepository(),
    ]);
    const file: jest.SpyInstance = jest.spyOn(GitHubUtil, "getFileContent");

    let caught: Error | null = null;

    try {
      await ReadCodeFileTool.execute(
        {
          filePath: "src/Reporter.cs",
          repositoryId: PLAIN_GIT_ID.toString(),
        },
        ctx,
      );
    } catch (error) {
      caught = error as Error;
    }

    expect(caught?.message).toBe(
      `OneUptime cannot read the code of this repository. ${PLAIN_GIT_SENTENCE}`,
    );
    expect(caught?.message).not.toContain("No readable repository");
    expect(file).not.toHaveBeenCalled();
  });

  test("with a readable repository beside it, a tool without repositoryId reads the readable one", async () => {
    mockStoredRepositories([
      buildRepository({ name: "checkout" }),
      plainGitRepository(),
    ]);
    mockFileContent("export const charge = 1;");

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/billing/charge.ts" },
      ctx,
    );

    expect(result.dataForLlm).toContain("export const charge = 1;");
  });

  test("one outside the repositories a run is held to is never named", async () => {
    mockRepositories([
      buildRepository({ name: "checkout" }),
      plainGitRepository(),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      {
        ...ctx,
        codeRepositoryAllowance: {
          isEveryRepository: false,
          repositoryIds: [REPO_ID.toString()],
        },
      },
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).not.toContain("instant-access-reporter");
    expect(result.dataForLlm).not.toContain("plain Git");
  });

  test("a GitHub repository OneUptime cannot read is still not named - only a plain Git one is", async () => {
    mockRepositories([
      buildRepository({
        id: ObjectID.generate(),
        name: "uninstalled",
        installationId: "",
      }),
      plainGitRepository(),
    ]);

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm).not.toContain("uninstalled");
    expect(result.dataForLlm).toContain(PLAIN_GIT_SENTENCE);
  });

  test("describePlainGitRepositories is what the tools say", () => {
    expect(describePlainGitRepositories([plainGitRepository()])).toBe(
      PLAIN_GIT_SENTENCE,
    );
  });
});

/*
 * A Git repository on Azure DevOps is read as a GitLab one is: its tree and
 * its files, through Azure DevOps' file API with the credentials Git signs
 * in with. Issue #6144's repository - on an Azure DevOps Server, connected
 * as Git - goes the whole real way here: its row and its connection as the
 * server reads them, its reader (CodeHostAccess), and the server's API
 * faked at the transport.
 */
describe("a Git repository on Azure DevOps", () => {
  const AZURE_DEVOPS_URL: string =
    "https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter";
  const ITEMS_PATH: string =
    "/DefaultCollection/ScriptVault/_apis/git/repositories/InstantAccessReporter/items";

  // Azure DevOps' Items API for the repository: its tree, or one file of it.
  function azureDevOpsItems(files: Record<string, string>): FakeRoute {
    return {
      method: "GET",
      path: "/items",
      answer: (_request: unknown, url: URL): FakeAnswer => {
        const path: string | null = url.searchParams.get("path");

        if (path !== null) {
          return files[path] === undefined
            ? {
                status: 404,
                json: {
                  message: `TF401174: The item '${path}' could not be found in the repository 'InstantAccessReporter'.`,
                },
              }
            : {
                json: {
                  gitObjectType: "blob",
                  path,
                  content: files[path],
                  contentMetadata: { isBinary: false },
                },
              };
        }

        return {
          json: {
            count: Object.keys(files).length + 1,
            value: [
              { gitObjectType: "tree", path: "/", isFolder: true },
              ...Object.keys(files).map((file: string) => {
                return { gitObjectType: "blob", path: file };
              }),
            ],
          },
        };
      },
    };
  }

  function connectAzureDevOps(data: {
    routes: Array<FakeRoute>;
    connection?: Partial<CodeRepositoryConnection> | undefined;
    others?: Array<CodeRepositoryModel> | undefined;
  }): ConnectedRepository {
    const connected: ConnectedRepository = connectRepository({
      provider: CodeRepositoryType.Git,
      repository: {
        name: "instant-access-reporter",
        organizationName: "DefaultCollection/ScriptVault/_git",
        repositoryName: "InstantAccessReporter",
        repositoryUrl: OneUptimeURL.fromString(AZURE_DEVOPS_URL),
      },
      connection: { hostUrl: "https://tfs.example.com", ...data.connection },
      routes: data.routes,
    });

    // The caller's read and the server's own read of the rows.
    mockStoredRepositories([connected.repository, ...(data.others || [])]);

    return connected;
  }

  const FILES: Record<string, string> = {
    "/src/Reporter.cs":
      "namespace InstantAccessReporter;\n\npublic class Reporter\n{\n    public void Run() { }\n}\n",
    "/src/ReporterJob.cs": "namespace InstantAccessReporter;\n",
    "/src/Program.cs": "Reporter.Run();\n",
    "/README.md": "# Instant access reporter\n",
  };

  afterEach(() => {
    disconnectRepository();
  });

  test("list_code_repositories lists it as one whose code is read - not as a plain Git repository", async () => {
    connectAzureDevOps({ routes: [azureDevOpsItems(FILES)] });

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(CONNECTED_REPOSITORY_ID.toString());
    expect(result.dataForLlm).toContain(
      "DefaultCollection/ScriptVault/_git/InstantAccessReporter",
    );
    expect(result.dataForLlm).not.toContain("plain Git");
  });

  test("search_code searches its tree, read from the server's file API with the repository's own credentials", async () => {
    const connected: ConnectedRepository = connectAzureDevOps({
      routes: [azureDevOpsItems(FILES)],
    });

    const result: ToolExecutionResult = await SearchCodeTool.execute(
      { query: "reporter" },
      ctx,
    );

    expect(result.dataForLlm).toBe("- src/Reporter.cs\n- src/ReporterJob.cs");

    const request: URL = new URL(connected.host.requests[0]!.url);

    expect(request.origin).toBe("https://tfs.example.com");
    expect(request.pathname).toBe(ITEMS_PATH);
    expect(request.searchParams.get("scopePath")).toBe("/");
    expect(request.searchParams.get("versionDescriptor.version")).toBe("main");
    expect(request.searchParams.get("api-version")).toBe("5.0");
    expect(connected.host.requests[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from(`oneuptime-bot:${CONNECTED_TOKEN}`).toString("base64")}`,
    );
  });

  test("read_code_file reads a file of it at its main branch, with line numbers", async () => {
    connectAzureDevOps({ routes: [azureDevOpsItems(FILES)] });

    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "src/Reporter.cs", startLine: 3, endLine: 5 },
      ctx,
    );

    expect(result.dataForLlm).toContain("file: src/Reporter.cs");
    expect(result.dataForLlm).toContain(
      "repository: DefaultCollection/ScriptVault/_git/InstantAccessReporter@main",
    );
    expect(result.dataForLlm).toContain("showing lines 3-5 of 6");
    expect(result.dataForLlm).toContain("3| public class Reporter");
    expect(result.dataForLlm).not.toContain("namespace InstantAccessReporter");
  });

  test("read_code_file says a file that is not there is not there", async () => {
    connectAzureDevOps({ routes: [azureDevOpsItems(FILES)] });

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/Missing.cs" }, ctx),
    ).rejects.toThrow(/No readable file at "src\/Missing.cs" on branch main/);
  });

  test("find_code_for_exception maps a .NET stack trace onto its files", async () => {
    connectAzureDevOps({ routes: [azureDevOpsItems(FILES)] });

    const exception: TelemetryException = new TelemetryException();
    exception._id = ObjectID.generate().toString();
    exception.message = "Object reference not set to an instance of an object.";
    exception.exceptionType = "System.NullReferenceException";
    exception.occuranceCount = 3;
    exception.stackTrace = [
      "System.NullReferenceException: Object reference not set to an instance of an object.",
      "   at InstantAccessReporter.Reporter.Run() in /app/src/Reporter.cs:line 5",
      "   at InstantAccessReporter.Program.Main(String[] args) in /app/src/Program.cs:line 1",
    ].join("\n");

    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(exception as never);
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue({
        codeRepositoryId: CONNECTED_REPOSITORY_ID.toString(),
        organizationName: "DefaultCollection/ScriptVault/_git",
        repositoryName: "InstantAccessReporter",
        servicePathInRepository: null,
        method: "stack-trace",
        evidence: "Matched src/Reporter.cs",
      });

    const result: ToolExecutionResult = await FindCodeForExceptionTool.execute(
      { exceptionId: exception._id },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      `repositoryId: ${CONNECTED_REPOSITORY_ID.toString()}`,
    );
    expect(result.dataForLlm).toContain("src/Reporter.cs");
    expect(result.dataForLlm).toContain(
      `Use read_code_file with repositoryId=${CONNECTED_REPOSITORY_ID.toString()}`,
    );
  });

  test("one whose token was refused, or whose server only a project Runner reaches, is not read - and is no plain Git repository either", async () => {
    for (const connection of [
      { refusedAt: new Date() },
      { isReachableFromServer: false },
    ] as Array<Partial<CodeRepositoryConnection>>) {
      const connected: ConnectedRepository = connectAzureDevOps({
        routes: [azureDevOpsItems(FILES)],
        connection,
      });

      const result: ToolExecutionResult =
        await ListCodeRepositoriesTool.execute({}, ctx);

      expect(result.rowCount).toBe(0);
      expect(result.dataForLlm).toBe(
        "(no code repository in this project whose source OneUptime can read — GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read)",
      );
      expect(connected.host.requests).toHaveLength(0);

      disconnectRepository();
    }
  });

  test("beside a plain Git repository, it is read, and the other is named as one whose files are not", async () => {
    connectAzureDevOps({
      routes: [azureDevOpsItems(FILES)],
      others: [plainGitRepository()],
    });

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(CONNECTED_REPOSITORY_ID.toString());
    expect(result.dataForLlm).not.toContain(PLAIN_GIT_ID.toString());
    expect(result.dataForLlm).toContain(`\n\n${PLAIN_GIT_SENTENCE}`);
  });

  test("Azure DevOps refusing a read says so, and leaves the repository connected for Code's tasks", async () => {
    const connected: ConnectedRepository = connectAzureDevOps({
      routes: [
        {
          method: "GET",
          path: "/items",
          answer: (): FakeAnswer => {
            return { status: 401, text: "" };
          },
        },
      ],
    });

    await expect(
      ReadCodeFileTool.execute({ filePath: "src/Reporter.cs" }, ctx),
    ).rejects.toThrow(
      "Azure DevOps Server refused the access token. It may have expired or been revoked: create a new token and use it instead.",
    );
    expect(connected.refused()).toBe(0);
  });
});
