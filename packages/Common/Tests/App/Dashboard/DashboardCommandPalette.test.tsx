import {
  afterEach,
  beforeAll,
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
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import DashboardCommandPalette from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";

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
 * suite owns the host's chord, its politeness rules, the global toggle event,
 * listener cleanup, and searching the real dashboard navigation catalog.
 */

const navigateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const getAllPermissionsMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();
let navigationTranslations: Record<string, string> = {};

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
          return navigationTranslations[key] ?? defaultValue ?? key;
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
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
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

function palette(): HTMLElement | null {
  return screen.queryByTestId("command-palette");
}

function productsMenu(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Products menu" });
}

function renderDashboardChrome(): void {
  render(
    <>
      <DashboardNavbar show={true} />
      <DashboardCommandPalette />
    </>,
  );
}

/*
 * The chord is dispatched on document.body — where real key events land when
 * no input is focused — and bubbles up to the host's document-level listener.
 */
function pressChord(init: KeyboardEventInit): void {
  fireEvent.keyDown(document.body, init);
}

beforeAll(() => {
  // The products menu keeps its keyboard selection in view when it opens.
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  /*
   * The open panel schedules an enter-transition frame (rAF + fallback
   * timer); fake timers keep those under act()'s control.
   */
  jest.useFakeTimers();
  window.localStorage.clear();
  navigationTranslations = {
    "navbar.items.rumTitle": "Real User Monitoring",
    "navbar.items.kubernetesTitle": "Kubernetes",
    "navbar.items.servicesTitle": "Services",
  };
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

describe("DashboardCommandPalette navigation keyword search", () => {
  test.each([
    ["RUM", "Real User Monitoring", "rum"],
    ["  rUm  ", "Real User Monitoring", "rum"],
    ["web vitals", "Real User Monitoring", "rum"],
    ["session replay", "Real User Monitoring", "rum"],
    ["k8s", "Kubernetes", "kubernetes"],
    ["  K8S  ", "Kubernetes", "kubernetes"],
    ["pods", "Kubernetes", "kubernetes"],
    ["apm", "Services", "service"],
    ["error budgets", "SLOs", "slos"],
    ["siem", "Security Events", "security-events"],
  ])(
    "%s finds %s and navigates to the selected project's page",
    (query: string, title: string, path: string) => {
      getCurrentProjectIdMock.mockReturnValue(new ObjectID("project-a"));
      render(<DashboardCommandPalette />);
      pressChord({ key: "k", metaKey: true });

      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: query },
      });

      const option: HTMLElement = screen.getByTestId(
        `command-palette-option-nav-dashboard-projectid-${path}`,
      );
      expect(option).toHaveTextContent(title);
      fireEvent.click(option);

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith(
        new Route(`/dashboard/project-a/${path}`),
      );
      expect(palette()).not.toBeInTheDocument();
    },
  );

  test("Enter opens the Kubernetes keyword result", () => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID("project-a"));
    render(<DashboardCommandPalette />);
    pressChord({ key: "k", ctrlKey: true });
    const input: HTMLElement = screen.getByTestId("command-palette-input");

    fireEvent.change(input, { target: { value: "k8s" } });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Kubernetes");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith(
      new Route("/dashboard/project-a/kubernetes"),
    );
    expect(palette()).not.toBeInTheDocument();
  });

  test.each([
    ["RUM", "rum"],
    ["k8s", "kubernetes"],
  ])(
    "%s keeps using the current project's route after a project switch",
    (query: string, path: string) => {
      getCurrentProjectIdMock.mockReturnValue(new ObjectID("project-a"));
      const view: ReturnType<typeof render> = render(
        <DashboardCommandPalette />,
      );
      pressChord({ key: "k", metaKey: true });
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: query },
      });
      expect(
        screen.getByTestId(
          `command-palette-option-nav-dashboard-projectid-${path}`,
        ),
      ).toBeInTheDocument();

      getCurrentProjectIdMock.mockReturnValue(new ObjectID("project-b"));
      view.rerender(<DashboardCommandPalette />);
      fireEvent.click(
        screen.getByTestId(
          `command-palette-option-nav-dashboard-projectid-${path}`,
        ),
      );

      expect(navigateMock).toHaveBeenCalledWith(
        new Route(`/dashboard/project-b/${path}`),
      );
    },
  );

  test.each([
    ["RUM", "rum", "navbar.items.rumTitle", "Surveillance des utilisateurs"],
    ["k8s", "kubernetes", "navbar.items.kubernetesTitle", "Orchestration"],
  ])(
    "%s still finds the page after its title is translated",
    (query: string, path: string, translationKey: string, title: string) => {
      getCurrentProjectIdMock.mockReturnValue(new ObjectID("project-a"));
      const view: ReturnType<typeof render> = render(
        <DashboardCommandPalette />,
      );
      pressChord({ key: "k", metaKey: true });
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: query },
      });

      navigationTranslations[translationKey] = title;
      view.rerender(<DashboardCommandPalette />);

      const option: HTMLElement = screen.getByTestId(
        `command-palette-option-nav-dashboard-projectid-${path}`,
      );
      expect(option).toHaveTextContent(title);
      fireEvent.click(option);
      expect(navigateMock).toHaveBeenCalledWith(
        new Route(`/dashboard/project-a/${path}`),
      );
    },
  );

  test.each(["RUM", "k8s"])(
    "%s does not expose project routes when no project is selected",
    (query: string) => {
      render(<DashboardCommandPalette />);
      pressChord({ key: "k", metaKey: true });
      fireEvent.change(screen.getByTestId("command-palette-input"), {
        target: { value: query },
      });

      expect(
        screen.queryByTestId(
          "command-palette-option-nav-dashboard-projectid-rum",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(
          "command-palette-option-nav-dashboard-projectid-kubernetes",
        ),
      ).not.toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );
});

describe("dashboard Cmd/Ctrl+K ownership with the products menu mounted", () => {
  test.each([
    ["Cmd+K", { key: "k", metaKey: true }],
    ["Ctrl+K", { key: "k", ctrlKey: true }],
  ] as Array<[string, KeyboardEventInit]>)(
    "%s opens Search only",
    (_label: string, chord: KeyboardEventInit) => {
      renderDashboardChrome();

      pressChord(chord);

      expect(palette()).toBeInTheDocument();
      expect(productsMenu()).not.toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    },
  );

  test("the Products button still opens Products without advertising Cmd/Ctrl+K", () => {
    renderDashboardChrome();

    fireEvent.click(screen.getByRole("button", { name: /Products/i }));

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Products menu",
    });
    expect(palette()).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    /*
     * The dashboard surrendered this chord to Search, so Products must not
     * leave either the visible keycaps or their screen-reader label behind.
     */
    const commandKKeycaps: HTMLElement[] = Array.from(
      dialog.querySelectorAll<HTMLElement>("kbd"),
    ).filter((keycap: HTMLElement): boolean => {
      return keycap.textContent === "K";
    });
    expect(commandKKeycaps).toHaveLength(0);
    expect(dialog).not.toHaveTextContent(/(?:Command|Control) \+ K/);
  });

  test.each([
    ["Cmd+K", { key: "k", metaKey: true }],
    ["Ctrl+K", { key: "k", ctrlKey: true }],
  ] as Array<[string, KeyboardEventInit]>)(
    "%s replaces an open Products dialog with one Search dialog",
    (_label: string, chord: KeyboardEventInit) => {
      renderDashboardChrome();
      fireEvent.click(screen.getByRole("button", { name: /Products/i }));

      const productsDialog: HTMLElement = screen.getByRole("dialog", {
        name: "Products menu",
      });
      const productsSearch: HTMLElement = screen.getByRole("combobox", {
        name: "navbar.search.placeholder",
      });
      expect(productsDialog).toBeInTheDocument();
      expect(document.activeElement).toBe(productsSearch);

      // Real keystrokes originate in the focused Products search input.
      fireEvent.keyDown(productsSearch, chord);

      expect(productsMenu()).not.toBeInTheDocument();
      expect(palette()).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    },
  );
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
