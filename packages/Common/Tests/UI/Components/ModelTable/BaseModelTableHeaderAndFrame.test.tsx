import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  MODEL_TABLE_FRAME_CLASS_NAME,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import {
  CARD_HEADER_TOOLBAR_TITLE_BLOCK_CLASS_NAME,
  ComponentProps as CardProps,
} from "../../../../UI/Components/Card/Card";
import FieldType from "../../../../UI/Components/Types/FieldType";
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
        "px-6",
        "pb-6",
        "overflow-clip",
      ]),
    );
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
