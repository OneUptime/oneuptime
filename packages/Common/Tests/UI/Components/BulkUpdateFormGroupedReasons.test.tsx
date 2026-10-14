import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
  BulkItemGroup,
  groupItemsByReason,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A bulk action's result lists the items it did not do, and why. A bulk
 * Delete the server refuses part of usually refuses for one reason - a
 * permission scoped to a label, the teams every project comes with - and the
 * list drew a row per item, each saying the same sentence again: six
 * refusals were six copies of it in a box that showed three and hid the rest
 * below its fold. Items that share a reason are now listed together under it
 * once; items refused for different reasons keep groups of their own.
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
  _id: string;
  name: string;
}

const LABEL_REFUSAL: string =
  "You do not have permission to delete this Status Page. You need to have one of the following labels: Marketing.";

const DEPENDENT_REFUSAL: string =
  "This status page is used by an announcement you cannot delete.";

const regionalPages: Array<Row> = Array.from(
  { length: 6 },
  (_value: unknown, index: number): Row => {
    return { _id: `r${index + 1}`, name: `Regional Status 0${index + 1}` };
  },
);

const ROWS: Array<Row> = [
  { _id: "demo", name: "Demo Status" },
  ...regionalPages,
  { _id: "launch", name: "Launch Page" },
];

type StepFunction = (row: Row) => Promise<BulkItemOutcome | void>;

function actionRunning(step: StepFunction): BulkActionButtonSchema<Row> {
  return {
    title: "Delete",
    icon: IconProp.Trash,
    buttonStyleType: ButtonStyleType.DANGER,
    onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
      await runBulkAction<Row>({ actionProps: props, step: step });
    },
  };
}

function renderAndRun(
  action: BulkActionButtonSchema<Row>,
  rows: Array<Row> = ROWS,
): void {
  render(
    <BulkUpdateForm<Row>
      selectedItems={rows}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Status Page"
      pluralLabel="Status Pages"
      buttons={[action]}
      itemToString={(row: Row): string => {
        return `Status Page: ${row.name}`;
      }}
    />,
  );

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: action.title }));
}

// How many times `needle` is said inside `element`.
function timesSaid(element: HTMLElement, needle: string): number {
  return (element.textContent || "").split(needle).length - 1;
}

describe("groupItemsByReason", () => {
  test("lists the items refused for one reason together, in the order they ran", () => {
    const groups: Array<BulkItemGroup> = groupItemsByReason([
      { name: "a", message: LABEL_REFUSAL },
      { name: "b", message: LABEL_REFUSAL },
      { name: "c", message: LABEL_REFUSAL },
    ]);

    expect(groups).toEqual([
      { names: ["a", "b", "c"], message: LABEL_REFUSAL },
    ]);
  });

  test("keeps each reason in a group of its own, in the order each first came up", () => {
    const groups: Array<BulkItemGroup> = groupItemsByReason([
      { name: "a", message: DEPENDENT_REFUSAL },
      { name: "b", message: LABEL_REFUSAL },
      { name: "c", message: DEPENDENT_REFUSAL },
      { name: "d", message: LABEL_REFUSAL },
    ]);

    expect(groups).toEqual([
      { names: ["a", "c"], message: DEPENDENT_REFUSAL },
      { names: ["b", "d"], message: LABEL_REFUSAL },
    ]);
  });

  test("compares reasons as written: two different wordings never share a group", () => {
    const groups: Array<BulkItemGroup> = groupItemsByReason([
      { name: "a", message: "Not found." },
      { name: "b", message: "Not found" },
    ]);

    expect(groups).toHaveLength(2);
  });

  test("gives a reason drawn as an element a group of its own, since it can't be compared", () => {
    const first: React.ReactElement = <span>Locked.</span>;
    const second: React.ReactElement = <span>Locked.</span>;

    const groups: Array<BulkItemGroup> = groupItemsByReason([
      { name: "a", message: first },
      { name: "b", message: second },
      { name: "c", message: "Locked." },
    ]);

    expect(groups).toEqual([
      { names: ["a"], message: first },
      { names: ["b"], message: second },
      { names: ["c"], message: "Locked." },
    ]);
  });

  test("keeps the reason of items without a name, once", () => {
    expect(
      groupItemsByReason([
        { name: "", message: LABEL_REFUSAL },
        { name: "", message: LABEL_REFUSAL },
      ]),
    ).toEqual([{ names: [], message: LABEL_REFUSAL }]);
  });

  test("has nothing to say about no items", () => {
    expect(groupItemsByReason([])).toEqual([]);
  });
});

describe("BulkUpdateForm: what was not done, grouped by why", () => {
  const SIX_REFUSED: StepFunction = async (
    row: Row,
  ): Promise<BulkItemOutcome> => {
    if (row._id.startsWith("r")) {
      throw new Error(LABEL_REFUSAL);
    }

    return BULK_ITEM_CHANGED;
  };

  test("says a reason six items share once, with all six names under the count", async () => {
    renderAndRun(actionRunning(SIX_REFUSED));

    await screen.findByText("Completed");

    expect(screen.getByText("6 Status Pages failed")).toBeInTheDocument();

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");
    const groups: Array<HTMLElement> = within(failed).getAllByTestId(
      "bulk-action-failed-items-group",
    );

    expect(groups).toHaveLength(1);
    expect(timesSaid(failed, LABEL_REFUSAL)).toBe(1);

    // Every name is there, as a list a screen reader counts.
    const names: Array<string> = within(groups[0]!)
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });

    expect(names).toEqual(
      regionalPages.map((row: Row): string => {
        return `Status Page: ${row.name}`;
      }),
    );
  });

  test("names come first and the reason after them, as for one item", async () => {
    renderAndRun(actionRunning(SIX_REFUSED));

    await screen.findByText("Completed");

    const group: HTMLElement = within(
      screen.getByTestId("bulk-action-failed-items"),
    ).getByTestId("bulk-action-failed-items-group");
    const list: HTMLElement = within(group).getByRole("list");
    const reason: HTMLElement = within(group).getByText(LABEL_REFUSAL);

    expect(
      list.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps items refused for different reasons apart, each reason with its own names", async () => {
    renderAndRun(
      actionRunning(async (row: Row): Promise<BulkItemOutcome> => {
        if (row._id === "launch" || row._id === "demo") {
          throw new Error(DEPENDENT_REFUSAL);
        }

        throw new Error(LABEL_REFUSAL);
      }),
    );

    await screen.findByText("Completed");

    const groups: Array<HTMLElement> = within(
      screen.getByTestId("bulk-action-failed-items"),
    ).getAllByTestId("bulk-action-failed-items-group");

    expect(groups).toHaveLength(2);

    // In the order the reasons first came up: Demo Status ran first.
    expect(groups[0]).toHaveTextContent(DEPENDENT_REFUSAL);
    expect(groups[0]).toHaveTextContent("Status Page: Demo Status");
    expect(groups[0]).toHaveTextContent("Status Page: Launch Page");
    expect(groups[0]).not.toHaveTextContent("Regional Status");

    expect(groups[1]).toHaveTextContent(LABEL_REFUSAL);
    expect(within(groups[1]!).getAllByRole("listitem")).toHaveLength(6);
  });

  test("draws one item refused for a reason of its own as before: its name, then why", async () => {
    renderAndRun(
      actionRunning(async (row: Row): Promise<BulkItemOutcome> => {
        if (row._id === "launch") {
          throw new Error(DEPENDENT_REFUSAL);
        }

        return BULK_ITEM_CHANGED;
      }),
    );

    await screen.findByText("Completed");

    const group: HTMLElement = within(
      screen.getByTestId("bulk-action-failed-items"),
    ).getByTestId("bulk-action-failed-items-group");

    // A list of one is no list.
    expect(within(group).queryByRole("list")).toBeNull();
    expect(
      within(group).getByText("Status Page: Launch Page"),
    ).toBeInTheDocument();
    expect(within(group).getByText(DEPENDENT_REFUSAL)).toBeInTheDocument();
  });

  test("groups the items left alone on purpose the same way", async () => {
    renderAndRun(
      actionRunning(async (row: Row): Promise<BulkItemOutcome> => {
        if (row._id.startsWith("r")) {
          return bulkItemUnchanged("Already archived.");
        }

        return BULK_ITEM_CHANGED;
      }),
    );

    await screen.findByText("Completed");

    const unchanged: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );

    expect(
      within(unchanged).getAllByTestId("bulk-action-unchanged-items-group"),
    ).toHaveLength(1);
    expect(timesSaid(unchanged, "Already archived.")).toBe(1);
    expect(within(unchanged).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("BulkUpdateForm: the Bulk Actions button", () => {
  test("keeps to the bar's right edge when the bar wraps, so its menu opens on the screen", () => {
    render(
      <BulkUpdateForm<Row>
        selectedItems={ROWS.slice(0, 2)}
        isAllItemsSelected={false}
        onSelectAllClick={() => {}}
        onClearSelectionClick={() => {}}
        singularLabel="Status Page"
        pluralLabel="Status Pages"
        buttons={[actionRunning(deletesEveryRow)]}
      />,
    );

    /*
     * The menu opens leftwards from the button's right edge. On a phone the
     * bar wraps, and a button left at the start of its line opened the menu
     * off the left of the screen (the browser suite measures it).
     */
    const group: HTMLElement | null = screen
      .getByText("Bulk Actions")
      .closest(".ml-auto");

    expect(group).not.toBeNull();
  });
});

async function deletesEveryRow(): Promise<BulkItemOutcome> {
  return BULK_ITEM_CHANGED;
}
