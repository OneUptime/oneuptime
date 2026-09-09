import ProjectService from "../../../Services/ProjectService";
import CodeRepositoryService, {
  ImportReposFromInstallationResult,
} from "../../../Services/CodeRepositoryService";
import Project from "../../../../Models/DatabaseModels/Project";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { GitHubWebhookDelivery } from "./GitHubWebhookQueue";
import GitHubEventUtil from "../../../../Utils/CodeRepository/GitHubEventUtil";
import { GitHubEventEnvelope } from "../../../../Types/CodeRepository/GitHubEvent";
import Redis, { ClientType } from "../../../Infrastructure/Redis";
import logger from "../../Logger";
import GitHubUtil, { GitHubRepository } from "./GitHub";

export default class GitHubWebhookProcessor {
  public static async process(
    delivery: GitHubWebhookDelivery,
    dispatch: (data: {
      projectId: ObjectID;
      envelope: GitHubEventEnvelope;
    }) => Promise<void>,
  ): Promise<void> {
    const { event, payload } = delivery;
    const installationId: string = (payload["installation"] as JSONObject)[
      "id"
    ]!.toString();
    const action: string = payload["action"] as string;
    const client: ClientType | null = Redis.getClient();
    if (!client) {
      throw new Error("GitHub delivery storage is unavailable.");
    }
    const suspendedKey: string = `github-installation-suspended:${installationId}`;

    if (event === "installation") {
      if (action === "suspend" || action === "unsuspend") {
        const isSuspended: boolean | null =
          await GitHubUtil.getInstallationSuspensionStatus(installationId);
        /*
         * A stale delivery for an installation already deleted must not
         * resurrect its cache entry or undo the deletion handler's cleanup.
         */
        if (isSuspended === null) {
          return;
        }
        if (isSuspended) {
          await client.set(suspendedKey, "1");
        } else {
          await client.del(suspendedKey);
          await this.importInstallationRepositoriesForLinkedProjects(
            installationId,
          );
        }
      } else if (
        action === "created" ||
        action === "new_permissions_accepted"
      ) {
        await this.importInstallationRepositoriesForLinkedProjects(
          installationId,
        );
      } else if (action === "deleted") {
        /*
         * Clear repository credentials first: a failed attempt can safely retry
         * before dropping the authoritative project binding.
         */
        await CodeRepositoryService.updateBy({
          query: { gitHubAppInstallationId: installationId },
          data: { gitHubAppInstallationId: null as unknown as string },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
        await ProjectService.updateBy({
          query: { gitHubAppInstallationId: installationId },
          data: { gitHubAppInstallationId: null as unknown as string },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        });
        await client.del(suspendedKey);
      }
      return;
    }

    if (event === "installation_repositories") {
      const removed: JSONArray = Array.isArray(payload["repositories_removed"])
        ? (payload["repositories_removed"] as JSONArray)
        : [];
      if (removed.length) {
        await this.removeRepositoriesForInstallation(installationId, removed);
      }
      if (
        Array.isArray(payload["repositories_added"]) &&
        payload["repositories_added"].length
      ) {
        await this.importInstallationRepositoriesForLinkedProjects(
          installationId,
        );
      }
      return;
    }

    if (await client.exists(suspendedKey)) {
      return;
    }

    const envelope: GitHubEventEnvelope | null = GitHubEventUtil.normalize({
      ...delivery,
      codeRepositoryId: "",
    });
    if (!envelope) {
      return;
    }

    const projectIds: Array<ObjectID> =
      await this.getProjectIdsForInstallation(installationId);
    let failed: boolean = false;
    for (const projectId of projectIds) {
      try {
        const slash: number = envelope.repository.indexOf("/");
        const repository: CodeRepository | null =
          await CodeRepositoryService.findOneBy({
            query: {
              projectId,
              gitHubAppInstallationId: installationId,
              repositoryHostedAt: CodeRepositoryType.GitHub,
              // Normalization excludes glob characters; match exact names ignoring case.
              organizationName: new Wildcard(
                envelope.repository.slice(0, slash),
              ),
              repositoryName: new Wildcard(
                envelope.repository.slice(slash + 1),
              ),
            },
            select: { _id: true },
            props: { isRoot: true },
          });
        if (repository?.id) {
          await dispatch({
            projectId,
            envelope: {
              ...envelope,
              codeRepositoryId: repository.id.toString(),
            },
          });
        }
      } catch {
        failed = true;
        logger.error(
          `GitHub delivery ${delivery.deliveryId} could not dispatch to project ${projectId.toString()}.`,
        );
      }
    }
    if (failed) {
      throw new Error(
        `GitHub delivery ${delivery.deliveryId} could not dispatch to every linked project.`,
      );
    }
  }

  /*
   * Resolves the projects linked to a GitHub App installation.
   *
   * Project.gitHubAppInstallationId is the only source consulted, because it
   * is the only one GitHub has vouched for — the install callback writes it
   * after verifying the installer controls the installation, and the
   * uninstall webhook clears it.
   *
   * This used to fall back to CodeRepository rows carrying the installation
   * ID. That inverted the trust: a row is supposed to derive its right to an
   * installation FROM its project, so letting a row nominate its project as a
   * link target meant anyone who could write an installation ID onto a row in
   * their own project would have that project treated as an owner of the
   * installation — and every webhook would then import the victim's
   * repositories into it.
   */
  private static async getProjectIdsForInstallation(
    installationId: string,
  ): Promise<Array<ObjectID>> {
    const projectIds: Array<ObjectID> = [];

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        gitHubAppInstallationId: installationId,
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (project.id) {
        projectIds.push(project.id);
      }
    }

    return projectIds;
  }

  // Imports all repositories in an installation into every project linked to it.
  private static async importInstallationRepositoriesForLinkedProjects(
    installationId: string,
  ): Promise<void> {
    const projectIds: Array<ObjectID> =
      await GitHubWebhookProcessor.getProjectIdsForInstallation(installationId);

    if (projectIds.length === 0) {
      logger.info(
        `GitHub webhook: no projects linked to installation ${installationId}. Skipping repository import.`,
      );
      return;
    }

    for (const projectId of projectIds) {
      const importResult: ImportReposFromInstallationResult =
        await CodeRepositoryService.importReposFromInstallation({
          projectId: projectId,
          installationId: installationId,
          strictImportErrors: true,
        });

      logger.info(
        `GitHub webhook: imported ${importResult.imported} repositories (${importResult.skipped} skipped) into project ${projectId.toString()} for installation ${installationId}`,
      );
    }
  }

  /*
   * Disconnects repositories removed from the installation. Retain their IDs
   * and settings so restoring GitHub access can reconnect existing workflows.
   */
  private static async removeRepositoriesForInstallation(
    installationId: string,
    removedRepositories: JSONArray,
  ): Promise<void> {
    const projectIds: Array<ObjectID> =
      await this.getProjectIdsForInstallation(installationId);
    if (projectIds.length === 0) {
      return;
    }

    /*
     * GitHub can deliver a removal after the same repository has been added
     * again. Only current installation membership can authorize disconnection.
     * A failed lookup leaves every repository intact and retries the delivery.
     */
    const currentRepositories: Array<GitHubRepository> =
      await GitHubUtil.listRepositoriesForInstallation(installationId);
    const currentRepositoryNames: Set<string> = new Set(
      currentRepositories.map((repository: GitHubRepository): string => {
        return repository.fullName.toLowerCase();
      }),
    );

    for (const removedRepository of removedRepositories) {
      const fullName: unknown = (removedRepository as JSONObject)?.[
        "full_name"
      ];
      const repositoryNamePattern: RegExp =
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
      if (
        typeof fullName !== "string" ||
        !repositoryNamePattern.test(fullName) ||
        fullName.split("/").some((part: string): boolean => {
          return part === "." || part === "..";
        })
      ) {
        continue;
      }

      if (currentRepositoryNames.has(fullName.toLowerCase())) {
        continue;
      }

      const slashIndex: number = fullName.indexOf("/");

      if (slashIndex <= 0) {
        continue;
      }

      const organizationName: string = fullName.substring(0, slashIndex);
      const repositoryName: string = fullName.substring(slashIndex + 1);

      const disconnectedCount: number = await CodeRepositoryService.updateBy({
        query: {
          gitHubAppInstallationId: installationId,
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: new Wildcard(organizationName),
          repositoryName: new Wildcard(repositoryName),
        },
        data: { gitHubAppInstallationId: null as unknown as string },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `GitHub webhook: disconnected ${disconnectedCount} repository record(s) for ${fullName} (installation ${installationId})`,
      );
    }
  }
}
