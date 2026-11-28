import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import ActionCard, {
  ConfirmAction,
} from "../../../UI/Components/ActionCard/ActionCard";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A card with an action that asks before it acts (ActionCard): its button
 * opens a confirmation, and the confirmation's button does the work. A
 * confirmation may ask one thing more (#11209) - the repository a fix is
 * made in, when none was found for certain - and wait for the answer; what
 * it asks is read from the card's props of now, so it follows the answer.
 */

afterEach(() => {
  cleanup();
});

function Card(props: {
  onConfirm: () => void;
  extra?: (
    answer: string,
    setAnswer: (value: string) => void,
  ) => {
    content: React.ReactElement;
    isDisabled: boolean;
  };
}): React.ReactElement {
  const [answer, setAnswer] = React.useState<string>("");
  const asked:
    | { content: React.ReactElement; isDisabled: boolean }
    | undefined = props.extra ? props.extra(answer, setAnswer) : undefined;

  const action: ConfirmAction = {
    actionName: "Improve Logging",
    actionIcon: IconProp.Logs,
    actionButtonStyle: ButtonStyleType.PRIMARY,
    onConfirmAction: props.onConfirm,
    ...(asked
      ? {
          confirmContent: asked.content,
          isConfirmDisabled: asked.isDisabled,
        }
      : {}),
  };

  return (
    <ActionCard
      title="Improve logging with AI"
      description="AI reviews this service's logging."
      actions={[action]}
    />
  );
}

function openConfirmation(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /Improve Logging/ }));
  return screen.getByRole("dialog");
}

describe("ActionCard", () => {
  test("asks before it acts, in the action's words", () => {
    const onConfirm: jest.Mock = jest.fn();
    render(<Card onConfirm={onConfirm as unknown as () => void} />);

    const dialog: HTMLElement = openConfirmation();

    expect(dialog).toHaveTextContent(
      "Are you sure you want to improve logging?",
    );
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Improve Logging" }),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a confirmation that asks nothing more acts at once", () => {
    const onConfirm: jest.Mock = jest.fn();
    render(<Card onConfirm={onConfirm as unknown as () => void} />);

    const dialog: HTMLElement = openConfirmation();

    expect(
      within(dialog).getByRole("button", { name: "Improve Logging" }),
    ).toBeEnabled();
  });

  test("one that asks more draws it under its question, and its button waits for the answer", () => {
    const onConfirm: jest.Mock = jest.fn();
    render(
      <Card
        onConfirm={onConfirm as unknown as () => void}
        extra={(answer: string, setAnswer: (value: string) => void) => {
          return {
            content: (
              <label data-testid="asked">
                Which repository?
                <input
                  value={answer}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setAnswer(event.target.value);
                  }}
                />
              </label>
            ),
            isDisabled: !answer,
          };
        }}
      />,
    );

    const dialog: HTMLElement = openConfirmation();
    const asked: HTMLElement = within(dialog).getByTestId("asked");
    const button: HTMLElement = within(dialog).getByRole("button", {
      name: "Improve Logging",
    });

    expect(asked).toHaveTextContent("Which repository?");
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();

    // The answer, given in the confirmation, lets its button act.
    fireEvent.change(within(asked).getByRole("textbox"), {
      target: { value: "checkout" },
    });

    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Improve Logging",
      }),
    ).toBeEnabled();

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Improve Logging",
      }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("closed without acting, nothing is done", () => {
    const onConfirm: jest.Mock = jest.fn();
    render(<Card onConfirm={onConfirm as unknown as () => void} />);

    const dialog: HTMLElement = openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
