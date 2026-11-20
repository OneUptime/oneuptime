/*
 * PasswordHash carries a TS diagnostic that fails any suite whose require
 * graph reaches it (see HostServiceUpdateLastSeen.test.ts): replaced with a
 * factory, as there.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import HostLogSessionService, {
  NOT_AN_ANDROID_DEVICE_MESSAGE,
  ONLY_CANCEL_MESSAGE,
  SESSION_ALREADY_OPEN_MESSAGE,
  SESSION_OVER_MESSAGE,
} from "../../../Server/Services/HostLogSessionService";
import HostService from "../../../Server/Services/HostService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import Host from "../../../Models/DatabaseModels/Host";
import HostLogSession from "../../../Models/DatabaseModels/HostLogSession";
import User from "../../../Models/DatabaseModels/User";
import {
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../../Types/Host/HostLogSession";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  CANCELLED_MESSAGE,
  NOBODY_ALLOWED_MESSAGE,
} from "../../../Utils/Host/AndroidAgentLogSessions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #9806: a log session is asked for on an Android device's host, moved
 * on by the device, and cancelled in OneUptime. The service decides what a
 * person may ask for and change, and what the device's reports may change.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<HostLogSession>,
  ) => Promise<OnCreate<HostLogSession>>;
  onCreatePermitted: (onCreate: OnCreate<HostLogSession>) => Promise<void>;
  onBeforeUpdate: (
    updateBy: UpdateBy<HostLogSession>,
  ) => Promise<OnUpdate<HostLogSession>>;
  onUpdatePermitted: (updateBy: UpdateBy<HostLogSession>) => Promise<void>;
  onCreateSuccess: (
    onCreate: OnCreate<HostLogSession>,
    createdItem: HostLogSession,
  ) => Promise<HostLogSession>;
};

const hooks: Hooks = HostLogSessionService as unknown as Hooks;

/*
 * A create's hooks as DatabaseService runs them: onBeforeCreate, then -
 * once the request has passed every permission check - onCreatePermitted.
 */
async function ask(
  request: CreateBy<HostLogSession>,
): Promise<OnCreate<HostLogSession>> {
  const onCreate: OnCreate<HostLogSession> =
    await hooks.onBeforeCreate(request);
  await hooks.onCreatePermitted(onCreate);
  return onCreate;
}

// An update's hooks the same way: onBeforeUpdate, then onUpdatePermitted.
async function change(
  request: UpdateBy<HostLogSession>,
): Promise<OnUpdate<HostLogSession>> {
  const onUpdate: OnUpdate<HostLogSession> =
    await hooks.onBeforeUpdate(request);
  await hooks.onUpdatePermitted(onUpdate.updateBy);
  return onUpdate;
}

let host: Host | null = null;
let sessions: Array<HostLogSession> = [];
let updates: Array<{ id: string; data: Record<string, unknown> }> = [];

function session(data: Partial<HostLogSession>): HostLogSession {
  const row: HostLogSession = new HostLogSession();
  row._id = (data._id || ObjectID.generate()).toString();
  Object.assign(row, data);
  row.hostId = data.hostId || HOST_ID;
  row.projectId = data.projectId || PROJECT_ID;
  return row;
}

function androidHost(): Host {
  const found: Host = new Host();
  found._id = HOST_ID.toString();
  found.osType = "android";
  return found;
}

// QueryHelper.any's statuses: a Raw IN with the values as its one parameter.
function asStatuses(value: unknown): Array<string> | undefined {
  const parameters: unknown = (
    value as { objectLiteralParameters?: unknown } | undefined
  )?.objectLiteralParameters;

  if (!parameters || typeof parameters !== "object") {
    return undefined;
  }

  const values: unknown = Object.values(parameters)[0];
  return Array.isArray(values) ? (values as Array<string>) : undefined;
}

// The rows a query names: by id, by host and by status, as the service asks.
function matching(query: Record<string, unknown>): Array<HostLogSession> {
  return sessions.filter((row: HostLogSession): boolean => {
    if (query["_id"] && row._id?.toString() !== query["_id"]!.toString()) {
      return false;
    }

    if (
      query["hostId"] &&
      row.hostId?.toString() !== query["hostId"]!.toString()
    ) {
      return false;
    }

    const statuses: Array<string> | undefined = asStatuses(query["status"]);

    if (statuses && !statuses.includes(row.status as string)) {
      return false;
    }

    return true;
  });
}

beforeEach(() => {
  host = androidHost();
  sessions = [];
  updates = [];

  jest
    .spyOn(
      ProjectReferencesService.prototype as never,
      "onBeforeCreate" as never,
    )
    .mockImplementation((async (createBy: CreateBy<HostLogSession>) => {
      return { createBy, carryForward: null };
    }) as never);
  jest
    .spyOn(
      ProjectReferencesService.prototype as never,
      "onBeforeUpdate" as never,
    )
    .mockImplementation((async (updateBy: UpdateBy<HostLogSession>) => {
      return { updateBy, carryForward: null };
    }) as never);
  jest.spyOn(HostService, "findOneBy").mockImplementation((async () => {
    return host;
  }) as never);
  jest
    .spyOn(HostLogSessionService, "findOneBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      return matching(args.query)[0] || null;
    }) as never);
  jest.spyOn(HostLogSessionService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }) => {
    return matching(args.query);
  }) as never);
  // The sessions a cancel writes, as the update path reads and holds them.
  jest
    .spyOn(HostLogSessionService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async (updateBy: UpdateBy<HostLogSession>) => {
      return matching(updateBy.query as Record<string, unknown>);
    }) as never);
  jest
    .spyOn(HostLogSessionService, "updateOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      updates.push({ id: args.id.toString(), data: { ...args.data } });
      const row: HostLogSession | undefined = sessions.find(
        (candidate: HostLogSession): boolean => {
          return candidate._id?.toString() === args.id.toString();
        },
      );
      if (row) {
        Object.assign(row, args.data);
      }
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createBy(data: Partial<HostLogSession>): CreateBy<HostLogSession> {
  const row: HostLogSession = new HostLogSession();
  Object.assign(row, { projectId: PROJECT_ID, hostId: HOST_ID, ...data });
  return {
    data: row,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  };
}

describe("asking for a log session", () => {
  test("is Requested, for the time asked, and the person at the device has an hour to allow it", async () => {
    const before: number = Date.now();
    const result: OnCreate<HostLogSession> = await ask(
      createBy({
        durationMinutes: 60,
        minimumLevel: HostLogSessionLevel.Debug,
        status: HostLogSessionStatus.Collecting,
      }),
    );
    const data: HostLogSession = result.createBy.data;

    expect(data.status).toBe(HostLogSessionStatus.Requested);
    expect(data.durationMinutes).toBe(60);
    expect(data.minimumLevel).toBe(HostLogSessionLevel.Debug);
    expect(data.expiresAt!.getTime()).toBeGreaterThanOrEqual(
      before + 60 * 60 * 1000 - 1000,
    );
    expect(data.expiresAt!.getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1000 + 1000,
    );
  });

  test("starts from 30 minutes at info", async () => {
    const data: HostLogSession = (await hooks.onBeforeCreate(createBy({})))
      .createBy.data;

    expect(data.durationMinutes).toBe(30);
    expect(data.minimumLevel).toBe(HostLogSessionLevel.Info);
  });

  test("is only for an Android device", async () => {
    const server: Host = new Host();
    server._id = HOST_ID.toString();
    server.osType = "linux";
    host = server;

    await expect(hooks.onBeforeCreate(createBy({}))).rejects.toThrow(
      NOT_AN_ANDROID_DEVICE_MESSAGE,
    );
  });

  /*
   * ReferenceNamesReadTogether: the device is a reference with two names, and
   * a write may give either. Both are read, two that disagree are refused,
   * and the device checked is the device saved.
   */
  test("is for the device named by the relation too, and saves it under its ID column", async () => {
    const relation: Host = new Host();
    relation._id = HOST_ID.toString();
    const findHost: unknown = HostService.findOneBy;

    const data: HostLogSession = (
      await hooks.onBeforeCreate(
        createBy({ hostId: undefined, host: relation } as never),
      )
    ).createBy.data;

    expect(data.hostId?.toString()).toBe(HOST_ID.toString());
    expect(findHost).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ _id: expect.anything() }),
      }),
    );
    const askedFor: unknown = (
      (
        findHost as {
          mock: { calls: Array<Array<{ query: { _id: unknown } }>> };
        }
      ).mock.calls[0]![0]!.query._id as ObjectID
    ).toString();
    expect(askedFor).toBe(HOST_ID.toString());
  });

  test("a device named one way under hostId and another under host is refused", async () => {
    const other: Host = new Host();
    other._id = ObjectID.generate().toString();

    await expect(
      hooks.onBeforeCreate(createBy({ host: other } as never)),
    ).rejects.toThrow("Conflicting Host references");
  });

  test("is for a device of the project", async () => {
    host = null;

    await expect(hooks.onBeforeCreate(createBy({}))).rejects.toThrow(
      "not found in this project",
    );
  });

  test("runs for one of the durations offered", async () => {
    await expect(
      hooks.onBeforeCreate(createBy({ durationMinutes: 600 })),
    ).rejects.toThrow("15, 30, 60, 120, 240 minutes");
  });

  test("waits while another session of the device is waiting or running", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.Collecting,
        endsAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    ];

    await expect(hooks.onBeforeCreate(createBy({}))).rejects.toThrow(
      SESSION_ALREADY_OPEN_MESSAGE,
    );
  });

  test("does not wait for one the device stopped telling OneUptime about", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.AwaitingApproval,
        expiresAt: new Date(Date.now() - 30 * 60 * 1000),
      }),
    ];

    const data: HostLogSession = (await ask(createBy({}))).createBy.data;

    expect(data.status).toBe(HostLogSessionStatus.Requested);
  });

  test("nor for one running well past its end with no word from the device", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.Collecting,
        startedAt: new Date(Date.now() - 70 * 60 * 1000),
        endsAt: new Date(Date.now() - 40 * 60 * 1000),
      }),
    ];

    const data: HostLogSession = (await ask(createBy({}))).createBy.data;

    expect(data.status).toBe(HostLogSessionStatus.Requested);
  });

  test("waits for one whose request ran out only minutes ago: the device may still report it", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.AwaitingApproval,
        expiresAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
    ];

    await expect(hooks.onBeforeCreate(createBy({}))).rejects.toThrow(
      SESSION_ALREADY_OPEN_MESSAGE,
    );
  });

  /*
   * A hook before the create's permission checks writes nothing a refused
   * create would leave behind (HookWritesAfterPermissionGuard): the stale
   * session is ended once the new one is saved, not while it is asked for.
   */
  test("writes nothing while it is asked for, refused or not", async () => {
    const stale: HostLogSession = session({
      status: HostLogSessionStatus.AwaitingApproval,
      expiresAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    sessions = [stale];

    await hooks.onBeforeCreate(createBy({}));
    await expect(
      hooks.onBeforeCreate(createBy({ durationMinutes: 600 })),
    ).rejects.toThrow("15, 30, 60, 120, 240 minutes");

    expect(updates).toEqual([]);
    expect(stale.status).toBe(HostLogSessionStatus.AwaitingApproval);
  });

  /*
   * HookWritesCallersMayMake: the status and the expiry are nobody's to
   * write, so the hook before the permission checks writes neither - the
   * checks would hold them against the person and refuse every request.
   */
  test("sets nothing of OneUptime's before the permission checks", async () => {
    const data: HostLogSession = (await hooks.onBeforeCreate(createBy({})))
      .createBy.data;

    expect(data.status).toBeUndefined();
    expect(data.expiresAt).toBeUndefined();
  });

  test("once it is saved, the sessions the clock ended are ended in their rows", async () => {
    const stale: HostLogSession = session({
      status: HostLogSessionStatus.AwaitingApproval,
      expiresAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    sessions = [stale];

    const onCreate: OnCreate<HostLogSession> = await hooks.onBeforeCreate(
      createBy({}),
    );
    // The row the create wrote, as the database now holds it.
    const created: HostLogSession = session({
      status: HostLogSessionStatus.Requested,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    sessions.push(created);
    const result: HostLogSession = await hooks.onCreateSuccess(
      onCreate,
      created,
    );

    expect(result).toBe(created);
    // The saved row's device is the one whose sessions are read.
    expect(HostLogSessionService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ hostId: created.hostId }),
      }),
    );
    expect(updates).toEqual([
      {
        id: stale._id!.toString(),
        data: {
          status: HostLogSessionStatus.Expired,
          statusMessage: NOBODY_ALLOWED_MESSAGE,
          endedAt: expect.any(Date),
        },
      },
    ]);
    expect(created.status).toBe(HostLogSessionStatus.Requested);
  });

  test("a session it could not end does not undo the request: the device's next exchange ends it", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.AwaitingApproval,
        expiresAt: new Date(Date.now() - 30 * 60 * 1000),
      }),
    ];
    jest
      .spyOn(HostLogSessionService, "updateOneById")
      .mockImplementation((async () => {
        throw new Error("The database is not reachable.");
      }) as never);
    const created: HostLogSession = session({
      status: HostLogSessionStatus.Requested,
    });

    const onCreate: OnCreate<HostLogSession> = await hooks.onBeforeCreate(
      createBy({}),
    );

    await expect(hooks.onCreateSuccess(onCreate, created)).resolves.toBe(
      created,
    );
  });
});

describe("changing a log session", () => {
  function updateBy(
    data: Partial<HostLogSession>,
    id: string,
  ): UpdateBy<HostLogSession> {
    return {
      query: { _id: id },
      data: data,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    } as unknown as UpdateBy<HostLogSession>;
  }

  test("a person may cancel one that is waiting or running", async () => {
    const open: HostLogSession = session({
      status: HostLogSessionStatus.AwaitingApproval,
    });
    sessions = [open];

    const result: OnUpdate<HostLogSession> = await change(
      updateBy(
        { status: HostLogSessionStatus.Cancelled },
        open._id!.toString(),
      ),
    );
    const data: HostLogSession = result.updateBy
      .data as unknown as HostLogSession;

    expect(data.status).toBe(HostLogSessionStatus.Cancelled);
    expect(data.statusMessage).toBe(CANCELLED_MESSAGE);
    expect(data.endedAt).toBeInstanceOf(Date);
  });

  // HookWritesCallersMayMake: nobody may write when it ended, or why.
  test("when it ended, and why, are written only once the cancel may be made", async () => {
    const open: HostLogSession = session({
      status: HostLogSessionStatus.Collecting,
    });
    sessions = [open];

    const result: OnUpdate<HostLogSession> = await hooks.onBeforeUpdate(
      updateBy(
        { status: HostLogSessionStatus.Cancelled },
        open._id!.toString(),
      ),
    );
    const data: HostLogSession = result.updateBy
      .data as unknown as HostLogSession;

    expect(data.endedAt).toBeUndefined();
    expect(data.statusMessage).toBeUndefined();
  });

  test("the sessions it checks are the ones it cancels: read held, never by its query", async () => {
    const open: HostLogSession = session({
      status: HostLogSessionStatus.Collecting,
    });
    sessions = [open];

    const update: UpdateBy<HostLogSession> = updateBy(
      { status: HostLogSessionStatus.Cancelled },
      open._id!.toString(),
    );

    await hooks.onBeforeUpdate(update);

    // UpdateChecksReadHeldRows: the cancel is held to the sessions read.
    expect(
      HostLogSessionService.findRowsAndHoldUpdateToThem,
    ).toHaveBeenCalledWith(update, { _id: true, status: true });
    expect(HostLogSessionService.findBy).not.toHaveBeenCalled();
  });

  test("a cancel that reaches no session the person may change judges none, and is held to none", async () => {
    sessions = [];

    const result: OnUpdate<HostLogSession> = await hooks.onBeforeUpdate(
      updateBy(
        { status: HostLogSessionStatus.Cancelled },
        ObjectID.generate().toString(),
      ),
    );

    expect(
      HostLogSessionService.findRowsAndHoldUpdateToThem,
    ).toHaveBeenCalledTimes(1);
    expect((result.updateBy.data as unknown as HostLogSession).status).toBe(
      HostLogSessionStatus.Cancelled,
    );
  });

  test("OneUptime's own writes are not judged: the device's reports go through as they are", async () => {
    const result: OnUpdate<HostLogSession> = await change({
      query: { _id: ObjectID.generate().toString() },
      data: { status: HostLogSessionStatus.Collecting },
      props: { isRoot: true },
    } as unknown as UpdateBy<HostLogSession>);

    expect(
      HostLogSessionService.findRowsAndHoldUpdateToThem,
    ).not.toHaveBeenCalled();
    expect((result.updateBy.data as unknown as HostLogSession).status).toBe(
      HostLogSessionStatus.Collecting,
    );
    // Nothing of a person's cancel is added to them.
    expect(result.updateBy.data).toEqual({
      status: HostLogSessionStatus.Collecting,
    });
  });

  test("cancelling is the only change a person makes", async () => {
    const open: HostLogSession = session({
      status: HostLogSessionStatus.AwaitingApproval,
    });
    sessions = [open];

    await expect(
      hooks.onBeforeUpdate(
        updateBy(
          { status: HostLogSessionStatus.Collecting },
          open._id!.toString(),
        ),
      ),
    ).rejects.toThrow(ONLY_CANCEL_MESSAGE);
  });

  test("one that is over has nothing to cancel", async () => {
    const over: HostLogSession = session({
      status: HostLogSessionStatus.Ended,
    });
    sessions = [over];

    await expect(
      hooks.onBeforeUpdate(
        updateBy(
          { status: HostLogSessionStatus.Cancelled },
          over._id!.toString(),
        ),
      ),
    ).rejects.toThrow(SESSION_OVER_MESSAGE);
  });
});

describe("an exchange with the device's agent", () => {
  async function exchange(
    reports: Array<JSONObject>,
  ): Promise<Array<JSONObject>> {
    const answer: JSONObject = await HostLogSessionService.exchangeWithDevice({
      projectId: PROJECT_ID,
      request: {
        hostName: "store-0412-kiosk-02",
        reports: reports.map((report: JSONObject) => {
          return {
            id: new ObjectID(report["id"] as string),
            status: report["status"] as HostLogSessionStatus,
            statusMessage: report["statusMessage"] as string | undefined,
            startedAt: report["startedAt"] as Date | undefined,
            endsAt: report["endsAt"] as Date | undefined,
          };
        }),
      },
    });

    return answer["sessions"] as Array<JSONObject>;
  }

  test("a device OneUptime has not heard from has no sessions", async () => {
    host = null;

    expect(await exchange([])).toEqual([]);
  });

  test("the device is told the session asked for, with who asked", async () => {
    const requester: User = new User();
    requester.name = new Name("Dana Reyes");
    const asked: HostLogSession = session({
      status: HostLogSessionStatus.Requested,
      durationMinutes: 30,
      minimumLevel: HostLogSessionLevel.Info,
      expiresAt: new Date(Date.now() + 50 * 60 * 1000),
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    asked.createdByUser = requester;
    sessions = [asked];

    const told: Array<JSONObject> = await exchange([]);

    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      id: asked._id!.toString(),
      status: "Requested",
      durationMinutes: 30,
      minimumLevel: "info",
      requestedByName: "Dana Reyes",
    });
  });

  test("the device's report moves its session on", async () => {
    const asked: HostLogSession = session({
      status: HostLogSessionStatus.AwaitingApproval,
      expiresAt: new Date(Date.now() + 50 * 60 * 1000),
    });
    sessions = [asked];
    const startedAt: Date = new Date();
    const endsAt: Date = new Date(startedAt.getTime() + 30 * 60 * 1000);

    const told: Array<JSONObject> = await exchange([
      {
        id: asked._id!.toString(),
        status: "Collecting",
        startedAt: startedAt as unknown as string,
        endsAt: endsAt as unknown as string,
      },
    ]);

    expect(updates).toEqual([
      {
        id: asked._id!.toString(),
        data: {
          status: HostLogSessionStatus.Collecting,
          startedAt: startedAt,
          endsAt: endsAt,
        },
      },
    ]);
    expect(told[0]).toMatchObject({ status: "Collecting" });
  });

  test("a report about another device's session is not believed", async () => {
    const other: HostLogSession = session({
      status: HostLogSessionStatus.Collecting,
      hostId: ObjectID.generate(),
    });
    sessions = [other];

    await exchange([{ id: other._id!.toString(), status: "Ended" }]);

    expect(updates).toEqual([]);
    expect(other.status).toBe(HostLogSessionStatus.Collecting);
  });

  test("a cancelled session is told, so the device stops, and stays cancelled", async () => {
    const cancelled: HostLogSession = session({
      status: HostLogSessionStatus.Cancelled,
      endedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    sessions = [cancelled];

    const told: Array<JSONObject> = await exchange([
      { id: cancelled._id!.toString(), status: "Collecting" },
    ]);

    expect(updates).toEqual([]);
    expect(told[0]).toMatchObject({ status: "Cancelled" });
  });

  test("one cancelled over an hour ago is no longer told", async () => {
    sessions = [
      session({
        status: HostLogSessionStatus.Cancelled,
        endedAt: new Date(Date.now() - 61 * 60 * 1000),
      }),
    ];

    expect(await exchange([])).toEqual([]);
  });
});
