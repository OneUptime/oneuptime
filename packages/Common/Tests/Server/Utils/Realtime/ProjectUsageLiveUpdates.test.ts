import IO from "../../../../Server/Infrastructure/SocketIO";
import Realtime from "../../../../Server/Utils/Realtime";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeReaders from "../../../../Server/Utils/Realtime/RealtimeReaders";
import ProjectUsageCache from "../../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import ActivationMilestone from "../../../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import UserType from "../../../../Types/UserType";
import RealtimeUtil from "../../../../Utils/Realtime";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S OPEN PAGES HEAR THAT WHAT IT USES CHANGED (#8626).
 *
 * The products menu showed a teammate's first monitor, an agent's first
 * host with no guide open, or a product's last record deleted by a
 * workflow, only on its next look once its answer was 15 seconds old. Now
 * every new generation of a project's usage (ProjectUsageCache) is
 * announced on the channel every server listens to
 * (RealtimeAccessChanges.ProjectUsageChanged), and each server hands it to
 * the project's usage room. Here, the server's side of that:
 *
 *   - who hears it: the sockets in the project's usage room whose person
 *     still reads in the project (a member, a server admin), while their
 *     session lasts - nobody else, and nothing is ever sent to every
 *     socket;
 *   - what they hear: the room's event, with nothing in it but "ask again";
 *   - where it comes from: a change made on this server, or announced by
 *     another one;
 *   - how often: a burst of changes is announced at most once per
 *     ANNOUNCE_EVERY_MS per project, the first at once.
 *
 * Joining the room is Realtime.test.ts; the page's side,
 * ProductsMenuHearsUsage.test.ts and Tests/UI/Utils/Realtime.test.ts.
 */

jest.mock("../../../../Server/Infrastructure/SocketIO", () => {
  return {
    __esModule: true,
    default: {
      getSocketServer: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger");

// Redis as every server sees it, for the usage's generations.
const mockRedis: Map<string, string> = new Map<string, string>();

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (
        namespace: string,
        key: string,
      ): Promise<string | null> => {
        return mockRedis.get(`${namespace}-${key}`) || null;
      },
      setString: async (
        namespace: string,
        key: string,
        value: string,
      ): Promise<void> => {
        mockRedis.set(`${namespace}-${key}`, value);
      },
    },
  };
});

const TENANT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TENANT_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const OWNER: string = "11111111-1111-4111-8111-111111111111";
const MEMBER: string = "22222222-2222-4222-8222-222222222222";
const FORMER_MEMBER: string = "33333333-3333-4333-8333-333333333333";
const UNREADABLE: string = "44444444-4444-4444-8444-444444444444";
const SERVER_ADMIN: string = "55555555-5555-4555-8555-555555555555";

const USAGE_ROOM: string = RealtimeUtil.getProjectUsageRoomId(TENANT_ID);

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
    sessionEnded?: boolean | undefined;
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
              expiresAtMs: Date.now() + 60 * 60 * 1000,
            },
            ...(data.sessionEnded ? { realtimeSessionEnded: true } : {}),
          }
        : {},
      received: [],
    };

    this.sockets.push(socket);

    return socket;
  }
}

const server: FakeSocketServer = new FakeSocketServer();

// The people of the project.
const MEMBERS: Set<string> = new Set<string>([OWNER, MEMBER, UNREADABLE]);

let buildPropsCalls: Array<string> = [];

function heard(socket: FakeSocket): Array<Received> {
  return socket.received.filter((received: Received): boolean => {
    return received.event === USAGE_ROOM;
  });
}

// Lets what an announcement started run to its end.
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 30; tick++) {
    await Promise.resolve();
  }
}

beforeAll(async () => {
  (IO.getSocketServer as unknown as jest.Mock).mockReturnValue(server);
  await Realtime.init();

  // There is no Valkey here: the server stops trying to listen to it.
  await RealtimeAccessChanges.stopListening();
});

afterAll(() => {
  RealtimeAccessChanges.onProjectUsageChanged(null);
});

beforeEach(() => {
  server.sockets = [];
  server.sendsToEveryone = 0;
  server.sends = [];
  buildPropsCalls = [];
  RealtimeReaders.clear();
  ProjectUsageCache.clear();

  jest
    .spyOn(RealtimeReaders, "buildProps")
    .mockImplementation(
      async (
        identity: { userId: string; isMasterAdmin: boolean },
        projectId: string,
      ): Promise<DatabaseCommonInteractionProps | null> => {
        buildPropsCalls.push(identity.userId);

        if (identity.userId === UNREADABLE) {
          throw new Error("The permission cache is not answering");
        }

        if (!MEMBERS.has(identity.userId) && !identity.isMasterAdmin) {
          return null;
        }

        return {
          userId: new ObjectID(identity.userId),
          userType: UserType.User,
          tenantId: new ObjectID(projectId),
          isMasterAdmin: identity.isMasterAdmin,
        } as DatabaseCommonInteractionProps;
      },
    );
});

afterEach(() => {
  ProjectUsageCache.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("who hears that what a project uses changed", () => {
  test("every member's tab in the project's usage room hears it, with nothing in it but \"ask again\"", async () => {
    const ownerTab: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: OWNER,
    });
    const ownerOtherTab: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: OWNER,
    });
    const memberTab: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    for (const socket of [ownerTab, ownerOtherTab, memberTab]) {
      expect(heard(socket)).toEqual([{ event: USAGE_ROOM, payload: {} }]);
    }

    // One person's tabs are one reader: their permissions are read once.
    expect(buildPropsCalls.sort()).toEqual([MEMBER, OWNER].sort());
  });

  test("a server admin who is no member hears it, as they read the project", async () => {
    const admin: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: SERVER_ADMIN,
      isMasterAdmin: true,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(heard(admin)).toHaveLength(1);
  });

  test("a former member, a socket whose session ended and one that never said who it is hear nothing", async () => {
    const former: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: FORMER_MEMBER,
    });
    const ended: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: OWNER,
      sessionEnded: true,
    });
    const anonymous: FakeSocket = server.addSocket({ rooms: [USAGE_ROOM] });
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(heard(former)).toEqual([]);
    expect(heard(ended)).toEqual([]);
    expect(heard(anonymous)).toEqual([]);
    expect(heard(member)).toHaveLength(1);
    expect(server.sends).toEqual([{ targets: [member.id], event: USAGE_ROOM }]);
  });

  test("a person whose permissions cannot be read now hears nothing; the others still do", async () => {
    const unreadable: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: UNREADABLE,
    });
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(heard(unreadable)).toEqual([]);
    expect(heard(member)).toHaveLength(1);
  });

  test("only the project's usage room: not another project's, not the project's model rooms", async () => {
    const otherProject: FakeSocket = server.addSocket({
      rooms: [RealtimeUtil.getProjectUsageRoomId(OTHER_TENANT_ID)],
      userId: MEMBER,
    });
    const modelRoom: FakeSocket = server.addSocket({
      rooms: [
        RealtimeUtil.getRoomId(TENANT_ID, "Monitor", ModelEventType.Create),
      ],
      userId: MEMBER,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(otherProject.received).toEqual([]);
    expect(modelRoom.received).toEqual([]);
    expect(server.sends).toEqual([]);
  });

  test("an empty room sends nothing - and never to every socket", async () => {
    server.addSocket({ rooms: [], userId: MEMBER });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(server.sends).toEqual([]);
    expect(server.sendsToEveryone).toBe(0);
  });

  test("nobody who may hear it: nothing is sent, not even to no one", async () => {
    server.addSocket({ rooms: [USAGE_ROOM], userId: FORMER_MEMBER });

    await Realtime.deliverProjectUsageChanged(TENANT_ID);

    expect(server.sends).toEqual([]);
    expect(server.sendsToEveryone).toBe(0);
  });

  test("a project named in capitals is the same project; one that is not an id is nobody's", async () => {
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await Realtime.deliverProjectUsageChanged(TENANT_ID.toUpperCase());
    await Realtime.deliverProjectUsageChanged("not-a-project");
    await Realtime.deliverProjectUsageChanged("");

    expect(heard(member)).toHaveLength(1);
  });
});

describe("where the change comes from", () => {
  test("announced on another server: this server's pages hear it", async () => {
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: "another-server",
        change: {
          kind: RealtimeAccessChangeKind.ProjectUsageChanged,
          projectId: TENANT_ID,
        },
      }),
    );
    await settle();

    expect(heard(member)).toHaveLength(1);
  });

  test("a message that names no project, or not one, is let be", async () => {
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    for (const projectId of [undefined, 42, "not-a-project"]) {
      RealtimeAccessChanges.receive(
        JSON.stringify({
          origin: "another-server",
          change: {
            kind: RealtimeAccessChangeKind.ProjectUsageChanged,
            projectId: projectId,
          },
        }),
      );
    }
    await settle();

    expect(member.received).toEqual([]);
  });

  test("announced here: this server's pages hear it at once, as the others do from the channel", async () => {
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.ProjectUsageChanged,
      projectId: TENANT_ID,
    });
    await settle();

    expect(heard(member)).toHaveLength(1);
  });

  test("end to end: a product's last record deleted, its first record created, a telemetry product's first data - each heard", async () => {
    let now: number = Date.UTC(2026, 10, 15, 22, 0, 0);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    // Signed in by the same clock: the session lasts an hour from now.
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: TENANT_ID }],
    });
    await settle();
    expect(heard(member)).toHaveLength(1);

    now += ProjectUsageCache.ANNOUNCE_EVERY_MS + 1;
    await ProjectUsageCache.afterCreate({
      tableName: "OnCallDutyPolicy",
      row: { projectId: TENANT_ID },
    });
    await settle();
    expect(heard(member)).toHaveLength(2);

    now += ProjectUsageCache.ANNOUNCE_EVERY_MS + 1;
    await ProjectUsageCache.afterMilestoneReached({
      projectId: TENANT_ID,
      milestone: ActivationMilestone.FirstLogsReceived,
    });
    await settle();
    expect(heard(member)).toHaveLength(3);
  });

  test("nothing that changes no usage is heard: a label, a milestone of nothing in use", async () => {
    const member: FakeSocket = server.addSocket({
      rooms: [USAGE_ROOM],
      userId: MEMBER,
    });

    await ProjectUsageCache.afterCreate({
      tableName: "Label",
      row: { projectId: TENANT_ID },
    });
    await ProjectUsageCache.afterDelete({
      tableName: "IncidentInternalNote",
      rows: [{ projectId: TENANT_ID }],
    });
    await ProjectUsageCache.afterMilestoneReached({
      projectId: TENANT_ID,
      milestone: ActivationMilestone.SecondMemberJoined,
    });
    await settle();

    expect(member.received).toEqual([]);
  });
});

describe("how often: a burst is announced at most once per ANNOUNCE_EVERY_MS", () => {
  let now: number;
  let announced: Array<{ projectId: string; at: number }>;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["Date", "nextTick", "queueMicrotask"] });
    now = Date.UTC(2026, 10, 15, 22, 30, 0);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    announced = [];
    jest
      .spyOn(RealtimeAccessChanges, "announce")
      .mockImplementation(
        (change: { kind: RealtimeAccessChangeKind; projectId?: string }) => {
          if (change.kind === RealtimeAccessChangeKind.ProjectUsageChanged) {
            announced.push({ projectId: change.projectId!, at: now });
          }
        },
      );
  });

  // The clock and the timers move on together, 10 ms at a time.
  async function pass(ms: number): Promise<void> {
    for (let passed: number = 0; passed < ms; passed += 10) {
      const step: number = Math.min(10, ms - passed);
      now += step;
      jest.advanceTimersByTime(step);
      await settle();
    }
  }

  async function deleted(projectId: string = TENANT_ID): Promise<void> {
    await ProjectUsageCache.afterDelete({
      tableName: "Monitor",
      rows: [{ projectId: projectId }],
    });
  }

  test("a bulk delete of 50 monitors: one announcement at once, and one more for the rest", async () => {
    const start: number = now;

    for (let row: number = 0; row < 50; row++) {
      await deleted();
      await pass(10);
    }

    expect(announced).toEqual([{ projectId: TENANT_ID, at: start }]);

    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS);

    expect(announced).toHaveLength(2);
    expect(announced[1]!.at - start).toBe(ProjectUsageCache.ANNOUNCE_EVERY_MS);

    // Nothing more changed: nothing more is announced.
    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS * 10);
    expect(announced).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a long purge: one announcement per ANNOUNCE_EVERY_MS, not one per delete", async () => {
    for (let row: number = 0; row < 100; row++) {
      await deleted();
      await pass(50);
    }

    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS);

    // Five seconds of deletes, and the one after them.
    expect(announced.length).toBeGreaterThanOrEqual(5);
    expect(announced.length).toBeLessThanOrEqual(6);

    for (let index: number = 1; index < announced.length; index++) {
      expect(
        announced[index]!.at - announced[index - 1]!.at,
      ).toBeGreaterThanOrEqual(ProjectUsageCache.ANNOUNCE_EVERY_MS);
    }
  });

  test("changes far apart are each announced at once", async () => {
    await deleted();
    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS * 3);
    await deleted();

    expect(announced).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("each project is announced on its own", async () => {
    await deleted(TENANT_ID);
    await deleted(OTHER_TENANT_ID);
    await deleted(TENANT_ID);
    await deleted(OTHER_TENANT_ID);

    expect(
      announced.map((announcement: { projectId: string }): string => {
        return announcement.projectId;
      }),
    ).toEqual([TENANT_ID, OTHER_TENANT_ID]);

    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS);

    expect(announced).toHaveLength(4);
  });

  test("forgotten on clear: an announcement waiting is not made", async () => {
    await deleted();
    await deleted();
    ProjectUsageCache.clear();

    await pass(ProjectUsageCache.ANNOUNCE_EVERY_MS * 2);

    expect(announced).toHaveLength(1);
  });

  test("an announcement that fails is a log line, not a failed delete", async () => {
    (RealtimeAccessChanges.announce as unknown as jest.Mock).mockImplementation(
      (): void => {
        throw new Error("the channel is gone");
      },
    );

    await expect(deleted()).resolves.toBeUndefined();
  });
});
