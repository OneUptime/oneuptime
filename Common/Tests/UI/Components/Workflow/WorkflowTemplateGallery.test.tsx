import WorkflowTemplateGallery from "../../../../UI/Components/Workflow/WorkflowTemplateGallery";
import { WorkflowTemplate } from "../../../../UI/Components/Workflow/WorkflowTemplates";
import IconProp from "../../../../Types/Icon/IconProp";
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

const templates: Array<WorkflowTemplate> = [
  {
    id: "a",
    name: "Scheduled Slack message",
    description: "Post to Slack on a schedule.",
    icon: IconProp.Slack,
    steps: [],
    connections: [],
  },
  {
    id: "b",
    name: "Webhook to Slack",
    description: "Post to Slack from a webhook.",
    icon: IconProp.SendMessage,
    steps: [],
    connections: [],
  },
];

describe("WorkflowTemplateGallery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists the available templates", () => {
    render(
      <WorkflowTemplateGallery
        templates={templates}
        onSelect={getJestMockFunction()}
        onDismiss={getJestMockFunction()}
      />,
    );

    expect(screen.getByText("Scheduled Slack message")).toBeTruthy();
    expect(screen.getByText("Webhook to Slack")).toBeTruthy();
  });

  it("selects a template when its card is clicked", () => {
    const onSelect: MockFunction = getJestMockFunction();
    render(
      <WorkflowTemplateGallery
        templates={templates}
        onSelect={onSelect}
        onDismiss={getJestMockFunction()}
      />,
    );

    fireEvent.click(screen.getByText("Webhook to Slack"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ id: "b" });
  });

  it("dismisses when 'Start from scratch' is clicked", () => {
    const onDismiss: MockFunction = getJestMockFunction();
    render(
      <WorkflowTemplateGallery
        templates={templates}
        onSelect={getJestMockFunction()}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByText("Start from scratch"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
