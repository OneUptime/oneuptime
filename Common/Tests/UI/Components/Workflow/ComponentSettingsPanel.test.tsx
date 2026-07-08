import ComponentSettingsPanel from "../../../../UI/Components/Workflow/ComponentSettingsPanel";
import {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * Mock the Monaco-backed editor so the import chain stays light in jsdom
 * (this test uses a plain Text argument, so the code editor is never
 * rendered). RTL getBy* queries throw when an element is missing, so they
 * double as presence assertions — we avoid jest-dom matchers, which aren't
 * typed for @jest/globals' expect.
 */
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock("../../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: { navigate: jest.fn() },
  };
});

type MakeComponentFunction = () => NodeDataProp;

const makeComponent: MakeComponentFunction = (): NodeDataProp => {
  return {
    error: "",
    id: "log-1",
    nodeType: NodeType.Node,
    isPreview: false,
    metadataId: "log",
    internalId: "internal-1",
    arguments: {},
    returnValues: {},
    componentType: ComponentType.Component,
    metadata: {
      id: "log",
      title: "Log to Console",
      category: "Utility",
      description: "Logs a message",
      iconProp: IconProp.Bolt,
      componentType: ComponentType.Component,
      arguments: [
        {
          id: "text",
          name: "Message",
          description: "The message to log.",
          required: false,
          type: ComponentInputType.Text,
        },
      ],
      returnValues: [],
      inPorts: [{ id: "in", title: "In", description: "Where it starts." }],
      outPorts: [],
    },
  } as NodeDataProp;
};

type RenderPanelResult = {
  onClose: MockFunction;
  onSave: MockFunction;
  onDelete: MockFunction;
  component: NodeDataProp;
};

type RenderPanelFunction = () => RenderPanelResult;

const renderPanel: RenderPanelFunction = (): RenderPanelResult => {
  const onClose: MockFunction = getJestMockFunction();
  const onSave: MockFunction = getJestMockFunction();
  const onDelete: MockFunction = getJestMockFunction();
  const component: NodeDataProp = makeComponent();

  render(
    <ComponentSettingsPanel
      title="Log to Console"
      description="Logs a message"
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      component={component}
      graphComponents={[component]}
      workflowId={ObjectID.generate()}
    />,
  );

  return { onClose, onSave, onDelete, component };
};

describe("ComponentSettingsPanel (docked inspector)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the step title and its settings", async () => {
    renderPanel();

    expect(
      screen.getByRole("heading", { name: "Log to Console" }),
    ).toBeTruthy();

    // The argument field renders (ArgumentsForm builds it asynchronously).
    await waitFor(() => {
      expect(screen.getByText("Message")).toBeTruthy();
    });
  });

  it("saves the step when Save is clicked", () => {
    const { onSave } = renderPanel();

    fireEvent.click(screen.getByTestId("workflow-step-save"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ id: "log-1" });
  });

  it("closes when the close button is clicked", () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByLabelText("Close settings"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the technical Identifier until Advanced is expanded", async () => {
    renderPanel();

    expect(screen.queryByText("Identifier")).toBeNull();

    fireEvent.click(screen.getByText("Show advanced (identifier)"));

    await waitFor(() => {
      expect(screen.getByText("Identifier")).toBeTruthy();
    });
  });

  it("deletes the step only after confirmation", async () => {
    const { onDelete, onClose } = renderPanel();

    // Opening the panel does not delete anything.
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("workflow-step-delete"));

    // A confirmation dialog appears.
    await waitFor(() => {
      expect(
        screen.getByText(
          "Are you sure you want to delete this component? This action is not recoverable.",
        ),
      ).toBeTruthy();
    });

    /*
     * Confirm the deletion (the dialog's submit button, distinct from the
     * footer's Delete trigger).
     */
    const deleteButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Delete",
    });
    fireEvent.click(deleteButtons[deleteButtons.length - 1] as HTMLElement);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
