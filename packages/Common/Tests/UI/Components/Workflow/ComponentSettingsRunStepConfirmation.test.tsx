import ComponentSettingsModal, {
  ComponentProps as SettingsProps,
} from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * "Shouldn't 'Run this step' be primary?" - the maintainer, looking at the
 * workflow builder's confirmation. It drew Cancel and "Run this step" as the
 * same plain button and opened with the focus ring on Cancel, so the action
 * the user had just asked for looked like the lesser choice. Running the step
 * is the one primary button now, focus starts on it, and Cancel is the plain
 * way out. The step's own Delete confirmation stays red and starts on Cancel,
 * since deleting is not undone.
 *
 * The settings form and the documentation pane are stubbed: the form loads
 * the project's workflow variables and the pane fetches a markdown file, and
 * neither has anything to do with the footers under test.
 */
jest.mock("../../../../UI/Components/Workflow/ArgumentsForm", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="arguments-form" />;
    },
  };
});

jest.mock("../../../../UI/Components/Workflow/DocumentationViewer", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="documentation-viewer" />;
    },
  };
});

const LOG_METADATA: ComponentMetadata = {
  id: "log",
  title: "Log",
  description: "Write a message to the workflow log.",
  category: "Utils",
  iconProp: IconProp.Logs,
  componentType: ComponentType.Component,
  arguments: [
    {
      id: "value",
      name: "Value",
      description: "What to write.",
      required: true,
      type: ComponentInputType.Text,
    },
  ],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "Start this step." }],
  outPorts: [{ id: "out", title: "Out", description: "Continue." }],
};

const COMPONENT: NodeDataProp = {
  id: "log-1",
  internalId: "runner-log-1",
  nodeType: NodeType.Node,
  componentType: ComponentType.Component,
  metadataId: LOG_METADATA.id,
  metadata: LOG_METADATA,
  error: "",
  arguments: { value: "hello" },
  returnValues: {},
};

interface Harness {
  onRunStep: MockFunction;
  onDelete: MockFunction;
  onClose: MockFunction;
}

type RenderSettingsFunction = (overrides?: Partial<SettingsProps>) => Harness;

const renderSettings: RenderSettingsFunction = (
  overrides: Partial<SettingsProps> = {},
): Harness => {
  const onRunStep: MockFunction = getJestMockFunction();
  const onDelete: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();

  render(
    <ComponentSettingsModal
      title="Log"
      description="Write a message to the workflow log."
      onClose={onClose}
      onSave={getJestMockFunction()}
      onDelete={onDelete}
      onRunStep={onRunStep}
      component={COMPONENT}
      graphComponents={[COMPONENT]}
      workflowId={new ObjectID("11111111-1111-4111-8111-111111111111")}
      {...overrides}
    />,
  );

  return { onRunStep, onDelete, onClose };
};

type DialogNamedFunction = (name: string) => HTMLElement;

const dialogNamed: DialogNamedFunction = (name: string): HTMLElement => {
  return screen.getByRole("dialog", { name });
};

type FilledButtonsInFunction = (dialog: HTMLElement) => Array<HTMLElement>;

// A filled button is what a primary button looks like, whatever its colour.
const filledButtonsIn: FilledButtonsInFunction = (
  dialog: HTMLElement,
): Array<HTMLElement> => {
  return within(dialog)
    .getAllByRole("button")
    .filter((button: HTMLElement) => {
      return /\bbg-(indigo|red|green|yellow)-600\b/.test(button.className);
    });
};

type OpenRunStepConfirmationFunction = () => HTMLElement;

const openRunStepConfirmation: OpenRunStepConfirmationFunction =
  (): HTMLElement => {
    fireEvent.click(screen.getByRole("button", { name: "Run just this step" }));

    return dialogNamed("Run this step now?");
  };

describe("the workflow builder's 'Run this step now?' confirmation", () => {
  test("draws 'Run this step' as the primary button and Cancel as a plain one", () => {
    renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();
    const run: HTMLElement = within(confirmation).getByRole("button", {
      name: "Run this step",
    });
    const cancel: HTMLElement = within(confirmation).getByRole("button", {
      name: "Cancel",
    });

    expect(run).toHaveClass("bg-indigo-600", "text-white");
    expect(cancel).toHaveClass("bg-white");
    expect(cancel).not.toHaveClass("bg-indigo-600");
  });

  test("has exactly one primary button, and it is the run", () => {
    renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();
    const filled: Array<HTMLElement> = filledButtonsIn(confirmation);

    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent("Run this step");
  });

  test("opens with focus on 'Run this step', not on Cancel", () => {
    renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();

    expect(
      within(confirmation).getByRole("button", { name: "Run this step" }),
    ).toHaveFocus();
    expect(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    ).not.toHaveFocus();
  });

  test("keeps its focus ring for the keyboard, so a click-opened dialog rings nothing", () => {
    renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();

    for (const name of ["Run this step", "Cancel"]) {
      const button: HTMLElement = within(confirmation).getByRole("button", {
        name,
      });
      const ringOnPlainFocus: Array<string> = Array.from(
        button.classList,
      ).filter((className: string) => {
        return className.startsWith("focus:ring");
      });

      expect(ringOnPlainFocus).toEqual([]);
      expect(button).toHaveClass("focus-visible:ring-2");
    }
  });

  test("runs the step, with the settings as they are, when confirmed", () => {
    const { onRunStep } = renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Run this step" }),
    );

    expect(onRunStep).toHaveBeenCalledTimes(1);
    expect((onRunStep.mock.calls[0]![0] as NodeDataProp).id).toBe("log-1");
    expect(
      screen.queryByRole("dialog", { name: "Run this step now?" }),
    ).not.toBeInTheDocument();
  });

  test("runs nothing when cancelled", () => {
    const { onRunStep } = renderSettings();

    const confirmation: HTMLElement = openRunStepConfirmation();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );

    expect(onRunStep).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Run this step now?" }),
    ).not.toBeInTheDocument();
  });

  test("is not offered for a step that cannot run on its own", () => {
    renderSettings({ onRunStep: undefined });

    expect(
      screen.queryByRole("button", { name: "Run just this step" }),
    ).not.toBeInTheDocument();
  });
});

describe("the workflow step's Delete confirmation", () => {
  test("draws Delete as the one red button and opens with focus on Cancel", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // The topmost dialog: the confirmation opens over the settings.
    const dialogs: Array<HTMLElement> = screen.getAllByRole("dialog");
    const confirmation: HTMLElement = dialogs[dialogs.length - 1]!;

    expect(confirmation).not.toBe(dialogNamed("Log"));
    const remove: HTMLElement = within(confirmation).getByRole("button", {
      name: "Delete",
    });
    const cancel: HTMLElement = within(confirmation).getByRole("button", {
      name: "Cancel",
    });
    const filled: Array<HTMLElement> = filledButtonsIn(confirmation);

    expect(remove).toHaveClass("bg-red-600");
    expect(filled).toEqual([remove]);
    expect(cancel).toHaveFocus();
  });
});

describe("the step settings dialog itself", () => {
  test("keeps Save as its one primary button beside Delete and Run just this step", () => {
    renderSettings();

    const settings: HTMLElement = dialogNamed("Log");
    const footer: HTMLElement = within(settings).getByTestId("modal-footer");
    const filled: Array<HTMLElement> = within(footer)
      .getAllByRole("button")
      .filter((button: HTMLElement) => {
        return /\bbg-(indigo|red|green|yellow)-600\b/.test(button.className);
      });

    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent("Save");
  });
});
