import StepTimeoutInput from "../../../../UI/Components/Runbook/StepTimeoutInput";
import {
  AGENT_CLAIM_TIMEOUT_BOUNDS,
  STEP_EXECUTION_TIMEOUT_BOUNDS,
  TimeoutBounds,
} from "../../../../Types/Runbook/RunbookStepTimeout";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const BOUNDS: TimeoutBounds = STEP_EXECUTION_TIMEOUT_BOUNDS;

interface RenderArgs {
  value?: number | undefined;
  bounds?: TimeoutBounds | undefined;
}

interface RenderedInput {
  input: HTMLInputElement;
  onChange: MockFunction;
  rerenderWithValue: (value: number | undefined) => void;
}

/*
 * JSDOM does not implement number-input value sanitization, so
 * validity.badInput never becomes true on its own. Stub it to reproduce what a
 * real browser reports for text like "1e" or "-".
 */
function markUnparseable(input: HTMLInputElement): void {
  Object.defineProperty(input, "validity", {
    configurable: true,
    value: { badInput: true },
  });
}

function clearUnparseable(input: HTMLInputElement): void {
  Object.defineProperty(input, "validity", {
    configurable: true,
    value: { badInput: false },
  });
}

function renderInput(args: RenderArgs = {}): RenderedInput {
  const onChange: MockFunction = getJestMockFunction();
  const bounds: TimeoutBounds = args.bounds || BOUNDS;

  type OnChangeFunction = (value: number | undefined) => void;

  const { rerender } = render(
    <StepTimeoutInput
      label="Execution timeout"
      value={args.value}
      bounds={bounds}
      onChange={onChange as unknown as OnChangeFunction}
      dataTestId="timeout-input"
    />,
  );

  return {
    input: screen.getByTestId("timeout-input") as HTMLInputElement,
    onChange,
    rerenderWithValue: (value: number | undefined): void => {
      rerender(
        <StepTimeoutInput
          label="Execution timeout"
          value={value}
          bounds={bounds}
          onChange={onChange as unknown as OnChangeFunction}
          dataTestId="timeout-input"
        />,
      );
    },
  };
}

describe("StepTimeoutInput", () => {
  test("renders a labelled field so the timeout is discoverable in the step editor", () => {
    renderInput();

    expect(screen.getByLabelText(/Execution timeout/i)).not.toBeNull();
  });

  test("an unset timeout shows an empty field placeholdered with the default", () => {
    const { input } = renderInput({ value: undefined });

    expect(input.value).toBe("");
    expect(input.placeholder).toBe("30");
  });

  test("a stored timeout is displayed in seconds, not milliseconds", () => {
    const { input } = renderInput({ value: 45_000 });

    expect(input.value).toBe("45");
  });

  test("a stored claim timeout of 2 minutes displays as 120 seconds", () => {
    const { input } = renderInput({
      value: 120_000,
      bounds: AGENT_CLAIM_TIMEOUT_BOUNDS,
    });

    expect(input.value).toBe("120");
  });

  test("typing seconds reports milliseconds back to the step config", () => {
    const { input, onChange } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "90" } });

    expect(onChange).toHaveBeenCalledWith(90_000);
  });

  test("clearing the field reports undefined, so the step falls back to the default", () => {
    const { input, onChange } = renderInput({ value: 45_000 });

    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("decimal seconds are stored as whole milliseconds", () => {
    const { input, onChange } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "1.5" } });

    expect(onChange).toHaveBeenCalledWith(1_500);
  });

  test("a partially typed 0 is not erased mid-edit", () => {
    /*
     * "0" resolves to "unset", so a field whose text was derived from props on
     * every render would blank itself the moment the author typed the first
     * character of "0.5". The typed text has to survive that round trip.
     */
    const { input, rerenderWithValue } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "0" } });
    rerenderWithValue(undefined);

    expect(input.value).toBe("0");
  });

  test("the field re-syncs when a different step's value is supplied", () => {
    const { input, rerenderWithValue } = renderInput({ value: 45_000 });

    expect(input.value).toBe("45");
    rerenderWithValue(300_000);

    expect(input.value).toBe("300");
  });

  test("the field clears when the supplied value is reset to unset", () => {
    const { input, rerenderWithValue } = renderInput({ value: 45_000 });

    rerenderWithValue(undefined);

    expect(input.value).toBe("");
  });

  test("the helper text states the default and the allowed range", () => {
    renderInput();

    const help: HTMLElement = screen.getByText(
      /Leave blank to use the default/i,
    );
    expect(help.textContent).toContain("30 seconds");
    expect(help.textContent).toContain("1–3600");
  });

  test("an optional description is rendered alongside the range help", () => {
    render(
      <StepTimeoutInput
        label="Execution timeout"
        value={undefined}
        bounds={BOUNDS}
        onChange={() => {}}
        description="How long the agent lets the script run."
      />,
    );

    expect(
      screen.getByText(/How long the agent lets the script run/i),
    ).not.toBeNull();
  });

  test("an in-range value raises no validation error", () => {
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "600" } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  test("a below-minimum value is flagged, and the author is told it will be clamped", () => {
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "0.5" } });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert.textContent).toContain("Minimum is 1 second.");
    expect(alert.textContent).toContain("clamped");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  test("an above-maximum value is flagged with the maximum", () => {
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "99999" } });

    expect(screen.getByRole("alert").textContent).toContain("Maximum is 3600");
  });

  test("a zero is flagged rather than silently meaning 'no timeout'", () => {
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "0" } });

    expect(screen.getByRole("alert").textContent).toContain(
      "Timeout must be greater than 0 seconds.",
    );
  });

  test("text the browser cannot parse does NOT discard the saved timeout", () => {
    /*
     * A number input hands back an empty string for text it cannot parse — a
     * dangling exponent, a lone minus — while still showing that text. Treating
     * that as "the author cleared the field" would report undefined and
     * silently drop a configured timeout back to the 30 second default, which
     * is the exact failure issue #2920 was filed about.
     */
    const { input, onChange } = renderInput({ value: 600_000 });

    markUnparseable(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("unparseable text is flagged, and the author is told the saved value is intact", () => {
    const { input } = renderInput({ value: 600_000 });

    markUnparseable(input);
    fireEvent.change(input, { target: { value: "" } });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert.textContent).toContain("Enter a number of seconds.");
    expect(alert.textContent).toContain("saved value is unchanged");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  test("a genuinely emptied field still reports undefined — it is not confused with unparseable text", () => {
    const { input, onChange } = renderInput({ value: 600_000 });

    // No badInput: the field really is empty.
    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("recovering from unparseable text clears the error and resumes reporting", () => {
    const { input, onChange } = renderInput({ value: 600_000 });

    markUnparseable(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("alert")).not.toBeNull();

    clearUnparseable(input);
    fireEvent.change(input, { target: { value: "90" } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledWith(90_000);
  });

  test("out-of-range input still reports a value, so the author's intent is saved and clamped later", () => {
    const { input, onChange } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "99999" } });

    expect(onChange).toHaveBeenCalledWith(99_999_000);
  });

  test("the error is part of the field's description, not only a live region", () => {
    /*
     * A screen reader landing on an already-invalid field reads its
     * description, not a live region that fired before focus. Without the error
     * in aria-describedby the user hears "invalid" and no reason.
     */
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "99999" } });

    const describedBy: string = input.getAttribute("aria-describedby") || "";
    const alert: HTMLElement = screen.getByRole("alert");

    expect(alert.id).not.toBe("");
    expect(describedBy.split(" ")).toContain(alert.id);
    // The range help stays in the description alongside the error.
    expect(describedBy.split(" ").length).toBe(2);
  });

  test("a valid field describes only the help text", () => {
    const { input } = renderInput({ value: 45_000 });

    const describedBy: string = input.getAttribute("aria-describedby") || "";

    expect(describedBy.split(" ").length).toBe(1);
    expect(document.getElementById(describedBy)?.textContent).toContain(
      "Leave blank to use the default",
    );
  });

  test("a zero is not advertised as clamped — it falls back to the default", () => {
    /*
     * Clamping and defaulting land at opposite ends of the range. Promising
     * "clamped" for a value that actually defaults would tell a fail-fast
     * author their 0 became 1 second when it really became 30.
     */
    const { input } = renderInput({ value: undefined });

    fireEvent.change(input, { target: { value: "0" } });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert.textContent).toContain("Timeout must be greater than 0");
    expect(alert.textContent).toContain("blank to use the default");
    expect(alert.textContent).not.toContain("clamped");
  });

  test("the native min/max mirror the bounds so browser spinners agree with validation", () => {
    const { input } = renderInput({ bounds: AGENT_CLAIM_TIMEOUT_BOUNDS });

    expect(input.getAttribute("min")).toBe("1");
    expect(input.getAttribute("max")).toBe("3600");
    expect(input.getAttribute("type")).toBe("number");
  });

  test("a disabled field cannot be edited", () => {
    render(
      <StepTimeoutInput
        label="Execution timeout"
        value={30_000}
        bounds={BOUNDS}
        onChange={() => {}}
        dataTestId="disabled-timeout-input"
        disabled={true}
      />,
    );

    expect(
      (screen.getByTestId("disabled-timeout-input") as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  test("two fields on the same step get distinct ids so both labels stay clickable", () => {
    render(
      <>
        <StepTimeoutInput
          label="Execution timeout"
          value={30_000}
          bounds={STEP_EXECUTION_TIMEOUT_BOUNDS}
          onChange={() => {}}
        />
        <StepTimeoutInput
          label="Claim timeout"
          value={120_000}
          bounds={AGENT_CLAIM_TIMEOUT_BOUNDS}
          onChange={() => {}}
        />
      </>,
    );

    const execution: HTMLInputElement = screen.getByLabelText(
      /Execution timeout/i,
    ) as HTMLInputElement;
    const claim: HTMLInputElement = screen.getByLabelText(
      /Claim timeout/i,
    ) as HTMLInputElement;

    expect(execution.id).not.toBe(claim.id);
    expect(execution.value).toBe("30");
    expect(claim.value).toBe("120");
  });
});
