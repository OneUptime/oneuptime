import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import DashboardTheme, {
  DASHBOARD_THEME_ATTRIBUTE,
  DASHBOARD_THEME_COLORS,
  DASHBOARD_VISITOR_THEME_STORAGE_KEY,
  DashboardColorScheme,
  DashboardVisitorThemeChoice,
  UNKNOWN_DASHBOARD_THEME,
} from "../../../Types/Dashboard/DashboardTheme";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";
import { THEME_CHANGE_EVENT } from "../../../UI/Utils/Theme";
import DashboardThemeUtil, {
  DASHBOARD_THEME_CHANGE_EVENT,
  useDashboardTheme,
} from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import ThemeMenu, {
  THEME_MENU_BUTTON_TEST_ID,
  THEME_MENU_CHOICES,
  THEME_MENU_LABEL,
  THEME_MENU_TEST_ID,
  getThemeMenuChoiceTestId,
} from "../../../../App/FeatureSet/PublicDashboard/src/Components/ThemeMenu";
import LogoPlate, {
  LOGO_PLATE_ATTRIBUTE,
} from "../../../../App/FeatureSet/PublicDashboard/src/Components/LogoPlate";
import { LOGO_PLATE_ATTRIBUTE as STATUS_PAGE_LOGO_PLATE_ATTRIBUTE } from "../../../../App/FeatureSet/StatusPage/src/Components/Logo/LogoPlate";

/*
 * A public dashboard's theme in the visitor's browser
 * (App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme.ts): the
 * dashboard's theme applied to the document, a page that follows its
 * visitor's device as the device changes, the link's own ?theme=, the
 * visitor's own pick from the toolbar's theme menu - kept in their browser,
 * on every theme - and the menu itself.
 *
 * The device's preference is a fake prefers-color-scheme media query the
 * test flips, the way a visitor switching their laptop to dark mode does.
 * The util keeps state for the page's life, so each test of it starts a
 * fresh copy (freshUtil); the menu's tests use the app's own copy, set
 * through its public calls.
 */

const DARK_QUERY: string = "(prefers-color-scheme: dark)";

type MediaListener = (event: { matches: boolean }) => void;

class FakeMediaQueryList {
  public matches: boolean;
  public media: string;
  private listeners: Set<MediaListener> = new Set();

  public constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  public addEventListener(_type: string, listener: MediaListener): void {
    this.listeners.add(listener);
  }

  public removeEventListener(_type: string, listener: MediaListener): void {
    this.listeners.delete(listener);
  }

  // The device's setting changes while the page is open.
  public change(matches: boolean): void {
    this.matches = matches;

    for (const listener of Array.from(this.listeners)) {
      listener({ matches });
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

let device: FakeMediaQueryList = new FakeMediaQueryList(DARK_QUERY, false);

const installDevice: (prefersDark: boolean) => void = (
  prefersDark: boolean,
): void => {
  device = new FakeMediaQueryList(DARK_QUERY, prefersDark);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): FakeMediaQueryList => {
      return query === DARK_QUERY
        ? device
        : new FakeMediaQueryList(query, false);
    },
  });
};

// The page's address, as the visitor opened it.
const openAt: (search: string) => void = (search: string): void => {
  window.history.replaceState(null, "", `/public-dashboard/d1${search}`);
};

type UtilClass = typeof DashboardThemeUtil;

/*
 * A copy of the util with none of the state an earlier test left: the
 * dashboard's theme, the link's theme it read, the visitor's pick it holds,
 * and whether it follows the device yet.
 */
const freshUtil: () => UtilClass = (): UtilClass => {
  let util: UtilClass | null = null;

  jest.isolateModules(() => {
    util = (
      jest.requireActual(
        "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme",
      ) as { default: UtilClass }
    ).default;
  });

  return util!;
};

const root: () => HTMLElement = (): HTMLElement => {
  return document.documentElement;
};

const themeColor: () => string | null = (): string | null => {
  return (
    document
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute("content") || null
  );
};

const isDark: () => boolean = (): boolean => {
  return root().classList.contains("dark");
};

const kept: () => string | null = (): string | null => {
  return window.localStorage.getItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY);
};

// Listeners a test adds to window, removed after it.
let windowListeners: Array<
  [string, EventListenerOrEventListenerObject, unknown]
> = [];
const originalAddEventListener: typeof window.addEventListener =
  window.addEventListener.bind(window);

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("class");
  root().removeAttribute("data-theme");
  root().removeAttribute(DASHBOARD_THEME_ATTRIBUTE);
  root().style.removeProperty("color-scheme");
  document.head.innerHTML = '<meta name="theme-color" content="#f9fafb">';
  installDevice(false);
  openAt("");

  windowListeners = [];
  jest
    .spyOn(window, "addEventListener")
    .mockImplementation(
      (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: unknown,
      ): void => {
        windowListeners.push([type, listener, options]);
        originalAddEventListener(
          type,
          listener,
          options as boolean | AddEventListenerOptions,
        );
      },
    );
});

afterEach(() => {
  cleanup();

  for (const [type, listener, options] of windowListeners) {
    window.removeEventListener(
      type,
      listener,
      options as boolean | EventListenerOptions,
    );
  }

  jest.restoreAllMocks();
  window.localStorage.clear();
  openAt("");
});

describe("the dashboard's theme, as the app starts", () => {
  test("is what the server put on <html> for the first script", () => {
    root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, "dark");

    const util: UtilClass = freshUtil();

    expect(util.getDashboardTheme()).toBe(DashboardTheme.Dark);

    util.initialize();

    expect(isDark()).toBe(true);
    expect(root().dataset["theme"]).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
    expect(themeColor()).toBe(DASHBOARD_THEME_COLORS.dark);
  });

  test("is the light page when <html> says nothing, whatever the device", () => {
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.initialize();

    expect(util.getDashboardTheme()).toBe(DashboardTheme.Light);
    expect(isDark()).toBe(false);
    expect(themeColor()).toBe(DASHBOARD_THEME_COLORS.light);
  });

  test("a dashboard that follows the device starts on the device's scheme", () => {
    root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, "system");
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.initialize();

    expect(isDark()).toBe(true);
  });

  test("a pick kept from an earlier visit is drawn at once, on a dashboard of any theme", () => {
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "dark");
    root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, "light");

    const util: UtilClass = freshUtil();

    util.initialize();

    expect(util.getVisitorColorScheme()).toBe("dark");
    expect(util.getVisitorChoice()).toBe("dark");
    expect(isDark()).toBe(true);
  });
});

describe("the link's own theme", () => {
  test.each([
    ["?theme=dark", "light", true],
    ["?theme=Light", "dark", false],
    ["?var-env=prod&theme=dark", "system", true],
  ])(
    "%s on a %s dashboard: dark %s, whatever the visitor kept",
    (search: string, setting: string, expectedDark: boolean) => {
      openAt(search);
      root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, setting);
      window.localStorage.setItem(
        DASHBOARD_VISITOR_THEME_STORAGE_KEY,
        expectedDark ? "light" : "dark",
      );

      const util: UtilClass = freshUtil();

      util.initialize();

      expect(isDark()).toBe(expectedDark);
    },
  );

  test("is read once, as the link was opened: the app writing to the address later keeps it", () => {
    openAt("?theme=dark");

    const util: UtilClass = freshUtil();

    util.initialize();
    expect(util.getLinkTheme()).toBe("dark");

    // A picked variable, say, rewritten into the address without the theme.
    openAt("?var-env=prod");
    util.setDashboardTheme(DashboardTheme.Light);

    expect(util.getLinkTheme()).toBe("dark");
    expect(isDark()).toBe(true);
  });

  test("?theme=system follows the device while the page is open, over the visitor's pick", () => {
    openAt("?theme=system");
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "light");

    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);
    expect(isDark()).toBe(false);

    device.change(true);
    expect(isDark()).toBe(true);
  });

  test("?theme=dark does not change with the device", () => {
    openAt("?theme=dark");

    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.System);
    device.change(false);

    expect(isDark()).toBe(true);
  });

  test("offers the visitor no pick, and a pick asked for anyway changes and keeps nothing", () => {
    openAt("?theme=light");

    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Dark);

    expect(util.isVisitorChoiceOffered()).toBe(false);
    expect(util.setVisitorChoice("dark")).toBe("light");
    expect(isDark()).toBe(false);
    expect(kept()).toBeNull();
  });

  test.each(["", "?theme=", "?theme=auto", "?theme=sepia", "?var-theme=dark"])(
    "an address with %p names none, and the visitor may pick",
    (search: string) => {
      openAt(search);

      const util: UtilClass = freshUtil();

      expect(util.getLinkTheme()).toBeNull();
      expect(util.isVisitorChoiceOffered()).toBe(true);
    },
  );
});

describe("the dashboard's own theme, once its metadata is read", () => {
  test("wins over what <html> was sent with: a dashboard sent light is drawn dark", () => {
    root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, "light");

    const util: UtilClass = freshUtil();

    util.initialize();
    expect(isDark()).toBe(false);

    util.setDashboardTheme(DashboardTheme.Dark);

    expect(util.getDashboardTheme()).toBe(DashboardTheme.Dark);
    expect(isDark()).toBe(true);
    expect(root().getAttribute(DASHBOARD_THEME_ATTRIBUTE)).toBe("dark");
  });

  test.each([
    [DashboardTheme.Light, "light"],
    [DashboardTheme.Dark, "dark"],
    [DashboardTheme.System, "system"],
  ])(
    "%s is written back on <html> as %s",
    (theme: DashboardTheme, setting: string) => {
      const util: UtilClass = freshUtil();

      util.setDashboardTheme(theme);

      expect(root().getAttribute(DASHBOARD_THEME_ATTRIBUTE)).toBe(setting);
    },
  );

  test("tells useTheme and the app's own listeners", () => {
    const util: UtilClass = freshUtil();
    const themeChanges: Array<unknown> = [];
    const settingChanges: Array<unknown> = [];

    window.addEventListener(THEME_CHANGE_EVENT, (event: Event) => {
      themeChanges.push((event as CustomEvent).detail);
    });
    window.addEventListener(DASHBOARD_THEME_CHANGE_EVENT, (event: Event) => {
      settingChanges.push((event as CustomEvent).detail);
    });

    util.setDashboardTheme(DashboardTheme.Dark);

    expect(themeChanges).toContainEqual({ theme: "dark" });
    expect(settingChanges).toEqual([
      { theme: DashboardTheme.Dark, visitorChoice: "auto" },
    ]);
  });

  test.each([
    [DashboardTheme.Light, false, false],
    [DashboardTheme.Light, true, false],
    [DashboardTheme.Dark, false, true],
    [DashboardTheme.Dark, true, true],
    [DashboardTheme.System, false, false],
    [DashboardTheme.System, true, true],
  ])(
    "%s on a device that prefers dark: %s - the page is dark: %s",
    (theme: DashboardTheme, prefersDark: boolean, expectedDark: boolean) => {
      installDevice(prefersDark);

      const util: UtilClass = freshUtil();

      util.setDashboardTheme(theme);

      expect(isDark()).toBe(expectedDark);
      expect(themeColor()).toBe(
        expectedDark
          ? DASHBOARD_THEME_COLORS.dark
          : DASHBOARD_THEME_COLORS.light,
      );
    },
  );

  test("a page that shows no dashboard - not found, Access Denied - follows the visitor's device", () => {
    root().setAttribute(DASHBOARD_THEME_ATTRIBUTE, "dark");
    installDevice(false);

    const util: UtilClass = freshUtil();

    util.initialize();
    expect(isDark()).toBe(true);

    util.setDashboardTheme(UNKNOWN_DASHBOARD_THEME);

    expect(isDark()).toBe(false);
    device.change(true);
    expect(isDark()).toBe(true);
  });
});

describe("a dashboard that follows the visitor's device, while it is open", () => {
  test("turns dark when the device does, and light again", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.System);
    expect(isDark()).toBe(false);

    device.change(true);
    expect(isDark()).toBe(true);
    expect(themeColor()).toBe(DASHBOARD_THEME_COLORS.dark);

    device.change(false);
    expect(isDark()).toBe(false);
    expect(themeColor()).toBe(DASHBOARD_THEME_COLORS.light);
  });

  test("listens once, however often the metadata is read again", () => {
    const util: UtilClass = freshUtil();

    util.initialize();
    util.setDashboardTheme(DashboardTheme.System);
    util.setDashboardTheme(DashboardTheme.System);

    expect(device.listenerCount()).toBe(1);
  });

  test("a Light or Dark dashboard does not change with the device", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);
    device.change(true);
    expect(isDark()).toBe(false);

    util.setDashboardTheme(DashboardTheme.Dark);
    device.change(false);
    expect(isDark()).toBe(true);
  });

  test("follows a pick the visitor made in another tab, and its undoing", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);
    expect(isDark()).toBe(false);

    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DASHBOARD_VISITOR_THEME_STORAGE_KEY,
        newValue: "dark",
      }),
    );

    expect(isDark()).toBe(true);
    expect(util.getVisitorChoice()).toBe("dark");

    // Auto, in the other tab: the key is gone.
    window.localStorage.removeItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DASHBOARD_VISITOR_THEME_STORAGE_KEY,
        newValue: null,
      }),
    );

    expect(isDark()).toBe(false);
    expect(util.getVisitorChoice()).toBe("auto");
  });

  test("storage cleared in another tab is the dashboard's own theme again", () => {
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "dark");

    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);
    expect(isDark()).toBe(true);

    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));

    expect(isDark()).toBe(false);
  });

  test("a change to another key leaves the page as it is", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "oneuptime-status-page-theme",
        newValue: "dark",
      }),
    );

    expect(isDark()).toBe(false);
  });
});

describe("the visitor's own pick, from the toolbar", () => {
  test("Dark turns a Light dashboard dark, is kept, and the device does not undo it", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);

    expect(util.setVisitorChoice("dark")).toBe("dark");
    expect(isDark()).toBe(true);
    expect(kept()).toBe("dark");
    expect(util.getVisitorChoice()).toBe("dark");

    device.change(false);
    expect(isDark()).toBe(true);
  });

  test("Light turns a Dark dashboard light, and is kept", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Dark);

    expect(util.setVisitorChoice("light")).toBe("light");
    expect(isDark()).toBe(false);
    expect(kept()).toBe("light");
  });

  test("Light is kept as light even when it is what the device already shows: the device turning dark keeps it light", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.System);
    util.setVisitorChoice("light");

    expect(kept()).toBe("light");

    device.change(true);
    expect(isDark()).toBe(false);
  });

  test("Auto forgets the pick: the dashboard's own theme decides again, and follows the device", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.System);
    util.setVisitorChoice("dark");
    expect(isDark()).toBe(true);

    expect(util.setVisitorChoice("auto")).toBe("light");
    expect(kept()).toBeNull();
    expect(util.getVisitorChoice()).toBe("auto");
    expect(isDark()).toBe(false);

    device.change(true);
    expect(isDark()).toBe(true);
  });

  test.each([
    [DashboardTheme.Light, false],
    [DashboardTheme.Dark, true],
  ])(
    "Auto on a %s dashboard is that dashboard's look",
    (theme: DashboardTheme, expectedDark: boolean) => {
      installDevice(!expectedDark);

      const util: UtilClass = freshUtil();

      util.setDashboardTheme(theme);
      util.setVisitorChoice(expectedDark ? "light" : "dark");
      util.setVisitorChoice("auto");

      expect(isDark()).toBe(expectedDark);
    },
  );

  test("is told to the app's listeners, with the pick", () => {
    const util: UtilClass = freshUtil();
    const changes: Array<unknown> = [];

    util.setDashboardTheme(DashboardTheme.Light);

    window.addEventListener(DASHBOARD_THEME_CHANGE_EVENT, (event: Event) => {
      changes.push((event as CustomEvent).detail);
    });

    util.setVisitorChoice("dark");
    util.setVisitorChoice("auto");

    expect(changes).toEqual([
      { theme: DashboardTheme.Light, visitorChoice: "dark" },
      { theme: DashboardTheme.Light, visitorChoice: "auto" },
    ]);
  });

  test("a kept value that is not light or dark is no pick at all", () => {
    window.localStorage.setItem(DASHBOARD_VISITOR_THEME_STORAGE_KEY, "auto");

    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Dark);

    expect(util.getVisitorChoice()).toBe("auto");
    expect(isDark()).toBe(true);
  });

  test("with storage blocked, the pick still holds for as long as the page is open", () => {
    const util: UtilClass = freshUtil();

    util.setDashboardTheme(DashboardTheme.Light);

    const storage: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(window, "localStorage");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: (): never => {
        throw new Error("Storage is blocked");
      },
    });

    try {
      expect(util.getVisitorColorScheme()).toBeNull();
      expect(util.setVisitorChoice("dark")).toBe("dark");
      expect(isDark()).toBe(true);
      expect(util.getVisitorChoice()).toBe("dark");

      expect(util.setVisitorChoice("auto")).toBe("light");
      expect(isDark()).toBe(false);
    } finally {
      // jsdom's own storage back for the next test.
      Object.defineProperty(window, "localStorage", storage!);
    }
  });
});

describe("the toolbar's theme menu", () => {
  const svgOf: (element: HTMLElement) => string = (
    element: HTMLElement,
  ): string => {
    return element.querySelector("svg")?.innerHTML || "";
  };

  // What an icon draws, to tell the trigger's sun from its moon.
  const drawingOf: (icon: IconProp) => string = (icon: IconProp): string => {
    const { container } = render(<Icon icon={icon} />);
    const drawing: string = container.querySelector("svg")?.innerHTML || "";

    cleanup();

    return drawing;
  };

  const openMenu: () => void = (): void => {
    act(() => {
      fireEvent.click(screen.getByTestId(THEME_MENU_BUTTON_TEST_ID));
    });
  };

  const choose: (choice: DashboardVisitorThemeChoice) => void = (
    choice: DashboardVisitorThemeChoice,
  ): void => {
    openMenu();

    act(() => {
      fireEvent.click(screen.getByTestId(getThemeMenuChoiceTestId(choice)));
    });
  };

  const menu: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId(THEME_MENU_TEST_ID);
  };

  beforeEach(() => {
    act(() => {
      DashboardThemeUtil.setVisitorChoice("auto");
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.Light);
    });
  });

  afterEach(() => {
    act(() => {
      DashboardThemeUtil.setVisitorChoice("auto");
    });
  });

  test("is a button named Theme, showing a sun on the light page and a moon on the dark one", () => {
    const sun: string = drawingOf(IconProp.Sun);
    const moon: string = drawingOf(IconProp.Moon);

    render(<ThemeMenu />);

    const button: HTMLElement = screen.getByTestId(THEME_MENU_BUTTON_TEST_ID);

    expect(button).toHaveAccessibleName(THEME_MENU_LABEL);
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(svgOf(button)).toBe(sun);
    expect(menu()).toHaveAttribute("data-color-scheme", "light");

    act(() => {
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.Dark);
    });

    expect(svgOf(screen.getByTestId(THEME_MENU_BUTTON_TEST_ID))).toBe(moon);
    expect(menu()).toHaveAttribute("data-color-scheme", "dark");
  });

  test("offers Light, Dark and Auto, in that order, as one choice with Auto ticked when the visitor picked nothing", () => {
    render(<ThemeMenu />);
    openMenu();

    const items: Array<HTMLElement> = screen.getAllByRole("menuitemradio");

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(["Light", "Dark", "Auto"]);
    expect(
      THEME_MENU_CHOICES.map((choice: { title: string }): string => {
        return choice.title;
      }),
    ).toEqual(["Light", "Dark", "Auto"]);
    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("aria-checked");
      }),
    ).toEqual(["false", "false", "true"]);
    expect(menu()).toHaveAttribute("data-visitor-choice", "auto");

    // The tick is drawn on the choice in use only; the others keep its space.
    const tick: string = svgOf(
      screen.getByTestId(getThemeMenuChoiceTestId("auto")),
    );

    expect(tick).not.toBe("");
    expect(
      screen
        .getByTestId(getThemeMenuChoiceTestId("light"))
        .querySelector("svg"),
    ).toBeNull();
  });

  test.each([
    ["dark", true],
    ["light", false],
  ])(
    "picking %s draws the page so, keeps it and ticks it",
    (choice: string, expectedDark: boolean) => {
      act(() => {
        DashboardThemeUtil.setDashboardTheme(
          expectedDark ? DashboardTheme.Light : DashboardTheme.Dark,
        );
      });

      render(<ThemeMenu />);
      choose(choice as DashboardVisitorThemeChoice);

      expect(isDark()).toBe(expectedDark);
      expect(kept()).toBe(choice);
      expect(menu()).toHaveAttribute("data-visitor-choice", choice);
      expect(menu()).toHaveAttribute(
        "data-color-scheme",
        expectedDark ? "dark" : "light",
      );

      openMenu();

      expect(
        within(screen.getByRole("menu")).getByRole("menuitemradio", {
          checked: true,
        }),
      ).toHaveTextContent(choice === "dark" ? "Dark" : "Light");
    },
  );

  test("Auto takes the page back to the dashboard's own theme and forgets the pick", () => {
    act(() => {
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.Dark);
    });

    render(<ThemeMenu />);
    choose("light");
    expect(isDark()).toBe(false);

    choose("auto");

    expect(isDark()).toBe(true);
    expect(kept()).toBeNull();
    expect(menu()).toHaveAttribute("data-visitor-choice", "auto");
  });

  test("keeps in step with a pick made anywhere else - another tab's reaches the util as a storage event (above)", () => {
    render(<ThemeMenu />);

    act(() => {
      DashboardThemeUtil.setVisitorChoice("dark");
    });

    expect(menu()).toHaveAttribute("data-visitor-choice", "dark");
    expect(menu()).toHaveAttribute("data-color-scheme", "dark");

    act(() => {
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.System);
      DashboardThemeUtil.setVisitorChoice("auto");
    });

    expect(menu()).toHaveAttribute("data-visitor-choice", "auto");
    expect(menu()).toHaveAttribute("data-color-scheme", "light");
  });

  test("is not drawn when the link names its own theme", () => {
    jest
      .spyOn(DashboardThemeUtil, "isVisitorChoiceOffered")
      .mockReturnValue(false);

    render(<ThemeMenu />);

    expect(screen.queryByTestId(THEME_MENU_TEST_ID)).toBeNull();
    expect(screen.queryByRole("button", { name: THEME_MENU_LABEL })).toBeNull();
  });
});

describe("useDashboardTheme", () => {
  const Probe: React.FunctionComponent = (): React.ReactElement => {
    const state: {
      theme: DashboardTheme;
      colorScheme: DashboardColorScheme;
      visitorChoice: DashboardVisitorThemeChoice;
      isVisitorChoiceOffered: boolean;
    } = useDashboardTheme();

    return (
      <output data-testid="probe">
        {`${state.theme}|${state.colorScheme}|${state.visitorChoice}|${state.isVisitorChoiceOffered}`}
      </output>
    );
  };

  afterEach(() => {
    act(() => {
      DashboardThemeUtil.setVisitorChoice("auto");
    });
  });

  test("reads the dashboard's theme, the scheme drawn and the pick, and keeps up with each", () => {
    act(() => {
      DashboardThemeUtil.setVisitorChoice("auto");
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.System);
    });

    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent(
      "System|light|auto|true",
    );

    act(() => {
      device.change(true);
    });

    act(() => {
      DashboardThemeUtil.setVisitorChoice("light");
    });

    expect(screen.getByTestId("probe")).toHaveTextContent(
      "System|light|light|true",
    );

    act(() => {
      DashboardThemeUtil.setDashboardTheme(DashboardTheme.Dark);
    });

    expect(screen.getByTestId("probe")).toHaveTextContent(
      "Dark|light|light|true",
    );
  });
});

describe("the logo's backdrop", () => {
  test("is offered whatever the dashboard's theme - any visitor can turn it dark - with the status page's attribute, which Theme.css draws only on the dark page", () => {
    for (const theme of [
      DashboardTheme.Light,
      DashboardTheme.Dark,
      DashboardTheme.System,
    ]) {
      act(() => {
        DashboardThemeUtil.setDashboardTheme(theme);
      });

      const { container } = render(
        <LogoPlate className="flex-shrink-0">
          <img alt="Acme" src="/logo.svg" />
        </LogoPlate>,
      );

      const plate: HTMLElement = container.firstElementChild as HTMLElement;

      expect([theme, plate.hasAttribute(LOGO_PLATE_ATTRIBUTE)]).toEqual([
        theme,
        true,
      ]);
      expect(plate).toHaveClass("flex-shrink-0");
      expect(plate.querySelector("img")).toHaveAttribute("alt", "Acme");
      cleanup();
    }

    expect(LOGO_PLATE_ATTRIBUTE).toBe(STATUS_PAGE_LOGO_PLATE_ATTRIBUTE);
  });
});
