import { createHash } from "crypto";
import { EntityManager } from "typeorm";
import Model from "../../Models/DatabaseModels/DiscordCreationDraft";
import ProjectToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import UserToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import DiscordBindingService, {
  DiscordBindingSnapshot,
} from "./DiscordBindingService";

const DRAFT_TTL_MS: number = 10 * 60 * 1000;
const MAX_CONTENT_BYTES: number = 64 * 1024;
const SNOWFLAKE_PATTERN: RegExp = /^[0-9]{17,20}$/;

export interface DiscordDraftScope {
  applicationId: string;
  projectId: ObjectID;
  userId: ObjectID;
  guildId: string;
  channelId: string;
  discordUserId: string;
}

export interface DiscordDraftView {
  id: ObjectID;
  revision: number;
  reviewedRevision?: number;
  expiresAt: Date;
  content: JSONObject;
}

export type DiscordDraftOutcome =
  | {
      kind: "created";
      resourceType: "Incident" | "ScheduledMaintenance";
      resourceId: string;
    }
  | { kind: "ambiguous" }
  | { kind: "cancelled" };

type Rejected = { kind: "rejected"; reason: string };
type Closed =
  | { kind: "in_progress" }
  | { kind: "terminal"; outcome: DiscordDraftOutcome }
  | Rejected;
export type DiscordDraftRead =
  | { kind: "open"; draft: DiscordDraftView }
  | Closed;
export type DiscordDraftClaim =
  | { kind: "acquired"; claimId: ObjectID; content: JSONObject }
  | Closed;
interface DraftKey {
  id: ObjectID;
  scope: DiscordDraftScope;
}

/*
 * No domain handler runs inside this service's transaction. Committing is a
 * durable, non-stealable state: uncertain completion requires reconciliation,
 * never an automatic second creation. Interaction receipts are independent.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("expiresAt", 1);
  }

  private assertId(id: ObjectID): void {
    if (!(id instanceof ObjectID) || !ObjectID.isValidUUID(id.toString())) {
      throw new BadDataException("Invalid Discord draft identity.");
    }
  }

  private assertScope(scope: DiscordDraftScope): void {
    this.assertId(scope.projectId);
    this.assertId(scope.userId);
    for (const value of [
      scope.applicationId,
      scope.guildId,
      scope.channelId,
      scope.discordUserId,
    ]) {
      if (
        typeof value !== "string" ||
        !SNOWFLAKE_PATTERN.test(value) ||
        BigInt(value) > BigInt("18446744073709551615")
      ) {
        throw new BadDataException("Invalid Discord draft context.");
      }
    }
  }

  private scopeKey(scope: DiscordDraftScope): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          scope.applicationId,
          scope.projectId.toString(),
          scope.userId.toString(),
          scope.guildId,
          scope.channelId,
          scope.discordUserId,
        ]),
      )
      .digest("hex");
  }

  private assertContent(content: JSONObject): void {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      throw new BadDataException("Invalid Discord draft content.");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(content);
    } catch {
      throw new BadDataException("Invalid Discord draft content.");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONTENT_BYTES) {
      throw new BadDataException("Discord draft content is too large.");
    }
  }

  private assertRevision(revision: number): void {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision >= 2147483647
    ) {
      throw new BadDataException("Invalid Discord draft revision.");
    }
  }

  private assertOutcome(outcome: DiscordDraftOutcome): void {
    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      throw new BadDataException("Invalid Discord draft outcome.");
    }
    const allowed: Array<string> =
      outcome.kind === "created"
        ? ["kind", "resourceType", "resourceId"]
        : ["kind"];
    if (
      Object.keys(outcome).some((key: string): boolean => {
        return !allowed.includes(key);
      }) ||
      !["created", "ambiguous", "cancelled"].includes(outcome.kind) ||
      (outcome.kind === "created" &&
        (!["Incident", "ScheduledMaintenance"].includes(outcome.resourceType) ||
          typeof outcome.resourceId !== "string" ||
          !ObjectID.isValidUUID(outcome.resourceId)))
    ) {
      throw new BadDataException("Invalid Discord draft outcome.");
    }
  }

  private async locked<T>(
    scope: DiscordDraftScope,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.assertScope(scope);
    return this.executeTransaction(
      async (manager: EntityManager): Promise<T> => {
        await manager.query("SET LOCAL lock_timeout = '5s'");
        await manager.query("SET LOCAL statement_timeout = '10s'");
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`discord-binding:${scope.projectId}`],
        );
        return action(manager);
      },
    );
  }

  private async liveBinding(
    manager: EntityManager,
    scope: DiscordDraftScope,
  ): Promise<string | null> {
    const snapshot: DiscordBindingSnapshot =
      await DiscordBindingService.snapshotWithManager(
        scope.projectId,
        scope.userId,
        manager,
      );
    const project: ProjectToken | null = await manager
      .getRepository(ProjectToken)
      .findOne({
        where: {
          projectId: scope.projectId,
          workspaceType: WorkspaceType.Discord,
        },
      });
    const user: UserToken | null = await manager
      .getRepository(UserToken)
      .findOne({
        where: {
          projectId: scope.projectId,
          userId: scope.userId,
          workspaceType: WorkspaceType.Discord,
        },
      });
    return snapshot.workspaceProjectId === scope.guildId &&
      project?.authToken &&
      !project.deletedAt &&
      user?.authToken &&
      !user.deletedAt &&
      user.workspaceUserId === scope.discordUserId
      ? snapshot.fingerprint
      : null;
  }

  private async now(manager: EntityManager): Promise<Date> {
    const rows: Array<{ now: Date }> = await manager.query(
      "SELECT clock_timestamp() AS now",
    );
    if (!(rows[0]?.now instanceof Date)) {
      throw new Error("Database clock unavailable");
    }
    return rows[0].now;
  }

  private view(row: Model): DiscordDraftView {
    if (!row.id || !row.revision || !row.expiresAt || !row.content) {
      throw new BadDataException("Discord draft is unavailable.");
    }
    return {
      id: row.id,
      revision: row.revision,
      expiresAt: row.expiresAt,
      content: row.content,
      ...(row.reviewedRevision
        ? { reviewedRevision: row.reviewedRevision }
        : {}),
    };
  }

  private closed(row: Model): Closed | null {
    if (row.status === "Open") {
      return null;
    }
    if (row.status === "Committing") {
      return { kind: "in_progress" };
    }
    if (
      ["Completed", "Ambiguous", "Cancelled"].includes(row.status || "") &&
      row.outcome
    ) {
      const outcome: DiscordDraftOutcome =
        row.outcome as unknown as DiscordDraftOutcome;
      this.assertOutcome(outcome);
      return { kind: "terminal", outcome };
    }
    return { kind: "rejected", reason: "This draft is no longer available." };
  }

  private async withRow<T>(
    key: DraftKey,
    action: (row: Model, manager: EntityManager) => Promise<T>,
  ): Promise<T | Rejected> {
    this.assertId(key.id);
    return this.locked(
      key.scope,
      async (manager: EntityManager): Promise<T | Rejected> => {
        const row: Model | null = await manager.getRepository(Model).findOne({
          where: {
            _id: key.id.toString(),
            projectId: key.scope.projectId,
            scopeKey: this.scopeKey(key.scope),
          },
          lock: { mode: "pessimistic_write" },
        });
        if (!row) {
          return {
            kind: "rejected",
            reason: "Draft not found for this context.",
          };
        }
        const fingerprint: string | null = await this.liveBinding(
          manager,
          key.scope,
        );
        const expired: boolean =
          row.status === "Open" &&
          (!row.expiresAt || row.expiresAt <= (await this.now(manager)));
        if (!fingerprint || fingerprint !== row.bindingFingerprint || expired) {
          row.content = null;
          row.reviewedRevision = null;
          if (row.status === "Open") {
            row.status = expired ? "Expired" : "Rejected";
          }
          await manager.getRepository(Model).save(row);
          // Return refusal so the transaction commits the erasure.
          return {
            kind: "rejected",
            reason: expired
              ? "Draft expired. Start again."
              : "Discord connection changed. Start again.",
          };
        }
        return action(row, manager);
      },
    );
  }

  public async open(data: {
    scope: DiscordDraftScope;
    content: JSONObject;
  }): Promise<DiscordDraftView> {
    this.assertContent(data.content);
    return this.locked(
      data.scope,
      async (manager: EntityManager): Promise<DiscordDraftView> => {
        const fingerprint: string | null = await this.liveBinding(
          manager,
          data.scope,
        );
        if (!fingerprint) {
          throw new BadDataException("Discord connection is unavailable.");
        }
        const row: Model = new Model();
        row.id = ObjectID.generate();
        row.projectId = data.scope.projectId;
        row.scopeKey = this.scopeKey(data.scope);
        row.bindingFingerprint = fingerprint;
        row.status = "Open";
        row.revision = 1;
        row.content = data.content;
        row.expiresAt = new Date(
          (await this.now(manager)).getTime() + DRAFT_TTL_MS,
        );
        await manager.getRepository(Model).save(row);
        return this.view(row);
      },
    );
  }

  public async read(key: DraftKey): Promise<DiscordDraftRead> {
    return this.withRow(key, async (row: Model): Promise<DiscordDraftRead> => {
      return this.closed(row) || { kind: "open", draft: this.view(row) };
    });
  }

  public async change(
    data: DraftKey & { revision: number; content: JSONObject; review: boolean },
  ): Promise<DiscordDraftRead> {
    this.assertContent(data.content);
    this.assertRevision(data.revision);
    return this.withRow(
      data,
      async (row: Model, manager: EntityManager): Promise<DiscordDraftRead> => {
        const closed: Closed | null = this.closed(row);
        if (closed) {
          return closed;
        }
        if (row.revision !== data.revision) {
          return {
            kind: "rejected",
            reason: "Draft changed. Open the latest message.",
          };
        }
        row.revision = data.revision + 1;
        row.content = data.content;
        row.reviewedRevision = data.review === true ? row.revision : null;
        await manager.getRepository(Model).save(row);
        return { kind: "open", draft: this.view(row) };
      },
    );
  }

  public async claim(
    data: DraftKey & { revision: number },
  ): Promise<DiscordDraftClaim> {
    this.assertRevision(data.revision);
    return this.withRow(
      data,
      async (
        row: Model,
        manager: EntityManager,
      ): Promise<DiscordDraftClaim> => {
        const closed: Closed | null = this.closed(row);
        if (closed) {
          return closed;
        }
        if (
          row.revision !== data.revision ||
          row.reviewedRevision !== row.revision ||
          !row.content
        ) {
          return {
            kind: "rejected",
            reason: "Review the current draft first.",
          };
        }
        const content: JSONObject = row.content;
        const claimId: ObjectID = ObjectID.generate();
        row.status = "Committing";
        row.claimId = claimId;
        row.content = null;
        row.reviewedRevision = null;
        await manager.getRepository(Model).save(row);
        return { kind: "acquired", claimId, content };
      },
    );
  }

  public async cancel(key: DraftKey): Promise<DiscordDraftRead> {
    return this.withRow(
      key,
      async (row: Model, manager: EntityManager): Promise<DiscordDraftRead> => {
        const closed: Closed | null = this.closed(row);
        if (closed) {
          return closed;
        }
        row.status = "Cancelled";
        row.content = null;
        row.reviewedRevision = null;
        row.outcome = { kind: "cancelled" };
        await manager.getRepository(Model).save(row);
        return { kind: "terminal", outcome: { kind: "cancelled" } };
      },
    );
  }

  public async finish(
    data: DraftKey & { claimId: ObjectID; outcome: DiscordDraftOutcome },
  ): Promise<boolean> {
    this.assertId(data.claimId);
    this.assertOutcome(data.outcome);
    if (data.outcome.kind === "cancelled") {
      throw new BadDataException("A claimed draft cannot be cancelled.");
    }
    const result: boolean | Rejected = await this.withRow(
      data,
      async (row: Model, manager: EntityManager): Promise<boolean> => {
        if (row.claimId?.toString() !== data.claimId.toString()) {
          return false;
        }
        if (row.status !== "Committing") {
          if (
            !["Completed", "Ambiguous"].includes(row.status || "") ||
            !row.outcome
          ) {
            return false;
          }
          const previous: DiscordDraftOutcome =
            row.outcome as unknown as DiscordDraftOutcome;
          this.assertOutcome(previous);
          return (
            previous.kind === data.outcome.kind &&
            (previous.kind !== "created" ||
              (data.outcome.kind === "created" &&
                previous.resourceType === data.outcome.resourceType &&
                previous.resourceId === data.outcome.resourceId))
          );
        }
        row.status =
          data.outcome.kind === "created" ? "Completed" : "Ambiguous";
        row.content = null;
        row.outcome = data.outcome;
        await manager.getRepository(Model).save(row);
        return true;
      },
    );
    return result === true;
  }

  public async clearExpiredContent(): Promise<void> {
    await this.getRepository().query(
      `UPDATE "DiscordCreationDraft" SET "content" = NULL, "reviewedRevision" = NULL,
       "status" = CASE WHEN "status" = 'Open' THEN 'Expired' ELSE "status" END,
       "updatedAt" = now() WHERE "expiresAt" <= now() AND "content" IS NOT NULL`,
    );
  }
}

export default new Service();
