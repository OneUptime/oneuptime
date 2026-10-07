import IO from "../../../../Server/Infrastructure/SocketIO";
import Realtime from "../../../../Server/Utils/Realtime";
import RealtimeReaders from "../../../../Server/Utils/Realtime/RealtimeReaders";
import {
  NO_READER_ACCESS,
  RealtimeReadAccess,
  RealtimeReader,
  readableByEither,
} from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import UserType from "../../../../Types/UserType";
import RealtimeUtil from "../../../../Utils/Realtime";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A record's live update reaches only the listeners who may read the
 * record.
 *
 * Joining a model's room takes read access to the model (Realtime
 * .hasPermissionsByModelName). What each event then reaches is decided per
 * listener by the record's own read (RealtimeReadAccess): a listener who
 * reads every record of the model hears about every event, as before, with
 * no read; anyone else hears about the records their read finds, decided
 * with one read per batch of events. These tests drive Realtime's real
 * queue, audience and sending against a socket server that behaves like
 * socket.io's - including `to([])`, which socket.io reads as "every socket".
 */

jest.mock("../../../../Server/Infrastructure/SocketIO", () => {
  return {
    __esModule: true,
    default: {
      getSocketServer: jest.fn(),
    },
  };
});

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const OWNER: string = "11111111-1111-4111-8111-111111111111";
const LABELS_READER: string = "22222222-2222-4222-8222-222222222222";
const OWNED_READER: string = "33333333-3333-4333-8333-333333333333";
const BLOCKED_READER: string = "44444444-4444-4444-8444-444444444444";
const FORMER_MEMBER: string = "55555555-5555-4555-8555-555555555555";

const RECORD_A: string = "a0000000-0000-4000-8000-00000000000a";
const RECORD_B: string = "b0000000-0000-4000-8000-00000000000b";
const RECORD_C: string = "c0000000-0000-4000-8000-00000000000c";

interface Received {
  event: string;
  payload: JSONObject;
}

interface FakeSocket {
  id: string;
  rooms: Set<string>;
  data: Record<string, unknown>;
  received: Array<Received>;
}

/*
 * Just enough of socket.io's server: rooms, fetchSockets and `to(...)
 * .emit`. Every socket is in a room named after its own id, and `to([])`
 * reaches every socket, as in socket.io.
 */
class FakeSocketServer {
  public sockets: Array<FakeSocket> = [];
  public sendsToEveryone: number = 0;
  public sends: Array<{ targets: Array<string>; event: string }> = [];

  public on(): void {
    // Connections are not modelled here.
  }

  public in(rooms: string | Array<string>): {
    fetchSockets: () => Promise<Array<FakeSocket>>;
  } {
    const wanted: Array<string> = Array.isArray(rooms) ? rooms : [rooms];

    return {
      fetchSockets: async (): Promise<Array<FakeSocket>> => {
        return this.sockets.filter((socket: FakeSocket): boolean => {
          return wanted.some((room: string): boolean => {
            return socket.rooms.has(room);
          });
        });
      },
    };
  }

  public to(target: string | Array<string>): {
    emit: (event: string, payload: JSONObject) => void;
  } {
    const targets: Array<string> = Array.isArray(target) ? target : [target];

    return {
      emit: (event: string, payload: JSONObject): void => {
        this.sends.push({ targets: targets, event: event });

        if (targets.length === 0) {
          this.sendsToEveryone++;
        }

        for (const socket of this.sockets) {
          if (
            targets.length === 0 ||
            targets.some((room: string): boolean => {
              return socket.rooms.has(room);
            })
          ) {
            socket.received.push({ event: event, payload: payload });
          }
        }
      },
    };
  }

  public addSocket(data: {
    rooms: Array<string>;
    userId?: string | undefined;
    isMasterAdmin?: boolean | undefined;
  }): FakeSocket {
    const id: string = `socket-${this.sockets.length + 1}`;

    const socket: FakeSocket = {
      id: id,
      rooms: new Set<string>([id, ...data.rooms]),
      data: data.userId
        ? {
            realtimeReader: {
              userId: data.userId,
              isMasterAdmin: Boolean(data.isMasterAdmin),
            },
          }
        : {},
      received: [],
    };

    this.sockets.push(socket);

    return socket;
  }
}

/*
 * A record's read, as a test describes it: who reads every record, and
 * which records each other person's read finds. Records every question.
 */
class FakeReadAccess implements RealtimeReadAccess {
  public everyRecordReaders: Set<string> = new Set<string>();
  public readableByUser: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  public failingUsers: Set<string> = new Set<string>();
  public everyRecordQuestions: Array<string> = [];
  public reads: Array<{ userId: string; modelIds: Array<string> }> = [];

  public async readsEveryRecord(reader: RealtimeReader): Promise<boolean> {
    const userId: string = reader.props.userId!.toString();
    this.everyRecordQuestions.push(userId);
    return this.everyRecordReaders.has(userId);
  }

  public async getReadableIds(
    reader: RealtimeReader,
    modelIds: Array<ObjectID>,
  ): Promise<Array<string>> {
    const userId: string = reader.props.userId!.toString();
    const ids: Array<string> = modelIds.map((id: ObjectID): string => {
      return id.toString();
    });

    this.reads.push({ userId: userId, modelIds: ids });

    if (this.failingUsers.has(userId)) {
      throw new Error("The database is not answering");
    }

    const readable: Set<string> =
      this.readableByUser.get(userId) || new Set<string>();

    return ids.filter((id: string): boolean => {
      return readable.has(id);
    });
  }
}

function roomOf(
  modelName: string,
  eventType: ModelEventType,
  tenantId: string = TENANT_ID,
): string {
  return RealtimeUtil.getRoomId(tenantId, modelName, eventType);
}

function recordRoomOf(modelName: string, modelId: string): string {
  return RealtimeUtil.getRoomId(
    TENANT_ID,
    modelName,
    ModelEventType.Create,
    modelId,
  );
}

function modelIdsReceived(socket: FakeSocket, event: string): Array<string> {
  return socket.received
    .filter((received: Received): boolean => {
      return received.event === event;
    })
    .map((received: Received): string => {
      return received.payload["modelId"] as string;
    });
}

async function emit(
  access: RealtimeReadAccess,
  modelId: string,
  options?: {
    eventType?: ModelEventType;
    tenantId?: string;
    modelType?: typeof Incident | typeof Alert;
  },
): Promise<void> {
  await Realtime.emitModelEvent({
    tenantId: options?.tenantId || TENANT_ID,
    eventType: options?.eventType || ModelEventType.Update,
    modelId: new ObjectID(modelId),
    modelType: options?.modelType || Incident,
    access: access,
  });
}

const server: FakeSocketServer = new FakeSocketServer();

// The people of the project, and who is not a member any more.
const MEMBERS: Set<string> = new Set<string>([
  OWNER,
  LABELS_READER,
  OWNED_READER,
  BLOCKED_READER,
]);

let buildPropsCalls: Array<string> = [];

describe("Realtime: a record's live update reaches only people who may read it", () => {
  beforeAll(async () => {
    (IO.getSocketServer as unknown as jest.Mock).mockReturnValue(server);
    await Realtime.init();
  });

  beforeEach(() => {
    server.sockets = [];
    server.sendsToEveryone = 0;
    server.sends = [];
    buildPropsCalls = [];
    RealtimeReaders.clear();

    jest
      .spyOn(RealtimeReaders, "buildProps")
      .mockImplementation(
        async (
          identity: { userId: string; isMasterAdmin: boolean },
          projectId: string,
        ): Promise<DatabaseCommonInteractionProps | null> => {
          buildPropsCalls.push(identity.userId);

          if (!MEMBERS.has(identity.userId) && !identity.isMasterAdmin) {
            return null;
          }

          return {
            userId: new ObjectID(identity.userId),
            userType: UserType.User,
            tenantId: new ObjectID(projectId),
          };
        },
      );
  });

  afterEach(async () => {
    await Realtime.waitForPendingDeliveries();
    jest.restoreAllMocks();
  });

  test("a reader of every record hears about every event, as before, without a read per record", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);

    const owner: FakeSocket = server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Update)],
      userId: OWNER,
    });

    await emit(access, RECORD_A);
    await emit(access, RECORD_B);
    await Realtime.waitForPendingDeliveries();

    expect(
      modelIdsReceived(owner, roomOf("Incident", ModelEventType.Update)),
    ).toEqual([RECORD_A, RECORD_B]);
    expect(access.reads).toEqual([]);
  });

  test("project-wide, Labels-scoped, Owned-scoped and blocked readers each hear about exactly the records their read finds", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    // Their reads, as the record's read would answer them.
    access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
    access.readableByUser.set(OWNED_READER, new Set([RECORD_B]));
    access.readableByUser.set(BLOCKED_READER, new Set([RECORD_B, RECORD_C]));

    const room: string = roomOf("Incident", ModelEventType.Update);
    const owner: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNER,
    });
    const labels: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });
    const owned: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNED_READER,
    });
    const blocked: FakeSocket = server.addSocket({
      rooms: [room],
      userId: BLOCKED_READER,
    });

    await emit(access, RECORD_A);
    await emit(access, RECORD_B);
    await emit(access, RECORD_C);
    await Realtime.waitForPendingDeliveries();

    expect(modelIdsReceived(owner, room)).toEqual([
      RECORD_A,
      RECORD_B,
      RECORD_C,
    ]);
    expect(modelIdsReceived(labels, room)).toEqual([RECORD_A]);
    expect(modelIdsReceived(owned, room)).toEqual([RECORD_B]);
    expect(modelIdsReceived(blocked, room)).toEqual([RECORD_B, RECORD_C]);
    expect(server.sendsToEveryone).toBe(0);
  });

  test("events that arrive together are decided together: one read per person for the batch", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.readableByUser.set(LABELS_READER, new Set([RECORD_A, RECORD_C]));

    const room: string = roomOf("Incident", ModelEventType.Update);
    const labels: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });

    // Queued in one turn, as a write of several rows queues them.
    void emit(access, RECORD_A);
    void emit(access, RECORD_B);
    void emit(access, RECORD_C);
    await Realtime.waitForPendingDeliveries();

    expect(access.reads).toEqual([
      {
        userId: LABELS_READER,
        modelIds: [RECORD_A, RECORD_B, RECORD_C],
      },
    ]);
    expect(access.everyRecordQuestions).toEqual([LABELS_READER]);
    expect(modelIdsReceived(labels, room)).toEqual([RECORD_A, RECORD_C]);
  });

  test("an event reaches a reader as often as it happened", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));

    const room: string = roomOf("Incident", ModelEventType.Update);
    const owner: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNER,
    });
    const labels: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });

    void emit(access, RECORD_A);
    void emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();

    expect(modelIdsReceived(owner, room)).toEqual([RECORD_A, RECORD_A]);
    expect(modelIdsReceived(labels, room)).toEqual([RECORD_A, RECORD_A]);
    // One question for the record, however often it changed.
    expect(access.reads).toEqual([
      { userId: LABELS_READER, modelIds: [RECORD_A] },
    ]);
  });

  test("a person with several tabs is asked about once, and every tab hears", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));

    const room: string = roomOf("Incident", ModelEventType.Create);
    const firstTab: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });
    const secondTab: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });

    await emit(access, RECORD_A, { eventType: ModelEventType.Create });
    await Realtime.waitForPendingDeliveries();

    expect(access.reads).toHaveLength(1);
    expect(buildPropsCalls).toEqual([LABELS_READER]);
    expect(modelIdsReceived(firstTab, room)).toEqual([RECORD_A]);
    expect(modelIdsReceived(secondTab, room)).toEqual([RECORD_A]);
  });

  test("nobody who may read the record: nothing is sent at all, never to an empty list of sockets", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.readableByUser.set(LABELS_READER, new Set());

    const room: string = roomOf("Incident", ModelEventType.Update);
    const labels: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });
    // A socket in no room of the model: socket.io's to([]) would reach it.
    const elsewhere: FakeSocket = server.addSocket({
      rooms: [roomOf("Alert", ModelEventType.Update)],
      userId: OWNER,
    });

    await emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();

    expect(labels.received).toEqual([]);
    expect(elsewhere.received).toEqual([]);
    expect(server.sends).toEqual([]);
    expect(server.sendsToEveryone).toBe(0);
  });

  test("someone who is no longer a member of the project hears nothing, and their records are not read for them", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(FORMER_MEMBER);

    const room: string = roomOf("Incident", ModelEventType.Update);
    const former: FakeSocket = server.addSocket({
      rooms: [room],
      userId: FORMER_MEMBER,
    });

    await emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();

    expect(former.received).toEqual([]);
    expect(access.everyRecordQuestions).toEqual([]);
    expect(access.reads).toEqual([]);
  });

  test("a socket that never said who it is hears nothing", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);

    const room: string = roomOf("Incident", ModelEventType.Update);
    const anonymous: FakeSocket = server.addSocket({ rooms: [room] });
    anonymous.data = { realtimeReader: { userId: "", isMasterAdmin: true } };
    const unnamed: FakeSocket = server.addSocket({ rooms: [room] });

    await emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();

    expect(anonymous.received).toEqual([]);
    expect(unnamed.received).toEqual([]);
    expect(buildPropsCalls).toEqual([]);
  });

  test("a server admin's socket reads every project's records, as their requests do", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    const admin: string = "66666666-6666-4666-8666-666666666666";
    access.everyRecordReaders.add(admin);

    const room: string = roomOf("Incident", ModelEventType.Update);
    const adminSocket: FakeSocket = server.addSocket({
      rooms: [room],
      userId: admin,
      isMasterAdmin: true,
    });

    await emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();

    expect(modelIdsReceived(adminSocket, room)).toEqual([RECORD_A]);
  });

  test("a read that fails leaves that listener out and the others unaffected; nothing rejects", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    access.readableByUser.set(OWNED_READER, new Set([RECORD_A]));
    access.failingUsers.add(LABELS_READER);
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const room: string = roomOf("Incident", ModelEventType.Update);
    const owner: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNER,
    });
    const failing: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });
    const owned: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNED_READER,
    });

    await expect(emit(access, RECORD_A)).resolves.toBeUndefined();
    await Realtime.waitForPendingDeliveries();

    expect(failing.received).toEqual([]);
    expect(modelIdsReceived(owner, room)).toEqual([RECORD_A]);
    expect(modelIdsReceived(owned, room)).toEqual([RECORD_A]);
  });

  test("permissions that cannot be read right now: that listener hears nothing, and the next event asks again", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    (RealtimeReaders.buildProps as unknown as jest.Mock).mockImplementationOnce(
      async (): Promise<DatabaseCommonInteractionProps | null> => {
        buildPropsCalls.push(OWNER);
        throw new Error("The permission cache is down");
      },
    );

    const room: string = roomOf("Incident", ModelEventType.Update);
    const owner: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNER,
    });

    await emit(access, RECORD_A);
    await Realtime.waitForPendingDeliveries();
    expect(owner.received).toEqual([]);

    await emit(access, RECORD_B);
    await Realtime.waitForPendingDeliveries();
    expect(modelIdsReceived(owner, room)).toEqual([RECORD_B]);
    expect(buildPropsCalls).toEqual([OWNER, OWNER]);
  });

  test("a record's own room hears about it only when the listener may read it", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
    access.readableByUser.set(OWNED_READER, new Set());

    const labels: FakeSocket = server.addSocket({
      rooms: [recordRoomOf("Incident", RECORD_A)],
      userId: LABELS_READER,
    });
    const owned: FakeSocket = server.addSocket({
      rooms: [recordRoomOf("Incident", RECORD_A)],
      userId: OWNED_READER,
    });

    await emit(access, RECORD_A, { eventType: ModelEventType.Update });
    await emit(access, RECORD_A, { eventType: ModelEventType.Delete });
    await Realtime.waitForPendingDeliveries();

    expect(
      modelIdsReceived(labels, recordRoomOf("Incident", RECORD_A)),
    ).toEqual([RECORD_A, RECORD_A]);
    expect(owned.received).toEqual([]);
  });

  test("each room hears only its own project's, model's and kind's events", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);

    const incidentUpdates: FakeSocket = server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Update)],
      userId: OWNER,
    });
    const alertUpdates: FakeSocket = server.addSocket({
      rooms: [roomOf("Alert", ModelEventType.Update)],
      userId: OWNER,
    });
    const otherProject: FakeSocket = server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Update, OTHER_TENANT_ID)],
      userId: OWNER,
    });
    const incidentCreates: FakeSocket = server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Create)],
      userId: OWNER,
    });

    await emit(access, RECORD_A);
    await emit(access, RECORD_B, { modelType: Alert });
    await Realtime.waitForPendingDeliveries();

    expect(
      modelIdsReceived(
        incidentUpdates,
        roomOf("Incident", ModelEventType.Update),
      ),
    ).toEqual([RECORD_A]);
    expect(
      modelIdsReceived(alertUpdates, roomOf("Alert", ModelEventType.Update)),
    ).toEqual([RECORD_B]);
    expect(otherProject.received).toEqual([]);
    expect(incidentCreates.received).toEqual([]);
  });

  test("a project's people are asked about in that project", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);

    server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Update, OTHER_TENANT_ID)],
      userId: OWNER,
    });

    const projects: Array<string> = [];
    (RealtimeReaders.buildProps as unknown as jest.Mock).mockImplementation(
      async (
        identity: { userId: string },
        projectId: string,
      ): Promise<DatabaseCommonInteractionProps | null> => {
        projects.push(projectId);
        return {
          userId: new ObjectID(identity.userId),
          tenantId: new ObjectID(projectId),
        };
      },
    );

    await emit(access, RECORD_A, { tenantId: OTHER_TENANT_ID });
    await Realtime.waitForPendingDeliveries();

    expect(projects).toEqual([OTHER_TENANT_ID]);
  });

  test("a batch holds at most MAX_EVENTS_PER_DELIVERY events; the rest go in the next ones", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    const total: number = Realtime.MAX_EVENTS_PER_DELIVERY * 2 + 7;
    const ids: Array<string> = [];

    for (let i: number = 0; i < total; i++) {
      ids.push(ObjectID.generate().toString());
    }

    access.readableByUser.set(LABELS_READER, new Set(ids));

    const room: string = roomOf("Incident", ModelEventType.Update);
    const labels: FakeSocket = server.addSocket({
      rooms: [room],
      userId: LABELS_READER,
    });

    for (const id of ids) {
      void emit(access, id);
    }

    await Realtime.waitForPendingDeliveries();

    expect(
      access.reads.map((read: { modelIds: Array<string> }): number => {
        return read.modelIds.length;
      }),
    ).toEqual([
      Realtime.MAX_EVENTS_PER_DELIVERY,
      Realtime.MAX_EVENTS_PER_DELIVERY,
      7,
    ]);
    expect(modelIdsReceived(labels, room)).toEqual(ids);
  });

  test("past MAX_WAITING_EVENTS behind a delivery in progress, new events are dropped rather than kept", async () => {
    let release: () => void = (): void => {};
    const held: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    const readsEveryRecord: (reader: RealtimeReader) => Promise<boolean> =
      access.readsEveryRecord.bind(access);
    access.readsEveryRecord = async (
      reader: RealtimeReader,
    ): Promise<boolean> => {
      await held;
      return readsEveryRecord(reader);
    };

    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    const room: string = roomOf("Incident", ModelEventType.Update);
    const owner: FakeSocket = server.addSocket({
      rooms: [room],
      userId: OWNER,
    });

    // The first delivery starts, and waits.
    await emit(access, RECORD_A);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    for (let i: number = 0; i < Realtime.MAX_WAITING_EVENTS + 3; i++) {
      void emit(access, RECORD_B);
    }

    release();
    await Realtime.waitForPendingDeliveries();

    expect(modelIdsReceived(owner, room)).toHaveLength(
      1 + Realtime.MAX_WAITING_EVENTS,
    );
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test("an event for a model with no table is not queued", async () => {
    const access: FakeReadAccess = new FakeReadAccess();
    access.everyRecordReaders.add(OWNER);
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const owner: FakeSocket = server.addSocket({
      rooms: [roomOf("Incident", ModelEventType.Update)],
      userId: OWNER,
    });

    class NoTable {
      public tableName: string | null = null;
    }

    await Realtime.emitModelEvent({
      tenantId: TENANT_ID,
      eventType: ModelEventType.Update,
      modelId: new ObjectID(RECORD_A),
      modelType: NoTable as unknown as typeof Incident,
      access: access,
    });
    await Realtime.waitForPendingDeliveries();

    expect(owner.received).toEqual([]);
  });

  describe("update events: who could read a record before the write hears about it too", () => {
    test("someone the update takes the record away from hears about it; someone who could read it neither before nor after does not", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      // Before the write: the Labels reader may read the record...
      access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
      access.readableByUser.set(OWNED_READER, new Set());

      const room: string = roomOf("Incident", ModelEventType.Update);
      const labels: FakeSocket = server.addSocket({
        rooms: [room],
        userId: LABELS_READER,
      });
      const owned: FakeSocket = server.addSocket({
        rooms: [room],
        userId: OWNED_READER,
      });

      const beforeUpdate: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
          eventType: ModelEventType.Update,
        });

      // ...the write takes its label off: now nobody of them may.
      access.readableByUser.set(LABELS_READER, new Set());

      await emit(readableByEither(access, beforeUpdate), RECORD_A);
      await Realtime.waitForPendingDeliveries();

      expect(modelIdsReceived(labels, room)).toEqual([RECORD_A]);
      expect(owned.received).toEqual([]);
    });

    test("someone the update gives the record to hears about it from the read after the write", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.readableByUser.set(LABELS_READER, new Set());

      const room: string = roomOf("Incident", ModelEventType.Update);
      const labels: FakeSocket = server.addSocket({
        rooms: [room],
        userId: LABELS_READER,
      });

      const beforeUpdate: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
          eventType: ModelEventType.Update,
        });

      // Nobody could read it before: nothing is kept from then.
      expect(beforeUpdate).toBe(NO_READER_ACCESS);

      access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));

      await emit(readableByEither(access, beforeUpdate), RECORD_A);
      await Realtime.waitForPendingDeliveries();

      expect(modelIdsReceived(labels, room)).toEqual([RECORD_A]);
    });

    test("only the listeners the write may change the read of are asked before it", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
      access.readableByUser.set(OWNED_READER, new Set([RECORD_A]));

      const room: string = roomOf("Incident", ModelEventType.Update);
      server.addSocket({ rooms: [room], userId: LABELS_READER });
      server.addSocket({ rooms: [room], userId: OWNED_READER });

      const asked: Array<string> = [];

      await Realtime.snapshotReadAccess({
        tenantId: TENANT_ID,
        modelType: Incident,
        modelIds: [new ObjectID(RECORD_A)],
        access: access,
        eventType: ModelEventType.Update,
        onlyFor: async (reader: RealtimeReader): Promise<boolean> => {
          const userId: string = reader.props.userId!.toString();
          asked.push(userId);
          return userId === LABELS_READER;
        },
      });

      expect(asked.sort()).toEqual([LABELS_READER, OWNED_READER].sort());
      expect(
        access.reads.map((read: { userId: string }): string => {
          return read.userId;
        }),
      ).toEqual([LABELS_READER]);
      expect(access.everyRecordQuestions).toEqual([LABELS_READER]);
    });

    test("the listeners for updates, and in the record's own room, are asked - not those of other kinds", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
      access.readableByUser.set(OWNED_READER, new Set([RECORD_A]));
      access.readableByUser.set(BLOCKED_READER, new Set([RECORD_A]));

      server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Update)],
        userId: LABELS_READER,
      });
      server.addSocket({
        rooms: [recordRoomOf("Incident", RECORD_A)],
        userId: OWNED_READER,
      });
      server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: BLOCKED_READER,
      });

      await Realtime.snapshotReadAccess({
        tenantId: TENANT_ID,
        modelType: Incident,
        modelIds: [new ObjectID(RECORD_A)],
        access: access,
        eventType: ModelEventType.Update,
      });

      expect(
        access.reads
          .map((read: { userId: string }): string => {
            return read.userId;
          })
          .sort(),
      ).toEqual([LABELS_READER, OWNED_READER].sort());
    });
  });

  describe("delete events: decided while the records can still be read", () => {
    test("the people listening now hear about the records they could read, from what was decided then", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);
      access.readableByUser.set(LABELS_READER, new Set([RECORD_A]));
      access.readableByUser.set(OWNED_READER, new Set());

      const room: string = roomOf("Incident", ModelEventType.Delete);
      const owner: FakeSocket = server.addSocket({
        rooms: [room],
        userId: OWNER,
      });
      const labels: FakeSocket = server.addSocket({
        rooms: [room],
        userId: LABELS_READER,
      });
      const owned: FakeSocket = server.addSocket({
        rooms: [room],
        userId: OWNED_READER,
      });

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A), new ObjectID(RECORD_B)],
          access: access,
        });

      const readsBeforeDelete: number = access.reads.length;

      // The rows are gone now: their read finds nothing any more.
      access.everyRecordReaders.clear();
      access.readableByUser.clear();

      await emit(beforeDelete, RECORD_A, { eventType: ModelEventType.Delete });
      await emit(beforeDelete, RECORD_B, { eventType: ModelEventType.Delete });
      await Realtime.waitForPendingDeliveries();

      expect(modelIdsReceived(owner, room)).toEqual([RECORD_A, RECORD_B]);
      expect(modelIdsReceived(labels, room)).toEqual([RECORD_A]);
      expect(owned.received).toEqual([]);
      // Nothing is read once the rows are gone.
      expect(access.reads).toHaveLength(readsBeforeDelete);
    });

    test("someone who starts listening after the decision hears nothing about those records", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);
      access.everyRecordReaders.add(LABELS_READER);

      const room: string = roomOf("Incident", ModelEventType.Delete);
      server.addSocket({ rooms: [room], userId: OWNER });

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      const late: FakeSocket = server.addSocket({
        rooms: [room],
        userId: LABELS_READER,
      });

      await emit(beforeDelete, RECORD_A, { eventType: ModelEventType.Delete });
      await Realtime.waitForPendingDeliveries();

      expect(late.received).toEqual([]);
    });

    test("nothing listening: the decision is nobody, made without a read", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      expect(access.everyRecordQuestions).toEqual([]);

      const owner: FakeSocket = server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: OWNER,
      });

      await emit(beforeDelete, RECORD_A, { eventType: ModelEventType.Delete });
      await Realtime.waitForPendingDeliveries();

      expect(owner.received).toEqual([]);
    });

    test("a decision that takes too long lets the delete go ahead, and nobody hears about those records", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      // The owner's answer does not come back in time.
      let answer: (readsEveryRecord: boolean) => void = (): void => {};
      access.readsEveryRecord = (): Promise<boolean> => {
        return new Promise<boolean>(
          (resolve: (readsEveryRecord: boolean) => void): void => {
            answer = resolve;
          },
        );
      };
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation((): void => {});

      const timeouts: { BEFORE_WRITE_DECISION_TIMEOUT_IN_MS: number } =
        Realtime as unknown as { BEFORE_WRITE_DECISION_TIMEOUT_IN_MS: number };
      const timeout: number = timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS;
      timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS = 20;

      try {
        const owner: FakeSocket = server.addSocket({
          rooms: [roomOf("Incident", ModelEventType.Delete)],
          userId: OWNER,
        });

        const startedAt: number = Date.now();

        const beforeDelete: RealtimeReadAccess =
          await Realtime.snapshotReadAccess({
            tenantId: TENANT_ID,
            modelType: Incident,
            modelIds: [new ObjectID(RECORD_A)],
            access: access,
          });

        expect(Date.now() - startedAt).toBeLessThan(2000);
        expect(beforeDelete).toBe(NO_READER_ACCESS);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("could not be decided in time"),
          expect.objectContaining({ projectId: TENANT_ID }),
        );

        // The answer that comes back later changes nothing.
        answer(true);
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 0);
        });

        await emit(beforeDelete, RECORD_A, {
          eventType: ModelEventType.Delete,
        });
        await Realtime.waitForPendingDeliveries();

        expect(owner.received).toEqual([]);
      } finally {
        timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS = timeout;
        answer(false);
      }
    });

    test("a decision made in time leaves no timer running", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);

      server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: OWNER,
      });

      const clearTimeoutSpy: jest.SpyInstance = jest.spyOn(
        global,
        "clearTimeout",
      );

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      expect(beforeDelete).not.toBe(NO_READER_ACCESS);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    test("nobody listening: no decision is worked out at all", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      expect(beforeDelete).toBe(NO_READER_ACCESS);
      expect(access.everyRecordQuestions).toEqual([]);
      expect(access.reads).toEqual([]);
    });

    test("finding the listeners counts against the time too", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);
      jest.spyOn(logger, "warn").mockImplementation((): void => {});

      const timeouts: { BEFORE_WRITE_DECISION_TIMEOUT_IN_MS: number } =
        Realtime as unknown as { BEFORE_WRITE_DECISION_TIMEOUT_IN_MS: number };
      const timeout: number = timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS;
      timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS = 20;

      // The sockets of the room never come back.
      let answer: (sockets: Array<FakeSocket>) => void = (): void => {};
      const fetchOf: jest.SpyInstance = jest
        .spyOn(server, "in")
        .mockImplementation(() => {
          return {
            fetchSockets: (): Promise<Array<FakeSocket>> => {
              return new Promise<Array<FakeSocket>>(
                (resolve: (sockets: Array<FakeSocket>) => void): void => {
                  answer = resolve;
                },
              );
            },
          };
        });

      try {
        const startedAt: number = Date.now();

        const beforeDelete: RealtimeReadAccess =
          await Realtime.snapshotReadAccess({
            tenantId: TENANT_ID,
            modelType: Incident,
            modelIds: [new ObjectID(RECORD_A)],
            access: access,
          });

        expect(Date.now() - startedAt).toBeLessThan(2000);
        expect(beforeDelete).toBe(NO_READER_ACCESS);
        expect(fetchOf).toHaveBeenCalled();
      } finally {
        timeouts.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS = timeout;
        answer([]);
      }
    });

    test("listeners who could read none of the rows: nothing is kept for them", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.readableByUser.set(LABELS_READER, new Set());

      server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: LABELS_READER,
      });

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      expect(access.reads).toHaveLength(1);
      expect(beforeDelete).toBe(NO_READER_ACCESS);
    });

    test("what was decided is answered from memory: delivering it takes no read slot", async () => {
      const access: FakeReadAccess = new FakeReadAccess();
      access.everyRecordReaders.add(OWNER);

      server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: OWNER,
      });

      const beforeDelete: RealtimeReadAccess =
        await Realtime.snapshotReadAccess({
          tenantId: TENANT_ID,
          modelType: Incident,
          modelIds: [new ObjectID(RECORD_A)],
          access: access,
        });

      expect(beforeDelete.answersWithoutReading).toBe(true);
    });

    test("an access that reads nothing sends nothing", async () => {
      const owner: FakeSocket = server.addSocket({
        rooms: [roomOf("Incident", ModelEventType.Delete)],
        userId: OWNER,
      });

      await emit(NO_READER_ACCESS, RECORD_A, {
        eventType: ModelEventType.Delete,
      });
      await Realtime.waitForPendingDeliveries();

      expect(owner.received).toEqual([]);
      expect(server.sendsToEveryone).toBe(0);
    });
  });
});
