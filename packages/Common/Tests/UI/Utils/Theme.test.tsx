import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import * as React from "react";
import ThemeUtil, {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  Theme,
  ThemePreference,
  useTheme,
  useThemePreference,
} from "../../../UI/Utils/Theme";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";

/*
 * The person's theme in the pages that are theirs (Types/Theme/
 * ThemePreference.ts): Light, Dark or System, kept in the browser, and a
 * browser where nobody picked follows the device - live, while the page is
 * open.
 */

const LIGHT_THEME_COLOR: string = "#f9fafb";
const DARK_THEME_COLOR: string = "#0f172a";

/*
 * The device's light / dark setting, which the page asks through
 * matchMedia. One for the whole file: ThemeUtil starts following it on its
 * first initialize(), and keeps the listener it registered then.
 */
type ChangeListener = (event: { matches: boolean }) => void;

const device: {
  prefersDark: boolean;
  listeners: Array<ChangeListener>;
  queries: Array<string>;
} = {
  prefersDark: false,
  listeners: [],
  queries: [],
};

const setDevice: (prefersDark: boolean) => void = (
  prefersDark: boolean,
): void => {
  device.prefersDark = prefersDark;

  for (const listener of device.listeners) {
    listener({ matches: prefersDark });
  }
};

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    device.queries.push(query);

    return {
      media: query,
      get matches(): boolean {
        return query === DARK_COLOR_SCHEME_MEDIA_QUERY && device.prefersDark;
      },
      addEventListener: (_type: string, listener: ChangeListener): void => {
        device.listeners.push(listener);
      },
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

const getThemeColorMeta: () => HTMLMetaElement = (): HTMLMetaElement => {
  const themeColor: HTMLMetaElement | null = document.querySelector(
    'meta[name="theme-color"]:not([media])',
  );

  expect(themeColor).not.toBeNull();
  return themeColor as HTMLMetaElement;
};

// A pick made, or storage cleared (key null), in another tab of this address.
const dispatchStorageEvent: (
  key: string | null,
  newValue: string | null,
) => void = (key: string | null, newValue: string | null): void => {
  if (key && newValue !== null) {
    window.localStorage.setItem(key, newValue);
  } else if (key) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.clear();
  }

  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue,
      storageArea: window.localStorage,
    }),
  );
};

const makeLocalStorageUnavailable: () => () => void = (): (() => void) => {
  const descriptor: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(window, "localStorage");

  if (!descriptor) {
    throw new Error(
      "Expected window.localStorage to have a property descriptor",
    );
  }

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: (): never => {
      throw new Error("Storage is unavailable");
    },
  });

  return (): void => {
    Object.defineProperty(window, "localStorage", descriptor);
  };
};

const drawnTheme: () => {
  dark: boolean;
  dataTheme: string | undefined;
  colorScheme: string;
  themeColor: string | null;
} = () => {
  const root: HTMLElement = document.documentElement;

  return {
    dark: root.classList.contains("dark"),
    dataTheme: root.dataset["theme"],
    colorScheme: root.style.colorScheme,
    themeColor: getThemeColorMeta().getAttribute("content"),
  };
};

const LIGHT_PAGE: ReturnType<typeof drawnTheme> = {
  dark: false,
  dataTheme: "light",
  colorScheme: "light",
  themeColor: LIGHT_THEME_COLOR,
};

const DARK_PAGE: ReturnType<typeof drawnTheme> = {
  dark: true,
  dataTheme: "dark",
  colorScheme: "dark",
  themeColor: DARK_THEME_COLOR,
};

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  device.prefersDark = false;

  const root: HTMLElement = document.documentElement;
  root.removeAttribute("class");
  root.removeAttribute("data-theme");
  root.style.removeProperty("color-scheme");

  document.head.innerHTML = [
    '<meta name="theme-color" content="initial">',
    '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="media-theme">',
  ].join("");

  // Back to a page that is never always light.
  ThemeUtil.initialize();
});

afterEach(() => {
  cleanup();
});

describe("a browser where nobody picked", () => {
  test("reads as System", () => {
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
  });

  test("is light on a device set to light", () => {
    document.documentElement.classList.add(Theme.Dark);

    ThemeUtil.initialize();

    expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);
  });

  test("is dark on a device set to dark", () => {
    device.prefersDark = true;

    ThemeUtil.initialize();

    expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);
    expect(drawnTheme()).toEqual(DARK_PAGE);
    // It asked the device the standard way.
    expect(device.queries).toContain("(prefers-color-scheme: dark)");
  });

  test("changes with the device while the page is open", () => {
    ThemeUtil.initialize();
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    setDevice(true);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    setDevice(false);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);
  });

  test("is light where the browser cannot say how the device is set", () => {
    const matchMedia: typeof window.matchMedia = window.matchMedia;

    try {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: undefined,
      });
      device.prefersDark = true;

      expect(ThemeUtil.doesDevicePreferDark()).toBe(false);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);

      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (): never => {
          throw new Error("No media queries here");
        },
      });

      expect(ThemeUtil.doesDevicePreferDark()).toBe(false);
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
      });
    }
  });
});

describe("a pick saved on this browser", () => {
  test.each([
    [ThemePreference.Light, false, LIGHT_PAGE],
    [ThemePreference.Light, true, LIGHT_PAGE],
    [ThemePreference.Dark, false, DARK_PAGE],
    [ThemePreference.Dark, true, DARK_PAGE],
    [ThemePreference.System, false, LIGHT_PAGE],
    [ThemePreference.System, true, DARK_PAGE],
  ])(
    "%s, on a device that prefers dark: %p",
    (
      pick: ThemePreference,
      prefersDark: boolean,
      page: ReturnType<typeof drawnTheme>,
    ) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, pick);
      device.prefersDark = prefersDark;

      ThemeUtil.initialize();

      expect(ThemeUtil.getPreference()).toBe(pick);
      expect(drawnTheme()).toEqual(page);
    },
  );

  test("keeps the Light and Dark picks saved before System existed", () => {
    // What the old Dashboard saved: exactly "light" or "dark".
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    device.prefersDark = false;
    ThemeUtil.initialize();
    expect(drawnTheme()).toEqual(DARK_PAGE);

    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    device.prefersDark = true;
    ThemeUtil.initialize();
    expect(drawnTheme()).toEqual(LIGHT_PAGE);
  });

  test.each(["Dark", "DARK", " dark ", "invalid", "", "auto"])(
    "reads the kept value %p as no pick, so the device decides",
    (kept: string) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, kept);

      expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);

      device.prefersDark = true;
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);
      device.prefersDark = false;
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Light);
    },
  );

  test("Light and Dark stay put when the device changes", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize();

    setDevice(true);
    setDevice(false);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    ThemeUtil.setPreference(ThemePreference.Light);
    setDevice(true);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);
  });
});

describe("picking", () => {
  test("keeps the pick exactly as the head script reads it, and draws it at once", () => {
    const mediaThemeColor: HTMLMetaElement = document.querySelector(
      'meta[name="theme-color"][media]',
    ) as HTMLMetaElement;

    ThemeUtil.setPreference(ThemePreference.Dark);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(drawnTheme()).toEqual(DARK_PAGE);

    ThemeUtil.setPreference(ThemePreference.Light);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    device.prefersDark = true;
    ThemeUtil.setPreference(ThemePreference.System);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(drawnTheme()).toEqual(DARK_PAGE);

    // A theme-color tag for a media query is the page's own: left alone.
    expect(mediaThemeColor.getAttribute("content")).toBe("media-theme");
  });

  test("System, once picked, follows the device from then on", () => {
    ThemeUtil.setPreference(ThemePreference.Light);
    setDevice(true);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    ThemeUtil.setPreference(ThemePreference.System);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    setDevice(false);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);
  });

  test("tells the page, so everything that reads the theme follows", () => {
    const told: Array<unknown> = [];
    const onChange: (event: Event) => void = (event: Event): void => {
      told.push((event as CustomEvent).detail);
    };

    window.addEventListener(THEME_CHANGE_EVENT, onChange);

    try {
      ThemeUtil.setPreference(ThemePreference.Dark);
      ThemeUtil.setPreference(ThemePreference.Light);
    } finally {
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    }

    expect(told).toEqual([{ theme: Theme.Dark }, { theme: Theme.Light }]);
  });

  test("setTheme picks Light or Dark by the theme it draws", () => {
    device.prefersDark = true;

    ThemeUtil.setTheme(Theme.Light);
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Light);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    ThemeUtil.setTheme(Theme.Dark);
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Dark);
    expect(drawnTheme()).toEqual(DARK_PAGE);
  });

  test("toggleTheme picks the other theme than the one drawn, System included", () => {
    // Nothing picked, on a dark device: the page is dark, so the toggle picks Light.
    device.prefersDark = true;
    ThemeUtil.initialize();

    expect(ThemeUtil.toggleTheme()).toBe(Theme.Light);
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Light);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    expect(ThemeUtil.toggleTheme()).toBe(Theme.Dark);
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Dark);
  });

  test("reads System when storage cannot be read: the device decides", () => {
    const restoreLocalStorage: () => void = makeLocalStorageUnavailable();

    try {
      expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
      device.prefersDark = true;
      expect(ThemeUtil.getPreferredTheme()).toBe(Theme.Dark);
    } finally {
      restoreLocalStorage();
    }
  });

  test("holds a pick the browser will not keep for as long as the page is open, through device changes", () => {
    const restoreLocalStorage: () => void = makeLocalStorageUnavailable();

    try {
      expect(() => {
        ThemeUtil.setPreference(ThemePreference.Dark);
      }).not.toThrow();
      expect(drawnTheme()).toEqual(DARK_PAGE);
      expect(ThemeUtil.getPreference()).toBe(ThemePreference.Dark);

      // The device going light does not undo a pick of Dark.
      setDevice(true);
      setDevice(false);
      expect(drawnTheme()).toEqual(DARK_PAGE);
    } finally {
      restoreLocalStorage();
    }
  });
});

describe("another tab of this address", () => {
  test("its pick is drawn here too", () => {
    ThemeUtil.initialize();

    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.Dark);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.Light);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    device.prefersDark = true;
    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.System);
    expect(drawnTheme()).toEqual(DARK_PAGE);
  });

  test("a pick taken away, or storage cleared, leaves the page to the device", () => {
    ThemeUtil.initialize();

    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.Dark);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    dispatchStorageEvent(THEME_STORAGE_KEY, null);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.Dark);
    expect(drawnTheme()).toEqual(DARK_PAGE);

    device.prefersDark = true;
    dispatchStorageEvent(null, null);
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.System);
    expect(drawnTheme()).toEqual(DARK_PAGE);
  });

  test("another key changing is not a pick", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize();

    // Changed behind the page's back, then another key's event arrives.
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Light);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "oneuptimeLang",
        newValue: "de",
        storageArea: window.localStorage,
      }),
    );

    expect(drawnTheme()).toEqual(DARK_PAGE);
  });
});

describe("a page that is always light", () => {
  afterEach(() => {
    ThemeUtil.initialize();
  });

  test("is light whatever was picked, and whatever the device does", () => {
    let isAlwaysLight: boolean = true;

    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize({
      isAlwaysLight: (): boolean => {
        return isAlwaysLight;
      },
    });
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    ThemeUtil.setPreference(ThemePreference.System);
    setDevice(true);
    dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.Dark);
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    // Moving on to a page of the person's own draws their theme again.
    isAlwaysLight = false;
    ThemeUtil.applyPreferredTheme();
    expect(drawnTheme()).toEqual(DARK_PAGE);
  });

  test("a later initialize without the rule is the person's theme everywhere", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Dark);
    ThemeUtil.initialize({
      isAlwaysLight: (): boolean => {
        return true;
      },
    });
    expect(drawnTheme()).toEqual(LIGHT_PAGE);

    ThemeUtil.initialize();
    expect(drawnTheme()).toEqual(DARK_PAGE);
  });
});

describe("applyTheme, for pages drawn in their owner's theme", () => {
  test("draws a theme without keeping it as the person's pick", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, ThemePreference.Light);

    ThemeUtil.applyTheme(Theme.Dark);

    expect(drawnTheme()).toEqual(DARK_PAGE);
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});

describe("the hooks", () => {
  const Reader: React.FunctionComponent = (): React.ReactElement => {
    const theme: Theme = useTheme();
    const preference: ThemePreference = useThemePreference();

    return (
      <p data-testid="reader">
        {preference}:{theme}
      </p>
    );
  };

  test("follow a pick here, a pick in another tab and the device", () => {
    ThemeUtil.initialize();
    render(<Reader />);

    expect(screen.getByTestId("reader")).toHaveTextContent("system:light");

    act(() => {
      ThemeUtil.setPreference(ThemePreference.Dark);
    });
    expect(screen.getByTestId("reader")).toHaveTextContent("dark:dark");

    act(() => {
      dispatchStorageEvent(THEME_STORAGE_KEY, ThemePreference.System);
    });
    expect(screen.getByTestId("reader")).toHaveTextContent("system:light");

    act(() => {
      setDevice(true);
    });
    expect(screen.getByTestId("reader")).toHaveTextContent("system:dark");

    // A pick of System on a dark device: the theme stays, the pick changes.
    act(() => {
      ThemeUtil.setPreference(ThemePreference.Dark);
    });
    act(() => {
      ThemeUtil.setPreference(ThemePreference.System);
    });
    expect(screen.getByTestId("reader")).toHaveTextContent("system:dark");
  });
});

describe("a browser without addEventListener on media queries (Safari before 14)", () => {
  test("still follows the device through addListener", () => {
    jest.isolateModules(() => {
      const legacyListeners: Array<ChangeListener> = [];
      let prefersDark: boolean = false;
      const matchMedia: typeof window.matchMedia = window.matchMedia;

      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string): MediaQueryList => {
          return {
            media: query,
            get matches(): boolean {
              return prefersDark;
            },
            addListener: (listener: ChangeListener): void => {
              legacyListeners.push(listener);
            },
          } as unknown as MediaQueryList;
        },
      });

      try {
        // A fresh copy, which has not started following anything yet.
        const FreshThemeUtil: typeof ThemeUtil = (
          jest.requireActual("../../../UI/Utils/Theme") as {
            default: typeof ThemeUtil;
          }
        ).default;

        FreshThemeUtil.initialize();
        expect(drawnTheme()).toEqual(LIGHT_PAGE);
        expect(legacyListeners).toHaveLength(1);

        prefersDark = true;
        legacyListeners[0]!({ matches: true });
        expect(drawnTheme()).toEqual(DARK_PAGE);
      } finally {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: matchMedia,
        });
      }
    });
  });
});
