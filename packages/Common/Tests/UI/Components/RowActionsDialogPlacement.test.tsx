import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import RowActions, {
  getRowDialogTarget,
} from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { isRowOpeningClick } from "../../../UI/Components/Table/RowClick";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * Where a row's dialogs are drawn: over the page, never inside the row.
 *
 * A table draws a row's actions in its sticky, no-wrap Actions cell. A row
 * action's question (a workflow's Disable, a monitor's Archive) drawn in
 * that cell took the cell's no-wrap - its sentence ran off the dialog's
 * right edge - sat under the other rows' Actions cells, which stayed on top
 * of its backdrop and could still be pressed, and passed a click on its
 * text to the row, which opened the record and took the dialog away. Drawn
 * in the page's body, it is none of the row's business: the row's click
 * (Table/RowClick) leaves alone a click that lands outside the row.
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

const ROW: Row = { _id: "1", name: "Page the on-call team" };

const QUESTION: RowActionConfirmation = {
  title: "Archive workflow",
  description:
    "Archived workflows stop running from every trigger and are hidden from the Workflows list.",
  submitButtonText: "Archive",
  details: <p data-testid="row-question-details">Page the on-call team</p>,
};

type OnClick = ActionButtonSchema<Row>["onClick"];

const actions: (data: {
  onArchive: OnClick;
  asks: boolean;
}) => Array<ActionButtonSchema<Row>> = (data: {
  onArchive: OnClick;
  asks: boolean;
}): Array<ActionButtonSchema<Row>> => {
  return [
    {
      title: "View",
      icon: IconProp.ChevronRight,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.Primary,
      onClick: (): void => {},
    },
    {
      title: "Archive",
      icon: IconProp.Archive,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      ...(data.asks
        ? {
            getConfirmation: (): RowActionConfirmation => {
              return QUESTION;
            },
          }
        : {}),
      onClick: data.onArchive,
    },
  ];
};

/*
 * A table row as Table draws one: the actions in a no-wrap cell, the row
 * opening its record on a click that is the row's own (RowClick).
 */
const renderInRow: (data: {
  onArchive: OnClick;
  asks: boolean;
  onRowClick: (opens: boolean) => void;
}) => void = (data: {
  onArchive: OnClick;
  asks: boolean;
  onRowClick: (opens: boolean) => void;
}): void => {
  render(
    <table>
      <tbody>
        <tr
          data-testid="the-row"
          onClick={(event: React.MouseEvent<HTMLElement>) => {
            data.onRowClick(isRowOpeningClick(event));
          }}
        >
          <td>{ROW.name}</td>
          <td data-testid="the-actions-cell" className="whitespace-nowrap">
            <RowActions<Row>
              item={ROW}
              actionButtons={actions({
                onArchive: data.onArchive,
                asks: data.asks,
              })}
            />
          </td>
        </tr>
      </tbody>
    </table>,
  );
};

const chooseArchive: () => void = (): void => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Archive",
    }),
  );
};

afterEach(() => {
  cleanup();
});

describe("a row's dialogs are drawn over the page, not in the row", () => {
  test("an action's question is drawn in the page's body, outside the row and its no-wrap cell", () => {
    renderInRow({
      onArchive: jest.fn<OnClick>(),
      asks: true,
      onRowClick: (): void => {},
    });

    chooseArchive();

    const dialog: HTMLElement = screen.getByTestId("row-actions-dialog");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Archive workflow",
    );
    expect(screen.getByTestId("the-row")).not.toContainElement(dialog);
    expect(screen.getByTestId("the-actions-cell")).not.toContainElement(
      dialog,
    );
    expect(document.body).toContainElement(dialog);
    // Its sentence and details are in it, wrapped by nothing of the row's.
    expect(dialog).toContainElement(screen.getByTestId("row-question-details"));
    expect(dialog.closest(".whitespace-nowrap")).toBeNull();
  });

  test("a click on the question's text is not a click that opens the row", () => {
    const rowClicks: Array<boolean> = [];
    const onArchive: Mock<OnClick> = jest.fn<OnClick>();

    renderInRow({
      onArchive: onArchive,
      asks: true,
      onRowClick: (opens: boolean): void => {
        rowClicks.push(opens);
      },
    });

    chooseArchive();

    // React's tree still passes the click up to the row, which leaves it be.
    fireEvent.click(screen.getByTestId("confirm-modal-description"));
    fireEvent.click(screen.getByTestId("row-question-details"));

    expect(rowClicks.length).toBeGreaterThan(0);
    expect(rowClicks).not.toContain(true);
    expect(screen.getByTestId("row-actions-dialog")).toBeInTheDocument();
    expect(onArchive).not.toHaveBeenCalled();
  });

  test("a click on the row's own text still opens it", () => {
    const rowClicks: Array<boolean> = [];

    renderInRow({
      onArchive: jest.fn<OnClick>(),
      asks: true,
      onRowClick: (opens: boolean): void => {
        rowClicks.push(opens);
      },
    });

    fireEvent.click(screen.getByText(ROW.name));

    expect(rowClicks).toEqual([true]);
  });

  test("answered, the question runs the action and leaves the page", () => {
    const onArchive: Mock<OnClick> = jest.fn<OnClick>(
      (_row: Row, onCompleteAction: VoidFunction): void => {
        onCompleteAction();
      },
    );

    renderInRow({ onArchive: onArchive, asks: true, onRowClick: () => {} });

    chooseArchive();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("row-actions-dialog")).not.toBeInTheDocument();
  });

  test("an action's error is drawn in the page's body too", () => {
    let fail: ErrorFunction = (): void => {};

    renderInRow({
      onArchive: jest.fn<OnClick>(
        (_row: Row, _complete: VoidFunction, onError: ErrorFunction): void => {
          fail = onError;
        },
      ),
      asks: false,
      onRowClick: () => {},
    });

    chooseArchive();

    act(() => {
      fail(new Error("You do not have permission to update this workflow."));
    });

    const dialog: HTMLElement = screen.getByTestId("row-actions-dialog");

    expect(dialog).toHaveTextContent(
      "You do not have permission to update this workflow.",
    );
    expect(screen.getByTestId("the-row")).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });
});

describe("getRowDialogTarget", () => {
  afterEach(() => {
    delete (document as unknown as { fullscreenElement?: unknown })
      .fullscreenElement;
  });

  test("is the page's body", () => {
    expect(getRowDialogTarget()).toBe(document.body);
  });

  test("is the element shown full screen, which hides everything outside it", () => {
    const fullscreen: HTMLDivElement = document.createElement("div");
    document.body.appendChild(fullscreen);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: (): Element => {
        return fullscreen;
      },
    });

    expect(getRowDialogTarget()).toBe(fullscreen);

    renderInRow({
      onArchive: jest.fn<OnClick>(),
      asks: true,
      onRowClick: () => {},
    });

    chooseArchive();

    expect(fullscreen).toContainElement(
      screen.getByTestId("row-actions-dialog"),
    );

    fullscreen.remove();
  });
});
