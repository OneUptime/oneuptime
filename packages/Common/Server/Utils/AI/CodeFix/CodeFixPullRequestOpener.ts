import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import CodeHostAccess, {
  CodeHostConnectionApi,
} from "../../CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostOpenedPullRequest } from "../../CodeRepository/CodeHost/CodeHostTypes";
import GitHubUtil, {
  GitHubOpenedFixPullRequest,
} from "../../CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../CodeRepository/GitHub/GitHubInstallationBinding";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import FixVerificationStatus from "../../../../Types/AI/FixVerificationStatus";
import {
  CodeHost,
  CodeHostUrl,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A CODE FIX'S PULL REQUEST, OPENED BY ONEUPTIME (issue #8916).
 *
 * A Runner that pushed a fix's branch used to open its pull (or merge)
 * request too, with the repository's token - so the token had to be able to:
 * a GitHub installation token with pull_requests, a GitLab repository's
 * connection token, which reaches GitLab's whole API. Now a Runner that says
 * it can (RunnerCodeFixCapability.ServerOpensPullRequests) pushes the branch
 * and asks OneUptime to open the request (/ai-agent-data/open-pull-request),
 * and OneUptime opens it as the repository is connected:
 *
 *   - GitHub: with the GitHub App's installation the project is bound to,
 *     through a token for the one repository that can open pull requests and
 *     nothing else (GitHubUtil.openFixPullRequest);
 *   - GitLab: a merge request, with the connection's token, as its account -
 *     so the bot user of the short-lived token the branch was pushed with
 *     writes none, and revoking that token changes none;
 *   - Forgejo and Gitea: a pull request, with the connection's token;
 *   - a Git server has no API: its branch is pushed, and the person opens
 *     the pull request, as before.
 *
 * What may be opened is the route's to decide, from the run the worker holds
 * (AIAgentDataAPI): this opens what it is told, ready for review, and finds
 * the one already open for the branch when the host says there is one - a
 * Runner asks again for an answer it did not get.
 */

// The longest description every host takes (GitHub's limit).
export const MAX_PULL_REQUEST_BODY_LENGTH: number = 65536;

// The longest title every host takes (GitLab's limit).
export const MAX_PULL_REQUEST_TITLE_LENGTH: number = 255;

// The longest branch name read: what Git and every host take.
export const MAX_BRANCH_NAME_LENGTH: number = 255;

const BODY_TRUNCATION_NOTICE: string =
  "\n\n---\n\n> _This description was truncated because it exceeded the maximum pull request description length._";

// What a worker asks to be opened.
export interface FixPullRequestRequest {
  codeRepositoryId: ObjectID;
  headRefName: string;
  baseRefName: string;
  title: string;
  body: string;
  runnerVerificationStatus?: FixVerificationStatus | undefined;
  runnerVerificationSummary?: string | undefined;
}

// A pull request OneUptime opened, or found open, for a fix.
export interface OpenedFixPullRequest {
  // The host's own id for it.
  id: number;
  // Its number on its pages.
  number: number;
  htmlUrl: string;
  title: string;
  // False when it was open already, and this is the one found.
  isNew: boolean;
}

export default class CodeFixPullRequestOpener {
  /*
   * A request's fields, read strictly: the repository, both branches and
   * the title are required, and a branch must be one Git takes. A
   * verification status this server does not know is dropped, as a record
   * of one is (CodeFixPullRequestRecord).
   */
  public static readRequest(data: JSONObject): FixPullRequestRequest {
    const codeRepositoryId: unknown = data["codeRepositoryId"];

    if (
      typeof codeRepositoryId !== "string" ||
      !ObjectID.isValidUUID(codeRepositoryId)
    ) {
      throw new BadDataException("codeRepositoryId is required");
    }

    const headRefName: string = CodeFixPullRequestOpener.readBranch(
      data["headRefName"],
      "headRefName",
    );
    const baseRefName: string = CodeFixPullRequestOpener.readBranch(
      data["baseRefName"],
      "baseRefName",
    );

    const title: unknown = data["title"];

    if (typeof title !== "string" || !title.trim()) {
      throw new BadDataException("title is required");
    }

    const body: unknown = data["body"];
    const status: unknown = data["runnerVerificationStatus"];
    const summary: unknown = data["runnerVerificationSummary"];

    return {
      codeRepositoryId: new ObjectID(codeRepositoryId),
      headRefName,
      baseRefName,
      title: title.trim().substring(0, MAX_PULL_REQUEST_TITLE_LENGTH),
      body: CodeFixPullRequestOpener.truncateBody(
        typeof body === "string" ? body : "",
      ),
      runnerVerificationStatus: Object.values(FixVerificationStatus).includes(
        status as FixVerificationStatus,
      )
        ? (status as FixVerificationStatus)
        : undefined,
      runnerVerificationSummary:
        typeof summary === "string" ? summary : undefined,
    };
  }

  /*
   * Whether a branch is the one a run pushed for its pull request: every
   * recipe names its branch after the run, ending with the first eight
   * characters of the run's id (`oneuptime-fix-exception-1a2b3c4d`,
   * `oneuptime-task-12-1a2b3c4d`). So a worker can have OneUptime open a
   * pull request only from a branch its own run made - never from someone
   * else's branch of the repository.
   */
  public static isBranchOfRun(data: {
    branchName: string;
    runId: ObjectID;
  }): boolean {
    const suffix: string = data.runId.toString().substring(0, 8).toLowerCase();

    return (
      suffix.length === 8 && data.branchName.toLowerCase().endsWith(suffix)
    );
  }

  // A description every host takes, with a note where it was cut.
  public static truncateBody(body: string): string {
    if (body.length <= MAX_PULL_REQUEST_BODY_LENGTH) {
      return body;
    }

    return `${body.substring(
      0,
      MAX_PULL_REQUEST_BODY_LENGTH - BODY_TRUNCATION_NOTICE.length,
    )}${BODY_TRUNCATION_NOTICE}`;
  }

  /*
   * The pull request the run already recorded in this repository, if any:
   * a run opens one there at most, so a worker that asks again is answered
   * with it, and one that asks for a second is refused.
   */
  @CaptureSpan()
  public static async findRecordedPullRequest(data: {
    aiRunId: ObjectID;
    codeRepositoryId: ObjectID;
  }): Promise<AIAgentTaskPullRequest | null> {
    return await AIAgentTaskPullRequestService.findOneBy({
      query: {
        aiRunId: data.aiRunId,
        codeRepositoryId: data.codeRepositoryId,
      },
      select: {
        _id: true,
        pullRequestUrl: true,
        pullRequestNumber: true,
        pullRequestId: true,
        title: true,
        headRefName: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Open the pull (or merge) request on the repository's host, as
   * OneUptime - or find the one open for the branch already. The repository
   * is read with CODE_HOST_REPOSITORY_SELECT. Throws, in words a person can
   * act on, when the host cannot be reached through OneUptime's server or
   * refuses.
   */
  @CaptureSpan()
  public static async open(data: {
    repository: CodeRepository;
    request: FixPullRequestRequest;
  }): Promise<OpenedFixPullRequest> {
    const repository: CodeRepository = data.repository;
    const request: FixPullRequestRequest = data.request;
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (type === CodeRepositoryType.GitHub) {
      return await CodeFixPullRequestOpener.openOnGitHub(data);
    }

    if (type === CodeRepositoryType.Git) {
      throw new BadDataException(
        "A Git repository gets a pushed branch, not a pull request: OneUptime has no API to open one on its server.",
      );
    }

    const api: CodeHostConnectionApi | null =
      await CodeHostAccess.getConnectionApi(repository);

    if (!api) {
      throw new BadDataException(
        `OneUptime cannot reach this repository's ${CodeHost.getFacts(type).name} server through its connection now, so it cannot open the ${CodeHost.getFacts(type).pullRequestTerm}. Check the repository's connection in Code.`,
      );
    }

    const pullRequestTerm: string = CodeHost.getFacts(type).pullRequestTerm;
    let opened: CodeHostOpenedPullRequest;
    let isNew: boolean = true;

    try {
      opened = await api.call(async (): Promise<CodeHostOpenedPullRequest> => {
        if (api.gitLab) {
          return await api.gitLab.createMergeRequest({
            project: api.gitLabProject,
            sourceBranch: request.headRefName,
            targetBranch: request.baseRefName,
            title: request.title,
            description: request.body,
          });
        }

        if (api.forgejo) {
          return await api.forgejo.createPullRequest({
            owner: api.owner,
            name: api.name,
            headBranch: request.headRefName,
            baseBranch: request.baseRefName,
            title: request.title,
            body: request.body,
          });
        }

        throw new BadDataException(
          `OneUptime cannot open a ${pullRequestTerm} on this repository's server.`,
        );
      });
    } catch (error) {
      if (
        !(error instanceof CodeHostHttpError) ||
        error.kind !== CodeHostHttpErrorKind.Conflict
      ) {
        throw new BadDataException(
          `OneUptime could not open the ${pullRequestTerm}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const existing: CodeHostOpenedPullRequest | null = await api.call(
        async (): Promise<CodeHostOpenedPullRequest | null> => {
          if (api.gitLab) {
            return await api.gitLab.findOpenMergeRequest({
              project: api.gitLabProject,
              sourceBranch: request.headRefName,
              targetBranch: request.baseRefName,
            });
          }

          return api.forgejo
            ? await api.forgejo.findOpenPullRequest({
                owner: api.owner,
                name: api.name,
                headBranch: request.headRefName,
                baseBranch: request.baseRefName,
              })
            : null;
        },
      );

      if (!existing) {
        throw new BadDataException(
          `OneUptime could not open the ${pullRequestTerm}: ${error.message}`,
        );
      }

      opened = existing;
      isNew = false;
    }

    return {
      id: opened.id,
      number: opened.number,
      htmlUrl:
        opened.htmlUrl ||
        `${CodeHostUrl.trimTrailingSlashes(api.webUrl)}/${
          type === CodeRepositoryType.GitLab ? "-/merge_requests" : "pulls"
        }/${opened.number}`,
      title: request.title,
      isNew,
    };
  }

  /*
   * A GitHub repository's pull request, through the installation its
   * project is bound to: the installation id on the row is never trusted on
   * its own (GitHubInstallationBinding), as the token route does not.
   */
  private static async openOnGitHub(data: {
    repository: CodeRepository;
    request: FixPullRequestRequest;
  }): Promise<OpenedFixPullRequest> {
    const repository: CodeRepository = data.repository;
    const boundInstallationId: string | null = repository.projectId
      ? await GitHubInstallationBinding.getBoundInstallationId(
          repository.projectId,
        )
      : null;

    if (
      !boundInstallationId ||
      !repository.gitHubAppInstallationId ||
      repository.gitHubAppInstallationId !== boundInstallationId ||
      !repository.organizationName ||
      !repository.repositoryName
    ) {
      throw new BadDataException(
        "This repository's GitHub App installation is not connected to its project. Please reconnect the GitHub App from Project Settings.",
      );
    }

    const opened: GitHubOpenedFixPullRequest =
      await GitHubUtil.openFixPullRequest({
        installationId: boundInstallationId,
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        baseBranchName: data.request.baseRefName,
        headBranchName: data.request.headRefName,
        title: data.request.title,
        body: data.request.body,
      });

    return {
      id: opened.id,
      number: opened.number,
      htmlUrl: opened.htmlUrl,
      title: opened.title,
      isNew: opened.isNew,
    };
  }

  /*
   * A branch name as Git takes it: no space or control character, no "..",
   * "@{", "\\" or the characters Git refuses, not starting with "-" or "/",
   * not ending with "/", "." or ".lock", and no longer than any host takes.
   */
  private static readBranch(value: unknown, field: string): string {
    if (typeof value !== "string" || !value) {
      throw new BadDataException(`${field} is required`);
    }

    // Git refuses each of these in a branch name.
    const forbiddenCharacters: Array<string> = ["~", "^", ":", "?", "*", "["];

    const isValid: boolean =
      value.length <= MAX_BRANCH_NAME_LENGTH &&
      !value.startsWith("-") &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock") &&
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      !value.includes("\\") &&
      value !== "@" &&
      !forbiddenCharacters.some((character: string): boolean => {
        return value.includes(character);
      }) &&
      Array.from(value).every((character: string): boolean => {
        const code: number = character.charCodeAt(0);
        return code > 32 && code !== 127;
      });

    if (!isValid) {
      throw new BadDataException(`${field} is not a branch name Git takes`);
    }

    return value;
  }
}
