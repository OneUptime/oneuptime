import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import StatusPageTheme, {
  STATUS_PAGE_THEME_ATTRIBUTE,
  STATUS_PAGE_THEME_COLORS,
  STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
} from "../../../Types/StatusPage/StatusPageTheme";
import { THEME_CHANGE_EVENT } from "../../../UI/Utils/Theme";
import File from "../../../Models/DatabaseModels/File";
import MimeType from "../../../Types/File/MimeType";
import StatusPageThemeUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageTheme";
import ThemeSwitch, {
  THEME_SWITCH_CLASS_NAME,
  THEME_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Components/ThemeSwitch/ThemeSwitch";
import LogoPlate, {
  LOGO_PLATE_ATTRIBUTE,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Logo/LogoPlate";
import StatusPageFooter, {
  FOOTER_VISITOR_CONTROLS_CLASS_NAME,
  FOOTER_VISITOR_CONTROLS_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Components/Footer/Footer";
import StatusPageHeader from "../../../../App/FeatureSet/StatusPage/src/Components/Header/Header";
import englishLocale from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

/*
 * A status page's theme in the visitor's browser
 * (App/FeatureSet/StatusPage/src/Utils/StatusPageTheme.ts): the page's
 * setting applied to the document, a System page following its visitor's
 * device as it changes, the visitor's own pick from the footer, and the
 * pieces that only a page following the device draws - the footer's switch
 * and the light backdrop behind the logo on the dark page.
 *
 * The device's preference is a fake prefers-color-scheme media query the
 * test flips, the way a visitor switching their phone to dark mode does.
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

type UtilClass = typeof StatusPageThemeUtil;

/*
 * A copy of the util with none of the state an earlier test left: its
 * page theme, and whether it follows the device yet.
 */
const freshUtil: () => UtilClass = (): UtilClass => {
  let util: UtilClass | null = null;

  jest.isolateModules(() => {
    util = (
      jest.requireActual(
        "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageTheme",
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

// Listeners a test adds to window, removed after it.
let windowListeners: Array<
  [string, EventListenerOrEventListenerObject, unknown]
> = [];
const originalAddEventListener: typeof window.addEventListener =
  window.addEventListener.bind(window);

const translation: i18n = createInstance();

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  root().removeAttribute("class");
  root().removeAttribute("data-theme");
  root().removeAttribute(STATUS_PAGE_THEME_ATTRIBUTE);
  root().style.removeProperty("color-scheme");
  document.head.innerHTML = '<meta name="theme-color" content="#f9fafb">';
  installDevice(false);

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
});

describe("the page's theme, as the app starts", () => {
  test("is what the server put on <html> for the first script", () => {
    root().setAttribute(STATUS_PAGE_THEME_ATTRIBUTE, "dark");

    const util: UtilClass = freshUtil();

    expect(util.getPageTheme()).toBe(StatusPageTheme.Dark);

    util.initialize();

    expect(isDark()).toBe(true);
    expect(root().dataset["theme"]).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
    expect(themeColor()).toBe(STATUS_PAGE_THEME_COLORS.dark);
  });

  test("is the light page when <html> says nothing, whatever the device", () => {
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.initialize();

    expect(util.getPageTheme()).toBe(StatusPageTheme.Light);
    expect(isDark()).toBe(false);
    expect(themeColor()).toBe(STATUS_PAGE_THEME_COLORS.light);
  });

  test("a System page starts on the device's scheme", () => {
    root().setAttribute(STATUS_PAGE_THEME_ATTRIBUTE, "system");
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.initialize();

    expect(isDark()).toBe(true);
  });
});

describe("the page's own settings, once the master page is read", () => {
  test("win over what <html> was sent with: a page sent light is drawn dark", () => {
    root().setAttribute(STATUS_PAGE_THEME_ATTRIBUTE, "light");

    const util: UtilClass = freshUtil();

    util.initialize();
    expect(isDark()).toBe(false);

    util.setPageTheme(StatusPageTheme.Dark);

    expect(util.getPageTheme()).toBe(StatusPageTheme.Dark);
    expect(isDark()).toBe(true);
    expect(root().getAttribute(STATUS_PAGE_THEME_ATTRIBUTE)).toBe("dark");
  });

  test("tell useTheme and the app's own listeners", () => {
    const util: UtilClass = freshUtil();
    const themeChanges: Array<unknown> = [];
    const settingChanges: Array<unknown> = [];

    window.addEventListener(THEME_CHANGE_EVENT, (event: Event) => {
      themeChanges.push((event as CustomEvent).detail);
    });
    window.addEventListener(
      "oneuptime:status-page-theme-change",
      (event: Event) => {
        settingChanges.push((event as CustomEvent).detail);
      },
    );

    util.setPageTheme(StatusPageTheme.Dark);

    expect(themeChanges).toContainEqual({ theme: "dark" });
    expect(settingChanges).toEqual([{ theme: StatusPageTheme.Dark }]);
  });

  test.each([
    [StatusPageTheme.Light, false, false],
    [StatusPageTheme.Light, true, false],
    [StatusPageTheme.Dark, false, true],
    [StatusPageTheme.Dark, true, true],
    [StatusPageTheme.System, false, false],
    [StatusPageTheme.System, true, true],
  ])(
    "%s on a device that prefers dark: %s - the page is dark: %s",
    (theme: StatusPageTheme, prefersDark: boolean, expectedDark: boolean) => {
      installDevice(prefersDark);

      const util: UtilClass = freshUtil();

      util.setPageTheme(theme);

      expect(isDark()).toBe(expectedDark);
      expect(themeColor()).toBe(
        expectedDark
          ? STATUS_PAGE_THEME_COLORS.dark
          : STATUS_PAGE_THEME_COLORS.light,
      );
    },
  );
});

describe("a page that follows the visitor's device, while it is open", () => {
  test("turns dark when the device does, and light again", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);
    expect(isDark()).toBe(false);

    device.change(true);
    expect(isDark()).toBe(true);
    expect(themeColor()).toBe(STATUS_PAGE_THEME_COLORS.dark);

    device.change(false);
    expect(isDark()).toBe(false);
    expect(themeColor()).toBe(STATUS_PAGE_THEME_COLORS.light);
  });

  test("listens once, however often the settings are read again", () => {
    const util: UtilClass = freshUtil();

    util.initialize();
    util.setPageTheme(StatusPageTheme.System);
    util.setPageTheme(StatusPageTheme.System);

    expect(device.listenerCount()).toBe(1);
  });

  test("a Light or Dark page does not change with the device", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.Light);
    device.change(true);
    expect(isDark()).toBe(false);

    util.setPageTheme(StatusPageTheme.Dark);
    device.change(false);
    expect(isDark()).toBe(true);
  });

  test("a page whose owner switches it to System starts following the device", () => {
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.Light);
    expect(isDark()).toBe(false);

    util.setPageTheme(StatusPageTheme.System);
    expect(isDark()).toBe(true);
  });

  test("follows a pick the visitor made in another tab", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);
    expect(isDark()).toBe(false);

    window.localStorage.setItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
        newValue: "dark",
      }),
    );

    expect(isDark()).toBe(true);
  });
});

describe("the visitor's own pick, from the footer", () => {
  test("switches the page, and is kept in their browser", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);

    expect(util.switchColorScheme()).toBe("dark");
    expect(isDark()).toBe(true);
    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBe("dark");

    // The device turning light does not undo the visitor's pick.
    device.change(false);
    expect(isDark()).toBe(true);
  });

  test("switching back to what the device asks for forgets the pick, so the page follows the device again", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);
    util.switchColorScheme();
    expect(util.switchColorScheme()).toBe("light");

    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBeNull();

    device.change(true);
    expect(isDark()).toBe(true);
  });

  test("on a dark device, the pick is the light page", () => {
    installDevice(true);

    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);
    expect(isDark()).toBe(true);

    expect(util.switchColorScheme()).toBe("light");
    expect(isDark()).toBe(false);
    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBe("light");
  });

  test("a pick kept from an earlier visit is read back", () => {
    window.localStorage.setItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY, "dark");

    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);

    expect(util.getVisitorColorScheme()).toBe("dark");
    expect(isDark()).toBe(true);
  });

  test("a Light or Dark page offers no pick, and keeps none", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.Light);
    expect(util.switchColorScheme()).toBe("light");
    expect(isDark()).toBe(false);

    util.setPageTheme(StatusPageTheme.Dark);
    expect(util.switchColorScheme()).toBe("dark");
    expect(isDark()).toBe(true);

    expect(
      window.localStorage.getItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY),
    ).toBeNull();
  });

  test("a pick kept for a System page is ignored by a Light page", () => {
    window.localStorage.setItem(STATUS_PAGE_VISITOR_THEME_STORAGE_KEY, "dark");

    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.Light);

    expect(isDark()).toBe(false);
  });

  test("with storage blocked, the switch still works for as long as the page is open", () => {
    const util: UtilClass = freshUtil();

    util.setPageTheme(StatusPageTheme.System);

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
      expect(util.switchColorScheme()).toBe("dark");
      expect(isDark()).toBe(true);
    } finally {
      // jsdom's own storage back for the next test.
      Object.defineProperty(window, "localStorage", storage!);
    }
  });
});

const renderWithTranslation: (element: React.ReactElement) => void = (
  element: React.ReactElement,
): void => {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
};

describe("the footer's light / dark switch", () => {
  test("is not drawn on a Light or Dark page", () => {
    for (const theme of [StatusPageTheme.Light, StatusPageTheme.Dark]) {
      act(() => {
        StatusPageThemeUtil.setPageTheme(theme);
      });

      renderWithTranslation(<ThemeSwitch />);

      expect(screen.queryByTestId(THEME_SWITCH_TEST_ID)).toBeNull();
      cleanup();
    }
  });

  test("on a System page it offers the other scheme, by name, and switches to it", () => {
    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.System);
    });

    renderWithTranslation(<ThemeSwitch />);

    const toDark: HTMLElement = screen.getByRole("button", {
      name: "Switch to dark theme",
    });

    expect(toDark).toHaveAttribute("title", "Switch to dark theme");
    expect(toDark).toHaveAttribute("data-color-scheme", "light");

    act(() => {
      fireEvent.click(toDark);
    });

    expect(isDark()).toBe(true);

    const toLight: HTMLElement = screen.getByRole("button", {
      name: "Switch to light theme",
    });

    expect(toLight).toHaveAttribute("data-color-scheme", "dark");

    act(() => {
      fireEvent.click(toLight);
    });

    expect(isDark()).toBe(false);
  });

  test("follows the device while it is open", () => {
    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.System);
    });

    renderWithTranslation(<ThemeSwitch />);

    expect(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    ).toBeInTheDocument();

    act(() => {
      StatusPageThemeUtil.switchColorScheme();
    });

    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
  });

  test("the status page's footer holds it beside the language switcher, only on a System page", () => {
    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.System);
    });

    renderWithTranslation(<StatusPageFooter links={[]} copyright="Acme" />);

    const themeSwitch: HTMLElement = screen.getByTestId(THEME_SWITCH_TEST_ID);
    const languageSwitcher: HTMLElement = screen.getByRole("combobox", {
      name: "Switch language",
    });

    // One footer entry: the two controls share a row.
    expect(themeSwitch.parentElement).toBe(
      languageSwitcher.closest("div")?.parentElement,
    );
  });

  test("a Light page's footer is as it was: no switch, no empty slot", () => {
    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.Light);
    });

    renderWithTranslation(<StatusPageFooter links={[]} copyright="Acme" />);

    expect(screen.queryByTestId(THEME_SWITCH_TEST_ID)).toBeNull();

    const footerItems: number = document.querySelectorAll(
      "footer .text-sm.text-center",
    ).length;

    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.System);
    });

    // The switch joins the language switcher's entry; it adds none of its own.
    expect(
      document.querySelectorAll("footer .text-sm.text-center").length,
    ).toBe(footerItems);
  });
});

describe("the footer's controls for the visitor", () => {
  test("are one entry, centred on a phone like every other entry, and at the row's end from md up, on every page", () => {
    for (const theme of [
      StatusPageTheme.Light,
      StatusPageTheme.Dark,
      StatusPageTheme.System,
    ]) {
      act(() => {
        StatusPageThemeUtil.setPageTheme(theme);
      });

      renderWithTranslation(<StatusPageFooter links={[]} copyright="Acme" />);

      const controls: HTMLElement = screen.getByTestId(
        FOOTER_VISITOR_CONTROLS_TEST_ID,
      );

      expect([theme, controls.className]).toEqual([
        theme,
        FOOTER_VISITOR_CONTROLS_CLASS_NAME,
      ]);
      expect(controls).toHaveClass("justify-center", "md:justify-start");
      expect(
        controls.contains(
          screen.getByRole("combobox", { name: "Switch language" }),
        ),
      ).toBe(true);
      expect([
        theme,
        controls.contains(screen.queryByTestId(THEME_SWITCH_TEST_ID)),
      ]).toEqual([theme, theme === StatusPageTheme.System]);
      expect(controls).toHaveAttribute(
        "data-follows-device",
        theme === StatusPageTheme.System ? "true" : "false",
      );

      cleanup();
    }
  });

  test("the light / dark switch is a 28px target, its overhang taken back so the row keeps its height", () => {
    act(() => {
      StatusPageThemeUtil.setPageTheme(StatusPageTheme.System);
    });

    renderWithTranslation(<ThemeSwitch />);

    const button: HTMLElement = screen.getByTestId(THEME_SWITCH_TEST_ID);

    expect(button.className).toBe(THEME_SWITCH_CLASS_NAME);
    // 28px square, around a 16px icon.
    expect(button).toHaveClass("h-7", "w-7", "-my-1.5");
    // A soft ground on hover, and the keyboard's ring.
    expect(button).toHaveClass(
      "hover:bg-gray-100",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
  });
});

describe("the logo's backdrop", () => {
  test("is offered on every page a visitor can see dark: Dark, and one that follows the device", () => {
    /*
     * The page's one logo is made for the light page and its emails; a
     * Light page never needs the backdrop, and the others need it whenever
     * they are dark (Theme.css draws it only under html.dark).
     */
    const cases: Array<[StatusPageTheme, boolean]> = [
      [StatusPageTheme.Light, false],
      [StatusPageTheme.Dark, true],
      [StatusPageTheme.System, true],
    ];

    for (const [theme, hasPlate] of cases) {
      act(() => {
        StatusPageThemeUtil.setPageTheme(theme);
      });

      render(
        <LogoPlate className="flex" id="logo-under-test">
          <img alt="Acme" src="/logo.svg" />
        </LogoPlate>,
      );

      const plate: HTMLElement = document.getElementById("logo-under-test")!;

      expect([theme, plate.hasAttribute(LOGO_PLATE_ATTRIBUTE)]).toEqual([
        theme,
        hasPlate,
      ]);
      expect(plate).toHaveClass("flex");
      cleanup();
    }
  });

  test.each([[StatusPageTheme.System], [StatusPageTheme.Dark]])(
    "the header's logo sits on it on a %s page",
    (theme: StatusPageTheme) => {
      act(() => {
        StatusPageThemeUtil.setPageTheme(theme);
      });

      const logo: File = new File();
      logo.file = new Uint8Array([
        60, 115, 118, 103, 47, 62,
      ]) as unknown as Buffer;
      logo.fileType = MimeType.svg;

      // jsdom has no object URLs; the header draws the logo from one.
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: (): string => {
          return "blob:logo";
        },
      });

      render(
        <StatusPageHeader
          links={[]}
          logo={logo}
          logoAltText="Acme"
          onLogoClicked={() => {}}
        />,
      );

      const plate: HTMLElement = document.getElementById("status-page-logo")!;

      expect(plate).toHaveAttribute(LOGO_PLATE_ATTRIBUTE, "");
      expect(plate.querySelector("img")).toHaveAttribute("alt", "Acme");
    },
  );
});
