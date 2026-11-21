import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityBlocklistFeed";
import { EncryptionSecret } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import PresentedKey from "../Utils/PresentedKey/PresentedKey";
import SecretKeyComparison from "../Utils/SecretKeyComparison";
import SecurityBlocklistJobs from "../Utils/SecurityBlocklist/SecurityBlocklistJobs";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS,
  SecurityBlocklistFeedAllowlist,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedFirewall,
  getSecurityBlocklistFeedSecretHint,
  isPreviousSecurityBlocklistFeedSecretInGrace,
  isSecurityBlocklistFeedFamily,
  isSecurityBlocklistFeedFirewall,
  isSecurityBlocklistFeedSecretShape,
  readSecurityBlocklistFeedAllowlist,
} from "../../Types/SecurityBlocklist/SecurityBlocklistFeed";

/*
 * A PROJECT'S BLOCKLIST FEEDS (#10345): the secret URLs its firewalls read
 * the blocklist from.
 *
 * The secret is made here, on the server (PresentedKey.generate: 256 random
 * bits as 64 hex digits), and kept only as its hash - the SHA-256 of it with
 * the server's ENCRYPTION_SECRET, as a project API key's - with its last
 * four characters to tell it by. It is answered once: to the create that
 * makes the feed (onCreateSuccess hands it on the created record, which
 * BaseAPI answers) and to a rotation (rotateSecret), and never again. Nobody
 * reads it or its hash through the API (onBeforeFind), and nobody but
 * OneUptime writes either (assertSecretWrittenHere).
 *
 * A rotation keeps the secret it replaced working for a day
 * (SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS), so every firewall can be
 * given the new one without a gap; a second rotation within the day ends
 * the oldest at once (a feed keeps one secret and the one before it).
 * Revoking ends both at once: a secret that leaked stops working on the
 * next fetch, and the feed answers nobody until a new one is made.
 *
 * Every change to a feed - made, changed, rotated, revoked, deleted -
 * reconciles the project's blocklist at once, so its blocks' rows say what
 * the feed holds now.
 */

export const SECRET_WRITTEN_HERE_MESSAGE: string =
  "A feed's secret cannot be set through the API. Rotate or revoke it on the feed's page under Security Events > Blocklist Feeds, or with POST /security-blocklist-feed/:id/rotate-secret or /revoke-secret.";

// The columns a secret is written in: written together, only by rotateSecret and revokeSecret.
const SECRET_COLUMNS: ReadonlyArray<string> = [
  "secret",
  "secretHint",
  "secretMadeAt",
  "previousSecret",
  "previousSecretExpiresAt",
  "revokedAt",
];

// What only OneUptime reads of a feed: the secrets' hashes, and what a firewall was served.
const SERVER_ONLY_COLUMNS: ReadonlyArray<string> = [
  "secret",
  "previousSecret",
  "servedValues",
  "servedBodyMd5",
];

// A secret just made: the secret itself, answered once, and what is kept of it.
export interface MadeSecurityBlocklistFeedSecret {
  secret: string;
  secretHint: string;
  // When the secret it replaced stops working; null when there was none.
  previousSecretExpiresAt: Date | null;
}

// Which of a feed's secrets a request presented.
export enum SecurityBlocklistFeedSecretMatch {
  Current = "Current",
  Previous = "Previous",
}

// What onBeforeCreate hands onCreateSuccess: the secret it made.
interface CreateCarryForward {
  secret: string;
}

// A feed as the route that serves it reads it.
export const SECURITY_BLOCKLIST_FEED_SERVE_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  family: true;
  allowedSourceAddresses: true;
  secret: true;
  previousSecret: true;
  previousSecretExpiresAt: true;
  revokedAt: true;
  lastFetchedAt: true;
  servedValues: true;
  servedConfirmedAt: true;
  servedBodyMd5: true;
  stoppedReadingToldAt: true;
} = {
  _id: true,
  projectId: true,
  name: true,
  family: true,
  allowedSourceAddresses: true,
  secret: true,
  previousSecret: true,
  previousSecretExpiresAt: true,
  revokedAt: true,
  lastFetchedAt: true,
  servedValues: true,
  servedConfirmedAt: true,
  servedBodyMd5: true,
  stoppedReadingToldAt: true,
};

export class Service extends ProjectReferencesService<Model> {
  /*
   * The writes rotateSecret and revokeSecret make: only these may name a
   * secret's columns. Only this service adds to it.
   */
  private readonly secretWrites: WeakSet<object> = new WeakSet<object>();

  public constructor() {
    super(Model);
  }

  // ---------- The secret ----------

  // A new secret: 256 bits from the server's secure random source, as 64 hex digits.
  public generateSecret(): string {
    return PresentedKey.generate();
  }

  // What a secret is kept as: the SHA-256 of it with ENCRYPTION_SECRET.
  public hashSecret(secret: string): string {
    return HashedString.computeHash(secret, EncryptionSecret);
  }

  /*
   * Which of the feed's secrets a request presents: its current one, the
   * one a rotation replaced while its day lasts, or neither. Each is
   * compared in constant time, and both always are, so how long it takes
   * says nothing of which matched. A value that is not shaped like a secret
   * matches none, without being hashed.
   */
  public matchSecret(data: {
    feed: Pick<Model, "secret" | "previousSecret" | "previousSecretExpiresAt">;
    presented: string | null | undefined;
    now: Date;
  }): SecurityBlocklistFeedSecretMatch | null {
    const presented: string = (data.presented || "").trim();
    const isShaped: boolean = isSecurityBlocklistFeedSecretShape(presented);
    const hash: string = isShaped ? this.hashSecret(presented) : "";

    const current: string = data.feed.secret?.toString() || "";
    const previous: string =
      data.feed.previousSecret &&
      isPreviousSecurityBlocklistFeedSecretInGrace({
        previousSecretExpiresAt: data.feed.previousSecretExpiresAt,
        now: data.now,
      })
        ? data.feed.previousSecret.toString()
        : "";

    const isCurrent: boolean = SecretKeyComparison.timingSafeEqual(
      hash,
      current,
    );
    const isPrevious: boolean = SecretKeyComparison.timingSafeEqual(
      hash,
      previous,
    );

    if (!isShaped || !hash) {
      return null;
    }

    if (current && isCurrent) {
      return SecurityBlocklistFeedSecretMatch.Current;
    }

    if (previous && isPrevious) {
      return SecurityBlocklistFeedSecretMatch.Previous;
    }

    return null;
  }

  /*
   * Gives the feed a new secret (Rotate Secret on its page, POST
   * /security-blocklist-feed/:id/rotate-secret), and answers it: it is never
   * stored, logged or sent again. The secret it replaces keeps working for a
   * day; a feed whose secret was revoked keeps none.
   *
   * Written with the caller's props, so a rotation asks what changing the
   * feed always asks: the record's update rule, the columns' update access
   * (Project Owner, Project Admin, Security Admin or Edit Security Blocklist
   * Feed) and the record being theirs to change. The audit log records who
   * rotated it - never the secret.
   */
  @CaptureSpan()
  public async rotateSecret(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MadeSecurityBlocklistFeedSecret> {
    const now: Date = OneUptimeDate.getCurrentDate();

    // The feed as the caller may read it: one they cannot is one they cannot rotate.
    const visible: Model | null = await this.findOneById({
      id: data.id,
      select: { _id: true },
      props: data.props,
    });

    if (!visible) {
      throw await this.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    // Its current secret, read as OneUptime: nobody reads it through the API.
    const feed: Model | null = await this.findOneById({
      id: data.id,
      select: { _id: true, secret: true, revokedAt: true },
      props: { isRoot: true },
    });

    const currentHash: string = feed?.secret?.toString() || "";
    const secret: string = this.generateSecret();
    const secretHint: string = getSecurityBlocklistFeedSecretHint(secret);
    const previousSecretExpiresAt: Date | null = currentHash
      ? new Date(now.getTime() + SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS)
      : null;

    const write: Record<string, unknown> = {
      secret: new HashedString(this.hashSecret(secret), true),
      secretHint: secretHint,
      secretMadeAt: now,
      previousSecret: currentHash ? new HashedString(currentHash, true) : null,
      previousSecretExpiresAt: previousSecretExpiresAt,
      revokedAt: null,
    };

    this.secretWrites.add(write);

    const updated: number = await this.updateOneById({
      id: data.id,
      data: write as never,
      props: data.props,
    });

    if (updated === 0) {
      throw await this.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    return { secret, secretHint, previousSecretExpiresAt };
  }

  /*
   * Ends the feed's secrets at once (Revoke Secret on its page, POST
   * /security-blocklist-feed/:id/revoke-secret): the current one and the
   * one a rotation replaced. From the next fetch the feed answers nobody,
   * so its blocks stop being confirmed there, and a new secret (Rotate
   * Secret) brings it back. Written with the caller's props, as a rotation.
   */
  @CaptureSpan()
  public async revokeSecret(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const write: Record<string, unknown> = {
      secret: null,
      secretHint: null,
      secretMadeAt: null,
      previousSecret: null,
      previousSecretExpiresAt: null,
      revokedAt: OneUptimeDate.getCurrentDate(),
    };

    this.secretWrites.add(write);

    const updated: number = await this.updateOneById({
      id: data.id,
      data: write as never,
      props: data.props,
    });

    if (updated === 0) {
      throw await this.getUnwrittenByIdError({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }
  }

  // ---------- The feed ----------

  /*
   * A feed as its route reads it, as OneUptime: its secrets' hashes and
   * what its firewall holds. Null when there is none.
   */
  @CaptureSpan()
  public async findForServe(feedId: ObjectID): Promise<Model | null> {
    return await this.findOneById({
      id: feedId,
      select: SECURITY_BLOCKLIST_FEED_SERVE_SELECT,
      props: { isRoot: true },
    });
  }

  // A project's feeds, as the reconciler and the health checks read them.
  @CaptureSpan()
  public async findForProject(projectId: ObjectID): Promise<Array<Model>> {
    return await this.findBy({
      query: { projectId: projectId },
      select: {
        _id: true,
        projectId: true,
        name: true,
        firewall: true,
        family: true,
        secret: true,
        revokedAt: true,
        lastFetchedAt: true,
        servedValues: true,
        servedConfirmedAt: true,
      },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });
  }

  /*
   * What a person writes of a feed, the one way: a name trimmed, a firewall
   * and what it serves from their lists, and an allowlist read the way
   * addresses are kept, one a line. Refuses what cannot be read.
   */
  private normalizeSettings(data: Record<string, unknown>): void {
    if (data["name"] !== undefined) {
      const name: string =
        typeof data["name"] === "string" ? data["name"].trim() : "";

      if (!name) {
        throw new BadDataException(
          "Give the feed a name: the firewall or proxy that reads it, such as Palo Alto edge firewall.",
        );
      }

      data["name"] = name.slice(0, 100);
    }

    if (
      data["firewall"] !== undefined &&
      !isSecurityBlocklistFeedFirewall(data["firewall"])
    ) {
      throw new BadDataException(
        `A feed's firewall is one of ${Object.values(SecurityBlocklistFeedFirewall).join(", ")}.`,
      );
    }

    if (
      data["family"] !== undefined &&
      !isSecurityBlocklistFeedFamily(data["family"])
    ) {
      throw new BadDataException(
        "A feed serves Both, IPv4 or IPv6 addresses.",
      );
    }

    if (data["allowedSourceAddresses"] !== undefined) {
      const allowlist: SecurityBlocklistFeedAllowlist =
        readSecurityBlocklistFeedAllowlist(
          typeof data["allowedSourceAddresses"] === "string"
            ? data["allowedSourceAddresses"]
            : "",
        );

      if (allowlist.problem) {
        throw new BadDataException(allowlist.problem);
      }

      data["allowedSourceAddresses"] =
        allowlist.entries.length > 0 ? allowlist.entries.join("\n") : null;
    }
  }

  /*
   * Refuses a write of a secret's columns that OneUptime did not make: they
   * are written only by rotateSecret and revokeSecret, together. An explicit
   * null counts as a write: clearing a secret ends it as surely as
   * replacing it.
   */
  public assertSecretWrittenHere(data: unknown): void {
    const record: Record<string, unknown> | undefined = data as
      | Record<string, unknown>
      | undefined;

    const isWritten: boolean = SECRET_COLUMNS.some((column: string): boolean => {
      return record?.[column] !== undefined;
    });

    if (!isWritten || (record && this.secretWrites.has(record))) {
      return;
    }

    throw new NotAuthorizedException(SECRET_WRITTEN_HERE_MESSAGE);
  }

  // ---------- The hooks ----------

  /*
   * A new feed gets its secret: its hash and its hint go into the write,
   * and the secret itself is carried to onCreateSuccess, for the create's
   * answer. Whatever the caller sent for them is replaced: a secret is the
   * server's to make.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    if (data["name"] === undefined) {
      data["name"] = "";
    }

    this.normalizeSettings(data);

    if (!createBy.data.firewall) {
      createBy.data.firewall = SecurityBlocklistFeedFirewall.Other;
    }

    if (!createBy.data.family) {
      createBy.data.family = SecurityBlocklistFeedFamily.Both;
    }

    const secret: string = this.generateSecret();
    const now: Date = OneUptimeDate.getCurrentDate();

    createBy.data.secret = new HashedString(this.hashSecret(secret), true);
    createBy.data.secretHint = getSecurityBlocklistFeedSecretHint(secret);
    createBy.data.secretMadeAt = now;

    const carryForward: CreateCarryForward = { secret };

    return { ...onCreate, carryForward };
  }

  /*
   * THE ONE ANSWER THAT HOLDS THE SECRET. The record is written with the
   * secret's hash; the record handed back to the create's caller holds the
   * secret itself in its place (a HashedString not yet hashed), so BaseAPI's
   * answer to POST /security-blocklist-feed carries it, once. Nothing saves
   * the record after this, and the audit log leaves the column out (nobody
   * may read it). The project's blocklist is reconciled: a new destination.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: CreateCarryForward | null =
      (onCreate.carryForward as CreateCarryForward | null) || null;

    if (carryForward?.secret) {
      createdItem.secret = new HashedString(carryForward.secret);
    }

    const projectId: ObjectID | undefined =
      createdItem.projectId || onCreate.createBy.data.projectId;

    if (projectId) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const onUpdate: OnUpdate<Model> = await super.onBeforeUpdate(updateBy);

    this.assertSecretWrittenHere(updateBy.data);
    this.normalizeSettings(
      updateBy.data as unknown as Record<string, unknown>,
    );

    return onUpdate;
  }

  // A feed changed - what it serves, its secret - says so on its blocks' rows at once.
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await this.queueReconcileOfFeeds(updatedItemIds);

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const feeds: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: { _id: true, projectId: true },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });

    return { deleteBy, carryForward: feeds };
  }

  // A deleted feed is no longer a destination: its blocks' rows say so at once.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const feeds: Array<Model> = (onDelete.carryForward as Array<Model>) || [];
    const projects: Map<string, ObjectID> = new Map();

    for (const feed of feeds) {
      if (feed.projectId) {
        projects.set(feed.projectId.toString(), feed.projectId);
      }
    }

    for (const projectId of projects.values()) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return onDelete;
  }

  /*
   * What only OneUptime reads, left out of what any caller but OneUptime
   * selects: no reader needs it - the secret is shown once, when it is
   * made - and a filter on it is refused by the read check (nobody may read
   * the columns). Dropped rather than refused, so a client that selects
   * every column it sees in the docs is answered everything else.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    return { findBy: this.dropServerOnlyColumns(findBy), carryForward: null };
  }

  public dropServerOnlyColumns(findBy: FindBy<Model>): FindBy<Model> {
    if (
      findBy.props.isRoot ||
      !findBy.select ||
      typeof findBy.select !== "object"
    ) {
      return findBy;
    }

    const select: Record<string, unknown> = {
      ...(findBy.select as Record<string, unknown>),
    };

    let isDropped: boolean = false;

    for (const column of SERVER_ONLY_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(select, column)) {
        delete select[column];
        isDropped = true;
      }
    }

    return isDropped
      ? { ...findBy, select: select as FindBy<Model>["select"] }
      : findBy;
  }

  private async queueReconcileOfFeeds(ids: Array<ObjectID>): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const projects: Map<string, ObjectID> = new Map();

    for (const id of ids) {
      const feed: Model | null = await this.findOneById({
        id,
        select: { _id: true, projectId: true },
        props: { isRoot: true },
      });

      if (feed?.projectId) {
        projects.set(feed.projectId.toString(), feed.projectId);
      }
    }

    for (const projectId of projects.values()) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }
  }
}

export default new Service();
