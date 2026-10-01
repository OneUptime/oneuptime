import { describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

/*
 * A bulk action's confirmation can draw which records it is about to touch,
 * under its sentence: the bulk Delete uses it to name the rows it deletes,
 * where "Are you sure you want to delete 12 monitors?" only counted them.
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
  { _id: "b", name: "Billing Worker" },
];

type RenderWithActionFunction = (action: BulkActionButtonSchema<Row>) => void;

const renderWithAction: RenderWithActionFunction = (
  action: BulkActionButtonSchema<Row>,
): void => {
  render(
    <BulkUpdateForm<Row>
      selectedItems={ROWS}
      isAllItemsSelected={false}
      onSelectAllClick={() => {}}
      onClearSelectionClick={() => {}}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      buttons={[action]}
    />,
  );

  fireEvent.click(screen.getByText("Bulk Actions"));
  fireEvent.click(screen.getByRole("menuitem", { name: action.title }));
};

describe("BulkUpdateForm confirmDetails", () => {
  test("draws what the action says about the selected records, under its sentence", () => {
    const confirmDetails: MockFunction = getJestMockFunction();
    confirmDetails.mockImplementation((items: unknown) => {
      return (
        <ul data-testid="details">
          {(items as Array<Row>).map((row: Row) => {
            return <li key={row._id}>{row.name}</li>;
          })}
        </ul>
      );
    });

    renderWithAction({
      title: "Delete",
      buttonStyleType: ButtonStyleType.DANGER,
      confirmButtonStyleType: ButtonStyleType.DANGER,
      confirmTitle: (items: Array<Row>): string => {
        return `Delete ${items.length} Monitors`;
      },
      confirmMessage: (items: Array<Row>): string => {
        return `Are you sure you want to delete ${items.length} Monitors?`;
      },
      confirmDetails: confirmDetails as unknown as (
        items: Array<Row>,
      ) => React.ReactElement,
      onClick: async (): Promise<void> => {},
    });

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Delete 2 Monitors",
    });

    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent("Are you sure you want to delete 2 Monitors?");
    expect(within(dialog).getByTestId("details")).toHaveTextContent(
      "Checkout APIBilling Worker",
    );
    // Drawn under the sentence, not inside it.
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).not.toHaveTextContent("Checkout API");
    expect(confirmDetails).toHaveBeenCalledWith(ROWS);
  });

  test("draws nothing more when the action has nothing to add", () => {
    renderWithAction({
      title: "Archive",
      buttonStyleType: ButtonStyleType.NORMAL,
      confirmMessage: (): string => {
        return "Archive them?";
      },
      onClick: async (): Promise<void> => {},
    });

    const dialog: HTMLElement = screen.getByRole("dialog", { name: "Confirm" });

    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent("Archive them?");
    expect(within(dialog).queryByTestId("details")).toBeNull();
  });

  test("still runs the action from a dialog that names the records", async () => {
    const onClick: MockFunction = getJestMockFunction();
    onClick.mockResolvedValue(undefined);

    renderWithAction({
      title: "Delete",
      buttonStyleType: ButtonStyleType.DANGER,
      confirmButtonStyleType: ButtonStyleType.DANGER,
      confirmMessage: (): string => {
        return "Sure?";
      },
      confirmDetails: (): React.ReactElement => {
        return <p data-testid="details">Names</p>;
      },
      onClick: onClick as unknown as BulkActionButtonSchema<Row>["onClick"],
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect((onClick.mock.calls[0]![0] as { items: Array<Row> }).items).toEqual(
      ROWS,
    );
  });
});
