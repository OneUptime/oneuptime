import WorkflowOutline from "../../../../UI/Components/Workflow/WorkflowOutline";
import { ComponentType, NodeType } from "../../../../Types/Workflow/Component";
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
import { Edge, Node } from "reactflow";
import React from "react";

const wfNode: (
  rfId: string,
  dataId: string,
  title: string,
  componentType: ComponentType,
  outPortId?: string,
) => Node = (
  rfId: string,
  dataId: string,
  title: string,
  componentType: ComponentType,
  outPortId?: string,
): Node => {
  return {
    id: rfId,
    position: { x: 0, y: 0 },
    data: {
      id: dataId,
      nodeType: NodeType.Node,
      componentType: componentType,
      metadata: {
        title: title,
        outPorts: outPortId
          ? [{ id: outPortId, title: "Out", description: "" }]
          : [],
        arguments: [],
      },
      arguments: {},
    },
  } as unknown as Node;
};

describe("WorkflowOutline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the ordered steps from the trigger", () => {
    const nodes: Array<Node> = [
      wfNode("t", "schedule-1", "Schedule", ComponentType.Trigger, "execute"),
      wfNode("a", "slack-1", "Send to Slack", ComponentType.Component),
    ];
    const edges: Array<Edge> = [
      {
        id: "t->a",
        source: "t",
        target: "a",
        sourceHandle: "execute",
      },
    ];

    render(
      <WorkflowOutline
        nodes={nodes}
        edges={edges}
        onClose={getJestMockFunction()}
      />,
    );

    expect(screen.getByText("Schedule")).toBeTruthy();
    expect(screen.getByText("Send to Slack")).toBeTruthy();
  });

  it("shows a hint when there is no trigger", () => {
    const nodes: Array<Node> = [
      wfNode("a", "slack-1", "Send to Slack", ComponentType.Component),
    ];

    render(
      <WorkflowOutline
        nodes={nodes}
        edges={[]}
        onClose={getJestMockFunction()}
      />,
    );

    expect(
      screen.getByText("Add a trigger to see what this workflow does."),
    ).toBeTruthy();
  });

  it("closes when the close button is clicked", () => {
    const onClose: MockFunction = getJestMockFunction();
    render(<WorkflowOutline nodes={[]} edges={[]} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Close outline"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
