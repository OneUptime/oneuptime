import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import AIRun from "../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIRunService from "../Services/AIRunService";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
} from "../Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import {
  getGitHubConversationNumber,
  getGitHubTaskContext,
  GitHubTaskContext,
} from "../../Types/AI/CodeFixTaskContext";
import GitHubCommandType from "../../Types/CodeRepository/GitHubCommand";
import GitHubConversation, {
  GitHubIssueComment,
  GitHubIssueDetails,
  GitHubPullRequestDetails,
  GitHubPullRequestFile,
  GitHubReviewComment,
} from "../Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubInstallationBinding from "../Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import ToolResultSerializer from "../Utils/AI/Toolbox/Serializer";

/*
 * The agent worker's protocol for GitHub-triggered runs: read the
 * conversation, and post a review back to it.
 *
 * Its shape follows one rule — the worker never names the GitHub object it is
 * acting on. Every route here takes a `taskId` and derives the repository, the
 * installation and the issue-or-pull-request from the RUN's own stored
 * context. A worker that could name them would be a worker that could post a
 * review on any repository the installation can reach, and the whole point of
 * routing GitHub writes through the server is that it cannot.
 *
 * Routes live under /ai-agent-data so the worker has one base path for the
 * whole protocol; they are in their own file because AIAgentDataAPI is already
 * long and this is a self-contained concern.
 */

// Enough of the diff to review, without trying to review a vendored lockfile.
const MAX_PULL_REQUEST_FILES: number = 60;
const MAX_CONVERSATION_COMMENTS: number = 30;
// A review body GitHub will accept and a person will read.
const MAX_REVIEW_BODY_LENGTH: number = 60000;
const MAX_INLINE_REVIEW_COMMENTS: number = 25;

interface AuthorizedGitHubRun {
  run: AIRun;
  github: GitHubTaskContext;
  codeRepository: CodeRepository;
}

export default class AIAgentGitHubAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    /*
     * Everything the worker needs to carry out a GitHub run: the issue or
     * pull request it is about, the thread so far, the diff when it is a pull
     * request, and the repository record it will clone.
     */
    this.router.post(
      "/ai-agent-data/get-github-task-details",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const authorized: AuthorizedGitHubRun | null =
            await AIAgentGitHubAPI.authorizeRun(req, res);

          if (!authorized) {
            return;
          }

          const { github, codeRepository, run } = authorized;

          const isPullRequest: boolean =
            github.pullRequestNumber !== undefined &&
            github.pullRequestNumber !== null;

          const conversationNumber: number =
            getGitHubConversationNumber(github);

          let issue: GitHubIssueDetails | null = null;
          let pullRequest: GitHubPullRequestDetails | null = null;
          let files: Array<GitHubPullRequestFile> = [];

          if (isPullRequest) {
            pullRequest = await GitHubConversation.getPullRequestDetails({
              installationId: github.installationId,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              pullRequestNumber: conversationNumber,
            });

            files = await GitHubConversation.listPullRequestFiles({
              installationId: github.installationId,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              pullRequestNumber: conversationNumber,
              maxFiles: MAX_PULL_REQUEST_FILES,
            });
          } else {
            issue = await GitHubConversation.getIssue({
              installationId: github.installationId,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              issueNumber: conversationNumber,
            });
          }

          const comments: Array<GitHubIssueComment> =
            await GitHubConversation.listIssueComments({
              installationId: github.installationId,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              issueNumber: conversationNumber,
              maxComments: MAX_CONVERSATION_COMMENTS,
            });

          /*
           * The head branch is the one captured at TRIGGER time, and ONLY
           * that one. A force-push or a branch rename between the comment and
           * the claim must not silently move the run onto different work than
           * the person who asked for it approved — and falling back to the
           * live head would do exactly that, as well as handing a fork's
           * unreachable branch name to a worker that cannot check it out.
           *
           * Absent means "work from the base branch", which is what a review
           * of a fork pull request does.
           */
          const headRefName: string | null =
            github.pullRequestHeadRefName || null;

          return Response.sendJsonObjectResponse(req, res, {
            taskType: CodeFixTaskTypeHelper.fromDatabaseValue(
              run.codeFixTaskType,
            ),
            commandType: github.commandType,
            /*
             * UNTRUSTED: written by a GitHub user. The worker embeds it in an
             * agent prompt as a quoted request, never as instructions.
             */
            instruction: AIAgentGitHubAPI.redact(github.instruction),
            triggeredByLogin: github.triggeredByLogin || null,
            repository: {
              id: codeRepository.id?.toString(),
              name: codeRepository.name,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              mainBranchName: codeRepository.mainBranchName,
              setupCommand: codeRepository.setupCommand || null,
              buildCommand: codeRepository.buildCommand || null,
              testCommand: codeRepository.testCommand || null,
            },
            issue: issue
              ? {
                  number: issue.issueNumber,
                  title: AIAgentGitHubAPI.redact(issue.title),
                  body: AIAgentGitHubAPI.redact(issue.body),
                  htmlUrl: issue.htmlUrl,
                  labels: issue.labels,
                  authorLogin: issue.authorLogin,
                }
              : null,
            pullRequest: pullRequest
              ? {
                  number: pullRequest.pullRequestNumber,
                  title: AIAgentGitHubAPI.redact(pullRequest.title),
                  body: AIAgentGitHubAPI.redact(pullRequest.body),
                  htmlUrl: pullRequest.htmlUrl,
                  headRefName: headRefName,
                  isFromFork: Boolean(github.isPullRequestFromFork),
                  headSha: pullRequest.headSha,
                  baseRefName: pullRequest.baseRefName,
                  authorLogin: pullRequest.authorLogin,
                  changedFilesCount: pullRequest.changedFilesCount,
                  additions: pullRequest.additions,
                  deletions: pullRequest.deletions,
                }
              : null,
            files: files.map((file: GitHubPullRequestFile) => {
              return {
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                patch: file.patch ? AIAgentGitHubAPI.redact(file.patch) : null,
              };
            }),
            filesTruncated: files.length >= MAX_PULL_REQUEST_FILES,
            comments: comments.map((comment: GitHubIssueComment) => {
              return {
                authorLogin: comment.authorLogin,
                isBot: comment.isBot,
                body: AIAgentGitHubAPI.redact(comment.body),
                createdAt: comment.createdAt,
              };
            }),
          } as JSONObject);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Post the agent's review on the run's OWN pull request.
     *
     * The server picks the repository and the pull request number from the
     * run; the worker supplies only words. That is the trust boundary: a
     * compromised or buggy worker can post a bad review on the pull request it
     * was already given, and nothing else.
     */
    this.router.post(
      "/ai-agent-data/post-github-review",
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const authorized: AuthorizedGitHubRun | null =
            await AIAgentGitHubAPI.authorizeRun(req, res);

          if (!authorized) {
            return;
          }

          const { github, run } = authorized;

          if (
            run.codeFixTaskType !== CodeFixTaskType.GitHubPullRequestReview ||
            github.commandType !== GitHubCommandType.Review ||
            github.pullRequestNumber === undefined
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This task is not a pull request review, so it cannot post one.",
              ),
            );
          }

          const body: string = (
            (req.body as JSONObject)["body"] as string
          )?.toString();

          if (!body || !body.trim()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("body is required"),
            );
          }

          const comments: Array<GitHubReviewComment> =
            AIAgentGitHubAPI.parseReviewComments(
              (req.body as JSONObject)["comments"],
            );

          const reviewUrl: string =
            await GitHubConversation.createPullRequestReview({
              installationId: github.installationId,
              organizationName: github.organizationName,
              repositoryName: github.repositoryName,
              pullRequestNumber: github.pullRequestNumber,
              body: body.substring(0, MAX_REVIEW_BODY_LENGTH),
              comments: comments,
            });

          logger.info(
            `Posted an AI review on ${github.organizationName}/${github.repositoryName}#${github.pullRequestNumber} for run ${run.id?.toString()}.`,
          );

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            reviewUrl: reviewUrl,
            inlineCommentsRequested: comments.length,
          } as JSONObject);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Scrub secrets out of text that came from GitHub before it leaves this
   * endpoint.
   *
   * Every string served here — an issue body, a pull request description, a
   * comment, a diff hunk, the commenter's own instruction — is written by
   * someone who is not necessarily a collaborator, and all of it ends up in an
   * LLM prompt and, for some recipes, in a pull request body. People paste
   * tokens into issues to report bugs. AIAgentDataAPI already runs the same
   * scrubber over investigation markdown for exactly this reason; a GitHub
   * conversation is a strictly less trusted source than that.
   *
   * This is a secret filter, not a prompt-injection defence. Injection is
   * handled where it has to be — the prompts label this text as a REQUEST
   * rather than instructions, and the workspace/command guards bound what the
   * agent can do with it whatever it reads.
   */
  private static redact(text: string | null | undefined): string {
    if (!text) {
      return "";
    }

    return ToolResultSerializer.redact(text).text;
  }

  /*
   * Inline review anchors, cleaned up.
   *
   * Anything malformed is DROPPED rather than rejected: one bad anchor out of
   * twenty must not cost the whole review, and GitHubConversation already
   * falls back to a body-only review if GitHub refuses the rest.
   */
  private static parseReviewComments(raw: unknown): Array<GitHubReviewComment> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const comments: Array<GitHubReviewComment> = [];

    for (const entry of raw) {
      const candidate: JSONObject = entry as JSONObject;
      const path: unknown = candidate?.["path"];
      const line: unknown = candidate?.["line"];
      const body: unknown = candidate?.["body"];

      if (
        typeof path !== "string" ||
        !path.trim() ||
        typeof line !== "number" ||
        !Number.isInteger(line) ||
        line <= 0 ||
        typeof body !== "string" ||
        !body.trim()
      ) {
        continue;
      }

      comments.push({ path: path, line: line, body: body });

      if (comments.length >= MAX_INLINE_REVIEW_COMMENTS) {
        break;
      }
    }

    return comments;
  }

  /*
   * Resolve `taskId` into a GitHub run this agent is allowed to act on, or
   * answer the request and return null.
   *
   * Four things are checked, in the order that leaks the least: the agent's
   * credentials, that the run is in the agent's project, that it really is a
   * GitHub run with a complete context, and — last and most important — that
   * the installation named in that context is still bound to the project.
   *
   * That last check is not redundant with the trigger's. A run can sit queued
   * for a while, and an installation can be uninstalled or moved in the
   * meantime; minting a token for it then would be acting on a binding that no
   * longer exists. Same rule the repository-token endpoint applies.
   */
  private static async authorizeRun(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<AuthorizedGitHubRun | null> {
    const data: JSONObject = req.body;

    const aiAgent: CodeFixAgentIdentity | null =
      await CodeFixAgentAuth.resolveAgentIdentity(data);

    if (!aiAgent) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid AI Agent ID or AI Agent Key"),
      );
      return null;
    }

    if (!data["taskId"]) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException("taskId is required"),
      );
      return null;
    }

    const taskId: ObjectID = new ObjectID(data["taskId"] as string);

    const run: AIRun | null = await AIRunService.findOneById({
      id: taskId,
      select: {
        _id: true,
        projectId: true,
        runType: true,
        codeFixTaskType: true,
        taskContext: true,
      },
      props: { isRoot: true },
    });

    /*
     * A denial answers exactly like a missing run, so a probing key cannot
     * tell "another tenant's run" from "no such run".
     */
    if (
      !run ||
      !run.projectId ||
      CodeFixAgentAuth.deniesAccessToProject(aiAgent, run.projectId)
    ) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Task not found"),
      );
      return null;
    }

    const github: GitHubTaskContext | null = getGitHubTaskContext(
      run.taskContext,
    );

    if (
      !github ||
      !run.codeFixTaskType ||
      !CodeFixTaskTypeHelper.isGitHubTaskType(run.codeFixTaskType)
    ) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException("This task is not a GitHub task."),
      );
      return null;
    }

    const codeRepository: CodeRepository | null =
      await CodeRepositoryService.findOneById({
        id: new ObjectID(github.codeRepositoryId),
        select: {
          _id: true,
          name: true,
          projectId: true,
          organizationName: true,
          repositoryName: true,
          mainBranchName: true,
          setupCommand: true,
          buildCommand: true,
          testCommand: true,
          gitHubAppInstallationId: true,
        },
        props: { isRoot: true },
      });

    if (
      !codeRepository ||
      !codeRepository.projectId ||
      codeRepository.projectId.toString() !== run.projectId.toString()
    ) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "The repository for this task is no longer connected.",
        ),
      );
      return null;
    }

    const isBound: boolean =
      await GitHubInstallationBinding.isInstallationBoundToProject({
        projectId: codeRepository.projectId,
        installationId: github.installationId,
      });

    if (!isBound) {
      logger.error(
        `Refusing GitHub task data for run ${run.id?.toString()}: installation ${github.installationId} is not bound to project ${codeRepository.projectId.toString()}.`,
      );

      Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "This repository's GitHub App installation is no longer connected to its project. Please reconnect the GitHub App from Project Settings.",
        ),
      );
      return null;
    }

    return { run: run, github: github, codeRepository: codeRepository };
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }
}
