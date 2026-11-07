import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import Badge, { BadgeType } from "../../../UI/Components/Badge/Badge";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import Route from "../../../Types/API/Route";

/*
 * A SIDE MENU'S COUNT IN THE READER'S DIGITS.
 *
 * Badge - the count beside a side menu's entry (Incidents 12, Alerts 3) -
 * printed its number as JavaScript writes it: "12" beside a Persian menu's
 * words, where every other count on the page is written "۱۲". It is now
 * written as the reader's language writes a number (the translator's
 * formatNumber), as the page's other counts are.
 */

jest.mock("../../../UI/Utils/Navigation.ts", () => {
  return {
    isOnThisPage: jest.fn().mockReturnValue(false),
    navigate: jest.fn(),
  };
});

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const draw: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

describe("Badge", () => {
  test("in Persian a count is written in Persian digits", () => {
    draw("fa", <Badge id="count" badgeCount={12} />);

    expect(screen.getByTestId("count")).toHaveTextContent("۱۲");
    expect(screen.getByTestId("count").textContent).not.toMatch(/[0-9]/);
  });

  test("in Persian a large count is grouped the Persian way", () => {
    draw("fa", <Badge id="count" badgeCount={1234} />);

    expect(screen.getByTestId("count").textContent).toBe(
      (1234).toLocaleString("fa"),
    );
  });

  test("in English and German the digits are the Latin ones, as before", () => {
    draw("en", <Badge id="en-count" badgeCount={12} />);
    draw("de", <Badge id="de-count" badgeCount={3} />);

    expect(screen.getByTestId("en-count")).toHaveTextContent("12");
    expect(screen.getByTestId("de-count")).toHaveTextContent("3");
  });

  test("a large count is grouped as the reader's language groups it", () => {
    draw("en", <Badge id="en-count" badgeCount={1234} />);
    draw("de", <Badge id="de-count" badgeCount={1234} />);

    expect(screen.getByTestId("en-count")).toHaveTextContent("1,234");
    expect(screen.getByTestId("de-count")).toHaveTextContent("1.234");
  });

  test("a count of nothing is no badge, in every language", () => {
    draw(
      "fa",
      <Badge id="count" badgeCount={0} badgeType={BadgeType.WARNING} />,
    );

    expect(screen.queryByTestId("count")).toBeNull();
  });
});

describe("a side menu entry's count", () => {
  test("on a Persian page the entry's count is in Persian digits", () => {
    draw(
      "fa",
      <SideMenuItem
        link={{ title: "Incidents", to: new Route("/incidents") }}
        badge={7}
        badgeType={BadgeType.DANGER}
      />,
    );

    expect(screen.getByText("۷")).toBeInTheDocument();
    expect(screen.queryByText("7")).toBeNull();
  });

  test("on an English page the entry's count reads as it did", () => {
    draw(
      "en",
      <SideMenuItem
        link={{ title: "Incidents", to: new Route("/incidents") }}
        badge={7}
        badgeType={BadgeType.DANGER}
      />,
    );

    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
