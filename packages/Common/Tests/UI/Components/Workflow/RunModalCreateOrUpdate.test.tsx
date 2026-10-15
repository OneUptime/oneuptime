/*
 * Run Workflow on an On Create or Update trigger: the record, as every record
 * trigger asks for it, and What Happened - whether the run is for the record
 * being created or updated. What the panel says follows the answer: the
 * record's line, the confirmation, and what is sent.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { Mock } from "jest-mock";

import RunModal from "../../../../UI/Components/Workflow/RunModal";
import {
  RUN_WHAT_HAPPENED_TEST_ID,
  RunFormCopy,
} from "../../../../UI/Components/Workflow/RunForm";
import { LoadRunRecordsFunction } from "../../../../UI/Components/Workflow/RunRecordSource";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import {
  WHAT_HAPPENED_ID,
  WHAT_HAPPENED_NAME,
} from "../../../../Types/Workflow/CreateOrUpdateTrigger";
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

type IncidentTriggerFunction = (suffix: string) => NodeDataProp;

const incidentTrigger: IncidentTriggerFunction = (
  suffix: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = BaseModelComponent.getComponents(
    new Incident(),
  ).find((component: ComponentMetadata): boolean => {
    return component.id === `incident-${suffix}`;
  })!;

  return {
    id: `${metadata.id}-1`,
    internalId: `runner-${metadata.id}-1`,
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata: { ...metadata },
    error: "",
    // The trigger's own settings travel with the run, as on the canvas.
    arguments: { select: { title: true } },
    returnValues: {},
  };
};

interface Harness {
  onRun: Mock<(trigger: NodeDataProp) => void>;
}

const renderPanel: (trigger: NodeDataProp) => Harness = (
  trigger: NodeDataProp,
): Harness => {
  const onRun: Mock<(trigger: NodeDataProp) => void> = jest.fn();
  const load: Mock<LoadRunRecordsFunction> = jest.fn(
    async (): Promise<Array<RunRecordOption>> => {
      return [EIGHT];
    },
  );

  render(
    <RunModal
      trigger={trigger}
      onClose={jest.fn()}
      onRun={onRun}
      workflowId={WORKFLOW_ID}
      loadRunRecords={load}
    />,
  );

  return { onRun: onRun };
};

const pressRun: () => void = (): void => {
  fireEvent.click(
    within(screen.getByTestId("side-over-footer")).getByRole("button", {
      name: "Run Workflow Manually",
    }),
  );
};

const confirmWords: () => HTMLElement = (): HTMLElement => {
  const title: HTMLElement = screen.getByText("Run this workflow now?");

  return within(title.closest('[role="dialog"]') as HTMLElement).getByTestId(
    "confirm-modal-description",
  );
};

const confirm: () => void = (): void => {
  const title: HTMLElement = screen.getByText("Run this workflow now?");

  fireEvent.click(
    within(title.closest('[role="dialog"]') as HTMLElement).getByTestId(
      "modal-footer-submit-button",
    ),
  );
};

const pickEight: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.focus(screen.getByTestId("run-record-field-search"));
  });

  fireEvent.click(await screen.findByTestId("run-record-field-option"));
};

const answer: (value: "created" | "updated") => HTMLElement = (
  value: "created" | "updated",
): HTMLElement => {
  return screen.getByTestId(`${RUN_WHAT_HAPPENED_TEST_ID}-${value}`);
};

beforeEach(() => {
  resetPageScrollLockForTesting();
});

afterEach(() => {
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
});

describe("Run Workflow on On Create or Update", () => {
  test("asks for the incident, then What Happened, created chosen until another is", () => {
    renderPanel(incidentTrigger("on-create-or-update"));

    expect(screen.getByText("Incident")).toBeInTheDocument();
    expect(screen.getByTestId("run-record-field-search")).toBeInTheDocument();

    expect(screen.getByText(WHAT_HAPPENED_NAME)).toBeInTheDocument();
    const group: HTMLElement = within(
      screen.getByTestId(RUN_WHAT_HAPPENED_TEST_ID),
    ).getByRole("radiogroup", { name: WHAT_HAPPENED_NAME });

    const radios: Array<HTMLElement> = within(group).getAllByRole("radio");

    expect(radios).toHaveLength(2);
    expect(answer("created")).toBeChecked();
    expect(answer("updated")).not.toBeChecked();
    expect(within(group).getByText("Just created")).toBeInTheDocument();
    expect(within(group).getByText("Just updated")).toBeInTheDocument();
    // A choice is always made: neither "(Optional)" nor a required mark.
    expect(screen.queryByText("(Optional)")).toBeNull();
  });

  test("the incident's line says what the run is for, and follows the answer", () => {
    renderPanel(incidentTrigger("on-create-or-update"));

    expect(
      screen.getByText(
        "The run starts as if this incident had just been created.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(answer("updated"));

    expect(answer("updated")).toBeChecked();
    expect(answer("created")).not.toBeChecked();
    expect(
      screen.getByText(
        "The run starts as if this incident had just been updated.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "The run starts as if this incident had just been created.",
      ),
    ).toBeNull();
  });

  test("run as created: the confirmation says so, and the run is sent as created", async () => {
    const harness: Harness = renderPanel(
      incidentTrigger("on-create-or-update"),
    );

    await pickEight();
    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 · Database is down had just been created\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );

    confirm();

    expect(harness.onRun).toHaveBeenCalledTimes(1);
    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      select: { title: true },
      _id: EIGHT.id,
      [WHAT_HAPPENED_ID]: "created",
    });
  });

  test("run as updated: the confirmation says updated, and the run is sent as updated", async () => {
    const harness: Harness = renderPanel(
      incidentTrigger("on-create-or-update"),
    );

    await pickEight();
    fireEvent.click(answer("updated"));
    pressRun();

    expect(confirmWords()).toHaveTextContent(
      /^It runs as if INC-8 · Database is down had just been updated\. Every step runs for real: anything it sends, writes or deletes actually happens\.$/,
    );

    confirm();

    expect(harness.onRun.mock.calls[0]![0].arguments).toEqual({
      select: { title: true },
      _id: EIGHT.id,
      [WHAT_HAPPENED_ID]: "updated",
    });
  });

  test("changing the answer back runs it as created again", async () => {
    const harness: Harness = renderPanel(
      incidentTrigger("on-create-or-update"),
    );

    await pickEight();
    fireEvent.click(answer("updated"));
    fireEvent.click(answer("created"));
    pressRun();

    expect(confirmWords()).toHaveTextContent(/had just been created\./);

    confirm();

    expect(harness.onRun.mock.calls[0]![0].arguments[WHAT_HAPPENED_ID]).toBe(
      "created",
    );
  });

  test("the answers are keys of their own, and the question is the run value's name", () => {
    expect(RunFormCopy.whatHappened).toBe(WHAT_HAPPENED_NAME);
    expect(RunFormCopy.created).toBe("Just created");
    expect(RunFormCopy.updated).toBe("Just updated");

    // The step's own choices are worded as the panel words them.
    const whatHappened: Argument = (
      incidentTrigger("on-create-or-update").metadata
        .runWorkflowManuallyArguments || []
    ).find((argument: Argument): boolean => {
      return argument.id === WHAT_HAPPENED_ID;
    })!;

    expect(
      (whatHappened.choices || []).map((choice: { label: string }): string => {
        return choice.label;
      }),
    ).toEqual([RunFormCopy.created, RunFormCopy.updated]);
  });

  test("the other record triggers ask no such question", () => {
    for (const suffix of ["on-create", "on-update", "on-delete"]) {
      const { unmount } = render(
        <RunModal
          trigger={incidentTrigger(suffix)}
          onClose={jest.fn()}
          onRun={jest.fn()}
          workflowId={WORKFLOW_ID}
          loadRunRecords={jest.fn(async () => {
            return [EIGHT];
          })}
        />,
      );

      expect(screen.queryByTestId(RUN_WHAT_HAPPENED_TEST_ID)).toBeNull();
      expect(screen.queryByText(WHAT_HAPPENED_NAME)).toBeNull();

      unmount();
    }
  });
});
