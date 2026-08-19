import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The flagship interaction of the command palette — press Cmd/Ctrl+K anywhere
 * on the dashboard and the palette appears — lives entirely in the
 * DashboardCommandPalette host: a document-level keydown listener plus a
 * GlobalEvents subscription. The App suite runs in plain node and can only
 * pin source patterns, so this suite actually mounts the host (real
 * CommandPalette underneath, portal and all) and fires the real events.
 *
 * Escape/close-key semantics inside the open palette are deliberately NOT
 * pinned here — they belong to the Common CommandPalette's own contract. This
 * suite owns only the host's chord, its politeness rules, the global toggle
 * event, and listener cleanup.
 */

const navigateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const getAllPermissionsMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the consts above are still in their temporal dead
 * zone when the factory body runs. Dereferencing them lazily, at call time,
 * is what works (same pattern as InvestigationPanel.test.tsx).
 */
jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, defaultValue?: string): string => {
          return defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (...args: Array<unknown>) => {
        return getAllPermissionsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (...args: Array<unknown>) => {
        return isMasterAdminMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

/*
 * The real catalog hook walks the full RouteMap through useTranslation; the
 * host only needs SOME catalog, so a single-page one keeps the suite about
 * the host's event wiring rather than the NavBar's contents.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems",
  () => {
    const useDashboardNavigationItemsStub: () => unknown = (): unknown => {
      /*
       * Route is loaded lazily for the same hoisting reason as the mock
       * functions above; requireActual keeps it the real class.
       */
      const RouteClass: typeof import("../../../Types/API/Route").default = (
        jest.requireActual("../../../Types/API/Route") as {
          default: typeof import("../../../Types/API/Route").default;
        }
      ).default;
      return {
        navItems: [
          {
            id: "home-nav-bar-item",
            title: "Home",
            icon: "Home",
            route: new RouteClass("/dashboard/abc123/home"),
          },
        ],
        moreMenuItems: [],
        rightElement: {
          id: "user-profile-nav-bar-item",
          title: "User Profile",
          description: "Your account",
          icon: "User",
          route: new RouteClass("/dashboard/user-profile/picture"),
        },
      };
    };

    // The App source consumes the hook as the module's default export.
    return {
      __esModule: true,
      default: useDashboardNavigationItemsStub,
      useDashboardNavigationItems: useDashboardNavigationItemsStub,
    };
  },
);

import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";

function palette(): HTMLElement | null {
  return screen.queryByTestId("command-palette");
}

/*
 * The chord is dispatched on document.body — where real key events land when
 * no input is focused — and bubbles up to the host's document-level listener.
 */
function pressChord(init: KeyboardEventInit): void {
  fireEvent.keyDown(document.body, init);
}

beforeEach(() => {
  /*
   * The open panel schedules an enter-transition frame (rAF + fallback
   * timer); fake timers keep those under act()'s control.
   */
  jest.useFakeTimers();
  getCurrentProjectIdMock.mockReturnValue(null);
  getAllPermissionsMock.mockReturnValue([]);
  isMasterAdminMock.mockReturnValue(false);
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  navigateMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  getAllPermissionsMock.mockReset();
  isMasterAdminMock.mockReset();
});

describe("DashboardCommandPalette Cmd/Ctrl+K chord", () => {
  test("Cmd+K on the document opens the palette", () => {
    render(<DashboardCommandPalette />);
    expect(palette()).toBeNull();

    pressChord({ key: "k", metaKey: true });

    expect(palette()).toBeInTheDocument();
  });

  test("the same chord closes an open palette", () => {
    render(<DashboardCommandPalette />);

    pressChord({ key: "k", metaKey: true });
    expect(palette()).toBeInTheDocument();

    pressChord({ key: "k", metaKey: true });
    expect(palette()).toBeNull();
  });

  test("Ctrl+K works exactly like Cmd+K (Windows/Linux)", () => {
    render(<DashboardCommandPalette />);

    pressChord({ key: "k", ctrlKey: true });
    expect(palette()).toBeInTheDocument();

    pressChord({ key: "k", ctrlKey: true });
    expect(palette()).toBeNull();
  });

  test("a chord another handler already claimed (defaultPrevented) is ignored", () => {
    render(<DashboardCommandPalette />);

    /*
     * A capture-phase window listener models "some earlier handler took this
     * chord": it runs before the host's document listener and claims the
     * event, exactly the situation defaultPrevented is checked for.
     */
    const claimChord: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      event.preventDefault();
    };
    window.addEventListener("keydown", claimChord, { capture: true });

    try {
      pressChord({ key: "k", metaKey: true });
      expect(palette()).toBeNull();
    } finally {
      window.removeEventListener("keydown", claimChord, { capture: true });
    }

    // And with the claimer gone the same chord opens the palette again.
    pressChord({ key: "k", metaKey: true });
    expect(palette()).toBeInTheDocument();
  });

  test("extra modifiers on the chord do not open the palette", () => {
    render(<DashboardCommandPalette />);

    pressChord({ key: "k", metaKey: true, shiftKey: true });
    pressChord({ key: "k", ctrlKey: true, altKey: true });
    pressChord({ key: "k" });

    expect(palette()).toBeNull();
  });
});

describe("DashboardCommandPalette global toggle event", () => {
  test("the COMMAND_PALETTE_TOGGLE event toggles the palette", () => {
    render(<DashboardCommandPalette />);
    expect(palette()).toBeNull();

    act((): void => {
      GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
    });
    expect(palette()).toBeInTheDocument();

    act((): void => {
      GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
    });
    expect(palette()).toBeNull();
  });
});

describe("DashboardCommandPalette listener cleanup", () => {
  test("unmounting removes every document keydown listener it added, same references", () => {
    const addSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      document,
      "addEventListener",
    );
    const removeSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      document,
      "removeEventListener",
    );

    try {
      const view: ReturnType<typeof render> = render(
        <DashboardCommandPalette />,
      );

      const addedKeydownListeners: Array<unknown> = addSpy.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "keydown";
        })
        .map((call: Array<unknown>): unknown => {
          return call[1];
        });

      // The host claims the chord at the document level while mounted.
      expect(addedKeydownListeners.length).toBeGreaterThanOrEqual(1);

      view.unmount();

      const removedKeydownListeners: Array<unknown> = removeSpy.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === "keydown";
        })
        .map((call: Array<unknown>): unknown => {
          return call[1];
        });

      /*
       * Every added listener must be removed with the SAME function
       * reference — an inline re-created arrow in the cleanup would leave
       * the original behind and stack a listener per mount.
       */
      for (const listener of addedKeydownListeners) {
        expect(removedKeydownListeners).toContain(listener);
      }

      // And a chord after unmount reaches nothing.
      pressChord({ key: "k", metaKey: true });
      expect(palette()).toBeNull();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});
