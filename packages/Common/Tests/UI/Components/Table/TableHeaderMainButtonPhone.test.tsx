import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import {
  TableHeaderToolbar,
  renderTableHeaderMainAndMore,
  renderTableHeaderMainButton,
  renderTableHeaderMoreMenu,
} from "../../../../UI/Components/Table/TableHeaderControls";
import {
  PHONE_CREATE_VERBS,
  getCreateButtonPhoneVerb,
} from "../../../../UI/Components/ModelTable/CreateButtonPhoneVerb";
import useIsBelowWidth, {
  PHONE_BELOW_WIDTH_IN_PX,
  isWindowBelowWidth,
} from "../../../../UI/Utils/UseIsBelowWidth";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * A table header's main button on a phone (CardButtonSchema.phoneTitle).
 * It shares its line with the ⋯ there (renderTableHeaderMainAndMore), and
 * a long title - "Create Scheduled Maintenance Event" at 390px - broke onto
 * two lines and stood twice as tall as the ⋯. On a phone it says its short
 * words, "Create": the card's title right above names the kind. Its name
 * is still its whole title, which holds those words, so a voice command
 * and a screen reader find it by what it does; from md up it says it all.
 */

const GERMAN: Record<string, string> = {
  Create: "Erstellen",
  "Create Scheduled Maintenance Event": "Geplantes Wartungsereignis erstellen",
};

// Another verb in the title than in the short words: no short words then.
const MIXED_VERBS: Record<string, string> = {
  Create: "Aanmaken",
  "Create Scheduled Maintenance Event": "Gepland onderhoud maken",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      nl: { translation: MIXED_VERBS },
      en: { translation: {} },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(async () => {
  cleanup();
  setViewportWidth(1024);
  await i18next.changeLanguage("en");
});

const CREATE_EVENT: CardButtonSchema = {
  title: "Create Scheduled Maintenance Event",
  phoneTitle: "Create",
  icon: IconProp.Add,
  buttonStyle: ButtonStyleType.NORMAL,
  onClick: (): void => {},
};

const REFRESH: CardButtonSchema = {
  title: "",
  icon: IconProp.Refresh,
  buttonStyle: ButtonStyleType.ICON,
  onClick: (): void => {},
};

async function renderAt(
  width: number,
  main: CardButtonSchema = CREATE_EVENT,
): Promise<void> {
  setViewportWidth(width);

  render(
    <TableHeaderToolbar>
      {renderTableHeaderMainAndMore(main, renderTableHeaderMoreMenu([REFRESH]))}
    </TableHeaderToolbar>,
  );

  // It reads the window's width in an effect.
  await act(async () => {
    await Promise.resolve();
  });
}

async function resizeTo(width: number): Promise<void> {
  setViewportWidth(width);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await Promise.resolve();
  });
}

function mainButton(): HTMLElement {
  return screen.getByTestId("card-button");
}

describe("a table header's main button on a phone", () => {
  test("says its short words, named by its whole title, beside the ⋯", async () => {
    await renderAt(390);

    expect(mainButton()).toHaveTextContent(/^Create$/);
    expect(mainButton()).toHaveAttribute(
      "aria-label",
      "Create Scheduled Maintenance Event",
    );
    expect(
      screen.getByRole("button", {
        name: "Create Scheduled Maintenance Event",
      }),
    ).toBe(mainButton());
    // Still one item with the ⋯.
    const pair: HTMLElement = screen.getByTestId("model-table-main-and-more");
    expect(within(pair).getAllByRole("button")).toEqual([
      mainButton(),
      within(pair).getByRole("button", { name: "More options" }),
    ]);
  });

  test("from md up it says its whole title, named by its words", async () => {
    for (const width of [PHONE_BELOW_WIDTH_IN_PX, 1280]) {
      await renderAt(width);

      expect(mainButton()).toHaveTextContent(
        /^Create Scheduled Maintenance Event$/,
      );
      expect(mainButton()).not.toHaveAttribute("aria-label");
      cleanup();
    }
  });

  test("a window made narrower and wider again moves between the two", async () => {
    await renderAt(1280);
    expect(mainButton()).toHaveTextContent(/^Create Scheduled/);

    await resizeTo(390);
    expect(mainButton()).toHaveTextContent(/^Create$/);

    await resizeTo(900);
    expect(mainButton()).toHaveTextContent(/^Create Scheduled/);
    expect(mainButton()).not.toHaveAttribute("aria-label");
  });

  test("a button without short words says its whole title on a phone too", async () => {
    await renderAt(390, { ...CREATE_EVENT, phoneTitle: undefined });

    expect(mainButton()).toHaveTextContent(
      /^Create Scheduled Maintenance Event$/,
    );
    expect(mainButton()).not.toHaveAttribute("aria-label");
  });

  test("in German: Erstellen, named Geplantes Wartungsereignis erstellen", async () => {
    await i18next.changeLanguage("de");
    await renderAt(390);

    expect(mainButton()).toHaveTextContent(/^Erstellen$/);
    expect(mainButton()).toHaveAttribute(
      "aria-label",
      "Geplantes Wartungsereignis erstellen",
    );
  });

  test("where the language's title takes another word than its short words, the whole title", async () => {
    await i18next.changeLanguage("nl");
    await renderAt(390);

    expect(mainButton()).toHaveTextContent(/^Gepland onderhoud maken$/);
    expect(mainButton()).not.toHaveAttribute("aria-label");
  });

  test("a locked one says its short words too, and keeps its reason", async () => {
    await renderAt(390, {
      ...CREATE_EVENT,
      disabled: true,
      tooltip: "You do not have permission to create events.",
    });

    expect(mainButton()).toHaveTextContent(/^Create$/);
    expect(mainButton()).toHaveAttribute(
      "aria-label",
      "Create Scheduled Maintenance Event",
    );
    expect(
      screen.getByTestId("card-button-disabled-wrapper"),
    ).toBeInTheDocument();
  });

  /*
   * Read from the window as it is first drawn: a phone never paints a
   * frame of the whole title, broken onto two lines beside the ⋯, before
   * its short words.
   */
  test("on a phone its very first frame says its short words", () => {
    const seen: Array<boolean> = [];

    function Reader(): null {
      seen.push(useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX));
      return null;
    }

    setViewportWidth(390);
    render(<Reader />);

    // Drawn the first time already as a phone, and never as anything else.
    expect(seen[0]).toBe(true);
    expect(new Set(seen)).toEqual(new Set([true]));

    cleanup();
    seen.length = 0;
    setViewportWidth(1280);
    render(<Reader />);

    expect(new Set(seen)).toEqual(new Set([false]));
  });

  test("a window's width is read against the breakpoint, below it only", () => {
    setViewportWidth(PHONE_BELOW_WIDTH_IN_PX - 1);
    expect(isWindowBelowWidth(PHONE_BELOW_WIDTH_IN_PX)).toBe(true);

    setViewportWidth(PHONE_BELOW_WIDTH_IN_PX);
    expect(isWindowBelowWidth(PHONE_BELOW_WIDTH_IN_PX)).toBe(false);
  });

  test("drawn alone, with no ⋯, the same", async () => {
    setViewportWidth(390);
    render(
      <TableHeaderToolbar>
        {renderTableHeaderMainButton(CREATE_EVENT)}
      </TableHeaderToolbar>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mainButton()).toHaveTextContent(/^Create$/);
  });
});

describe("a model table's create button on a phone", () => {
  test("says its verb alone, for the verbs every language reads alone as the verb", () => {
    expect(PHONE_CREATE_VERBS).toEqual(["Create", "Add", "Invite", "Connect"]);

    expect(getCreateButtonPhoneVerb({ itemName: "Monitor" })).toBe("Create");
    for (const verb of PHONE_CREATE_VERBS) {
      expect(getCreateButtonPhoneVerb({ verb, itemName: "Monitor" })).toBe(
        verb,
      );
    }
  });

  test("Link and Declare keep their whole title: their words alone read otherwise", () => {
    expect(
      getCreateButtonPhoneVerb({ verb: "Link", itemName: "Incident" }),
    ).toBeUndefined();
    expect(
      getCreateButtonPhoneVerb({ verb: "Declare", itemName: "Incident" }),
    ).toBeUndefined();
  });

  test("a button that says its verb alone already has nothing to drop", () => {
    expect(getCreateButtonPhoneVerb({ itemName: "" })).toBeUndefined();
    expect(
      getCreateButtonPhoneVerb({ verb: "Invite", itemName: "  " }),
    ).toBeUndefined();
  });
});
