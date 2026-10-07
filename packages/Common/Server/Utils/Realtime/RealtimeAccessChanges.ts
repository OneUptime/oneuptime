import Redis, { ClientType } from "../../Infrastructure/Redis";
import GracefulShutdown, { ShutdownPriority } from "../GracefulShutdown";
import logger from "../Logger";
import RealtimeReaders from "./RealtimeReaders";
import RealtimeSessions from "./RealtimeSessions";
import type { Service as GlobalConfigServiceType } from "../../Services/GlobalConfigService";
import type { ProjectService as ProjectServiceType } from "../../Services/ProjectService";
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
 * ended. When a project's sign-in rules change (it now requires SSO, or
 * another provider), each one reads them again and asks the sockets it
 * holds in that project again, as their joins were asked. A change only
 * ever takes something away or makes a server read again: nothing in a
 * message can give anyone more than their reads already give them.
 *
 * When the channel cannot be reached, a change still applies on the server
 * that made it, and the others catch up as their entries run out: 30
 * seconds for permissions, a minute for a block or a sign-in rule, and the
 * access token's lifetime for a session, whose sockets end when it expires
 * (RealtimeSessions), and for a socket that joined under the old sign-in
 * rules, whose renewal joins again.
 */

export enum RealtimeAccessChangeKind {
  // Their teams or their teams' permissions changed, in one project or every one.
  PermissionsChanged = "PermissionsChanged",
  // Their account changed: blocked or unblocked, made or no longer a server admin.
  AccountChanged = "AccountChanged",
  // Sessions ended: signed out, revoked, or every session of a person.
  SessionsEnded = "SessionsEnded",
  // A project's sign-in rules changed (Require SSO, the provider it pins), or the instance's.
  SignInRulesChanged = "SignInRulesChanged",
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
    }
  | {
      kind: RealtimeAccessChangeKind.SignInRulesChanged;
      // Absent: the instance-wide rule, which every project follows.
      projectId?: string | undefined;
    };

/*
 * What a server does with the sockets it holds in a project whose sign-in
 * rules changed (every project, when projectId is absent). Realtime, which
 * holds the sockets, registers it (onSignInRulesChanged).
 */
export type SignInRulesChangedListener = (projectId?: string) => void;

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

  /*
   * How long a server waits to try listening again when Valkey was not
   * there yet, or would not take the subscription. Until it listens, the
   * changes made on other servers reach it as its entries run out.
   */
  public static readonly LISTEN_RETRY_IN_MS: number = 30 * 1000;

  private static subscriber: ClientType | null = null;

  // A subscription being made right now, so two never are at once.
  private static subscribing: Promise<void> | null = null;

  private static listenRetry: ReturnType<typeof setTimeout> | null = null;

  // Whether this server wants to listen: false after stopListening.
  private static wantsToListen: boolean = false;

  private static shutdownHandlerRegistered: boolean = false;

  // Attempts in a row that did not listen: only the first is logged loudly.
  private static failedListens: number = 0;

  private static signInRulesChangedListener: SignInRulesChangedListener | null =
    null;

  /*
   * Who asks this server's sockets again when sign-in rules change. One
   * listener: Realtime, which holds the sockets.
   */
  public static onSignInRulesChanged(
    listener: SignInRulesChangedListener | null,
  ): void {
    RealtimeAccessChanges.signInRulesChangedListener = listener;
  }

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
   * server that holds sockets (Realtime.init). Never throws. When Valkey is
   * not there yet, or will not take the subscription, it tries again every
   * LISTEN_RETRY_IN_MS until it listens; meanwhile the entries this server
   * keeps still run out on their own. Once subscribed, the client renews
   * the subscription itself after a reconnect.
   */
  public static listen(): Promise<void> {
    RealtimeAccessChanges.wantsToListen = true;

    if (RealtimeAccessChanges.subscriber) {
      return Promise.resolve();
    }

    if (!RealtimeAccessChanges.subscribing) {
      RealtimeAccessChanges.subscribing =
        RealtimeAccessChanges.subscribe().finally((): void => {
          RealtimeAccessChanges.subscribing = null;
        });
    }

    return RealtimeAccessChanges.subscribing;
  }

  // Stops listening, and trying to. For shutdown and tests.
  public static async stopListening(): Promise<void> {
    RealtimeAccessChanges.wantsToListen = false;
    RealtimeAccessChanges.failedListens = 0;

    if (RealtimeAccessChanges.listenRetry) {
      clearTimeout(RealtimeAccessChanges.listenRetry);
      RealtimeAccessChanges.listenRetry = null;
    }

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

  private static async subscribe(): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client) {
      RealtimeAccessChanges.logListenFailure({
        message:
          "Realtime: Valkey is not connected yet, so access changes made on other servers reach this one only as its cached entries run out until it is.",
        isError: false,
      });
      RealtimeAccessChanges.retryListening();
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

      // Stopped while subscribing: this connection is not kept.
      if (!RealtimeAccessChanges.wantsToListen) {
        subscriber.disconnect();
        return;
      }

      RealtimeAccessChanges.subscriber = subscriber;
      RealtimeAccessChanges.failedListens = 0;

      if (!RealtimeAccessChanges.shutdownHandlerRegistered) {
        RealtimeAccessChanges.shutdownHandlerRegistered = true;

        GracefulShutdown.registerHandler(
          "RealtimeAccessChanges",
          ShutdownPriority.DataStores,
          async (): Promise<void> => {
            await RealtimeAccessChanges.stopListening();
          },
        );
      }
    } catch (err) {
      RealtimeAccessChanges.logListenFailure({
        message:
          "Realtime: could not listen for access changes made on other servers yet; they reach this one as its cached entries run out until it does.",
        isError: true,
        err: err,
      });

      try {
        subscriber?.disconnect();
      } catch {
        // Already gone.
      }

      RealtimeAccessChanges.retryListening();
    }
  }

  /*
   * The first attempt in a row that did not listen is logged as a warning
   * or an error; the retries after it only at debug, so a long outage does
   * not fill the log every LISTEN_RETRY_IN_MS.
   */
  private static logListenFailure(failure: {
    message: string;
    isError: boolean;
    err?: unknown;
  }): void {
    RealtimeAccessChanges.failedListens++;

    if (RealtimeAccessChanges.failedListens > 1) {
      logger.debug(failure.message);
      return;
    }

    if (!failure.isError) {
      logger.warn(failure.message);
      return;
    }

    logger.error(failure.message);

    if (failure.err) {
      logger.error(failure.err);
    }
  }

  // Tries to listen again after LISTEN_RETRY_IN_MS, unless stopped meanwhile.
  private static retryListening(): void {
    if (
      !RealtimeAccessChanges.wantsToListen ||
      RealtimeAccessChanges.listenRetry
    ) {
      return;
    }

    const retry: ReturnType<typeof setTimeout> = setTimeout((): void => {
      RealtimeAccessChanges.listenRetry = null;

      if (!RealtimeAccessChanges.wantsToListen) {
        return;
      }

      void RealtimeAccessChanges.listen();
    }, RealtimeAccessChanges.LISTEN_RETRY_IN_MS);

    // Trying again never keeps the process up.
    if (typeof retry === "object" && retry && "unref" in retry) {
      retry.unref();
    }

    RealtimeAccessChanges.listenRetry = retry;
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

        case RealtimeAccessChangeKind.SignInRulesChanged: {
          // The rules are read again here before any socket is asked again.
          if (change.projectId) {
            RealtimeAccessChanges.getProjectService().forgetSignInRules();
          } else {
            RealtimeAccessChanges.getGlobalConfigService().forgetSignInRules();
          }

          RealtimeAccessChanges.signInRulesChangedListener?.(change.projectId);

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

    const isId: (id: unknown) => id is string = (id: unknown): id is string => {
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

      case RealtimeAccessChangeKind.SignInRulesChanged:
        if (projectId !== undefined && !isId(projectId)) {
          return null;
        }

        return {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: isId(projectId) ? projectId : undefined,
        };

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

  private static getProjectService(): ProjectServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/ProjectService").default;
  }

  private static getGlobalConfigService(): GlobalConfigServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Services/GlobalConfigService").default;
  }
}
