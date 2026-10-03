import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import CardMoreMenu from "../../../UI/Components/Card/CardMoreMenu";
import FeedMoreMenu from "../../../UI/Components/Feed/FeedMoreMenu";
import {
  DEFAULT_FEED_OPTIONS,
  FeedOptions,
} from "../../../UI/Components/Feed/FeedOptions";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import { getGlyphOfIcon, getGlyphOfMenuItem } from "./MenuItemIcons";

/*
 * "The filter, sort, and refresh should be combined into a More button in the
 * feeds component, just like we have in the modal table ... It should be
 * exactly the same."
 *
 * A feed's ⋯ menu: the table's card-header ⋯ button, opening the order the
 * feed is read in (a choice, with a tick), the event type filter and Refresh.
 */

type OnChangeMock = ReturnType<typeof jest.fn<(options: FeedOptions) => void>>;
type VoidMock = ReturnType<typeof jest.fn<() => void>>;
type UserEventController = ReturnType<typeof userEvent.setup>;

interface RenderedMenu {
  onChange: OnChangeMock;
  onFilterClick: VoidMock;
  onRefresh: VoidMock;
  result: RenderResult;
}

const renderMenu: (value?: FeedOptions) => RenderedMenu = (
  value: FeedOptions = DEFAULT_FEED_OPTIONS,
): RenderedMenu => {
  const onChange: OnChangeMock = jest.fn<(options: FeedOptions) => void>();
  const onFilterClick: VoidMock = jest.fn<() => void>();
  const onRefresh: VoidMock = jest.fn<() => void>();

  const result: RenderResult = render(
    <FeedMoreMenu
      value={value}
      onChange={onChange}
      onFilterClick={onFilterClick}
      onRefresh={onRefresh}
    />,
  );

  return { onChange, onFilterClick, onRefresh, result };
};

const getTrigger: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "More options" });
};

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(getTrigger());

  return screen.getByRole("menu");
};

// Every item of the open menu, choices and actions, in order.
const getItems: (menu: HTMLElement) => Array<HTMLElement> = (
  menu: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    ),
  );
};

const getItemTexts: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return getItems(menu).map((item: HTMLElement): string => {
    return (item.textContent || "").trim();
  });
};

async function userClick(
  user: UserEventController,
  element: Element,
): Promise<void> {
  await act(async () => {
    await user.click(element);
  });
}

async function userKeyboard(
  user: UserEventController,
  keys: string,
): Promise<void> {
  await act(async () => {
    await user.keyboard(keys);
  });
}

afterEach(() => {
  cleanup();
});

describe("FeedMoreMenu", () => {
  describe("the trigger", () => {
    test("is one closed ⋯ button named More options, with no visible label", () => {
      renderMenu();

      const trigger: HTMLElement = getTrigger();

      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger.textContent).toBe("");
      expect(getGlyphOfMenuItem(trigger)).toBe(
        getGlyphOfIcon(IconProp.EllipsisHorizontal),
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("is exactly the card header's ⋯ (CardMoreMenu), the one a table has", () => {
      renderMenu();
      const feedTrigger: HTMLElement = getTrigger();
      const feedMarkup: string = feedTrigger.outerHTML.replace(
        feedTrigger.id,
        "ID",
      );
      cleanup();

      render(
        <CardMoreMenu>
          {[
            <MoreMenuItem
              key="a"
              text="A"
              icon={IconProp.Add}
              onClick={() => {}}
            />,
          ]}
        </CardMoreMenu>,
      );
      const cardTrigger: HTMLElement = getTrigger();

      expect(cardTrigger.outerHTML.replace(cardTrigger.id, "ID")).toBe(
        feedMarkup,
      );
    });

    test("does not change with the feed's view: a filtered, reversed feed has the same ⋯", () => {
      const { result } = renderMenu();
      const defaultMarkup: string = getTrigger().className;

      result.rerender(
        <FeedMoreMenu
          value={{
            sortOrder: SortOrder.Ascending,
            eventTypes: ["IncidentCreated"],
          }}
          onChange={jest.fn<(options: FeedOptions) => void>()}
          onFilterClick={jest.fn<() => void>()}
          onRefresh={jest.fn<() => void>()}
        />,
      );

      expect(getTrigger().className).toBe(defaultMarkup);
      expect(getTrigger().textContent).toBe("");
    });
  });

  describe("the menu", () => {
    test("holds the sort order under its heading, then the filter, then Refresh", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();

      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
      expect(within(menu).getByText("SORT BY TIME")).toBeVisible();
      expect(getItemTexts(menu)).toEqual([
        "Newest first",
        "Oldest first",
        "Filter by event type",
        "Refresh",
      ]);
    });

    test("offers the two orders as a choice, with the one in use checked", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();
      const radios: Array<HTMLElement> =
        within(menu).getAllByRole("menuitemradio");

      expect(
        radios.map((radio: HTMLElement): string => {
          return (radio.textContent || "").trim();
        }),
      ).toEqual(["Newest first", "Oldest first"]);
      expect(
        within(menu).getByRole("menuitemradio", { name: "Newest first" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        within(menu).getByRole("menuitemradio", { name: "Oldest first" }),
      ).toHaveAttribute("aria-checked", "false");
      // The filter and Refresh are actions, not choices.
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item: HTMLElement): string => {
            return (item.textContent || "").trim();
          }),
      ).toEqual(["Filter by event type", "Refresh"]);
    });

    test("ticks the order in use, and keeps the tick's room on the other so the labels line up", () => {
      renderMenu({ sortOrder: SortOrder.Ascending, eventTypes: [] });

      const menu: HTMLElement = openMenu();
      const newest: HTMLElement = within(menu).getByRole("menuitemradio", {
        name: "Newest first",
      });
      const oldest: HTMLElement = within(menu).getByRole("menuitemradio", {
        name: "Oldest first",
      });

      expect(oldest).toHaveAttribute("aria-checked", "true");
      expect(getGlyphOfMenuItem(oldest)).toBe(getGlyphOfIcon(IconProp.Check));
      expect(newest).toHaveAttribute("aria-checked", "false");
      expect(getGlyphOfMenuItem(newest)).toBe("");
      // The empty slot is the tick's size, so "Newest first" starts where "Oldest first" does.
      expect(
        newest.querySelector('span[aria-hidden="true"].h-4.w-4'),
      ).not.toBeNull();
    });

    test("gives the filter and Refresh their own icons", () => {
      renderMenu();

      const menu: HTMLElement = openMenu();
      const filter: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Filter by event type",
      });
      const refresh: HTMLElement = within(menu).getByRole("menuitem", {
        name: "Refresh",
      });

      expect(getGlyphOfMenuItem(filter)).toBe(getGlyphOfIcon(IconProp.Filter));
      expect(getGlyphOfMenuItem(refresh)).toBe(
        getGlyphOfIcon(IconProp.Refresh),
      );
    });

    test("names the filter item alone, with no count, on a filtered feed too", () => {
      renderMenu({
        sortOrder: SortOrder.Descending,
        eventTypes: ["IncidentCreated", "PublicNote"],
      });

      const menu: HTMLElement = openMenu();

      expect(
        within(menu).getByRole("menuitem", { name: "Filter by event type" }),
      ).toHaveTextContent(/^Filter by event type$/);
      expect(screen.queryByTestId("feed-options-count")).toBeNull();
    });
  });

  describe("picking", () => {
    test("Oldest first reverses the feed, keeps its filter, and closes the menu", () => {
      const { onChange, onFilterClick, onRefresh } = renderMenu({
        sortOrder: SortOrder.Descending,
        eventTypes: ["PublicNote"],
      });

      fireEvent.click(
        within(openMenu()).getByRole("menuitemradio", {
          name: "Oldest first",
        }),
      );

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: ["PublicNote"],
      });
      expect(onFilterClick).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("Newest first turns an oldest-first feed back", () => {
      const { onChange } = renderMenu({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });

      fireEvent.click(
        within(openMenu()).getByRole("menuitemradio", {
          name: "Newest first",
        }),
      );

      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Descending,
        eventTypes: [],
      });
    });

    test("the order already in use changes nothing, and the menu still closes", () => {
      const { onChange } = renderMenu();

      fireEvent.click(
        within(openMenu()).getByRole("menuitemradio", {
          name: "Newest first",
        }),
      );

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("Filter by event type asks for the filter dialog, and changes nothing itself", () => {
      const { onChange, onFilterClick, onRefresh } = renderMenu();

      fireEvent.click(
        within(openMenu()).getByRole("menuitem", {
          name: "Filter by event type",
        }),
      );

      expect(onFilterClick).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("Refresh re-reads the feed, and changes nothing about it", () => {
      const { onChange, onFilterClick, onRefresh } = renderMenu();

      fireEvent.click(
        within(openMenu()).getByRole("menuitem", { name: "Refresh" }),
      );

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(onFilterClick).not.toHaveBeenCalled();
    });
  });

  describe("the keyboard", () => {
    test("opens on Enter at its first item, walks every item with the arrows, and picks with Enter", async () => {
      const user: UserEventController = userEvent.setup();
      const { onChange } = renderMenu();

      act(() => {
        getTrigger().focus();
      });
      await userKeyboard(user, "{Enter}");

      const menu: HTMLElement = screen.getByRole("menu");

      expect(
        within(menu).getByRole("menuitemradio", { name: "Newest first" }),
      ).toHaveFocus();

      await userKeyboard(user, "{ArrowDown}");
      expect(
        within(menu).getByRole("menuitemradio", { name: "Oldest first" }),
      ).toHaveFocus();

      await userKeyboard(user, "{ArrowDown}");
      expect(
        within(menu).getByRole("menuitem", { name: "Filter by event type" }),
      ).toHaveFocus();

      await userKeyboard(user, "{ArrowDown}");
      expect(
        within(menu).getByRole("menuitem", { name: "Refresh" }),
      ).toHaveFocus();

      // Wraps to the top.
      await userKeyboard(user, "{ArrowDown}");
      expect(
        within(menu).getByRole("menuitemradio", { name: "Newest first" }),
      ).toHaveFocus();

      await userKeyboard(user, "{End}");
      await userKeyboard(user, "{ArrowUp}");
      await userKeyboard(user, "{ArrowUp}");
      expect(
        within(menu).getByRole("menuitemradio", { name: "Oldest first" }),
      ).toHaveFocus();

      await userKeyboard(user, "{Enter}");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        sortOrder: SortOrder.Ascending,
        eventTypes: [],
      });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    test("Escape closes the menu and hands focus back to the ⋯", async () => {
      const user: UserEventController = userEvent.setup();
      const { onChange } = renderMenu();

      await userClick(user, getTrigger());
      expect(screen.getByRole("menu")).toBeInTheDocument();

      await userKeyboard(user, "{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(getTrigger()).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("in German", () => {
    const german: i18n = createInstance();

    const GERMAN_TRANSLATIONS: Record<string, string> = {
      "More options": "Weitere Optionen",
      "Sort by time": "Nach Zeit sortieren",
      "Newest first": "Neueste zuerst",
      "Oldest first": "Älteste zuerst",
      "Filter by event type": "Nach Ereignistyp filtern",
      Refresh: "Aktualisieren",
    };

    beforeAll(async () => {
      await german.init({
        lng: "de",
        resources: { de: { translation: GERMAN_TRANSLATIONS } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
    });

    test("names the ⋯ and every item in German", () => {
      render(
        <I18nextProvider i18n={german}>
          <FeedMoreMenu
            value={DEFAULT_FEED_OPTIONS}
            onChange={jest.fn<(options: FeedOptions) => void>()}
            onFilterClick={jest.fn<() => void>()}
            onRefresh={jest.fn<() => void>()}
          />
        </I18nextProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Weitere Optionen" }));

      const menu: HTMLElement = screen.getByRole("menu");

      expect(within(menu).getByText("NACH ZEIT SORTIEREN")).toBeVisible();
      expect(getItemTexts(menu)).toEqual([
        "Neueste zuerst",
        "Älteste zuerst",
        "Nach Ereignistyp filtern",
        "Aktualisieren",
      ]);
      expect(
        within(menu).getByRole("menuitemradio", { name: "Neueste zuerst" }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });
});
