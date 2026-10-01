/*
 * "Insert value", for places whose value goes somewhere other than this
 * picker's own text field: a code editor's toolbar, the Schedule trigger's
 * choice of variable.
 */

import InsertValueButton from "../../../../../UI/Components/Workflow/ValuePicker/InsertValueButton";
import {
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { DEPLOY_ENV, withPicker } from "./ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

describe("InsertValueButton", () => {
  test("says Insert value, opens the list, and hands on the pick", async () => {
    const onPick: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(withPicker(<InsertValueButton onPick={onPick} />));

    const button: HTMLElement = screen.getByTestId("insert-value-button");
    expect(button).toHaveTextContent("{ }Insert value");
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(screen.getByTestId("value-picker-search")).toHaveFocus();

    fireEvent.click(
      screen.getAllByRole("option").find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === DEPLOY_ENV;
      })!,
    );

    expect(onPick).toHaveBeenCalledWith(DEPLOY_ENV);
    expect(screen.queryByTestId("value-picker")).toBeNull();
  });

  test("Escape gives the focus to whoever asked for it", async () => {
    const onCloseFocus: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(
      withPicker(
        <InsertValueButton onPick={() => {}} onCloseFocus={onCloseFocus} />,
      ),
    );

    await user.click(screen.getByTestId("insert-value-button"));
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("value-picker")).toBeNull();
    });
    expect(onCloseFocus).toHaveBeenCalledTimes(1);
  });

  test("without someone to give it to, the focus goes back to the button", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    render(withPicker(<InsertValueButton onPick={() => {}} />));

    await user.click(screen.getByTestId("insert-value-button"));
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("insert-value-button")).toHaveFocus();
  });

  test("can list only some groups, with words of its own when empty", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    render(
      withPicker(
        <InsertValueButton
          onPick={() => {}}
          groupFilter={(group: ValueSuggestionGroup) => {
            return group.kind === ValueSuggestionGroupKind.GlobalVariables;
          }}
          emptyMessage="No global variables."
        >
          Pick a global
        </InsertValueButton>,
        { groups: [] },
      ),
    );

    await user.click(screen.getByRole("button", { name: "Pick a global" }));

    expect(screen.getByTestId("value-picker-empty")).toHaveTextContent(
      "No global variables.",
    );
  });

  test("outside a step's settings it is not there", () => {
    render(<InsertValueButton onPick={() => {}} />);

    expect(screen.queryByTestId("insert-value-button")).toBeNull();
  });
});
