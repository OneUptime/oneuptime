import { describe, expect, jest, test } from "@jest/globals";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  FOLDS_CHANGE_EVENT,
  WINDOW_POSTURE_MODULE_NAME,
  createNativePostureSource,
  getPlatformPostureSource,
} from "./postureSource";
import type { FoldReport, PostureSource } from "./windowPosture";

// Expo's own lookup, unless a test hands it a module.
jest.mock("expo-modules-core", () => {
  const actual: Record<string, unknown> & {
    requireOptionalNativeModule: (name: string) => unknown;
  } = jest.requireActual("expo-modules-core");
  return {
    ...actual,
    requireOptionalNativeModule: jest.fn((name: string): unknown => {
      return actual.requireOptionalNativeModule(name);
    }),
  };
});

const lookup: jest.Mock<(name: string) => unknown> =
  requireOptionalNativeModule as unknown as jest.Mock<
    (name: string) => unknown
  >;

/*
 * The native module's JavaScript side, and the fallback without it.
 *
 * This machine (and CI) has no Android device, so the module itself is a
 * stand-in here with the module's contract: getFolds() for the latest
 * report, and a "foldsChange" event for every later one. Without the module
 * - iOS, Expo Go, an older build, every jest run - there is no source, which
 * is what keeps every window on today's layout.
 */

const BOOK_REPORT: FoldReport = {
  windowWidth: 884,
  windowHeight: 1104,
  folds: [
    {
      x: 442,
      y: 0,
      width: 0,
      height: 1104,
      orientation: "vertical",
      separating: true,
    },
  ],
};

interface FakeModule {
  getFolds: jest.Mock<() => unknown>;
  addListener: jest.Mock<
    (
      eventName: string,
      listener: (event: unknown) => void,
    ) => {
      remove: () => void;
    }
  >;
  emit: (eventName: string, event: unknown) => void;
  listenerCount: () => number;
}

function fakeModule(current: unknown = BOOK_REPORT): FakeModule {
  const listeners: Map<string, Set<(event: unknown) => void>> = new Map();
  const module: FakeModule = {
    getFolds: jest.fn((): unknown => {
      return current;
    }),
    addListener: jest.fn(
      (
        eventName: string,
        listener: (event: unknown) => void,
      ): { remove: () => void } => {
        const set: Set<(event: unknown) => void> =
          listeners.get(eventName) ?? new Set();
        set.add(listener);
        listeners.set(eventName, set);
        return {
          remove: (): void => {
            set.delete(listener);
          },
        };
      },
    ),
    emit: (eventName: string, event: unknown): void => {
      for (const listener of Array.from(listeners.get(eventName) ?? [])) {
        listener(event);
      }
    },
    listenerCount: (): number => {
      return Array.from(listeners.values()).reduce(
        (total: number, set: Set<(event: unknown) => void>): number => {
          return total + set.size;
        },
        0,
      );
    },
  };
  return module;
}

describe("Without the native module there is no posture source", () => {
  test("a build without the module - every jest run among them - has none", () => {
    expect(getPlatformPostureSource()).toBeNull();
  });

  test("it asks Expo for the module by the name the Kotlin side registers", () => {
    getPlatformPostureSource();

    expect(lookup).toHaveBeenCalledWith(WINDOW_POSTURE_MODULE_NAME);
    expect(WINDOW_POSTURE_MODULE_NAME).toBe("OneUptimeWindowPosture");
  });

  test("where Expo has the module, it becomes the source", () => {
    const module: FakeModule = fakeModule();
    lookup.mockReturnValueOnce(module);

    const source: PostureSource | null = getPlatformPostureSource();

    expect(source?.getCurrent()).toEqual(BOOK_REPORT);
  });

  test.each([
    ["nothing", null],
    ["undefined", undefined],
    ["an object without getFolds", { addListener: (): void => {} }],
    [
      "an object without addListener",
      {
        getFolds: (): null => {
          return null;
        },
      },
    ],
    ["a string", "OneUptimeWindowPosture"],
  ])("%s is no module", (_name: string, candidate: unknown) => {
    expect(createNativePostureSource(candidate)).toBeNull();
  });
});

describe("The native module as a posture source", () => {
  test("getCurrent reads the module's latest report", () => {
    const source: PostureSource = createNativePostureSource(fakeModule())!;

    expect(source.getCurrent()).toEqual(BOOK_REPORT);
  });

  test("before its first report, the module has nothing to say", () => {
    const source: PostureSource = createNativePostureSource(fakeModule(null))!;

    expect(source.getCurrent()).toBeNull();
  });

  test("a report this build cannot read says nothing, rather than something wrong", () => {
    const source: PostureSource = createNativePostureSource(
      fakeModule({ windowWidth: "wide", folds: [] }),
    )!;

    expect(source.getCurrent()).toBeNull();
  });

  test("a module that throws says nothing, and the app carries on", () => {
    const module: FakeModule = fakeModule();
    module.getFolds.mockImplementation((): unknown => {
      throw new Error("The activity is gone");
    });
    const source: PostureSource = createNativePostureSource(module)!;

    expect(source.getCurrent()).toBeNull();
  });

  test("every foldsChange event reaches the listener, read the same way", () => {
    const module: FakeModule = fakeModule();
    const source: PostureSource = createNativePostureSource(module)!;
    const received: Array<FoldReport | null> = [];

    source.subscribe((report: FoldReport | null): void => {
      received.push(report);
    });
    module.emit(FOLDS_CHANGE_EVENT, {
      ...BOOK_REPORT,
      folds: [{ ...BOOK_REPORT.folds[0], separating: false }],
    });
    module.emit(FOLDS_CHANGE_EVENT, { nonsense: true });
    module.emit("somethingElse", BOOK_REPORT);

    expect(module.addListener).toHaveBeenCalledWith(
      "foldsChange",
      expect.any(Function),
    );
    expect(received).toEqual([
      {
        ...BOOK_REPORT,
        folds: [{ ...BOOK_REPORT.folds[0], separating: false }],
      },
      null,
    ]);
  });

  test("unsubscribing removes the module's listener", () => {
    const module: FakeModule = fakeModule();
    const source: PostureSource = createNativePostureSource(module)!;
    const listener: jest.Mock<(report: FoldReport | null) => void> = jest.fn();

    const unsubscribe: () => void = source.subscribe(listener);
    expect(module.listenerCount()).toBe(1);
    unsubscribe();
    module.emit(FOLDS_CHANGE_EVENT, BOOK_REPORT);

    expect(module.listenerCount()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  test("a module that refuses the listener leaves nothing to unsubscribe", () => {
    const module: FakeModule = fakeModule();
    module.addListener.mockImplementation((): { remove: () => void } => {
      throw new Error("No event emitter");
    });
    const source: PostureSource = createNativePostureSource(module)!;

    const unsubscribe: () => void = source.subscribe(jest.fn());

    expect((): void => {
      unsubscribe();
    }).not.toThrow();
  });
});
