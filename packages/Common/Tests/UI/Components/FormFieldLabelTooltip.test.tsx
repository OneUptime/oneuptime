import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import FieldLabelElement, {
  FIELD_LABEL_TOOLTIP_TEST_ID,
} from "../../../UI/Components/Forms/Fields/FieldLabel";

/*
 * A form field's label with an (i) beside its title: the field says what
 * it is in one line under the title, and the exact rule behind it - which
 * used to fill four or five lines under "Retries on Failure" - waits in the
 * (i), on hover or keyboard focus. The same prop and (i) as a details
 * card's FieldLabel (FieldLabelInfoCardTooltip).
 *
 * The (i) is drawn outside the <label>: inside it, its "About <title>"
 * would join the name the field's input is read out by.
 */

const RULE: string =
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3.";

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a form field's label with a tooltip", () => {
  test("without one, the label is drawn as before, with no (i)", () => {
    const view: ReturnType<typeof render> = render(
      <FieldLabelElement
        title="Retries on Failure"
        description="How many times to try again before the check fails. Up to 3."
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // The label is the first thing drawn, not wrapped in a row.
    expect(view.container.firstElementChild?.tagName).toBe("LABEL");
  });

  test("with one, an (i) named after the title sits beside it", () => {
    render(<FieldLabelElement title="Retries on Failure" tooltip={RULE} />);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Retries on Failure",
    });

    expect(info).toHaveAttribute("data-testid", FIELD_LABEL_TOOLTIP_TEST_ID);
    expect(info.previousElementSibling?.tagName).toBe("LABEL");
  });

  test("the (i) is outside the label, so the field's name stays its title", () => {
    render(
      <>
        <FieldLabelElement
          title="Retries on Failure"
          htmlFor="retries"
          tooltip={RULE}
        />
        <input id="retries" />
      </>,
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Retries on Failure",
    });

    expect(info.closest("label")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveAccessibleName(
      "Retries on Failure (Optional)",
    );
  });

  test("the rule is not on the page until someone reaches for it", () => {
    render(<FieldLabelElement title="Retries on Failure" tooltip={RULE} />);

    expect(screen.queryByText(RULE)).not.toBeInTheDocument();
  });

  test("hovering the (i) shows the rule", async () => {
    render(<FieldLabelElement title="Retries on Failure" tooltip={RULE} />);

    await hover(
      screen.getByRole("button", { name: "About Retries on Failure" }),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(RULE);
  });

  test("keyboard focus shows the rule too", async () => {
    render(<FieldLabelElement title="Retries on Failure" tooltip={RULE} />);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Retries on Failure",
    });

    act(() => {
      info.focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(RULE);
  });

  test("the one-line description stays under the title", () => {
    render(
      <FieldLabelElement
        title="Retries on Failure"
        description="How many times to try again before the check fails. Up to 3."
        tooltip={RULE}
      />,
    );

    expect(
      screen.getByText(
        "How many times to try again before the check fails. Up to 3.",
      ),
    ).toBeInTheDocument();
  });

  test.each([
    ["empty", ""],
    ["whitespace", "   "],
  ])("an %s tooltip draws no (i)", (_: string, tooltip: string) => {
    render(<FieldLabelElement title="Retries on Failure" tooltip={tooltip} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a click on the (i) does not focus or toggle the field it labels", () => {
    render(
      <>
        <FieldLabelElement
          title="Retries on Failure"
          htmlFor="retries"
          tooltip={RULE}
        />
        <input id="retries" type="checkbox" />
      </>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "About Retries on Failure" }),
    );

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).not.toHaveFocus();
  });
});
