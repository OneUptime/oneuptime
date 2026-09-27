import { createHash } from "crypto";
import { EntityManager, IsNull } from "typeorm";
import DatabaseService from "./DatabaseService";
import ProjectToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import UserTokenService from "./WorkspaceUserAuthTokenService";
import UserDiscordService from "./UserDiscordService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { DiscordBotToken } from "../EnvironmentConfig";
import WorkspaceOAuthState, {
  WorkspaceOAuthStateRecord,
} from "../Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../Utils/Workspace/WorkspaceActionAuthorization";
import CommonAPI from "../API/CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * Why a dedicated service (review ask, HOM-37): install/link/setParent/
 * disconnect each transition BOTH binding rows (project auth token and user
 * auth token) atomically, under one per-project advisory lock, with an
 * OAuth-state fingerprint re-check inside the transaction. The generic
 * WorkspaceProjectAuthTokenService/WorkspaceUserAuthTokenService manage one
 * row each and have no cross-row lock or snapshot guard; growing those
 * primitives there would leak Discord's concurrency contract into every
 * other workspace type. resolveLinkedMember is the Discord-only reverse
 * lookup the interaction handlers need. Delivery uses the deployment bot
 * token, so a linked identity stores no reusable credential.
 */

export interface DiscordBindingSnapshot {
  fingerprint: string;
  workspaceProjectId?: string | undefined;
}

interface BindingRows {
  project: ProjectToken | null;
  user: UserToken | null;
}

class Service extends DatabaseService<ProjectToken> {
  public constructor() {
    super(ProjectToken);
  }

  private async locked<T>(
    projectId: ObjectID,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return await this.executeTransaction(
      async (manager: EntityManager): Promise<T> => {
        await manager.query("SET LOCAL lock_timeout = '5s'");
        await manager.query("SET LOCAL statement_timeout = '10s'");
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          ["discord-binding:" + projectId.toString()],
        );
        return await action(manager);
      },
    );
  }

  private async rows(
    manager: EntityManager,
    projectId: ObjectID,
    userId?: ObjectID,
  ): Promise<BindingRows> {
    const projects: Array<ProjectToken> = await manager
      .getRepository(ProjectToken)
      .find({
        where: { projectId, workspaceType: WorkspaceType.Discord },
        withDeleted: true,
      });
    const users: Array<UserToken> = userId
      ? await manager.getRepository(UserToken).find({
          where: { projectId, userId, workspaceType: WorkspaceType.Discord },
          withDeleted: true,
        })
      : [];
    if (projects.length > 1 || users.length > 1) {
      throw new BadDataException(
        "Discord has ambiguous connection records. Resolve duplicate bindings before reconnecting.",
      );
    }
    return { project: projects[0] || null, user: users[0] || null };
  }

  private fingerprint(rows: BindingRows): string {
    const version: (row: ProjectToken | UserToken | null) => unknown = (
      row: ProjectToken | UserToken | null,
    ): unknown => {
      return row
        ? [row._id, row.version, row.deletedAt?.toISOString() || null]
        : null;
    };
    return createHash("sha256")
      .update(JSON.stringify([version(rows.project), version(rows.user)]))
      .digest("hex");
  }

  public async snapshot(
    projectId: ObjectID,
    userId?: ObjectID,
  ): Promise<DiscordBindingSnapshot> {
    return await this.locked(
      projectId,
      async (manager: EntityManager): Promise<DiscordBindingSnapshot> => {
        return this.snapshotWithManager(projectId, userId, manager);
      },
    );
  }

  /*
   * Internal transaction primitive. The caller must already hold this project's
   * discord-binding advisory lock in the supplied active transaction. Reusing
   * that manager avoids taking the same lock in a nested transaction.
   */
  public async snapshotWithManager(
    projectId: ObjectID,
    userId: ObjectID | undefined,
    manager: EntityManager,
  ): Promise<DiscordBindingSnapshot> {
    const rows: BindingRows = await this.rows(manager, projectId, userId);
    return {
      fingerprint: this.fingerprint(rows),
      workspaceProjectId:
        rows.project && !rows.project.deletedAt
          ? rows.project.workspaceProjectId
          : undefined,
    };
  }

  private assertSnapshot(
    rows: BindingRows,
    expected: string | undefined,
  ): void {
    if (!expected || expected !== this.fingerprint(rows)) {
      throw new BadDataException(
        "This Discord connection changed while authorization was in progress. Start again.",
      );
    }
  }

  private async authorize(
    projectId: ObjectID,
    userId: ObjectID,
    manage: boolean,
  ): Promise<void> {
    const databaseProps: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        projectId,
        userId,
      });
    if (manage) {
      CommonAPI.assertPermittedInProject({
        databaseProps,
        allowedPermissions: WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
        errorMessage:
          "You do not have permission to manage this Discord connection.",
      });
    }
  }

  public async install(data: {
    state: WorkspaceOAuthStateRecord;
    guildId: string;
    guildName: string;
    botUserId: string;
  }): Promise<void> {
    await this.locked(
      data.state.projectId,
      async (manager: EntityManager): Promise<void> => {
        const rows: BindingRows = await this.rows(
          manager,
          data.state.projectId,
        );
        this.assertSnapshot(rows, data.state.bindingSnapshot);
        const live: boolean = Boolean(rows.project && !rows.project.deletedAt);
        if (live && rows.project!.workspaceProjectId !== data.guildId) {
          throw new BadDataException(
            "Disconnect the existing Discord server before connecting a different server.",
          );
        }
        await this.authorize(data.state.projectId, data.state.userId, true);
        if (!DiscordBotToken) {
          throw new BadDataException("Discord bot is not configured.");
        }
        const miscData: JSONObject = {
          ...(live ? rows.project!.miscData : {}),
          guildName: data.guildName,
          botUserId: data.botUserId,
        };
        const values: Partial<ProjectToken> = {
          projectId: data.state.projectId,
          workspaceType: WorkspaceType.Discord,
          workspaceProjectId: data.guildId,
          authToken: DiscordBotToken,
          miscData,
          deletedAt: null as unknown as Date,
        };
        if (rows.project) {
          await manager.query(
            `UPDATE "WorkspaceProjectAuthToken" SET "authToken" = $1, "workspaceProjectId" = $2,
             "miscData" = $3, "deletedAt" = NULL, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $4`,
            [
              DiscordBotToken,
              data.guildId,
              JSON.stringify(miscData),
              rows.project._id,
            ],
          );
        } else {
          await manager
            .getRepository(ProjectToken)
            .save(manager.getRepository(ProjectToken).create(values));
        }
      },
    );
  }

  public async link(data: {
    state: WorkspaceOAuthStateRecord;
    identity: JSONObject;
  }): Promise<void> {
    await this.locked(
      data.state.projectId,
      async (manager: EntityManager): Promise<void> => {
        const rows: BindingRows = await this.rows(
          manager,
          data.state.projectId,
          data.state.userId,
        );
        this.assertSnapshot(rows, data.state.bindingSnapshot);
        if (
          !rows.project ||
          rows.project.deletedAt ||
          rows.project.workspaceProjectId !== data.state.workspaceProjectId
        ) {
          throw new BadDataException(
            "The project's Discord connection changed. Start again.",
          );
        }
        const discordUserId: string = String(data.identity["id"]);
        const duplicate: UserToken | null = await manager
          .getRepository(UserToken)
          .findOne({
            where: {
              projectId: data.state.projectId,
              workspaceType: WorkspaceType.Discord,
              workspaceUserId: discordUserId,
              deletedAt: IsNull(),
            },
          });
        if (
          duplicate &&
          duplicate.userId?.toString() !== data.state.userId.toString()
        ) {
          throw new BadDataException(
            "This Discord account is already linked to another user in this project.",
          );
        }
        await this.authorize(data.state.projectId, data.state.userId, false);
        // Methods that page the previous Discord account must not survive a relink.
        if (rows.user && rows.user.workspaceUserId !== discordUserId) {
          await UserDiscordService.deleteMethodsForBinding(manager, {
            scope: "user",
            projectId: data.state.projectId,
            userId: data.state.userId,
          });
        }
        const values: Partial<UserToken> = {
          projectId: data.state.projectId,
          userId: data.state.userId,
          workspaceType: WorkspaceType.Discord,
          workspaceUserId: discordUserId,
          // A verified identity has no reusable user credential. Delivery uses the deployment bot.
          authToken: "discord-verified-identity",
          deletedAt: null as unknown as Date,
          miscData: {
            userId: discordUserId,
            username: String(data.identity["username"] || ""),
            displayName: String(
              data.identity["global_name"] ||
                data.identity["username"] ||
                "Discord user",
            ),
          },
        };
        if (rows.user) {
          await manager.query(
            `UPDATE "WorkspaceUserAuthToken" SET "authToken" = $1, "workspaceUserId" = $2,
             "miscData" = $3, "deletedAt" = NULL, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $4`,
            [
              values.authToken,
              discordUserId,
              JSON.stringify(values.miscData),
              rows.user._id,
            ],
          );
        } else {
          await manager
            .getRepository(UserToken)
            .save(manager.getRepository(UserToken).create(values));
        }
      },
    );
  }

  public async setParent(data: {
    projectId: ObjectID;
    userId: ObjectID;
    binding: DiscordBindingSnapshot;
    channelId: string;
  }): Promise<void> {
    await this.locked(
      data.projectId,
      async (manager: EntityManager): Promise<void> => {
        const rows: BindingRows = await this.rows(manager, data.projectId);
        this.assertSnapshot(rows, data.binding.fingerprint);
        if (!rows.project || rows.project.deletedAt) {
          throw new BadDataException("Discord is no longer connected.");
        }
        await this.authorize(data.projectId, data.userId, true);
        await manager.query(
          `UPDATE "WorkspaceProjectAuthToken" SET "miscData" = $1, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $2`,
          [
            JSON.stringify({
              ...rows.project.miscData,
              incidentChannelId: data.channelId,
            }),
            rows.project._id,
          ],
        );
      },
    );
  }

  /*
   * Maps a Discord guild + user to the OneUptime project member who linked
   * that Discord account. Used by interaction handlers that must execute a
   * project action on behalf of a Discord user: only verified links count,
   * and the project binding must still be live.
   */
  public async resolveLinkedMember(data: {
    guildId: string;
    discordUserId: string;
  }): Promise<{ projectId: ObjectID; userId: ObjectID } | null> {
    const project: ProjectToken | null = await this.findOneBy({
      query: {
        workspaceType: WorkspaceType.Discord,
        workspaceProjectId: data.guildId,
      },
      select: {
        projectId: true,
        miscData: true,
      },
      props: {
        isRoot: true,
      },
    });
    if (!project || project.deletedAt || !project.projectId) {
      return null;
    }
    const user: UserToken | null = await UserTokenService.findOneBy({
      query: {
        projectId: project.projectId,
        workspaceType: WorkspaceType.Discord,
        workspaceUserId: data.discordUserId,
      },
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });
    if (!user || user.deletedAt || !user.userId) {
      return null;
    }
    return { projectId: project.projectId, userId: user.userId };
  }

  /*
   * The caller has applied the model's delete permissions and selected IDs.
   * Tombstones preserve OAuth generations. Normal queries exclude them; the
   * existing worker purges them only after 30 days, beyond the 900-second state TTL.
   * Every statement here uses this transaction's manager, including the cascade.
   */
  public async disconnect(data: {
    projectId: ObjectID;
    id: string;
    user: boolean;
  }): Promise<number> {
    return await this.locked(
      data.projectId,
      async (manager: EntityManager): Promise<number> => {
        const model: typeof ProjectToken | typeof UserToken = data.user
          ? UserToken
          : ProjectToken;
        const row: ProjectToken | UserToken | null = await manager
          .getRepository(model)
          .findOne({
            where: {
              _id: data.id,
              projectId: data.projectId,
              workspaceType: WorkspaceType.Discord,
              deletedAt: IsNull(),
            },
          });
        if (!row) {
          return 0;
        }
        const values: {
          deletedAt: Date;
          authToken: string;
          miscData: Record<string, never>;
        } = { deletedAt: new Date(), authToken: "", miscData: {} };
        // Personal Discord methods point at these links; they go in this transaction.
        await UserDiscordService.deleteMethodsForBinding(
          manager,
          data.user
            ? {
                scope: "user",
                projectId: data.projectId,
                userId: (row as UserToken).userId!,
              }
            : { scope: "project", projectId: data.projectId },
        );
        if (!data.user) {
          await manager.getRepository(UserToken).update(
            {
              projectId: data.projectId,
              workspaceType: WorkspaceType.Discord,
              deletedAt: IsNull(),
            },
            values,
          );
        }
        await manager.getRepository(model).update({ _id: data.id }, values);
        return 1;
      },
    );
  }
}

export default new Service();
