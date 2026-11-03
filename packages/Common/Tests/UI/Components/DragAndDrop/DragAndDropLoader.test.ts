import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type * as TestingLibrary from "@testing-library/react";
import type * as LoaderModule from "../../../../UI/Components/DragAndDrop/DragAndDropLoader";

/*
 * react-beautiful-dnd is loaded by the first list that drags its rows, not
 * by every page that draws a Table or a StaticModelList (issue #5619). These
 * pin the loader: one load however many lists ask, a failed load tried again
 * by the next list, and the hook a list draws with.
 *
 * The library is counted as it is required. Every test starts on modules of
 * its own - the loader, and the React and Testing Library its hook is drawn
 * with - so each starts with nothing loaded. The registry is reset rather
 * than isolated (isolateModules): the loader requires the library from a
 * promise, after an isolated callback has returned.
 */

const mockLibrary: { requires: number; failNext: number } = {
  requires: 0,
  failNext: 0,
};

jest.mock("react-beautiful-dnd", () => {
  mockLibrary.requires++;

  if (mockLibrary.failNext > 0) {
    mockLibrary.failNext--;
    throw new Error("The chunk could not be fetched");
  }

  return jest.requireActual("react-beautiful-dnd");
});

type Loader = typeof LoaderModule;
type Library = LoaderModule.DragAndDropLibrary;

interface FreshPage {
  loader: Loader;
  testing: typeof TestingLibrary;
}

let pages: Array<FreshPage> = [];

// The loader as a page that has loaded nothing yet sees it.
const freshPage: () => Promise<FreshPage> = async (): Promise<FreshPage> => {
  const autoCleanup: string | undefined = process.env["RTL_SKIP_AUTO_CLEANUP"];

  jest.resetModules();
  // Its afterEach cannot be added from inside a test: cleaned up below.
  process.env["RTL_SKIP_AUTO_CLEANUP"] = "true";

  const page: FreshPage = {
    loader: await import(
      "../../../../UI/Components/DragAndDrop/DragAndDropLoader"
    ),
    testing: await import("@testing-library/react"),
  };

  if (autoCleanup === undefined) {
    delete process.env["RTL_SKIP_AUTO_CLEANUP"];
  } else {
    process.env["RTL_SKIP_AUTO_CLEANUP"] = autoCleanup;
  }

  pages.push(page);

  return page;
};

// Lets every promise that has settled run what waits on it.
const settle: (page: FreshPage) => Promise<void> = async (
  page: FreshPage,
): Promise<void> => {
  await page.testing.act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

afterEach(() => {
  for (const page of pages) {
    page.testing.cleanup();
  }

  pages = [];
  mockLibrary.requires = 0;
  mockLibrary.failNext = 0;
});

describe("loadDragAndDrop", () => {
  test("loads nothing until a list asks", async () => {
    const { loader } = await freshPage();

    expect(loader.getLoadedDragAndDrop()).toBeNull();
    expect(mockLibrary.requires).toBe(0);
  });

  test("loads the library once, however many lists ask, and hands each what it draws with", async () => {
    const { loader } = await freshPage();

    const first: Promise<Library> = loader.loadDragAndDrop();
    const second: Promise<Library> = loader.loadDragAndDrop();

    expect(second).toBe(first);

    const library: Library = await first;
    const actual: Record<string, unknown> = jest.requireActual(
      "react-beautiful-dnd",
    );

    expect(library.DragDropContext).toBe(actual["DragDropContext"]);
    expect(library.Droppable).toBe(actual["Droppable"]);
    expect(library.Draggable).toBe(actual["Draggable"]);
    expect(loader.getLoadedDragAndDrop()).toBe(library);
    expect(await loader.loadDragAndDrop()).toBe(library);
    expect(mockLibrary.requires).toBe(1);
  });

  test("does not keep a load that failed: the next list to ask tries again", async () => {
    const { loader } = await freshPage();
    mockLibrary.failNext = 1;

    await expect(loader.loadDragAndDrop()).rejects.toThrow(
      "The chunk could not be fetched",
    );
    expect(loader.getLoadedDragAndDrop()).toBeNull();

    const library: Library = await loader.loadDragAndDrop();

    expect(library.Draggable).toBeDefined();
    expect(loader.getLoadedDragAndDrop()).toBe(library);
    expect(mockLibrary.requires).toBe(2);
  });
});

describe("useDragAndDrop", () => {
  test("is nothing, and loads nothing, for a list whose rows stay where they are", async () => {
    const page: FreshPage = await freshPage();

    const { result } = page.testing.renderHook(() => {
      return page.loader.useDragAndDrop(false);
    });

    await settle(page);

    expect(result.current).toBeNull();
    expect(mockLibrary.requires).toBe(0);
    expect(page.loader.getLoadedDragAndDrop()).toBeNull();
  });

  test("is nothing while the library loads, then the library", async () => {
    const page: FreshPage = await freshPage();

    const { result } = page.testing.renderHook(() => {
      return page.loader.useDragAndDrop(true);
    });

    // The first frame: the rows are drawn, and do not drag yet.
    expect(result.current).toBeNull();

    await page.testing.waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current).toBe(page.loader.getLoadedDragAndDrop());
    expect(mockLibrary.requires).toBe(1);
  });

  test("is the library from the first frame once a list has loaded it", async () => {
    const page: FreshPage = await freshPage();
    const library: Library = await page.loader.loadDragAndDrop();

    const { result } = page.testing.renderHook(() => {
      return page.loader.useDragAndDrop(true);
    });

    expect(result.current).toBe(library);
  });

  test("is nothing for a list that stops reordering, though the library is there", async () => {
    const page: FreshPage = await freshPage();
    await page.loader.loadDragAndDrop();

    const { result, rerender } = page.testing.renderHook(
      (props: { isEnabled: boolean }) => {
        return page.loader.useDragAndDrop(props.isEnabled);
      },
      { initialProps: { isEnabled: true } },
    );

    expect(result.current).not.toBeNull();

    rerender({ isEnabled: false });

    expect(result.current).toBeNull();
  });

  test("stays nothing, and throws nothing, when the library cannot load", async () => {
    const page: FreshPage = await freshPage();
    mockLibrary.failNext = 1;

    const { result } = page.testing.renderHook(() => {
      return page.loader.useDragAndDrop(true);
    });

    await settle(page);

    expect(mockLibrary.requires).toBe(1);
    expect(result.current).toBeNull();
    expect(page.loader.getLoadedDragAndDrop()).toBeNull();
  });
});
