import ConditionBuilder from "../../../../UI/Components/Workflow/ConditionBuilder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
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

// The chip helper is tested separately; stub it to keep this test focused.
jest.mock("../../../../UI/Components/Workflow/DataReferenceInput", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

const BASE_ARGS: JSONObject = {
  "input-1": "5",
  "input-1-type": "number",
  operator: ">",
  "input-2": "3",
  "input-2-type": "number",
};

type RenderResult = { onChange: MockFunction; onValidity: MockFunction };

type RenderBuilderFunction = (args: JSONObject) => RenderResult;

const renderBuilder: RenderBuilderFunction = (
  args: JSONObject,
): RenderResult => {
  const onChange: MockFunction = getJestMockFunction();
  const onValidity: MockFunction = getJestMockFunction();
  render(
    <ConditionBuilder
      arguments={args}
      onArgumentsChange={onChange}
      onValidityChange={onValidity}
      components={[]}
      workflowId={ObjectID.generate()}
    />,
  );
  return { onChange, onValidity };
};

describe("ConditionBuilder (If/Else)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the current condition values", () => {
    renderBuilder(BASE_ARGS);

    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      "5",
    );
    expect(
      (screen.getByLabelText("Compare with") as HTMLInputElement).value,
    ).toBe("3");
    expect(
      (screen.getByLabelText("Condition") as HTMLSelectElement).value,
    ).toBe(">");
  });

  it("writes the legacy input-1 / input-2 / operator ids on change", () => {
    const { onChange } = renderBuilder(BASE_ARGS);

    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "7" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ "input-1": "7" });

    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "==" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ operator: "==" });

    fireEvent.change(screen.getByLabelText("Compare with"), {
      target: { value: "9" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ "input-2": "9" });
  });

  it("writes the value-type id from the 'treated as' selector", () => {
    const { onChange } = renderBuilder(BASE_ARGS);

    fireEvent.change(screen.getByLabelText("Value treated as"), {
      target: { value: "text" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ "input-1-type": "text" });
  });

  it("defaults the value-type selector to Text when unset", () => {
    renderBuilder({ "input-1": "a", operator: "==", "input-2": "b" });

    expect(
      (screen.getByLabelText("Value treated as") as HTMLSelectElement).value,
    ).toBe("text");
  });

  it("reports invalid while a required value is empty, valid once filled", () => {
    const { onValidity } = renderBuilder({
      "input-1": "",
      operator: "==",
      "input-2": "b",
    });
    expect(onValidity).toHaveBeenLastCalledWith(true);

    cleanup();

    const filled: RenderResult = renderBuilder({
      "input-1": "a",
      operator: "==",
      "input-2": "b",
    });
    expect(filled.onValidity).toHaveBeenLastCalledWith(false);
  });
});
