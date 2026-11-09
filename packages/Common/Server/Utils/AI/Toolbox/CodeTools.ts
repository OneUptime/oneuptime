import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { keepAllowedCodeRepositories } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import GitHubUtil, {
  GitHubFileContent,
} from "../../CodeRepository/GitHub/GitHub";
import {
  normalizeCandidatePath,
  RepoResolution,
} from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
import GitHubInstallationBinding from "../../CodeRepository/GitHub/GitHubInstallationBinding";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
  CodeHostReader,
} from "../../CodeRepository/CodeHost/CodeHostAccess";
import { CodeHostFileContent } from "../../CodeRepository/CodeHost/CodeHostTypes";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import {
  AIChatLinesShown,
  AIChatRecordSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  getCodeFileLinesShown,
  normalizeCodeBranchName,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import {
  describeValuesHiddenOnRead,
  findLinesWithValuesHidden,
  getCodeFileSeenFromRead,
} from "./CodeFilesSeen";

/*
 * Tools that let the chat agent read the project's linked source code and
 * connect a telemetry signal to the code that produced it.
 *
 * The trust posture here is deliberately narrower than the observability
 * tools': source is read-only, only repositories OneUptime reaches and whose
 * files it reads (a GitHub repository through the GitHub App, a GitLab,
 * Forgejo or Gitea repository through its connection, a Git repository on
 * Azure DevOps through Azure DevOps' file API and its Git credentials -
 * CodeHostAccess), and every payload goes through the same secret redaction
 * as telemetry (a repo's config files are a likelier place to find a live
 * credential than a log line is).
 */

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily, not at module load: this module is pulled in through the
 * service import graph before the model classes are fully wired up, so calling
 * a model method at import time throws a circular-dependency TypeError. By the
 * time a tool actually executes, every module is loaded. (Same reasoning as
 * ExceptionTools.)
 */
let cachedRepositoryReadPermissions: Array<Permission> | null = null;
const resolveRepositoryReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedRepositoryReadPermissions) {
      cachedRepositoryReadPermissions =
        new CodeRepository().getReadPermissions();
    }
    return cachedRepositoryReadPermissions;
  };

/*
 * find_code_for_exception touches both an exception and a repository, so it
 * offers both permission sets here. Note the toolbox gate is an INTERSECTION
 * test (PermissionHelper.doesPermissionsIntersect) — holding either set opens
 * the tool, not both. That is deliberate and safe: the real enforcement is at
 * the query layer, where the exception is fetched with ctx.props (so a
 * repo-only user gets "not found") and the repository is re-checked through
 * findReadableRepositories. This list is defense-in-depth, not the gate.
 */
let cachedExceptionReadPermissions: Array<Permission> | null = null;
const resolveExceptionReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedExceptionReadPermissions) {
      cachedExceptionReadPermissions =
        new TelemetryException().getReadPermissions();
    }
    return cachedExceptionReadPermissions;
  };

/*
 * Line budget for one read_code_file call. The chat loop allows 16 tool calls
 * against a context window nothing in this codebase measures (there is no
 * tokenizer and no per-model context length anywhere), so the cap is a
 * deliberately conservative guess rather than a computed fit: ~400 lines is
 * roughly 4-6k tokens, leaving room for several reads plus the telemetry that
 * motivated them.
 */
const MAX_LINES_PER_READ: number = 400;
const DEFAULT_CONTEXT_LINES: number = 60;
const MAX_SEARCH_RESULTS: number = 40;

/*
 * Byte budget for the code block, deliberately under ToolResultSerializer's own
 * 16KB payload cap. Staying below it means the serializer's blind hard-slice
 * never fires on code, so the range the header reports is always the range the
 * payload actually contains. The headroom absorbs redactions that grow the text
 * (e.g. "1.2.3.4" → "[redacted-ip]").
 */
const MAX_CODE_PAYLOAD_BYTES: number = 12 * 1024;

/*
 * The GitHub App installation of each repository the caller's read found,
 * read as OneUptime and kept on the server: the tools mint the repository's
 * token from it and never show it, so what the caller may read is decided
 * by their own read alone. Only those repositories, in the caller's project.
 */
async function addInstallationIds(
  ctx: ToolContext,
  repositories: Array<CodeRepository>,
): Promise<void> {
  const ids: Array<string> = repositories
    .map((repository: CodeRepository): string => {
      return repository.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });

  if (ids.length === 0) {
    return;
  }

  const installations: Array<CodeRepository> =
    await CodeRepositoryService.findBy({
      query: {
        _id: QueryHelper.any(ids),
        projectId: ctx.projectId,
      } as never,
      select: {
        _id: true,
        gitHubAppInstallationId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  const installationOf: Map<string, string | undefined> = new Map();

  for (const installation of installations) {
    installationOf.set(
      installation.id?.toString() || "",
      installation.gitHubAppInstallationId || undefined,
    );
  }

  for (const repository of repositories) {
    const installationId: string | undefined = installationOf.get(
      repository.id?.toString() || "",
    );

    if (installationId) {
      repository.gitHubAppInstallationId = installationId;
    } else {
      delete repository.gitHubAppInstallationId;
    }
  }
}

/*
 * What the code tools may say of the project's repositories: the ones whose
 * code OneUptime reads now, and the plain Git repositories this caller may
 * see. A Git repository is connected for Code's tasks - a Runner clones it -
 * but a Git server OneUptime does not know has no API for its files, so
 * OneUptime reads only its branches. Named so the model says why it cannot
 * read one (issue #6144: a repository connected as Git read as though
 * nothing were connected) - never as readable. A Git repository on Azure
 * DevOps is no plain one: its files are read (AzureDevOpsApi), as a GitLab
 * repository's are.
 */
export interface CodeToolRepositories {
  readable: Array<CodeRepository>;
  plainGit: Array<CodeRepository>;
}

/*
 * Where OneUptime reads code, as the tools tell the model when it reads
 * none: every host but a Git server OneUptime does not know.
 */
const READ_HOSTS: string =
  "GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read";

// A repository as the code tools name it: its name and where it is.
function nameRepository(repository: CodeRepository): string {
  return `${repository.name} (${repository.organizationName}/${repository.repositoryName})`;
}

/*
 * The plain Git repositories, named, and why the code tools cannot open
 * them - a sentence for the model to pass on.
 */
export function describePlainGitRepositories(
  repositories: Array<CodeRepository>,
): string {
  const isOne: boolean = repositories.length === 1;
  const it: string = isOne ? "it" : "them";
  const its: string = isOne ? "its" : "their";

  return `${repositories.map(nameRepository).join(", ")} ${
    isOne ? "is a plain Git repository" : "are plain Git repositories"
  }: OneUptime reads ${its} branches, not ${its} files, so search_code and read_code_file cannot open ${it}. A task in Code still works in ${it} - a Runner clones ${it} - and AI pushes its change on a branch.`;
}

/*
 * The repositories this user can see, already filtered to the ones that are
 * actually readable. A repository row can exist without a way in (a GitHub
 * one imported then uninstalled, a GitLab one whose token was refused) or on
 * a host whose files OneUptime does not read (a plain Git repository: a Git
 * server that is not Azure DevOps), and those must never look readable to
 * the model. A run held to some repositories (ctx.codeRepositoryAllowance -
 * the ones the rules that matched its incident name) reads only those.
 */
export async function findReadableRepositories(
  ctx: ToolContext,
  codeRepositoryId?: ObjectID | undefined,
): Promise<Array<CodeRepository>> {
  return (await findCodeToolRepositories(ctx, codeRepositoryId)).readable;
}

/*
 * The readable repositories (findReadableRepositories), and beside them the
 * plain Git repositories the same read found - in the project, readable by
 * this caller, within the run's allowance - so the tools can say why those
 * are not read.
 */
export async function findCodeToolRepositories(
  ctx: ToolContext,
  codeRepositoryId?: ObjectID | undefined,
): Promise<CodeToolRepositories> {
  const query: JSONObject = {
    projectId: ctx.projectId,
  };

  if (codeRepositoryId) {
    query["_id"] = codeRepositoryId.toString();
  }

  /*
   * The repositories the caller may read, by their own permissions: only
   * columns every reader of a repository may read. The installation a
   * repository's token is minted from is read by fewer people than the
   * repository (its owners, admins and Read Code Repository), so selecting
   * it here refused every Project Member, Viewer and settings role who asked
   * Ask AI about code - "You do not have permissions to select on -
   * gitHubAppInstallationId" - though the tools are offered to them.
   */
  const allRepositories: Array<CodeRepository> =
    await CodeRepositoryService.findBy({
      query: query as never,
      select: {
        _id: true,
        projectId: true,
        name: true,
        organizationName: true,
        repositoryName: true,
        mainBranchName: true,
        repositoryHostedAt: true,
        // A Git repository's clone address says whether it is on Azure DevOps.
        repositoryUrl: true,
        description: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: ctx.props,
    });

  const repositories: Array<CodeRepository> = keepAllowedCodeRepositories({
    allowance: ctx.codeRepositoryAllowance,
    repositories: allRepositories,
    getId: (repository: CodeRepository): string => {
      return repository.id?.toString() || "";
    },
  });

  await addInstallationIds(ctx, repositories);

  const gitHubRepositories: Array<CodeRepository> = repositories.filter(
    (repository: CodeRepository) => {
      return (
        CodeHost.readType(repository.repositoryHostedAt) ===
          CodeRepositoryType.GitHub &&
        Boolean(repository.gitHubAppInstallationId)
      );
    },
  );

  /*
   * Plain Git repositories are never read, whatever their connection: there
   * is no API to read their files through. They are said apart. A Git
   * repository on Azure DevOps is not one: its files are read through Azure
   * DevOps' own API, where it is reached.
   */
  const plainGit: Array<CodeRepository> = repositories.filter(
    (repository: CodeRepository) => {
      return (
        CodeHost.readType(repository.repositoryHostedAt) ===
          CodeRepositoryType.Git &&
        !CodeHost.canReadRepositoryCode({
          type: CodeRepositoryType.Git,
          repositoryUrl: repository.repositoryUrl?.toString(),
        })
      );
    },
  );

  /*
   * Repositories on other hosts - and Git repositories on Azure DevOps -
   * are read through their connections: only those connected now, whose
   * files OneUptime reads, on a server OneUptime may reach.
   */
  const otherRepositories: Array<CodeRepository> =
    await keepRepositoriesWithReadableCode(
      ctx,
      repositories.filter((repository: CodeRepository) => {
        return (
          CodeHost.readType(repository.repositoryHostedAt) !==
            CodeRepositoryType.GitHub && !plainGit.includes(repository)
        );
      }),
    );

  /*
   * Every code tool — read and write — resolves its target through here, so
   * this is the one place that has to prove the row's installation really
   * belongs to the row's project (GHSA-xx95-gmcf-7q86). "The row is in your
   * project" is not that proof: before the fix a caller could put any
   * installation ID on a row in a project they owned, and these tools would
   * then read source, commit and open pull requests in another tenant's
   * private repositories.
   *
   * Writing an unbound installation ID is closed off now and the quarantine
   * migration clears the rows that already existed, so this filter should
   * never drop anything on a healthy database. It stays because the cost of
   * being wrong here is another tenant's source code.
   */
  if (gitHubRepositories.length === 0) {
    return { readable: otherRepositories, plainGit };
  }

  // Every row here is in ctx.projectId, so one lookup answers for all of them.
  const boundInstallationId: string | null =
    await GitHubInstallationBinding.getBoundInstallationId(ctx.projectId);

  return {
    readable: [
      ...gitHubRepositories.filter((repository: CodeRepository) => {
        if (
          boundInstallationId &&
          repository.gitHubAppInstallationId === boundInstallationId
        ) {
          return true;
        }

        logger.error(
          `Excluding code repository ${repository.id?.toString()} from AI code tools: its GitHub App installation is not bound to project ${ctx.projectId.toString()}.`,
        );

        return false;
      }),
      ...otherRepositories,
    ],
    plainGit,
  };
}

/*
 * Of repositories on hosts beside GitHub, those whose code OneUptime reads
 * now: connected through their connection (the project's, its token not
 * refused), whose files it reads - their host's, or a Git repository's on
 * Azure DevOps (CodeHost.canReadRepositoryCode) - on a server it may reach.
 */
async function keepRepositoriesWithReadableCode(
  ctx: ToolContext,
  repositories: Array<CodeRepository>,
): Promise<Array<CodeRepository>> {
  if (repositories.length === 0) {
    return [];
  }

  const summaries: Map<string, CodeHostConnectionSummary> =
    await CodeHostAccess.getConnectionSummaries({
      projectId: ctx.projectId,
      repositoryIds: repositories
        .filter((repository: CodeRepository): boolean => {
          return Boolean(repository.id);
        })
        .map((repository: CodeRepository): ObjectID => {
          return repository.id!;
        }),
    });

  return repositories.filter((repository: CodeRepository): boolean => {
    const summary: CodeHostConnectionSummary | undefined = repository.id
      ? summaries.get(repository.id.toString())
      : undefined;

    return Boolean(
      summary &&
        summary.state === CodeHostConnectionState.Connected &&
        summary.isReachableFromServer &&
        CodeHost.canReadRepositoryCode({
          type: summary.provider,
          repositoryUrl: repository.repositoryUrl?.toString(),
        }),
    );
  });
}

/*
 * A readable repository's file tree, on its main branch: GitHub's through
 * the installation, any other host's through its reader. Both cached.
 */
export async function readRepositoryTreePaths(
  ctx: ToolContext,
  repository: CodeRepository,
): Promise<Array<string>> {
  if (
    CodeHost.readType(repository.repositoryHostedAt) ===
    CodeRepositoryType.GitHub
  ) {
    return await GitHubUtil.getRepositoryTreePaths({
      installationId: repository.gitHubAppInstallationId!,
      organizationName: repository.organizationName!,
      repositoryName: repository.repositoryName!,
      branchName: repository.mainBranchName || "main",
    });
  }

  return await (
    await getRepositoryReader(ctx, repository)
  ).getTreePaths(repository.mainBranchName || "main");
}

// One file of a readable repository, or null where there is no such file.
export async function readRepositoryFile(data: {
  ctx: ToolContext;
  repository: CodeRepository;
  branchName: string;
  filePath: string;
}): Promise<CodeHostFileContent | null> {
  if (
    CodeHost.readType(data.repository.repositoryHostedAt) ===
    CodeRepositoryType.GitHub
  ) {
    const file: GitHubFileContent | null = await GitHubUtil.getFileContent({
      installationId: data.repository.gitHubAppInstallationId!,
      organizationName: data.repository.organizationName!,
      repositoryName: data.repository.repositoryName!,
      branchName: data.branchName,
      filePath: data.filePath,
    });

    return file;
  }

  return await (
    await getRepositoryReader(data.ctx, data.repository)
  ).getFileContent({
    filePath: data.filePath,
    branchName: data.branchName,
  });
}

async function getRepositoryReader(
  ctx: ToolContext,
  repository: CodeRepository,
): Promise<CodeHostReader> {
  const reader: CodeHostReader | null = await CodeHostAccess.getReader({
    projectId: ctx.projectId,
    repositoryId: repository.id!,
  });

  if (!reader || !reader.canReadCode) {
    throw new BadDataException(
      `OneUptime cannot read the code of ${repository.organizationName}/${repository.repositoryName} right now: it is not connected, or its host's files are not read.`,
    );
  }

  return reader;
}

/*
 * Resolve the one repository a tool call should act on. Ambiguity is an error
 * the model can fix (by naming a repositoryId) rather than something to guess
 * at — guessing would silently answer a question about the wrong codebase.
 */
export async function resolveTargetRepository(
  ctx: ToolContext,
  args: JSONObject,
): Promise<CodeRepository> {
  const requestedId: ObjectID | undefined = ToolArgs.getObjectID(
    args,
    "repositoryId",
  );

  const found: CodeToolRepositories = await findCodeToolRepositories(
    ctx,
    requestedId,
  );
  const repositories: Array<CodeRepository> = found.readable;

  if (repositories.length === 0) {
    if (requestedId) {
      if (found.plainGit.length > 0) {
        throw new BadDataException(
          `OneUptime cannot read the code of this repository. ${describePlainGitRepositories(found.plainGit)}`,
        );
      }

      throw new BadDataException(
        `No readable repository with id ${requestedId.toString()} in this project. Call list_code_repositories to see which repositories are connected.`,
      );
    }

    if (found.plainGit.length > 0) {
      throw new BadDataException(
        `This project has no connected code repository whose source OneUptime can read: ${READ_HOSTS}. ${describePlainGitRepositories(found.plainGit)}`,
      );
    }

    throw new BadDataException(
      `This project has no connected code repository whose source OneUptime can read. Connect one in Code: ${READ_HOSTS} (another Git server's files are not).`,
    );
  }

  if (repositories.length > 1) {
    const names: string = repositories
      .map((repository: CodeRepository) => {
        return `${repository.name} (repositoryId=${repository.id?.toString()})`;
      })
      .join(", ");
    throw new BadDataException(
      `This project has several repositories, so repositoryId is required. Choose one of: ${names}.`,
    );
  }

  return repositories[0]!;
}

/*
 * The exception's identity, redacted and length-capped. exception.message is
 * populated verbatim from the monitored application's thrown error, so it is
 * both the likeliest place for a stray credential and unbounded in length
 * (a VeryLongText column). Every other tool that surfaces it routes it through
 * the serializer; this keeps that invariant instead of interpolating it raw.
 *
 * The redaction count is returned, not discarded: it feeds the AIRun egress
 * manifest, so dropping it would under-report what left the tenant.
 */
function summarizeExceptionForLlm(exception: TelemetryException): {
  text: string;
  redactionCount: number;
} {
  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    {
      exceptionType: exception.exceptionType || "Error",
      message: exception.message,
      occurrences: exception.occuranceCount,
    },
  ]);

  return {
    text: `exception: ${serialized.text.replace(/^- /, "")}`,
    redactionCount: serialized.redactionCount,
  };
}

/*
 * The repository's file tree, for turning runtime stack-trace paths into real
 * repository paths. The resolver has already fetched (and cached for an hour)
 * this exact tree while matching the stack trace, so this is a cache hit in
 * the normal path rather than a second API round-trip.
 */
async function getTreePathsForResolution(
  ctx: ToolContext,
  resolution: RepoResolution,
): Promise<Array<string>> {
  const repositories: Array<CodeRepository> = await findReadableRepositories(
    ctx,
    new ObjectID(resolution.codeRepositoryId),
  );

  const repository: CodeRepository | undefined = repositories[0];

  if (!repository) {
    return [];
  }

  try {
    return await readRepositoryTreePaths(ctx, repository);
  } catch (err) {
    /*
     * A tree fetch failure must not sink the whole answer: the frames are still
     * worth reporting, just without openable paths.
     */
    logger.debug(err);
    return [];
  }
}

/*
 * Map one stack frame's runtime path onto a real path in the repository tree.
 * Returns null unless the match is unambiguous — handing the model a
 * confidently-wrong path is worse than telling it the path is unknown, because
 * it would then read and reason about the wrong file.
 */
function matchFrameToRepositoryPath(
  rawFramePath: string,
  treePaths: Array<string>,
): string | null {
  if (treePaths.length === 0) {
    return null;
  }

  // Strips container prefixes (/app, /usr/src/app) and rejects dependency noise.
  const normalized: string | null = normalizeCandidatePath(rawFramePath);

  if (!normalized) {
    return null;
  }

  // An exact tree path wins outright.
  if (treePaths.includes(normalized)) {
    return normalized;
  }

  /*
   * Otherwise the frame path is a suffix of the repository path (the runtime
   * working directory swallowed the leading segments). Longest suffix wins;
   * ties mean genuinely ambiguous and resolve to null.
   */
  const suffixMatches: Array<string> = treePaths.filter((treePath: string) => {
    return treePath.endsWith(`/${normalized}`);
  });

  if (suffixMatches.length === 1) {
    return suffixMatches[0]!;
  }

  return null;
}

/*
 * Split file content into lines without inventing a phantom blank line for the
 * trailing newline that virtually every source file ends with.
 */
function splitIntoLines(content: string): Array<string> {
  if (content === "") {
    return [];
  }

  const lines: Array<string> = content.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/*
 * How many lines a numbered block still holds whole once the serializer
 * cut it at its own payload cap: the line breaks it kept, each the end of
 * a line shown whole. Counted with indexOf, never a regular expression: a
 * block can hold a single line tens of kilobytes long.
 */
function countWholeLinesKept(text: string): number {
  let count: number = 0;
  let at: number = text.indexOf("\n");

  while (at !== -1) {
    count++;
    at = text.indexOf("\n", at + 1);
  }

  return count;
}

/*
 * Take as many whole lines as fit the code payload budget. Whole lines, not
 * bytes: a mid-line cut would hand the model a truncated identifier that reads
 * like real code.
 */
function takeLinesWithinByteBudget(
  lines: Array<string>,
  startLine: number,
): Array<string> {
  const kept: Array<string> = [];
  // Each line also carries a "NNN| " prefix once numbered.
  const prefixWidth: number = String(startLine + lines.length - 1).length + 2;
  let bytes: number = 0;

  for (const line of lines) {
    const lineBytes: number = Buffer.byteLength(line, "utf8") + prefixWidth + 1;

    if (kept.length > 0 && bytes + lineBytes > MAX_CODE_PAYLOAD_BYTES) {
      break;
    }

    bytes += lineBytes;
    kept.push(line);
  }

  return kept;
}

// Prefix each line with its real file line number so the model can cite lines.
function formatWithLineNumbers(data: {
  lines: Array<string>;
  startLine: number;
}): string {
  const width: number = String(data.startLine + data.lines.length - 1).length;

  return data.lines
    .map((line: string, index: number) => {
      const lineNumber: string = String(data.startLine + index).padStart(
        width,
        " ",
      );
      return `${lineNumber}| ${line}`;
    })
    .join("\n");
}

export const ListCodeRepositoriesTool: ObservabilityTool = {
  name: "list_code_repositories",
  description:
    "List the code repositories connected to this project, with the repositoryId needed by search_code and read_code_file. Call this first when the user asks about source code and you do not already know which repository to look in.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  get requiredPermissions(): Array<Permission> {
    return resolveRepositoryReadPermissions();
  },
  execute: async (
    _args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const found: CodeToolRepositories = await findCodeToolRepositories(ctx);
    const repositories: Array<CodeRepository> = found.readable;

    const rows: Array<JSONObject> = repositories.map(
      (repository: CodeRepository) => {
        return {
          repositoryId: repository.id?.toString(),
          name: repository.name,
          repository: `${repository.organizationName}/${repository.repositoryName}`,
          branch: repository.mainBranchName,
          description: repository.description,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    /*
     * The plain Git repositories are said after the readable ones, as
     * repositories whose code cannot be opened - never as rows the model
     * could pass to search_code or read_code_file.
     */
    const plainGitNote: { text: string; count: number } =
      found.plainGit.length > 0
        ? ToolResultSerializer.redact(
            `\n\n${describePlainGitRepositories(found.plainGit)}`,
          )
        : { text: "", count: 0 };

    return {
      dataForLlm:
        rows.length === 0
          ? `(no code repository in this project whose source OneUptime can read — ${READ_HOSTS})${plainGitNote.text}`
          : `${serialized.text}${plainGitNote.text}`,
      rowCount: serialized.rowCount,
      citationLabel: `Connected code repositories (${serialized.rowCount})`,
      redactionCount: serialized.redactionCount + plainGitNote.count,
      isTruncated: serialized.isTruncated,
    };
  },
};

export const FindCodeForExceptionTool: ObservabilityTool = {
  name: "find_code_for_exception",
  description:
    "Given an exception id (from top_exceptions), work out which connected repository its code lives in and which source files and line numbers its stack trace implicates. This is the bridge from a telemetry signal to the code that caused it: call it before read_code_file when investigating an exception's root cause.",
  inputSchema: {
    type: "object",
    properties: {
      exceptionId: {
        type: "string",
        description:
          "The exception id returned by top_exceptions (the `id` field).",
      },
    },
    required: ["exceptionId"],
  },
  get requiredPermissions(): Array<Permission> {
    return [
      ...resolveExceptionReadPermissions(),
      ...resolveRepositoryReadPermissions(),
    ];
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const exceptionId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "exceptionId",
    );

    if (!exceptionId) {
      throw new BadDataException(
        "exceptionId is required. Get one from top_exceptions.",
      );
    }

    // props (not isRoot) so an unauthorized exception reads as "not found".
    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneById({
        id: exceptionId,
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          stackTrace: true,
          fingerprint: true,
          occuranceCount: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
        props: ctx.props,
      });

    if (!exception) {
      throw new BadDataException(
        `No exception found with id ${exceptionId.toString()} in this project.`,
      );
    }

    const stackTrace: string = exception.stackTrace || "";

    /*
     * The exception's own message is the most attacker-influenceable string in
     * the whole tool belt — it is whatever the monitored app threw — so it gets
     * the same redaction and length cap every other tool applies to it via the
     * serializer, rather than being interpolated raw into the header.
     */
    const described: { text: string; redactionCount: number } =
      summarizeExceptionForLlm(exception);
    const describedException: string = described.text;

    if (!stackTrace.trim()) {
      return {
        dataForLlm: `${describedException}\n\nThis exception has no stack trace recorded, so its code location cannot be determined. Consider search_code if you know roughly what the code is called.`,
        rowCount: 0,
        citationLabel: `Code location for exception (no stack trace)`,
        redactionCount: described.redactionCount,
        isTruncated: false,
      };
    }

    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: ctx.projectId,
        stackTrace: stackTrace,
        serviceName: null,
        // A run held to some repositories resolves among those only.
        allowance: ctx.codeRepositoryAllowance,
      });

    /*
     * resolveRepositoryForException queries as isRoot (it serves the autonomous
     * fix agent, which has no user), so it can name a repository this user is
     * not allowed to see — CodeRepository is label-access-controlled. Re-check
     * the answer against the user's own readable set before disclosing it.
     */
    let readableResolution: RepoResolution | null = null;

    if (resolution) {
      const readable: Array<CodeRepository> = await findReadableRepositories(
        ctx,
        new ObjectID(resolution.codeRepositoryId),
      );

      if (readable.length > 0) {
        readableResolution = resolution;
      }
    }

    const parsed: ParsedStackTrace = StackTraceParser.parse(stackTrace);

    /*
     * in-app frames first: library frames are almost never the fix site, and
     * the model will otherwise happily read node_modules. Order is preserved
     * within each group so the throw site stays at the top.
     */
    const appFrames: Array<StackFrame> = parsed.frames.filter(
      (frame: StackFrame) => {
        return frame.inApp;
      },
    );

    const selectedFrames: Array<StackFrame> = (
      appFrames.length > 0 ? appFrames : parsed.frames
    ).slice(0, 15);

    /*
     * A frame's fileName is a RUNTIME path (/app/src/billing/charge.ts); the
     * Contents API needs a REPOSITORY path (src/billing/charge.ts). Without
     * this mapping every path handed to read_code_file 404s, which is the whole
     * point of the tool. Match each frame against the repository's real tree
     * (already cached for an hour by the resolver's own probe) so the model is
     * only ever given paths that open.
     */
    const treePaths: Array<string> = readableResolution
      ? await getTreePathsForResolution(ctx, readableResolution)
      : [];

    const frameRows: Array<JSONObject> = selectedFrames.map(
      (frame: StackFrame) => {
        const repoPath: string | null = matchFrameToRepositoryPath(
          frame.fileName,
          treePaths,
        );

        return {
          file: repoPath || frame.fileName,
          line: frame.lineNumber,
          function: frame.functionName,
          isApplicationCode: frame.inApp,
          // Only a matched path is safe to hand to read_code_file.
          openableWithReadCodeFile: Boolean(repoPath),
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(frameRows);

    const header: Array<string> = [describedException];

    if (readableResolution) {
      const openable: number = frameRows.filter((row: JSONObject) => {
        return row["openableWithReadCodeFile"] === true;
      }).length;

      header.push(
        `resolvedRepository: ${readableResolution.organizationName}/${readableResolution.repositoryName}`,
        `repositoryId: ${readableResolution.codeRepositoryId}`,
        `howResolved: ${readableResolution.method} (${readableResolution.evidence})`,
      );

      if (openable > 0) {
        header.push(
          `Use read_code_file with repositoryId=${readableResolution.codeRepositoryId} and a file path below that has openableWithReadCodeFile=true, passing aroundLine=<the frame's line>.`,
        );
      } else {
        header.push(
          `None of these frames could be matched to a file in the repository's tree, so their paths are raw runtime paths and read_code_file will not open them. Use search_code to find the real path first.`,
        );
      }
    } else {
      header.push(
        `resolvedRepository: none — could not match this stack trace to any connected repository you can read. Say so rather than guessing which repo or file it is.`,
      );
    }

    if (appFrames.length === 0 && parsed.frames.length > 0) {
      header.push(
        `note: every frame looks like library/framework code, so these are NOT application code.`,
      );
    }

    const framesText: string =
      frameRows.length > 0
        ? `\n\nstack frames (most recent first):\n${serialized.text}`
        : `\n\nThe stack trace could not be parsed into frames. Raw stack trace:\n${ToolResultSerializer.serializeText(stackTrace, 1).text}`;

    return {
      dataForLlm: `${header.join("\n")}${framesText}`,
      rowCount: frameRows.length,
      citationLabel: readableResolution
        ? `Code location: ${readableResolution.organizationName}/${readableResolution.repositoryName} (${frameRows.length} frames)`
        : `Code location for exception (no repository matched)`,
      citationTarget: {
        type: AIChatCitationTargetType.Exceptions,
      },
      // Both payloads egress, so the manifest must count both.
      redactionCount: described.redactionCount + serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};

export const SearchCodeTool: ObservabilityTool = {
  name: "search_code",
  description:
    "Find source file paths in a connected repository by matching part of a file or directory name (e.g. 'checkout', 'billing/charge.ts'). Returns paths only, not contents — follow up with read_code_file. Use this to locate code when you do not have a stack trace.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Part of a file path or file name to match, case-insensitive (e.g. 'PaymentService' or 'src/billing').",
      },
      repositoryId: {
        type: "string",
        description:
          "Which repository to search, from list_code_repositories. Optional when the project has exactly one connected repository.",
      },
      limit: {
        type: "number",
        description: `Maximum paths to return (default 20, max ${MAX_SEARCH_RESULTS}).`,
      },
    },
    required: ["query"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveRepositoryReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const query: string | undefined = ToolArgs.getString(args, "query");

    if (!query) {
      throw new BadDataException(
        "query is required — pass part of a file or directory name to match.",
      );
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 20,
      min: 1,
      max: MAX_SEARCH_RESULTS,
    });

    const repository: CodeRepository = await resolveTargetRepository(ctx, args);

    const paths: Array<string> = await readRepositoryTreePaths(ctx, repository);

    const needle: string = query.toLowerCase();

    const matches: Array<string> = paths.filter((path: string) => {
      return path.toLowerCase().includes(needle);
    });

    /*
     * Shortest-first: 'src/billing/charge.ts' is a likelier intent than
     * 'src/billing/__tests__/charge.fixture.ts', and the cap would otherwise
     * cut off the file the user actually meant.
     */
    matches.sort((a: string, b: string) => {
      return a.length - b.length;
    });

    const limited: Array<string> = matches.slice(0, limit);

    const text: string =
      limited.length === 0
        ? `(no file paths in ${repository.organizationName}/${repository.repositoryName} match "${query}")`
        : limited
            .map((path: string) => {
              return `- ${path}`;
            })
            .join("\n");

    const isTruncated: boolean = matches.length > limited.length;

    return {
      dataForLlm: isTruncated
        ? `${text}\n… [showing ${limited.length} of ${matches.length} matches; narrow the query to see the rest]`
        : text,
      rowCount: limited.length,
      citationLabel: `Code search "${query}" in ${repository.organizationName}/${repository.repositoryName} (${limited.length} of ${matches.length})`,
      redactionCount: 0,
      isTruncated: isTruncated,
    };
  },
};

export const ReadCodeFileTool: ObservabilityTool = {
  name: "read_code_file",
  description:
    "Read the source of one file from a connected repository, with line numbers. Pass startLine/endLine to read the region around a stack-trace line rather than the whole file. Quote only the few lines that matter in your answer. It reads the repository's main branch unless you pass branchName: before you change a file with commit_code_to_branch, read it on the branch you commit to.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description:
          "Repository-relative path, e.g. 'src/billing/charge.ts'. Use the exact path from find_code_for_exception or search_code.",
      },
      repositoryId: {
        type: "string",
        description:
          "Which repository to read from, from list_code_repositories or find_code_for_exception. Optional when the project has exactly one connected repository.",
      },
      startLine: {
        type: "number",
        description:
          "First line to read (1-based). Omit to read from the top of the file.",
      },
      endLine: {
        type: "number",
        description: `Last line to read (1-based, inclusive). At most ${MAX_LINES_PER_READ} lines are returned per call.`,
      },
      aroundLine: {
        type: "number",
        description: `Read a window centred on this line — the convenient way to inspect a stack-trace frame. Returns ${DEFAULT_CONTEXT_LINES} lines either side. Ignored when startLine is given.`,
      },
      branchName: {
        type: "string",
        description:
          "The branch to read the file on. Defaults to the repository's main branch.",
      },
    },
    required: ["filePath"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveRepositoryReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const filePath: string | undefined = ToolArgs.getString(args, "filePath");

    if (!filePath) {
      throw new BadDataException("filePath is required.");
    }

    const repository: CodeRepository = await resolveTargetRepository(ctx, args);
    const branchName: string =
      normalizeCodeBranchName(ToolArgs.getString(args, "branchName") || "") ||
      repository.mainBranchName ||
      "main";

    const file: CodeHostFileContent | null = await readRepositoryFile({
      ctx,
      repository,
      branchName,
      filePath,
    });

    if (!file) {
      throw new BadDataException(
        `No readable file at "${filePath}" on branch ${branchName} of ${repository.organizationName}/${repository.repositoryName}. It may not exist, or may be a directory or a binary file. Use search_code to find the exact path.`,
      );
    }

    /*
     * What this showed the model of the file: its version on the branch
     * read, kept with the citation by OneUptime - never the model - so a
     * commit written from it later says, before anyone approves it, what
     * was pushed to the file since (issue #6313). Whichever lines it shows,
     * the version is the file's - and the lines it shows are kept with it,
     * when they are not all of them (issue #6330): a commit writes the
     * whole file, so a version Ask AI saw only part of says so on the card.
     */
    const seen: (
      linesShown?: AIChatLinesShown | undefined,
    ) => AIChatRecordSeen | null = (
      linesShown?: AIChatLinesShown | undefined,
    ): AIChatRecordSeen | null => {
      return repository.id
        ? getCodeFileSeenFromRead({
            repositoryId: repository.id.toString(),
            branchName: branchName,
            filePath: filePath,
            file: file,
            linesShown: linesShown,
          })
        : null;
    };

    const allLines: Array<string> = splitIntoLines(file.content);

    if (allLines.length === 0) {
      // An empty file shows all of itself.
      const recordSeen: AIChatRecordSeen | null = seen();

      return {
        dataForLlm: `file: ${filePath}\nrepository: ${repository.organizationName}/${repository.repositoryName}@${branchName}\n\n(this file is empty — 0 bytes)`,
        rowCount: 0,
        citationLabel: `${filePath} (empty)`,
        redactionCount: 0,
        isTruncated: false,
        ...(recordSeen ? { recordSeen: recordSeen } : {}),
      };
    }

    /*
     * Resolve the window. `aroundLine` is sugar for the overwhelmingly common
     * case — "show me the code at the frame that threw" — so the model does
     * not have to do off-by-one arithmetic on every stack frame.
     */
    let startLine: number = ToolArgs.getNumber(args, "startLine", {
      defaultValue: 0,
      min: 0,
      max: allLines.length,
    });

    let endLine: number = ToolArgs.getNumber(args, "endLine", {
      defaultValue: 0,
      min: 0,
      max: allLines.length,
    });

    const aroundLine: number = ToolArgs.getNumber(args, "aroundLine", {
      defaultValue: 0,
      min: 0,
      max: allLines.length,
    });

    if (!startLine && aroundLine) {
      startLine = Math.max(1, aroundLine - DEFAULT_CONTEXT_LINES);

      // Never silently discard an endLine the caller actually asked for.
      if (!endLine) {
        endLine = Math.min(allLines.length, aroundLine + DEFAULT_CONTEXT_LINES);
      }
    }

    if (!startLine) {
      startLine = 1;
    }

    if (!endLine || endLine < startLine) {
      endLine = allLines.length;
    }

    // Clamp the window rather than refusing: a partial read still answers.
    const requestedEndLine: number = endLine;

    if (endLine - startLine + 1 > MAX_LINES_PER_READ) {
      endLine = startLine + MAX_LINES_PER_READ - 1;
    }

    /*
     * Trim to a byte budget BEFORE serializing. serializeText hard-slices at
     * its own payload cap, which would silently drop the tail mid-line while
     * the header still advertised the full range — and the "read on from a
     * later startLine" hint would then skip exactly the lines that were cut.
     * Trimming by whole lines here keeps the reported range true.
     */
    const selected: Array<string> = takeLinesWithinByteBudget(
      allLines.slice(startLine - 1, endLine),
      startLine,
    );

    const actualEndLine: number = startLine + selected.length - 1;
    const isTruncated: boolean = actualEndLine < requestedEndLine;

    const numbered: string = formatWithLineNumbers({
      lines: selected,
      startLine: startLine,
    });

    /*
     * Redaction matters more here than for telemetry: a repository's config
     * and fixture files are a likelier home for a live credential than a log
     * line is, and this payload egresses to the LLM provider.
     */
    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      numbered,
      selected.length,
    );

    /*
     * The lines this showed whole: each one selected - unless the serializer
     * cut the block at its own cap, which only a line longer than a result
     * may carry makes it do; then the lines it kept whole. Another read
     * shows the rest, and reads of the same version add up.
     */
    const shownCount: number = serialized.isTruncated
      ? Math.min(selected.length, countWholeLinesKept(serialized.text))
      : selected.length;
    const recordSeen: AIChatRecordSeen | null = seen(
      getCodeFileLinesShown({
        lineCount: allLines.length,
        firstLine: startLine,
        lastLine: startLine + shownCount - 1,
      }),
    );

    const header: string = [
      `file: ${filePath}`,
      `repository: ${repository.organizationName}/${repository.repositoryName}@${branchName}`,
      `showing lines ${startLine}-${actualEndLine} of ${file.totalLines}`,
    ].join("\n");

    const footer: string = isTruncated
      ? `\n… [stopped at line ${actualEndLine}; call again with startLine=${actualEndLine + 1} to read on]`
      : "";

    /*
     * The lines whose values were hidden (issue #6364), said before the
     * model writes anything from them: a commit writes the file whole, and
     * a placeholder written back lands where the value was. Read from the
     * lines it showed whole; the redaction itself is the serializer's,
     * exactly as it was.
     */
    const wholeLinesShown: string = serialized.isTruncated
      ? serialized.text.slice(0, Math.max(0, serialized.text.lastIndexOf("\n")))
      : serialized.text;
    const valuesHidden: string | null = describeValuesHiddenOnRead(
      findLinesWithValuesHidden({
        numberedLines: numbered.split("\n"),
        firstLine: startLine,
        // formatWithLineNumbers' "NNN| ": the last line's number, padded, and "| ".
        prefixLength: String(startLine + selected.length - 1).length + 2,
        shown: wholeLinesShown,
      }),
    );

    return {
      dataForLlm: `${header}\n\n${serialized.text}${footer}${
        valuesHidden ? `\n${valuesHidden}` : ""
      }`,
      rowCount: selected.length,
      citationLabel: `${filePath}:${startLine}-${actualEndLine} (${repository.organizationName}/${repository.repositoryName})`,
      redactionCount: serialized.redactionCount,
      isTruncated: isTruncated || serialized.isTruncated,
      ...(recordSeen ? { recordSeen: recordSeen } : {}),
    };
  },
};
