import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Button, {
  ButtonStyleType,
  FOCUS_KEEPING_PRESS_MS,
} from "../../../UI/Components/Button/Button";

/*
 * A locked or busy Button keeps its place: its width in its row, and the
 * keyboard's place on the page.
 *
 *   - A locked button with a reason sits in a wrapper that takes the
 *     pointer and shows the reason. The wrapper was only as wide as its
 *     words, so on a phone a locked NORMAL or PRIMARY button - as wide as
 *     the phone when it can be pressed - was narrower than the buttons
 *     beside it (#5320 fixed it for the Workflow Builder's toolbar alone).
 *   - A button pressed from the keyboard that goes busy is disabled, and
 *     the browser moves the focus off a disabled control to the page
 *     itself; one with a reason is also moved into its wrapper, which
 *     remounts it. Enter on a Save or a Refresh left the reader at the top
 *     of the page (#5392).
 *
 * jsdom moves no focus off a control that is disabled, so the tests that
 * need the browser's move make it themselves (blurring to the page).
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a locked button's wrapper takes the button's place in its row", () => {
  test.each([
    ["NORMAL", ButtonStyleType.NORMAL],
    ["PRIMARY", ButtonStyleType.PRIMARY],
    ["DANGER", ButtonStyleType.DANGER],
    ["SUCCESS", ButtonStyleType.SUCCESS],
  ])(
    "%s, as wide as a phone, is wrapped as wide as the phone and inline from md up",
    (_name: string, buttonStyle: ButtonStyleType) => {
      render(
        <Button
          dataTestId="locked"
          title="Run Workflow"
          buttonStyle={buttonStyle}
          disabled={true}
          tooltip="Add a trigger first."
        />,
      );

      const wrapper: HTMLElement = screen.getByTestId(
        "locked-disabled-wrapper",
      );

      expect(wrapper).toHaveClass(
        "flex",
        "w-full",
        "md:inline-flex",
        "md:w-auto",
      );
      expect(wrapper).not.toHaveClass("inline-flex");
      // The button fills it, as it fills its row when it can be pressed.
      expect(screen.getByTestId("locked")).toHaveClass("w-full", "md:w-auto");
    },
  );

  test.each([
    ["OUTLINE", ButtonStyleType.OUTLINE],
    ["SECONDARY", ButtonStyleType.SECONDARY],
    ["LINK", ButtonStyleType.LINK],
    ["ICON", ButtonStyleType.ICON],
  ])(
    "%s, sized to its label, keeps a wrapper sized to it",
    (_name: string, buttonStyle: ButtonStyleType) => {
      render(
        <Button
          dataTestId="locked"
          title="Ping"
          buttonStyle={buttonStyle}
          disabled={true}
          tooltip="The probe is offline."
        />,
      );

      const wrapper: HTMLElement = screen.getByTestId(
        "locked-disabled-wrapper",
      );

      expect(wrapper).toHaveClass("inline-flex");
      expect(wrapper).not.toHaveClass("w-full");
    },
  );

  test("the place a caller gives the button in its row goes on the wrapper too", () => {
    render(
      <Button
        dataTestId="locked"
        title="Save"
        buttonStyle={ButtonStyleType.OUTLINE}
        className="flex-1 ml-auto sm:col-span-2 mt-2 text-left"
        disabled={true}
        tooltip="Nothing changed."
      />,
    );

    const wrapper: HTMLElement = screen.getByTestId("locked-disabled-wrapper");

    expect(wrapper).toHaveClass("flex-1", "ml-auto", "sm:col-span-2");
    // Not what draws the button: a margin of its own, its text's alignment.
    expect(wrapper).not.toHaveClass("mt-2");
    expect(wrapper).not.toHaveClass("text-left");
  });

  test("a locked wrapper has the not-allowed cursor; a busy one does not", () => {
    const { rerender } = render(
      <Button
        dataTestId="b"
        title="Save"
        disabled={true}
        tooltip="Nothing changed."
      />,
    );

    expect(screen.getByTestId("b-disabled-wrapper")).toHaveClass(
      "cursor-not-allowed",
    );

    rerender(
      <Button dataTestId="b" title="Save" isLoading={true} tooltip="Saving." />,
    );

    expect(screen.getByTestId("b-disabled-wrapper")).not.toHaveClass(
      "cursor-not-allowed",
    );
  });
});

/*
 * A button whose press makes it busy until the caller says it is done, as
 * a Save or a Refresh does.
 */
const PressToWork: FunctionComponent<{
  tooltip?: string | undefined;
  onPressed?: (() => void) | undefined;
}> = (props: {
  tooltip?: string | undefined;
  onPressed?: (() => void) | undefined;
}): ReactElement => {
  const [isWorking, setIsWorking] = useState<boolean>(false);

  return (
    <div>
      <input aria-label="Name" />
      <Button
        dataTestId="save"
        title="Save"
        isLoading={isWorking}
        disabled={isWorking}
        tooltip={props.tooltip}
        onClick={() => {
          setIsWorking(true);
          props.onPressed?.();
        }}
      />
      <button
        type="button"
        data-testid="finish"
        onClick={() => {
          setIsWorking(false);
        }}
      >
        Finish
      </button>
    </div>
  );
};

const pressFromTheKeyboard: (element: HTMLElement) => void = (
  element: HTMLElement,
): void => {
  act(() => {
    element.focus();
  });
  fireEvent.click(element);
};

/*
 * What the browser does to a focused control that becomes disabled: the
 * page itself takes the focus. jsdom blurs no disabled control, so the
 * focus goes through an element that is then taken away.
 */
const moveFocusToThePage: () => void = (): void => {
  act(() => {
    const sink: HTMLButtonElement = document.createElement("button");
    document.body.appendChild(sink);
    sink.focus();
    sink.remove();
  });
};

const finish: () => void = (): void => {
  // Finishing from a script, the way an answer from the server does.
  act(() => {
    (screen.getByTestId("finish") as HTMLButtonElement).click();
  });
};

describe("a pressed button that goes busy keeps the keyboard's place", () => {
  test("it takes the focus back when it is done", () => {
    render(<PressToWork />);

    pressFromTheKeyboard(screen.getByTestId("save"));
    expect(screen.getByTestId("save")).toBeDisabled();

    moveFocusToThePage();
    expect(document.activeElement).toBe(document.body);

    finish();

    expect(screen.getByTestId("save")).toBeEnabled();
    expect(screen.getByTestId("save")).toHaveFocus();
  });

  test("with a reason, the wrapper holds the focus while it works, and the button takes it back", () => {
    render(<PressToWork tooltip="Saving the rule." />);

    pressFromTheKeyboard(screen.getByTestId("save"));

    // Moved into its wrapper, the button was remounted: the wrapper has the focus.
    expect(screen.getByTestId("save-disabled-wrapper")).toHaveFocus();

    finish();

    expect(screen.getByTestId("save")).toHaveFocus();
  });

  test("someone who moved on while it worked keeps their place", () => {
    render(<PressToWork />);

    pressFromTheKeyboard(screen.getByTestId("save"));
    moveFocusToThePage();

    act(() => {
      screen.getByRole("textbox", { name: "Name" }).focus();
    });

    finish();

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  test("a press with the pointer elsewhere does not pull the focus to it", () => {
    render(<PressToWork />);

    // Pressed with the mouse in a browser that does not focus buttons (Safari).
    fireEvent.click(screen.getByTestId("save"));
    moveFocusToThePage();

    finish();

    expect(screen.getByTestId("save")).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  test("a button that goes busy on its own never takes the focus", () => {
    const Automatic: FunctionComponent = (): ReactElement => {
      const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

      return (
        <div>
          <Button
            dataTestId="refresh"
            title="Refresh"
            isLoading={isRefreshing}
          />
          <button
            type="button"
            data-testid="tick"
            onClick={() => {
              setIsRefreshing((value: boolean) => {
                return !value;
              });
            }}
          >
            Tick
          </button>
        </div>
      );
    };

    render(<Automatic />);

    act(() => {
      (screen.getByTestId("tick") as HTMLButtonElement).click();
    });
    moveFocusToThePage();
    act(() => {
      (screen.getByTestId("tick") as HTMLButtonElement).click();
    });

    expect(screen.getByTestId("refresh")).not.toHaveFocus();
  });

  test("a press long before it goes busy is not what made it busy", () => {
    const dateNow: SpyInstance<typeof Date.now> = jest.spyOn(Date, "now");
    dateNow.mockReturnValue(1_000_000);

    const Late: FunctionComponent = (): ReactElement => {
      const [isBusy, setIsBusy] = useState<boolean>(false);

      return (
        <div>
          <Button dataTestId="save" title="Save" isLoading={isBusy} />
          <button
            type="button"
            data-testid="toggle"
            onClick={() => {
              setIsBusy((value: boolean) => {
                return !value;
              });
            }}
          >
            Toggle
          </button>
        </div>
      );
    };

    render(<Late />);

    // Pressed from the keyboard; nothing happens then.
    pressFromTheKeyboard(screen.getByTestId("save"));

    // Much later something else makes it busy, and then done.
    dateNow.mockReturnValue(1_000_000 + FOCUS_KEEPING_PRESS_MS + 1);
    act(() => {
      (screen.getByTestId("toggle") as HTMLButtonElement).click();
    });
    moveFocusToThePage();
    act(() => {
      (screen.getByTestId("toggle") as HTMLButtonElement).click();
    });

    expect(screen.getByTestId("save")).not.toHaveFocus();
  });

  test("a press that made it busy within the window does", () => {
    const dateNow: SpyInstance<typeof Date.now> = jest.spyOn(Date, "now");
    dateNow.mockReturnValue(5_000_000);

    render(<PressToWork />);

    pressFromTheKeyboard(screen.getByTestId("save"));
    moveFocusToThePage();

    dateNow.mockReturnValue(5_000_000 + FOCUS_KEEPING_PRESS_MS * 10);
    finish();

    // How long it worked does not matter: the press made it busy at once.
    expect(screen.getByTestId("save")).toHaveFocus();
  });
});
