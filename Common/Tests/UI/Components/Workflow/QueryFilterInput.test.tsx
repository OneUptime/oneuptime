import QueryFilterInput from "../../../../UI/Components/Workflow/QueryFilterInput";
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

describe("QueryFilterInput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a filter row per field with its inferred type", () => {
    render(
      <QueryFilterInput value='{"count":5}' onChange={getJestMockFunction()} />,
    );

    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe(
      "count",
    );
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      "5",
    );
    expect(
      (screen.getByLabelText("Field value type") as HTMLSelectElement).value,
    ).toBe("number");
  });

  it("serializes a number-typed row to a numeric value", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(<QueryFilterInput value='{"count":5}' onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "10" },
    });

    const last: string = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as string;
    expect(JSON.parse(last)).toEqual({ count: 10 });
    expect(typeof JSON.parse(last).count).toBe("number");
  });

  it("adds and removes filters", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(<QueryFilterInput value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("+ Add filter"));
    fireEvent.change(screen.getByLabelText("Field"), {
      target: { value: "state" },
    });
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "open" },
    });

    let last: string = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as string;
    expect(JSON.parse(last)).toEqual({ state: "open" });

    fireEvent.click(screen.getByLabelText("Remove filter"));
    last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    expect(last).toBe("");
  });

  it("starts in JSON mode for a query that uses operators", () => {
    render(
      <QueryFilterInput
        value='{"createdAt":{"_type":"GreaterThan","value":1}}'
        onChange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByLabelText("Field")).toBeNull();
    expect(screen.getByText("Switch to fields")).toBeTruthy();
  });
});
