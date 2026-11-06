import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Common/UI/Utils/NewVersion/ChunkLoadError.ts listens for the page being left
 * from the moment it is imported, because beforeunload can come before the
 * first chunk error. Since form fields started drawing through
 * ChunkLoadRecovery (#5619), that import is reached from anything that reads
 * ModelAPI, which RouteMap does through ProjectUtil:
 *
 *   RouteMap -> Project -> ModelListCache -> ModelAPI -> ModelForm -> BasicForm
 *   -> FormField -> LazyCodeEditor -> LazyControlPlaceholder -> ChunkLoadRecovery
 *
 * So a module of plain functions ran browser code on import, and every test
 * here that reads RouteMap under a stand-in window (which holds a location and
 * no more) stopped at `window.addEventListener is not a function`: hundreds of
 * tests across dozens of suites. The file now takes what is called window as it
 * finds it. These hold it to that, in this package's plain Node environment.
 */

type ChunkLoadErrorModule =
  typeof import("Common/UI/Utils/NewVersion/ChunkLoadError");

type Listener = () => void;

function setWindow(standIn: unknown): void {
  (globalThis as Record<string, unknown>)["window"] = standIn;
}

async function importFresh(): Promise<ChunkLoadErrorModule> {
  jest.resetModules();
  return await import("Common/UI/Utils/NewVersion/ChunkLoadError");
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["window"];
});

describe("importing ChunkLoadError", () => {
  test("with no window at all, as on a server", async () => {
    expect(typeof window).toBe("undefined");

    const loaded: ChunkLoadErrorModule = await importFresh();

    expect(loaded.isPageBeingLeft()).toBe(false);
  });

  test("with a window that cannot take listeners, as a test's stand-in", async () => {
    setWindow({ location: { pathname: "/", search: "", hash: "" } });

    const loaded: ChunkLoadErrorModule = await importFresh();

    expect(loaded.isPageBeingLeft()).toBe(false);
    expect(loaded.isChunkLoadError(new Error("Loading chunk 12 failed."))).toBe(
      true,
    );
    expect(loaded.isChunkLoadError(new Error("Something else."))).toBe(false);
  });

  test("with a window whose addEventListener is not a function", async () => {
    setWindow({ addEventListener: "not a function" });

    const loaded: ChunkLoadErrorModule = await importFresh();

    expect(loaded.isPageBeingLeft()).toBe(false);
  });

  test("still follows the page being left in a real window", async () => {
    const listeners: Map<string, Listener> = new Map();

    setWindow({
      addEventListener: (name: string, listener: Listener): void => {
        listeners.set(name, listener);
      },
    });

    const loaded: ChunkLoadErrorModule = await importFresh();

    expect([...listeners.keys()].sort()).toEqual(["beforeunload", "pageshow"]);
    expect(loaded.isPageBeingLeft()).toBe(false);

    listeners.get("beforeunload")!();
    expect(loaded.isPageBeingLeft()).toBe(true);
    // A chunk cut off by leaving is not a chunk that is gone.
    expect(
      loaded.handleChunkLoadError(new Error("Loading chunk 12 failed.")),
    ).toBe(false);

    listeners.get("pageshow")!();
    expect(loaded.isPageBeingLeft()).toBe(false);
  });
});

describe("what reaches it", () => {
  test("RouteMap loads under the stand-in window its tests give it", async () => {
    setWindow({
      location: { pathname: "/", search: "", hash: "" },
      history: { state: null, replaceState: (): void => {} },
    });

    jest.resetModules();

    const routeMap: typeof import("../../FeatureSet/Dashboard/src/Utils/RouteMap") =
      await import("../../FeatureSet/Dashboard/src/Utils/RouteMap");

    expect(routeMap.default).toBeDefined();
  });
});
