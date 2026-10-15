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
 * Where to go next, under a bulk action's result: "Add to Existing Episode"
 * and "Add to New Episode" end on a link to the episode the selected alerts
 * went into (resultDetails). It is drawn last, once the run has finished,
 * and read then - so it can name what the run produced. An action that has
 * none draws nothing, nor does one whose details come back empty.
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
  { _id: "a", name: "Checkout is slow" },
  { _id: "b", name: "Disk filling up" },
];

// What the run produced, as the episode actions keep it: set by the run.
let producedEpisode: string | null = null;

const ADD_ACTION: BulkActionButtonSchema<Row> = {
  title: "Add to New Episode",
  icon: IconProp.PlusCircle,
  buttonStyleType: ButtonStyleType.NORMAL,
  resultDetails: (): React.ReactElement | undefined => {
    return producedEpisode ? (
      <a href={`/episodes/${producedEpisode}`}>
        Open episode {producedEpisode}
      </a>
    ) : undefined;
  },
  onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({
      actionProps: props,
      step: async (): Promise<void> => {
        producedEpisode = "AE-13";
      },
    });
  },
};

const ARCHIVE_ACTION: BulkActionButtonSchema<Row> = {
  title: "Archive",
  icon: IconProp.Archive,
  buttonStyleType: ButtonStyleType.NORMAL,
  onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
    await runBulkAction<Row>({
      actionProps: props,
      step: async (): Promise<void> => {},
    });
  },
};

function renderForm(): void {
  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Alert"
      pluralLabel="Alerts"
      buttons={[ARCHIVE_ACTION, ADD_ACTION]}
    />,
  );
}

async function run(title: string): Promise<void> {
  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: title }));
  await screen.findByText("Completed");
}

describe("BulkUpdateForm: where to go next", () => {
  test("is drawn last in the result, naming what the run produced", async () => {
    producedEpisode = null;
    renderForm();

    await run("Add to New Episode");

    const details: HTMLElement = screen.getByTestId(
      "bulk-action-result-details",
    );
    expect(details).toHaveTextContent("Open episode AE-13");
    expect(
      screen.getByRole("link", { name: "Open episode AE-13" }),
    ).toHaveAttribute("href", "/episodes/AE-13");

    // After the counts.
    const counts: HTMLElement = screen.getByTestId(
      "bulk-action-succeeded-count",
    );
    expect(
      counts.compareDocumentPosition(details) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an action without any draws nothing", async () => {
    producedEpisode = "AE-13";
    renderForm();

    await run("Archive");

    expect(screen.queryByTestId("bulk-action-result-details")).toBeNull();
  });

  test("details that come back empty draw nothing", async () => {
    producedEpisode = null;

    const nothingProduced: BulkActionButtonSchema<Row> = {
      ...ADD_ACTION,
      title: "Add to Existing Episode",
      onClick: async (props: BulkActionOnClickProps<Row>): Promise<void> => {
        await runBulkAction<Row>({
          actionProps: props,
          step: async (): Promise<void> => {
            throw new Error("The episode does not exist.");
          },
        });
      },
    };

    render(
      <BulkUpdateForm<Row>
        selectedItems={ROWS}
        isAllItemsSelected={false}
        onSelectAllClick={() => {}}
        onClearSelectionClick={() => {}}
        singularLabel="Alert"
        pluralLabel="Alerts"
        buttons={[nothingProduced]}
      />,
    );

    await run("Add to Existing Episode");

    expect(screen.queryByTestId("bulk-action-result-details")).toBeNull();
  });
});
