import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "../../../../Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryConnectionService, {
  CodeRepositoryConnectionCredentials,
  Service as CodeRepositoryConnectionServiceClass,
} from "../../../Services/CodeRepositoryConnectionService";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CODE_HOST_API_PATHS,
  CodeHost,
  CodeHostCapability,
  CodeHostRunnerInfo,
  CodeHostUrl,
} from "../../../../Types/CodeRepository/CodeHost";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../Types/Runner/CodeRepositoryRunner";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "./CodeHostAccess";
import { CodeHostHttpError, CodeHostTransport } from "./CodeHostHttp";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import GitSmartHttp from "./GitSmartHttp";
import {
  CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE,
  getRepositoryNotReachableMessage,
} from "../../AI/CodeTask/CodeTaskGate";

/*
 * WHAT A RUNNER IS HANDED TO WORK IN A REPOSITORY THAT IS NOT ON GITHUB.
 *
 * A GitHub repository's token is minted for one run from the GitHub App.
 * A GitLab, Forgejo, Gitea or Git repository's is the one its connection
 * holds (CodeRepositoryConnection), so it goes, with where to use it, only
 * to a Runner that may work in the repository (the route has asked) and
 * that can (the hosts it says it supports), and only while:
 *
 *   - the connection is the repository's project's and was not refused;
 *   - the Runner can reach the server: a server only a private network
 *     reaches goes to one of the project's own Runners, never a global one;
 *   - the server still takes the token, when OneUptime can ask it (a token
 *     that expired is caught here, with what to do, before the Runner
 *     clones anything - and the repository shows as not connected).
 */

export const RUNNER_TOO_OLD_FOR_CODE_HOST_MESSAGE: (hostName: string) => string =
  (hostName: string): string => {
    return `This Runner is older than ${hostName} repositories in Code. Update it to the latest version to work in this repository.`;
  };

export interface CodeHostRunnerGrant {
  token: string;
  // What git clones and pushes: the repository's HTTPS address.
  cloneUrl: string;
  organizationName: string;
  repositoryName: string;
  codeHost: CodeHostRunnerInfo;
}

export type CodeHostRunnerDecision =
  | { grant: CodeHostRunnerGrant; refusal?: undefined }
  | { refusal: string; grant?: undefined };

export default class CodeHostRunnerToken {
  /*
   * The hosts a Runner says it supports, as it sends them: none from a
   * Runner older than them.
   */
  public static readSupportedCodeHosts(
    raw: unknown,
  ): Array<CodeRepositoryType> {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((value: unknown): value is CodeRepositoryType => {
      return CodeHost.isKnownType(value);
    });
  }

  /*
   * Whether the Runner gets the repository's token, and with what. The
   * route has already decided the Runner may work in the repository (its
   * Runner setting in Code) and that the repository is its project's.
   */
  @CaptureSpan()
  public static async decide(data: {
    repository: CodeRepository;
    worker: CodeWorker;
    supportedCodeHosts: Array<CodeRepositoryType>;
    // Test seam: how the server asks the Git server whether it takes the token.
    transport?: CodeHostTransport | undefined;
  }): Promise<CodeHostRunnerDecision> {
    const repository: CodeRepository = data.repository;
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (!data.supportedCodeHosts.includes(type)) {
      return {
        refusal: RUNNER_TOO_OLD_FOR_CODE_HOST_MESSAGE(
          CodeHost.getFacts(type).name,
        ),
      };
    }

    if (!repository.projectId || !repository.codeRepositoryConnectionId) {
      return { refusal: getRepositoryNotReachableMessage(undefined) };
    }

    const connection: CodeRepositoryConnection | undefined = (
      await CodeHostAccess.readConnections({
        projectId: repository.projectId,
        connectionIds: [repository.codeRepositoryConnectionId.toString()],
      })
    ).get(repository.codeRepositoryConnectionId.toString());

    const summary: CodeHostConnectionSummary = CodeHostAccess.summarize({
      repository,
      boundInstallationId: null,
      connection,
    });

    if (summary.state !== CodeHostConnectionState.Connected || !connection) {
      return { refusal: getRepositoryNotReachableMessage(summary) };
    }

    const credentials: CodeRepositoryConnectionCredentials =
      CodeRepositoryConnectionServiceClass.readCredentials(
        connection.credentials,
      )!;

    const isReachableFromServer: boolean =
      connection.isReachableFromServer !== false;

    if (
      !isReachableFromServer &&
      data.worker.kind === CodeWorkerKind.GlobalRunner
    ) {
      return { refusal: CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE };
    }

    const hostUrl: string = connection.hostUrl || "";
    const organizationName: string = repository.organizationName || "";
    const repositoryName: string = repository.repositoryName || "";
    const repositoryUrl: string = repository.repositoryUrl?.toString() || "";

    /*
     * What git clones: a Git repository's own address; for GitLab and
     * Forgejo, the repository's page with .git, as their clone addresses
     * are.
     */
    const cloneUrl: string =
      type === CodeRepositoryType.Git
        ? repositoryUrl
        : repositoryUrl
          ? `${CodeHostUrl.trimTrailingSlashes(repositoryUrl)}.git`
          : `${hostUrl}/${CodeHostUrl.encodePath(`${organizationName}/${repositoryName}`)}.git`;

    if (!cloneUrl || !hostUrl) {
      return { refusal: getRepositoryNotReachableMessage(undefined) };
    }

    /*
     * Ask the server whether it still takes the token, where OneUptime may:
     * an expired token fails here, with what to do, rather than in the
     * middle of a clone on the Runner. A server that cannot be asked right
     * now (it did not answer) is left to the Runner.
     */
    if (isReachableFromServer) {
      const transport: CodeHostTransport =
        data.transport || CodeHostAccess.getTransport();

      try {
        await CodeHostRunnerToken.checkToken({
          type,
          hostUrl,
          cloneUrl,
          credentials,
          transport,
        });

        await CodeRepositoryConnectionService.markAccepted(connection);
      } catch (error) {
        if (
          error instanceof CodeHostHttpError &&
          error.isCredentialRefusal()
        ) {
          await CodeRepositoryConnectionService.markRefused(connection);

          return {
            refusal: getRepositoryNotReachableMessage({
              ...summary,
              state: CodeHostConnectionState.TokenRefused,
            }),
          };
        }

        logger.debug(
          `Could not check repository ${repository.id?.toString()}'s access token before handing it to a Runner; the Runner will find out: ${error}`,
        );
      }
    }

    const apiPath: string | undefined = CODE_HOST_API_PATHS[type];

    return {
      grant: {
        token: credentials.token,
        cloneUrl,
        organizationName,
        repositoryName,
        codeHost: {
          type,
          hostUrl,
          apiUrl: apiPath ? `${hostUrl}${apiPath}` : null,
          webUrl:
            type === CodeRepositoryType.Git
              ? CodeHostAccess.getGitWebUrl(repositoryUrl)
              : repositoryUrl || `${hostUrl}/${organizationName}/${repositoryName}`,
          username: credentials.username || connection.accountLogin || "oauth2",
          projectId:
            type === CodeRepositoryType.GitLab
              ? repository.gitLabProjectId || null
              : null,
          hasPullRequests: CodeHost.can(
            type,
            CodeHostCapability.PullRequests,
          ),
        },
      },
    };
  }

  // One cheap request that the server answers only for a token it takes.
  private static async checkToken(data: {
    type: CodeRepositoryType;
    hostUrl: string;
    cloneUrl: string;
    credentials: CodeRepositoryConnectionCredentials;
    transport: CodeHostTransport;
  }): Promise<void> {
    switch (data.type) {
      case CodeRepositoryType.GitLab:
        await new GitLabApi({
          hostUrl: data.hostUrl,
          token: data.credentials.token,
          transport: data.transport,
        }).getAccount();
        return;
      case CodeRepositoryType.Forgejo:
        await new ForgejoApi({
          hostUrl: data.hostUrl,
          token: data.credentials.token,
          transport: data.transport,
        }).getAccount();
        return;
      case CodeRepositoryType.Git:
        await new GitSmartHttp({
          cloneUrl: data.cloneUrl,
          username: data.credentials.username,
          password: data.credentials.token,
          transport: data.transport,
        }).getRefs();
        return;
      default:
        return;
    }
  }
}
