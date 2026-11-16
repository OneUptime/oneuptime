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
import RunnerCodeFixCapability, {
  RunnerCodeFixCapabilityUtil,
} from "../../../../Types/Runner/RunnerCodeFixCapability";
import ObjectID from "../../../../Types/ObjectID";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSourceEgressGuard from "../../DataSource/EgressGuard";
import logger from "../../Logger";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "./CodeHostAccess";
import { CodeHostHttpError, CodeHostTransport } from "./CodeHostHttp";
import CodeRepositoryMintedTokens, {
  CodeRepositoryMintOutcome,
} from "./CodeRepositoryMintedTokens";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import GitSmartHttp from "./GitSmartHttp";
import {
  CODE_TASK_REPOSITORY_NEEDS_OWN_RUNNER_MESSAGE,
  getRepositoryNotReachableMessage,
} from "../../AI/CodeTask/CodeTaskGate";
import GlobalRunnerRepositoryTokens from "../../Runner/GlobalRunnerRepositoryTokens";
import {
  GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
  GLOBAL_RUNNER_TOO_OLD_FOR_GITLAB_REFUSAL,
  GlobalRunnerKeptOffReason,
  getGlobalRunnerKeptOffRefusal,
} from "../../../../Types/Runner/GlobalRunnerRepositoryTokens";

/*
 * WHAT A RUNNER IS HANDED TO WORK IN A REPOSITORY THAT IS NOT ON GITHUB.
 *
 * A GitHub repository's token is minted for one run from the GitHub App.
 * A GitLab, Forgejo, Gitea or Git repository is reached through its
 * connection (CodeRepositoryConnection), so a Runner is handed a token for
 * it, with where to use it, only when it may work in the repository (the
 * route has asked) and can (the hosts it says it supports), and only while:
 *
 *   - the connection is the repository's project's and was not refused;
 *   - the Runner can reach the server: a server only a private network
 *     reaches goes to one of the project's own Runners, never a global one;
 *   - the server still takes the token, when OneUptime can ask it (a token
 *     that expired is caught here, with what to do, before the Runner
 *     clones anything - and the repository shows as not connected).
 *
 * Which token (issues #8912 and #8916):
 *
 *   - a Runner that has OneUptime open its pull requests
 *     (RunnerCodeFixCapability.ServerOpensPullRequests), on a host
 *     OneUptime's server reaches, never needs the host's API: OneUptime opens
 *     the pull or merge request itself, with the connection's token, which
 *     stays on the server (serverOpensPullRequest);
 *   - so on GitLab it is handed a project access token OneUptime makes for
 *     the run alone instead of the connection's own: the one project,
 *     write_repository, the Developer role, ending within a day and revoked
 *     when the run ends (CodeRepositoryMintedTokens). Where GitLab makes
 *     none for this repository, its own Runner is handed the connection's
 *     token, as before;
 *   - Forgejo, Gitea and Git make no narrower token from the one OneUptime
 *     holds, so their Runner is still handed the connection's.
 *
 * Where global Runners never hold a connection's own token - OneUptime
 * Cloud, or a self-hosted multi-tenant install with the rule on - a global
 * Runner is handed only the token made for its run: GitLab's, never the
 * connection's (Types/Runner/GlobalRunnerRepositoryTokens).
 */

export const RUNNER_TOO_OLD_FOR_CODE_HOST_MESSAGE: (
  hostName: string,
) => string = (hostName: string): string => {
  return `This Runner is older than ${hostName} repositories in Code. Update it to the latest version to work in this repository.`;
};

/*
 * What a global Runner is told when GitLab could not be asked for its run's
 * token just now: nothing is kept, and the next attempt asks again.
 */
export const GITLAB_TOKEN_UNAVAILABLE_MESSAGE: (reason: string) => string = (
  reason: string,
): string => {
  return `OneUptime could not ask GitLab for the short-lived token this fix pushes with (${reason}). Try again in a few minutes.`;
};

// What a Runner pushing with a token OneUptime made signs in to GitLab as.
export const MINTED_TOKEN_GIT_USERNAME: string = "oauth2";

/*
 * How long a connection's own token is said to be good for, which does not
 * end on its own: the run's hour, as GitHub's is.
 */
const CONNECTION_TOKEN_SAID_GOOD_FOR_MS: number = 60 * 60 * 1000;

export interface CodeHostRunnerGrant {
  token: string;
  // When the Runner should treat the token as ended.
  expiresAt: Date;
  // What git clones and pushes: the repository's HTTPS address.
  cloneUrl: string;
  organizationName: string;
  repositoryName: string;
  codeHost: CodeHostRunnerInfo;
  /*
   * Whether OneUptime opens the run's pull (or merge) request, which the
   * Runner then asks for (/ai-agent-data/open-pull-request) instead of
   * opening it with the token.
   */
  serverOpensPullRequest: boolean;
  // Whether the token is one OneUptime made for this run (GitLab's).
  isMintedForRun: boolean;
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
   * Whether the Runner gets a token for the repository, and which, with
   * what. The route has already decided the Runner may work in the
   * repository (its Runner setting in Code), that the repository is its
   * project's, and which run the token is for (runId: one the worker holds,
   * or null for a worker that names none, which is older than tokens made
   * for a run).
   */
  @CaptureSpan()
  public static async decide(data: {
    repository: CodeRepository;
    worker: CodeWorker;
    supportedCodeHosts: Array<CodeRepositoryType>;
    // What the Runner says it can do (RUNNER_CODE_FIX_CAPABILITIES_FIELD).
    capabilities?: ReadonlyArray<RunnerCodeFixCapability> | undefined;
    // The run the token is for, when the worker named one it holds.
    runId?: ObjectID | null | undefined;
    // Test seam: how the server asks the Git server whether it takes the token.
    transport?: CodeHostTransport | undefined;
    now?: Date | undefined;
  }): Promise<CodeHostRunnerDecision> {
    const repository: CodeRepository = data.repository;
    const now: Date = data.now || new Date();
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );
    const isGlobalRunner: boolean =
      data.worker.kind === CodeWorkerKind.GlobalRunner;
    const keepsConnectionTokensOff: boolean =
      isGlobalRunner &&
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners();
    const opensPullRequestsThroughServer: boolean =
      RunnerCodeFixCapabilityUtil.has(
        data.capabilities,
        RunnerCodeFixCapability.ServerOpensPullRequests,
      );

    /*
     * Asked before the connection is read: where global Runners never hold
     * a connection's own token, a Forgejo, Gitea or Git repository's is
     * never even looked up for one, and a GitLab repository's only for a
     * global Runner that pushes with the token made for its run.
     */
    if (keepsConnectionTokensOff) {
      const reason: GlobalRunnerKeptOffReason | null =
        GlobalRunnerRepositoryTokens.getKeptOffReason({
          repositoryHostedAt: repository.repositoryHostedAt,
          mintedTokenRefusedAt: repository.mintedTokenRefusedAt,
        });

      if (reason) {
        return { refusal: getGlobalRunnerKeptOffRefusal(reason) };
      }

      if (
        type === CodeRepositoryType.GitLab &&
        (!opensPullRequestsThroughServer || !data.runId)
      ) {
        return { refusal: GLOBAL_RUNNER_TOO_OLD_FOR_GITLAB_REFUSAL };
      }
    }

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

    if (!isReachableFromServer && isGlobalRunner) {
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

    const transport: CodeHostTransport =
      data.transport || CodeHostAccess.getTransport();

    /*
     * Ask the server whether it still takes the token, where OneUptime may:
     * an expired token fails here, with what to do, rather than in the
     * middle of a clone on the Runner. A server that cannot be asked right
     * now (it did not answer) is left to the Runner.
     */
    if (isReachableFromServer) {
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
        if (error instanceof CodeHostHttpError && error.isCredentialRefusal()) {
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

    /*
     * OneUptime opens the pull (or merge) request where its server reaches
     * the host and the Runner asks it to: the Runner then needs no API.
     */
    const serverOpensPullRequest: boolean =
      opensPullRequestsThroughServer &&
      isReachableFromServer &&
      CodeHost.can(type, CodeHostCapability.PullRequests);

    let token: string = credentials.token;
    let username: string =
      credentials.username || connection.accountLogin || "oauth2";
    let expiresAt: Date = new Date(
      now.getTime() + CONNECTION_TOKEN_SAID_GOOD_FOR_MS,
    );
    let isMintedForRun: boolean = false;

    /*
     * GitLab: a token made for the run, on the one project, that can push
     * and nothing more - asked for wherever OneUptime opens the merge
     * request, unless GitLab refused this repository lately (its own
     * Runner asks again once the refusal is old; a global Runner that is
     * never handed the connection's token waits for the connection's token
     * to be replaced).
     */
    if (
      type === CodeRepositoryType.GitLab &&
      serverOpensPullRequest &&
      data.runId &&
      (keepsConnectionTokensOff ||
        !CodeRepositoryMintedTokens.isRefusalHolding(
          repository.mintedTokenRefusedAt,
          now,
        ))
    ) {
      let outcome: CodeRepositoryMintOutcome;

      try {
        outcome = await CodeRepositoryMintedTokens.mintForRun({
          repository,
          connection,
          runId: data.runId,
          workerId: new ObjectID(data.worker.id.toString()),
          transport,
          now,
        });
      } catch (error) {
        if (error instanceof CodeHostHttpError && error.isCredentialRefusal()) {
          await CodeRepositoryConnectionService.markRefused(connection);

          return {
            refusal: getRepositoryNotReachableMessage({
              ...summary,
              state: CodeHostConnectionState.TokenRefused,
            }),
          };
        }

        throw error;
      }

      if (outcome.kind === "minted") {
        token = outcome.minted.token;
        username = MINTED_TOKEN_GIT_USERNAME;
        expiresAt = outcome.minted.expiresAt;
        isMintedForRun = true;
      } else if (keepsConnectionTokensOff) {
        return {
          refusal:
            outcome.kind === "refused"
              ? `${GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL} GitLab said: ${outcome.reason}`
              : GITLAB_TOKEN_UNAVAILABLE_MESSAGE(outcome.reason),
        };
      } else {
        logger.debug(
          `GitLab made no short-lived token for repository ${repository.id?.toString()} (${outcome.reason}); its Runner is handed the connection's token.`,
        );
      }
    }

    /*
     * Never the connection's own token to a global Runner where they are
     * kept off: only a token made for its run gets this far for one.
     */
    if (keepsConnectionTokensOff && !isMintedForRun) {
      return {
        refusal: getGlobalRunnerKeptOffRefusal(
          GlobalRunnerKeptOffReason.ConnectionToken,
        ),
      };
    }

    const apiPath: string | undefined = CODE_HOST_API_PATHS[type];

    return {
      grant: {
        token,
        expiresAt,
        cloneUrl,
        organizationName,
        repositoryName,
        serverOpensPullRequest,
        isMintedForRun,
        codeHost: {
          type,
          hostUrl,
          apiUrl: apiPath ? `${hostUrl}${apiPath}` : null,
          webUrl:
            type === CodeRepositoryType.Git
              ? CodeHostAccess.getGitWebUrl(repositoryUrl)
              : repositoryUrl ||
                `${hostUrl}/${organizationName}/${repositoryName}`,
          username,
          projectId:
            type === CodeRepositoryType.GitLab
              ? repository.gitLabProjectId || null
              : null,
          hasPullRequests: CodeHost.can(type, CodeHostCapability.PullRequests),
          /*
           * A global Runner reaches a private network only where the
           * server does: on a self-hosted OneUptime, never on OneUptime
           * Cloud.
           */
          isPrivateNetworkAllowed:
            !isGlobalRunner ||
            !DataSourceEgressGuard.shouldBlockPrivateAddresses(),
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
