import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import Table, { BulkActionProps } from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

/*
 * Rows the table refuses to let you tick, and rows that finally say who they
 * are.
 *
 * Both of these exist because of one shape of bug: a bulk action whose
 * precondition is knowable BEFORE the click, discovered only afterwards. The
 * on-call readiness table is the first caller - a responder who is already ready
 * has nothing to be reminded of, and the server answers SkippedNothingMissing
 * for them - but the property is general, and so is the failure it prevents:
 * letting somebody select a row, confirm a modal naming it, and then be told it
 * did not count.
 *
 * The accessible name is the same argument one level down. The table used to
 * draw an unnamed checkbox in every row, so a screen reader user heard
 * "checkbox" once per row with nothing to tell them apart, and a test could not
 * address one row's box at all. `bulkItemToString` was already required for the
 * bulk-action failure list; it now names the box too, which means a caller
 * cannot have one without the other.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  isLocked?: boolean | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const data: Array<Row> = [
  { _id: "1", name: "Alpha", isLocked: false },
  { _id: "2", name: "Beta", isLocked: true },
  { _id: "3", name: "Gamma", isLocked: false },
];

const bulkActions: BulkActionProps<Row> = {
  buttons: [
    {
      title: "Archive",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  ],
};

interface RenderTableOptions {
  bulkSelectedItems?: Array<Row> | undefined;
  isItemSelectable?: ((item: Row) => boolean) | undefined;
  itemNotSelectableReason?: ((item: Row) => string) | undefined;
  bulkItemToString?: ((item: Row) => string) | undefined;
  onBulkSelectedItemAdded?: ((item: Row) => void) | undefined;
  onBulkSelectItemsOnCurrentPage?: (() => void) | undefined;
}

type RenderTableFunction = (options: RenderTableOptions) => RenderResult;

const renderTable: RenderTableFunction = (
  options: RenderTableOptions,
): RenderResult => {
  return render(
    <Table<Row>
      id="test-table"
      data={data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      matchBulkSelectedItemByField="_id"
      bulkActions={bulkActions}
      bulkSelectedItems={options.bulkSelectedItems || []}
      bulkItemToString={
        options.bulkItemToString ||
        ((item: Row): string => {
          return item.name || "";
        })
      }
      isItemSelectable={options.isItemSelectable}
      itemNotSelectableReason={options.itemNotSelectableReason}
      onBulkSelectedItemAdded={options.onBulkSelectedItemAdded}
      onBulkSelectItemsOnCurrentPage={options.onBulkSelectItemsOnCurrentPage}
    />,
  );
};

const isUnlocked: (item: Row) => boolean = (item: Row): boolean => {
  return !item.isLocked;
};

describe("a table row that cannot be selected", () => {
  test("its checkbox is disabled", () => {
    renderTable({ isItemSelectable: isUnlocked });

    expect(screen.getByLabelText("Select Beta")).toBeDisabled();
  });

  test("every other row is still selectable", () => {
    renderTable({ isItemSelectable: isUnlocked });

    expect(screen.getByLabelText("Select Alpha")).toBeEnabled();
    expect(screen.getByLabelText("Select Gamma")).toBeEnabled();
  });

  /*
   * A box that cannot be ticked and does not say why reads as broken rather than
   * as deliberate, and the hover text is the only place that reason can live on
   * a disabled control.
   */
  test("it says why, in the caller's own words", () => {
    renderTable({
      isItemSelectable: isUnlocked,
      itemNotSelectableReason: (): string => {
        return "This one is locked";
      },
    });

    expect(screen.getByLabelText("Select Beta")).toHaveAttribute(
      "title",
      "This one is locked",
    );
  });

  test("without a reason it falls back to its own name rather than to nothing", () => {
    renderTable({ isItemSelectable: isUnlocked });

    expect(screen.getByLabelText("Select Beta")).toHaveAttribute(
      "title",
      "Select Beta",
    );
  });

  /*
   * The guard is on the change handler as well as on the disabled attribute.
   * jsdom will happily dispatch a change event at a disabled input, and so will
   * a synthetic click from an automation harness - the row must not enter the
   * selection either way.
   */
  test("firing a change at it anyway does not select it", () => {
    const added: Array<Row> = [];

    renderTable({
      isItemSelectable: isUnlocked,
      onBulkSelectedItemAdded: (item: Row): void => {
        added.push(item);
      },
    });

    fireEvent.click(screen.getByLabelText("Select Beta"));

    expect(added).toHaveLength(0);
  });
});

describe("the header checkbox, when some rows cannot be selected", () => {
  /*
   * "All selected" has to mean all of the SELECTABLE rows. Counting the locked
   * ones against it leaves the header box permanently empty on any page holding
   * one, which reads as "your selection was lost" rather than as "one row here
   * is not yours to pick".
   */
  test("it fills once every selectable row is selected", () => {
    renderTable({
      isItemSelectable: isUnlocked,
      bulkSelectedItems: [data[0]!, data[2]!],
    });

    expect(screen.getByLabelText("Select all items")).toBeChecked();
  });

  test("it is half-filled while only some of them are", () => {
    renderTable({
      isItemSelectable: isUnlocked,
      bulkSelectedItems: [data[0]!],
    });

    expect(
      (screen.getByLabelText("Select all items") as HTMLInputElement)
        .indeterminate,
    ).toBe(true);
  });

  test("it is empty while none of them are", () => {
    renderTable({ isItemSelectable: isUnlocked });

    const box: HTMLInputElement = screen.getByLabelText(
      "Select all items",
    ) as HTMLInputElement;

    expect(box).not.toBeChecked();
    expect(box.indeterminate).toBe(false);
  });

  /*
   * A page with nothing selectable on it offers nothing to select. A ticked
   * header box over three locked rows would be claiming a selection that does
   * not exist.
   */
  test("a page of entirely locked rows leaves it disabled and empty", () => {
    renderTable({
      isItemSelectable: (): boolean => {
        return false;
      },
    });

    const box: HTMLInputElement = screen.getByLabelText(
      "Select all items",
    ) as HTMLInputElement;

    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });
});

describe("a table that says nothing about selectability", () => {
  /*
   * The whole feature is opt-in. Every table in the product predates it, and a
   * default that locked anything would be a silent regression across all of
   * them.
   */
  test("every row stays selectable", () => {
    renderTable({});

    expect(screen.getByLabelText("Select Alpha")).toBeEnabled();
    expect(screen.getByLabelText("Select Beta")).toBeEnabled();
    expect(screen.getByLabelText("Select Gamma")).toBeEnabled();
  });

  test("all selected still means all rows", () => {
    renderTable({ bulkSelectedItems: [...data] });

    expect(screen.getByLabelText("Select all items")).toBeChecked();
  });
});

describe("row checkbox names", () => {
  test("each row's box is named after the row", () => {
    renderTable({});

    expect(screen.getByLabelText("Select Alpha")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Gamma")).toBeInTheDocument();
  });

  /*
   * Without bulkItemToString there is nothing to name a row with, and inventing
   * one ("Select row 2") would be worse than silence: it names a position that
   * changes the moment the table is sorted.
   */
  test("a table with nothing to name rows by leaves them unnamed", () => {
    render(
      <Table<Row>
        id="unnamed-table"
        data={data}
        columns={columns}
        currentPageNumber={1}
        totalItemsCount={data.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
        matchBulkSelectedItemByField="_id"
        bulkActions={bulkActions}
        bulkSelectedItems={[]}
      />,
    );

    expect(screen.queryByLabelText("Select Alpha")).toBeNull();
    // The header box is named by the table itself, so it is there regardless.
    expect(screen.getByLabelText("Select all items")).toBeInTheDocument();
  });
});
