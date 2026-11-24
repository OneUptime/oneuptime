import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act, ReactElement, useState } from "react";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";

/*
 * A dashboard shown full screen (issue #10409): the real DashboardViewer and
 * its real toolbar, against a fake dashboard API, inside a stand-in for the
 * app around it - the header and menus, the page's <main> with the app's
 * own layers in it, the footer, and the notes beside the app. What is
 * asserted is what a person meets:
 *
 *   - Full Screen on the toolbar, and in its ⋯ menu, shows the dashboard
 *     alone over the whole window, and asks the browser for its own full
 *     screen where it can; Exit Full Screen and Escape put both away;
 *   - the browser's Escape, which leaves its full screen first, leaves the
 *     dashboard's too when both came from one press, and only the browser's
 *     when Fill the Screen asked for it later;
 *   - everything still works full screen: editing, adding a widget, saving,
 *     the time range, auto-refresh, variables, Share and Open in New Tab -
 *     and going in or out loses nothing and reads nothing again;
 *   - the page behind is still and out of reach, while the app's own layers
 *     and its notes are not;
 *   - a reader who may not edit is a reader full screen too.
 *
 * The canvas is stubbed: it publishes what it is handed.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "55555555-5555-4555-8555-555555555555";
const PAGE_PATH: string = `/dashboard/10000000-0000-4000-8000-000000000001/dashboards/${DASHBOARD_ID}`;

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

const serverState: { dashboardViewConfig: JSONObject | null } = {
  dashboardViewConfig: null,
};

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const updateByIdMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
      getFriendlyMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// The canvas, publishing what it is handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      getDashboardWidgetBoxId: (id: string): string => {
        return `widget-${id}`;
      },
      default: (props: {
        isEditMode?: boolean | undefined;
        refreshTick?: number | undefined;
        dashboardStartAndEndDate: { range: string };
        dashboardViewConfig: DashboardViewConfig;
        onAddWidgetClick?: (() => void) | undefined;
        variables?: Array<DashboardVariable> | undefined;
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-is-edit-mode": props.isEditMode ? "true" : "false",
          "data-refresh-tick": String(props.refreshTick || 0),
          "data-range": props.dashboardStartAndEndDate.range,
          "data-widgets": String(props.dashboardViewConfig.components.length),
          "data-can-add-widget": String(Boolean(props.onAddWidgetClick)),
          "data-variables": JSON.stringify(
            (props.variables || []).map((variable: DashboardVariable) => {
              return [variable.name, variable.selectedValue || null];
            }),
          ),
        });
      },
    };
  },
);

import DashboardViewer, {
  DASHBOARD_VIEW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import {
  DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID,
  DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID,
  DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID,
  DASHBOARD_TOOLBAR_SCREEN_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";
import PermissionGate from "../../../UI/Utils/PermissionGate";

// ---- the browser's own full screen, stood in for as a browser answers ------

interface FullScreenStandIn {
  requested: number;
  exited: number;
  refuse: boolean;
  // The browser leaving its full screen by itself: its own Escape.
  browserEscape: () => void;
  restore: () => void;
}

let fullScreenElement: Element | null = null;

function standInFullScreen(
  options: { refuse?: boolean } = {},
): FullScreenStandIn {
  const page: Record<string, unknown> = document as unknown as Record<
    string,
    unknown
  >;
  const root: Record<string, unknown> =
    document.documentElement as unknown as Record<string, unknown>;
  const state: FullScreenStandIn = {
    requested: 0,
    exited: 0,
    refuse: Boolean(options.refuse),
    browserEscape: () => {},
    restore: () => {},
  };

  fullScreenElement = null;

  Object.defineProperty(page, "fullscreenElement", {
    configurable: true,
    get: () => {
      return fullScreenElement;
    },
  });
  Object.defineProperty(page, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
  root["requestFullscreen"] = (): Promise<void> => {
    state.requested++;

    if (state.refuse) {
      return Promise.reject(new TypeError("Permissions check failed"));
    }

    fullScreenElement = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  page["exitFullscreen"] = (): Promise<void> => {
    state.exited++;
    fullScreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };

  state.browserEscape = (): void => {
    fullScreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  };

  state.restore = (): void => {
    fullScreenElement = null;
    delete page["fullscreenElement"];
    delete page["fullscreenEnabled"];
    delete page["exitFullscreen"];
    delete root["requestFullscreen"];
  };

  return state;
}

// ---- the app around the dashboard -------------------------------------------

/*
 * As the Dashboard draws it (src/Index.tsx, Components/MasterPage): its
 * root, the master page with its alerts, header and footer, the page's
 * <main> holding the app's own layers beside the routes, and the notes and
 * the new version's notice beside the app. The board is drawn where a
 * route draws it.
 */
function drawApp(): HTMLElement {
  document.body.innerHTML = `
    <div id="root">
      <div data-testid="master">
        <div data-testid="top-alert"><a href="#billing">Pay invoices</a></div>
        <div data-testid="master-page">
          <a data-testid="skip-link" href="#main-content">Skip to main content</a>
          <div data-testid="top-section"><header><a href="#home">Home</a></header><nav><a href="#monitors">Monitors</a></nav></div>
          <div data-testid="master-page-content">
            <main id="main-content">
              <div data-testid="ask-ai"><button type="button">Ask AI</button></div>
              <div data-testid="routes">
                <div data-testid="breadcrumbs"><a href="#dashboards">Dashboards</a></div>
                <nav data-testid="side-menu"><a href="#overview">Overview</a></nav>
                <div data-testid="column"><div data-testid="archived-banner"></div><div id="board-mount"></div></div>
              </div>
            </main>
            <footer data-testid="footer"><a href="#docs">Docs</a></footer>
          </div>
        </div>
      </div>
      <div data-testid="new-version-notice"></div>
      <div data-testid="toast-region"><button type="button">Close note</button></div>
    </div>
  `;

  return document.getElementById("board-mount")!;
}

const PAGE_AROUND: Array<string> = [
  "top-alert",
  "skip-link",
  "top-section",
  "footer",
  "breadcrumbs",
  "side-menu",
  "archived-banner",
];

const APP_LAYERS: Array<string> = [
  "ask-ai",
  "new-version-notice",
  "toast-region",
];

function inertOf(ids: Array<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};

  for (const id of ids) {
    out[id] = screen.getByTestId(id).hasAttribute("inert");
  }

  return out;
}

function allAre(ids: Array<string>, value: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};

  for (const id of ids) {
    out[id] = value;
  }

  return out;
}

// ---- the board ------------------------------------------------------------------

const SERVICE_VARIABLE: DashboardVariable = {
  id: "service-variable",
  name: "service",
  type: DashboardVariableType.CustomList,
  customListValues: "checkout,payments",
  selectedValue: "checkout",
};

function seed(options: { variables?: Array<DashboardVariable> } = {}): void {
  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  if (options.variables) {
    config.variables = options.variables;
  }

  serverState.dashboardViewConfig = JSON.parse(
    JSON.stringify(config),
  ) as JSONObject;
}

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

interface Harness {
  changes: Array<boolean>;
  newTabs: number;
  shares: number;
}

/*
 * The board as its page draws it: the page keeps whether it is full screen
 * (in its address, here in its state) and hears each change.
 */
async function renderBoard(
  options: {
    isFullScreen?: boolean;
    controlled?: boolean;
    isPlayback?: boolean;
  } = {},
): Promise<Harness> {
  const harness: Harness = { changes: [], newTabs: 0, shares: 0 };
  const mount: HTMLElement = drawApp();

  function Page(): ReactElement {
    const [isFullScreen, setIsFullScreen] = useState<boolean>(
      Boolean(options.isFullScreen),
    );

    return (
      <DashboardViewer
        dashboardId={new ObjectID(DASHBOARD_ID)}
        isPlayback={options.isPlayback}
        isFullScreen={options.controlled === false ? undefined : isFullScreen}
        onFullScreenChange={(next: boolean): void => {
          harness.changes.push(next);
          setIsFullScreen(next);
        }}
        onOpenInNewTab={(): void => {
          harness.newTabs++;
        }}
        onShareClick={(): void => {
          harness.shares++;
        }}
      />
    );
  }

  render(<Page />, { container: mount });

  await waitFor(() => {
    expect(
      options.isPlayback
        ? screen.getByTestId("canvas-stub")
        : screen.getByLabelText("More dashboard options"),
    ).toBeInTheDocument();
  });
  await settle();

  return harness;
}

function view(): HTMLElement {
  return screen.getByTestId(DASHBOARD_VIEW_TEST_ID);
}

function isShownFullScreen(): boolean {
  return view().getAttribute("data-full-screen") === "true";
}

function canvas(): HTMLElement {
  return screen.getByTestId("canvas-stub");
}

async function press(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
  await settle();
}

async function pressEscape(target?: Element | null | undefined): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(target || document.activeElement || document.body, {
      key: "Escape",
    });
  });
  await settle();
}

async function goFullScreen(): Promise<void> {
  await press(screen.getByTestId(DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID));
}

async function openMoreMenu(): Promise<void> {
  await press(screen.getByLabelText("More dashboard options"));
}

function menuItems(): Array<string> {
  return within(document.documentElement)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

async function chooseMenuItem(name: string): Promise<void> {
  await press(within(document.documentElement).getByRole("menuitem", { name }));
}

const restores: Array<() => void> = [];

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  resetPageScrollLockForTesting();
  document.body.style.removeProperty("overflow");
  window.history.replaceState({}, "", PAGE_PATH);
  seed();
  getItemMock.mockReset();
  updateByIdMock.mockReset();

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: JSON.parse(
        JSON.stringify(serverState.dashboardViewConfig),
      ),
      name: "Production overview",
      description: "Requests, latency and errors",
    });
  });

  updateByIdMock.mockImplementation((args: any) => {
    serverState.dashboardViewConfig = args.data
      .dashboardViewConfig as JSONObject;
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();

  while (restores.length > 0) {
    restores.pop()!();
  }

  jest.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.removeProperty("overflow");
  resetPageScrollLockForTesting();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

describe("going full screen", () => {
  test("the dashboard opens on its page, with Full Screen at the end of its toolbar, beside the ⋯ menu", async () => {
    await renderBoard();

    expect(isShownFullScreen()).toBe(false);
    expect(view().className).not.toContain("fixed");

    const screenBox: HTMLElement = screen.getByTestId(
      DASHBOARD_TOOLBAR_SCREEN_TEST_ID,
    );
    const fullScreenButton: HTMLElement = within(screenBox).getByTestId(
      DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID,
    );

    expect(fullScreenButton).toHaveAttribute("aria-label", "Full Screen");
    expect(fullScreenButton).toHaveAttribute("title", "Full Screen");
    expect(fullScreenButton.tagName).toBe("BUTTON");
    expect(fullScreenButton).toHaveAttribute("type", "button");
    expect(fullScreenButton.querySelector("svg")).not.toBeNull();
    // Full Screen first, then the ⋯ menu, last of the row.
    expect(
      within(screenBox).getByLabelText("More dashboard options"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the ⋯ menu offers Full Screen and Open in New Tab, after Edit Dashboard and Share", async () => {
    await renderBoard();
    await openMoreMenu();

    expect(menuItems()).toEqual([
      "Edit Dashboard",
      "Share",
      "Full Screen",
      "Open in New Tab",
    ]);

    for (const name of ["Full Screen", "Open in New Tab"]) {
      expect(
        within(document.documentElement)
          .getByRole("menuitem", { name })
          .querySelector("svg"),
      ).not.toBeNull();
    }
  });

  test("Full Screen shows the dashboard alone, over the whole window, and tells the page", async () => {
    const harness: Harness = await renderBoard();

    await goFullScreen();

    expect(harness.changes).toEqual([true]);
    expect(isShownFullScreen()).toBe(true);
    expect(view().className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "fixed",
        "inset-0",
        "z-40",
        "overflow-y-auto",
        "end-[var(--page-dock-width,0px)]",
      ]),
    );
    expect(view()).toHaveAttribute("role", "region");
    expect(view()).toHaveAttribute("aria-label", "Full-screen dashboard");
    // The same board: its toolbar and its widgets are inside the view.
    expect(view()).toContainElement(canvas());
    expect(view()).toContainElement(
      screen.getByLabelText("More dashboard options"),
    );
  });

  test("Full Screen from the ⋯ menu does the same", async () => {
    const harness: Harness = await renderBoard();
    await openMoreMenu();
    await chooseMenuItem("Full Screen");

    expect(harness.changes).toEqual([true]);
    expect(isShownFullScreen()).toBe(true);
  });

  test("full screen, the row ends with Exit Full Screen and its key, and the menu offers Exit Full Screen", async () => {
    await renderBoard();
    await goFullScreen();

    const exit: HTMLElement = screen.getByTestId(
      DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID,
    );

    expect(exit).toHaveTextContent("Exit Full Screen");
    expect(within(exit).getByText("Esc").tagName).toBe("KBD");
    // Its words go on a phone, read out still: a square round its icon there.
    expect(within(exit).getByText("Exit Full Screen").className).toContain(
      "max-sm:sr-only",
    );
    expect(
      screen.queryByTestId(DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();

    await openMoreMenu();

    expect(menuItems()).toEqual([
      "Edit Dashboard",
      "Share",
      "Exit Full Screen",
      "Open in New Tab",
    ]);
  });

  test("going full screen loses nothing and reads nothing again", async () => {
    await renderBoard();

    const canvasBefore: HTMLElement = canvas();
    const reads: number = getItemMock.mock.calls.length;

    await goFullScreen();

    // The very same board, never drawn again.
    expect(canvas()).toBe(canvasBefore);
    expect(getItemMock.mock.calls.length).toBe(reads);

    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(canvas()).toBe(canvasBefore);
    expect(getItemMock.mock.calls.length).toBe(reads);
  });

  test("whatever measures itself on a resize hears that its room changed, going in and coming out", async () => {
    await renderBoard();

    const resizes: Array<string> = [];
    const onResize: () => void = (): void => {
      resizes.push(isShownFullScreen() ? "full screen" : "page");
    };

    window.addEventListener("resize", onResize);

    try {
      await goFullScreen();
      await press(
        screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
      );
    } finally {
      window.removeEventListener("resize", onResize);
    }

    expect(resizes).toEqual(["full screen", "page"]);
  });

  test("a board that keeps full screen to itself (no page handing it in) still goes full screen and back", async () => {
    await renderBoard({ controlled: false });

    await goFullScreen();
    expect(isShownFullScreen()).toBe(true);

    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));
    expect(isShownFullScreen()).toBe(false);
  });
});

describe("coming back", () => {
  test("Exit Full Screen puts the dashboard back on its page, and tells the page", async () => {
    const harness: Harness = await renderBoard();

    await goFullScreen();
    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(harness.changes).toEqual([true, false]);
    expect(isShownFullScreen()).toBe(false);
    expect(view().className).toBe("min-h-screen");
    expect(view()).not.toHaveAttribute("role");
    expect(
      screen.getByTestId(DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("Exit Full Screen from the ⋯ menu does the same", async () => {
    const harness: Harness = await renderBoard();

    await goFullScreen();
    await openMoreMenu();
    await chooseMenuItem("Exit Full Screen");

    expect(harness.changes).toEqual([true, false]);
    expect(isShownFullScreen()).toBe(false);
  });

  test("Escape does the same", async () => {
    const harness: Harness = await renderBoard();

    await goFullScreen();
    await pressEscape();

    expect(harness.changes).toEqual([true, false]);
    expect(isShownFullScreen()).toBe(false);
  });

  test("Escape with nothing focused (the page's own key) does the same", async () => {
    await renderBoard();
    await goFullScreen();

    (document.activeElement as HTMLElement | null)?.blur();
    await pressEscape(document.body);

    expect(isShownFullScreen()).toBe(false);
  });

  test("on the dashboard's page, Escape does nothing", async () => {
    const harness: Harness = await renderBoard();

    await pressEscape();

    expect(harness.changes).toEqual([]);
    expect(isShownFullScreen()).toBe(false);
  });

  test("an open menu takes the first Escape; the next one leaves full screen", async () => {
    await renderBoard();
    await goFullScreen();
    await openMoreMenu();

    const item: HTMLElement = within(document.documentElement).getByRole(
      "menuitem",
      { name: "Edit Dashboard" },
    );

    await pressEscape(item);

    expect(within(document.documentElement).queryByRole("menu")).toBeNull();
    expect(isShownFullScreen()).toBe(true);

    await pressEscape();

    expect(isShownFullScreen()).toBe(false);
  });

  test("an open dialog takes the Escape: the time range picker closes, the dashboard stays full screen", async () => {
    await renderBoard();
    await goFullScreen();

    await press(screen.getByText("Past 1 Hour"));

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(view()).toContainElement(dialog);

    await pressEscape(dialog);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isShownFullScreen()).toBe(true);
  });

  test("an Escape typed in a text field is the field's", async () => {
    await renderBoard();
    await goFullScreen();

    const field: HTMLInputElement = document.createElement("input");
    view().appendChild(field);
    field.focus();

    await pressEscape(field);

    expect(isShownFullScreen()).toBe(true);
    field.remove();
  });

  test("an Escape another handler took is theirs", async () => {
    await renderBoard();
    await goFullScreen();

    const taker: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      event.preventDefault();
    };

    document.addEventListener("keydown", taker);

    try {
      await pressEscape();
    } finally {
      document.removeEventListener("keydown", taker);
    }

    expect(isShownFullScreen()).toBe(true);
  });

  test("Escape held down leaves once, and a chord with it is not the dashboard's", async () => {
    const harness: Harness = await renderBoard();
    await goFullScreen();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape", ctrlKey: true });
      fireEvent.keyDown(document.body, { key: "Escape", repeat: true });
    });
    await settle();

    expect(isShownFullScreen()).toBe(true);

    await pressEscape();

    expect(harness.changes).toEqual([true, false]);
  });
});

describe("the browser's own full screen", () => {
  test("Full Screen asks the browser for its full screen too, straight from the press", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    await renderBoard();
    await goFullScreen();

    expect(stand.requested).toBe(1);
    expect(fullScreenElement).toBe(document.documentElement);
    expect(isShownFullScreen()).toBe(true);
    // Already as full as it gets: nothing more to fill.
    expect(
      screen.queryByTestId(DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Exit Full Screen leaves the browser's full screen too", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    await renderBoard();
    await goFullScreen();
    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(stand.exited).toBe(1);
    expect(fullScreenElement).toBeNull();
    expect(isShownFullScreen()).toBe(false);
  });

  test("the browser's Escape, which leaves its full screen, leaves the dashboard's too: one press in, one Escape out", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    const harness: Harness = await renderBoard();
    await goFullScreen();

    await act(async () => {
      stand.browserEscape();
    });
    await settle();

    expect(harness.changes).toEqual([true, false]);
    expect(isShownFullScreen()).toBe(false);
    // The browser left it by itself: nothing to ask it.
    expect(stand.exited).toBe(0);
  });

  test("while the browser is full screen, the page's own Escape listener leaves it to the browser", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    const harness: Harness = await renderBoard();
    await goFullScreen();

    // A browser that also hands the page its Escape.
    await pressEscape();

    expect(harness.changes).toEqual([true]);
    expect(isShownFullScreen()).toBe(true);
  });

  test("refused, the dashboard is full screen in the window, and Fill the Screen offers the browser's again", async () => {
    const stand: FullScreenStandIn = standInFullScreen({ refuse: true });
    restores.push(stand.restore);

    await renderBoard();
    await goFullScreen();

    expect(stand.requested).toBe(1);
    expect(isShownFullScreen()).toBe(true);
    expect(
      screen.getByTestId(DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a browser without it: Full Screen fills the window, and no Fill the Screen is offered", async () => {
    await renderBoard();
    await goFullScreen();

    expect(isShownFullScreen()).toBe(true);
    expect(
      screen.queryByTestId(DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("opened full screen from its address, Fill the Screen asks the browser; its Escape then leaves only the browser's", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    const harness: Harness = await renderBoard({ isFullScreen: true });

    expect(isShownFullScreen()).toBe(true);
    // A new tab cannot be put in the browser's full screen by itself.
    expect(stand.requested).toBe(0);

    const fill: HTMLElement = screen.getByTestId(
      DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID,
    );

    expect(fill).toHaveAttribute("aria-label", "Fill the Screen");
    expect(fill).toHaveAttribute("title", "Fill the Screen");

    await press(fill);

    expect(stand.requested).toBe(1);
    expect(
      screen.queryByTestId(DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();

    await act(async () => {
      stand.browserEscape();
    });
    await settle();

    // Out of the browser's full screen, still the dashboard's.
    expect(harness.changes).toEqual([]);
    expect(isShownFullScreen()).toBe(true);
    expect(
      screen.getByTestId(DASHBOARD_FILL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();

    // And the next Escape leaves it.
    await pressEscape();

    expect(harness.changes).toEqual([false]);
    expect(isShownFullScreen()).toBe(false);
  });

  test("leaving the page while the browser is full screen leaves the browser's full screen too", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    await renderBoard();
    await goFullScreen();

    expect(fullScreenElement).toBe(document.documentElement);

    cleanup();

    expect(stand.exited).toBe(1);
    expect(fullScreenElement).toBeNull();
  });
});

describe("the page behind it", () => {
  test("is out of reach: its header, menus, breadcrumbs, banner and footer are inert, and wake when the dashboard comes back", async () => {
    await renderBoard();

    expect(inertOf(PAGE_AROUND)).toEqual(allAre(PAGE_AROUND, false));

    await goFullScreen();

    expect(inertOf(PAGE_AROUND)).toEqual(allAre(PAGE_AROUND, true));

    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(inertOf(PAGE_AROUND)).toEqual(allAre(PAGE_AROUND, false));
  });

  test("the app's own layers stay in reach: Ask AI and the dialogs beside the page, the notes and the new version's notice beside the app", async () => {
    await renderBoard();
    await goFullScreen();

    expect(inertOf(APP_LAYERS)).toEqual(allAre(APP_LAYERS, false));
    expect(document.getElementById("root")).not.toHaveAttribute("inert");
    // The dashboard itself, and its path, are never inert.
    expect(view()).not.toHaveAttribute("inert");
    expect(screen.getByTestId("column")).not.toHaveAttribute("inert");
    expect(document.getElementById("main-content")).not.toHaveAttribute(
      "inert",
    );
  });

  test("stays still while the dashboard scrolls by itself, and scrolls again once it is back", async () => {
    await renderBoard();

    expect(document.body.style.overflow).toBe("");

    await goFullScreen();

    expect(document.body.style.overflow).toBe("hidden");

    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(document.body.style.overflow).toBe("");
  });

  test("leaving the page while full screen hands the page back", async () => {
    await renderBoard();
    await goFullScreen();

    expect(document.body.style.overflow).toBe("hidden");

    cleanup();

    expect(document.body.style.overflow).toBe("");
  });
});

describe("the keyboard's focus", () => {
  test("Full Screen pressed: the focus goes to Exit Full Screen, the control that changes it back", async () => {
    await renderBoard();

    const fullScreenButton: HTMLElement = screen.getByTestId(
      DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID,
    );
    fullScreenButton.focus();

    await press(fullScreenButton);

    expect(document.activeElement).toBe(
      screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    );
  });

  test("Exit Full Screen pressed: the focus goes back to Full Screen", async () => {
    await renderBoard();
    await goFullScreen();

    const exit: HTMLElement = screen.getByTestId(
      DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID,
    );
    exit.focus();

    await press(exit);

    expect(document.activeElement).toBe(
      screen.getByTestId(DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID),
    );
  });

  test("opened full screen from its address, the focus starts on the dashboard, never on the page behind it", async () => {
    await renderBoard({ isFullScreen: true });

    expect(view()).toHaveAttribute("tabindex", "-1");
    expect(view().contains(document.activeElement)).toBe(true);
  });

  test("a focus already on the dashboard stays where it is", async () => {
    await renderBoard();

    const more: HTMLElement = screen.getByLabelText("More dashboard options");
    more.focus();

    await act(async () => {
      fireEvent.click(screen.getByTestId(DASHBOARD_FULL_SCREEN_BUTTON_TEST_ID));
    });
    await settle();

    expect(document.activeElement).toBe(more);
  });
});

describe("everything still works full screen", () => {
  test("editing: Edit Dashboard, Add Widget and Save Changes, with Exit Full Screen still there", async () => {
    await renderBoard();
    await goFullScreen();
    await openMoreMenu();
    await chooseMenuItem("Edit Dashboard");

    expect(isShownFullScreen()).toBe(true);
    expect(canvas()).toHaveAttribute("data-is-edit-mode", "true");
    expect(screen.getByText("Add Widget")).toBeInTheDocument();
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
    expect(
      screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();
    // The ⋯ menu is not drawn while editing, full screen or not.
    expect(screen.queryByLabelText("More dashboard options")).toBeNull();

    await press(screen.getByText("Save Changes"));

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(canvas()).toHaveAttribute("data-is-edit-mode", "false");
    expect(isShownFullScreen()).toBe(true);
  });

  test("adding a widget full screen: the catalog opens over the dashboard, and the widget is on the board", async () => {
    await renderBoard();
    await goFullScreen();
    await openMoreMenu();
    await chooseMenuItem("Edit Dashboard");

    expect(canvas()).toHaveAttribute("data-widgets", "1");

    await press(screen.getByText("Add Widget"));

    const catalog: HTMLElement = screen.getByRole("dialog");

    expect(view()).toContainElement(catalog);

    await press(within(catalog).getAllByRole("button", { name: /^Text/ })[0]!);

    expect(canvas()).toHaveAttribute("data-widgets", "2");
    expect(isShownFullScreen()).toBe(true);
  });

  test("the edit and its unsaved changes come along in and out of full screen, and nothing is read again", async () => {
    await renderBoard();
    await openMoreMenu();
    await chooseMenuItem("Edit Dashboard");
    await press(screen.getByText("Add Widget"));
    await press(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: /^Text/,
      })[0]!,
    );

    expect(canvas()).toHaveAttribute("data-widgets", "2");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    const reads: number = getItemMock.mock.calls.length;

    // Full Screen sits beside the editing actions while editing.
    await goFullScreen();

    expect(isShownFullScreen()).toBe(true);
    expect(canvas()).toHaveAttribute("data-is-edit-mode", "true");
    expect(canvas()).toHaveAttribute("data-widgets", "2");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await pressEscape(document.body);

    expect(isShownFullScreen()).toBe(false);
    expect(canvas()).toHaveAttribute("data-is-edit-mode", "true");
    expect(canvas()).toHaveAttribute("data-widgets", "2");
    expect(getItemMock.mock.calls.length).toBe(reads);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("Cancel full screen asks before it throws changes away, and the question opens over the dashboard", async () => {
    await renderBoard();
    await goFullScreen();
    await openMoreMenu();
    await chooseMenuItem("Edit Dashboard");
    await press(screen.getByText("Add Widget"));
    await press(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: /^Text/,
      })[0]!,
    );
    await press(screen.getByText("Cancel"));

    const question: HTMLElement = screen.getByRole("dialog");

    expect(question).toHaveTextContent("Discard unsaved changes?");
    expect(view()).toContainElement(question);

    // The dialog takes the Escape: the dashboard stays full screen, still editing.
    await pressEscape(question);

    expect(isShownFullScreen()).toBe(true);
    expect(canvas()).toHaveAttribute("data-is-edit-mode", "true");
  });

  test("the time range: its picker opens over the dashboard, and a pick moves every widget", async () => {
    await renderBoard();
    await goFullScreen();

    expect(canvas()).toHaveAttribute("data-range", "Past 1 Hour");

    await press(screen.getByText("Past 1 Hour"));

    const picker: HTMLElement = screen.getByRole("dialog");

    await press(within(picker).getByRole("radio", { name: "Past 1 Day" }));
    await press(within(picker).getByRole("button", { name: "Apply" }));

    expect(canvas()).toHaveAttribute("data-range", "Past 1 Day");
    expect(isShownFullScreen()).toBe(true);
    // The pick goes in the address, as it does on the page.
    expect(new URLSearchParams(window.location.search).get("range")).toBe("1d");
  });

  test("auto-refresh: picked full screen, the board refreshes on its interval", async () => {
    await renderBoard();
    await goFullScreen();

    const setIntervalSpy: jest.SpyInstance<any, any> = jest.spyOn(
      window,
      "setInterval",
    );

    await press(screen.getByTitle("Auto-refresh settings"));

    const choices: Array<HTMLElement> = within(
      screen.getByRole("menu", { name: "Auto-refresh settings" }),
    ).getAllByRole("menuitemradio");
    const everyFiveSeconds: RegExp = new RegExp("\\b5\\s*s");
    const fiveSeconds: HTMLElement = choices.find(
      (choice: HTMLElement): boolean => {
        return everyFiveSeconds.test(choice.textContent || "");
      },
    )!;

    await press(fiveSeconds);

    const refreshTimer: Array<any> | undefined = setIntervalSpy.mock.calls.find(
      (call: Array<any>): boolean => {
        return call[1] === 5000;
      },
    );

    expect(refreshTimer).toBeDefined();

    const before: number = Number(canvas().getAttribute("data-refresh-tick"));

    // The interval's time comes: every widget reads again.
    await act(async () => {
      (refreshTimer![0] as () => void)();
    });

    expect(Number(canvas().getAttribute("data-refresh-tick"))).toBe(before + 1);
    expect(isShownFullScreen()).toBe(true);
    // The pick goes in the address beside the view, as it does on the page.
    expect(new URLSearchParams(window.location.search).get("refresh")).toBe(
      "5s",
    );
  });

  test("variables: the toolbar's pickers are there full screen, and narrow the board", async () => {
    seed({ variables: [SERVICE_VARIABLE] });

    await renderBoard();
    await goFullScreen();

    expect(JSON.parse(canvas().getAttribute("data-variables") || "[]")).toEqual(
      [["service", "checkout"]],
    );
    expect(view()).toContainElement(screen.getByText("service"));
  });

  test("Share and Open in New Tab are the page's to do, from full screen too", async () => {
    const harness: Harness = await renderBoard();
    await goFullScreen();

    await openMoreMenu();
    await chooseMenuItem("Open in New Tab");

    expect(harness.newTabs).toBe(1);
    // Opening another tab leaves this one as it is.
    expect(isShownFullScreen()).toBe(true);

    await openMoreMenu();
    await chooseMenuItem("Share");

    expect(harness.shares).toBe(1);
  });
});

describe("who may do what", () => {
  test("a reader who may not edit is a reader full screen too: Edit Dashboard is locked, the board cannot be edited", async () => {
    permissionsForTest = [Permission.Viewer];

    await renderBoard();
    await goFullScreen();

    expect(isShownFullScreen()).toBe(true);

    await openMoreMenu();

    const edit: HTMLElement = within(document.documentElement).getByRole(
      "menuitem",
      { name: "Edit Dashboard" },
    );

    expect(edit).toHaveAttribute("aria-disabled", "true");

    await press(edit);

    expect(canvas()).toHaveAttribute("data-is-edit-mode", "false");
    expect(canvas()).toHaveAttribute("data-can-add-widget", "false");
    expect(screen.queryByText("Save Changes")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
    // Full screen is a way of looking at it: theirs as anyone's.
    expect(
      screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a playlist's turn is never full screen, whatever it is handed: the player is", async () => {
    await renderBoard({ isPlayback: true, isFullScreen: true });

    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByTestId(DASHBOARD_VIEW_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();
    expect(inertOf(PAGE_AROUND)).toEqual(allAre(PAGE_AROUND, false));
  });
});

describe("opened full screen from its address", () => {
  test("a new tab, a bookmark or a reload: the dashboard alone from the first frame, while it loads", async () => {
    let resolveRead: (value: unknown) => void = () => {};

    getItemMock.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        resolveRead = resolve;
      });
    });

    const mount: HTMLElement = drawApp();

    render(
      <DashboardViewer
        dashboardId={new ObjectID(DASHBOARD_ID)}
        isFullScreen={true}
        onFullScreenChange={() => {}}
      />,
      { container: mount },
    );

    // Loading: over the window already, the page behind out of reach.
    expect(isShownFullScreen()).toBe(true);
    expect(view()).toHaveAttribute("aria-label", "Full-screen dashboard");
    expect(inertOf(PAGE_AROUND)).toEqual(allAre(PAGE_AROUND, true));

    const loadingView: HTMLElement = view();

    await act(async () => {
      resolveRead({
        dashboardViewConfig: serverState.dashboardViewConfig,
        name: "Production overview",
        description: "",
      });
    });
    await settle();

    // Loaded in the same view: the board and its way back.
    expect(view()).toBe(loadingView);
    expect(view()).toContainElement(canvas());
    expect(
      screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a dashboard that could not be read says why, with the way back under it", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have access to this dashboard."),
      );
    });

    const changes: Array<boolean> = [];
    const mount: HTMLElement = drawApp();

    render(
      <DashboardViewer
        dashboardId={new ObjectID(DASHBOARD_ID)}
        isFullScreen={true}
        onFullScreenChange={(next: boolean) => {
          changes.push(next);
        }}
      />,
      { container: mount },
    );
    await settle();

    expect(isShownFullScreen()).toBe(true);
    expect(view()).toHaveTextContent(
      "You do not have access to this dashboard.",
    );

    await press(screen.getByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID));

    expect(changes).toEqual([false]);
  });

  test("on its page, a dashboard that could not be read says why as it always has", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have access to this dashboard."),
      );
    });

    const mount: HTMLElement = drawApp();

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />, {
      container: mount,
    });
    await settle();

    expect(
      screen.getByText("You do not have access to this dashboard."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(DASHBOARD_VIEW_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(DASHBOARD_EXIT_FULL_SCREEN_BUTTON_TEST_ID),
    ).toBeNull();
  });
});
