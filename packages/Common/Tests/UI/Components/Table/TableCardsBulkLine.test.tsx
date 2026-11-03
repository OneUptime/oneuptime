import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement, useState } from "react";
import Table, { BulkActionProps } from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { forgetRememberedTableFits } from "../../../../UI/Components/Table/useTableFit";
import {
  TABLE_CARDS_BULK_LINE_TEST_ID,
  TABLE_CARDS_HEADER_TEST_ID,
  TABLE_CARDS_SORT_TEST_ID,
} from "../../../../UI/Components/Table/TableCardsHeader";
import {
  TABLE_CARDS_BOX_SLOT_CLASS_NAME,
  TABLE_CARDS_HEADER_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import {
  BULK_ROW_ACTIONS_TEST_ID,
  BULK_ROW_COUNT_TEST_ID,
  BULK_ROW_SELECT_ALL_TEST_ID,
  BULK_ROW_TEST_ID,
  BulkActionOnClickProps,
} from "../../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "../../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../Types/GenericObject";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * A TABLE'S BULK ACTIONS IN THE BAND OVER ITS CARDS.
 *
 * "Tables keep their three-line bulk bar on phones; the exceptions list's
 * one-line Row layout could serve the other lists that have a header line
 * of their own" - the maintainer's follow-up to #5344. On a phone (and in a
 * box too narrow for its rows) a table is drawn as cards under a band that
 * holds the box selecting the page and the order the list is in
 * (TableCardsHeader). Ticking the first card drew a grey bar of its own over
 * the band - the count, Select All, Clear Selection and Bulk Actions on
 * three lines, some 170px - that pushed every card down under the finger.
 * Now the band is the line: how many, a × to clear them, every match on
 * offer once the page is ticked, and Bulk Actions where the order sits.
 * Rows keep their bar.
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

interface Monitor extends GenericObject {
  _id: string;
  name: string;
  status: string;
}

const MONITORS: Array<Monitor> = [
  { _id: "1", name: "Checkout API", status: "Operational" },
  { _id: "2", name: "Marketing Website", status: "Degraded" },
  { _id: "3", name: "Primary Database Ping", status: "Operational" },
];

// Every monitor that matches: the page's three and more on later pages.
const ALL_MONITORS: Array<Monitor> = [
  ...MONITORS,
  ...Array.from({ length: 34 }, (_value: unknown, index: number): Monitor => {
    return {
      _id: String(index + 4),
      name: `Regional health check ${index + 1}`,
      status: "Operational",
    };
  }),
];

const COLUMNS: Columns<Monitor> = [
  { key: "name", title: "Name", type: FieldType.Text },
  { key: "status", title: "Status", type: FieldType.Text },
];

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const archived: Array<string> = [];
let finishArchive: () => void = (): void => {};

function bulkActions(holdsRun: boolean): BulkActionProps<Monitor> {
  return {
    buttons: [
      {
        title: "Archive",
        icon: IconProp.Archive,
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          const held: Promise<void> = holdsRun
            ? new Promise<void>((resolve: () => void) => {
                finishArchive = resolve;
              })
            : Promise.resolve();

          await runBulkAction<Monitor>({
            actionProps: actionProps,
            step: async (monitor: Monitor): Promise<void> => {
              await held;
              archived.push(monitor._id);
            },
          });
        },
      },
    ],
  };
}

interface HarnessProps {
  total?: number | undefined;
  holdsRun?: boolean | undefined;
  hasMore?: boolean | undefined;
}

/*
 * A table the way BaseModelTable draws one: the selection held above it,
 * Select All reading every match.
 */
function Harness(props: HarnessProps): ReactElement {
  const [selected, setSelected] = useState<Array<Monitor>>([]);
  const [selectionTotal, setSelectionTotal] = useState<number>(0);
  const [sortBy, setSortBy] = useState<keyof Monitor | null>("name");

  return (
    <Table<Monitor>
      id="monitors-table"
      data={MONITORS}
      columns={COLUMNS}
      currentPageNumber={1}
      totalItemsCount={props.total ?? ALL_MONITORS.length}
      hasMore={props.hasMore}
      itemsOnPage={3}
      error=""
      isLoading={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={sortBy}
      onSortChanged={(by: keyof Monitor | null) => {
        setSortBy(by);
      }}
      onNavigateToPage={() => {}}
      matchBulkSelectedItemByField="_id"
      bulkActions={bulkActions(Boolean(props.holdsRun))}
      disableBulkCsvExport={true}
      bulkSelectedItems={selected}
      onBulkSelectedItemAdded={(monitor: Monitor) => {
        setSelected((current: Array<Monitor>): Array<Monitor> => {
          return [...current, monitor];
        });
      }}
      onBulkSelectedItemRemoved={(monitor: Monitor) => {
        setSelected((current: Array<Monitor>): Array<Monitor> => {
          return current.filter((each: Monitor): boolean => {
            return each._id !== monitor._id;
          });
        });
      }}
      onBulkSelectItemsOnCurrentPage={() => {
        setSelected([...MONITORS]);
      }}
      onBulkClearAllItems={() => {
        setSelected([]);
      }}
      onBulkSelectAllItems={async (): Promise<boolean> => {
        setSelected([...ALL_MONITORS]);
        setSelectionTotal(ALL_MONITORS.length);
        return true;
      }}
      bulkSelectionTotalCount={selectionTotal}
      bulkItemToString={(monitor: Monitor): string => {
        return monitor.name;
      }}
    />
  );
}

function band(): HTMLElement {
  return screen.getByTestId(TABLE_CARDS_HEADER_TEST_ID);
}

function cardBox(name: string): HTMLElement {
  return screen.getByRole("checkbox", { name: `Select ${name}` });
}

function bandBox(): HTMLElement {
  return within(band()).getAllByRole("checkbox")[0] as HTMLElement;
}

beforeEach(() => {
  archived.length = 0;
  finishArchive = (): void => {};
  setWindowWidth(390);
});

afterEach(() => {
  cleanup();
  forgetRememberedTableFits();
  setWindowWidth(1024);
});

describe("a table drawn as cards, on a phone", () => {
  test("ticking a card draws how many and Bulk Actions in the band over the cards, and no bar of its own", () => {
    const { container } = render(<Harness />);

    // Nothing ticked: the band holds its box and the order, as before.
    expect(within(band()).queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
    expect(within(band()).getByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeVisible();

    fireEvent.click(cardBox("Checkout API"));

    const line: HTMLElement = within(band()).getByTestId(BULK_ROW_TEST_ID);

    expect(
      within(band()).getByTestId(TABLE_CARDS_BULK_LINE_TEST_ID),
    ).toContainElement(line);
    expect(within(line).getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      "1 selected",
    );
    expect(
      within(line).getByRole("button", { name: "Clear Selection" }),
    ).toBeVisible();
    expect(within(line).getByTestId(BULK_ROW_ACTIONS_TEST_ID)).toContainElement(
      screen.getByRole("button", { name: "Bulk Actions" }),
    );

    // The table's bar is not drawn as well: no card, badge or buttons of it.
    expect(container.querySelector(".rounded-xl.bg-gray-50")).toBeNull();
    expect(screen.queryByText("1 Monitor Selected")).toBeNull();
    expect(screen.queryByText("Select All Monitors")).toBeNull();
    // One line of Bulk Actions on the page.
    expect(screen.getAllByTestId(BULK_ROW_TEST_ID)).toHaveLength(1);
  });

  test("the order steps aside while cards are ticked, and comes back once none are", () => {
    render(<Harness />);

    fireEvent.click(cardBox("Checkout API"));

    expect(within(band()).queryByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear Selection" }));

    expect(within(band()).queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
    expect(within(band()).getByTestId(TABLE_CARDS_SORT_TEST_ID)).toBeVisible();
    expect((cardBox("Checkout API") as HTMLInputElement).checked).toBe(false);
  });

  test("once every card on the page is ticked, the band offers every monitor that matches, and selects them", async () => {
    render(<Harness />);

    fireEvent.click(cardBox("Checkout API"));
    expect(screen.queryByTestId(BULK_ROW_SELECT_ALL_TEST_ID)).toBeNull();

    fireEvent.click(bandBox());

    expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
      "3 selected",
    );

    const offer: HTMLElement = screen.getByRole("button", {
      name: "Select all 37 monitors",
    });

    await act(async () => {
      fireEvent.click(offer);
    });

    await waitFor(() => {
      expect(screen.getByTestId(BULK_ROW_COUNT_TEST_ID)).toHaveTextContent(
        "All 37 selected",
      );
    });
    expect(screen.queryByTestId(BULK_ROW_SELECT_ALL_TEST_ID)).toBeNull();
  });

  test("a list that only knows more rows follow offers them in a table's own words", () => {
    render(<Harness total={3} hasMore={true} />);

    fireEvent.click(bandBox());

    expect(screen.getByTestId(BULK_ROW_SELECT_ALL_TEST_ID)).toHaveTextContent(
      "Select All Monitors",
    );
  });

  test("a page that is all there is offers nothing more", () => {
    render(<Harness total={3} />);

    fireEvent.click(bandBox());

    expect(screen.queryByTestId(BULK_ROW_SELECT_ALL_TEST_ID)).toBeNull();
  });

  test("Bulk Actions runs from the band with the table's progress and result dialog", async () => {
    render(<Harness />);

    fireEvent.click(cardBox("Checkout API"));
    fireEvent.click(cardBox("Primary Database Ping"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await waitFor(() => {
      expect(within(dialog).getByText("2 Monitors succeeded")).toBeVisible();
    });
    expect(archived.sort()).toEqual(["1", "3"]);
    expect(band()).not.toContainElement(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(within(band()).queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
    });
  });

  test("a run's dialog stays when the phone turns and the cards become rows", async () => {
    render(<Harness holdsRun={true} />);

    fireEvent.click(cardBox("Checkout API"));
    fireEvent.click(screen.getByRole("button", { name: "Bulk Actions" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // Wide enough for rows now: the band is gone, the table's bar is back.
    await act(async () => {
      setWindowWidth(1280);
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeNull();
    });
    // The same dialog, still running the same run.
    expect(screen.getByRole("dialog")).toBe(dialog);

    await act(async () => {
      finishArchive();
    });

    await waitFor(() => {
      expect(within(dialog).getByText("1 Monitor succeeded")).toBeVisible();
    });
    expect(archived).toEqual(["1"]);
  });

  test("the band keeps its height while cards are ticked: its box sits in a slot as tall as Bulk Actions", () => {
    render(<Harness />);

    expect(band().className).toBe(TABLE_CARDS_HEADER_CLASS_NAME);
    // 36px with its rules; 2px above and below a 30px line.
    expect(TABLE_CARDS_HEADER_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["min-h-[2.25rem]", "py-0.5", "border-y"]),
    );

    const slot: HTMLElement = band().firstElementChild as HTMLElement;

    expect(slot.className).toBe(TABLE_CARDS_BOX_SLOT_CLASS_NAME);
    expect(slot).toContainElement(bandBox());
    expect(TABLE_CARDS_BOX_SLOT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["h-[1.875rem]", "self-start", "items-center"]),
    );
  });
});

describe("a table drawn as rows", () => {
  test("keeps its bar over the rows, with Select All, and no band", () => {
    setWindowWidth(1280);

    const { container } = render(<Harness />);

    fireEvent.click(cardBox("Checkout API"));

    expect(screen.queryByTestId(TABLE_CARDS_HEADER_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(BULK_ROW_TEST_ID)).toBeNull();
    expect(screen.getByText("1 Monitor Selected")).toBeVisible();
    expect(screen.getByText("Select All Monitors")).toBeVisible();
    expect(container.querySelector(".rounded-xl.bg-gray-50")).not.toBeNull();
  });
});
