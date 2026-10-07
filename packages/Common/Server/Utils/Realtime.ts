import IO, { Socket, SocketServer } from "../Infrastructure/SocketIO";
import logger, { LogAttributes } from "./Logger";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseType from "../../Types/BaseDatabase/DatabaseType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RealtimeUtil from "../../Utils/Realtime";
import Permission, {
  UserTenantAccessPermission,
  instanceOfUserTenantAccessPermission,
} from "../../Types/Permission";
import { getModelTypeByName } from "../../Models/DatabaseModels/Index";
import { getModelTypeByName as getAnalyticsModelTypeByname } from "../../Models/AnalyticsModels/Index";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../Types/HeldPermissions";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import ListenToModelEventJSON from "../../Types/Realtime/ListenToModelEventJSON";
import EventName from "../../Types/Realtime/EventName";
import CaptureSpan from "./Telemetry/CaptureSpan";
import {
  NO_READER_ACCESS,
  RealtimeReadAccess,
  RealtimeReader,
  normalizeRealtimeId,
} from "./Realtime/RealtimeReadAccess";
import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "./Realtime/RealtimeReaders";
import RealtimeAudience from "./Realtime/RealtimeAudience";
import RealtimeJoinAccess, {
  RealtimeJoinDecision,
  RealtimeJoinRefusal,
} from "./Realtime/RealtimeJoinAccess";
import RealtimeSessions, {
  RealtimeSocketSession,
} from "./Realtime/RealtimeSessions";
import RealtimeAccessChanges from "./Realtime/RealtimeAccessChanges";

// What became of one ListenToModelEvent request.
export enum ListenToModelEventOutcome {
  Joined = "Joined",
  /*
   * No access token, one that no longer decodes, a blocked user's, or a
   * session that has ended. The client was told.
   */
  AuthenticationRequired = "AuthenticationRequired",
  // The project requires an SSO sign-in the handshake does not carry. The client was told.
  SsoRequired = "SsoRequired",
  // A valid session without access to this tenant or model.
  NotAuthorized = "NotAuthorized",
  // The request itself was malformed.
  InvalidRequest = "InvalidRequest",
  // Something failed while authorizing (for example the permission cache).
  Failed = "Failed",
}

// One event waiting for delivery: its record, and the resource it belongs to.
interface PendingModelEvent {
  modelId: string;
  ownerId?: string | undefined;
}

/*
 * The events of one model, project and kind waiting for (or in) delivery,
 * in the order they happened. One delivery works out who hears about all
 * of them (RealtimeAudience).
 */
interface PendingModelEvents {
  tenantId: string;
  tableName: string;
  eventType: ModelEventType;
  access: RealtimeReadAccess;
  events: Array<PendingModelEvent>;
  draining: boolean;
}

// A listening socket, as a delivery sees it.
interface ListeningSocket {
  id: string;
  rooms: Set<string>;
  data: unknown;
}

export default abstract class Realtime {
  private static socketServer: SocketServer | null = null;

  /*
   * The most events one delivery works out at once, and the most a model,
   * project and kind keeps waiting behind a delivery in progress. Past that
   * the newest are dropped (and logged): a live update only tells an open
   * page to read again, and a page that missed some is brought up to date
   * by the next one.
   */
  public static readonly MAX_EVENTS_PER_DELIVERY: number = 100;
  public static readonly MAX_WAITING_EVENTS: number = 5000;

  /*
   * The longest a write waits for the decision of who could read its rows
   * before it (snapshotReadAccess): a delete, or an update that may change
   * who reads them. Past it the write goes ahead without that decision -
   * nobody hears about the deleted rows, and an update is heard by those
   * who can read the rows after it - so a write never waits long on live
   * updates. Without a queue for read slots the decision takes
   * milliseconds; this bounds it when the server is busy.
   */
  public static readonly BEFORE_WRITE_DECISION_TIMEOUT_IN_MS: number = 2000;

  /*
   * The longest a delivery works out who hears about its batch. A listener
   * whose read has not started by then does not hear about the batch: the
   * listeners were found when the delivery began, and an answer much later
   * would go to sockets that may have moved on.
   */
  public static readonly DELIVERY_DECISION_TIMEOUT_IN_MS: number = 10_000;

  private static pendingEvents: Map<string, PendingModelEvents> = new Map<
    string,
    PendingModelEvents
  >();

  // Deliveries in progress, for waitForPendingDeliveries.
  private static deliveries: Set<Promise<void>> = new Set<Promise<void>>();

  // Which access a pending batch was enqueued with: events merge per access.
  private static accessIds: WeakMap<RealtimeReadAccess, number> = new WeakMap<
    RealtimeReadAccess,
    number
  >();

  private static nextAccessId: number = 1;

  @CaptureSpan()
  public static isInitialized(): boolean {
    logger.debug("Checking if socket server is initialized");
    const isInitialized: boolean = this.socketServer !== null;
    logger.debug(`Socket server is initialized: ${isInitialized}`);
    return isInitialized;
  }

  @CaptureSpan()
  public static async init(): Promise<SocketServer | null> {
    if (!this.socketServer) {
      logger.debug("Initializing socket server");
      this.socketServer = IO.getSocketServer();
      logger.debug("Realtime socket server initialized");

      /*
       * Access changes made on other servers - a sign-out, a block, a
       * permission taken away - reach the sockets of this one at once.
       * Never throws; without the channel they arrive as entries run out.
       */
      void RealtimeAccessChanges.listen();

      /*
       * A project's sign-in rules changed (it now requires SSO, or another
       * provider), here or on another server: the sockets listening to its
       * live updates are asked again, as their joins were.
       */
      RealtimeAccessChanges.onSignInRulesChanged((projectId?: string): void => {
        Realtime.recheckSignInRules(projectId).catch((err: unknown) => {
          logger.error(err);
        });
      });

      this.socketServer!.on("connection", (socket: Socket) => {
        logger.debug("New socket connection established");

        /*
         * socket.io calls a listener and throws away what it returns. An async
         * listener that throws is therefore an unhandled rejection: nothing
         * goes back to the client, and the subscription it asked for simply
         * never happens. handleListenToModelEventRequest settles every outcome
         * itself; the catch is a backstop, not the error handling.
         */
        socket.on(EventName.ListenToModalEvent, (data: JSONObject): void => {
          Realtime.handleListenToModelEventRequest(socket, data).catch(
            (err: unknown) => {
              logger.error(err);
            },
          );
        });
      });
    }

    return this.socketServer;
  }

  /*
   * One ListenToModelEvent from a client, start to finish. Never throws: a
   * malformed request, a missing or expired access token, a refused
   * subscription and a failing permission lookup each end here as an outcome,
   * so none of them can become an unhandled rejection in the socket listener.
   */
  @CaptureSpan()
  public static async handleListenToModelEventRequest(
    socket: Socket,
    data: JSONObject,
  ): Promise<ListenToModelEventOutcome> {
    logger.debug("Received ListenToModalEvent with data:");
    logger.debug(data);

    let request: ListenToModelEventJSON;

    try {
      request = Realtime.parseListenToModelEventRequest(data);
    } catch (err) {
      logger.error(err);
      return ListenToModelEventOutcome.InvalidRequest;
    }

    try {
      return await Realtime.listenToModelEvent(socket, request);
    } catch (err) {
      // A permission-cache (Redis) failure, say. The room is not joined.
      const failureLogAttributes: LogAttributes = {
        projectId: request.tenantId,
      };

      logger.error(err, failureLogAttributes);
      return ListenToModelEventOutcome.Failed;
    }
  }

  private static parseListenToModelEventRequest(
    data: JSONObject,
  ): ListenToModelEventJSON {
    if (!data || typeof data !== "object") {
      logger.error("ListenToModelEvent data is not an object");
      throw new BadDataException("ListenToModelEvent data is not an object");
    }

    const socketLogAttributes: LogAttributes = {
      projectId: data["tenantId"]?.toString(),
    };

    if (typeof data["eventType"] !== "string") {
      logger.error("eventType is not a string", socketLogAttributes);
      throw new BadDataException("eventType is not a string");
    }
    if (typeof data["modelType"] !== "string") {
      logger.error("modelType is not a string", socketLogAttributes);
      throw new BadDataException("modelType is not a string");
    }
    if (typeof data["modelName"] !== "string") {
      logger.error("modelName is not a string", socketLogAttributes);
      throw new BadDataException("modelName is not a string");
    }
    if (typeof data["tenantId"] !== "string") {
      logger.error("tenantId is not a string", socketLogAttributes);
      throw new BadDataException("tenantId is not a string");
    }
    if (!ObjectID.isValidUUID(data["tenantId"])) {
      logger.error("tenantId is not an id", socketLogAttributes);
      throw new BadDataException("tenantId is not an id");
    }

    return {
      eventType: data["eventType"] as ModelEventType,
      modelType: data["modelType"] as DatabaseType,
      modelName: data["modelName"] as string,
      tenantId: data["tenantId"] as string,
    };
  }

  /*
   * The socket has no usable user session: tell the client, which refreshes
   * its session and reconnects so the new handshake carries the new cookie.
   * Dropping the request silently is what used to happen, and it left every
   * subscription made after the access token expired dead (no live counters
   * after switching project, no live logs) with nothing in the browser to
   * show why.
   */
  private static rejectForMissingAuthentication(
    socket: Socket,
    data: ListenToModelEventJSON,
    reason: string,
    listenLogAttributes: LogAttributes,
  ): ListenToModelEventOutcome {
    logger.debug(
      `${reason}, aborting joining room and asking the client to re-authenticate`,
      listenLogAttributes,
    );

    socket.emit(EventName.AuthenticationRequired, data);

    return ListenToModelEventOutcome.AuthenticationRequired;
  }

  /*
   * The project requires an SSO sign-in the socket's handshake does not
   * carry: tell the client which project, so it can send the person to
   * sign in with SSO there, as a refused API request does.
   */
  private static rejectForMissingSsoSignIn(
    socket: Socket,
    data: ListenToModelEventJSON,
    listenLogAttributes: LogAttributes,
  ): ListenToModelEventOutcome {
    logger.debug(
      "The project requires an SSO sign-in this socket does not carry, aborting joining room",
      listenLogAttributes,
    );

    socket.emit(EventName.SsoAuthorizationRequired, data);

    return ListenToModelEventOutcome.SsoRequired;
  }

  /*
   * One subscription, asked as an API request of the same session is asked
   * (RealtimeJoinAccess): the access token (verified, not a blocked
   * user's), the project's own access check with its Require SSO rule, and
   * then the model's read. An allowed join keeps the session on the socket
   * (RealtimeSessions), and the socket hears live updates while that
   * session lasts.
   */
  @CaptureSpan()
  public static async listenToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<ListenToModelEventOutcome> {
    const listenLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug("Listening to model event with data:", listenLogAttributes);
    logger.debug(data, listenLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        listenLogAttributes,
      );
      await this.init();
    }

    // Its session has ended: the handshake is spent, so the client must reconnect.
    if (RealtimeSessions.hasEnded(socket)) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "The session this socket joined with has ended",
        listenLogAttributes,
      );
    }

    const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
      socket,
      data.tenantId,
    );

    if (!decision.allowed) {
      if (decision.refusal === RealtimeJoinRefusal.AuthenticationRequired) {
        /*
         * The token is the one the browser sent with the handshake, and it
         * is not re-read for the life of the connection. Once it expires
         * every check refuses it, which is the normal state of a dashboard
         * tab left open past the access token's lifetime.
         */
        return this.rejectForMissingAuthentication(
          socket,
          data,
          "The socket has no usable session",
          listenLogAttributes,
        );
      }

      if (decision.refusal === RealtimeJoinRefusal.SsoRequired) {
        return this.rejectForMissingSsoSignIn(
          socket,
          data,
          listenLogAttributes,
        );
      }

      /*
       * Authenticated but not allowed. The room is not joined and, as
       * before, nothing is sent back: a fresh session would not change the
       * answer.
       */
      logger.debug(
        "User does not have access to this tenant, aborting joining room",
        listenLogAttributes,
      );
      return ListenToModelEventOutcome.NotAuthorized;
    }

    const session: RealtimeSocketSession = decision.session;

    /*
     * The model's own read: a server admin's reads pass it; anyone else
     * needs read access to that kind of record in the project.
     */
    if (
      !session.isMasterAdmin &&
      !(
        decision.tenantPermission &&
        this.hasPermissionsByModelName(
          decision.tenantPermission,
          data.modelName,
        )
      )
    ) {
      logger.debug(
        "User does not have access to this model, aborting joining room",
        listenLogAttributes,
      );
      return ListenToModelEventOutcome.NotAuthorized;
    }

    /*
     * The session may have ended while the join was decided (signed out,
     * revoked, the person blocked), or before this token was issued.
     * Checked right before the session is kept, with nothing awaited in
     * between, so an end that arrives meanwhile is never missed.
     */
    if (
      RealtimeSessions.hasEnded(socket) ||
      RealtimeSessions.wasEnded({
        userId: session.userId,
        sessionId: session.sessionId,
        issuedAtMs: decision.issuedAtMs,
      })
    ) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "The session this socket joined with has ended",
        listenLogAttributes,
      );
    }

    /*
     * Joining the room is not hearing about every record in it: each event
     * goes only to the listeners who may read its record, asked as this
     * person when it happens (deliver), and only while their session lasts.
     */
    RealtimeSessions.begin(socket, session);

    const roomId: string = data.modelId
      ? RealtimeUtil.getRoomId(
          data.tenantId,
          data.modelName,
          ModelEventType.Create,
          data.modelId,
        )
      : RealtimeUtil.getRoomId(data.tenantId, data.modelName, data.eventType);

    logger.debug(`Joining room with ID: ${roomId}`, listenLogAttributes);

    await socket.join(roomId);

    // Ended while it joined: it leaves again, as every room of an ended session does.
    if (RealtimeSessions.hasEnded(socket)) {
      await socket.leave(roomId);
      return ListenToModelEventOutcome.AuthenticationRequired;
    }

    return ListenToModelEventOutcome.Joined;
  }

  @CaptureSpan()
  public static async stopListeningToModelEvent(
    socket: Socket,
    data: ListenToModelEventJSON,
  ): Promise<void> {
    const stopLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug(
      "Stopping listening to model event with data:",
      stopLogAttributes,
    );
    logger.debug(data, stopLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        stopLogAttributes,
      );
      await this.init();
    }

    const roomId: string = RealtimeUtil.getRoomId(
      data.tenantId,
      data.modelName,
      data.eventType,
      data.modelId,
    );

    logger.debug(`Leaving room with ID: ${roomId}`, stopLogAttributes);
    // leave this room.
    await socket.leave(roomId);
  }

  /*
   * A project's sign-in rules changed (every project's, when projectId is
   * absent: the instance-wide rule). Each socket this server holds in the
   * project's rooms is asked again, as its join was (RealtimeJoinAccess),
   * with the rules as they are now. One the project no longer lets in
   * leaves the project's rooms and is told why, as a refused join is; the
   * rest carry on untouched. Without this, a page that joined before the
   * change would hear until its access token next expired.
   */
  @CaptureSpan()
  public static async recheckSignInRules(projectId?: string): Promise<void> {
    if (!this.socketServer) {
      return;
    }

    const wantedProjectId: string | undefined = projectId
      ? normalizeRealtimeId(projectId)
      : undefined;

    const sockets: Array<Socket> =
      (await this.socketServer.fetchSockets()) as unknown as Array<Socket>;

    for (const socket of sockets) {
      // A socket with no session has joined nothing, or has already ended.
      if (!RealtimeSessions.getSession(socket)) {
        continue;
      }

      // The projects it listens to, as each of its rooms names them.
      const tenantIds: Map<string, string> = new Map<string, string>();

      for (const room of Array.from(socket.rooms || [])) {
        const tenantId: string | null = this.getTenantIdOfRoom(room);

        if (!tenantId) {
          continue;
        }

        const normalizedTenantId: string = normalizeRealtimeId(tenantId);

        if (wantedProjectId && normalizedTenantId !== wantedProjectId) {
          continue;
        }

        tenantIds.set(normalizedTenantId, tenantId);
      }

      for (const tenantId of tenantIds.values()) {
        await this.recheckSocketInProject(socket, tenantId);

        // Ended while it was asked: it holds no rooms to ask about any more.
        if (RealtimeSessions.hasEnded(socket)) {
          break;
        }
      }
    }
  }

  private static async recheckSocketInProject(
    socket: Socket,
    tenantId: string,
  ): Promise<void> {
    const recheckLogAttributes: LogAttributes = {
      projectId: tenantId,
    };

    let decision: RealtimeJoinDecision;

    try {
      decision = await RealtimeJoinAccess.decide(socket, tenantId);
    } catch (err) {
      /*
       * It could not be asked (a lookup failed). Its live updates end, and
       * the page's renewal joins again, asked from the start.
       */
      logger.error(err, recheckLogAttributes);
      RealtimeSessions.end(socket);
      return;
    }

    if (decision.allowed) {
      return;
    }

    if (decision.refusal === RealtimeJoinRefusal.AuthenticationRequired) {
      RealtimeSessions.end(socket);
      return;
    }

    logger.debug(
      "A socket no longer meets the project's sign-in rules, leaving its rooms",
      recheckLogAttributes,
    );

    for (const room of Array.from(socket.rooms || [])) {
      const roomTenantId: string | null = this.getTenantIdOfRoom(room);

      if (
        roomTenantId &&
        normalizeRealtimeId(roomTenantId) === normalizeRealtimeId(tenantId)
      ) {
        await socket.leave(room);
      }
    }

    if (decision.refusal === RealtimeJoinRefusal.SsoRequired) {
      socket.emit(EventName.SsoAuthorizationRequired, { tenantId: tenantId });
    }
  }

  /*
   * The project a room belongs to: every room is named after its project
   * first (RealtimeUtil.getRoomId), and a socket's room of its own id is no
   * project's.
   */
  private static getTenantIdOfRoom(room: string): string | null {
    const tenantId: string = room.slice(0, 36);

    if (
      room.length <= 37 ||
      room.charAt(36) !== "-" ||
      !ObjectID.isValidUUID(tenantId)
    ) {
      return null;
    }

    return tenantId;
  }

  /*
   * A record of the model was created, changed or deleted: tell the open
   * pages listening for it - only those of people who may read the record,
   * as `access` (the record's own read) decides. Project-wide readers hear
   * about every record, as they always have; anyone whose grants reach only
   * some records (labels, Owned, blocks with labels, private records, a
   * person's own AI conversations) hears about those records only.
   *
   * Returns as soon as the event is queued: who hears about it is worked
   * out after the write, with the other events of the same model, project
   * and kind that arrive meanwhile (deliver), so a write never waits for it.
   *
   * `ownerId` is the resource the record belongs to, when its writer names
   * it (telemetry rows, which are not looked up by id): it travels with the
   * event to `access` (RealtimeReadAccess.getReadableIds).
   */
  @CaptureSpan()
  public static async emitModelEvent(data: {
    tenantId: string | ObjectID;
    eventType: ModelEventType;
    modelId: ObjectID;
    modelType: { new (): BaseModel | AnalyticsBaseModel };
    access: RealtimeReadAccess;
    ownerId?: string | undefined;
  }): Promise<void> {
    const emitLogAttributes: LogAttributes = {
      projectId: data.tenantId?.toString(),
    };

    logger.debug("Emitting model event with data:", emitLogAttributes);
    logger.debug(`Tenant ID: ${data.tenantId}`, emitLogAttributes);
    logger.debug(`Event Type: ${data.eventType}`, emitLogAttributes);
    logger.debug(`Model ID: ${data.modelId}`, emitLogAttributes);

    if (!this.socketServer) {
      logger.debug(
        "Socket server not initialized, initializing now",
        emitLogAttributes,
      );
      await this.init();
    }

    const model: BaseModel | AnalyticsBaseModel = new data.modelType();

    if (!model.tableName) {
      logger.warn(
        "Model does not have a tableName, aborting emit",
        emitLogAttributes,
      );
      return;
    }

    this.enqueueModelEvent({
      tenantId: data.tenantId.toString(),
      tableName: model.tableName,
      eventType: data.eventType,
      modelId: data.modelId.toString(),
      ownerId: data.ownerId,
      access: data.access,
    });
  }

  /*
   * Who could read these records before a write, decided while the write
   * has not happened yet: a delete event is sent once the rows are gone,
   * when no read can find them any more, and an update can take a record
   * away from someone who could read it a moment ago. Returns an access
   * that answers from what was decided now - for the people listening now
   * for `eventType` (a delete by default) or in the records' own rooms;
   * anyone who starts listening later hears nothing on its account.
   *
   * `onlyFor` picks the listeners worth asking (see RealtimeAudience). The
   * whole decision - finding the listeners too - takes at most
   * BEFORE_WRITE_DECISION_TIMEOUT_IN_MS. Never throws: an answer that
   * cannot be worked out, or not in time, adds nobody (NO_READER_ACCESS).
   */
  @CaptureSpan()
  public static async snapshotReadAccess(data: {
    tenantId: string | ObjectID;
    modelType: { new (): BaseModel | AnalyticsBaseModel };
    modelIds: Array<ObjectID>;
    access: RealtimeReadAccess;
    eventType?: ModelEventType | undefined;
    onlyFor?: ((reader: RealtimeReader) => Promise<boolean>) | undefined;
  }): Promise<RealtimeReadAccess> {
    const tenantId: string = data.tenantId.toString();
    const tableName: string | null = new data.modelType().tableName;

    if (!this.socketServer || !tableName || data.modelIds.length === 0) {
      return NO_READER_ACCESS;
    }

    const deadlineMs: number =
      Date.now() + this.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      const readable: Map<string, Set<string>> | null = await Promise.race([
        this.decideReadableBeforeWrite({
          tenantId: tenantId,
          tableName: tableName,
          eventType: data.eventType || ModelEventType.Delete,
          modelIds: data.modelIds.map((id: ObjectID): string => {
            return id.toString();
          }),
          access: data.access,
          onlyFor: data.onlyFor,
          deadlineMs: deadlineMs,
        }),
        new Promise<null>((resolve: (value: null) => void): void => {
          timer = setTimeout((): void => {
            resolve(null);
          }, this.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS);
        }),
      ]);

      if (!readable) {
        logger.warn(
          `Realtime: who could read these ${tableName} records before the write could not be decided in time; the write goes ahead without it.`,
          { projectId: tenantId } as LogAttributes,
        );
        return NO_READER_ACCESS;
      }

      const anyoneReads: boolean = Array.from(readable.values()).some(
        (ids: Set<string>): boolean => {
          return ids.size > 0;
        },
      );

      if (!anyoneReads) {
        return NO_READER_ACCESS;
      }

      return {
        answersWithoutReading: true,
        readsEveryRecord: async (): Promise<boolean> => {
          return false;
        },
        getReadableIds: async (
          reader: RealtimeReader,
          ids: Array<ObjectID>,
        ): Promise<Array<string>> => {
          const readableThen: Set<string> | undefined = readable.get(
            reader.key,
          );

          if (!readableThen) {
            return [];
          }

          return ids
            .map((id: ObjectID): string => {
              return normalizeRealtimeId(id);
            })
            .filter((id: string): boolean => {
              return readableThen.has(id);
            });
        },
      };
    } catch (err) {
      logger.error(err, { projectId: tenantId });
      return NO_READER_ACCESS;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  // The listeners for these records now, and which of them each may read.
  private static async decideReadableBeforeWrite(data: {
    tenantId: string;
    tableName: string;
    eventType: ModelEventType;
    modelIds: Array<string>;
    access: RealtimeReadAccess;
    onlyFor?: ((reader: RealtimeReader) => Promise<boolean>) | undefined;
    deadlineMs: number;
  }): Promise<Map<string, Set<string>>> {
    const listening: Array<ListeningSocket> = await this.fetchListeningSockets([
      RealtimeUtil.getRoomId(data.tenantId, data.tableName, data.eventType),
      ...data.modelIds.map((modelId: string): string => {
        return RealtimeUtil.getRoomId(
          data.tenantId,
          data.tableName,
          ModelEventType.Create,
          modelId,
        );
      }),
    ]);

    if (listening.length === 0) {
      return new Map<string, Set<string>>();
    }

    return await RealtimeAudience.getReadableIds({
      tenantId: data.tenantId,
      access: data.access,
      readers: this.getReadersOfSockets(listening),
      modelIds: data.modelIds,
      onlyFor: data.onlyFor,
      deadlineMs: data.deadlineMs,
    });
  }

  /*
   * Resolves once every queued event has been delivered (or dropped). For
   * tests, and for a server that is shutting down.
   */
  public static async waitForPendingDeliveries(): Promise<void> {
    while (this.deliveries.size > 0) {
      await Promise.allSettled(Array.from(this.deliveries));
    }
  }

  private static enqueueModelEvent(event: {
    tenantId: string;
    tableName: string;
    eventType: ModelEventType;
    modelId: string;
    ownerId?: string | undefined;
    access: RealtimeReadAccess;
  }): void {
    let accessId: number | undefined = this.accessIds.get(event.access);

    if (accessId === undefined) {
      accessId = this.nextAccessId++;
      this.accessIds.set(event.access, accessId);
    }

    const key: string = [
      event.tenantId,
      event.tableName,
      event.eventType,
      accessId,
    ].join("|");

    let pending: PendingModelEvents | undefined = this.pendingEvents.get(key);

    if (!pending) {
      pending = {
        tenantId: event.tenantId,
        tableName: event.tableName,
        eventType: event.eventType,
        access: event.access,
        events: [],
        draining: false,
      };

      this.pendingEvents.set(key, pending);
    }

    if (pending.events.length >= this.MAX_WAITING_EVENTS) {
      logger.warn(
        `Realtime: too many ${event.tableName} events are waiting to be delivered; this one is dropped.`,
        { projectId: event.tenantId } as LogAttributes,
      );
      return;
    }

    pending.events.push({ modelId: event.modelId, ownerId: event.ownerId });

    if (pending.draining) {
      // The delivery in progress takes it with the next batch.
      return;
    }

    pending.draining = true;

    const delivery: Promise<void> = this.drainModelEvents(key, pending).finally(
      (): void => {
        this.deliveries.delete(delivery);
      },
    );

    this.deliveries.add(delivery);
  }

  private static async drainModelEvents(
    key: string,
    pending: PendingModelEvents,
  ): Promise<void> {
    try {
      // The events queued in the same turn as this one go with it.
      await Promise.resolve();

      while (pending.events.length > 0) {
        const events: Array<PendingModelEvent> = pending.events.splice(
          0,
          this.MAX_EVENTS_PER_DELIVERY,
        );

        try {
          await this.deliver({
            tenantId: pending.tenantId,
            tableName: pending.tableName,
            eventType: pending.eventType,
            access: pending.access,
            events: events,
          });
        } catch (err) {
          logger.error(err, { projectId: pending.tenantId } as LogAttributes);
        }
      }
    } finally {
      pending.draining = false;

      if (this.pendingEvents.get(key) === pending) {
        this.pendingEvents.delete(key);
      }
    }
  }

  /*
   * Sends a batch of events: each to the sockets listening for it - in the
   * model's room for the kind of event, or in the record's own room - whose
   * person may read its record (RealtimeAudience). Nothing is sent to a room
   * as such, so a socket nobody checked never receives an event.
   */
  private static async deliver(batch: {
    tenantId: string;
    tableName: string;
    eventType: ModelEventType;
    access: RealtimeReadAccess;
    events: Array<PendingModelEvent>;
  }): Promise<void> {
    if (!this.socketServer || batch.events.length === 0) {
      return;
    }

    const modelIds: Array<string> = batch.events.map(
      (event: PendingModelEvent): string => {
        return event.modelId;
      },
    );

    // The resource of each record, where its writer named one.
    const ownerIds: Map<string, string> = new Map<string, string>();

    for (const event of batch.events) {
      if (event.ownerId) {
        ownerIds.set(normalizeRealtimeId(event.modelId), event.ownerId);
      }
    }

    const roomId: string = RealtimeUtil.getRoomId(
      batch.tenantId,
      batch.tableName,
      batch.eventType,
    );

    const recordRoomIds: Map<string, string> = new Map<string, string>();

    for (const modelId of modelIds) {
      recordRoomIds.set(
        modelId,
        RealtimeUtil.getRoomId(
          batch.tenantId,
          batch.tableName,
          ModelEventType.Create,
          modelId,
        ),
      );
    }

    const listening: Array<ListeningSocket> = await this.fetchListeningSockets([
      roomId,
      ...Array.from(recordRoomIds.values()),
    ]);

    // The sockets of each person listening, by RealtimeReaders.getKey.
    const listeners: Map<
      string,
      { identity: RealtimeReaderIdentity; sockets: Array<ListeningSocket> }
    > = new Map<
      string,
      { identity: RealtimeReaderIdentity; sockets: Array<ListeningSocket> }
    >();

    for (const socket of listening) {
      const identity: RealtimeReaderIdentity | null =
        this.getReaderOfSocket(socket);

      // A socket that never said who it is hears nothing.
      if (!identity) {
        continue;
      }

      const key: string = RealtimeReaders.getKey(identity, batch.tenantId);
      const listener: {
        identity: RealtimeReaderIdentity;
        sockets: Array<ListeningSocket>;
      } = listeners.get(key) || { identity: identity, sockets: [] };

      listener.sockets.push(socket);
      listeners.set(key, listener);
    }

    if (listeners.size === 0) {
      return;
    }

    const readable: Map<
      string,
      Set<string>
    > = await RealtimeAudience.getReadableIds({
      tenantId: batch.tenantId,
      access: batch.access,
      readers: Array.from(listeners.values()).map(
        (listener: {
          identity: RealtimeReaderIdentity;
          sockets: Array<ListeningSocket>;
        }): RealtimeReaderIdentity => {
          return listener.identity;
        },
      ),
      modelIds: modelIds,
      ownerIds: ownerIds,
      deadlineMs: Date.now() + this.DELIVERY_DECISION_TIMEOUT_IN_MS,
    });

    // Each event, as often as it happened, to exactly those sockets.
    for (const modelId of modelIds) {
      const recordRoomId: string = recordRoomIds.get(modelId)!;
      const normalizedId: string = normalizeRealtimeId(modelId);
      const inRoom: Array<string> = [];
      const inRecordRoom: Array<string> = [];

      for (const [key, listener] of listeners) {
        if (!readable.get(key)?.has(normalizedId)) {
          continue;
        }

        for (const socket of listener.sockets) {
          if (socket.rooms.has(roomId)) {
            inRoom.push(socket.id);
          }

          if (socket.rooms.has(recordRoomId)) {
            inRecordRoom.push(socket.id);
          }
        }
      }

      const payload: JSONObject = {
        modelId: modelId,
      };

      this.sendToSockets(inRoom, roomId, payload);
      this.sendToSockets(inRecordRoom, recordRoomId, payload);
    }
  }

  /*
   * The one place a model event leaves the server: to the sockets named,
   * each of which deliver checked. An empty list sends nothing - socket.io
   * reads `to([])` as no room at all, which is every socket.
   */
  private static sendToSockets(
    socketIds: Array<string>,
    eventName: string,
    payload: JSONObject,
  ): void {
    if (!this.socketServer || socketIds.length === 0) {
      return;
    }

    this.socketServer
      .to(Array.from(new Set(socketIds)))
      .emit(eventName, payload);
  }

  // The sockets in any of `roomIds`, each once, with their rooms.
  private static async fetchListeningSockets(
    roomIds: Array<string>,
  ): Promise<Array<ListeningSocket>> {
    if (!this.socketServer || roomIds.length === 0) {
      return [];
    }

    const sockets: Array<{ id: string; rooms: Set<string>; data: unknown }> =
      (await this.socketServer.in(roomIds).fetchSockets()) as unknown as Array<{
        id: string;
        rooms: Set<string>;
        data: unknown;
      }>;

    return sockets.map(
      (socket: {
        id: string;
        rooms: Set<string>;
        data: unknown;
      }): ListeningSocket => {
        return {
          id: socket.id,
          rooms: new Set<string>(socket.rooms || []),
          data: socket.data,
        };
      },
    );
  }

  private static getReadersOfSockets(
    sockets: Array<ListeningSocket>,
  ): Array<RealtimeReaderIdentity> {
    const readers: Array<RealtimeReaderIdentity> = [];

    for (const socket of sockets) {
      const identity: RealtimeReaderIdentity | null =
        this.getReaderOfSocket(socket);

      if (identity) {
        readers.push(identity);
      }
    }

    return readers;
  }

  /*
   * Who a listening socket is: the person whose access token it joined its
   * rooms with, while that session lasts (RealtimeSessions.getSession). A
   * socket that never said, whose access token has expired or whose
   * session has ended, hears nothing.
   */
  private static getReaderOfSocket(socket: {
    data: unknown;
  }): RealtimeReaderIdentity | null {
    const session: RealtimeSocketSession | null =
      RealtimeSessions.getSession(socket);

    if (!session) {
      return null;
    }

    return {
      userId: session.userId,
      isMasterAdmin: session.isMasterAdmin,
    };
  }

  /*
   * Whether the user may join a model's room: whether they may read the
   * model at all, by the table half of the rule its CRUD read follows
   * (HeldPermissionsUtil.holdsModelPermission) - an allow row for its read
   * list or, for an operational resource, the Read All Operational Resources
   * wildcard, and no block with no labels on that list. Being in the room is
   * not hearing about every record: each event then goes only to the
   * listeners whose read of its record finds it (deliver), which weighs
   * labels, owned scope, labelled blocks and private records.
   */
  @CaptureSpan()
  public static hasPermissionsByModelName(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelName: string,
  ): boolean {
    let modelType:
      | { new (): BaseModel }
      | { new (): AnalyticsBaseModel }
      | null = getModelTypeByName(modelName);

    if (!modelType) {
      // check if it is an analytics model
      modelType = getAnalyticsModelTypeByname(modelName);

      if (!modelType) {
        return false;
      }
    }

    const model: BaseModel | AnalyticsBaseModel = new modelType();

    const held: HeldPermissions = instanceOfUserTenantAccessPermission(
      userProjectPermissions,
    )
      ? HeldPermissionsUtil.fromRows({
          rows: userProjectPermissions.permissions,
        })
      : HeldPermissionsUtil.fromPermissions(userProjectPermissions);

    return HeldPermissionsUtil.holdsModelPermission(held, {
      isOperationalResource: model.isOperationalResource,
      operation: "read",
      modelPermissions: model.getReadPermissions(),
    });
  }
}
