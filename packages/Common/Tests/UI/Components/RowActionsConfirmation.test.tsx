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
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
  RowActionContext,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A row action that asks first (ActionButtonSchema.getConfirmation) - a
 * row's Disable saying what a disabled workflow stops doing, Archive naming
 * the row - and the list's context handed to a row action as it runs
 * (withRowActionContext), so one that changed its row can have the list
 * read again. The row draws the question itself: the dialog stays open, its
 * button busy, until the action is done, and says in place why it could
 * not be, so nobody starts again.
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
  isEnabled: boolean;
}

const ROW: Row = { _id: "1", name: "Nightly backup", isEnabled: true };

type OnClick = ActionButtonSchema<Row>["onClick"];

const QUESTION: RowActionConfirmation = {
  title: "Disable workflow?",
  description: "A disabled workflow does not run when its trigger fires.",
  submitButtonText: "Disable",
  submitButtonType: ButtonStyleType.DANGER,
  details: <p data-testid="row-question-name">Nightly backup</p>,
};

const actionsFor: (data: {
  onDisable: Mock<OnClick>;
  getConfirmation?: ((row: Row) => RowActionConfirmation | undefined) | null;
  disabled?: boolean;
}) => Array<ActionButtonSchema<Row>> = (data: {
  onDisable: Mock<OnClick>;
  getConfirmation?: ((row: Row) => RowActionConfirmation | undefined) | null;
  disabled?: boolean;
}): Array<ActionButtonSchema<Row>> => {
  return [
    {
      title: "View",
      icon: IconProp.ChevronRight,
      buttonStyleType: ButtonStyleType.OUTLINE,
      onClick: (): void => {},
    },
    {
      title: "Disable",
      icon: IconProp.Stop,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      disabled: data.disabled,
      tooltip: data.disabled ? "You may not change this workflow." : undefined,
      ...(data.getConfirmation === null
        ? {}
        : {
            getConfirmation:
              data.getConfirmation ||
              ((): RowActionConfirmation => {
                return QUESTION;
              }),
          }),
      onClick: data.onDisable,
    },
  ];
};

const clickDisable: () => void = (): void => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Disable",
    }),
  );
};

const submit: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("modal-footer-submit-button");
};

afterEach(() => {
  cleanup();
});

describe("a row action that asks first", () => {
  test("asks its question, naming the row, and runs nothing until it is answered", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row> item={ROW} actionButtons={actionsFor({ onDisable })} />,
    );

    clickDisable();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Disable workflow?",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "A disabled workflow does not run when its trigger fires.",
    );
    expect(screen.getByTestId("row-question-name")).toHaveTextContent(
      "Nightly backup",
    );
    expect(submit()).toHaveTextContent("Disable");
    expect(onDisable).not.toHaveBeenCalled();
  });

  test("Cancel closes it and runs nothing", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row> item={ROW} actionButtons={actionsFor({ onDisable })} />,
    );

    clickDisable();
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(onDisable).not.toHaveBeenCalled();
  });

  test("answered, it runs on the row, and the dialog stays open, its button busy, until the action is done", () => {
    let complete: VoidFunction = (): void => {};
    const onDisable: Mock<OnClick> = jest.fn<OnClick>(
      (_row: Row, onCompleteAction: VoidFunction): void => {
        complete = onCompleteAction;
      },
    );

    render(
      <RowActions<Row> item={ROW} actionButtons={actionsFor({ onDisable })} />,
    );

    clickDisable();
    fireEvent.click(submit());

    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onDisable.mock.calls[0]?.[0]).toBe(ROW);
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(submit()).toBeDisabled();

    // A second press while it runs does not run it twice.
    fireEvent.click(submit());
    expect(onDisable).toHaveBeenCalledTimes(1);

    // Cancel does nothing while it runs: the action finishes either way.
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    act(() => {
      complete();
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("a failure is said inside the dialog, which stays open to try again", () => {
    let fail: ErrorFunction = (): void => {};
    const onDisable: Mock<OnClick> = jest.fn<OnClick>(
      (_row: Row, _complete: VoidFunction, onError: ErrorFunction): void => {
        fail = onError;
      },
    );

    render(
      <RowActions<Row> item={ROW} actionButtons={actionsFor({ onDisable })} />,
    );

    clickDisable();
    fireEvent.click(submit());

    act(() => {
      fail(new Error("You do not have permission to update this workflow."));
    });

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "You do not have permission to update this workflow.",
    );
    // Not a second dialog of its own.
    expect(screen.getAllByTestId("modal")).toHaveLength(1);
    expect(submit()).not.toBeDisabled();

    fireEvent.click(submit());

    expect(onDisable).toHaveBeenCalledTimes(2);
  });

  test("a row it has no question for runs at once", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={ROW}
        actionButtons={actionsFor({
          onDisable,
          getConfirmation: (): undefined => {
            return undefined;
          },
        })}
      />,
    );

    clickDisable();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  test("an action that never asks runs at once, as every row action always has", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={ROW}
        actionButtons={actionsFor({ onDisable, getConfirmation: null })}
      />,
    );

    clickDisable();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  test("a locked action neither asks nor runs", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row>
        item={ROW}
        actionButtons={actionsFor({ onDisable, disabled: true })}
      />,
    );

    clickDisable();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(onDisable).not.toHaveBeenCalled();
  });

  test("an action placed in the menu stays there, with View the row's button", () => {
    const onDisable: Mock<OnClick> = jest.fn<OnClick>();

    render(
      <RowActions<Row> item={ROW} actionButtons={actionsFor({ onDisable })} />,
    );

    expect(
      within(screen.getByTestId("row-actions")).getByRole("button", {
        name: "View",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("row-actions")).queryByRole("button", {
        name: "Disable",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("withRowActionContext", () => {
  const context: RowActionContext = {
    refresh: (): void => {},
  };

  test("hands each action the list's context as it runs", () => {
    const onClick: Mock<OnClick> = jest.fn<OnClick>();
    const [action] = withRowActionContext<Row>(
      [
        {
          title: "Enable",
          icon: IconProp.Play,
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: onClick,
        },
      ],
      context,
    );
    const complete: VoidFunction = (): void => {};
    const onError: ErrorFunction = (): void => {};

    action!.onClick(ROW, complete, onError);

    expect(onClick).toHaveBeenCalledWith(ROW, complete, onError, context);
  });

  test("a context the caller hands itself wins: a list inside a list keeps its own", () => {
    const onClick: Mock<OnClick> = jest.fn<OnClick>();
    const inner: RowActionContext = { refresh: (): void => {} };
    const [action] = withRowActionContext<Row>(
      [
        {
          title: "Enable",
          icon: IconProp.Play,
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: onClick,
        },
      ],
      context,
    );

    action!.onClick(
      ROW,
      (): void => {},
      (): void => {},
      inner,
    );

    expect(onClick.mock.calls[0]?.[3]).toBe(inner);
  });

  test("leaves everything else about an action as it was", () => {
    const isVisible: (row: Row) => boolean = (row: Row): boolean => {
      return row.isEnabled;
    };
    const getConfirmation: () => RowActionConfirmation =
      (): RowActionConfirmation => {
        return QUESTION;
      };
    const original: ActionButtonSchema<Row> = {
      title: "Disable",
      icon: IconProp.Stop,
      buttonStyleType: ButtonStyleType.OUTLINE,
      placement: ActionButtonPlacement.MoreMenu,
      isVisible: isVisible,
      getConfirmation: getConfirmation,
      disabled: true,
      tooltip: "Locked",
      onClick: (): void => {},
    };
    const [wrapped] = withRowActionContext<Row>([original], context);
    const { onClick: _wrappedClick, ...rest } = wrapped!;
    const { onClick: _originalClick, ...expected } = original;

    expect(rest).toEqual(expected);
    expect(rest.isVisible).toBe(isVisible);
    expect(rest.getConfirmation).toBe(getConfirmation);
  });
});
