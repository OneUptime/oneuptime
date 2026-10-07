import IO, { Socket, SocketServer } from "../Infrastructure/SocketIO";
import logger, { LogAttributes } from "./Logger";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseType from "../../Types/BaseDatabase/DatabaseType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RealtimeUtil from "../../Utils/Realtime";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import JSONWebToken from "./JsonWebToken";
import Permission, {
  UserGlobalAccessPermission,
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
import CookieUtil from "./Cookie";
import Dictionary from "../../Types/Dictionary";
import UserPermissionUtil from "./UserPermission/UserPermission";
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

// What became of one ListenToModelEvent request.
export enum ListenToModelEventOutcome {
  Joined = "Joined",
  // No access token, or one that no longer decodes. The client was told.
  AuthenticationRequired = "AuthenticationRequired",
  // A valid session without access to this tenant or model.
  NotAuthorized = "NotAuthorized",
  // The request itself was malformed.
  InvalidRequest = "InvalidRequest",
  // Something failed while authorizing (for example the permission cache).
  Failed = "Failed",
}

/*
 * What Realtime keeps on a socket that joined a room (socket.data): the
 * person its access token names. Plain JSON, so it survives an adapter that
 * hands sockets of other servers over the wire.
 */
const READER_OF_SOCKET_KEY: string = "realtimeReader";

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
  modelIds: Array<string>;
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

    /*
     * before joining room check the user token and check if the user has access to this tenant
     * and to this model and to this event type
     */

    logger.debug(
      "Extracting user access token from socket",
      listenLogAttributes,
    );
    const userAccessToken: string | undefined =
      this.getAccessTokenFromSocket(socket);

    if (!userAccessToken) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User access token not found in socket",
        listenLogAttributes,
      );
    }

    logger.debug("Decoding user access token", listenLogAttributes);

    /*
     * The token is the one the browser sent with the handshake, and it is not
     * re-read for the life of the connection. Once it expires every decode
     * throws, which is the normal state of a dashboard tab left open past the
     * access token's lifetime, not an error in the request.
     */
    let userAuthorizationData: JSONWebTokenData;

    try {
      userAuthorizationData = JSONWebToken.decode(userAccessToken);
    } catch {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User access token in socket is invalid or expired",
        listenLogAttributes,
      );
    }

    if (!userAuthorizationData) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User authorization data not found in socket",
        listenLogAttributes,
      );
    }

    if (!userAuthorizationData.userId) {
      return this.rejectForMissingAuthentication(
        socket,
        data,
        "User ID not found in socket",
        listenLogAttributes,
      );
    }

    logger.debug("Checking user access permissions", listenLogAttributes);
    let hasAccess: boolean = false;

    if (userAuthorizationData.isMasterAdmin) {
      logger.debug(
        "User is a master admin, granting access",
        listenLogAttributes,
      );
      hasAccess = true;
    }

    logger.debug(
      "Fetching user global access permissions",
      listenLogAttributes,
    );
    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(
        userAuthorizationData.userId,
      );

    // check if the user has access to this tenant
    if (userGlobalAccessPermission && !hasAccess) {
      logger.debug(
        "Checking if user has access to the tenant",
        listenLogAttributes,
      );
      const hasAccessToProjectId: boolean =
        userGlobalAccessPermission.projectIds.some((projectId: ObjectID) => {
          return projectId.toString() === data.tenantId.toString();
        });

      if (!hasAccessToProjectId) {
        logger.debug(
          "User does not have access to this tenant, aborting joining room",
          listenLogAttributes,
        );
        return ListenToModelEventOutcome.NotAuthorized;
      }

      logger.debug(
        "User has access to the tenant, checking model access",
        listenLogAttributes,
      );
      const userId: ObjectID = new ObjectID(
        userAuthorizationData.userId.toString(),
      );
      const projectId: ObjectID = new ObjectID(data.tenantId.toString());

      // if it has the access to the tenant, check if it has access to the model
      const userTenantAccessPermission: UserTenantAccessPermission | null =
        await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
          userId,
          projectId,
        );

      // check if the user has access to this model
      if (
        userTenantAccessPermission &&
        this.hasPermissionsByModelName(
          userTenantAccessPermission,
          data.modelName,
        )
      ) {
        logger.debug(
          "User has access to the model, granting access",
          listenLogAttributes,
        );
        hasAccess = true;
      }
    }

    /*
     * Authenticated but not allowed. The room is not joined and, as before,
     * nothing is sent back: a fresh session would not change the answer.
     */
    if (!hasAccess) {
      logger.debug(
        "User does not have access to this tenant, aborting joining room",
        listenLogAttributes,
      );
      return ListenToModelEventOutcome.NotAuthorized;
    }

    /*
     * Joining the room is not hearing about every record in it: each event
     * goes only to the listeners who may read its record, asked as this
     * person when it happens (deliver). The socket keeps who it is.
     */
    this.rememberReaderOfSocket(socket, {
      userId: userAuthorizationData.userId.toString(),
      isMasterAdmin: Boolean(userAuthorizationData.isMasterAdmin),
    });

    if (data.modelId) {
      const modelRoomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        ModelEventType.Create,
        data.modelId,
      );

      logger.debug(`Joining room with ID: ${modelRoomId}`, listenLogAttributes);
      // join the room.
      await socket.join(modelRoomId);
    } else {
      const roomId: string = RealtimeUtil.getRoomId(
        data.tenantId,
        data.modelName,
        data.eventType,
      );

      logger.debug(`Joining room with ID: ${roomId}`, listenLogAttributes);
      // join the room.
      await socket.join(roomId);
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
   */
  @CaptureSpan()
  public static async emitModelEvent(data: {
    tenantId: string | ObjectID;
    eventType: ModelEventType;
    modelId: ObjectID;
    modelType: { new (): BaseModel | AnalyticsBaseModel };
    access: RealtimeReadAccess;
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
      access: data.access,
    });
  }

  /*
   * Who may hear that these records are gone, decided while they are still
   * there: a delete event is sent once the rows are deleted, when no read
   * can find them any more. Returns an access that answers from what was
   * decided now - for the people listening now; anyone who starts listening
   * later never knew the records and hears nothing about them. Never throws:
   * when the answer cannot be worked out, nobody hears about them.
   */
  @CaptureSpan()
  public static async snapshotReadAccess(data: {
    tenantId: string | ObjectID;
    modelType: { new (): BaseModel | AnalyticsBaseModel };
    modelIds: Array<ObjectID>;
    access: RealtimeReadAccess;
  }): Promise<RealtimeReadAccess> {
    const tenantId: string = data.tenantId.toString();
    const tableName: string | null = new data.modelType().tableName;

    if (!this.socketServer || !tableName || data.modelIds.length === 0) {
      return NO_READER_ACCESS;
    }

    try {
      const modelIds: Array<string> = data.modelIds.map((id: ObjectID) => {
        return id.toString();
      });

      const listening: Array<ListeningSocket> = await this.fetchListeningSockets(
        [
          RealtimeUtil.getRoomId(tenantId, tableName, ModelEventType.Delete),
          ...modelIds.map((modelId: string): string => {
            return RealtimeUtil.getRoomId(
              tenantId,
              tableName,
              ModelEventType.Create,
              modelId,
            );
          }),
        ],
      );

      const readable: Map<string, Set<string>> =
        await RealtimeAudience.getReadableIds({
          tenantId: tenantId,
          access: data.access,
          readers: this.getReadersOfSockets(listening),
          modelIds: modelIds,
        });

      return {
        readsEveryRecord: async (): Promise<boolean> => {
          return false;
        },
        getReadableIds: async (
          reader: RealtimeReader,
          ids: Array<ObjectID>,
        ): Promise<Array<string>> => {
          const readableNow: Set<string> | undefined = readable.get(
            reader.key,
          );

          if (!readableNow) {
            return [];
          }

          return ids
            .map((id: ObjectID): string => {
              return normalizeRealtimeId(id);
            })
            .filter((id: string): boolean => {
              return readableNow.has(id);
            });
        },
      };
    } catch (err) {
      logger.error(err, { projectId: tenantId });
      return NO_READER_ACCESS;
    }
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
        modelIds: [],
        draining: false,
      };

      this.pendingEvents.set(key, pending);
    }

    if (pending.modelIds.length >= this.MAX_WAITING_EVENTS) {
      logger.warn(
        `Realtime: too many ${event.tableName} events are waiting to be delivered; this one is dropped.`,
        { projectId: event.tenantId } as LogAttributes,
      );
      return;
    }

    pending.modelIds.push(event.modelId);

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

      while (pending.modelIds.length > 0) {
        const modelIds: Array<string> = pending.modelIds.splice(
          0,
          this.MAX_EVENTS_PER_DELIVERY,
        );

        try {
          await this.deliver({
            tenantId: pending.tenantId,
            tableName: pending.tableName,
            eventType: pending.eventType,
            access: pending.access,
            modelIds: modelIds,
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
    modelIds: Array<string>;
  }): Promise<void> {
    if (!this.socketServer || batch.modelIds.length === 0) {
      return;
    }

    const roomId: string = RealtimeUtil.getRoomId(
      batch.tenantId,
      batch.tableName,
      batch.eventType,
    );

    const recordRoomIds: Map<string, string> = new Map<string, string>();

    for (const modelId of batch.modelIds) {
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

    if (listening.length === 0) {
      return;
    }

    const readable: Map<string, Set<string>> =
      await RealtimeAudience.getReadableIds({
        tenantId: batch.tenantId,
        access: batch.access,
        readers: this.getReadersOfSockets(listening),
        modelIds: batch.modelIds,
      });

    // The sockets of each person who may read anything of the batch.
    const socketsOfReaders: Array<{
      readable: Set<string>;
      sockets: Array<ListeningSocket>;
    }> = [];

    const socketsByReader: Map<string, Array<ListeningSocket>> = new Map<
      string,
      Array<ListeningSocket>
    >();

    for (const socket of listening) {
      const identity: RealtimeReaderIdentity | null =
        this.getReaderOfSocket(socket);

      if (!identity) {
        continue;
      }

      const key: string = RealtimeReaders.getKey(identity, batch.tenantId);
      const sockets: Array<ListeningSocket> = socketsByReader.get(key) || [];
      sockets.push(socket);
      socketsByReader.set(key, sockets);
    }

    for (const [key, sockets] of socketsByReader.entries()) {
      const readableIds: Set<string> | undefined = readable.get(key);

      if (readableIds && readableIds.size > 0) {
        socketsOfReaders.push({ readable: readableIds, sockets: sockets });
      }
    }

    // Each event, as often as it happened, to exactly those sockets.
    for (const modelId of batch.modelIds) {
      const recordRoomId: string = recordRoomIds.get(modelId)!;
      const normalizedId: string = normalizeRealtimeId(modelId);
      const inRoom: Array<string> = [];
      const inRecordRoom: Array<string> = [];

      for (const reader of socketsOfReaders) {
        if (!reader.readable.has(normalizedId)) {
          continue;
        }

        for (const socket of reader.sockets) {
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

    this.socketServer.to(Array.from(new Set(socketIds))).emit(eventName, payload);
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
   * rooms with. A socket that never said hears nothing.
   */
  private static getReaderOfSocket(socket: {
    data: unknown;
  }): RealtimeReaderIdentity | null {
    const data: unknown = socket.data;

    if (!data || typeof data !== "object") {
      return null;
    }

    const reader: unknown = (data as Dictionary<unknown>)[READER_OF_SOCKET_KEY];

    if (
      !reader ||
      typeof reader !== "object" ||
      typeof (reader as Dictionary<unknown>)["userId"] !== "string" ||
      !(reader as Dictionary<unknown>)["userId"]
    ) {
      return null;
    }

    return {
      userId: (reader as Dictionary<unknown>)["userId"] as string,
      isMasterAdmin: (reader as Dictionary<unknown>)["isMasterAdmin"] === true,
    };
  }

  private static rememberReaderOfSocket(
    socket: Socket,
    identity: RealtimeReaderIdentity,
  ): void {
    const data: Dictionary<unknown> =
      socket.data && typeof socket.data === "object"
        ? (socket.data as Dictionary<unknown>)
        : {};

    socket.data = {
      ...data,
      [READER_OF_SOCKET_KEY]: {
        userId: identity.userId,
        isMasterAdmin: identity.isMasterAdmin,
      },
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

  @CaptureSpan()
  public static getAccessTokenFromSocket(socket: Socket): string | undefined {
    let accessToken: string | undefined = undefined;

    if (socket.handshake.headers.cookie) {
      const cookies: Dictionary<string> = CookieUtil.getCookiesFromCookieString(
        socket.handshake.headers.cookie,
      );

      if (cookies[CookieUtil.getUserTokenKey()]) {
        accessToken = cookies[CookieUtil.getUserTokenKey()];
      }
    }

    return accessToken;
  }
}
