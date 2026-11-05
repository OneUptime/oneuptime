/*
 * Issue #5943, in a step's own settings: a setting that names the project's
 * records is drawn as the list of them, whichever step it is on, and a stored
 * value keeps working. The form and the step's state are the real thing; only
 * the records the API lists are stood in for.
 */

jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: () => {
      return null;
    },
  };
});

jest.mock(
  "../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource",
  () => {
    return {
      __esModule: true,
      LINKED_RECORD_LIST_LIMIT: 100,
      loadLinkedRecords: jest.fn(),
      loadLinkedRecordsById: jest.fn(),
    };
  },
);

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
      getCommonHeaders: jest.fn(() => {
        return {};
      }),
    },
  };
});

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import {
  loadLinkedRecords,
  loadLinkedRecordsById,
} from "../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordSource";
import { LinkedRecordCopy } from "../../../../UI/Components/Workflow/LinkedRecord/LinkedRecordInput";
import { WorkflowViewOnlyContext } from "../../../../UI/Components/Workflow/WorkflowViewOnly";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const INCIDENT_ID: string = "7c000000-0000-4000-8000-0000000000a1";
const OTHER_INCIDENT_ID: string = "7c000000-0000-4000-8000-0000000000a2";
const LABEL_ID: string = "7c000000-0000-4000-8000-0000000000b1";

const INCIDENT_ARGUMENT: Argument = {
  id: "incident-id",
  name: "Incident ID",
  description: "The incident to page about.",
  type: ComponentInputType.Text,
  required: false,
  linkedTable: "Incident",
};

const LABELS_ARGUMENT: Argument = {
  id: "labels",
  name: "Labels",
  description: "Labels of the new incident.",
  type: ComponentInputType.Text,
  required: false,
  linkedTable: "Label",
  isLinkedList: true,
};

const PLAIN_ARGUMENT: Argument = {
  id: "title",
  name: "Title",
  description: "The title.",
  type: ComponentInputType.Text,
  required: false,
};

const STEP: ComponentMetadata = {
  id: "page-step",
  title: "Page",
  category: "On-Call",
  description: "",
  iconProp: "Call",
  componentType: ComponentType.Component,
  arguments: [INCIDENT_ARGUMENT, LABELS_ARGUMENT, PLAIN_ARGUMENT],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "" }],
  outPorts: [{ id: "out", title: "Out", description: "" }],
} as unknown as ComponentMetadata;

type FormFunction = (
  args: JSONObject,
  onFormChange: MockFunction,
) => ReactElement;

const form: FormFunction = (
  args: JSONObject,
  onFormChange: MockFunction,
): ReactElement => {
  const node: NodeDataProp = {
    error: "",
    id: "page-step-1",
    nodeType: NodeType.Node,
    metadata: STEP,
    metadataId: STEP.id,
    internalId: "page-step-1-internal",
    arguments: args,
    returnValues: {},
    componentType: ComponentType.Component,
  };

  return (
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={[node]}
      valueSuggestionSources={[]}
      onHasFormValidationErrors={getJestMockFunction()}
      onFormChange={onFormChange}
    />
  );
};

beforeEach(() => {
  (loadLinkedRecords as jest.Mock<any>).mockImplementation(
    async (data: { tableName: string }) => {
      return {
        options:
          data.tableName === "Incident"
            ? [
                {
                  value: INCIDENT_ID,
                  label: "INC-1 · Database is down",
                  isUserContent: true,
                },
                {
                  value: OTHER_INCIDENT_ID,
                  label: "INC-2 · Checkout is slow",
                  isUserContent: true,
                },
              ]
            : [{ value: LABEL_ID, label: "production", isUserContent: true }],
        isComplete: true,
      };
    },
  );
  (loadLinkedRecordsById as jest.Mock<any>).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

type LastArgumentsFunction = (onFormChange: MockFunction) => JSONObject;

const lastArguments: LastArgumentsFunction = (
  onFormChange: MockFunction,
): JSONObject => {
  const calls: Array<Array<unknown>> = (onFormChange as unknown as jest.Mock)
    .mock.calls as Array<Array<unknown>>;

  return (calls[calls.length - 1]?.[0] as NodeDataProp).arguments;
};

describe("a setting that names one record", () => {
  test("lists the records of its table, and a pick stores the ID as text", async () => {
    const onFormChange: MockFunction = getJestMockFunction();

    render(form({}, onFormChange));

    const field: HTMLElement = await screen.findByTestId(
      "workflow-argument-incident-id",
    );

    expect(field).toHaveAttribute("data-table", "Incident");

    const box: HTMLElement = field.querySelector("input") as HTMLElement;

    await act(async () => {
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText("INC-2 · Checkout is slow"));
    });

    await waitFor(() => {
      expect(lastArguments(onFormChange)["incident-id"]).toBe(
        OTHER_INCIDENT_ID,
      );
    });
  });

  test("shows a stored ID by the record's name", async () => {
    render(form({ "incident-id": INCIDENT_ID }, getJestMockFunction()));

    expect(
      await screen.findByText("INC-1 · Database is down"),
    ).toBeInTheDocument();
  });

  test("shows a value from an earlier step as it was, with the way back", async () => {
    render(
      form(
        { "incident-id": "{{local.components.a-1.returnValues.model._id}}" },
        getJestMockFunction(),
      ),
    );

    expect(
      await screen.findByTestId("workflow-argument-incident-id-pick-from-list"),
    ).toBeInTheDocument();
  });
});

describe("a setting that names several records", () => {
  test("is stored as text separated by commas, as the step reads it", async () => {
    const onFormChange: MockFunction = getJestMockFunction();

    render(form({}, onFormChange));

    const field: HTMLElement = await screen.findByTestId(
      "workflow-argument-labels",
    );

    expect(field).toHaveAttribute("data-table", "Label");

    const box: HTMLElement = field.querySelector("input") as HTMLElement;

    await act(async () => {
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText("production"));
    });

    await waitFor(() => {
      expect(lastArguments(onFormChange)["labels"]).toBe(LABEL_ID);
    });
  });
});

describe("a setting that names no record", () => {
  test("lists nothing and keeps its box", async () => {
    render(form({}, getJestMockFunction()));

    expect(
      await screen.findByTestId("workflow-argument-title"),
    ).not.toHaveAttribute("data-table");
    expect(loadLinkedRecords).not.toHaveBeenCalledWith({ tableName: "title" });
  });
});

describe("a step opened to be read", () => {
  test("shows what the settings hold by name, with no way to change them", async () => {
    render(
      <WorkflowViewOnlyContext.Provider value={true}>
        {form(
          { "incident-id": INCIDENT_ID, labels: LABEL_ID },
          getJestMockFunction(),
        )}
      </WorkflowViewOnlyContext.Provider>,
    );

    expect(
      await screen.findByText("INC-1 · Database is down"),
    ).toBeInTheDocument();
    expect(await screen.findByText("production")).toBeInTheDocument();
    expect(screen.queryByText(LinkedRecordCopy.placeholder)).toBeNull();
    expect(screen.queryByLabelText("Remove production")).toBeNull();
  });
});
