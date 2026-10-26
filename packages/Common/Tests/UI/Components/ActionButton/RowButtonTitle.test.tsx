import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../../UI/Components/ActionButton/RowActions";
import { isShortTitleInName } from "../../../../UI/Components/Button/ShortButtonWords";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * A row's one button says what it does in a word when its title would only
 * repeat the list's kind on every row: "View", not "View On-Call Schedule"
 * - the row names its record in its first column, and the list's title its
 * kind. "View Scheduled Maintenance Template" was 300px wide on every row,
 * and pushed its table under the sticky Actions column at 1280px. The
 * title still names the button for a screen reader (and for speech
 * control, whose spoken "View" it starts with), and the action keeps it in
 * the ⋯ menu.
 */

const GERMAN: Record<string, string> = {
  View: "Anzeigen",
  "View On-Call Schedule": "Bereitschaftsplan anzeigen",
  "Edit On-Call Schedule": "Bereitschaftsplan bearbeiten",
};

/*
 * German as it read before: its View was "Ansehen", its titles "...
 * anzeigen" - the word the row showed was not in the button's name.
 */
const MIXED_VERBS: Record<string, string> = {
  View: "Ansehen",
  "View On-Call Schedule": "Bereitschaftsplan anzeigen",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      "de-AT": { translation: MIXED_VERBS },
      en: { translation: {} },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("en");
});

interface Schedule {
  id: string;
  name: string;
}

const NIGHTS: Schedule = { id: "nights", name: "Nights and weekends" };

type OnClick = ActionButtonSchema<Schedule>["onClick"];

const view: (
  onClick: Mock<OnClick>,
  extra?: Partial<ActionButtonSchema<Schedule>>,
) => ActionButtonSchema<Schedule> = (
  onClick: Mock<OnClick>,
  extra?: Partial<ActionButtonSchema<Schedule>>,
): ActionButtonSchema<Schedule> => {
  return {
    title: "View On-Call Schedule",
    rowButtonTitle: "View",
    icon: IconProp.Eye,
    buttonStyleType: ButtonStyleType.NORMAL,
    placement: ActionButtonPlacement.Primary,
    onClick: onClick,
    ...(extra || {}),
  };
};

describe("the row's button", () => {
  test("says its short words, and is named by its title", () => {
    const onView: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Schedule> item={NIGHTS} actionButtons={[view(onView)]} />,
    );

    const button: HTMLElement = within(
      screen.getByTestId("row-actions"),
    ).getByRole("button", { name: "View On-Call Schedule" });

    expect(button).toHaveTextContent(/^View$/);
    expect(button).toHaveAttribute("aria-label", "View On-Call Schedule");
    // Speech control finds it by the word it shows: the name starts with it.
    expect(button.getAttribute("aria-label")?.startsWith("View")).toBe(true);

    fireEvent.click(button);
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView.mock.calls[0]![0]).toBe(NIGHTS);
  });

  test("an action with no short words says its title, named by it alone", () => {
    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[
          view(jest.fn<OnClick>(), {
            title: "View Summary",
            rowButtonTitle: undefined,
          }),
        ]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "View Summary",
    });

    expect(button).toHaveTextContent(/^View Summary$/);
    expect(button).not.toHaveAttribute("aria-label");
  });

  test("on a phone's card, the same short words", () => {
    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[view(jest.fn<OnClick>())]}
        isMobile={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: "View On-Call Schedule" }),
    ).toHaveTextContent(/^View$/);
  });

  test("in the ⋯ menu an action says its whole title", () => {
    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[
          {
            title: "Acknowledge",
            icon: IconProp.Check,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: jest.fn<OnClick>(),
          },
          view(jest.fn<OnClick>(), { placement: undefined }),
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Acknowledge" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("row-actions-more-button"));

    expect(
      screen.getByRole("menuitem", { name: /View On-Call Schedule/ }),
    ).toBeInTheDocument();
  });

  test("in German: 'Anzeigen' on the row, named 'Bereitschaftsplan anzeigen'", async () => {
    await i18next.changeLanguage("de");

    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[view(jest.fn<OnClick>())]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Bereitschaftsplan anzeigen",
    });

    expect(button).toHaveTextContent(/^Anzeigen$/);
    // The name holds the word the button shows.
    expect(
      button.getAttribute("aria-label")?.toLowerCase().includes("anzeigen"),
    ).toBe(true);
  });

  /*
   * A voice command says the word it sees, and finds the button only if
   * its name holds that word (WCAG 2.5.3, Label in Name). Where a
   * translation takes one verb for View and another for its titles, the
   * row says the whole title, named by nothing else.
   */
  test("where a translation's title does not hold the short word, the row says the whole title", async () => {
    await i18next.changeLanguage("de-AT");

    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[view(jest.fn<OnClick>())]}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Bereitschaftsplan anzeigen",
    });

    expect(button).toHaveTextContent(/^Bereitschaftsplan anzeigen$/);
    expect(button).not.toHaveAttribute("aria-label");
    expect(screen.queryByText("Ansehen")).toBeNull();
  });

  test("on a phone's card the same: the whole title where the short word is not in it", async () => {
    await i18next.changeLanguage("de-AT");

    render(
      <RowActions<Schedule>
        item={NIGHTS}
        actionButtons={[view(jest.fn<OnClick>())]}
        isMobile={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Bereitschaftsplan anzeigen" }),
    ).toHaveTextContent(/^Bereitschaftsplan anzeigen$/);
  });
});

describe("whether a row's short words are in its name", () => {
  test("in any case, wherever they are in it", () => {
    expect(
      isShortTitleInName({
        title: "View On-Call Schedule",
        shortTitle: "View",
      }),
    ).toBe(true);
    expect(
      isShortTitleInName({
        title: "Bereitschaftsplan anzeigen",
        shortTitle: "Anzeigen",
      }),
    ).toBe(true);
    expect(
      isShortTitleInName({
        title: "インシデントを表示",
        shortTitle: "表示",
      }),
    ).toBe(true);
    expect(
      isShortTitleInName({
        title: "  View Incident ",
        shortTitle: " view ",
      }),
    ).toBe(true);
  });

  test("not when the name says another word, or either is missing", () => {
    expect(
      isShortTitleInName({
        title: "Bereitschaftsplan anzeigen",
        shortTitle: "Ansehen",
      }),
    ).toBe(false);
    expect(
      isShortTitleInName({
        title: "Ver incidente",
        shortTitle: "Visualizar",
      }),
    ).toBe(false);
    expect(isShortTitleInName({ title: "View Incident", shortTitle: "" })).toBe(
      false,
    );
    expect(
      isShortTitleInName({
        title: "View Incident",
        shortTitle: undefined,
      }),
    ).toBe(false);
    expect(isShortTitleInName({ title: undefined, shortTitle: "View" })).toBe(
      false,
    );
  });
});
