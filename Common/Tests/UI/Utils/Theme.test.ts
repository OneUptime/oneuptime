import { beforeEach, describe, expect, test } from "@jest/globals";
import ThemeUtil, { THEME_STORAGE_KEY, Theme } from "../../../UI/Utils/Theme";

const LIGHT_THEME_COLOR: string = "#f9fafb";
const DARK_THEME_COLOR: string = "#0f172a";

const getThemeColorMeta: () => HTMLMetaElement = (): HTMLMetaElement => {
  const themeColor: HTMLMetaElement | null = document.querySelector(
    'meta[name="theme-color"]:not([media])',
  );

  expect(themeColor).not.toBeNull();
  return themeColor as HTMLMetaElement;
};

const dispatchStorageEvent: (
  key: string | null,
  newValue: string | null,
) => void = (key: string | null, newValue: string | null): void => {
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

describe("ThemeUtil", () => {
  beforeEach(() => {
    window.localStorage.clear();

    const root: HTMLElement = document.documentElement;
    root.removeAttribute("class");
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");

    document.head.innerHTML = [
      '<meta name="theme-color" content="initial">',
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="media-theme">',
    ].join("");
  });

  test("defaults to light when no preference has been saved", () => {
    document.documentElement.classList.add(Theme.Dark);

    expect(ThemeUtil.getStoredTheme()).toBe(Theme.Light);

    ThemeUtil.initialize();

    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Light);
    expect(document.documentElement.classList.contains(Theme.Dark)).toBe(false);
    expect(document.documentElement.dataset["theme"]).toBe(Theme.Light);
  });

  test("restores an exactly persisted dark preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, Theme.Dark);

    expect(ThemeUtil.getStoredTheme()).toBe(Theme.Dark);

    ThemeUtil.initialize();

    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);
    expect(document.documentElement.classList.contains(Theme.Dark)).toBe(true);
  });

  test.each([Theme.Light, "Dark", "DARK", " dark ", "invalid", ""])(
    "treats the persisted value %p as light",
    (persistedValue: string) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, persistedValue);

      expect(ThemeUtil.getStoredTheme()).toBe(Theme.Light);
    },
  );

  test("updates the root class, data attribute, color scheme, and theme-color meta", () => {
    const mediaThemeColor: HTMLMetaElement = document.querySelector(
      'meta[name="theme-color"][media]',
    ) as HTMLMetaElement;

    ThemeUtil.setTheme(Theme.Dark);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(Theme.Dark);
    expect(document.documentElement.classList.contains(Theme.Dark)).toBe(true);
    expect(document.documentElement.dataset["theme"]).toBe(Theme.Dark);
    expect(document.documentElement.style.colorScheme).toBe(Theme.Dark);
    expect(getThemeColorMeta().getAttribute("content")).toBe(DARK_THEME_COLOR);
    expect(mediaThemeColor.getAttribute("content")).toBe("media-theme");

    ThemeUtil.setTheme(Theme.Light);

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(Theme.Light);
    expect(document.documentElement.classList.contains(Theme.Dark)).toBe(false);
    expect(document.documentElement.dataset["theme"]).toBe(Theme.Light);
    expect(document.documentElement.style.colorScheme).toBe(Theme.Light);
    expect(getThemeColorMeta().getAttribute("content")).toBe(LIGHT_THEME_COLOR);
    expect(mediaThemeColor.getAttribute("content")).toBe("media-theme");
  });

  test("falls back to light when reading storage fails", () => {
    const restoreLocalStorage: () => void = makeLocalStorageUnavailable();

    try {
      expect(ThemeUtil.getStoredTheme()).toBe(Theme.Light);
    } finally {
      restoreLocalStorage();
    }
  });

  test("still applies the visual theme when writing storage fails", () => {
    const restoreLocalStorage: () => void = makeLocalStorageUnavailable();

    try {
      expect(() => {
        ThemeUtil.setTheme(Theme.Dark);
      }).not.toThrow();
      expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);
      expect(document.documentElement.dataset["theme"]).toBe(Theme.Dark);
    } finally {
      restoreLocalStorage();
    }
  });

  test("synchronizes dark and cleared preferences from other tabs", () => {
    ThemeUtil.initialize();

    dispatchStorageEvent(THEME_STORAGE_KEY, Theme.Dark);
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);

    dispatchStorageEvent(THEME_STORAGE_KEY, null);
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Light);

    dispatchStorageEvent(THEME_STORAGE_KEY, Theme.Dark);
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);

    dispatchStorageEvent(null, null);
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Light);
  });
});
