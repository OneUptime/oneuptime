import Redis, { ClientType } from "../../Infrastructure/Redis";
import GracefulShutdown, { ShutdownPriority } from "../GracefulShutdown";
import logger from "../Logger";
import RealtimeReaders from "./RealtimeReaders";
import RealtimeSessions from "./RealtimeSessions";
import type { TeamMemberService as TeamMemberServiceType } from "../../Services/TeamMemberService";
import type { Service as UserServiceType } from "../../Services/UserService";
import ObjectID from "../../../Types/ObjectID";

/*
 * A CHANGE TO WHAT SOMEONE MAY HEAR, MADE KNOWN TO EVERY SERVER AT ONCE.
 *
 * Each server keeps, for the people listening to it, who they are in each
 * project (RealtimeReaders, for 30 seconds), and the per-server answers
 * those are built from: whether they are blocked (UserService, for a
 * minute) and their teams in a project (TeamMemberService, for a minute).
 * A change made on one server used to reach the others only when those ran
 * out, and the server a person's socket is connected to is often not the
 * one that made the change.
 *
 * So the change is announced: the server that makes it applies it to
 * itself at once and publishes it on a Valkey channel every server
 * listens to (listen, from Realtime.init). Each one then forgets what it
 * held for that person, and ends the live updates of sessions that have
 * ended. A change only ever takes something away or makes a server read
 * again: nothing in a message can give anyone more than their reads
 * already give them.
 *
 * When the channel cannot be reached, a change still applies on the server
 * that made it, and the others catch up as their entries run out: 30
 * seconds for permissions, a minute for a block, and the access token's
 * lifetime for a session, whose sockets end when it expires
 * (RealtimeSessions).
 */

export enum RealtimeAccessChangeKind {
  // Their teams or their teams' permissions changed, in one project or every one.
  PermissionsChanged = "PermissionsChanged",
  // Their account changed: blocked or unblocked, made or no longer a server admin.
  AccountChanged = "AccountChanged",
  // Sessions ended: signed out, revoked, or every session of a person.
  SessionsEnded = "SessionsEnded",
}

export type RealtimeAccessChange =
  | {
      kind: RealtimeAccessChangeKind.PermissionsChanged;
      userId: string;
      // Absent: every project.
      projectId?: string | undefined;
    }
  | {
      kind: RealtimeAccessChangeKind.AccountChanged;
      userId: string;
    }
  | {
      kind: RealtimeAccessChangeKind.SessionsEnded;
      // Every session of this person.
      userId?: string | undefined;
      // These sessions (UserSession ids).
      sessionIds?: Array<string> | undefined;
    };

interface RealtimeAccessChangeMessage {
  // The server that announced it, which has applied it already.
  origin: string;
  change: RealtimeAccessChange;
}

export default class RealtimeAccessChanges {
  public static readonly CHANNEL: string = "oneuptime:realtime:access-changes";

  // The most sessions one message names; more are sent in several.
  public static readonly MAX_SESSIONS_PER_MESSAGE: number = 500;

  // This server, so it does not apply its own announcements twice.
  private static readonly origin: string = ObjectID.generate().toString();

  private static subscriber: ClientType | null = null;

  /*
   * Applies the change on this server at once and tells every other one.
   * Never throws and never waits: the write that made the change does not
   * depend on the channel.
   */
  public static announce(change: RealtimeAccessChange): void {
    const changes: Array<RealtimeAccessChange> =
      RealtimeAccessChanges.split(change);

    for (const part of changes) {
      RealtimeAccessChanges.apply(part);
      RealtimeAccessChanges.publish(part);
    }
  }

  /*
   * Listens for the changes other servers announce. Called once by every
   * server that holds sockets (Realtime.init). Never throws: without the
   * channel, the entries this server keeps still run out on their own.
   */
  public static async listen(): Promise<void> {
    if (RealtimeAccessChanges.subscriber) {
      return;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client) {
      logger.warn(
        "Realtime: Valkey is not connected, so access changes made on other servers reach this one only as its cached entries run out.",
      );
      return;
    }

    let subscriber: ClientType | null = null;

    try {
      // A connection in subscriber mode can do nothing else, so it is its own.
      subscriber = client.duplicate();

      subscriber.on("error", (err: Error): void => {
        logger.error("Realtime: the access change channel reported an error.");
        logger.error(err);
      });

      subscriber.on("message", (channel: string, message: string): void => {
        if (channel !== RealtimeAccessChanges.CHANNEL) {
          return;
        }

        RealtimeAccessChanges.receive(message);
      });

      await subscriber.subscribe(RealtimeAccessChanges.CHANNEL);

      RealtimeAccessChanges.subscriber = subscriber;

      GracefulShutdown.registerHandler(
        "RealtimeAccessChanges",
        ShutdownPriority.DataStores,
        async (): Promise<void> => {
          await RealtimeAccessChanges.stopListening();
        },
      );
    } catch (err) {
      logger.error(
        "Realtime: could not listen for access changes made on other servers; they reach this one as its cached entries run out.",
      );
      logger.error(err);

      try {
        subscriber?.disconnect();
      } catch {
        // Already gone.
      }
    }
  }

  // Stops listening. For shutdown and tests.
  public static async stopListening(): Promise<void> {
    const subscriber: ClientType | null = RealtimeAccessChanges.subscriber;

    RealtimeAccessChanges.subscriber = null;

    if (!subscriber) {
      return;
    }

    try {
      subscriber.disconnect();
    } catch (err) {
      logger.error(err);
    }
  }

  /*
   * A message from the channel: applied unless this server announced it
   * (and so applied it already) or it is not one this server understands.
   */
  public static receive(message: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(message);
    } catch {
      logger.warn("Realtime: an access change that is not JSON is ignored.");
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const envelope: Partial<RealtimeAccessChangeMessage> =
      parsed as Partial<RealtimeAccessChangeMessage>;

    if (envelope.origin === RealtimeAccessChanges.origin) {
      return;
    }

    const change: RealtimeAccessChange | null = RealtimeAccessChanges.validate(
      envelope.change,
    );

    if (!change) {
      logger.warn("Realtime: an access change of an unknown shape is ignored.");
      return;
    }

    RealtimeAccessChanges.apply(change);
  }

  /*
   * What a change means on this server. Each step stands alone, so one
   * that fails does not keep the others from happening.
   */
  public static apply(change: RealtimeAccessChange): void {
    try {
      switch (change.kind) {
        case RealtimeAccessChangeKind.PermissionsChanged: {
          RealtimeReaders.forgetUser(change.userId, change.projectId);

          // Their teams, for the Owned scope.
          if (change.projectId) {
            RealtimeAccessChanges.getTeamMemberService().forgetTeamIdsForUser(
              new ObjectID(change.userId),
              new ObjectID(change.projectId),
            );
          }

          return;
        }

        case RealtimeAccessChangeKind.AccountChanged: {
          RealtimeAccessChanges.getUserService().forgetBlockedStatus(
            new ObjectID(change.userId),
          );
          RealtimeReaders.forgetUser(change.userId);
          return;
        }

        case RealtimeAccessChangeKind.SessionsEnded: {
          RealtimeSessions.endWhere({
            userId: change.userId,
            sessionIds: change.sessionIds,
          });

          if (change.userId) {
            RealtimeReaders.forgetUser(change.userId);
          }

          return;
        }
      }
    } catch (err) {
      logger.error("Realtime: an access change could not be applied here.");
      logger.error(err);
    }
  }

  private static publish(change: RealtimeAccessChange): void {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    const message: RealtimeAccessChangeMessage = {
      origin: RealtimeAccessChanges.origin,
      change: change,
    };

    try {
      client
        .publish(RealtimeAccessChanges.CHANNEL, JSON.stringify(message))
        .catch((err: unknown): void => {
          logger.error(
            "Realtime: an access change could not be sent to the other servers.",
          );
          logger.error(err);
        });
    } catch (err) {
      logger.error(
        "Realtime: an access change could not be sent to the other servers.",
      );
      logger.error(err);
    }
  }

  // A change naming many sessions goes in messages of a bounded size.
  private static split(
    change: RealtimeAccessChange,
  ): Array<RealtimeAccessChange> {
    if (
      change.kind !== RealtimeAccessChangeKind.SessionsEnded ||
      !change.sessionIds ||
      change.sessionIds.length <= RealtimeAccessChanges.MAX_SESSIONS_PER_MESSAGE
    ) {
      return [change];
    }

    const parts: Array<RealtimeAccessChange> = [];

    for (
      let start: number = 0;
      start < change.sessionIds.length;
      start += RealtimeAccessChanges.MAX_SESSIONS_PER_MESSAGE
    ) {
      parts.push({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: change.userId,
        sessionIds: change.sessionIds.slice(
          start,
          start + RealtimeAccessChanges.MAX_SESSIONS_PER_MESSAGE,
        ),
      });
    }

    return parts;
  }

  // The change a message carries, or null when it is not one.
  private static validate(value: unknown): RealtimeAccessChange | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const change: Record<string, unknown> = value as Record<string, unknown>;
    const userId: unknown = change["userId"];
    const projectId: unknown = change["projectId"];
    const sessionIds: unknown = change["sessionIds"];

    const isId: (id: unknown) => id is string = (
      id: unknown,
    ): id is string => {
      return typeof id === "string" && ObjectID.isValidUUID(id);
    };

    switch (change["kind"]) {
      case RealtimeAccessChangeKind.PermissionsChanged:
        if (!isId(userId) || (projectId !== undefined && !isId(projectId))) {
          return null;
        }

        return {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: userId,
          projectId: isId(projectId) ? projectId : undefined,
        };

      case RealtimeAccessChangeKind.AccountChanged:
        if (!isId(userId)) {
          return null;
        }

        return { kind: RealtimeAccessChangeKind.AccountChanged, userId };

      case RealtimeAccessChangeKind.SessionsEnded: {
        if (userId !== undefined && !isId(userId)) {
          return null;
        }

        if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
          return null;
        }

        const endedSessionIds: Array<unknown> | undefined = sessionIds;

        if (endedSessionIds && !endedSessionIds.every(isId)) {
          return null;
        }

        if (userId === undefined && endedSessionIds === undefined) {
          return null;
        }

        return {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          userId: isId(userId) ? userId : undefined,
          sessionIds: endedSessionIds as Array<string> | undefined,
        };
      }

      default:
        return null;
    }
  }

  /*
   * Read when first needed rather than imported at the top: the services
   * extend DatabaseService, which imports Realtime, which imports this
   * module (see RealtimeReaders). Only their types are imported above.
   */
  private static getUserService(): UserServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/UserService").default;
  }

  private static getTeamMemberService(): TeamMemberServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/TeamMemberService").default;
  }
}
