import { describe, expect, test } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
  BULK_UNCHANGED_COUNT,
  BulkActionButtonSchema,
  BulkActionOnClickProps,
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
 * The bulk progress modal's third list: items an action left alone on
 * purpose. Before it, the network device actions reported a device they did
 * nothing to as FAILED with a "Skipped:" prefix, because the modal had only
 * "succeeded" and "failed" - and a device nobody could do anything to read as
 * an error. Now it has its own count and its own list, with the reason
 * against each item, after the failures (which are what to act on first).
 *
 * An action that never reports the list draws exactly what it drew before.
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

const ROWS: Array<Row> = [
  { _id: "a", name: "core-switch-01" },
  { _id: "b", name: "lobby-ap" },
  { _id: "c", name: "edge-router" },
  { _id: "d", name: "printer-3f" },
];

type StepFunction = (row: Row) => Promise<BulkItemOutcome | void>;

function actionRunning(step: StepFunction): BulkActionButtonSchema<Row> {
  return {
    title: "Apply Vendor Template",
    icon: IconProp.CPUChip,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
      await runBulkAction<Row>({ actionProps: props, step: step });
    },
  };
}

function renderAndRun(action: BulkActionButtonSchema<Row>): void {
  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Device"
      pluralLabel="Devices"
      buttons={[action]}
      itemToString={(row: Row): string => {
        return `Device: ${row.name}`;
      }}
    />,
  );

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: action.title }));
}

const MIXED_STEP: StepFunction = async (
  row: Row,
): Promise<BulkItemOutcome> => {
  if (row._id === "a") {
    return BULK_ITEM_CHANGED;
  }

  if (row._id === "b") {
    return bulkItemUnchanged(
      "Nothing polls this device, so a vendor template would collect nothing.",
    );
  }

  if (row._id === "c") {
    throw new Error("You need the Edit Network Device permission to do this.");
  }

  return bulkItemUnchanged("Already collects everything in Generic.");
};

describe("BulkUpdateForm: items left alone on purpose", () => {
  test("are counted apart from the successes and the failures", async () => {
    renderAndRun(actionRunning(MIXED_STEP));

    await screen.findByText("Completed");

    expect(screen.getByText("1 Device succeeded")).toBeInTheDocument();
    expect(screen.getByText("1 Device failed")).toBeInTheDocument();
    expect(
      screen.getByTestId("bulk-action-unchanged-count"),
    ).toHaveTextContent("2 Devices not changed");
  });

  test("list each item with the reason it was left, and none of them as a failure", async () => {
    renderAndRun(actionRunning(MIXED_STEP));

    await screen.findByText("Completed");

    const unchanged: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );
    expect(within(unchanged).getByText("Device: lobby-ap")).toBeInTheDocument();
    expect(
      within(unchanged).getByText(
        "Nothing polls this device, so a vendor template would collect nothing.",
      ),
    ).toBeInTheDocument();
    expect(
      within(unchanged).getByText("Device: printer-3f"),
    ).toBeInTheDocument();
    expect(
      within(unchanged).getByText("Already collects everything in Generic."),
    ).toBeInTheDocument();

    const failed: HTMLElement = screen.getByTestId(
      "bulk-action-failed-items",
    );
    expect(within(failed).getByText("Device: edge-router")).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "You need the Edit Network Device permission to do this.",
      ),
    ).toBeInTheDocument();
    expect(within(failed).queryByText("Device: lobby-ap")).toBeNull();
    expect(within(unchanged).queryByText("Device: edge-router")).toBeNull();
  });

  test("come after the failures, which are what to act on first", async () => {
    renderAndRun(actionRunning(MIXED_STEP));

    await screen.findByText("Completed");

    const failed: HTMLElement = screen.getByTestId(
      "bulk-action-failed-items",
    );
    const unchangedCount: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-count",
    );

    expect(
      failed.compareDocumentPosition(unchangedCount) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an action that never leaves an item alone draws no third list", async () => {
    renderAndRun(
      actionRunning(async (): Promise<void> => {
        // every item changed
      }),
    );

    await screen.findByText("Completed");

    expect(screen.getByText("4 Devices succeeded")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-action-unchanged-count")).toBeNull();
    expect(screen.queryByTestId("bulk-action-unchanged-items")).toBeNull();
    expect(screen.queryByTestId("bulk-action-failed-items")).toBeNull();
  });

  test("a selection left entirely alone reads as not changed, with no success row", async () => {
    renderAndRun(
      actionRunning(async (): Promise<BulkItemOutcome> => {
        return bulkItemUnchanged("Not identified yet.");
      }),
    );

    await screen.findByText("Completed");

    expect(screen.queryByText(/succeeded/)).toBeNull();
    expect(screen.queryByText(/failed/)).toBeNull();
    expect(
      screen.getByTestId("bulk-action-unchanged-count"),
    ).toHaveTextContent("4 Devices not changed");
  });

  test("the progress bar counts items left alone as done", async () => {
    let releaseLast: () => void = () => {
      // replaced below
    };

    const lastGate: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseLast = resolve;
    });

    renderAndRun(
      actionRunning(async (row: Row): Promise<BulkItemOutcome | void> => {
        if (row._id === "d") {
          await lastGate;
          return;
        }

        return row._id === "a"
          ? BULK_ITEM_CHANGED
          : bulkItemUnchanged("Already there.");
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
        "3 of 4 Devices",
      );
    });

    await act(async () => {
      releaseLast();
    });

    await screen.findByText("Completed");
  });

  test("says it in the one form for a single item", () => {
    expect(BULK_UNCHANGED_COUNT.one).toBe("{{count}} {{itemName}} not changed");
    expect(BULK_UNCHANGED_COUNT.other).toBe(
      "{{count}} {{itemsName}} not changed",
    );
  });
});
