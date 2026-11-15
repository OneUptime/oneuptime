// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import IconProp from "../../../Types/Icon/IconProp";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A MENU ITEM GIVEN WORDS ALREADY IN THE READER'S LANGUAGE DRAWS THEM AS
 * GIVEN (#8067).
 *
 * A MoreMenuItem looks its text and its tooltip up, as a Pill does, unless
 * it is told they are written already (isUserContent, isTooltipUserContent).
 * A row's ⋯ menu translated an action's title and a locked action's reason,
 * then handed them over unmarked, so each was looked up a second time: in
 * Spanish "Network" is "Red", and "Red" is itself a key, "Rojo". Drawn here
 * with the Dashboard's real Spanish words.
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");

let spanishInstance: i18n | null = null;

function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  spanishInstance = instance;

  return instance;
}

function renderInSpanish(element: ReactElement): void {
  render(<I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>);
}

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {
  return undefined;
};

// The reason a locked item gives a screen reader, beside the item.
function lockReasons(): Array<string> {
  return Array.from(document.querySelectorAll("span.sr-only")).map(
    (element: Element): string => {
      return (element.textContent || "").trim();
    },
  );
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("Spanish words Network Red, and Red is a key of its own, Rojo", () => {
    expect({ Network: SPANISH["Network"], Red: SPANISH["Red"] }).toEqual({
      Network: "Red",
      Red: "Rojo",
    });
  });
});

describe("a menu item", () => {
  test("looks its English text up", () => {
    renderInSpanish(<MoreMenuItem text="Network" onClick={noop} />);

    expect(screen.getByRole("menuitem")).toHaveTextContent("Red");
  });

  test("marked, draws words already in Spanish as given, never looking them up again", () => {
    renderInSpanish(
      <MoreMenuItem text="Red" isUserContent={true} onClick={noop} />,
    );

    expect(screen.getByRole("menuitem")).toHaveTextContent("Red");
    expect(screen.getByRole("menuitem")).not.toHaveTextContent("Rojo");
  });

  test("locked, looks its English reason up", () => {
    renderInSpanish(
      <MoreMenuItem
        text="Delete"
        isDisabled={true}
        tooltip="Network"
        onClick={noop}
      />,
    );

    expect(lockReasons()).toEqual(["Red"]);
  });

  test("locked, with a reason already in Spanish and marked, gives it as given", () => {
    renderInSpanish(
      <MoreMenuItem
        text="Delete"
        isDisabled={true}
        tooltip="Red"
        isTooltipUserContent={true}
        onClick={noop}
      />,
    );

    expect(lockReasons()).toEqual(["Red"]);
  });

  test("unmarked, a reason already in Spanish is looked up again: what the mark is for", () => {
    renderInSpanish(
      <MoreMenuItem
        text="Delete"
        isDisabled={true}
        tooltip="Red"
        onClick={noop}
      />,
    );

    expect(lockReasons()).toEqual(["Rojo"]);
  });
});

describe("a row's ⋯ menu", () => {
  interface Row {
    id: string;
  }

  function openMenu(): HTMLElement {
    const trigger: HTMLElement = screen.getByTestId("row-actions-more-button");
    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);
    return screen.getByRole("menu");
  }

  test("translates an action's title and a locked action's reason once", () => {
    renderInSpanish(
      <RowActions<Row>
        item={{ id: "row-1" }}
        actionButtons={[
          {
            title: "View",
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: noop,
          },
          {
            title: "Network",
            icon: IconProp.Globe,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: noop,
          },
          {
            title: "Delete",
            icon: IconProp.Trash,
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            disabled: true,
            tooltip: "Network",
            onClick: noop,
          },
        ]}
      />,
    );

    const menu: HTMLElement = openMenu();
    const items: Array<string> = within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(items).toContain("Red");
    expect(items).not.toContain("Rojo");
    expect(lockReasons()).toContain("Red");
    expect(lockReasons()).not.toContain("Rojo");
  });
});
