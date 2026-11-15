import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import ServerProductOffPage from "../../../../App/FeatureSet/Dashboard/src/Components/ServerProducts/ServerProductOffPage";
import ProductKey from "../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * THE PAGE OF A PRODUCT SWITCHED OFF ON THE SERVER NAMES IT IN ITS TRAIL AS
 * THE PRODUCTS MENU DOES (#8075).
 *
 * Its trail looked "Project" up at the page and again in Breadcrumbs, and
 * named the product by the products menu's word, which Breadcrumbs looked
 * up again: the Dashboard's Spanish says "Red" for Network and "Rojo" for
 * "Red", so the trail read "Rojo". "Project" goes over in English now, and
 * the product's crumb says the menu's word is translated.
 */

type Locale = Record<string, unknown>;

const SPANISH: Locale = readDashboardLocale("es");

let spanish: i18n;

function word(key: string): string {
  let cursor: unknown = SPANISH;

  for (const part of key.split(".")) {
    cursor = (cursor as Locale)[part];
  }

  return cursor as string;
}

function inSpanish(element: ReactElement, path: string): ReactElement {
  return (
    <I18nextProvider i18n={spanish}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </I18nextProvider>
  );
}

function crumbs(): Array<string> {
  return Array.from(document.body.querySelectorAll("li.breadcrumb-item")).map(
    (crumb: Element): string => {
      return (crumb.textContent || "").trim();
    },
  );
}

beforeAll(async () => {
  spanish = createInstance();

  await spanish.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("the page of a product switched off on the server, in Spanish", () => {
  test("the words it leans on: Spanish Network is Red, and Red looked up again is Rojo", () => {
    expect(word("navbar.items.networkTitle")).toBe("Red");
    expect(SPANISH["Red"]).toBe("Rojo");
  });

  test("its trail reads Project and the product's name once: Proyecto, Red - never Rojo", () => {
    const path: string = `/dashboard/${PROJECT_ID}/network`;

    goTo(path);
    render(
      inSpanish(
        <ServerProductOffPage
          product={ProductKey.Network}
          reason={ServerProductOffReason.SwitchedOff}
        />,
        path,
      ),
    );

    expect(crumbs()).toEqual([SPANISH["Project"], "Red"]);
  });

  test("its heading names the product once too: Red, never Rojo (#8224)", () => {
    const path: string = `/dashboard/${PROJECT_ID}/network`;

    goTo(path);
    render(
      inSpanish(
        <ServerProductOffPage
          product={ProductKey.Network}
          reason={ServerProductOffReason.SwitchedOff}
        />,
        path,
      ),
    );

    expect(
      (screen.getByRole("heading", { level: 1 }).textContent || "").trim(),
    ).toBe("Red");
    expect(screen.queryByText("Rojo")).toBeNull();
  });
});

/*
 * ITS HEADING NAMES THE PRODUCT ONCE IN EVERY LANGUAGE (#8224).
 *
 * The trail read Red since #8075, but the heading above it - Page's title,
 * the products menu's word - was still looked up again: in Spanish the
 * switched-off Network page was headed "Rojo". The page now tells Page the
 * menu's word is translated. In Dutch and Persian it reads the menu's word,
 * as the trail's last crumb does; with that word made a key of its own, it
 * still does.
 */
describe.each(["es", "nl", "fa"])(
  "the switched-off Network page's heading, in %s",
  (language: string) => {
    const LOCALE: Locale = readDashboardLocale(language);
    const NETWORK: string = ((LOCALE["navbar"] as Locale)["items"] as Locale)[
      "networkTitle"
    ] as string;
    const TWICE: string = "Looked up twice";

    async function renderIn(locale: Locale): Promise<void> {
      const translation: i18n = createInstance();

      await translation.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: readDashboardLocale("en") },
          [language]: { translation: locale },
        },
        interpolation: { escapeValue: false },
      });

      const path: string = `/dashboard/${PROJECT_ID}/network`;

      goTo(path);
      render(
        <I18nextProvider i18n={translation}>
          <MemoryRouter initialEntries={[path]}>
            <ServerProductOffPage
              product={ProductKey.Network}
              reason={ServerProductOffReason.SwitchedOff}
            />
          </MemoryRouter>
        </I18nextProvider>,
      );
    }

    function heading(): string {
      return (
        screen.getByRole("heading", { level: 1 }).textContent || ""
      ).trim();
    }

    test("reads the products menu's word for Network, as the trail does", async () => {
      await renderIn(LOCALE);

      expect(NETWORK).not.toBe("Network");
      expect(heading()).toBe(NETWORK);
      expect(crumbs()[1]).toBe(NETWORK);
    });

    test("never looks the menu's word up again, even where it is a key", async () => {
      await renderIn({ ...LOCALE, [NETWORK]: TWICE });

      expect(heading()).toBe(NETWORK);
      expect(screen.queryByText(TWICE)).toBeNull();
    });
  },
);
