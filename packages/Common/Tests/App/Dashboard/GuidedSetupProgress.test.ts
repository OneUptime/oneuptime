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

/*
 * A guided setup's progress (issue #6804, shared by #6805 and #6806): which
 * step a returning person lands on, which steps can be opened, and the run
 * kept in this browser - never more than ids and true - and in the page
 * while it is open, so a browser that keeps nothing loses no step's save
 * (#7059).
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
  work: () => void,
) => void = (replacements: Partial<StorageMethods>, work: () => void): void => {
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
    work();
  } finally {
    jest.restoreAllMocks();
  }
};

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

describe("the run, kept in this browser", () => {
  const who: { setup: string; projectId: string; userId: string } = {
    setup: "website_down",
    projectId: "project-1",
    userId: "user-1",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

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

  test("saves values as they come, and removes the ones given as null", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

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
    expect(new GuidedSetupRunStore(who).read()).toEqual({ monitorId: "m-1" });
  });

  test("another person's or project's run is not this one", () => {
    new GuidedSetupRunStore(who).save({ monitorId: "m-1" });

    expect(
      new GuidedSetupRunStore({ ...who, userId: "user-2" }).read(),
    ).toEqual({});
    expect(
      new GuidedSetupRunStore({ ...who, projectId: "project-2" }).read(),
    ).toEqual({});
  });

  test("forgetting starts the next run afresh", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);
    store.save({ monitorId: "m-1" });
    store.forget();

    expect(store.read()).toEqual({});
    expect(window.localStorage.getItem(getGuidedSetupRunKey(who))).toBeNull();
  });

  test("keeps only ids and true: anything else in storage is not a run's", () => {
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

    expect(new GuidedSetupRunStore(who).read()).toEqual({});
  });

  test("a browser that keeps nothing still walks the setup", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      () => {
        expect(store.read()).toEqual({});
        expect(store.save({ monitorId: "m-1" })).toEqual({
          monitorId: "m-1",
        });
        expect(() => {
          store.forget();
        }).not.toThrow();
      },
    );
  });
});

describe("the run, in a browser that keeps nothing", () => {
  const who: { setup: string; projectId: string; userId: string } = {
    setup: "website_down",
    projectId: "project-1",
    userId: "user-1",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

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

  test("storage switched off: every save adds to the run this page keeps", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      () => {
        walk(store);
      },
    );
  });

  test("a browser that takes nothing (a private window that refuses writes): the same", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage({ setItem: failing }, () => {
      walk(store);
      // The browser has none of it; the page has all of it.
      expect(window.localStorage.getItem(getGuidedSetupRunKey(who))).toBeNull();
    });
  });

  test("a browser that takes a value and reads nothing back: the same", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage(
      {
        setItem: (): void => {
          // Accepted, and gone.
        },
      },
      () => {
        walk(store);
      },
    );
  });

  test("forgetting empties the page's run too", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      () => {
        store.save({ monitorId: "m-1" });
        store.forget();

        expect(store.read()).toEqual({});
        expect(store.save({ policyId: "p-1" })).toEqual({ policyId: "p-1" });
      },
    );
  });

  test("the page's run is this store's: a page opened afresh starts again", () => {
    withStorage(
      { getItem: failing, setItem: failing, removeItem: failing },
      () => {
        new GuidedSetupRunStore(who).save({ monitorId: "m-1" });

        // A reload builds a new store: what the browser did not keep is gone.
        expect(new GuidedSetupRunStore(who).read()).toEqual({});
      },
    );
  });

  test("a run the browser keeps wins over the page's copy", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);
    store.save({ monitorId: "m-1" });

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
  });

  test("what a read hands out is a copy: changing it changes nothing kept", () => {
    const store: GuidedSetupRunStore = new GuidedSetupRunStore(who);

    withStorage({ setItem: failing }, () => {
      store.save({ monitorId: "m-1" });

      const run: Record<string, string | boolean> = store.read();
      run["policyId"] = "p-1";
      const saved: Record<string, string | boolean> = store.save({});
      saved["testSkipped"] = true;

      expect(store.read()).toEqual({ monitorId: "m-1" });
    });
  });
});
