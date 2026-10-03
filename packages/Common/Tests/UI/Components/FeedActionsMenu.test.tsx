import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import IconProp from "../../../Types/Icon/IconProp";
import FeedActionsMenu from "../../../UI/Components/Feed/FeedActionsMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import { getGlyphOfIcon, getGlyphOfSvg } from "./MenuItemIcons";

/*
 * A feed's main action: the Actions menu the incident, alert, episode and
 * scheduled maintenance feeds keep in sight beside their ⋯. One component, so
 * every feed's Actions looks the same - and is named in the reader's
 * language, which the five hand-built copies it replaced were not.
 */

type ClickMock = ReturnType<typeof jest.fn<() => void>>;
type UserEventController = ReturnType<typeof userEvent.setup>;

interface Rendered {
  addPublicNote: ClickMock;
  addPrivateNote: ClickMock;
}

const renderMenu: (
  wrap?: (ui: React.ReactElement) => React.ReactElement,
) => Rendered = (
  wrap: (ui: React.ReactElement) => React.ReactElement = (
    ui: React.ReactElement,
  ): React.ReactElement => {
    return ui;
  },
): Rendered => {
  const addPublicNote: ClickMock = jest.fn<() => void>();
  const addPrivateNote: ClickMock = jest.fn<() => void>();

  render(
    wrap(
      <FeedActionsMenu>
        {[
          <MoreMenuItem
            key="public"
            text="Add Public Note"
            icon={IconProp.Announcement}
            onClick={addPublicNote}
          />,
          <MoreMenuItem
            key="private"
            text="Add Private Note"
            icon={IconProp.Lock}
            onClick={addPrivateNote}
          />,
        ]}
      </FeedActionsMenu>,
    ),
  );

  return { addPublicNote, addPrivateNote };
};

const getTrigger: (name?: string) => HTMLElement = (
  name: string = "Actions",
): HTMLElement => {
  return screen.getByRole("button", { name });
};

afterEach(() => {
  cleanup();
});

describe("FeedActionsMenu", () => {
  test("is one bordered Actions button with the bolt in front and a chevron after", () => {
    renderMenu();

    const trigger: HTMLElement = getTrigger();
    const face: HTMLElement = screen.getByTestId("feed-actions-button");

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toContainElement(face);
    expect(face).toHaveTextContent(/^Actions$/);
    expect(face).toHaveClass("rounded-lg", "border", "border-gray-300");

    const glyphs: Array<string> = Array.from(face.querySelectorAll("svg")).map(
      (svg: SVGElement): string => {
        return getGlyphOfSvg(svg);
      },
    );

    expect(glyphs).toEqual([
      getGlyphOfIcon(IconProp.Bolt),
      getGlyphOfIcon(IconProp.ChevronDown),
    ]);
  });

  test("opens the feed's actions, runs the one picked once, and closes", () => {
    const { addPublicNote, addPrivateNote } = renderMenu();

    fireEvent.click(getTrigger());

    const menu: HTMLElement = screen.getByRole("menu");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Add Public Note", "Add Private Note"]);

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Add Private Note" }),
    );

    expect(addPrivateNote).toHaveBeenCalledTimes(1);
    expect(addPublicNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("opens from the keyboard and walks its actions with the arrows", async () => {
    const user: UserEventController = userEvent.setup();
    const { addPublicNote } = renderMenu();

    act(() => {
      getTrigger().focus();
    });

    await act(async () => {
      await user.keyboard("{Enter}");
    });

    const menu: HTMLElement = screen.getByRole("menu");

    expect(
      within(menu).getByRole("menuitem", { name: "Add Public Note" }),
    ).toHaveFocus();

    await act(async () => {
      await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    });

    expect(addPublicNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("is named in the reader's language", async () => {
    const german: i18n = createInstance();

    await german.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            Actions: "Aktionen",
            "Add Public Note": "Öffentliche Notiz hinzufügen",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    renderMenu((ui: React.ReactElement): React.ReactElement => {
      return <I18nextProvider i18n={german}>{ui}</I18nextProvider>;
    });

    const trigger: HTMLElement = getTrigger("Aktionen");

    expect(screen.getByTestId("feed-actions-button")).toHaveTextContent(
      /^Aktionen$/,
    );

    fireEvent.click(trigger);

    expect(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Öffentliche Notiz hinzufügen",
      }),
    ).toBeVisible();
  });
});
