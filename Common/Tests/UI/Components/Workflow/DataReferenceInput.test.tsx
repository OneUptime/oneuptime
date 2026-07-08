import DataReferenceInput from "../../../../UI/Components/Workflow/DataReferenceInput";
import { NodeDataProp } from "../../../../Types/Workflow/Component";
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

// VariableModal pulls in the whole model-list stack; stub it (not under test).
jest.mock("../../../../UI/Components/Workflow/VariableModal", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

const slack: NodeDataProp = {
  id: "slack-1",
  metadata: {
    title: "Send to Slack",
    returnValues: [
      { id: "error", name: "Error", description: "", required: false },
    ],
  },
} as unknown as NodeDataProp;

const log: NodeDataProp = {
  id: "log-1",
  metadata: {
    title: "Log",
    returnValues: [
      { id: "output", name: "Output", description: "", required: false },
    ],
  },
} as unknown as NodeDataProp;

const VALUE_WITH_TWO_REFS: string =
  "Hi {{local.components.slack-1.returnValues.error}} and " +
  "{{local.components.gone-1.returnValues.x}}";

type RenderResult = { onChange: MockFunction };

type RenderInputFunction = (value: string) => RenderResult;

const renderInput: RenderInputFunction = (value: string): RenderResult => {
  const onChange: MockFunction = getJestMockFunction();
  render(
    <DataReferenceInput
      value={value}
      onChange={onChange}
      components={[slack, log]}
      upstreamComponentIds={new Set(["slack-1"])}
      currentComponentId="current-1"
      workflowId={ObjectID.generate()}
    />,
  );
  return { onChange };
};

describe("DataReferenceInput (chips)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders each token as a chip and flags a broken reference", () => {
    renderInput(VALUE_WITH_TWO_REFS);

    // Resolvable reference shows a friendly label.
    expect(screen.getByText("Error · from Send to Slack")).toBeTruthy();

    /*
     * A reference to a missing step is flagged (the ⚠ marker is only rendered
     * for broken chips).
     */
    expect(screen.getByText("⚠")).toBeTruthy();
  });

  it("removes exactly the chosen reference when its chip is dismissed", () => {
    const { onChange } = renderInput(VALUE_WITH_TWO_REFS);

    fireEvent.click(
      screen.getByLabelText("Remove reference Error · from Send to Slack"),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const next: string = onChange.mock.calls[0]![0] as string;
    expect(next.includes("slack-1")).toBe(false);
    // The other reference is untouched.
    expect(next.includes("gone-1")).toBe(true);
  });

  it("inserts an upstream step's output from the menu", () => {
    const { onChange } = renderInput("Message: ");

    fireEvent.click(screen.getByTestId("insert-data-toggle"));

    // Upstream step is offered; its output can be inserted.
    expect(screen.getByText("Send to Slack")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Error" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe(
      "Message: {{local.components.slack-1.returnValues.error}}",
    );
  });

  it("hides non-upstream steps until 'Show all steps' is toggled", () => {
    renderInput("");

    fireEvent.click(screen.getByTestId("insert-data-toggle"));

    // 'Log' is downstream/unconnected — not offered by default.
    expect(screen.getByText("Send to Slack")).toBeTruthy();
    expect(screen.queryByText("Log")).toBeNull();

    fireEvent.click(screen.getByText("Show all steps"));

    expect(screen.getByText("Log")).toBeTruthy();
  });
});
