import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GuidedSetupRunStore, {
  GUIDED_SETUP_RUN_KEY_PREFIX,
  GuidedSetupRunSync,
  GuidedSetupStepProgress,
  GuidedSetupStepState,
  canOpenStep,
  countDoneSteps,
  getFirstOpenStepKey,
  getGuidedSetupRunKey,
  getStepNumber,
  getStepState,
  readGuidedSetupRun,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { GuidedSetupRunRemote } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupRunApi";
import {
  GuidedSetupKey,
  GuidedSetupResourceStatus,
  GuidedSetupRunAnswer,
  GuidedSetupRunChange,
  GuidedSetupRunState,
  applyGuidedSetupRunChange,
} from "../../../Types/GuidedSetup/GuidedSetupRun";

/*
 * A guided setup's progress (issue #6804, shared by #6805 and #6806): which
 * step a returning person lands on, which steps can be opened, and the run -
 * kept on the server (#7253), so another device, a private window or a
 * reload resumes it, and cached in this browser and in the page while it is
 * open, so a server out of reach or a browser that keeps nothing loses no
 * step's save (#7059).
 */

const steps: (...done: Array<boolean>) => Array<GuidedSetupStepProgress> = (
  ...done: Array<boolean>
): Array<GuidedSetupStepProgress> => {
  return ["check", "who_is_told", "test"].map(
    (key: string, index: number): GuidedSetupStepProgress => {
      return { key, isDone: Boolean(done[index]) };
    },
  );
};

/*
 * THE SERVER, in memory: one person's runs in one project, by setup, merged
 * as the server merges them (applyGuidedSetupRunChange). Two stores handed
 * the same server are two devices of one person. `isDown` makes every call
 * fail, as when OneUptime cannot be reached.
 */
class FakeServer implements GuidedSetupRunRemote {
  public runs: Map<string, GuidedSetupRunState> = new Map();
  public calls: Array<{
    kind: "fetch" | "save" | "forget";
    setup: string;
    change?: GuidedSetupRunChange | undefined;
  }> = [];
  public isDown: boolean = false;

  public fetch: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer> =
    async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      this.calls.push({ kind: "fetch", setup: setup });
      this.answerOrFail();

      return { setup: setup, run: this.copyOf(setup) };
    };

  public save: (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ) => Promise<GuidedSetupRunAnswer> = async (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ): Promise<GuidedSetupRunAnswer> => {
    this.calls.push({
      kind: "save",
      setup: setup,
      change: JSON.parse(JSON.stringify(change)) as GuidedSetupRunChange,
    });
    this.answerOrFail();

    const current: GuidedSetupRunState | undefined = this.runs.get(setup);
    const merged: ReturnType<typeof applyGuidedSetupRunChange> =
      applyGuidedSetupRunChange({
        values: current?.values || {},
        resources: current?.resources || {},
        change: change,
        now: new Date("2026-11-20T10:00:00.000Z"),
      });

    if (
      Object.keys(merged.values).length === 0 &&
      Object.keys(merged.resources).length === 0
    ) {
      this.runs.delete(setup);
    } else {
      this.runs.set(setup, {
        ...merged,
        revision: (current?.revision || 0) + 1,
        updatedAt: "2026-11-20T10:00:00.000Z",
      });
    }

    return { setup: setup, run: this.copyOf(setup) };
  };

  public forget: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer> =
    async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      this.calls.push({ kind: "forget", setup: setup });
      this.answerOrFail();
      this.runs.delete(setup);

      return { setup: setup, run: null };
    };

  public valuesOf(setup: string): Record<string, string | true> | undefined {
    return this.runs.get(setup)?.values;
  }

  private answerOrFail(): void {
    if (this.isDown) {
      throw new Error("OneUptime could not be reached.");
    }
  }

  private copyOf(setup: string): GuidedSetupRunState | null {
    const run: GuidedSetupRunState | undefined = this.runs.get(setup);

    return run
      ? (JSON.parse(JSON.stringify(run)) as GuidedSetupRunState)
      : null;
  }
}

describe("where a returning person lands", () => {
  test("on the first step not done", () => {
    expect(getFirstOpenStepKey(steps(false, false, false))).toBe("check");
    expect(getFirstOpenStepKey(steps(true, false, false))).toBe("who_is_told");
    expect(getFirstOpenStepKey(steps(true, true, false))).toBe("test");
  });

  test("on the summary (null) once every step is done", () => {
    expect(getFirstOpenStepKey(steps(true, true, true))).toBeNull();
  });

  test("on a gap first: a step done out of order does not skip one before it", () => {
    expect(getFirstOpenStepKey(steps(true, false, true))).toBe("who_is_told");
  });

  test("a setup with no steps has nothing open", () => {
    expect(getFirstOpenStepKey([])).toBeNull();
  });
});

describe("which steps can be opened", () => {
  test("a done step, to look at again, and the first one not done", () => {
    const progress: Array<GuidedSetupStepProgress> = steps(true, false, false);

    expect(canOpenStep(progress, "check")).toBe(true);
    expect(canOpenStep(progress, "who_is_told")).toBe(true);
  });

  test("never a later step: each builds on the one before", () => {
    expect(canOpenStep(steps(true, false, false), "test")).toBe(false);
    expect(canOpenStep(steps(false, false, false), "who_is_told")).toBe(false);
  });

  test("never a step that is not there", () => {
    expect(canOpenStep(steps(true, true, true), "teleport")).toBe(false);
  });
});

describe("how each step is drawn", () => {
  test("the open one is open, whatever it holds", () => {
    expect(
      getStepState({ step: { key: "check", isDone: true }, openKey: "check" }),
    ).toBe(GuidedSetupStepState.Open);
    expect(
      getStepState({ step: { key: "test", isDone: false }, openKey: "test" }),
    ).toBe(GuidedSetupStepState.Open);
  });

  test("a done one is done, one not reached yet is upcoming", () => {
    expect(
      getStepState({ step: { key: "check", isDone: true }, openKey: "test" }),
    ).toBe(GuidedSetupStepState.Done);
    expect(
      getStepState({ step: { key: "test", isDone: false }, openKey: "check" }),
    ).toBe(GuidedSetupStepState.Upcoming);
  });

  test("with the summary open, every step is done or upcoming", () => {
    expect(
      getStepState({ step: { key: "check", isDone: true }, openKey: null }),
    ).toBe(GuidedSetupStepState.Done);
  });

  test("steps are numbered from one, in order", () => {
    expect(getStepNumber(steps(), "check")).toBe(1);
    expect(getStepNumber(steps(), "test")).toBe(3);
    expect(getStepNumber(steps(), "teleport")).toBe(0);
  });

  test("the progress line counts the done steps", () => {
    expect(countDoneSteps(steps(true, false, true))).toBe(2);
    expect(countDoneSteps(steps())).toBe(0);
  });
});

/*
 * A BROWSER THAT KEEPS NOTHING (#7059): a private window, storage switched
 * off, or a browser that takes a value and reads nothing back. The page
 * keeps the run while it is open, so each step's save adds to the run
 * instead of replacing it: before, sending the test page dropped the who-is-
 * told step's confirmation, and that step was drawn not done again.
 */
type StorageMethods = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/*
 * Storage's prototype seen without its string index signature, which makes
 * @jest/globals type spyOn(Storage.prototype, ...) as never.
 */
const storagePrototype: StorageMethods = Storage.prototype;

const failing: () => never = (): never => {
  throw new Error("storage is off");
};

/*
 * Runs `work` with the browser's storage methods replaced, then puts them
 * back. They are replaced on Storage's prototype: jsdom's localStorage keeps
 * a property set on the object itself as an item, so that replaces nothing.
 */
const withStorage: (
  replacements: Partial<StorageMethods>,
  work: () => Promise<void> | void,
) => Promise<void> = async (
  replacements: Partial<StorageMethods>,
  work: () => Promise<void> | void,
): Promise<void> => {
  if (replacements.getItem) {
    jest
      .spyOn(storagePrototype, "getItem")
      .mockImplementation(replacements.getItem);
  }

  if (replacements.setItem) {
    jest
      .spyOn(storagePrototype, "setItem")
      .mockImplementation(replacements.setItem);
  }

  if (replacements.removeItem) {
    jest
      .spyOn(storagePrototype, "removeItem")
      .mockImplementation(replacements.removeItem);
  }

  try {
    await work();
  } finally {
    jest.restoreAllMocks();
  }
};

const who: { setup: string; projectId: string; userId: string } = {
  setup: "website_down",
  projectId: "project-1",
  userId: "user-1",
};

let server: FakeServer;

const storeOn: (
  remote?: FakeServer,
  person?: { setup: string; projectId: string; userId: string },
) => GuidedSetupRunStore = (
  remote: FakeServer = server,
  person: { setup: string; projectId: string; userId: string } = who,
): GuidedSetupRunStore => {
  return new GuidedSetupRunStore({ ...person, remote: remote });
};

// What this browser keeps for the run, as stored.
const kept: () => Record<string, unknown> | null = (): Record<
  string,
  unknown
> | null => {
  const text: string | null = window.localStorage.getItem(
    getGuidedSetupRunKey(who),
  );

  return text ? (JSON.parse(text) as Record<string, unknown>) : null;
};

beforeEach(() => {
  window.localStorage.clear();
  server = new FakeServer();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("the run, kept in this browser", () => {
  test("one per setup, project and person", () => {
    expect(getGuidedSetupRunKey(who)).toBe(
      `${GUIDED_SETUP_RUN_KEY_PREFIX}:website_down:project-1:user-1`,
    );
    expect(getGuidedSetupRunKey({ ...who, userId: "user-2" })).not.toBe(
      getGuidedSetupRunKey(who),
    );
    expect(getGuidedSetupRunKey({ ...who, projectId: "project-2" })).not.toBe(
      getGuidedSetupRunKey(who),
    );
    expect(getGuidedSetupRunKey({ ...who, setup: "paging" })).not.toBe(
      getGuidedSetupRunKey(who),
    );
  });

  test("saves values as they come, and removes the ones given as null", async () => {
    const store: GuidedSetupRunStore = storeOn();

    expect(store.read()).toEqual({});
    expect(store.save({ monitorId: "m-1" })).toEqual({ monitorId: "m-1" });
    expect(store.save({ policyId: "p-1", confirmed: true })).toEqual({
      monitorId: "m-1",
      policyId: "p-1",
      confirmed: true,
    });
    expect(store.save({ policyId: null, confirmed: false })).toEqual({
      monitorId: "m-1",
    });

    // Another store for the same run reads what this one kept.
    expect(storeOn().read()).toEqual({ monitorId: "m-1" });

    await store.flush();
  });

  test("another person's or project's run is not this one", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });

    expect(
      storeOn(new FakeServer(), { ...who, userId: "user-2" }).read(),
    ).toEqual({});
    expect(
      storeOn(new FakeServer(), { ...who, projectId: "project-2" }).read(),
    ).toEqual({});

    await store.flush();
  });

  test("forgetting starts the next run afresh, here and on the server", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });
    store.forget();

    expect(store.read()).toEqual({});

    await store.flush();

    expect(window.localStorage.getItem(getGuidedSetupRunKey(who))).toBeNull();
    expect(server.valuesOf("website_down")).toBeUndefined();
  });

  test("keeps only ids, typed text and true: anything else is not a run's", () => {
    expect(
      readGuidedSetupRun({
        monitorId: "m-1",
        empty: "",
        confirmed: true,
        notConfirmed: false,
        count: 3,
        nested: { a: "b" },
        list: ["x"],
        nothing: null,
      }),
    ).toEqual({ monitorId: "m-1", confirmed: true });
    expect(readGuidedSetupRun(null)).toEqual({});
    expect(readGuidedSetupRun("monitorId")).toEqual({});
    expect(readGuidedSetupRun(["m-1"])).toEqual({});
  });

  test("a value that is not JSON reads as no run", () => {
    window.localStorage.setItem(getGuidedSetupRunKey(who), "{not json");

    expect(storeOn().read()).toEqual({});
  });

  test("a browser that keeps nothing still walks the setup", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      async () => {
        expect(store.read()).toEqual({});
        expect(store.save({ monitorId: "m-1" })).toEqual({
          monitorId: "m-1",
        });
        expect(() => {
          store.forget();
        }).not.toThrow();
        await store.flush();
      },
    );
  });
});

describe("the run, in a browser that keeps nothing", () => {
  // The website-down setup's three saves, in the order a person makes them.
  const walk: (store: GuidedSetupRunStore) => void = (
    store: GuidedSetupRunStore,
  ): void => {
    expect(store.save({ monitorId: "m-1" })).toEqual({ monitorId: "m-1" });
    expect(store.save({ whoIsToldConfirmed: true })).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(
      store.save({ testExecutionLogId: "log-1", testSkipped: null }),
    ).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
    expect(store.read()).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
  };

  test("storage switched off: every save adds to the run this page keeps, and the server gets each", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      async () => {
        walk(store);
        await store.flush();
      },
    );

    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
  });

  test("a browser that takes nothing (a private window that refuses writes): the same", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage({ setItem: failing }, async () => {
      walk(store);
      // The browser has none of it; the page has all of it.
      expect(window.localStorage.getItem(getGuidedSetupRunKey(who))).toBeNull();
      await store.flush();
    });
  });

  test("a browser that takes a value and reads nothing back: the same", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage(
      {
        setItem: (): void => {
          // Accepted, and gone.
        },
      },
      async () => {
        walk(store);
        await store.flush();
      },
    );
  });

  test("forgetting empties the page's run too", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      async () => {
        store.save({ monitorId: "m-1" });
        store.forget();

        expect(store.read()).toEqual({});
        expect(store.save({ policyId: "p-1" })).toEqual({ policyId: "p-1" });
        await store.flush();
      },
    );

    // The server forgot first, then took the new run's save: nothing older.
    expect(server.valuesOf("website_down")).toEqual({ policyId: "p-1" });
  });

  test("a page opened afresh in a browser that keeps nothing reads the run from the server", async () => {
    await withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      async () => {
        const first: GuidedSetupRunStore = storeOn();
        first.save({ monitorId: "m-1" });
        await first.flush();

        // A reload builds a new store: the browser kept nothing.
        const reloaded: GuidedSetupRunStore = storeOn();

        expect(reloaded.read()).toEqual({});
        expect(await reloaded.load()).toEqual({ monitorId: "m-1" });
      },
    );
  });

  test("a run another tab kept in this browser wins over the page's copy", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });
    await store.flush();

    // Another tab of the same person moved the run on.
    window.localStorage.setItem(
      getGuidedSetupRunKey(who),
      JSON.stringify({ monitorId: "m-1", policyId: "p-1" }),
    );

    expect(store.read()).toEqual({ monitorId: "m-1", policyId: "p-1" });
    expect(store.save({ testSkipped: true })).toEqual({
      monitorId: "m-1",
      policyId: "p-1",
      testSkipped: true,
    });

    await store.flush();
  });

  test("what a read hands out is a copy: changing it changes nothing kept", async () => {
    const store: GuidedSetupRunStore = storeOn();

    await withStorage({ setItem: failing }, async () => {
      store.save({ monitorId: "m-1" });

      const run: Record<string, string | boolean> = store.read();
      run["policyId"] = "p-1";
      const saved: Record<string, string | boolean> = store.save({});
      saved["testSkipped"] = true;

      expect(store.read()).toEqual({ monitorId: "m-1" });
      await store.flush();
    });
  });
});

describe("the run, kept on the server (#7253)", () => {
  test("a run another device saved opens here, and this browser keeps a copy", async () => {
    server.runs.set("website_down", {
      values: { monitorId: "m-1", whoIsToldConfirmed: true },
      resources: {},
      revision: 2,
      updatedAt: "2026-11-20T10:00:00.000Z",
    });

    const phone: GuidedSetupRunStore = storeOn();

    expect(phone.read()).toEqual({});
    expect(await phone.load()).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(phone.read()).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(phone.getSync()).toBe(GuidedSetupRunSync.Saved);
    expect(kept()).toMatchObject({
      values: { monitorId: "m-1", whoIsToldConfirmed: true },
      isSynced: true,
    });
  });

  test("the laptop's steps open on the phone: one device's saves are the other's load", async () => {
    const laptop: GuidedSetupRunStore = storeOn();
    laptop.save({ address: "https://acme.example" });
    laptop.save({ monitorId: "m-1" });
    await laptop.flush();

    // Another device: its own browser, the same server.
    window.localStorage.clear();
    const phone: GuidedSetupRunStore = storeOn();

    expect(await phone.load()).toEqual({
      address: "https://acme.example",
      monitorId: "m-1",
    });

    phone.save({ whoIsToldConfirmed: true });
    await phone.flush();

    window.localStorage.clear();
    expect(await storeOn().load()).toEqual({
      address: "https://acme.example",
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
  });

  test("each save sends only what it changes, in the order it was made", async () => {
    const store: GuidedSetupRunStore = storeOn();

    store.save({ monitorId: "m-1" });
    await store.flush();
    store.save({ whoIsToldConfirmed: true });
    await store.flush();
    store.save({ whoIsToldConfirmed: null, policyId: "p-1" });
    await store.flush();

    expect(
      server.calls.map(
        (call: { change?: GuidedSetupRunChange | undefined }) => {
          return call.change?.values;
        },
      ),
    ).toEqual([
      { monitorId: "m-1" },
      { whoIsToldConfirmed: true },
      { whoIsToldConfirmed: null, policyId: "p-1" },
    ]);
    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      policyId: "p-1",
    });
  });

  test("saves made quickly go one request at a time, in order, and none is lost", async () => {
    const store: GuidedSetupRunStore = storeOn();

    store.save({ monitorId: "m-1" });
    store.save({ whoIsToldConfirmed: true });
    store.save({ testSkipped: true });
    store.save({ testSkipped: null, testExecutionLogId: "log-1" });
    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
      testExecutionLogId: "log-1",
    });
    expect(store.getSync()).toBe(GuidedSetupRunSync.Saved);
    expect(kept()).toMatchObject({ isSynced: true });
  });

  test("a save made just as the last request finishes is sent too, whatever the timing", async () => {
    /*
     * A save made after the sender's last request answered, but before it
     * let go of the line, found it busy and left its change to it - and the
     * change was never sent (the website setup's monitor id, between the
     * address it saved first and its next step).
     */
    const store: GuidedSetupRunStore = storeOn();
    const answerSave: FakeServer["save"] = server.save;
    let lateSave: (() => void) | null = (): void => {
      store.save({ monitorId: "m-1" });
    };

    /*
     * The first answer, once read, leads to a save one tick later: after
     * the sender's loop found nothing more to send, before it let go.
     */
    server.save = (
      setup: GuidedSetupKey,
      change: GuidedSetupRunChange,
    ): Promise<GuidedSetupRunAnswer> => {
      const answer: Promise<GuidedSetupRunAnswer> = answerSave(setup, change);
      const save: (() => void) | null = lateSave;

      lateSave = null;

      if (save) {
        void answer.then(() => {
          return Promise.resolve().then(save);
        });
      }

      return answer;
    };

    store.save({ address: "https://acme.example" });
    await store.flush();
    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({
      address: "https://acme.example",
      monitorId: "m-1",
    });
    expect(store.getSync()).toBe(GuidedSetupRunSync.Saved);
  });

  test("says where the run stands as it goes: saving, then saved", async () => {
    const store: GuidedSetupRunStore = storeOn();
    const seen: Array<GuidedSetupRunSync> = [];
    const stop: () => void = store.subscribe((sync: GuidedSetupRunSync) => {
      seen.push(sync);
    });

    expect(store.getSync()).toBe(GuidedSetupRunSync.Idle);

    store.save({ monitorId: "m-1" });
    await store.flush();

    expect(seen).toEqual([GuidedSetupRunSync.Saving, GuidedSetupRunSync.Saved]);

    stop();
    store.save({ policyId: "p-1" });
    await store.flush();

    // Unsubscribed: told nothing more.
    expect(seen).toHaveLength(2);
  });

  test("OneUptime out of reach when the page opens: it opens on what this browser kept", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });
    await store.flush();

    server.isDown = true;
    const reloaded: GuidedSetupRunStore = storeOn();

    expect(await reloaded.load()).toEqual({ monitorId: "m-1" });
  });

  test("OneUptime out of reach with nothing kept: an empty run, and nothing to say", async () => {
    server.isDown = true;
    const store: GuidedSetupRunStore = storeOn();

    expect(await store.load()).toEqual({});
    expect(store.getSync()).toBe(GuidedSetupRunSync.Idle);
  });

  test("a save the server did not take is kept here, said, and sent whole with the next one", async () => {
    const store: GuidedSetupRunStore = storeOn();

    server.isDown = true;
    store.save({ monitorId: "m-1" });
    await store.flush();

    expect(store.getSync()).toBe(GuidedSetupRunSync.NotSaved);
    expect(kept()).toMatchObject({
      values: { monitorId: "m-1" },
      isSynced: false,
    });
    expect(server.valuesOf("website_down")).toBeUndefined();

    server.isDown = false;
    store.save({ whoIsToldConfirmed: true });
    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(store.getSync()).toBe(GuidedSetupRunSync.Saved);
    expect(kept()).toMatchObject({ isSynced: true });
  });

  test("Try again sends what the server did not take", async () => {
    const store: GuidedSetupRunStore = storeOn();

    server.isDown = true;
    store.save({ monitorId: "m-1" });
    await store.flush();

    server.isDown = false;
    store.retry();
    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({ monitorId: "m-1" });
    expect(store.getSync()).toBe(GuidedSetupRunSync.Saved);
  });

  test("a save the server never got is sent when the page opens again, before anything is read", async () => {
    server.isDown = true;
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });
    await store.flush();

    // Meanwhile another device saved a step of its own.
    server.isDown = false;
    server.runs.set("website_down", {
      values: { policyId: "p-1" },
      resources: {},
      revision: 1,
      updatedAt: "2026-11-20T10:00:00.000Z",
    });

    expect(await storeOn().load()).toEqual({
      monitorId: "m-1",
      policyId: "p-1",
    });
    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      policyId: "p-1",
    });
  });

  test("an older Dashboard's run, kept only in this browser, is sent to the server once", async () => {
    window.localStorage.setItem(
      getGuidedSetupRunKey(who),
      JSON.stringify({ monitorId: "m-1", whoIsToldConfirmed: true }),
    );

    const store: GuidedSetupRunStore = storeOn();

    expect(await store.load()).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      whoIsToldConfirmed: true,
    });
    expect(kept()).toMatchObject({ isSynced: true });

    // Sent: the next page reads the server, and sends it no more.
    server.calls = [];
    await storeOn().load();

    expect(
      server.calls.map((call: { kind: string }) => {
        return call.kind;
      }),
    ).toEqual(["fetch"]);
  });

  test("a run started afresh on another device is gone here too", async () => {
    const laptop: GuidedSetupRunStore = storeOn();
    laptop.save({ monitorId: "m-1" });
    await laptop.flush();

    // The phone pressed "Check another address".
    server.runs.delete("website_down");

    expect(await storeOn().load()).toEqual({});
    expect(kept()).toBeNull();
  });

  test("a start afresh the server did not hear is sent first next time, so the old run never comes back", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ monitorId: "m-1" });
    await store.flush();

    server.isDown = true;
    store.forget();
    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({ monitorId: "m-1" });
    expect(store.getSync()).toBe(GuidedSetupRunSync.NotSaved);

    server.isDown = false;

    expect(await storeOn().load()).toEqual({});
    expect(server.valuesOf("website_down")).toBeUndefined();
    expect(kept()).toBeNull();
  });

  test("a start afresh, then a save, both before the server answers: the save is the new run's", async () => {
    // The on-call setup's Set up another policy: forget, then who is reached.
    const store: GuidedSetupRunStore = storeOn();
    store.save({ policyId: "p-1", reachConfirmed: true });
    await store.flush();

    store.forget();
    store.save({ reachConfirmed: true });

    expect(store.read()).toEqual({ reachConfirmed: true });
    expect(storeOn().read()).toEqual({ reachConfirmed: true });

    await store.flush();

    expect(server.valuesOf("website_down")).toEqual({ reachConfirmed: true });
    expect(
      server.calls.map((call: { kind: string }) => {
        return call.kind;
      }),
    ).toEqual(["save", "forget", "save"]);
  });

  test("a start afresh and a save the server never heard are sent in that order when the page opens again", async () => {
    const store: GuidedSetupRunStore = storeOn();
    store.save({ policyId: "p-1" });
    await store.flush();

    server.isDown = true;
    store.forget();
    store.save({ reachConfirmed: true });
    await store.flush();

    server.isDown = false;

    expect(await storeOn().load()).toEqual({ reachConfirmed: true });
    expect(server.valuesOf("website_down")).toEqual({ reachConfirmed: true });
    expect(kept()).toMatchObject({
      values: { reachConfirmed: true },
      isSynced: true,
      isForgetPending: false,
    });
  });

  test("a save made while the page's run was being read is kept, and sent", async () => {
    server.runs.set("website_down", {
      values: { monitorId: "m-1" },
      resources: {},
      revision: 1,
      updatedAt: "2026-11-20T10:00:00.000Z",
    });

    const store: GuidedSetupRunStore = storeOn();
    const loading: Promise<Record<string, string | boolean>> = store.load();
    store.save({ testSkipped: true });

    expect(await loading).toEqual({ monitorId: "m-1", testSkipped: true });
    await store.flush();
    expect(server.valuesOf("website_down")).toEqual({
      monitorId: "m-1",
      testSkipped: true,
    });
  });

  test("how each record is getting on is kept beside the values, and on the server", async () => {
    const store: GuidedSetupRunStore = storeOn();

    store.track({
      monitor: {
        status: GuidedSetupResourceStatus.Creating,
        name: "acme.example",
      },
    });

    expect(store.readResources()["monitor"]).toMatchObject({
      status: GuidedSetupResourceStatus.Creating,
      name: "acme.example",
    });

    store.save(
      { monitorId: "m-1" },
      {
        monitor: {
          status: GuidedSetupResourceStatus.Created,
          recordId: "m-1",
          name: "acme.example",
        },
      },
    );
    await store.flush();

    expect(server.runs.get("website_down")?.resources["monitor"]).toMatchObject(
      {
        status: GuidedSetupResourceStatus.Created,
        recordId: "m-1",
      },
    );

    // Another device sees what was made, and how.
    window.localStorage.clear();
    const phone: GuidedSetupRunStore = storeOn();
    await phone.load();

    expect(phone.readResources()["monitor"]).toMatchObject({
      status: GuidedSetupResourceStatus.Created,
      recordId: "m-1",
      name: "acme.example",
    });
  });

  test("a failure is kept with why, and a later try replaces it", async () => {
    const store: GuidedSetupRunStore = storeOn();

    store.track({
      monitor: {
        status: GuidedSetupResourceStatus.Failed,
        error: "OneUptime could not be reached.",
      },
    });
    store.track({
      monitor: { status: GuidedSetupResourceStatus.Created, recordId: "m-1" },
    });
    await store.flush();

    expect(store.readResources()).toEqual({
      monitor: expect.objectContaining({
        status: GuidedSetupResourceStatus.Created,
        recordId: "m-1",
      }),
    });
    expect(store.readResources()["monitor"]).not.toHaveProperty("error");
  });

  test("a setup the server keeps no run for is kept in this browser alone", async () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore({
      setup: "example_setup",
      projectId: "project-1",
      userId: "user-1",
      remote: server,
    });

    store.save({ monitorId: "m-1" });
    expect(await store.load()).toEqual({ monitorId: "m-1" });
    store.forget();
    await store.flush();

    expect(server.calls).toEqual([]);
    expect(store.getSync()).toBe(GuidedSetupRunSync.Idle);
  });
});
