import logger from "../../Logger";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../../Types/ObjectID";
import Project from "../../../../Models/DatabaseModels/Project";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ProjectService from "../../../Services/ProjectService";
import GitHubInstallationBinding from "./GitHubInstallationBinding";
import GitHubConversation, {
  GitHubRepositoryPermission,
} from "./GitHubConversation";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Whether a GitHub command may run, and — just as important — whether the app
 * should say anything about it.
 *
 * The threat this exists for: a connected repository's issue tracker is open
 * to anyone with a GitHub account, and a mention costs nothing to write. So
 * every command arrives as a request from an untrusted party, and there are
 * two distinct failure modes to keep apart.
 *
 *   - A command the app cannot carry out (feature switched off, repository not
 *     connected) is answered, because the person asking is a collaborator who
 *     would otherwise think the integration is broken.
 *
 *   - A command from someone WITHOUT write access is not answered in the
 *     thread at all. Replying would make the app a comment-poster that any
 *     GitHub account can drive: one mention, one guaranteed comment, repeat.
 *     It gets a single reaction on the offending comment instead — visible to
 *     the author, idempotent, and useless as an amplifier.
 */

export enum GitHubAuthorizationOutcome {
  // The command may proceed.
  Allowed = "Allowed",
  /*
   * Not a command from a human this app should ever answer: a bot, or a
   * repository this OneUptime instance has no connection to. Silence.
   */
  Ignore = "Ignore",
  /*
   * A real person without write access to the repository. React, do not
   * reply — see the note above.
   */
  InsufficientPermission = "InsufficientPermission",
  /*
   * A collaborator asked, but the repository has GitHub commands switched
   * off. Reply, so they know where the switch is.
   */
  CommandsDisabled = "CommandsDisabled",
}

export interface GitHubAuthorizationResult {
  outcome: GitHubAuthorizationOutcome;
  codeRepository?: CodeRepository | undefined;
  /*
   * The OneUptime project the app is acting for. Named in the acknowledgement
   * comment: a repository can be connected to more than one project, and a
   * team should never have to guess whose AI budget a command just spent.
   */
  projectName?: string | undefined;
  // Filled for the outcomes that are answered in the thread.
  reason?: string | undefined;
}

/*
 * How many connected-repository rows to consider for one webhook. The same
 * repository can be imported by several projects, and the app acts for exactly
 * one of them — the oldest bound connection. This bounds the query; hitting it
 * is logged rather than silently truncated.
 */
const MAX_CONNECTED_REPOSITORY_CANDIDATES: number = 10;

export default class GitHubCommandAuthorizer {
  /*
   * The CodeRepository row a webhook's repository belongs to.
   *
   * Matched on organization + name + installation, then re-derived from the
   * project: the row's installation ID is a value stored on a record, and the
   * question "may this installation act for this project?" is only ever
   * answered by GitHubInstallationBinding, never by the row itself. Same rule
   * the repository-token endpoint applies before it mints a token.
   *
   * More than one project may have imported the same repository. Acting for
   * all of them would mean one comment producing several pull requests, so the
   * OLDEST connection wins — deterministic, and stable across redeliveries of
   * the same webhook.
   */
  @CaptureSpan()
  public static async resolveConnectedRepository(data: {
    organizationName: string;
    repositoryName: string;
    installationId: string;
  }): Promise<CodeRepository | null> {
    const candidates: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: {
          organizationName: data.organizationName,
          repositoryName: data.repositoryName,
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: data.installationId,
        },
        select: {
          _id: true,
          projectId: true,
          organizationName: true,
          repositoryName: true,
          mainBranchName: true,
          gitHubAppInstallationId: true,
          isGitHubCommandsEnabled: true,
          gitHubTriggerLabel: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: MAX_CONNECTED_REPOSITORY_CANDIDATES,
        skip: 0,
        props: { isRoot: true },
      });

    /*
     * At the cap, a legitimate connection past the tenth is invisible — and
     * would otherwise be indistinguishable from "not connected at all". Say so
     * once, so an operator chasing a silently ignored command has something to
     * find.
     */
    if (candidates.length === MAX_CONNECTED_REPOSITORY_CANDIDATES) {
      logger.warn(
        `${data.organizationName}/${data.repositoryName} matched the maximum of ${MAX_CONNECTED_REPOSITORY_CANDIDATES} connected repository rows for installation ${data.installationId}; any connection beyond that is not being considered.`,
      );
    }

    for (const candidate of candidates) {
      if (!candidate.projectId || !candidate.gitHubAppInstallationId) {
        continue;
      }

      const isBound: boolean =
        await GitHubInstallationBinding.isInstallationBoundToProject({
          projectId: candidate.projectId,
          installationId: candidate.gitHubAppInstallationId,
        });

      if (!isBound) {
        logger.warn(
          `Ignoring a GitHub command for ${data.organizationName}/${data.repositoryName}: installation ${data.installationId} is not bound to project ${candidate.projectId.toString()}.`,
        );
        continue;
      }

      if (candidates.length > 1) {
        logger.info(
          `${data.organizationName}/${data.repositoryName} is connected to ${candidates.length} OneUptime projects; acting for the oldest connection (project ${candidate.projectId.toString()}).`,
        );
      }

      return candidate;
    }

    return null;
  }

  /*
   * Whether this repository answers GitHub commands at all.
   *
   * A null column means enabled. The switch was added after the repositories
   * were, and defaulting existing rows to "off" would mean the feature does
   * nothing anywhere until every repository is visited by hand. Nothing
   * happens until somebody deliberately types the mention regardless, so the
   * safe default is also the useful one.
   */
  public static areCommandsEnabled(codeRepository: CodeRepository): boolean {
    return codeRepository.isGitHubCommandsEnabled !== false;
  }

  @CaptureSpan()
  public static async authorize(data: {
    organizationName: string;
    repositoryName: string;
    installationId: string;
    senderLogin: string;
    // GitHub's own "is this a bot" signal from the webhook's sender object.
    senderType: string | undefined;
  }): Promise<GitHubAuthorizationResult> {
    if (
      !data.senderLogin ||
      data.senderType?.toLowerCase() === "bot" ||
      GitHubConversation.isBotLogin(data.senderLogin)
    ) {
      /*
       * The loop guard. The app's own comments arrive here as webhooks, and so
       * do every other bot's — neither is a human asking for work.
       */
      return { outcome: GitHubAuthorizationOutcome.Ignore };
    }

    const codeRepository: CodeRepository | null =
      await GitHubCommandAuthorizer.resolveConnectedRepository({
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        installationId: data.installationId,
      });

    if (!codeRepository) {
      /*
       * The app is installed on a repository this instance has not connected
       * to a project. It has no project to bill, no budget to check and no
       * agent to run — and no standing to comment in someone's repository.
       */
      return { outcome: GitHubAuthorizationOutcome.Ignore };
    }

    if (!GitHubCommandAuthorizer.areCommandsEnabled(codeRepository)) {
      return {
        outcome: GitHubAuthorizationOutcome.CommandsDisabled,
        codeRepository: codeRepository,
        reason:
          "GitHub commands are switched off for this repository. A project admin can turn them back on in OneUptime under Code Repositories → this repository → Settings.",
      };
    }

    const permission: GitHubRepositoryPermission =
      await GitHubConversation.getUserRepositoryPermission({
        installationId: data.installationId,
        organizationName: data.organizationName,
        repositoryName: data.repositoryName,
        username: data.senderLogin,
      });

    if (!GitHubConversation.canCommandApp(permission)) {
      logger.info(
        `Refusing a GitHub command from ${data.senderLogin} on ${data.organizationName}/${data.repositoryName}: repository permission is "${permission}".`,
      );

      return {
        outcome: GitHubAuthorizationOutcome.InsufficientPermission,
        codeRepository: codeRepository,
      };
    }

    return {
      outcome: GitHubAuthorizationOutcome.Allowed,
      codeRepository: codeRepository,
      projectName: await GitHubCommandAuthorizer.getProjectName(
        codeRepository.projectId,
      ),
    };
  }

  /*
   * The project's display name, for attribution in the thread. Never fails the
   * command: a name is a nicety, and losing it is not a reason to refuse work.
   */
  private static async getProjectName(
    projectId: ObjectID | undefined,
  ): Promise<string | undefined> {
    if (!projectId) {
      return undefined;
    }

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { _id: true, name: true },
        props: { isRoot: true },
      });

      return project?.name || undefined;
    } catch (error) {
      logger.debug(`Could not read the project name for attribution: ${error}`);
      return undefined;
    }
  }
}
