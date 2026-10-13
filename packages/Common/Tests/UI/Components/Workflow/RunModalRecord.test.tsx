/*
 * The Run Workflow panel, end to end in the component: a record trigger asks
 * for its record by number or name, the confirmation says what the run will
 * do with it, and what is sent is what the trigger reads. Other triggers keep
 * their fields, now sent as their trigger receives them for real.
 */

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
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

// The code editor does not run under jsdom; the field only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      const raw: unknown = props.value ?? props.initialValue ?? "";

      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          data-testid="code-editor"
          value={typeof raw === "string" ? raw : JSON.stringify(raw)}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import RunModal from "../../../../UI/Components/Workflow/RunModal";
import { LoadRunRecordsFunction } from "../../../../UI/Components/Workflow/RunRecordSource";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ObjectID from "../../../../Types/ObjectID";
import {
  RunRecordMatch,
  RunRecordOption,
} from "../../../../Types/Workflow/RunRecord";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const EIGHT: RunRecordOption = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "INC-8",
  name: "Database is down",
  createdAt: new Date().toISOString(),
  matchedBy: RunRecordMatch.Recent,
};

type NodeOfFunction = (metadata: ComponentMetadata) => NodeDataProp;

const nodeOf: NodeOfFunction = (metadata: ComponentMetadata): NodeDataProp => {
  return {
    id: `${metadata.id}-1`,
    internalId: `runner-${metadata.id}-1`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    arguments: {},
    returnValues: {},
  };
};

type IncidentTriggerFunction = (suffix: string) => NodeDataProp;

const incidentTrigger: IncidentTriggerFunction = (
  suffix: string,
): NodeDataProp => {
  return nodeOf(
    BaseModelComponent.getComponents(new Incident()).find(
      (component: ComponentMetadata): boolean => {
        return component.id === `incident-${suffix}`;
      },
    )!,
  );
};

type BuiltInFunction = (id: string) => NodeDataProp;

const builtIn: BuiltInFunction = (id: string): NodeDataProp => {
  return nodeOf(
    BuiltInComponents.find((component: ComponentMetadata): boolean => {
      return component.id === id;
    })!,
  );
};

interface Harness {
  onRun: jest.Mock<(trigger: NodeDataProp) => void>;
  load: jest.Mock<LoadRunRecordsFunction>;
}

type RenderPanelFunction = (
  trigger: NodeDataProp,
  options?: { withWorkflowId?: boolean },
) => Harness;

const renderPanel: RenderPanelFunction = (
  trigger: NodeDataProp,
  options?: { withWorkflowId?: boolean },
): Harness => {
  const onRun: jest.Mock<(trigger: NodeDataProp) => void> = jest.fn();
  const load: jest.Mock<LoadRunRecordsFunction> = jest.fn(
    async (): Promise<Array<RunRecordOption>> => {
      return [EIGHT];
    },
  );

  render(
    <RunModal
      trigger={trigger}
      onClose={jest.fn()}
      onRun={onRun}
      workflowId={options?.withWorkflowId === false ? undefined : WORKFLOW_ID}
      loadRunRecords={load}
    />,
  );

  return { onRun: onRun, load: load };
};

type PressRunFunction = () => void;

const pressRun: PressRunFunction = (): void => {
  fireEvent.click(
    within(screen.getByTestId("side-over-footer")).getByRole("button", {
      name: "Run Workflow Manually",
    }),
  );
};

type ConfirmDialogFunction = () => HTMLElement;

const confirmDialog: ConfirmDialogFunction = (): HTMLElement => {
  const title: HTMLElement = screen.getByText("Run this workflow now?");

  return title.closest('[role="dialog"]') as HTMLElement;
};

beforeEach(() => {
  resetPageScrollLockForTesting();
});

afterEach(() => {
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
});

describe("running an incident trigger", () => {
  test("asks for the incident, by number or name, and says what the run does with it", () => {
    renderPanel(incidentTrigger("on-create"));

    expect(screen.getByText("Incident")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The run starts as if this incident had just been created.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("run-record-field-search")).toHaveAttribute(
      "placeholder",
      "Search by number or name",
    );
    // The old ID box and its wording are gone.
    expect(screen.queryByText("Incident ID")).toBeNull();
    expect(screen.queryByPlaceholderText("ID of the Incident")).toBeNull();
  });

  test("picking INC-8 runs with its ID, after a confirmation that names it", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-create"));

    await act(async () => {
      fireEvent.focus(screen.getByTestId("run-record-field-search"));
    });

    const option: HTMLElement = await screen.findByTestId(
      "run-record-field-option",
    );

    fireEvent.click(option);
    pressRun();

    expect(
      within(confirmDialog()).getByText(
        "It runs as if INC-8 · Database is down had just been created. Every step runs for real: anything it sends, writes or deletes actually happens.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun).toHaveBeenCalledTimes(1);
    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: EIGHT.id,
    });
  });

  test("a number typed without picking is sent as typed, and the confirmation names it", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-update"));

    fireEvent.change(screen.getByTestId("run-record-field-search"), {
      target: { value: " INC-8 " },
    });

    pressRun();

    expect(
      within(confirmDialog()).getByText(
        "It runs as if INC-8 had just been updated. Every step runs for real: anything it sends, writes or deletes actually happens.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      _id: "INC-8",
    });
  });

  test("a delete trigger's confirmation says nothing is deleted", async () => {
    renderPanel(incidentTrigger("on-delete"));

    fireEvent.change(screen.getByTestId("run-record-field-search"), {
      target: { value: "INC-8" },
    });
    pressRun();

    expect(
      within(confirmDialog()).getByText(
        "It runs as if INC-8 had just been deleted, but nothing is deleted. Every step runs for real: anything it sends, writes or deletes actually happens.",
      ),
    ).toBeInTheDocument();
  });

  test("part of a title is not enough to run with: the field says to pick one", async () => {
    const harness: Harness = renderPanel(incidentTrigger("on-create"));

    const search: HTMLElement = screen.getByTestId("run-record-field-search");

    fireEvent.change(search, { target: { value: "database" } });
    fireEvent.blur(search, { relatedTarget: document.body });

    expect(
      await screen.findByText(
        "Pick one from the list, or type its number or ID.",
      ),
    ).toBeInTheDocument();

    pressRun();

    expect(screen.getByText("Please fix errors")).toBeInTheDocument();
    expect(screen.queryByText("Run this workflow now?")).toBeNull();
    expect(harness.onRun).not.toHaveBeenCalled();
  });

  test("without a workflow to look records up in, the ID is typed as before", () => {
    renderPanel(incidentTrigger("on-create"), { withWorkflowId: false });

    expect(screen.queryByTestId("run-record-field")).toBeNull();
    expect(screen.getByText("Incident ID")).toBeInTheDocument();
  });
});

describe("running any other trigger", () => {
  test("the panel says what it does in a sentence", () => {
    renderPanel(builtIn(ComponentID.Manual));

    expect(
      screen.getByText(
        "Start a run now, from the trigger, with the values you choose.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "You can run this workflow manually. This can be helpful to test the workflow.",
      ),
    ).toBeNull();
  });

  test("the Manual trigger's JSON is sent as JSON", () => {
    const harness: Harness = renderPanel(builtIn(ComponentID.Manual));

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: '{"name": "Ada"}' },
    });
    pressRun();

    expect(
      within(confirmDialog()).getByText(
        "Every step runs for real: anything it sends, writes or deletes actually happens.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(confirmDialog()).getByTestId("modal-footer-submit-button"),
    );

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      value: { name: "Ada" },
    });
    expect(harness.load).not.toHaveBeenCalled();
  });

  test("a trigger that needs no values says so, naming the button to press", () => {
    renderPanel(builtIn(ComponentID.Schedule));

    const sentence: HTMLElement = screen.getByTestId("run-form-no-values");

    expect(sentence).toHaveTextContent(
      "This trigger needs no values. Click Run Workflow Manually to start the run.",
    );

    expect(within(sentence).getByText("Run Workflow Manually").tagName).toBe(
      "STRONG",
    );
  });
});
