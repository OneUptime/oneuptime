import WorkspaceCreatedMessageFirst, {
  KeptPost,
} from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import WorkspaceCreatedMessageLine from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageLine";
import { WorkspaceRecord } from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import GracefulShutdown, {
  ShutdownPriority,
} from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * A RECORD'S CREATED MESSAGE IS THE FIRST THING ITS CHANNELS HEAR OF IT
 * (#11146): while an incident or alert is being created, every other
 * message about it is kept, and posted right after its Created message, in
 * the order it was made - each once. Here, the hold itself, on a server
 * with no Valkey to share it through: what is kept, when it goes, in what
 * order, and that nothing waits for good. The hold every server shares is
 * in WorkspaceCreatedMessageFirstValkey.test.ts.
 */

// Every record a test held, let go after it so no timer outlives the test.
let held: Array<WorkspaceRecord> = [];

async function hold(record: WorkspaceRecord): Promise<WorkspaceRecord> {
  held.push(record);
  await WorkspaceCreatedMessageFirst.hold(record);
  return record;
}

// A message that says it was posted, in `posted`, when it is.
function message(posted: Array<string>, name: string): KeptPost {
  return async (): Promise<void> => {
    posted.push(name);
  };
}

// Lets a few turns of the event loop go by.
async function turns(count: number = 5): Promise<void> {
  for (let i: number = 0; i < count; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

/*
 * Lets the promises a fake timer's callback started settle: the callbacks
 * ran when the clock was moved, and what they started runs as microtasks.
 */
async function settleMicrotasks(count: number = 20): Promise<void> {
  for (let i: number = 0; i < count; i++) {
    await Promise.resolve();
  }
}

let errorsLogged: SpyInstance<typeof logger.error>;

beforeEach(() => {
  held = [];
  errorsLogged = jest.spyOn(logger, "error").mockImplementation((() => {
    // read by the tests
  }) as never);
});

afterEach(async () => {
  jest.useRealTimers();

  for (const record of held) {
    await WorkspaceCreatedMessageFirst.postHeld(record);
  }

  jest.restoreAllMocks();
});

describe("a record nobody is creating", () => {
  test("its messages are not kept: the caller posts them at once", async () => {
    const posted: Array<string> = [];

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { alertId: ObjectID.generate() },
        post: message(posted, "Added team Platform"),
      }),
    ).toBe(false);

    expect(posted).toEqual([]);
  });

  test("letting it go posts nothing and settles at once", async () => {
    await expect(
      WorkspaceCreatedMessageFirst.postHeld({ alertId: ObjectID.generate() }),
    ).resolves.toBeUndefined();
  });

  test("a message about no record at all is never kept, and holding no record holds nothing", async () => {
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.hold({});

    expect(WorkspaceCreatedMessageFirst.isHeld({})).toBe(false);
    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: {},
        post: message(posted, "nothing"),
      }),
    ).toBe(false);
  });
});

describe("while a record is being created", () => {
  test("every message about it is kept, and none is posted", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    expect(WorkspaceCreatedMessageFirst.isHeld(alert)).toBe(true);

    for (const name of ["Added team Platform", "Added Jane", "A note"]) {
      expect(
        await WorkspaceCreatedMessageFirst.keep({
          record: alert,
          post: message(posted, name),
        }),
      ).toBe(true);
    }

    await turns();

    expect(posted).toEqual([]);
  });

  test("letting it go posts what was kept, each once, in the order it was made", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    for (const name of ["first", "second", "third"]) {
      await WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, name),
      });
    }

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["first", "second", "third"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(alert)).toBe(false);
  });

  test("one after the other: a message is posted only once the one before it is", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const started: Array<string> = [];
    let finishFirst: () => void = (): void => {
      // replaced once the first starts
    };

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        started.push("first");
        await new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
      },
    });
    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(started, "second"),
    });

    const letGo: Promise<void> = WorkspaceCreatedMessageFirst.postHeld(alert);
    await turns();

    // The first is still being posted: the second waits for it.
    expect(started).toEqual(["first"]);

    finishFirst();
    await letGo;

    expect(started).toEqual(["first", "second"]);
  });

  test("a message made while the kept ones are posted joins the end of the line", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        posted.push("first");

        // Something else about the alert is posted meanwhile.
        expect(
          await WorkspaceCreatedMessageFirst.keep({
            record: alert,
            post: message(posted, "made meanwhile"),
          }),
        ).toBe(true);
      },
    });
    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "second"),
    });

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["first", "second", "made meanwhile"]);
  });

  test("once let go, a message about the record goes out at once again", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "later"),
      }),
    ).toBe(false);
    expect(posted).toEqual([]);
  });

  test("a message that fails is logged, the next one is still posted, and letting go never throws", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        throw new Error("Slack is down");
      },
    });
    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "second"),
    });

    await expect(
      WorkspaceCreatedMessageFirst.postHeld(alert),
    ).resolves.toBeUndefined();

    expect(posted).toEqual(["second"]);
    expect(errorsLogged).toHaveBeenCalledTimes(1);
    expect(String(errorsLogged.mock.calls[0]![0])).toContain("Slack is down");
  });

  test("letting it go twice at once posts each message once, and both wait for the last", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];
    let finishFirst: () => void = (): void => {
      // replaced once the first starts
    };

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
        posted.push("first");
      },
    });
    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "second"),
    });

    let settled: number = 0;
    const once: Promise<void> = WorkspaceCreatedMessageFirst.postHeld(
      alert,
    ).then(() => {
      settled++;
    });
    const twice: Promise<void> = WorkspaceCreatedMessageFirst.postHeld(
      alert,
    ).then(() => {
      settled++;
    });

    await turns();
    expect(settled).toBe(0);

    finishFirst();
    await Promise.all([once, twice]);

    expect(posted).toEqual(["first", "second"]);
    expect(settled).toBe(2);
  });

  test("holding a record twice is one hold: what was kept stays kept", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "first"),
    });

    await WorkspaceCreatedMessageFirst.hold(alert);

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "second"),
    });

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["first", "second"]);
  });
});

describe("records are told apart", () => {
  test("by their kind and their id, whatever the id's case", async () => {
    const id: string = ObjectID.generate().toString();
    const alert: WorkspaceRecord = await hold({ alertId: new ObjectID(id) });
    const posted: Array<string> = [];

    // The same id, written in capitals: the same alert.
    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { alertId: new ObjectID(id.toUpperCase()) },
        post: message(posted, "same alert"),
      }),
    ).toBe(true);

    // An incident with that id is another record, and so is another alert.
    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { incidentId: new ObjectID(id) },
        post: message(posted, "an incident"),
      }),
    ).toBe(false);
    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { alertId: ObjectID.generate() },
        post: message(posted, "another alert"),
      }),
    ).toBe(false);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["same alert"]);
  });

  test("letting one record go leaves another held", async () => {
    const first: WorkspaceRecord = await hold({
      incidentId: ObjectID.generate(),
    });
    const second: WorkspaceRecord = await hold({
      incidentId: ObjectID.generate(),
    });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.keep({
      record: first,
      post: message(posted, "first's"),
    });
    await WorkspaceCreatedMessageFirst.keep({
      record: second,
      post: message(posted, "second's"),
    });

    await WorkspaceCreatedMessageFirst.postHeld(first);

    expect(posted).toEqual(["first's"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(second)).toBe(true);

    await WorkspaceCreatedMessageFirst.postHeld(second);

    expect(posted).toEqual(["first's", "second's"]);
  });

  test("a message is about the first record it names, as WorkspaceRecordChannels reads it", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    await hold({ incidentId: incidentId });
    const posted: Array<string> = [];

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { incidentId: incidentId, monitorId: ObjectID.generate() },
        post: message(posted, "about the incident"),
      }),
    ).toBe(true);
  });
});

describe("nothing waits for good", () => {
  test("a hold nobody lets go is let go after five minutes", async () => {
    jest.useFakeTimers();

    expect(WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS).toBe(
      5 * 60 * 1000,
    );

    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "kept"),
    });

    jest.advanceTimersByTime(
      WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS - 1,
    );
    await settleMicrotasks();
    expect(posted).toEqual([]);

    jest.advanceTimersByTime(1);
    await settleMicrotasks();
    expect(posted).toEqual(["kept"]);

    // From then on its messages go out at once.
    expect(WorkspaceCreatedMessageFirst.isHeld(alert)).toBe(false);
    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "later"),
      }),
    ).toBe(false);
  });

  test("a hold let go in time is not let go a second time when its five minutes are up", async () => {
    jest.useFakeTimers();

    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const post: Mock<KeptPost> = jest.fn<KeptPost>(async () => {
      // posted
    });

    await WorkspaceCreatedMessageFirst.keep({ record: alert, post: post });
    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(post).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS);
    await settleMicrotasks();

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("the hold's timer never keeps the process running: it is unref'd", async () => {
    const unref: Mock<() => void> = jest.fn<() => void>();
    const delays: Array<number | undefined> = [];
    jest.spyOn(global, "setTimeout").mockImplementation(((
      _handler: () => void,
      delay?: number,
    ) => {
      delays.push(delay);
      return { unref: unref };
    }) as never);
    jest.spyOn(global, "clearTimeout").mockImplementation((() => {
      // the stand-in timer above is nothing to clear
    }) as never);

    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });

    expect(delays).toEqual([WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS]);
    expect(unref).toHaveBeenCalledTimes(1);

    await WorkspaceCreatedMessageFirst.postHeld(alert);
  });
});

describe("what another App server would post a kept message from (#11235)", () => {
  test("is never read on a server without Valkey: the hold is this server's own, and what was kept is posted", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];
    const stored: Mock<() => JSONObject> = jest.fn<() => JSONObject>(() => {
      return { name: "Added team Platform" };
    });

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "Added team Platform"),
        stored: stored,
      }),
    ).toBe(true);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["Added team Platform"]);
    expect(stored).not.toHaveBeenCalled();
  });

  test("is never read for a message about a record nobody is creating, on a server without Valkey", async () => {
    const stored: Mock<() => JSONObject> = jest.fn<() => JSONObject>(() => {
      return {};
    });

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: { incidentId: ObjectID.generate() },
        post: message([], "posted at once"),
        stored: stored,
      }),
    ).toBe(false);

    expect(stored).not.toHaveBeenCalled();
  });

  test("a message kept with no stored form is kept just the same", async () => {
    const alert: WorkspaceRecord = await hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    expect(
      await WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "Added Jane"),
      }),
    ).toBe(true);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["Added Jane"]);
  });

  test("what is stored of a message is at most half a megabyte", () => {
    expect(WorkspaceCreatedMessageFirst.MAX_STORED_MESSAGE_BYTES).toBe(
      512 * 1024,
    );
  });

  test("taking over for stopped servers looks after the lines on a timer that never keeps the process running, stops as the server shuts down, and starts once", async () => {
    const unref: Mock<() => void> = jest.fn<() => void>();
    const delays: Array<number | undefined> = [];
    const cleared: Array<unknown> = [];
    const timer: { unref: Mock<() => void> } = { unref: unref };

    jest.spyOn(global, "setTimeout").mockImplementation(((
      _handler: () => void,
      delay?: number,
    ) => {
      delays.push(delay);
      return timer;
    }) as never);
    jest.spyOn(global, "clearTimeout").mockImplementation(((
      clearedTimer: unknown,
    ) => {
      cleared.push(clearedTimer);
    }) as never);
    const registered: SpyInstance<typeof GracefulShutdown.registerHandler> =
      jest
        .spyOn(GracefulShutdown, "registerHandler")
        .mockImplementation((() => {
          // not a real shutdown
        }) as never);

    WorkspaceCreatedMessageFirst.takeOverForStoppedServers(
      async (): Promise<void> => {
        // nothing is taken over here
      },
    );

    expect(delays).toEqual([WorkspaceCreatedMessageLine.LOOKED_AFTER_EVERY_MS]);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(registered).toHaveBeenCalledWith(
      "WorkspaceCreatedMessageFirst",
      ShutdownPriority.Buffers,
      expect.any(Function),
    );

    // Started again, it starts no second timer.
    WorkspaceCreatedMessageFirst.takeOverForStoppedServers(
      async (): Promise<void> => {
        // nor here
      },
    );

    expect(delays).toHaveLength(1);

    // The server shuts down: it looks after no line any more.
    await WorkspaceCreatedMessageFirst.postEverythingHeldHere();

    expect(cleared).toContain(timer);
  });

  test("the lines are looked after every five seconds: a stopped server's message waits its stalled turn and at most that much more", () => {
    expect(WorkspaceCreatedMessageLine.LOOKED_AFTER_EVERY_MS).toBe(5 * 1000);
    expect(WorkspaceCreatedMessageLine.STALLED_AFTER_MS).toBe(15 * 1000);
    expect(WorkspaceCreatedMessageLine.LOOKED_AFTER_EVERY_MS).toBeLessThan(
      WorkspaceCreatedMessageLine.STALLED_AFTER_MS,
    );
  });

  test("a message taken over is claimed for an hour, far longer than any line lives", () => {
    expect(WorkspaceCreatedMessageLine.TAKEN_OVER_CLAIMED_FOR_MS).toBe(
      60 * 60 * 1000,
    );
    expect(
      WorkspaceCreatedMessageLine.TAKEN_OVER_CLAIMED_FOR_MS,
    ).toBeGreaterThan(
      WorkspaceCreatedMessageLine.livesAtMostMs(
        WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS,
      ) * 5,
    );
  });

  test("each server is told apart in the lines by an id of its own", () => {
    expect(WorkspaceCreatedMessageLine.SERVER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
