import { describe, expect, test } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionConfirmControls,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

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
      icon: IconProp.Trash,
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
    // With what the details may ask of the dialog: hold its action while they read.
    expect(confirmDetails).toHaveBeenCalledWith(
      ROWS,
      expect.objectContaining({ setIsSubmitHeld: expect.any(Function) }),
    );
  });

  test("draws nothing more when the action has nothing to add", () => {
    renderWithAction({
      title: "Archive",
      icon: IconProp.Archive,
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
      icon: IconProp.Trash,
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

/*
 * Details that read what the action would do when the dialog opens - what
 * uses the values a bulk Delete is about to delete - hold its action while
 * they read, as a row's Delete waits for its words, and keep it held when
 * they find there is nothing the action could do.
 */
describe("BulkUpdateForm confirmDetails that hold the action", () => {
  // Details that hold the action on mount, and release it when told.
  const Holding: React.FunctionComponent<{
    controls: BulkActionConfirmControls;
    onReady: (release: (isHeld: boolean) => void) => void;
  }> = (props: {
    controls: BulkActionConfirmControls;
    onReady: (release: (isHeld: boolean) => void) => void;
  }): React.ReactElement => {
    React.useEffect(() => {
      props.controls.setIsSubmitHeld(true);
      props.onReady(props.controls.setIsSubmitHeld);
    }, []);

    return <p data-testid="details">Checking</p>;
  };

  const holdingAction: (
    onClick: MockFunction,
    onReady: (release: (isHeld: boolean) => void) => void,
  ) => BulkActionButtonSchema<Row> = (
    onClick: MockFunction,
    onReady: (release: (isHeld: boolean) => void) => void,
  ): BulkActionButtonSchema<Row> => {
    return {
      title: "Delete",
      icon: IconProp.Trash,
      buttonStyleType: ButtonStyleType.DANGER,
      confirmButtonStyleType: ButtonStyleType.DANGER,
      confirmMessage: (): string => {
        return "Sure?";
      },
      confirmDetails: (
        _items: Array<Row>,
        controls: BulkActionConfirmControls,
      ): React.ReactElement => {
        return <Holding controls={controls} onReady={onReady} />;
      },
      onClick: onClick as unknown as BulkActionButtonSchema<Row>["onClick"],
    };
  };

  test("its action waits for the details, then runs", () => {
    const onClick: MockFunction = getJestMockFunction();
    onClick.mockResolvedValue(undefined);
    let release: (isHeld: boolean) => void = (): void => {};

    renderWithAction(
      holdingAction(onClick, (setHeld: (isHeld: boolean) => void) => {
        release = setHeld;
      }),
    );

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    expect(submit).toBeDisabled();

    // Neither a click nor the dialog's own submit runs it meanwhile.
    fireEvent.click(submit);
    expect(onClick).not.toHaveBeenCalled();

    act(() => {
      release(false);
    });

    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("details that find nothing to do keep it held", () => {
    const onClick: MockFunction = getJestMockFunction();
    let release: (isHeld: boolean) => void = (): void => {};

    renderWithAction(
      holdingAction(onClick, (setHeld: (isHeld: boolean) => void) => {
        release = setHeld;
      }),
    );

    act(() => {
      release(true);
    });

    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  test("a dialog opened again starts free: the last one's hold does not carry over", () => {
    const onClick: MockFunction = getJestMockFunction();
    onClick.mockResolvedValue(undefined);

    const archive: BulkActionButtonSchema<Row> = {
      title: "Archive",
      icon: IconProp.Archive,
      buttonStyleType: ButtonStyleType.NORMAL,
      confirmMessage: (): string => {
        return "Archive them?";
      },
      onClick: onClick as unknown as BulkActionButtonSchema<Row>["onClick"],
    };

    render(
      <BulkUpdateForm<Row>
        selectedItems={ROWS}
        isAllItemsSelected={false}
        onSelectAllClick={() => {}}
        onClearSelectionClick={() => {}}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        buttons={[archive, holdingAction(onClick, (): void => {})]}
      />,
    );

    // Held, then the dialog closed while it was.
    fireEvent.click(screen.getByText("Bulk Actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    // The same form's next dialog, with nothing to read: free at once.
    fireEvent.click(screen.getByText("Bulk Actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
