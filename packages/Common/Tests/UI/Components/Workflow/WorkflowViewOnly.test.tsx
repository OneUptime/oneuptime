/*
 * THE BUILDER AS A VIEW (WorkflowViewOnly), piece by piece: a step's card on
 * a canvas that is a view, and the Builder's status pill. For someone who
 * may open a workflow but not change it - a Workflow Member, who runs
 * workflows, or a viewer - nothing on the canvas asks to be pressed: the
 * dashed card of a workflow without a trigger says it has none, a step
 * still to be set up says it is not set up, and the pill where the save
 * state was says "View only". Outside a view every card reads as it did.
 *
 * The canvas (Workflow.test.tsx), the step's dialog
 * (ComponentSettingsModalViewOnly.test.tsx) and the Builder page
 * (App/Dashboard/WorkflowBuilderViewOnly.test.tsx) are tested on their own.
 */

import WorkflowNode, {
  WORKFLOW_NODE_SETUP_TEXT,
} from "../../../../UI/Components/Workflow/Component";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import WorkflowStatusBar, {
  WORKFLOW_VIEW_ONLY_TEXT,
  WorkflowSaveState,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import {
  WORKFLOW_NODE_NOT_SET_UP_TEXT,
  WORKFLOW_NO_TRIGGER_TEXT,
  WorkflowViewOnlyContext,
} from "../../../../UI/Components/Workflow/WorkflowViewOnly";
import { WORKFLOW_STEP_VIEW_ONLY_TEXT } from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { WorkflowRunCopy } from "../../../../UI/Components/Workflow/WorkflowRunGate";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
  act,
} from "react-test-renderer";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// React Flow's Handle needs the canvas's store; the card is tested on its own.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (): null => {
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    useNodeId: (): string => {
      return "canvas-node";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return (): void => {};
    },
  };
});

// Records what each tooltip would say, without Tippy's hover machinery.
jest.mock("../../../../UI/Components/Tooltip/Tooltip", () => {
  return {
    __esModule: true,
    default: (props: { text?: string; children: ReactElement }) => {
      return (
        <span data-testid="tooltip" data-tooltip-text={props.text || ""}>
          {props.children}
        </span>
      );
    },
  };
});

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const VIEW_ONLY_REASON: string =
  "Changing this workflow takes permission to edit it. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.";

const LOG_METADATA: ComponentMetadata = {
  id: "log",
  title: "Log",
  description: "Writes its value to the run's log.",
  category: "Utils",
  iconProp: IconProp.File,
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
  inPorts: [{ id: "in", title: "In", description: "Start." }],
  outPorts: [{ id: "out", title: "Out", description: "Done." }],
};

// The dashed card, as Workflow's getPlaceholderTriggerNode makes it.
const placeholderData: (
  onClick?: MockFunction | undefined,
) => WorkflowNodeRenderData = (
  onClick?: MockFunction | undefined,
): WorkflowNodeRenderData => {
  return {
    metadata: {
      iconProp: IconProp.Bolt,
      componentType: ComponentType.Trigger,
      title: "Trigger",
      description: "Choose what starts this workflow",
    },
    metadataId: "",
    internalId: "",
    nodeType: NodeType.PlaceholderNode,
    id: "",
    error: "",
    ...(onClick
      ? {
          onClick: onClick as unknown as NonNullable<
            WorkflowNodeRenderData["onClick"]
          >,
        }
      : {}),
  } as WorkflowNodeRenderData;
};

// A Log step whose Value is still empty.
const unsetStepData: () => WorkflowNodeRenderData =
  (): WorkflowNodeRenderData => {
    return {
      id: "log-1",
      internalId: "runner-log-1",
      nodeType: NodeType.Node,
      componentType: ComponentType.Component,
      metadataId: LOG_METADATA.id,
      metadata: LOG_METADATA,
      error: "",
      arguments: {},
      returnValues: {},
      issueSummary: {
        missingSettingMessages: ['"Value" is required but empty.'],
        errorMessages: [],
        warningMessages: [],
      },
    };
  };

type RenderCardFunction = (
  data: WorkflowNodeRenderData,
  isViewOnly: boolean,
) => void;

const renderCard: RenderCardFunction = (
  data: WorkflowNodeRenderData,
  isViewOnly: boolean,
): void => {
  render(
    <WorkflowViewOnlyContext.Provider value={isViewOnly}>
      <WorkflowNode data={data} selected={false} />
    </WorkflowViewOnlyContext.Provider>,
  );
};

/*
 * The dashed card's border under the pointer and away from it. jsdom drops
 * var() values, so the raw style object is read through react-test-renderer.
 */
const placeholderBorders: (isViewOnly: boolean) => {
  away: string;
  under: string;
} = (isViewOnly: boolean): { away: string; under: string } => {
  let tree: ReactTestRenderer | null = null;

  act(() => {
    tree = renderer.create(
      <WorkflowViewOnlyContext.Provider value={isViewOnly}>
        <WorkflowNode data={placeholderData()} selected={false} />
      </WorkflowViewOnlyContext.Provider>,
    );
  });

  const card: () => ReactTestInstance = (): ReactTestInstance => {
    return (tree as unknown as ReactTestRenderer).root.findByProps({
      "data-testid": "workflow-trigger-placeholder",
    });
  };

  const away: string = String(card().props["style"]["border"]);

  act(() => {
    card().props["onMouseOver"]();
  });

  const under: string = String(card().props["style"]["border"]);

  act(() => {
    (tree as unknown as ReactTestRenderer).unmount();
  });

  return { away, under };
};

afterEach(() => {
  cleanup();
});

describe("the dashed card of a workflow without a trigger", () => {
  test("on a view, says the workflow has none, with the trigger's own icon - not a plus", () => {
    renderCard(placeholderData(), true);

    const card: HTMLElement = screen.getByTestId(
      "workflow-trigger-placeholder",
    );

    expect(card).toHaveTextContent(WORKFLOW_NO_TRIGGER_TEXT);
    expect(WORKFLOW_NO_TRIGGER_TEXT).toBe("No trigger yet");
    expect(card).not.toHaveTextContent("Choose what starts this workflow");
  });

  test("on a view, does not look or react like something to press", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderCard(placeholderData(onClick), true);

    const card: HTMLElement = screen.getByTestId(
      "workflow-trigger-placeholder",
    );

    expect(card).toHaveClass("cursor-default");
    expect(card).not.toHaveClass("cursor-pointer");

    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();

    // Its border stays put under the pointer.
    const borders: { away: string; under: string } = placeholderBorders(true);
    expect(borders.under).toBe(borders.away);
  });

  test("outside a view, asks to choose a trigger and reacts to the pointer, as it always did", () => {
    const onClick: MockFunction = getJestMockFunction();

    renderCard(placeholderData(onClick), false);

    const card: HTMLElement = screen.getByTestId(
      "workflow-trigger-placeholder",
    );

    expect(card).toHaveTextContent("Choose what starts this workflow");
    expect(card).not.toHaveTextContent(WORKFLOW_NO_TRIGGER_TEXT);
    expect(card).toHaveClass("cursor-pointer");

    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);

    const borders: { away: string; under: string } = placeholderBorders(false);
    expect(borders.under).not.toBe(borders.away);
  });

  test("a card drawn without a canvas around it is not a view", () => {
    render(<WorkflowNode data={placeholderData()} selected={false} />);

    expect(
      screen.getByTestId("workflow-trigger-placeholder"),
    ).toHaveTextContent("Choose what starts this workflow");
  });
});

describe("a step whose settings are still empty", () => {
  test("on a view, says it is not set up yet, with the same list of what is empty on hover", () => {
    renderCard(unsetStepData(), true);

    const hint: HTMLElement = screen.getByTestId("workflow-node-setup-hint");

    expect(hint).toHaveTextContent(WORKFLOW_NODE_NOT_SET_UP_TEXT);
    expect(WORKFLOW_NODE_NOT_SET_UP_TEXT).toBe("Not set up yet");
    expect(hint).not.toHaveTextContent(WORKFLOW_NODE_SETUP_TEXT);
    expect(
      hint
        .closest('[data-testid="tooltip"]')
        ?.getAttribute("data-tooltip-text"),
    ).toBe('"Value" is required but empty.');
  });

  test("outside a view, still says Click to set up", () => {
    renderCard(unsetStepData(), false);

    expect(screen.getByTestId("workflow-node-setup-hint")).toHaveTextContent(
      WORKFLOW_NODE_SETUP_TEXT,
    );
  });
});

describe("the Builder's status pill", () => {
  test("on a view, says View only in place of the save state, with the reason under the pointer and read out", () => {
    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        readOnlyReason={VIEW_ONLY_REASON}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("workflow-view-only-status");

    expect(pill).toHaveTextContent(WORKFLOW_VIEW_ONLY_TEXT);
    expect(WORKFLOW_VIEW_ONLY_TEXT).toBe("View only");
    expect(pill).toHaveAttribute("title", VIEW_ONLY_REASON);
    expect(pill.querySelector(".sr-only")).toHaveTextContent(VIEW_ONLY_REASON);
    // Nothing is saved on a view, so nothing says it was.
    expect(
      screen.queryByTestId("workflow-save-status"),
    ).not.toBeInTheDocument();
    expect(pill).not.toHaveTextContent("Saved");
  });

  test("for an editor, says the save state as before", () => {
    render(<WorkflowStatusBar saveState={WorkflowSaveState.Saved} />);

    expect(screen.getByTestId("workflow-save-status")).toHaveTextContent(
      "Saved",
    );
    expect(
      screen.queryByTestId("workflow-view-only-status"),
    ).not.toBeInTheDocument();
  });

  test("still says what a run the reader started is doing", () => {
    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Idle}
        readOnlyReason={VIEW_ONLY_REASON}
        runStatusMessage="Running..."
        onShowRunLog={getJestMockFunction()}
      />,
    );

    expect(
      screen.getByTestId("workflow-run-status-button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-view-only-status")).toBeInTheDocument();
  });
});

describe("the words of a view", () => {
  test("every Dashboard language has them, translated", () => {
    const keys: Array<string> = [
      WORKFLOW_VIEW_ONLY_TEXT,
      WORKFLOW_NO_TRIGGER_TEXT,
      WORKFLOW_NODE_NOT_SET_UP_TEXT,
      WORKFLOW_STEP_VIEW_ONLY_TEXT,
      WorkflowRunCopy.editRefused,
    ];

    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      for (const key of keys) {
        const value: string | undefined = locale[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect([file, key, value === key]).toEqual([file, key, false]);
        }
      }
    }
  });
});
