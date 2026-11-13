import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AppLink from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink";
import EventFactLinks from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventFactLinks";
import Route from "../../../Types/API/Route";
import { LEFT_TO_RIGHT } from "../../../Types/ReadingDirection";

/*
 * A LINK THAT IS A LINE OF ITS OWN, READ THE WAY ITS NAME IS (#6471).
 *
 * The Dashboard's link (AppLink) takes the dir of the name it holds when it
 * is that name's line: a header fact's monitor (EventFactLinks), whose
 * English name on an Arabic page wraps from its own start. Left out, the
 * link has no dir and reads its holder's way, as every other link does.
 * These draw the real link, through the real router.
 */

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const drawOn: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
};

describe("AppLink", () => {
  test("a link given a reading direction reads that way", () => {
    drawOn(
      "fa",
      <AppLink to={new Route("/dashboard/monitors/1")} dir={LEFT_TO_RIGHT}>
        checkout-api (eu)
      </AppLink>,
    );

    const link: HTMLElement = screen.getByRole("link");

    expect(link).toHaveAttribute("dir", "ltr");
    expect(link).toHaveAttribute("href", "/dashboard/monitors/1");
  });

  test("a link given none has no dir: it reads its holder's way, as it always did", () => {
    drawOn(
      "fa",
      <AppLink to={new Route("/dashboard/monitors/1")}>checkout-api</AppLink>,
    );

    expect(screen.getByRole("link")).not.toHaveAttribute("dir");
  });

  test("a header fact's English monitor on a Persian page is a link that reads left to right", () => {
    drawOn(
      "fa",
      <EventFactLinks
        items={[
          {
            key: "a",
            name: "checkout-api (eu-west-1)",
            route: new Route("/dashboard/monitors/a"),
          },
          {
            key: "b",
            name: "واجهة الدفع",
            route: new Route("/dashboard/monitors/b"),
          },
        ]}
      />,
    );

    const [english, arabic] = screen.getAllByRole("link");

    expect(english).toHaveAttribute("dir", "ltr");
    expect(english!.textContent).toBe("checkout-api (eu-west-1)");
    expect(arabic).not.toHaveAttribute("dir");
  });

  test("on an English page the header fact's links have no dir", () => {
    drawOn(
      "en",
      <EventFactLinks
        items={[
          {
            key: "a",
            name: "checkout-api (eu-west-1)",
            route: new Route("/dashboard/monitors/a"),
          },
        ]}
      />,
    );

    expect(screen.getByRole("link")).not.toHaveAttribute("dir");
  });
});
