import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  LazyLibrary,
  LazyLibraryLoad,
  useLazyLibrary,
  useLazyLibraryLoad,
} from "../../../UI/Utils/LazyLibrary";

/*
 * A library a page loads the first time something on it needs it, instead
 * of before it can draw (issue #5619): react-beautiful-dnd for a list that
 * drags its rows, highlight.js's grammars for a code editor. These pin what
 * every such library does, with one that arrives when the test says.
 */

interface Library {
  name: string;
}

interface ControlledLoad {
  library: LazyLibrary<Library>;
  // How many times the page asked for the library's file.
  loads: () => number;
  arrive: () => Promise<void>;
  fail: () => Promise<void>;
}

const LIBRARY: Library = { name: "the library" };

// A library whose file arrives, or fails to, when the test says.
const controlledLoad: () => ControlledLoad = (): ControlledLoad => {
  let count: number = 0;
  let settle: { arrive: () => void; fail: () => void } = {
    arrive: (): void => {},
    fail: (): void => {},
  };

  const library: LazyLibrary<Library> = new LazyLibrary<Library>(
    (): Promise<Library> => {
      count++;

      return new Promise(
        (resolve: (value: Library) => void, reject: (error: Error) => void) => {
          settle = {
            arrive: (): void => {
              resolve(LIBRARY);
            },
            fail: (): void => {
              reject(new Error("The file could not be fetched"));
            },
          };
        },
      );
    },
  );

  // Lets what waits on the load run, inside act: it may set a hook's state.
  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });
  };

  return {
    library,
    loads: (): number => {
      return count;
    },
    arrive: async (): Promise<void> => {
      settle.arrive();
      await flush();
    },
    fail: async (): Promise<void> => {
      settle.fail();
      await flush();
    },
  };
};

afterEach(() => {
  cleanup();
});

describe("LazyLibrary", () => {
  test("loads nothing until something asks", () => {
    const load: ControlledLoad = controlledLoad();

    expect(load.library.getLoaded()).toBeNull();
    expect(load.loads()).toBe(0);
  });

  test("loads once, however many ask, and keeps what it loaded", async () => {
    const load: ControlledLoad = controlledLoad();

    const first: Promise<Library> = load.library.load();
    const second: Promise<Library> = load.library.load();

    expect(second).toBe(first);
    expect(load.library.getLoaded()).toBeNull();

    await load.arrive();

    expect(await first).toBe(LIBRARY);
    expect(load.library.getLoaded()).toBe(LIBRARY);
    expect(await load.library.load()).toBe(LIBRARY);
    expect(load.loads()).toBe(1);
  });

  test("does not keep a load that failed: the next to ask tries again", async () => {
    const load: ControlledLoad = controlledLoad();

    const failed: Promise<Library> = load.library.load();
    const failure: Promise<unknown> = failed.catch((error: unknown) => {
      return error;
    });

    await load.fail();

    expect(await failure).toEqual(new Error("The file could not be fetched"));
    expect(load.library.getLoaded()).toBeNull();

    const retried: Promise<Library> = load.library.load();

    expect(retried).not.toBe(failed);
    expect(load.loads()).toBe(2);

    await load.arrive();

    expect(await retried).toBe(LIBRARY);
  });
});

describe("useLazyLibrary", () => {
  test("loads nothing, and is nothing, while the component does not need it", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibrary(load.library, false);
    });

    await load.arrive();

    expect(result.current).toBeNull();
    expect(load.loads()).toBe(0);
  });

  test("is nothing while the library loads, then the library", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    });

    expect(result.current).toBeNull();
    expect(load.loads()).toBe(1);

    await load.arrive();

    expect(result.current).toBe(LIBRARY);
  });

  test("is the library from the first frame once it has loaded", async () => {
    const load: ControlledLoad = controlledLoad();
    const loading: Promise<Library> = load.library.load();
    await load.arrive();
    await loading;

    const { result } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    });

    expect(result.current).toBe(LIBRARY);
    expect(load.loads()).toBe(1);
  });

  test("starts loading when the component comes to need it", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result, rerender } = renderHook(
      (props: { isNeeded: boolean }) => {
        return useLazyLibrary(load.library, props.isNeeded);
      },
      { initialProps: { isNeeded: false } },
    );

    expect(load.loads()).toBe(0);

    rerender({ isNeeded: true });

    expect(load.loads()).toBe(1);

    await load.arrive();

    expect(result.current).toBe(LIBRARY);

    rerender({ isNeeded: false });

    expect(result.current).toBeNull();
  });

  test("components drawn together share one load", async () => {
    const load: ControlledLoad = controlledLoad();

    const first: { current: Library | null } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    }).result;
    const second: { current: Library | null } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    }).result;

    expect(load.loads()).toBe(1);

    await load.arrive();

    expect(first.current).toBe(LIBRARY);
    expect(second.current).toBe(LIBRARY);
  });

  test("stays without the library, and throws nothing, when it cannot load", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    });

    await load.fail();

    expect(result.current).toBeNull();
    expect(load.library.getLoaded()).toBeNull();
  });

  test("a component drawn after a failed load asks again", async () => {
    const load: ControlledLoad = controlledLoad();

    renderHook(() => {
      return useLazyLibrary(load.library, true);
    });
    await load.fail();

    const { result } = renderHook(() => {
      return useLazyLibrary(load.library, true);
    });

    expect(load.loads()).toBe(2);

    await load.arrive();

    expect(result.current).toBe(LIBRARY);
  });
});

/*
 * For a component that cannot draw without the library, and so must say when
 * it cannot have it: a form's code editor, Markdown editor or file picker.
 */
describe("useLazyLibraryLoad", () => {
  test("has no library and no error while the library loads, then the library", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });

    expect(result.current).toEqual({ library: null, error: null });

    await load.arrive();

    expect(result.current).toEqual({ library: LIBRARY, error: null });
  });

  test("says why the library could not load", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });

    await load.fail();

    expect(result.current.library).toBeNull();
    expect(result.current.error).toEqual(
      new Error("The file could not be fetched"),
    );
  });

  test("says it as an error, whatever the load was refused with", async () => {
    const library: LazyLibrary<Library> = new LazyLibrary<Library>(
      (): Promise<Library> => {
        return Promise.reject("The network went away");
      },
    );

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(library, true);
    });

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(result.current.error).toEqual(new Error("The network went away"));
  });

  test("loads nothing and says nothing while the component does not need it", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(load.library, false);
    });

    expect(result.current).toEqual({ library: null, error: null });
    expect(load.loads()).toBe(0);
  });

  test("a component drawn after a failed load starts over: it asks again and has no error", async () => {
    const load: ControlledLoad = controlledLoad();

    renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });
    await load.fail();

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });

    expect(load.loads()).toBe(2);
    expect(result.current).toEqual({ library: null, error: null });

    await load.arrive();

    expect(result.current).toEqual({ library: LIBRARY, error: null });
  });

  test("a failure is forgotten when the component stops needing the library, and it asks again when it needs it again", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result, rerender } = renderHook(
      (props: { isNeeded: boolean }): LazyLibraryLoad<Library> => {
        return useLazyLibraryLoad(load.library, props.isNeeded);
      },
      { initialProps: { isNeeded: true } },
    );

    await load.fail();

    expect(result.current.error).not.toBeNull();

    rerender({ isNeeded: false });

    expect(result.current).toEqual({ library: null, error: null });

    rerender({ isNeeded: true });

    expect(result.current).toEqual({ library: null, error: null });
    expect(load.loads()).toBe(2);

    await load.arrive();

    expect(result.current).toEqual({ library: LIBRARY, error: null });
  });

  test("a load that ends after the component has gone sets nothing", async () => {
    const load: ControlledLoad = controlledLoad();

    const { result, unmount } = renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });

    unmount();

    await load.fail();

    expect(result.current).toEqual({ library: null, error: null });
  });

  test("once it has loaded, it is the library from the first frame, with no error", async () => {
    const load: ControlledLoad = controlledLoad();
    const loading: Promise<Library> = load.library.load();
    await load.arrive();
    await loading;

    const { result } = renderHook(() => {
      return useLazyLibraryLoad(load.library, true);
    });

    expect(result.current).toEqual({ library: LIBRARY, error: null });
    expect(load.loads()).toBe(1);
  });
});
