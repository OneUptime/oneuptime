import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import GitHubUtil, {
  GitHubFileContent,
} from "../../CodeRepository/GitHub/GitHub";
import {
  normalizeCandidatePath,
  RepoResolution,
} from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
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

/*
 * Tools that let the chat agent read the project's linked source code and
 * connect a telemetry signal to the code that produced it.
 *
 * The trust posture here is deliberately narrower than the observability
 * tools': source is read-only, GitHub-App-connected repositories only, and
 * every payload goes through the same secret redaction as telemetry (a repo's
 * config files are a likelier place to find a live credential than a log line
 * is).
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
 * The repositories this user can see, already filtered to the ones that are
 * actually readable. A repository row can exist without a usable GitHub App
 * installation (e.g. imported then uninstalled, or a GitLab row — GitLab has
 * no read path yet), and those must never look readable to the model.
 */
async function findReadableRepositories(
  ctx: ToolContext,
  codeRepositoryId?: ObjectID | undefined,
): Promise<Array<CodeRepository>> {
  const query: JSONObject = {
    projectId: ctx.projectId,
  };

  if (codeRepositoryId) {
    query["_id"] = codeRepositoryId.toString();
  }

  const repositories: Array<CodeRepository> =
    await CodeRepositoryService.findBy({
      query: query as never,
      select: {
        _id: true,
        name: true,
        organizationName: true,
        repositoryName: true,
        mainBranchName: true,
        gitHubAppInstallationId: true,
        repositoryHostedAt: true,
        description: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: ctx.props,
    });

  return repositories.filter((repository: CodeRepository) => {
    return (
      repository.repositoryHostedAt === CodeRepositoryType.GitHub &&
      Boolean(repository.gitHubAppInstallationId)
    );
  });
}

/*
 * Resolve the one repository a tool call should act on. Ambiguity is an error
 * the model can fix (by naming a repositoryId) rather than something to guess
 * at — guessing would silently answer a question about the wrong codebase.
 */
async function resolveTargetRepository(
  ctx: ToolContext,
  args: JSONObject,
): Promise<CodeRepository> {
  const requestedId: ObjectID | undefined = ToolArgs.getObjectID(
    args,
    "repositoryId",
  );

  const repositories: Array<CodeRepository> = await findReadableRepositories(
    ctx,
    requestedId,
  );

  if (repositories.length === 0) {
    if (requestedId) {
      throw new BadDataException(
        `No readable repository with id ${requestedId.toString()} in this project. Call list_code_repositories to see which repositories are connected.`,
      );
    }
    throw new BadDataException(
      "This project has no GitHub-connected code repositories, so source code cannot be read. Connect a repository under Code Repository in the dashboard.",
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
    return await GitHubUtil.getRepositoryTreePaths({
      installationId: repository.gitHubAppInstallationId!,
      organizationName: repository.organizationName!,
      repositoryName: repository.repositoryName!,
      branchName: repository.mainBranchName || "main",
    });
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
    const lineBytes: number =
      Buffer.byteLength(line, "utf8") + prefixWidth + 1;

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
    const repositories: Array<CodeRepository> =
      await findReadableRepositories(ctx);

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

    return {
      dataForLlm:
        rows.length === 0
          ? "(no GitHub-connected code repositories in this project — source code cannot be read)"
          : serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Connected code repositories (${serialized.rowCount})`,
      redactionCount: serialized.redactionCount,
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

    const paths: Array<string> = await GitHubUtil.getRepositoryTreePaths({
      installationId: repository.gitHubAppInstallationId!,
      organizationName: repository.organizationName!,
      repositoryName: repository.repositoryName!,
      branchName: repository.mainBranchName || "main",
    });

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
    "Read the source of one file from a connected repository, with line numbers. Pass startLine/endLine to read the region around a stack-trace line rather than the whole file. Quote only the few lines that matter in your answer.",
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
    const branchName: string = repository.mainBranchName || "main";

    const file: GitHubFileContent | null = await GitHubUtil.getFileContent({
      installationId: repository.gitHubAppInstallationId!,
      organizationName: repository.organizationName!,
      repositoryName: repository.repositoryName!,
      branchName: branchName,
      filePath: filePath,
    });

    if (!file) {
      throw new BadDataException(
        `No readable file at "${filePath}" on branch ${branchName} of ${repository.organizationName}/${repository.repositoryName}. It may not exist, or may be a directory or a binary file. Use search_code to find the exact path.`,
      );
    }

    const allLines: Array<string> = splitIntoLines(file.content);

    if (allLines.length === 0) {
      return {
        dataForLlm: `file: ${filePath}\nrepository: ${repository.organizationName}/${repository.repositoryName}@${branchName}\n\n(this file is empty — 0 bytes)`,
        rowCount: 0,
        citationLabel: `${filePath} (empty)`,
        redactionCount: 0,
        isTruncated: false,
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

    const header: string = [
      `file: ${filePath}`,
      `repository: ${repository.organizationName}/${repository.repositoryName}@${branchName}`,
      `showing lines ${startLine}-${actualEndLine} of ${file.totalLines}`,
    ].join("\n");

    const footer: string = isTruncated
      ? `\n… [stopped at line ${actualEndLine}; call again with startLine=${actualEndLine + 1} to read on]`
      : "";

    return {
      dataForLlm: `${header}\n\n${serialized.text}${footer}`,
      rowCount: selected.length,
      citationLabel: `${filePath}:${startLine}-${actualEndLine} (${repository.organizationName}/${repository.repositoryName})`,
      redactionCount: serialized.redactionCount,
      isTruncated: isTruncated || serialized.isTruncated,
    };
  },
};
