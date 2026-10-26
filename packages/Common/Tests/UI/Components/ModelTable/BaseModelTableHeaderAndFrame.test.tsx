import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A table's card header and, for a table drawn without a card, its frame
 * (model-table-ui).
 *
 * A table's header holds a row of controls - search, saved views, the main
 * button and the ⋯ - and beside them the card's description was squeezed
 * into a column four lines tall at 900px. Every ModelTable card now uses
 * Card's toolbar header: the title and the controls share the first line,
 * the description runs under both. A page that names its own header layout
 * keeps it.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME,
  MODEL_TABLE_FOLDED_BUTTONS_CLASS_NAME,
  MODEL_TABLE_FRAME_CLASS_NAME,
  MODEL_TABLE_HEADER_TOOLBAR_CLASS_NAME,
  MODEL_TABLE_PHONE_SEARCH_CLASS_NAME,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import {
  CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE,
  CARD_HEADER_TOOLBAR_FILL_CLASS_NAME,
  CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
  ComponentProps as CardProps,
} from "../../../../UI/Components/Card/Card";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import {
  TABLE_HEADER_MAIN_AND_MORE_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
} from "../../../../UI/Components/Table/TableHeaderControls";
import IconProp from "../../../../Types/Icon/IconProp";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const ROWS: Array<JSONObject> = [
  { _id: "60000000-0000-4000-8000-000000000001", name: "Checkout API" },
];

type MakePropsFunction = (
  cardProps: CardProps | undefined,
) => BaseModelTableProps<Monitor>;

const makeProps: MakePropsFunction = (
  cardProps: CardProps | undefined,
): BaseModelTableProps<Monitor> => {
  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return {
        data: ROWS as unknown as Array<Monitor>,
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: Monitor,
    id: "monitors-frame-table",
    name: "Monitors",
    singularName: "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: "monitors-frame-table",
    disableUrlState: true,
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    filters: [],
    cardProps: cardProps,
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    searchableFields: ["name"],
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a table's card header", () => {
  test("is the toolbar header: title and controls on one line, the description under both", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitors",
          description: "Monitors check your websites and APIs.",
        })}
      />,
    );

    await screen.findByText("Checkout API");

    const header: HTMLElement = screen.getByTestId("card-header");

    expect(header).toHaveAttribute("data-header-layout", "toolbar");

    const row: HTMLElement = within(header).getByTestId(
      "card-header-title-row",
    );

    // The title and the controls (search) in the one row.
    expect(within(row).getByTestId("card-header-title-block").className).toBe(
      CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
    );
    expect(within(row).getByTestId("card-header-actions")).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Open search" }),
    ).toBeInTheDocument();

    // The description after the row, across the card.
    const description: HTMLElement =
      within(header).getByTestId("card-description");

    expect(row).not.toContainElement(description);
    expect(header.lastElementChild).toBe(description);
  });

  test("a page that names its own header layout keeps it", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitors",
          description: "In a one-third column.",
          headerLayout: "stacked",
        })}
      />,
    );

    await screen.findByText("Checkout API");

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  });

  test("so does one that asks for the default header", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitors",
          description: "Beside the title.",
          headerLayout: "default",
        })}
      />,
    );

    await screen.findByText("Checkout API");

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "default",
    );
  });
});

describe("a table drawn without a card", () => {
  test("is framed as a card is: one hairline, rounded, white, padded to what its rows reach out to", async () => {
    const { container } = render(
      <BaseModelTable<Monitor> {...makeProps(undefined)} />,
    );

    await screen.findByText("Checkout API");

    const frame: HTMLElement | null = container.querySelector(
      `[class="${MODEL_TABLE_FRAME_CLASS_NAME}"]`,
    );

    expect(frame).not.toBeNull();
    expect(MODEL_TABLE_FRAME_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "rounded-xl",
        "border",
        "border-gray-200",
        "bg-white",
        // A card's padding: 20px on a phone, 24px from md up.
        "px-5",
        "md:px-6",
        "pb-6",
        "overflow-clip",
      ]),
    );
    expect(MODEL_TABLE_FRAME_CLASS_NAME.split(" ")).not.toContain("px-6");
    // Not the old 2px border, and nothing that would stop the header sticking.
    expect(frame).not.toHaveClass("border-2");
    expect(frame).not.toHaveClass("overflow-hidden");
    expect(frame).toContainElement(screen.getByTestId("table-scroll"));
    expect(screen.getByTestId("table-scroll")).not.toHaveClass(
      "overflow-hidden",
    );
    expect(frame).toContainElement(screen.getByTestId("table-footer"));
  });
});

describe("a table's header controls on a phone", () => {
  /*
   * The search was a 176px pill hung at the right edge on a line of its
   * own, over the buttons; opened, it stopped short of the card's left edge
   * while the folded buttons beside it reached 31px past the screen and let
   * the page scroll sideways. On a phone the controls take the card's width
   * and the search fills its line.
   */
  const renderWithSearch: () => Promise<void> = async (): Promise<void> => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Monitors",
          description: "Monitors check your websites and APIs.",
        })}
      />,
    );

    await screen.findByText("Checkout API");
  };

  /*
   * The row wraps on a phone. The main button and the ⋯ were two items of
   * it, and Scheduled Maintenance's list drew its ⋯ on a line of its own,
   * under a "Create Scheduled Maintenance Event" that filled the line. They
   * are one item of the row now, so they wrap together.
   */
  test("the main button and the ⋯ are one item of the row, so they wrap together", async () => {
    render(
      <BaseModelTable<Monitor>
        {...makeProps({
          title: "Scheduled Maintenance Events",
          buttons: [
            {
              title: "Create Scheduled Maintenance Event",
              buttonStyle: ButtonStyleType.NORMAL,
              icon: IconProp.Add,
              onClick: (): void => {},
            },
          ],
        })}
        showRefreshButton={true}
      />,
    );

    await screen.findByText("Checkout API");

    const row: HTMLElement = screen.getByTestId("model-table-header-toolbar")
      .lastElementChild as HTMLElement;
    const pair: HTMLElement = screen.getByTestId("model-table-main-and-more");

    expect(pair.parentElement).toBe(row);
    expect(pair).toHaveClass(
      ...TABLE_HEADER_MAIN_AND_MORE_CLASS_NAME.split(" "),
    );
    expect(within(pair).getAllByRole("button")).toEqual([
      within(pair).getByTestId("card-button"),
      within(pair).getByRole("button", { name: "More options" }),
    ]);
    expect(within(pair).getByTestId("card-button")).toHaveTextContent(
      "Create Scheduled Maintenance Event",
    );
  });

  test("the controls' row says it fills the toolbar's line, and Card lets it on a phone", async () => {
    await renderWithSearch();

    const toolbar: HTMLElement = screen.getByTestId(
      "model-table-header-toolbar",
    );

    expect(CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE).toBe("data-toolbar-fill");
    expect(toolbar).toHaveAttribute(CARD_HEADER_TOOLBAR_FILL_ATTRIBUTE, "true");
    expect(toolbar.className).toBe(MODEL_TABLE_HEADER_TOOLBAR_CLASS_NAME);
    expect(toolbar).toHaveClass("max-md:w-full", "flex-wrap", "justify-end");

    // The toolbar's actions, and the box the row is in, take the card's width.
    const fill: Array<string> = CARD_HEADER_TOOLBAR_FILL_CLASS_NAME.split(" ");

    expect(screen.getByTestId("card-header-actions")).toHaveClass(...fill);
    expect(toolbar.parentElement).toHaveClass(...fill);
  });

  test("folded, the search fills its line on a phone, and is the 14rem pill from md up", async () => {
    await renderWithSearch();

    const slot: HTMLElement = screen.getByTestId("model-table-search-slot");

    expect(slot).toHaveClass(...MODEL_TABLE_PHONE_SEARCH_CLASS_NAME.split(" "));
    expect(MODEL_TABLE_PHONE_SEARCH_CLASS_NAME.split(" ")).toEqual([
      "max-md:min-w-[11rem]",
      "max-md:flex-1",
      "md:w-56",
      // From md up too, while the controls are on a line of their own.
      "[[data-actions-under-title=true]_&]:min-w-[11rem]",
      "[[data-actions-under-title=true]_&]:flex-1",
    ]);
    // No fixed phone width of its own any more.
    expect(slot).not.toHaveClass("w-44");
  });

  test("opened, it is the card's width on a phone; the buttons beside it fold away without spilling past the card", async () => {
    await renderWithSearch();

    const toolbar: HTMLElement = screen.getByTestId(
      "model-table-header-toolbar",
    );
    const buttons: HTMLElement = toolbar.lastElementChild as HTMLElement;

    // Folded only while the search is open: the ⋯ menu opens out of them.
    expect(buttons).not.toHaveClass("overflow-hidden");
    expect(buttons).not.toHaveClass("invisible");
    expect(buttons).toHaveClass("max-w-[600px]");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    });

    const slot: HTMLElement = screen.getByTestId("model-table-search-slot");

    expect(slot).toHaveClass(
      ...MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME.split(" "),
    );
    expect(MODEL_TABLE_EXPANDED_SEARCH_CLASS_NAME.split(" ")).toEqual([
      "w-full",
      "md:w-[26rem]",
      "lg:w-[32rem]",
      // What the buttons leave of a line of their own.
      "[[data-actions-under-title=true]_&]:flex-1",
    ]);

    expect(buttons).toHaveClass(
      ...MODEL_TABLE_FOLDED_BUTTONS_CLASS_NAME.split(" "),
    );
    // Clipped, and on one line - squeezed, "Create Monitor" broke over two.
    expect(buttons).toHaveClass(
      "max-w-0",
      "overflow-hidden",
      "whitespace-nowrap",
      "pointer-events-none",
    );
    // Out of the keyboard's way too, as of a screen reader's.
    expect(buttons).toHaveClass("invisible");
    expect(buttons).toHaveAttribute("aria-hidden", "true");
  });

  /*
   * Tab goes from the opened search to its x. It showed the browser's own
   * black ring there; it shows the focus as the header's buttons do.
   */
  test("the opened search's x shows the keyboard focus as the header's buttons do", async () => {
    await renderWithSearch();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    });

    const slot: HTMLElement = screen.getByTestId("model-table-search-slot");

    act(() => {
      fireEvent.change(within(slot).getByRole("textbox"), {
        target: { value: "checkout" },
      });
    });

    const clear: HTMLElement = within(slot).getByRole("button", {
      name: "Clear search",
    });

    expect(clear).toHaveClass(
      ...TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME.split(" "),
    );
    expect(clear).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
  });
});
