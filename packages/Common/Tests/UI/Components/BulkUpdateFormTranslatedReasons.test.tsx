import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import BulkUpdateForm, {
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
 * The reasons a bulk action lists against each item, in the reader's
 * language.
 *
 * A reason is often the server's own English: a bulk Delete of a monitor's
 * status events lists the one the server refused - "The monitor's only status
 * event can't be deleted: ..." - with the refusal it sent. The error dialog
 * of one row's Delete already said that in German, because a dialog looks
 * its text up; the bulk list printed it as it came. The list now looks each
 * reason up too: one the reader's language words gets their words, and
 * anything else - an error nobody translated - is shown as it came.
 */

const REFUSAL: string =
  "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.";

const GERMAN: Record<string, string> = {
  [REFUSAL]:
    "Das einzige Statusereignis des Monitors kann nicht gelöscht werden: Der Monitor hätte keinen Status mehr, und Statusseiten würden ihn grau anzeigen. Um seinen Status zu ändern, fügen Sie ein neues Statusereignis hinzu.",
  "Already collects everything in Generic.":
    "Erfasst in Generic bereits alles.",
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return GERMAN[key] ?? opts?.defaultValue ?? key;
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
  { _id: "a", name: "Operational (Oct 14 2025, 02:04 PM GMT)" },
  { _id: "b", name: "Offline (Sep 24 2026, 02:04 PM GMT)" },
  { _id: "c", name: "Operational (Sep 25 2026, 02:04 PM GMT)" },
];

type StepFunction = (row: Row) => Promise<BulkItemOutcome | void>;

function renderAndRun(step: StepFunction): void {
  const action: BulkActionButtonSchema<Row> = {
    title: "Delete",
    icon: IconProp.Trash,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
      await runBulkAction<Row>({ actionProps: props, step: step });
    },
  };

  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Monitor Status Event"
      pluralLabel="Monitor Status Events"
      buttons={[action]}
      itemToString={(row: Row): string => {
        return `Monitor Status Event: ${row.name}`;
      }}
    />,
  );

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}

describe("BulkUpdateForm: the reason against each item", () => {
  test("a failure the reader's language words is listed in their words", async () => {
    renderAndRun(async (row: Row): Promise<BulkItemOutcome> => {
      if (row._id === "a") {
        throw new Error(REFUSAL);
      }

      return BULK_ITEM_CHANGED;
    });

    await screen.findByText("Completed");

    const failed: HTMLElement = screen.getByTestId("bulk-action-failed-items");

    expect(
      within(failed).getByText(
        "Monitor Status Event: Operational (Oct 14 2025, 02:04 PM GMT)",
      ),
    ).toBeInTheDocument();
    expect(within(failed).getByText(GERMAN[REFUSAL]!)).toBeInTheDocument();
    expect(within(failed).queryByText(REFUSAL)).toBeNull();
  });

  test("a failure nobody translated is shown as it came", async () => {
    const untranslated: string = "Server Error. Please try again";

    renderAndRun(async (row: Row): Promise<BulkItemOutcome> => {
      if (row._id === "b") {
        throw new Error(untranslated);
      }

      return BULK_ITEM_CHANGED;
    });

    await screen.findByText("Completed");

    expect(
      within(screen.getByTestId("bulk-action-failed-items")).getByText(
        untranslated,
      ),
    ).toBeInTheDocument();
  });

  test("so is a reason an item was left alone", async () => {
    renderAndRun(async (row: Row): Promise<BulkItemOutcome> => {
      if (row._id === "c") {
        return bulkItemUnchanged("Already collects everything in Generic.");
      }

      return BULK_ITEM_CHANGED;
    });

    await screen.findByText("Completed");

    expect(
      within(screen.getByTestId("bulk-action-unchanged-items")).getByText(
        "Erfasst in Generic bereits alles.",
      ),
    ).toBeInTheDocument();
  });
});
