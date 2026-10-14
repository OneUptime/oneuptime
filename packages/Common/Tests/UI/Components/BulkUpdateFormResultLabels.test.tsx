import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { runBulkAction } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A bulk action's result in its own words. "2 Monitors succeeded" says the
 * run went well, not what happened; a bulk Delete now says "2 Monitors
 * deleted" and "1 Monitor not deleted", which is what the reader is looking
 * for. An action that gives no words of its own reads as before, and the
 * words are the action's that ran - not the last one that had some.
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
  { _id: "a", name: "Checkout API" },
  { _id: "b", name: "Payments" },
  { _id: "c", name: "Search" },
];

// Fails on "c", as a delete the server refuses does.
const step: (row: Row) => Promise<void> = async (row: Row): Promise<void> => {
  if (row._id === "c") {
    throw new Error("You do not have permission to delete this monitor.");
  }
};

const DELETE_ACTION: BulkActionButtonSchema<Row> = {
  title: "Delete",
  icon: IconProp.Trash,
  buttonStyleType: ButtonStyleType.NORMAL,
  resultLabels: {
    succeeded: {
      one: "{{count}} {{itemName}} deleted",
      other: "{{count}} {{itemsName}} deleted",
    },
    failed: {
      one: "{{count}} {{itemName}} not deleted",
      other: "{{count}} {{itemsName}} not deleted",
    },
  },
  onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({ actionProps: props, step: step });
  },
};

const ARCHIVE_ACTION: BulkActionButtonSchema<Row> = {
  title: "Archive",
  icon: IconProp.Archive,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({ actionProps: props, step: step });
  },
};

function renderForm(): void {
  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      buttons={[ARCHIVE_ACTION, DELETE_ACTION]}
    />,
  );
}

async function run(title: string): Promise<void> {
  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: title }));
  await screen.findByText("Completed");
}

function closeResult(): void {
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
}

describe("BulkUpdateForm: a result in the action's own words", () => {
  test("a Delete says what was deleted and what was not", async () => {
    renderForm();
    await run("Delete");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Monitors deleted",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Monitor not deleted",
    );
    // Why, against the one that was not.
    expect(
      screen.getByText("You do not have permission to delete this monitor."),
    ).toBeInTheDocument();
  });

  test("an action with no words of its own reads as before", async () => {
    renderForm();
    await run("Archive");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Monitors succeeded",
    );
    expect(screen.getByTestId("bulk-action-failed-count")).toHaveTextContent(
      "1 Monitor failed",
    );
  });

  test("the words are the ones of the action that ran, not the last one that had some", async () => {
    renderForm();

    await run("Delete");
    closeResult();

    await run("Archive");

    expect(screen.getByTestId("bulk-action-succeeded-count")).toHaveTextContent(
      "2 Monitors succeeded",
    );
    expect(screen.queryByText("2 Monitors deleted")).toBeNull();
  });
});
