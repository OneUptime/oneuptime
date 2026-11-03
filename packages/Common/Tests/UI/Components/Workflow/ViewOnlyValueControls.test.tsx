/*
 * The value controls of a step's settings, on a view (WorkflowViewOnly): a
 * step opened by someone who may not change the workflow.
 *
 * A view shows each value as it is, and draws nothing that only changes it.
 * Held still in a disabled fieldset, such a control looked as if it could
 * be pressed - full ink, on a dialog that says nothing can be changed - and
 * a reader has no use for it (UI review of #5580):
 *
 *   - a value taken from an earlier step has no "abc" back to typing one
 *     (ValueSingleField, and a record's typed cell, ColumnValueInput);
 *   - a schedule has nothing to clear, no Change and no Clear for its
 *     variable, and says which kind of schedule it is, pressed
 *     (CronScheduleField);
 *   - a list of values in a query has no remove on an entry and no box to
 *     type the next one into, and says None when it has none;
 *   - Add field's list is never opened on a view, and would draw nothing
 *     if it were (AddFieldsPanel);
 *   - an empty value box keeps the height of a line, its placeholder inside
 *     it: one that cannot be typed in had no line, and shrank to its
 *     padding (TemplateTextEditor).
 *
 * Each beside the same control for whoever may change the workflow.
 */

import CronScheduleField from "../../../../UI/Components/Workflow/CronScheduleField";
import ColumnValueInput from "../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import AddFieldsPanel from "../../../../UI/Components/Workflow/FieldPicker/AddFieldsPanel";
import {
  FieldGroupId,
  FieldOption,
} from "../../../../UI/Components/Workflow/FieldPicker/FieldPickerOptions";
import TemplateTextEditor, {
  READ_ONLY_EMPTY_LINE_CLASS,
} from "../../../../UI/Components/Workflow/ValuePicker/TemplateTextEditor";
import ValueSingleField, {
  ValueSingleFieldKind,
} from "../../../../UI/Components/Workflow/ValuePicker/ValueSingleField";
import { ReferenceDescription } from "../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import { WorkflowViewOnlyContext } from "../../../../UI/Components/Workflow/WorkflowViewOnly";
import {
  DictionaryFilterOperator,
  getOperatorOption,
} from "../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { DEPLOY_ENV, withPicker } from "./ValuePicker/ValuePickerTestUtils";
import getJestMockFunction from "../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

// Drawn on a view (true), or for someone who may change the workflow (false).
const inView: (isViewOnly: boolean, element: ReactElement) => HTMLElement = (
  isViewOnly: boolean,
  element: ReactElement,
): HTMLElement => {
  render(
    <WorkflowViewOnlyContext.Provider value={isViewOnly}>
      {withPicker(<div data-testid="harness">{element}</div>)}
    </WorkflowViewOnlyContext.Provider>,
  );

  return screen.getByTestId("harness");
};

describe("a number taken from an earlier step", () => {
  const field: ReactElement = (
    <ValueSingleField
      kind={ValueSingleFieldKind.Number}
      value={DEPLOY_ENV}
      dataTestId="port"
      onChange={getJestMockFunction()}
    />
  );

  test("on a view: its chip, with no abc back to typing one", () => {
    const harness: HTMLElement = inView(true, field);

    expect(screen.getByTestId("port")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByTestId("port-type-a-value")).toBeNull();
    expect(within(harness).queryAllByRole("button")).toEqual([]);
  });

  test("for an editor: abc is there, to type a number again", () => {
    inView(false, field);

    expect(screen.getByTestId("port-type-a-value")).toHaveTextContent("abc");
  });
});

describe("a schedule", () => {
  test("on a view: the schedule picked, with nothing to clear, its kind said as pressed", () => {
    const harness: HTMLElement = inView(
      true,
      <CronScheduleField
        initialValue="*/5 * * * *"
        onChange={getJestMockFunction()}
      />,
    );

    expect(harness).toHaveTextContent("Every 5 minutes");
    expect(
      harness.querySelector(".ou-select__control--is-disabled"),
    ).not.toBeNull();
    expect(harness.querySelector(".ou-select__clear-indicator")).toBeNull();
    expect(
      within(harness).getByRole("button", { name: "Common schedules" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(harness).getByRole("button", { name: "Custom cron" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("on a view: a schedule from a variable is its chip, with no Change and no Clear", () => {
    const harness: HTMLElement = inView(
      true,
      <CronScheduleField
        initialValue={DEPLOY_ENV}
        onChange={getJestMockFunction()}
      />,
    );

    expect(
      within(harness).getByRole("button", { name: "Variable" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(harness).toHaveTextContent("DEPLOY_ENV");
    expect(within(harness).queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByTestId("cron-schedule-change-variable")).toBeNull();
  });

  test("for an editor: the schedule can be cleared, and a variable changed or cleared", () => {
    const preset: HTMLElement = inView(
      false,
      <CronScheduleField
        initialValue="*/5 * * * *"
        onChange={getJestMockFunction()}
      />,
    );

    expect(preset.querySelector(".ou-select__control--is-disabled")).toBeNull();

    cleanup();

    const variable: HTMLElement = inView(
      false,
      <CronScheduleField
        initialValue={DEPLOY_ENV}
        onChange={getJestMockFunction()}
      />,
    );

    expect(
      within(variable).getByRole("button", { name: "Clear" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("cron-schedule-change-variable"),
    ).toBeInTheDocument();
  });
});

describe("a record's typed cell holding a value from an earlier step", () => {
  const cell: ReactElement = (
    <ColumnValueInput
      control={ModelColumnControl.Number}
      valueMode={ColumnValueMode.Reference}
      text={DEPLOY_ENV}
      values={[]}
      dataTestId="retries"
      onChange={getJestMockFunction()}
    />
  );

  test("on a view: its chip, with no abc", () => {
    inView(true, cell);

    expect(screen.getByTestId("retries")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByTestId("retries-type-a-value")).toBeNull();
  });

  test("for an editor: abc is there", () => {
    inView(false, cell);

    expect(screen.getByTestId("retries-type-a-value")).toBeInTheDocument();
  });
});

describe("a query's list of values (is any of)", () => {
  const list: (values: Array<string>) => ReactElement = (
    values: Array<string>,
  ): ReactElement => {
    return (
      <ColumnValueInput
        control={ModelColumnControl.Text}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={values}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsAnyOf)}
        dataTestId="severity"
        onChange={getJestMockFunction()}
      />
    );
  };

  test("on a view: its entries, with no remove and no box for another", () => {
    const harness: HTMLElement = inView(true, list(["Critical", "Major"]));

    expect(harness).toHaveTextContent("Critical");
    expect(harness).toHaveTextContent("Major");
    expect(within(harness).queryAllByRole("button")).toEqual([]);
    expect(within(harness).queryByRole("textbox")).toBeNull();
  });

  test("on a view, empty: None", () => {
    const harness: HTMLElement = inView(true, list([]));

    expect(harness).toHaveTextContent("None");
    expect(within(harness).queryByRole("textbox")).toBeNull();
  });

  test("for an editor: each entry has its remove, and a box takes the next", () => {
    const harness: HTMLElement = inView(false, list(["Critical"]));

    expect(
      within(harness).getByRole("button", { name: "Remove Critical" }),
    ).toBeInTheDocument();
    expect(within(harness).getByRole("textbox")).toBeInTheDocument();
    expect(harness).not.toHaveTextContent("None");
  });
});

describe("Add field's list", () => {
  const TITLE: FieldOption = {
    path: "title",
    title: "Title",
    shortTitle: "Title",
    typeLabel: "Text",
    columnType: "Text",
    group: FieldGroupId.Main,
    aliases: [],
  };

  const panel: ReactElement = (
    <AddFieldsPanel
      options={[TITLE]}
      groups={[{ id: FieldGroupId.Main, label: "Main", options: [TITLE] }]}
      chosen={[]}
      onToggle={getJestMockFunction()}
      onClose={getJestMockFunction()}
      label="Fields to pass on"
      dataTestId="fields"
    />
  );

  test("on a view, were it opened: draws nothing", () => {
    const harness: HTMLElement = inView(true, panel);

    expect(harness).toBeEmptyDOMElement();
  });

  test("for an editor: the list of fields", () => {
    inView(false, panel);

    expect(screen.getByTestId("fields-panel")).toHaveTextContent("Title");
  });
});

describe("an empty value box that is only read", () => {
  const box: (data: {
    isViewOnly: boolean;
    disabled?: boolean | undefined;
    value?: string | undefined;
  }) => HTMLElement = (data: {
    isViewOnly: boolean;
    disabled?: boolean | undefined;
    value?: string | undefined;
  }): HTMLElement => {
    render(
      <WorkflowViewOnlyContext.Provider value={data.isViewOnly}>
        <TemplateTextEditor
          value={data.value || ""}
          onChange={getJestMockFunction()}
          multiline={false}
          placeholder="Name <email@company.com>"
          describeReference={(): ReferenceDescription | null => {
            return null;
          }}
          disabled={data.disabled}
          dataTestId="from"
        />
      </WorkflowViewOnlyContext.Provider>,
    );

    return screen.getByTestId("from");
  };

  test("on a view: holds a line while it is empty", () => {
    const editor: HTMLElement = box({ isViewOnly: true });

    expect(editor).toBeEmptyDOMElement();
    expect(editor.className).toContain(READ_ONLY_EMPTY_LINE_CLASS);
    // Its placeholder is still drawn, inside it.
    expect(screen.getByText("Name <email@company.com>")).toBeInTheDocument();
  });

  test("disabled: the same", () => {
    const editor: HTMLElement = box({ isViewOnly: false, disabled: true });

    expect(editor.className).toContain(READ_ONLY_EMPTY_LINE_CLASS);
  });

  test("the line is a kept space, only while there is no text", () => {
    // A space the box keeps (whitespace-pre-wrap), and only on :empty.
    expect(READ_ONLY_EMPTY_LINE_CLASS).toBe("empty:before:content-['_']");

    const editor: HTMLElement = box({
      isViewOnly: true,
      value: "ops@example.com",
    });

    expect(editor).toHaveTextContent("ops@example.com");
    expect(editor.className).toContain("whitespace-pre-wrap");
  });

  test("for an editor: the browser gives the box its line, for the caret", () => {
    const editor: HTMLElement = box({ isViewOnly: false });

    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(editor.className).not.toContain(READ_ONLY_EMPTY_LINE_CLASS);
  });
});
