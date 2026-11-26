import WorkspaceCreatedMessageFirst, {
  KeptPost,
} from "../../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import { WorkspaceRecord } from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import logger from "../../../../Server/Utils/Logger";
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
 * the order it was made - each once. Here, the hold itself: what is kept,
 * when it goes, in what order, and that nothing waits for good.
 */

// Every record a test held, let go after it so no timer outlives the test.
let held: Array<WorkspaceRecord> = [];

function hold(record: WorkspaceRecord): WorkspaceRecord {
  held.push(record);
  WorkspaceCreatedMessageFirst.hold(record);
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
  test("its messages are not kept: the caller posts them at once", () => {
    const posted: Array<string> = [];

    expect(
      WorkspaceCreatedMessageFirst.keep({
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

  test("a message about no record at all is never kept, and holding no record holds nothing", () => {
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.hold({});

    expect(WorkspaceCreatedMessageFirst.isHeld({})).toBe(false);
    expect(
      WorkspaceCreatedMessageFirst.keep({
        record: {},
        post: message(posted, "nothing"),
      }),
    ).toBe(false);
  });
});

describe("while a record is being created", () => {
  test("every message about it is kept, and none is posted", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    expect(WorkspaceCreatedMessageFirst.isHeld(alert)).toBe(true);

    for (const name of ["Added team Platform", "Added Jane", "A note"]) {
      expect(
        WorkspaceCreatedMessageFirst.keep({
          record: alert,
          post: message(posted, name),
        }),
      ).toBe(true);
    }

    await turns();

    expect(posted).toEqual([]);
  });

  test("letting it go posts what was kept, each once, in the order it was made", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    for (const name of ["first", "second", "third"]) {
      WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, name),
      });
    }

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["first", "second", "third"]);
    expect(WorkspaceCreatedMessageFirst.isHeld(alert)).toBe(false);
  });

  test("one after the other: a message is posted only once the one before it is", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const started: Array<string> = [];
    let finishFirst: () => void = (): void => {
      // replaced once the first starts
    };

    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        started.push("first");
        await new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
      },
    });
    WorkspaceCreatedMessageFirst.keep({
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
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        posted.push("first");

        // Something else about the alert is posted meanwhile.
        expect(
          WorkspaceCreatedMessageFirst.keep({
            record: alert,
            post: message(posted, "made meanwhile"),
          }),
        ).toBe(true);
      },
    });
    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "second"),
    });

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["first", "second", "made meanwhile"]);
  });

  test("once let go, a message about the record goes out at once again", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(
      WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "later"),
      }),
    ).toBe(false);
    expect(posted).toEqual([]);
  });

  test("a message that fails is logged, the next one is still posted, and letting go never throws", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        throw new Error("Slack is down");
      },
    });
    WorkspaceCreatedMessageFirst.keep({
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
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];
    let finishFirst: () => void = (): void => {
      // replaced once the first starts
    };

    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
        posted.push("first");
      },
    });
    WorkspaceCreatedMessageFirst.keep({
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
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.keep({
      record: alert,
      post: message(posted, "first"),
    });

    WorkspaceCreatedMessageFirst.hold(alert);

    WorkspaceCreatedMessageFirst.keep({
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
    const alert: WorkspaceRecord = hold({ alertId: new ObjectID(id) });
    const posted: Array<string> = [];

    // The same id, written in capitals: the same alert.
    expect(
      WorkspaceCreatedMessageFirst.keep({
        record: { alertId: new ObjectID(id.toUpperCase()) },
        post: message(posted, "same alert"),
      }),
    ).toBe(true);

    // An incident with that id is another record, and so is another alert.
    expect(
      WorkspaceCreatedMessageFirst.keep({
        record: { incidentId: new ObjectID(id) },
        post: message(posted, "an incident"),
      }),
    ).toBe(false);
    expect(
      WorkspaceCreatedMessageFirst.keep({
        record: { alertId: ObjectID.generate() },
        post: message(posted, "another alert"),
      }),
    ).toBe(false);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toEqual(["same alert"]);
  });

  test("letting one record go leaves another held", async () => {
    const first: WorkspaceRecord = hold({ incidentId: ObjectID.generate() });
    const second: WorkspaceRecord = hold({ incidentId: ObjectID.generate() });
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.keep({
      record: first,
      post: message(posted, "first's"),
    });
    WorkspaceCreatedMessageFirst.keep({
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
    hold({ incidentId: incidentId });
    const posted: Array<string> = [];

    expect(
      WorkspaceCreatedMessageFirst.keep({
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

    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const posted: Array<string> = [];

    WorkspaceCreatedMessageFirst.keep({
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
      WorkspaceCreatedMessageFirst.keep({
        record: alert,
        post: message(posted, "later"),
      }),
    ).toBe(false);
  });

  test("a hold let go in time is not let go a second time when its five minutes are up", async () => {
    jest.useFakeTimers();

    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const post: Mock<KeptPost> = jest.fn<KeptPost>(async () => {
      // posted
    });

    WorkspaceCreatedMessageFirst.keep({ record: alert, post: post });
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

    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });

    expect(delays).toEqual([WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS]);
    expect(unref).toHaveBeenCalledTimes(1);

    await WorkspaceCreatedMessageFirst.postHeld(alert);
  });
});
