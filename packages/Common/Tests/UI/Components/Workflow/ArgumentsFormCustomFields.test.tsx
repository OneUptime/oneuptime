/*
 * Issue #5942, in a step's own settings: From Another Tool's Custom Fields and
 * Outside ID Field. The real components' arguments and the real form; only the
 * project's custom fields are stood in for.
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
  "../../../../UI/Components/Workflow/CustomFields/UseCustomFields",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

jest.mock("../../../../UI/Components/Workflow/ModelSchema", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Components/Workflow/ModelSchema",
  ) as Record<string, unknown>;

  return { ...actual, useModelSchema: jest.fn() };
});

import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components/FromAnotherTool";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import useCustomFields from "../../../../UI/Components/Workflow/CustomFields/UseCustomFields";
import { useModelSchema } from "../../../../UI/Components/Workflow/ModelSchema";
import { WorkflowViewOnlyContext } from "../../../../UI/Components/Workflow/WorkflowViewOnly";
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

const INCIDENT_FROM_TOOL: ComponentMetadata = (
  Components as Array<ComponentMetadata>
).find((component: ComponentMetadata): boolean => {
  return component.id === ComponentID.IncidentFromAnotherTool;
}) as ComponentMetadata;

type StepFunction = (values: JSONObject) => NodeDataProp;

const step: StepFunction = (values: JSONObject): NodeDataProp => {
  return {
    id: "incident-from-another-tool-1",
    nodeType: NodeType.Node,
    metadata: INCIDENT_FROM_TOOL,
    metadataId: INCIDENT_FROM_TOOL.id,
    internalId: "",
    error: "",
    arguments: values,
    returnValues: {},
  } as unknown as NodeDataProp;
};

type DrawFunction = (
  values: JSONObject,
  onFormChange?: MockFunction,
  isViewOnly?: boolean,
) => ReactElement;

const draw: DrawFunction = (
  values: JSONObject,
  onFormChange: MockFunction = getJestMockFunction(),
  isViewOnly: boolean = false,
): ReactElement => {
  const node: NodeDataProp = step(values);

  return (
    <WorkflowViewOnlyContext.Provider value={isViewOnly}>
      <ArgumentsForm
        component={node}
        workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
        graphComponents={[node]}
        valueSuggestionSources={[]}
        onHasFormValidationErrors={getJestMockFunction()}
        onFormChange={onFormChange}
      />
    </WorkflowViewOnlyContext.Provider>
  );
};

type OpenMoreFieldsFunction = () => Promise<void>;

const openMoreFields: OpenMoreFieldsFunction = async (): Promise<void> => {
  const more: HTMLElement | null = screen.queryByRole("button", {
    name: "More fields",
  });

  if (more && more.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(more);
    });
  }
};

beforeEach(() => {
  (useModelSchema as jest.Mock).mockReturnValue({
    columns: [
      {
        id: "customFields",
        title: "Custom Fields",
        type: TableColumnType.JSON,
        isRelation: false,
        canCreate: true,
        canUpdate: true,
      },
    ],
    isLoading: false,
    error: null,
  });
  (useCustomFields as jest.Mock).mockReturnValue({
    fields: [
      {
        name: "Case Number",
        customFieldType: CustomFieldType.Text,
        options: [],
      },
      { name: "Count", customFieldType: CustomFieldType.Number, options: [] },
    ],
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the arguments that name a kind of record's custom fields", () => {
  test("both kinds of step say whose fields they hold", () => {
    for (const component of Components as Array<ComponentMetadata>) {
      const args: Array<Argument> = component.arguments.filter(
        (arg: Argument): boolean => {
          return Boolean(arg.customFieldsOf || arg.customFieldNameOf);
        },
      );

      for (const arg of args) {
        const table: string = (arg.customFieldsOf ||
          arg.customFieldNameOf) as string;

        expect(["Incident", "Alert"]).toContain(table);
      }
    }
  });

  test("Custom Fields no longer asks for JSON by name", () => {
    const customFields: Argument | undefined =
      INCIDENT_FROM_TOOL.arguments.find((arg: Argument): boolean => {
        return Boolean(arg.customFieldsOf);
      });

    expect(customFields?.description).not.toContain("JSON");
  });
});

describe("Custom Fields", () => {
  test("a stored setting is a row for each field, by name", async () => {
    render(draw({ "custom-fields": '{"Count":2}' }));

    await openMoreFields();

    await waitFor(() => {
      expect(
        screen.getByTestId("model-column-value-customFields.Count"),
      ).toHaveValue(2);
    });
  });

  test("a change is stored as the setting always stored it", async () => {
    const onFormChange: MockFunction = getJestMockFunction();

    render(draw({ "custom-fields": '{"Count":2}' }, onFormChange));

    await openMoreFields();

    const box: HTMLElement = await screen.findByTestId(
      "model-column-value-customFields.Count",
    );

    await act(async () => {
      fireEvent.change(box, { target: { value: "5" } });
    });

    await waitFor(() => {
      const calls: Array<Array<NodeDataProp>> = (
        onFormChange as unknown as jest.Mock
      ).mock.calls as Array<Array<NodeDataProp>>;

      expect(calls[calls.length - 1]?.[0]?.arguments?.["custom-fields"]).toBe(
        '{"Count":5}',
      );
    });
  });

  test("in a view it reads, and changes nothing", async () => {
    const onFormChange: MockFunction = getJestMockFunction();

    render(draw({ "custom-fields": '{"Count":2}' }, onFormChange, true));

    await openMoreFields();

    const box: HTMLElement = await screen.findByTestId(
      "model-column-value-customFields.Count",
    );

    expect(box).toBeDisabled();
    expect(screen.queryByTestId("model-column-add")).toBeNull();
  });
});

describe("Outside ID Field", () => {
  test("is a list of the project's custom fields, under its own name", async () => {
    render(draw({}));

    await openMoreFields();

    await waitFor(() => {
      expect(screen.getByText(/^Outside ID Field/)).toBeInTheDocument();
    });

    expect(useCustomFields).toHaveBeenCalledWith("Incident");
  });

  test("shows what a step already keeps there, a field or not", async () => {
    render(draw({ "outside-id-field": "externalId" }));

    await openMoreFields();

    expect(await screen.findByText("externalId")).toBeInTheDocument();
  });
});
