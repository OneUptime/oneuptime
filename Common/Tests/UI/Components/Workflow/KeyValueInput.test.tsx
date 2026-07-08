import KeyValueInput from "../../../../UI/Components/Workflow/KeyValueInput";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// JSON-mode uses the Monaco-backed editor; stub it (rows mode is under test).
jest.mock("../../../../UI/Components/Workflow/JSONArgumentInput", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

describe("KeyValueInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per key/value pair", () => {
    render(
      <KeyValueInput
        value='{"Accept":"application/json"}'
        onChange={getJestMockFunction()}
      />,
    );

    const keys: Array<HTMLInputElement> = screen.getAllByLabelText(
      "Key",
    ) as Array<HTMLInputElement>;
    const values: Array<HTMLInputElement> = screen.getAllByLabelText(
      "Value",
    ) as Array<HTMLInputElement>;
    expect(keys[0]!.value).toBe("Accept");
    expect(values[0]!.value).toBe("application/json");
  });

  it("serializes edits back to a JSON object string", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(<KeyValueInput value='{"Accept":"x"}' onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "application/json" },
    });

    const last: string = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as string;
    expect(JSON.parse(last)).toEqual({ Accept: "application/json" });
  });

  it("adds and removes rows", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(<KeyValueInput value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("+ Add"));
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "X-Api-Key" },
    });
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "secret" },
    });

    let last: string = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as string;
    expect(JSON.parse(last)).toEqual({ "X-Api-Key": "secret" });

    fireEvent.click(screen.getByLabelText("Remove row"));
    last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    expect(last).toBe("");
  });

  it("starts in JSON mode when the value can't be shown as rows", () => {
    render(
      <KeyValueInput
        value='{"nested":{"a":1}}'
        onChange={getJestMockFunction()}
      />,
    );

    /*
     * No key/value rows are rendered; the "Edit as JSON" toggle is absent
     * because we're already in JSON mode (the JSON editor is stubbed to null).
     */
    expect(screen.queryByLabelText("Key")).toBeNull();
    expect(screen.getByText("Switch to fields")).toBeTruthy();
  });
});
