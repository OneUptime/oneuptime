import DatabaseStepPicker from "../../../../UI/Components/Workflow/DatabaseStepPicker";
import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
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

const comp: (
  id: string,
  title: string,
  tableName: string,
  category: string,
) => ComponentMetadata = (
  id: string,
  title: string,
  tableName: string,
  category: string,
): ComponentMetadata => {
  return {
    id: id,
    title: title,
    description: "",
    tableName: tableName,
    category: category,
    iconProp: IconProp.Database,
    componentType: ComponentType.Component,
  } as unknown as ComponentMetadata;
};

const catalog: Array<ComponentMetadata> = [
  comp("incident-find-one", "Find One Incident", "Incident", "Incident"),
  comp("incident-create-one", "Create Incident", "Incident", "Incident"),
  comp("monitor-find-one", "Find One Monitor", "Monitor", "Monitor"),
];

describe("DatabaseStepPicker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("lists the available models", () => {
    render(
      <DatabaseStepPicker
        components={catalog}
        componentType={ComponentType.Component}
        onSelect={getJestMockFunction()}
      />,
    );

    expect(screen.getByText("Incident")).toBeTruthy();
    expect(screen.getByText("Monitor")).toBeTruthy();
  });

  it("drills into a model and selects an operation", () => {
    const onSelect: MockFunction = getJestMockFunction();
    render(
      <DatabaseStepPicker
        components={catalog}
        componentType={ComponentType.Component}
        onSelect={onSelect}
      />,
    );

    // Open the Incident model.
    fireEvent.click(screen.getByText("Incident"));

    // Its operations are shown.
    expect(screen.getByText("Find One Incident")).toBeTruthy();
    expect(screen.getByText("Create Incident")).toBeTruthy();
    // Monitor's operation is not shown here.
    expect(screen.queryByText("Find One Monitor")).toBeNull();

    fireEvent.click(screen.getByText("Create Incident"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({
      id: "incident-create-one",
    });
  });

  it("can go back to the model list", () => {
    render(
      <DatabaseStepPicker
        components={catalog}
        componentType={ComponentType.Component}
        onSelect={getJestMockFunction()}
      />,
    );

    fireEvent.click(screen.getByText("Incident"));
    expect(screen.getByText("Find One Incident")).toBeTruthy();

    fireEvent.click(screen.getByText("All records"));
    // Back to models: the operation is gone, the model card is back.
    expect(screen.queryByText("Find One Incident")).toBeNull();
    expect(screen.getByText("Monitor")).toBeTruthy();
  });
});
