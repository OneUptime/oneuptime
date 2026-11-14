import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import Statusbubble from "../../../UI/Components/StatusBubble/StatusBubble";
import Color from "../../../Types/Color";

/*
 * A monitor's status in a list - the Monitors table's "Monitor Status"
 * column - sits on the row's 24px line, level with the values beside it
 * (model-table-ui). text-sm alone set a 20px line, which drew the status 2px
 * above the name and the type in the same row.
 */

afterEach(() => {
  cleanup();
});

describe("a status bubble", () => {
  test("its words are on a value's 24px line", () => {
    render(
      <Statusbubble
        text="Operational"
        color={new Color("#10b981")}
        shouldAnimate={false}
      />,
    );

    const words: HTMLElement = screen.getByText("Operational");

    expect(words).toHaveClass("text-sm", "font-medium", "leading-6");
  });

  test("it still says what it is to a screen reader", () => {
    render(
      <Statusbubble
        text="Degraded"
        color={new Color("#f59e0b")}
        shouldAnimate={true}
      />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName("Status: Degraded");
  });
});

/*
 * A monitor's status a project named itself is its own words (#7780): a
 * status named "Open" read "Abrir" on a Spanish page, while OneUptime's
 * "Operational" is rightly "Operativo". A bubble told its text is a name
 * (isUserContent) draws it, and says it, as written.
 */
describe("a status bubble on a Spanish page", () => {
  const spanish: i18n = createInstance();

  spanish.init({
    lng: "es",
    resources: {
      es: {
        translation: {
          Open: "Abrir",
          Operational: "Operativo",
          "Status: {{status}}": "Estado: {{status}}",
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  function renderInSpanish(element: React.ReactElement): void {
    render(<I18nextProvider i18n={spanish}>{element}</I18nextProvider>);
  }

  test("looks OneUptime's words up", () => {
    renderInSpanish(
      <Statusbubble
        text="Operational"
        color={new Color("#10b981")}
        shouldAnimate={false}
      />,
    );

    expect(screen.getByText("Operativo")).toBeInTheDocument();
  });

  test("draws a name as written, and says it as written", () => {
    renderInSpanish(
      <Statusbubble
        text="Open"
        isUserContent={true}
        color={new Color("#10b981")}
        shouldAnimate={false}
      />,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Abrir")).not.toBeInTheDocument();
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain(
      "Open",
    );
    expect(screen.getByRole("status").getAttribute("aria-label")).not.toContain(
      "Abrir",
    );
  });
});
