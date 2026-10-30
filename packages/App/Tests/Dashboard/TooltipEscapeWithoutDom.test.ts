import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The shared Tooltip's Escape listener (Common's TooltipEscape) goes on the
 * window as its module loads, so that a tooltip hears Escape before the
 * playlist player and a dashboard widget's drag, which listen on the window
 * too. App's tests run in node, with no DOM: twenty-nine of them import page
 * code after standing a bare `window` in - a location and a history, no
 * addEventListener (ReplayLinkAtMoment, LogsInsights, the Security Events
 * pages...) - and that page code pulls the Tooltip in. Every one of them
 * failed on the import, "window.addEventListener is not a function".
 *
 * Here the modules are loaded fresh in each case, in this node environment:
 * with no window at all, with that bare window, and with a window that can
 * be listened to - where the listener still goes on as the module loads.
 */

type Globals = Record<string, unknown>;

const globals: Globals = globalThis as unknown as Globals;

type TooltipEscapeModule =
  typeof import("Common/UI/Components/Tooltip/TooltipEscape");

// The window App's node tests stand in to import page code.
const bareWindow: () => Globals = (): Globals => {
  return {
    location: { pathname: "/dashboard", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // never asserted on
      },
    },
  };
};

interface ListenedWindow {
  window: Globals;
  added: Array<[string, unknown, unknown]>;
}

// A window that can be listened to, which records what listens on it.
const listenedWindow: () => ListenedWindow = (): ListenedWindow => {
  const added: Array<[string, unknown, unknown]> = [];

  return {
    added,
    window: {
      ...bareWindow(),
      addEventListener: (
        type: string,
        listener: unknown,
        options: unknown,
      ): void => {
        added.push([type, listener, options]);
      },
    },
  };
};

const loadTooltipEscape: () => Promise<TooltipEscapeModule> =
  async (): Promise<TooltipEscapeModule> => {
    return await import("Common/UI/Components/Tooltip/TooltipEscape");
  };

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  delete globals["window"];
  delete globals["document"];
});

describe("TooltipEscape, imported without a DOM", () => {
  test("in this node environment there is no window to begin with", () => {
    expect(typeof globals["window"]).toBe("undefined");
    expect(typeof globals["document"]).toBe("undefined");
  });

  test("with no window at all it loads, and listens for nothing", async () => {
    const escape: TooltipEscapeModule = await loadTooltipEscape();

    expect(escape.TOOLTIP_PLUGINS).toEqual([escape.hideOnEscape]);
    expect(() => {
      escape.listenForTooltipEscape();
    }).not.toThrow();
  });

  test("REGRESSION: with the bare window App's tests stand in, it loads without listening", async () => {
    globals["window"] = bareWindow();

    const escape: TooltipEscapeModule = await loadTooltipEscape();

    expect(() => {
      escape.listenForTooltipEscape();
    }).not.toThrow();
    expect(globals["window"]).not.toHaveProperty("addEventListener");
  });

  test("REGRESSION: so does the Tooltip that brings it in", async () => {
    globals["window"] = bareWindow();

    await expect(
      import("Common/UI/Components/Tooltip/Tooltip"),
    ).resolves.toHaveProperty("default");
  });

  test("with a document that cannot be listened to, the input modality it reads loads too", async () => {
    globals["window"] = bareWindow();
    globals["document"] = { title: "OneUptime" };

    const modality: typeof import("Common/UI/Utils/InputModality") =
      await import("Common/UI/Utils/InputModality");

    expect(modality.wasLastInputFromKeyboard()).toBe(true);
  });
});

describe("TooltipEscape, imported where the window can be listened to", () => {
  test("it listens as it loads - once, for the key going down, on the way in - before anything that mounts after it", async () => {
    const listened: ListenedWindow = listenedWindow();
    globals["window"] = listened.window;

    const escape: TooltipEscapeModule = await loadTooltipEscape();

    expect(listened.added).toEqual([["keydown", expect.any(Function), true]]);

    // Asked again - as each tooltip does when it starts to show - it does not add a second.
    escape.listenForTooltipEscape();
    expect(listened.added).toHaveLength(1);
  });

  test("a window that could not be listened to when it loaded is listened to when a tooltip next asks", async () => {
    globals["window"] = bareWindow();
    const escape: TooltipEscapeModule = await loadTooltipEscape();

    const listened: ListenedWindow = listenedWindow();
    globals["window"] = listened.window;
    escape.listenForTooltipEscape();
    escape.listenForTooltipEscape();

    expect(listened.added).toEqual([["keydown", expect.any(Function), true]]);
  });
});
