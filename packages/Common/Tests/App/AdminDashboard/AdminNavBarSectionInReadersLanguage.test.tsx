import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { Location } from "react-router-dom";
import AdminNavBar from "../../../../App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar";
import arabic from "../../../../App/FeatureSet/AdminDashboard/src/Locales/ar.json";
import german from "../../../../App/FeatureSet/AdminDashboard/src/Locales/de.json";
import english from "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * THE ADMIN DASHBOARD'S HEADER NAMES ITS PAGE'S SECTION IN THE READER'S WORDS
 * (#6633's UI review).
 *
 * The header reads Home / <the page's section>, the section a button that
 * opens the menu. The Admin Dashboard hands the shared NavBar its sections in
 * English and lets it translate them: Home and every entry of the menu were
 * Arabic or German, but the section button was drawn as handed over -
 * "الرئيسية / Projects" on an Arabic page, "Startseite / Projects" on a German
 * one. These draw the real header with the real Admin Dashboard locales.
 */

// With billing on the menu grows an entry; the header is the same either way.
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mocked;
});

const ARABIC: Record<string, unknown> = arabic as Record<string, unknown>;
const GERMAN: Record<string, unknown> = german as Record<string, unknown>;

const ORIGINAL_WIDTH: number = window.innerWidth;

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: english },
      ar: { translation: arabic },
      de: { translation: german },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1280,
  });
});

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: ORIGINAL_WIDTH,
  });
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function onPage(pathname: string, language: string): Promise<void> {
  Navigation.setLocation({
    pathname: pathname,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

describe("the Admin Dashboard header's section button", () => {
  test("is in Arabic on an Arabic page, as Home beside it is", async () => {
    await onPage("/admin/projects", "ar");
    render(<AdminNavBar />);

    expect(ARABIC["Projects"]).toBe("المشاريع");
    expect(
      screen.getByRole("button", { name: ARABIC["Projects"] as string }),
    ).toBeInTheDocument();
    expect(screen.getByText(ARABIC["Home"] as string)).toBeInTheDocument();
    expect(screen.queryByText("Projects")).toBeNull();
  });

  test("is in German on a German page, for every section", async () => {
    for (const [pathname, section] of [
      ["/admin/projects", "Projects"],
      ["/admin/users", "Users"],
      ["/admin/settings/host", "Settings"],
    ] as Array<[string, string]>) {
      await onPage(pathname, "de");
      render(<AdminNavBar />);

      const words: string = GERMAN[section] as string;

      expect(words).not.toBe(section);
      expect(screen.getByRole("button", { name: words })).toBeInTheDocument();
      expect(screen.queryByText(section)).toBeNull();
      cleanup();
    }
  });

  test("still reads as it always did in English", async () => {
    await onPage("/admin/projects", "en");
    render(<AdminNavBar />);

    expect(
      screen.getByRole("button", { name: "Projects" }),
    ).toBeInTheDocument();
  });
});
