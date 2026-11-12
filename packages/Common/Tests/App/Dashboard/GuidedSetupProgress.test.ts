import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
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
 * kept in this browser - never more than ids and true, never lost to a
 * browser that keeps nothing.
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
    const storage: Storage = window.localStorage;
    const failing: () => never = (): never => {
      throw new Error("storage is off");
    };
    const originalSet: Storage["setItem"] = storage.setItem;
    const originalGet: Storage["getItem"] = storage.getItem;
    const originalRemove: Storage["removeItem"] = storage.removeItem;

    Object.defineProperty(storage, "setItem", {
      value: failing,
      configurable: true,
    });
    Object.defineProperty(storage, "getItem", {
      value: failing,
      configurable: true,
    });
    Object.defineProperty(storage, "removeItem", {
      value: failing,
      configurable: true,
    });

    try {
      expect(store.read()).toEqual({});
      expect(store.save({ monitorId: "m-1" })).toEqual({ monitorId: "m-1" });
      expect(() => {
        store.forget();
      }).not.toThrow();
    } finally {
      Object.defineProperty(storage, "setItem", {
        value: originalSet,
        configurable: true,
      });
      Object.defineProperty(storage, "getItem", {
        value: originalGet,
        configurable: true,
      });
      Object.defineProperty(storage, "removeItem", {
        value: originalRemove,
        configurable: true,
      });
    }
  });
});
