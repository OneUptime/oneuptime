import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Card, { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import { CARD_MORE_MENU_TRIGGER_CLASS_NAME } from "../../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../../UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "../../../../UI/Components/MoreMenu/MoreMenuSection";
import {
  TABLE_HEADER_BUTTONS_CLASS_NAME,
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME,
  TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME,
  TABLE_HEADER_OPEN_SEARCH_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME,
  TABLE_HEADER_TOOLBAR_CLASS_NAME,
  TableHeaderButtonSplit,
  TableHeaderSearchSlot,
  TableHeaderToolbar,
  getTableHeaderButtonLabel,
  getTableHeaderButtons,
  renderTableHeaderMoreMenu,
  splitTableHeaderButtons,
  useTableHeaderSearchShortcut,
} from "../../../../UI/Components/Table/TableHeaderControls";
import {
  MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME,
  MODEL_TABLE_FOLDED_BUTTONS_CLASS_NAME,
  MODEL_TABLE_HEADER_TOOLBAR_CLASS_NAME,
  MODEL_TABLE_PHONE_SEARCH_CLASS_NAME,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * The controls at the right of a table's card header - its search, its
 * main button and the ⋯ that holds everything else - drawn from one module
 * for every table: the model tables and the tables a page builds on
 * Common's Table itself. The maintainer's report was a list whose header
 * held a tall select, a small chip, a text button, a lone icon and a link,
 * "buttons flying everywhere": a table's header now has one search, one ⋯,
 * one height.
 */

afterEach(() => {
  cleanup();
});

const noop: () => void = (): void => {};

function button(overrides: Partial<CardButtonSchema>): CardButtonSchema {
  return {
    title: "",
    icon: IconProp.Refresh,
    buttonStyle: ButtonStyleType.ICON,
    onClick: noop,
    ...overrides,
  };
}

const REFRESH: CardButtonSchema = button({ icon: IconProp.Refresh });
const FILTER: CardButtonSchema = button({ icon: IconProp.Filter });
const CREATE: CardButtonSchema = button({
  title: "Create Monitor",
  icon: IconProp.Add,
  buttonStyle: ButtonStyleType.NORMAL,
});

describe("splitTableHeaderButtons", () => {
  test("keeps the Create button in sight and the rest, in order, for the ⋯", () => {
    const split: TableHeaderButtonSplit = splitTableHeaderButtons([
      REFRESH,
      CREATE,
      FILTER,
    ]);

    expect(split.main).toBe(CREATE);
    expect(split.rest).toEqual([REFRESH, FILTER]);
  });

  test("prefers the Add-icon NORMAL button over an earlier NORMAL one", () => {
    const other: CardButtonSchema = button({
      title: "Import",
      icon: IconProp.Upload,
      buttonStyle: ButtonStyleType.NORMAL,
    });
    const split: TableHeaderButtonSplit = splitTableHeaderButtons([
      other,
      CREATE,
    ]);

    expect(split.main).toBe(CREATE);
    expect(split.rest).toEqual([other]);
  });

  test("falls back to the first NORMAL or PRIMARY button", () => {
    const run: CardButtonSchema = button({
      title: "Run Runbook",
      icon: IconProp.Play,
      buttonStyle: ButtonStyleType.PRIMARY,
    });

    expect(splitTableHeaderButtons([REFRESH, run]).main).toBe(run);
  });

  test("never makes an icon-only button, or an element, the main one", () => {
    const element: ReactElement = <span key="picker">picker</span>;
    const split: TableHeaderButtonSplit = splitTableHeaderButtons([
      REFRESH,
      element,
      FILTER,
    ]);

    expect(split.main).toBeNull();
    expect(split.rest).toEqual([REFRESH, element, FILTER]);
  });
});

describe("getTableHeaderButtonLabel", () => {
  test("names each icon-only header button for the ⋯", () => {
    expect(getTableHeaderButtonLabel(IconProp.Refresh)).toBe("Refresh");
    expect(getTableHeaderButtonLabel(IconProp.Filter)).toBe("Filter");
    expect(getTableHeaderButtonLabel(IconProp.TableCells)).toBe("Columns");
    expect(getTableHeaderButtonLabel(IconProp.Book)).toBe("Documentation");
    expect(getTableHeaderButtonLabel(IconProp.Play)).toBe("Watch Demo");
    expect(getTableHeaderButtonLabel(IconProp.Help)).toBe("Help");
    expect(getTableHeaderButtonLabel(IconProp.Search)).toBe("Search");
    expect(getTableHeaderButtonLabel(IconProp.Add)).toBe("Add");
  });

  test("says Action for any other icon, or none", () => {
    expect(getTableHeaderButtonLabel(IconProp.Bolt)).toBe("Action");
    expect(getTableHeaderButtonLabel(undefined)).toBe("Action");
  });
});

describe("renderTableHeaderMoreMenu", () => {
  function openMenu(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    return screen.getByRole("menu");
  }

  test("is nothing when there is nothing to hold", () => {
    expect(renderTableHeaderMoreMenu([])).toBeNull();
    expect(renderTableHeaderMoreMenu([], { sections: [] })).toBeNull();
  });

  test("names icon-only buttons by their icon and others by their title, each with its icon", () => {
    const onRefresh: MockFunction = getJestMockFunction();
    const named: CardButtonSchema = button({
      title: "Export",
      icon: IconProp.Download,
      buttonStyle: ButtonStyleType.OUTLINE,
    });

    render(
      <div>
        {renderTableHeaderMoreMenu([
          { ...REFRESH, onClick: onRefresh },
          FILTER,
          named,
        ])}
      </div>,
    );

    const menu: HTMLElement = openMenu();
    const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

    expect(
      items.map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      }),
    ).toEqual(["Refresh", "Filter", "Export"]);

    for (const item of items) {
      expect(item.querySelector("svg")).not.toBeNull();
    }

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Refresh" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("a disabled button's item does nothing", () => {
    const onFilter: MockFunction = getJestMockFunction();

    render(
      <div>
        {renderTableHeaderMoreMenu([
          {
            ...FILTER,
            disabled: true,
            onClick: onFilter,
          },
        ])}
      </div>,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Filter" }),
    );

    expect(onFilter).not.toHaveBeenCalled();
  });

  test("draws the sections first, as they are - a sort order's ticked choices", () => {
    render(
      <div>
        {renderTableHeaderMoreMenu([REFRESH], {
          dataTestId: "list-more",
          sections: [
            <MoreMenuSection key="sort" title="Sort">
              <MoreMenuItem
                text="Newest"
                icon={IconProp.Check}
                isIconSpaceReserved={true}
                isChecked={true}
                onClick={noop}
              />
              <MoreMenuItem
                text="Oldest"
                isIconSpaceReserved={true}
                isChecked={false}
                onClick={noop}
              />
            </MoreMenuSection>,
          ],
        })}
      </div>,
    );

    const trigger: HTMLElement = screen.getByTestId("list-more");

    expect(trigger).toHaveAccessibleName("More options");
    expect(trigger).toHaveClass(
      ...CARD_MORE_MENU_TRIGGER_CLASS_NAME.split(" "),
    );

    fireEvent.click(trigger);

    const menu: HTMLElement = screen.getByRole("menu");
    const all: Array<HTMLElement> = Array.from(
      menu.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
    );

    expect(
      all.map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      }),
    ).toEqual(["Newest", "Oldest", "Refresh"]);
    expect(within(menu).getByText("SORT")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Newest" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

describe("getTableHeaderButtons", () => {
  test("hands a card the main button and one ⋯ - never loose icons", () => {
    render(
      <Card
        title="Containers"
        headerLayout="toolbar"
        buttons={getTableHeaderButtons([REFRESH, CREATE, FILTER])}
      />,
    );

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    expect(within(actions).getAllByTestId("card-button")).toHaveLength(1);
    expect(within(actions).getByTestId("card-button")).toHaveTextContent(
      "Create Monitor",
    );
    expect(
      within(actions).getByRole("button", { name: "More options" }),
    ).toBeInTheDocument();
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
  });

  test("a table with only Refresh and Filter has a ⋯ alone", () => {
    render(
      <Card
        title="Kubernetes Events"
        headerLayout="toolbar"
        buttons={getTableHeaderButtons([REFRESH, FILTER])}
      />,
    );

    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    expect(within(actions).queryAllByTestId("card-button")).toHaveLength(0);
    expect(within(actions).getAllByRole("button")).toEqual([
      within(actions).getByRole("button", { name: "More options" }),
    ]);
  });

  test("no buttons, no ⋯", () => {
    expect(getTableHeaderButtons([])).toEqual([]);
  });
});

describe("useTableHeaderSearchShortcut", () => {
  function Harness(props: {
    isEnabled: boolean;
    onOpen: () => void;
  }): ReactElement {
    useTableHeaderSearchShortcut(props.isEnabled, props.onOpen);

    return (
      <div>
        <input data-testid="other-input" />
        <textarea data-testid="other-textarea" />
        <div data-testid="editable" contentEditable={true} />
      </div>
    );
  }

  test('"/" opens the search, and nothing else does', () => {
    const onOpen: MockFunction = getJestMockFunction();

    render(<Harness isEnabled={true} onOpen={onOpen} />);

    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true });
    fireEvent.keyDown(document.body, { key: "/", altKey: true });

    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "/" });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('a "/" typed into a field is the field\'s', () => {
    const onOpen: MockFunction = getJestMockFunction();

    render(<Harness isEnabled={true} onOpen={onOpen} />);

    fireEvent.keyDown(screen.getByTestId("other-input"), { key: "/" });
    fireEvent.keyDown(screen.getByTestId("other-textarea"), { key: "/" });

    expect(onOpen).not.toHaveBeenCalled();
  });

  test("a table without a search does not take the key", () => {
    const onOpen: MockFunction = getJestMockFunction();

    render(<Harness isEnabled={false} onOpen={onOpen} />);

    fireEvent.keyDown(document.body, { key: "/" });

    expect(onOpen).not.toHaveBeenCalled();
  });

  test("calls the newest handler and stops listening once unmounted", () => {
    const first: MockFunction = getJestMockFunction();
    const second: MockFunction = getJestMockFunction();
    const view: ReturnType<typeof render> = render(
      <Harness isEnabled={true} onOpen={first} />,
    );

    view.rerender(<Harness isEnabled={true} onOpen={second} />);
    fireEvent.keyDown(document.body, { key: "/" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    view.unmount();
    fireEvent.keyDown(document.body, { key: "/" });

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("TableHeaderSearchSlot", () => {
  test("folded, it is the 'Search… /' pill and the control is out of reach", () => {
    const onOpen: MockFunction = getJestMockFunction();

    render(
      <TableHeaderSearchSlot isOpen={false} onOpen={onOpen}>
        <input data-testid="control" />
      </TableHeaderSearchSlot>,
    );

    const slot: HTMLElement = screen.getByTestId("model-table-search-slot");
    const pill: HTMLElement = screen.getByRole("button", {
      name: "Open search",
    });

    expect(slot).toHaveClass(...TABLE_HEADER_SEARCH_CLASS_NAME.split(" "));
    expect(pill).toHaveAttribute("tabindex", "0");
    expect(pill).toHaveAttribute("title", "Search (/)");
    expect(pill).toHaveTextContent("Search…");
    expect(
      screen.getByTestId("control").parentElement as HTMLElement,
    ).toHaveClass("pointer-events-none", "opacity-0");

    fireEvent.click(pill);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("the pill shows the keyboard's focus with the ring the header's other controls wear", () => {
    render(
      <TableHeaderSearchSlot isOpen={false} onOpen={noop}>
        <input data-testid="control" />
      </TableHeaderSearchSlot>,
    );

    const pill: HTMLElement = screen.getByRole("button", {
      name: "Open search",
    });

    /*
     * The time range and the ⋯ beside it draw an indigo ring 2px off their
     * border; the pill drew the browser's own black one.
     */
    expect(TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME.split(" ")).toEqual([
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
      "focus-visible:ring-offset-2",
    ]);
    expect(pill).toHaveClass(
      ...TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME.split(" "),
    );
    expect(CARD_MORE_MENU_TRIGGER_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(
        TABLE_HEADER_SEARCH_PILL_FOCUS_CLASS_NAME.split(" "),
      ),
    );
  });

  test("opened, the control shows at the open width and the pill steps aside", () => {
    render(
      <TableHeaderSearchSlot isOpen={true} onOpen={noop} dataTestId="slot">
        <input data-testid="control" />
      </TableHeaderSearchSlot>,
    );

    const slot: HTMLElement = screen.getByTestId("slot");

    expect(slot).toHaveClass(...TABLE_HEADER_OPEN_SEARCH_CLASS_NAME.split(" "));
    expect(screen.getByRole("button", { name: "Open search" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(
      screen.getByTestId("control").parentElement as HTMLElement,
    ).toHaveClass("opacity-100");
  });

  test("takes a narrower open width for a header that keeps its buttons beside it", () => {
    render(
      <TableHeaderSearchSlot
        isOpen={true}
        onOpen={noop}
        openClassName={TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME}
      >
        <input />
      </TableHeaderSearchSlot>,
    );

    expect(screen.getByTestId("model-table-search-slot")).toHaveClass(
      ...TABLE_HEADER_OPEN_SEARCH_BESIDE_BUTTONS_CLASS_NAME.split(" "),
    );
  });
});

describe("TableHeaderToolbar", () => {
  test("is the header's one row of controls, filling a phone's line", () => {
    render(
      <TableHeaderToolbar>
        <button type="button">Create</button>
      </TableHeaderToolbar>,
    );

    const toolbar: HTMLElement = screen.getByTestId(
      "model-table-header-toolbar",
    );

    expect(toolbar).toHaveClass(...TABLE_HEADER_TOOLBAR_CLASS_NAME.split(" "));
    expect(toolbar).toHaveAttribute("data-toolbar-fill", "true");
  });

  test("folds its buttons away beside an opened search, as a model table does", () => {
    render(
      <TableHeaderToolbar isSearchOpen={true} search={<div>search</div>}>
        <button type="button">Create</button>
      </TableHeaderToolbar>,
    );

    const wrapper: HTMLElement = screen.getByText("Create")
      .parentElement as HTMLElement;

    expect(wrapper).toHaveClass(
      ...TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME.split(" "),
    );
    expect(wrapper).toHaveAttribute("aria-hidden", "true");
  });

  test("keeps them beside it when asked: a list's time range is needed while searching", () => {
    render(
      <TableHeaderToolbar
        isSearchOpen={true}
        keepButtonsWhileSearching={true}
        search={<div>search</div>}
      >
        <button type="button">Past 1 Day</button>
      </TableHeaderToolbar>,
    );

    const wrapper: HTMLElement = screen.getByText("Past 1 Day")
      .parentElement as HTMLElement;

    expect(wrapper).toHaveClass(...TABLE_HEADER_BUTTONS_CLASS_NAME.split(" "));
    expect(wrapper).not.toHaveClass("invisible");
    expect(wrapper).toHaveAttribute("aria-hidden", "false");
  });
});

describe("one look for every table's header", () => {
  test("the model tables' names for the header's classes are the shared ones", () => {
    expect(MODEL_TABLE_HEADER_TOOLBAR_CLASS_NAME).toBe(
      TABLE_HEADER_TOOLBAR_CLASS_NAME,
    );
    expect(MODEL_TABLE_PHONE_SEARCH_CLASS_NAME).toBe(
      TABLE_HEADER_SEARCH_CLASS_NAME,
    );
    expect(MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME).toBe(
      TABLE_HEADER_OPEN_SEARCH_CLASS_NAME,
    );
    expect(MODEL_TABLE_FOLDED_BUTTONS_CLASS_NAME).toBe(
      TABLE_HEADER_FOLDED_BUTTONS_CLASS_NAME,
    );
  });

  test("a control beside the buttons is as tall as they are: 42px on a phone, 38px from md", () => {
    /*
     * The ⋯ trigger and a normal Button: py-2.5 below md and py-2 from md
     * up around a 20px line, inside a 1px border.
     */
    expect(TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME.split(" ")).toEqual([
      "py-2.5",
      "md:py-2",
    ]);
    expect(CARD_MORE_MENU_TRIGGER_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["py-2.5", "md:py-2", "border"]),
    );
  });

  test("the x that empties a search hangs over its 20px line instead of growing it", () => {
    /*
     * p-1 around a 14px icon is a 22px circle. It appears with the first
     * letter typed; without the -my-1 the search stood 40px beside its
     * 38px neighbours and the card's description moved 2px down.
     */
    const classes: Array<string> =
      TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME.split(" ");

    expect(classes).toEqual(expect.arrayContaining(["-my-1", "p-1"]));
    expect(classes).toEqual(
      expect.arrayContaining([
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      ]),
    );
  });
});
