/*
 * Create One Incident's settings, as the person building the workflow sees
 * them: an Incident Template picked from the project's templates, and a
 * JSON Object that is required until one is picked - then it only holds
 * what should differ from the template.
 *
 * The form, its fields and the step's own state are the real thing; only
 * the API is stood in for. The step's JSON Object is drawn here as the JSON
 * editor rather than the row editor, which reads the model's schema from
 * the server and has suites of its own (ModelColumnEditor).
 */

// Utils.ts imports the database-model registry, which nothing here reads.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

/*
 * The project's incident templates, as the API lists them to the person
 * editing the workflow. Every other list (the picker's variables) is empty.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async (args: { modelType: new () => unknown }) => {
        const tableName: string | undefined = (
          new args.modelType() as { tableName?: string }
        ).tableName;

        const data: Array<Record<string, unknown>> =
          tableName === "IncidentTemplate"
            ? [
                {
                  _id: "7c000000-0000-4000-8000-0000000000a1",
                  templateName: "Checkout degraded",
                },
                {
                  _id: "7c000000-0000-4000-8000-0000000000a2",
                  templateName: "Database failover",
                },
              ]
            : [];

        return { data: data, count: data.length, skip: 0, limit: 10 };
      }),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../Types/Workflow/Components/BaseModel";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../Types/Workflow/CreateFromTemplate";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const CHECKOUT_TEMPLATE_ID: string = "7c000000-0000-4000-8000-0000000000a1";

const CREATE_ONE_INCIDENT: ComponentMetadata = {
  ...BaseModelComponents.getComponents(new Incident()).find(
    (component: ComponentMetadata): boolean => {
      return component.id === "incident-create-one";
    },
  )!,
};

// The JSON editor for JSON Object, not the row editor (see the top).
delete CREATE_ONE_INCIDENT.tableName;

interface RenderedStep {
  onFormChange: MockFunction;
  onErrors: MockFunction;
}

function renderStep(args: JSONObject = {}): RenderedStep {
  const onFormChange: MockFunction = getJestMockFunction();
  const onErrors: MockFunction = getJestMockFunction();

  const node: NodeDataProp = {
    error: "",
    id: "incident-create-one-1",
    nodeType: NodeType.Node,
    metadata: CREATE_ONE_INCIDENT,
    metadataId: CREATE_ONE_INCIDENT.id,
    internalId: "incident-create-one-1-internal",
    arguments: args,
    returnValues: {},
    componentType: CREATE_ONE_INCIDENT.componentType,
  };

  render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={[node]}
      valueSources={{
        upstream: [],
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      onHasFormValidationErrors={(errors: Dictionary<boolean>): void => {
        onErrors(errors);
      }}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  return { onFormChange, onErrors };
}

async function templatePicker(): Promise<HTMLElement> {
  return await waitFor(() => {
    return screen.getByRole("combobox", { name: /^Incident Template/ });
  });
}

function lastArguments(onFormChange: MockFunction): JSONObject {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;
  return (calls[calls.length - 1]![0] as NodeDataProp).arguments;
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("Create One Incident's Incident Template", () => {
  test("offers the project's incident templates by name, listed through the API", async () => {
    renderStep();

    const picker: HTMLElement = await templatePicker();

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

    expect(await screen.findByText("Checkout degraded")).toBeInTheDocument();
    expect(screen.getByText("Database failover")).toBeInTheDocument();

    const listed: Array<string> = (
      ModelAPI.getList as unknown as jest.Mock<
        (args: { modelType: new () => { tableName?: string } }) => unknown
      >
    ).mock.calls.map((call: Array<unknown>): string => {
      return (
        new (
          call[0] as { modelType: new () => { tableName?: string } }
        ).modelType().tableName || ""
      );
    });

    expect(listed).toContain("IncidentTemplate");
  });

  test("a picked template is stored as its ID", async () => {
    const { onFormChange } = renderStep();

    const picker: HTMLElement = await templatePicker();

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("Checkout degraded"));

    await waitFor(() => {
      expect(lastArguments(onFormChange)[INCIDENT_TEMPLATE_ARGUMENT_ID]).toBe(
        CHECKOUT_TEMPLATE_ID,
      );
    });
  });

  test("a step that has one shows it by name", async () => {
    renderStep({ [INCIDENT_TEMPLATE_ARGUMENT_ID]: CHECKOUT_TEMPLATE_ID });

    await templatePicker();

    expect(await screen.findByText("Checkout degraded")).toBeInTheDocument();
  });
});

describe("JSON Object is required until a template is picked", () => {
  test("without a template it says it is required", async () => {
    renderStep();

    await templatePicker();

    expect(
      screen.getByText(/^Required\. Incident represented as JSON\./),
    ).toBeInTheDocument();
  });

  test("with a template it is optional, and an empty one is no error", async () => {
    const { onErrors } = renderStep({
      [INCIDENT_TEMPLATE_ARGUMENT_ID]: CHECKOUT_TEMPLATE_ID,
    });

    await templatePicker();

    expect(
      screen.getByText(/^Optional\. Incident represented as JSON\./),
    ).toBeInTheDocument();

    /*
     * The form reports "no error" before it has validated what it holds,
     * so let every validation it runs as it opens report first.
     */
    await waitFor(() => {
      expect(onErrors).toHaveBeenCalledWith({ arguments: false });
    });
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 300);
      });
    });

    expect(onErrors).not.toHaveBeenCalledWith({ arguments: true });
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });
  });

  test("an empty one with no template is an error", async () => {
    const { onErrors } = renderStep();

    await templatePicker();

    await waitFor(() => {
      expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    });
  });
});
