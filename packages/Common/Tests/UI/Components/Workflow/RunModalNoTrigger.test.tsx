import { ComponentProps as CodeEditorProps } from "../../../../UI/Components/CodeEditor/CodeEditor";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

// Monaco does not run under jsdom; the field only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import RunModal, {
  ComponentProps as RunModalProps,
  RunModalCopy,
} from "../../../../UI/Components/Workflow/RunModal";
import { RUN_WORKFLOW_SUBMIT_TITLE } from "../../../../UI/Components/Workflow/RunForm";
import { WORKFLOW_ADD_TRIGGER_TITLE } from "../../../../UI/Components/Workflow/WorkflowAddButton";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Run Workflow on a workflow with no trigger yet. A run starts from the
 * trigger, so there is nothing to run: the panel used to show a red "No
 * trigger added. Please add a trigger in order to run this workflow" over a
 * Run button that could not be pressed. It now says so plainly and offers
 * the one thing to do - Add Trigger, which opens the panel the toolbar's
 * button and the dashed card open - and has no Run button at all. Someone
 * who may not change the workflow is told who adds the trigger instead.
 */

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

// A trigger as the canvas holds it, from the real catalog.
const manualTrigger: () => NodeDataProp = (): NodeDataProp => {
  const metadata: ComponentMetadata = BuiltInComponents.find(
    (component: ComponentMetadata): boolean => {
      return component.id === ComponentID.Manual;
    },
  )!;

  return {
    id: "manual-1",
    internalId: "runner-manual-1",
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    arguments: {},
    returnValues: {},
  };
};

/*
 * The dashed card's data, as Workflow's getPlaceholderTriggerNode makes it:
 * what the canvas hands the panel while the workflow has no trigger.
 */
const noTrigger: () => NodeDataProp = (): NodeDataProp => {
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
  } as NodeDataProp;
};

type RenderPanelFunction = (props: Partial<RunModalProps>) => void;

const renderPanel: RenderPanelFunction = (
  props: Partial<RunModalProps>,
): void => {
  render(
    <RunModal
      trigger={noTrigger()}
      onClose={getJestMockFunction()}
      onRun={getJestMockFunction()}
      {...props}
    />,
  );
};

// The panel's footer buttons, by their words.
const footerButtons: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen.getByTestId("side-over-footer").querySelectorAll("button"),
  ).map((button: HTMLButtonElement): string => {
    return (button.textContent || "").trim();
  });
};

beforeEach(() => {
  resetPageScrollLockForTesting();
});

afterEach(() => {
  cleanup();
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("Run Workflow on a workflow with no trigger", () => {
  test("says the workflow has no trigger yet, and why that matters, in place of the run form", () => {
    renderPanel({ onAddTrigger: getJestMockFunction() });

    expect(screen.getByTestId("run-workflow-no-trigger")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: RunModalCopy.noTriggerTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(RunModalCopy.noTriggerDescription),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("offers Add Trigger, the toolbar's own words, which opens the trigger panel", () => {
    const onAddTrigger: MockFunction = getJestMockFunction();

    renderPanel({ onAddTrigger: onAddTrigger });

    const button: HTMLElement = screen.getByTestId("run-workflow-add-trigger");

    expect(button).toHaveTextContent(WORKFLOW_ADD_TRIGGER_TITLE);
    expect(WORKFLOW_ADD_TRIGGER_TITLE).toBe("Add Trigger");

    fireEvent.click(button);

    expect(onAddTrigger).toHaveBeenCalledTimes(1);
  });

  test("Add Trigger is the panel's one primary button: there is no Run Workflow to press", () => {
    renderPanel({ onAddTrigger: getJestMockFunction() });

    expect(
      screen.queryByRole("button", { name: RUN_WORKFLOW_SUBMIT_TITLE }),
    ).not.toBeInTheDocument();
    // The panel still closes, by its footer and its header.
    expect(footerButtons()).toEqual(["Close"]);
  });

  test("no red error, and none of the old words", () => {
    renderPanel({ onAddTrigger: getJestMockFunction() });

    expect(
      screen.queryByText(
        "No trigger added. Please add a trigger in order to run this workflow",
      ),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".text-red-500, .text-red-600")).toBeNull();
  });

  test("an off workflow's test-run note waits for a trigger: without one there is no run to be a test", () => {
    renderPanel({ onAddTrigger: getJestMockFunction(), isTestRun: true });

    expect(
      screen.queryByTestId("workflow-run-panel-test-run-note"),
    ).not.toBeInTheDocument();
  });

  test("someone who may not change the workflow is told who adds the trigger, and offered nothing", () => {
    renderPanel({});

    expect(
      screen.getByText(RunModalCopy.noTriggerViewOnlyDescription),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("run-workflow-add-trigger"),
    ).not.toBeInTheDocument();
    expect(footerButtons()).toEqual(["Close"]);
  });
});

describe("Run Workflow on a workflow with a trigger", () => {
  test("shows the run form and the Run Workflow button, never the no-trigger words", () => {
    renderPanel({
      trigger: manualTrigger(),
      onAddTrigger: getJestMockFunction(),
    });

    expect(
      screen.queryByTestId("run-workflow-no-trigger"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("run-workflow-add-trigger"),
    ).not.toBeInTheDocument();
    expect(footerButtons()).toEqual(["Close", RUN_WORKFLOW_SUBMIT_TITLE]);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  test("an off workflow's run says it is a test run, as before", () => {
    renderPanel({ trigger: manualTrigger(), isTestRun: true });

    expect(
      screen.getByTestId("workflow-run-panel-test-run-note"),
    ).toBeInTheDocument();
  });
});

describe("the words", () => {
  test("say what the panel is for, in plain sentences", () => {
    expect(RunModalCopy.noTriggerTitle).toBe(
      "This workflow has no trigger yet",
    );
    expect(RunModalCopy.noTriggerDescription).toBe(
      "A run starts from the workflow's trigger. Add one, then run the workflow from here.",
    );
    expect(RunModalCopy.noTriggerViewOnlyDescription).toBe(
      "A run starts from the workflow's trigger. Someone who may edit this workflow adds it.",
    );
  });

  test("every Dashboard language has them, translated, and no file keeps the old message translated alone", () => {
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

      for (const key of [
        RunModalCopy.noTriggerTitle,
        RunModalCopy.noTriggerDescription,
        RunModalCopy.noTriggerViewOnlyDescription,
      ]) {
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
