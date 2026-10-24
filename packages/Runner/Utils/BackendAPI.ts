import { ONEUPTIME_BASE_URL } from "../Config";
import RunnerAPIRequest from "./RunnerAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import {
  ImplicatedSpan,
  PerformanceFinding,
} from "Common/Types/AI/CodeFixTaskContext";
import { CodeTaskAgentDetails } from "Common/Types/AI/CodeTask";
import {
  CodeHost,
  CodeHostRunnerInfo,
  RUNNER_SUPPORTED_CODE_HOSTS_FIELD,
} from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "Common/Server/Utils/LLM/LLMService";
import logger from "Common/Server/Utils/Logger";

// API Response types
interface ExceptionResponse {
  id: string;
  message: string;
  stackTrace: string;
  exceptionType: string;
  fingerprint: string;
  aiClassification?: string | null;
  // The exception's page in OneUptime (servers from the Exceptions AI on).
  url?: string | null;
}

// Why the task was started, when a finding started it (see ExceptionDetails).
interface ExceptionStartedByResponse {
  finding?: string | null;
  findingUrl?: string | null;
  isStartedByOneUptime?: boolean | null;
}

interface ServiceResponse {
  id: string;
  name: string;
  description: string;
}

interface ExceptionDetailsResponse {
  exception: ExceptionResponse;
  service: ServiceResponse | null;
  startedBy?: ExceptionStartedByResponse | null;
  message?: string;
}

interface CodeRepositoryResponse {
  id: string;
  name: string;
  repositoryHostedAt: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  setupCommand?: string | null;
  buildCommand?: string | null;
  testCommand?: string | null;
  servicePathInRepository: string | null;
  gitHubAppInstallationId: string | null;
}

interface CodeRepositoriesResponse {
  repositories: Array<CodeRepositoryResponse>;
  message?: string;
}

interface SubjectTaskDetailsResponse {
  subjectType: "incident" | "alert" | "trace" | "service";
  subjectTitle: string;
  analysisMarkdown: string;
  serviceName: string | null;
  projectId: string;
  repositories: Array<CodeRepositoryResponse>;
  resolutionError?: string;
  message?: string;
  // Trace-evidence recipes (FixPerformance) only.
  traceId?: string;
  findings?: Array<PerformanceFinding>;
  spanSummaries?: Array<ImplicatedSpan>;
}

interface RepositoryTokenResponse {
  token: string;
  expiresAt: string;
  repositoryUrl: string;
  organizationName: string;
  repositoryName: string;
  // For a repository that is not on GitHub: where and how to use the token.
  codeHost?: CodeHostRunnerInfo;
  message?: string;
}

/*
 * The hosts this Runner works in, sent with every token request: a server
 * hands a GitLab, Forgejo, Gitea or Git repository's token only to a Runner
 * that says it can use it (Types/CodeRepository/CodeHost).
 */
export const SUPPORTED_CODE_HOSTS: Array<CodeRepositoryType> = [
  CodeRepositoryType.GitHub,
  CodeRepositoryType.GitLab,
  CodeRepositoryType.Forgejo,
  CodeRepositoryType.Git,
];

interface RecordPullRequestResponse {
  success: boolean;
  pullRequestId: string;
  message?: string;
}

interface UpdateTaskStatusResponse {
  success?: boolean;
  message?: string;
}

// Exported types
export interface ExceptionDetails {
  exception: {
    id: string;
    message: string;
    stackTrace: string;
    exceptionType: string;
    fingerprint: string;
    /*
     * AI triage verdict for the exception's group (code-fault, user-error,
     * expected-denial, infrastructure, unknown) — null when the group has
     * not been triaged. Recipes use it to tune their prompt.
     */
    aiClassification?: string | null;
    // The exception's page in OneUptime, for the pull request to link.
    url?: string | null;
  };
  service: {
    id: string;
    name: string;
    description: string;
  } | null;
  /*
   * Why the task was started, when a finding started it - a new or rising
   * exception OneUptime found (Exceptions → AI): the finding's title, its
   * page, and whether OneUptime started it on its own. Null for a task a
   * person started on the exception's page, and from older servers.
   */
  startedBy?: ExceptionStartedBy | null;
}

export interface ExceptionStartedBy {
  finding: string;
  findingUrl: string;
  isStartedByOneUptime: boolean;
}

export interface CodeRepositoryInfo {
  id: string;
  name: string;
  repositoryHostedAt: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  /*
   * Operator-configured verification commands (run at the repository root
   * by the build/test verification loop before a fix PR opens). Null when
   * not configured — verification is skipped.
   */
  setupCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  servicePathInRepository: string | null;
  gitHubAppInstallationId: string | null;
}

/*
 * Context for a non-exception task, keyed by the run id. For the
 * incident/alert-subject recipes (ImproveInstrumentation, FixFromIncident)
 * analysisMarkdown is the investigation's posted analysis; for the
 * trace-evidence recipe (FixPerformance, subjectType "trace") it is the
 * server-rendered deterministic span-tree evidence, with the structured
 * findings alongside. Either way the server resolved the repository
 * (FixPerformance additionally tries span code.* attributes as a synthetic
 * stack trace before the name-match / only-repository fallbacks).
 */
export interface SubjectTaskDetails {
  subjectType: "incident" | "alert" | "trace" | "service";
  subjectTitle: string;
  analysisMarkdown: string;
  serviceName: string | null;
  repositories: Array<CodeRepositoryInfo>;
  // Set when repositories is empty: why nothing resolved + what to do.
  resolutionError: string | null;
  // Trace-evidence recipes (FixPerformance) only.
  traceId: string | null;
  performanceFindings: Array<PerformanceFinding>;
  spanSummaries: Array<ImplicatedSpan>;
}

export interface RepositoryToken {
  token: string;
  expiresAt: Date;
  repositoryUrl: string;
  organizationName: string;
  repositoryName: string;
  /*
   * For a repository that is not on GitHub - GitLab, Forgejo, Gitea, a Git
   * server - where its server is, the username Git signs in with, and where
   * its API opens pull and merge requests. Absent for GitHub.
   */
  codeHost?: CodeHostRunnerInfo | undefined;
}

export interface RecordPullRequestOptions {
  taskId: string;
  codeRepositoryId: string;
  pullRequestUrl: string;
  pullRequestNumber?: number;
  pullRequestId?: number;
  title: string;
  description?: string;
  headRefName?: string;
  baseRefName?: string;
  // Outcome of the pre-PR build/test verification loop (Passed/Failed/Skipped).
  runnerVerificationStatus?: string;
  runnerVerificationSummary?: string;
}

export interface RecordPullRequestResult {
  success: boolean;
  pullRequestId: string;
}

/*
 * A pull request the task opened but could not record, as a Completed status
 * report carries it to the server: the record it failed to make, without the
 * task (the report names it). See BaseTaskHandler.recordOpenedPullRequest.
 */
export type UnrecordedPullRequest = Omit<RecordPullRequestOptions, "taskId">;

/*
 * A record is retried when the request never got an answer, or got one that
 * says the server broke rather than the request — a deploy, a dropped
 * connection, a database that hiccuped. The server records a pull request
 * once, so a retry of a record that did land is answered with that row.
 */
const RECORD_PULL_REQUEST_RETRIES: number = 3;

/*
 * Server-mediated LLM completion (B4 Tier 0): the in-house code agent's
 * tool loop calls POST /api/ai-agent-data/llm-completion per turn. The
 * server validates the run (claimed, Running, owned by this agent),
 * resolves the provider, meters the call, and enforces the per-run loop
 * budgets — the worker never holds a provider secret.
 */
export interface LlmCompletionBudget {
  /*
   * The run's calls so far: its LLM completions and, from servers that serve
   * production telemetry, its telemetry tool calls, which share
   * maxCompletionCalls.
   */
  completionCallsUsed: number;
  maxCompletionCalls: number;
  outputTokensUsed: number;
  maxOutputTokens: number;
  // Of completionCallsUsed, the production telemetry tool calls.
  toolCallsUsed?: number | undefined;
  maxToolCalls?: number | undefined;
}

/*
 * Production telemetry: the code agent's read-only queries of the traces,
 * logs, metrics, exceptions, incidents and deploys of the services its
 * repository serves. The server executes every call and decides what the
 * run may read; the worker names only the run.
 */
export interface TelemetryToolService {
  id: string;
  name: string;
  // Where its code is in the repository, when OneUptime can tell.
  pathInRepository: string | null;
}

export interface TelemetryTools {
  // Empty when the run is offered none (reason says why).
  tools: Array<LLMToolDefinition>;
  repository: string | null;
  services: Array<TelemetryToolService>;
  reason: string | null;
  budget: LlmCompletionBudget | null;
}

export interface TelemetryToolCallResult {
  output: string;
  rowCount: number;
  citationLabel: string;
  isTruncated: boolean;
  // After the call.
  budget: LlmCompletionBudget | null;
}

export interface LlmCompletionResult {
  content: string;
  toolCalls: Array<LLMToolCall>;
  stopReason: "stop" | "tool_use";
  budget: LlmCompletionBudget;
}

/*
 * Success bodies carry `message` as the assistant-message OBJECT; error
 * bodies carry `message` as the error STRING — the union below captures
 * both, and llmCompletion() discriminates on response.isSuccess().
 */
interface LlmCompletionResponse {
  message?:
    | {
        role: string;
        content: string;
        toolCalls?: Array<LLMToolCall>;
      }
    | string;
  stopReason?: "stop" | "tool_use";
  budget?: LlmCompletionBudget;
}

/*
 * ---------------------------------------------------------------------------
 * GitHub-triggered runs.
 *
 * The worker never names the repository, installation or issue it is acting
 * on: every request below carries only `taskId`, and the server derives the
 * rest from the run's own stored context. Keep it that way — a worker that
 * could name a GitHub object could post into any repository the installation
 * can reach.
 * ---------------------------------------------------------------------------
 */

export interface GitHubTaskRepository {
  id: string;
  name: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  setupCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
}

export interface GitHubTaskIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  labels: Array<string>;
  authorLogin: string;
}

export interface GitHubTaskPullRequest {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  /*
   * The branch pinned at trigger time, or null when there is none to work on
   * locally — a fork's branch is not in the repository this installation can
   * reach, so a fork review runs against the BASE branch plus the diff.
   */
  headRefName: string | null;
  isFromFork: boolean;
  headSha: string;
  baseRefName: string;
  authorLogin: string;
  changedFilesCount: number;
  additions: number;
  deletions: number;
}

export interface GitHubTaskFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitHubTaskComment {
  authorLogin: string;
  isBot: boolean;
  body: string;
  createdAt: string;
}

export interface GitHubTaskDetails {
  taskType: string;
  commandType: string;
  /*
   * UNTRUSTED. Written by a GitHub user, and quoted into an agent prompt as a
   * request — never as instructions that widen what the run may do.
   */
  instruction: string;
  triggeredByLogin: string | null;
  repository: GitHubTaskRepository;
  issue: GitHubTaskIssue | null;
  pullRequest: GitHubTaskPullRequest | null;
  files: Array<GitHubTaskFile>;
  filesTruncated: boolean;
  comments: Array<GitHubTaskComment>;
}

export interface GitHubReviewCommentInput {
  path: string;
  line: number;
  body: string;
}

export interface PostGitHubReviewResult {
  reviewUrl: string;
  inlineCommentsRequested: number;
}

export default class BackendAPI {
  private baseUrl: URL;

  public constructor() {
    this.baseUrl = URL.fromString(ONEUPTIME_BASE_URL.toString());
  }

  /*
   * Get exception details with telemetry service info - and, for the task
   * this Runner claimed (taskId), why it was started, for its pull request
   * to say.
   */
  public async getExceptionDetails(
    exceptionId: string,
    taskId?: string | undefined,
  ): Promise<ExceptionDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-exception-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
        ...(taskId ? { taskId } : {}),
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const data: ExceptionDetailsResponse =
        response.data as unknown as ExceptionDetailsResponse;
      const errorMessage: string =
        data?.message || "Failed to get exception details";
      throw new Error(errorMessage);
    }

    const data: ExceptionDetailsResponse =
      response.data as unknown as ExceptionDetailsResponse;

    logger.debug(
      `Got exception details for ${exceptionId}: ${data.exception.message.substring(0, 100)}`,
    );

    return {
      exception: {
        id: data.exception.id,
        message: data.exception.message,
        stackTrace: data.exception.stackTrace,
        exceptionType: data.exception.exceptionType,
        fingerprint: data.exception.fingerprint,
        aiClassification: data.exception.aiClassification || null,
        url: data.exception.url || null,
      },
      service: data.service
        ? {
            id: data.service.id,
            name: data.service.name,
            description: data.service.description,
          }
        : null,
      startedBy: BackendAPI.readExceptionStartedBy(data.startedBy),
    };
  }

  // Why the task was started, when the answer says so in full.
  public static readExceptionStartedBy(
    value: ExceptionStartedByResponse | null | undefined,
  ): ExceptionStartedBy | null {
    if (
      !value ||
      typeof value.finding !== "string" ||
      typeof value.findingUrl !== "string" ||
      !value.findingUrl
    ) {
      return null;
    }

    return {
      finding: value.finding,
      findingUrl: value.findingUrl,
      isStartedByOneUptime: value.isStartedByOneUptime === true,
    };
  }

  /*
   * Resolve the repository for an exception — the server matches the
   * exception's stack-trace files against the project's connected repos at
   * runtime (with name-match / only-repository fallbacks).
   */
  public async getCodeRepositories(
    exceptionId: string,
  ): Promise<Array<CodeRepositoryInfo>> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-code-repositories",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        exceptionId: exceptionId,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const data: CodeRepositoriesResponse =
        response.data as unknown as CodeRepositoriesResponse;
      const errorMessage: string =
        data?.message || "Failed to get code repositories";
      throw new Error(errorMessage);
    }

    const data: CodeRepositoriesResponse =
      response.data as unknown as CodeRepositoriesResponse;

    logger.debug(
      `Resolved ${data.repositories.length} code repository(ies) for exception ${exceptionId}`,
    );

    return data.repositories.map((repo: CodeRepositoryResponse) => {
      return {
        id: repo.id,
        name: repo.name,
        repositoryHostedAt: repo.repositoryHostedAt,
        organizationName: repo.organizationName,
        repositoryName: repo.repositoryName,
        mainBranchName: repo.mainBranchName,
        setupCommand: repo.setupCommand || null,
        buildCommand: repo.buildCommand || null,
        testCommand: repo.testCommand || null,
        servicePathInRepository: repo.servicePathInRepository,
        gitHubAppInstallationId: repo.gitHubAppInstallationId,
      };
    });
  }

  /*
   * Context for an incident/alert-subject run (ImproveInstrumentation,
   * FixFromIncident) — `taskId` is the AIRun id from get-pending-task
   * (these runs carry no exceptionId). The wire route predates
   * FixFromIncident and kept its historical name.
   */
  public async getSubjectTaskDetails(
    taskId: string,
  ): Promise<SubjectTaskDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-instrumentation-task-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const data: SubjectTaskDetailsResponse =
        response.data as unknown as SubjectTaskDetailsResponse;
      const errorMessage: string =
        data?.message || "Failed to get task details";
      throw new Error(errorMessage);
    }

    const data: SubjectTaskDetailsResponse =
      response.data as unknown as SubjectTaskDetailsResponse;

    logger.debug(
      `Got subject task details for ${taskId}: ${data.subjectType} "${data.subjectTitle}" (${data.repositories.length} repository(ies))`,
    );

    return {
      subjectType: data.subjectType,
      subjectTitle: data.subjectTitle,
      analysisMarkdown: data.analysisMarkdown,
      serviceName: data.serviceName || null,
      repositories: (data.repositories || []).map(
        (repo: CodeRepositoryResponse) => {
          return {
            id: repo.id,
            name: repo.name,
            repositoryHostedAt: repo.repositoryHostedAt,
            organizationName: repo.organizationName,
            repositoryName: repo.repositoryName,
            mainBranchName: repo.mainBranchName,
            setupCommand: repo.setupCommand || null,
            buildCommand: repo.buildCommand || null,
            testCommand: repo.testCommand || null,
            servicePathInRepository: repo.servicePathInRepository,
            gitHubAppInstallationId: repo.gitHubAppInstallationId,
          };
        },
      ),
      resolutionError: data.resolutionError || null,
      traceId: data.traceId || null,
      performanceFindings: data.findings || [],
      spanSummaries: data.spanSummaries || [],
    };
  }

  // Get access token for a code repository
  public async getRepositoryToken(
    codeRepositoryId: string,
    /*
     * The run this token is for. Optional only for compatibility with older
     * callers; pass it. The server uses it to decide whether the
     * per-repository open-PR cap applies — a run that revises or reviews an
     * EXISTING pull request adds nothing to the review queue and so is exempt,
     * and without a task id it is treated as one that does.
     *
     * It is a task id, not a claim: the server re-derives the recipe from the
     * run and ignores anything it cannot verify belongs to this agent.
     */
    taskId?: string | undefined,
  ): Promise<RepositoryToken> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-repository-token",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        codeRepositoryId: codeRepositoryId,
        ...(taskId ? { taskId: taskId } : {}),
        [RUNNER_SUPPORTED_CODE_HOSTS_FIELD]: SUPPORTED_CODE_HOSTS,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const data: RepositoryTokenResponse =
        response.data as unknown as RepositoryTokenResponse;
      const errorMessage: string =
        data?.message || "Failed to get repository token";
      throw new Error(errorMessage);
    }

    const data: RepositoryTokenResponse =
      response.data as unknown as RepositoryTokenResponse;

    logger.debug(
      `Got access token for repository ${data.organizationName}/${data.repositoryName}`,
    );

    const codeHost: CodeHostRunnerInfo | null = BackendAPI.readCodeHost(
      data.codeHost,
    );

    return {
      token: data.token,
      expiresAt: new Date(data.expiresAt),
      repositoryUrl: data.repositoryUrl,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
      ...(codeHost ? { codeHost } : {}),
    };
  }

  /*
   * The codeHost a token came with, checked field by field - or null for a
   * GitHub repository's token, or one this Runner cannot read.
   */
  public static readCodeHost(raw: unknown): CodeHostRunnerInfo | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const value: JSONObject = raw as JSONObject;

    if (
      !CodeHost.isKnownType(value["type"]) ||
      value["type"] === CodeRepositoryType.GitHub ||
      typeof value["hostUrl"] !== "string" ||
      !value["hostUrl"]
    ) {
      return null;
    }

    const readText: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const text: unknown = value[key];

      return typeof text === "string" && text ? text : null;
    };

    return {
      type: value["type"] as CodeRepositoryType,
      hostUrl: value["hostUrl"] as string,
      apiUrl: readText("apiUrl"),
      webUrl: readText("webUrl"),
      username: readText("username") || "oauth2",
      projectId: readText("projectId"),
      hasPullRequests: value["hasPullRequests"] === true,
      // Only a server that says so lets a global Runner reach a private network.
      isPrivateNetworkAllowed: value["isPrivateNetworkAllowed"] === true,
    };
  }

  // Record a pull request created by the AI Agent
  public async recordPullRequest(
    options: RecordPullRequestOptions,
  ): Promise<RecordPullRequestResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/record-pull-request",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: options.taskId,
        codeRepositoryId: options.codeRepositoryId,
        pullRequestUrl: options.pullRequestUrl,
        pullRequestNumber: options.pullRequestNumber,
        pullRequestId: options.pullRequestId,
        title: options.title,
        description: options.description,
        headRefName: options.headRefName,
        baseRefName: options.baseRefName,
        runnerVerificationStatus: options.runnerVerificationStatus,
        runnerVerificationSummary: options.runnerVerificationSummary,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions({
        retries: RECORD_PULL_REQUEST_RETRIES,
        exponentialBackoff: true,
        retryOnlyOnRetryableErrors: true,
      }),
    });

    if (!response.isSuccess()) {
      const data: RecordPullRequestResponse =
        response.data as unknown as RecordPullRequestResponse;
      const errorMessage: string =
        data?.message || "Failed to record pull request";
      throw new Error(errorMessage);
    }

    const data: RecordPullRequestResponse =
      response.data as unknown as RecordPullRequestResponse;

    logger.debug(`Recorded pull request: ${options.pullRequestUrl}`);

    return {
      success: data.success,
      pullRequestId: data.pullRequestId,
    };
  }

  /*
   * One server-mediated LLM completion for a claimed code-fix run (B4 Tier
   * 0). `taskId` is the AIRun id from get-pending-task. Over-budget and
   * guard failures come back as 4xx with a clear message, thrown here as an
   * Error the tool loop turns into an honest run failure.
   */
  public async llmCompletion(data: {
    taskId: string;
    messages: Array<LLMMessage>;
    tools?: Array<LLMToolDefinition> | undefined;
    maxTokens?: number | undefined;
  }): Promise<LlmCompletionResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/llm-completion",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: data.taskId,
        messages: data.messages as unknown as JSONObject[],
        ...(data.tools ? { tools: data.tools as unknown as JSONObject[] } : {}),
        ...(data.maxTokens ? { maxTokens: data.maxTokens } : {}),
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    const responseData: LlmCompletionResponse =
      response.data as unknown as LlmCompletionResponse;

    if (!response.isSuccess()) {
      const errorMessage: string =
        typeof responseData?.message === "string"
          ? responseData.message
          : "LLM completion request failed";
      throw new Error(errorMessage);
    }

    const message: { content: string; toolCalls?: Array<LLMToolCall> } =
      typeof responseData.message === "object" && responseData.message !== null
        ? responseData.message
        : { content: "" };

    const toolCalls: Array<LLMToolCall> = message.toolCalls || [];

    return {
      content: message.content || "",
      toolCalls,
      stopReason:
        responseData.stopReason || (toolCalls.length > 0 ? "tool_use" : "stop"),
      budget: responseData.budget || {
        completionCallsUsed: 0,
        maxCompletionCalls: Number.MAX_SAFE_INTEGER,
        outputTokensUsed: 0,
        maxOutputTokens: Number.MAX_SAFE_INTEGER,
      },
    };
  }

  /*
   * The production telemetry tools the server offers this run, with the
   * repository and services they read - or none, and why. Throws when the
   * server cannot say (an older server has no such route), which the agent
   * reads as none.
   */
  public async getTelemetryTools(taskId: string): Promise<TelemetryTools> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-telemetry-tools",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      throw new Error(
        (response.data as JSONObject)?.["message"]?.toString() ||
          "Failed to get the production telemetry tools",
      );
    }

    const data: JSONObject = response.data || {};

    return {
      tools: BackendAPI.readToolDefinitions(data["tools"]),
      repository:
        typeof data["repository"] === "string" ? data["repository"] : null,
      services: BackendAPI.readTelemetryServices(data["services"]),
      reason: typeof data["reason"] === "string" ? data["reason"] : null,
      budget: BackendAPI.readBudget(data["budget"]),
    };
  }

  /*
   * One production telemetry tool call, executed by the server. A refusal
   * (the arguments, the run's scope, its budget) is thrown as an Error whose
   * message the agent hands the model.
   */
  public async runTelemetryTool(data: {
    taskId: string;
    toolName: string;
    arguments: JSONObject;
  }): Promise<TelemetryToolCallResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/run-telemetry-tool",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: data.taskId,
        toolName: data.toolName,
        arguments: data.arguments,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      throw new Error(
        (response.data as JSONObject)?.["message"]?.toString() ||
          `The production telemetry tool ${data.toolName} failed`,
      );
    }

    const result: JSONObject = response.data || {};

    return {
      output: typeof result["output"] === "string" ? result["output"] : "",
      rowCount: typeof result["rowCount"] === "number" ? result["rowCount"] : 0,
      citationLabel:
        typeof result["citationLabel"] === "string"
          ? result["citationLabel"]
          : data.toolName,
      isTruncated: Boolean(result["isTruncated"]),
      budget: BackendAPI.readBudget(result["budget"]),
    };
  }

  // Tool definitions as the server sent them, malformed ones left out.
  private static readToolDefinitions(raw: unknown): Array<LLMToolDefinition> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const tools: Array<LLMToolDefinition> = [];

    for (const entry of raw) {
      const tool: JSONObject = (entry || {}) as JSONObject;

      if (
        typeof tool["name"] === "string" &&
        tool["name"] &&
        typeof tool["description"] === "string" &&
        tool["inputSchema"] &&
        typeof tool["inputSchema"] === "object" &&
        !Array.isArray(tool["inputSchema"])
      ) {
        tools.push({
          name: tool["name"],
          description: tool["description"],
          inputSchema: tool["inputSchema"] as JSONObject,
        });
      }
    }

    return tools;
  }

  private static readTelemetryServices(
    raw: unknown,
  ): Array<TelemetryToolService> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const services: Array<TelemetryToolService> = [];

    for (const entry of raw) {
      const service: JSONObject = (entry || {}) as JSONObject;

      if (typeof service["id"] === "string" && service["id"]) {
        services.push({
          id: service["id"],
          name: typeof service["name"] === "string" ? service["name"] : "",
          pathInRepository:
            typeof service["pathInRepository"] === "string"
              ? service["pathInRepository"]
              : null,
        });
      }
    }

    return services;
  }

  private static readBudget(raw: unknown): LlmCompletionBudget | null {
    const budget: JSONObject = (raw || {}) as JSONObject;

    if (
      typeof budget["completionCallsUsed"] !== "number" ||
      typeof budget["maxCompletionCalls"] !== "number"
    ) {
      return null;
    }

    return {
      completionCallsUsed: budget["completionCallsUsed"],
      maxCompletionCalls: budget["maxCompletionCalls"],
      outputTokensUsed:
        typeof budget["outputTokensUsed"] === "number"
          ? budget["outputTokensUsed"]
          : 0,
      maxOutputTokens:
        typeof budget["maxOutputTokens"] === "number"
          ? budget["maxOutputTokens"]
          : Number.MAX_SAFE_INTEGER,
      toolCallsUsed:
        typeof budget["toolCallsUsed"] === "number"
          ? budget["toolCallsUsed"]
          : undefined,
      maxToolCalls:
        typeof budget["maxToolCalls"] === "number"
          ? budget["maxToolCalls"]
          : undefined,
    };
  }

  // Update task status (wrapper around existing endpoint)
  public async updateTaskStatus(
    taskId: string,
    status: AIAgentTaskStatus,
    statusMessage?: string,
  ): Promise<void> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-task/update-task-status",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
        status: status,
        statusMessage: statusMessage,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const data: UpdateTaskStatusResponse =
        response.data as unknown as UpdateTaskStatusResponse;
      const errorMessage: string =
        data?.message || "Failed to update task status";
      throw new Error(errorMessage);
    }

    logger.debug(`Updated task ${taskId} status to ${status}`);
  }

  /*
   * Everything a GitHub-triggered run needs: the issue or pull request it is
   * about, the thread so far, and (for a pull request) its diff.
   */
  public async getGitHubTaskDetails(
    taskId: string,
  ): Promise<GitHubTaskDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-github-task-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get GitHub task details";
      throw new Error(errorMessage);
    }

    const data: GitHubTaskDetails =
      response.data as unknown as GitHubTaskDetails;

    logger.debug(
      `Got GitHub task details for ${taskId}: ${data.commandType} on ${data.repository?.organizationName}/${data.repository?.repositoryName}`,
    );

    return {
      taskType: data.taskType,
      commandType: data.commandType,
      instruction: data.instruction || "",
      triggeredByLogin: data.triggeredByLogin || null,
      repository: data.repository,
      issue: data.issue || null,
      pullRequest: data.pullRequest || null,
      files: data.files || [],
      filesTruncated: Boolean(data.filesTruncated),
      comments: data.comments || [],
    };
  }

  /*
   * Everything a request from Code needs for one turn: the repository, the
   * branch to work on, what is asked now and the conversation before it.
   * As for GitHub runs, only the run is named; the server derives the rest.
   */
  public async getCodeTaskDetails(
    taskId: string,
  ): Promise<CodeTaskAgentDetails> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/get-code-task-details",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: taskId,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to get the request's details";
      throw new Error(errorMessage);
    }

    const data: CodeTaskAgentDetails =
      response.data as unknown as CodeTaskAgentDetails;

    if (!data.repository || !data.request) {
      throw new Error(
        "The server sent no repository or request for this task.",
      );
    }

    return {
      ...data,
      workingBranch: data.workingBranch || null,
      pullRequest: data.pullRequest || null,
      conversation: data.conversation || [],
      omittedTurns: data.omittedTurns || 0,
      request: {
        message: data.request.message || "",
        context: data.request.context || [],
      },
    };
  }

  /*
   * Post the agent's review on the run's own pull request. The server decides
   * WHERE it lands; this call only supplies the words.
   */
  public async postGitHubReview(data: {
    taskId: string;
    body: string;
    comments: Array<GitHubReviewCommentInput>;
  }): Promise<PostGitHubReviewResult> {
    const url: URL = URL.fromURL(this.baseUrl).addRoute(
      "/api/ai-agent-data/post-github-review",
    );

    const response: HTTPResponse<JSONObject> = await API.post({
      url,
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: data.taskId,
        body: data.body,
        /*
         * Widened to plain JSON: the API helper's JSONObject rejects an array
         * of a named interface, and the server validates every anchor field
         * itself before it goes anywhere near GitHub.
         */
        comments: data.comments as unknown as JSONArray,
      },
      options: RunnerAPIRequest.getDefaultRequestOptions(),
    });

    if (!response.isSuccess()) {
      const errorMessage: string =
        (response.data as JSONObject)?.["message"]?.toString() ||
        "Failed to post the GitHub review";
      throw new Error(errorMessage);
    }

    const result: JSONObject = response.data;

    logger.debug(`Posted a GitHub review for task ${data.taskId}`);

    return {
      reviewUrl: (result["reviewUrl"] as string) || "",
      inlineCommentsRequested:
        (result["inlineCommentsRequested"] as number) || 0,
    };
  }
}
