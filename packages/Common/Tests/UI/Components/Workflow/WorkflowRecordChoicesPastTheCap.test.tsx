/*
 * Utils.ts imports the whole database-model registry for
 * loadComponentsAndCategories, which nothing here calls.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../../App/Dashboard/CappedListServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import Includes from "../../../../Types/BaseDatabase/Includes";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponents from "../../../../Types/Workflow/Components/BaseModel";
import { INCIDENT_TEMPLATE_ARGUMENT_ID } from "../../../../Types/Workflow/CreateFromTemplate";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { refuseRequestsTo } from "../../../Helpers/RealNetworkRequests";
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A WORKFLOW STEP'S WORKFLOW AND INCIDENT TEMPLATE, PAST THE PROJECT'S FIRST
 * 10,000 (#10764).
 *
 * Execute Workflow's Workflow and Create One Incident's Incident Template
 * read the project's first 10,000 workflows (templates) by name as the
 * settings opened and filtered them in the browser: one past them could not
 * be picked, and one a step held showed blank. They search the server as
 * they are typed in - the workflow being edited never offered - and read
 * what a step holds by its ID; one deleted since reads "No longer
 * available". On a fake project of 10,050 of each and some past them
 * (CappedListServer), as the list route answers.
 */

// The step's Create One Incident's JSON is drawn from the model's columns.
refuseRequestsTo(["/model-schema/*"]);

const CURRENT_WORKFLOW_ID: string = "7d000000-0000-4000-8000-000000000001";
const LATE_WORKFLOW_ID: string = "7d000000-0000-4000-8000-000000000002";
const DELETED_WORKFLOW_ID: string = "7d000000-0000-4000-8000-000000000003";
const LATE_TEMPLATE_ID: string = "7d000000-0000-4000-8000-000000000004";

const RECORDS_BEFORE_THEM: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

beforeAll(() => {
  server = new CappedListServer();

  server.add(
    Workflow,
    namesSortingFirst(RECORDS_BEFORE_THEM, "AP").map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Workflow, [
    { _id: LATE_WORKFLOW_ID, name: "Warehouse restock" },
    // The one being edited, which a search for "warehouse" would find.
    { _id: CURRENT_WORKFLOW_ID, name: "Warehouse alerts" },
  ]);

  server.add(
    IncidentTemplate,
    namesSortingFirst(RECORDS_BEFORE_THEM, "AP").map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), templateName: name };
      },
    ),
  );
  server.add(IncidentTemplate, [
    { _id: LATE_TEMPLATE_ID, templateName: "Warehouse fire" },
  ]);
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const metadataOf: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  return [
    ...Components,
    ...BaseModelComponents.getComponents(new Incident()),
  ].find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
};

const step: (id: string, args: JSONObject) => NodeDataProp = (
  id: string,
  args: JSONObject,
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: `${id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-1-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

let onFormChange: MockFunction;

function renderStep(node: NodeDataProp): void {
  onFormChange = getJestMockFunction();

  render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID(CURRENT_WORKFLOW_ID)}
      graphComponents={[node]}
      onHasFormValidationErrors={() => {}}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );
}

function lastArguments(): JSONObject {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;

  return ((calls[calls.length - 1]![0] as NodeDataProp).arguments ||
    {}) as JSONObject;
}

async function typeInto(testId: string, text: string): Promise<void> {
  const input: HTMLElement = await screen.findByTestId(testId);

  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });
}

function readsOf(modelType: { new (): Workflow | IncidentTemplate }): Array<
  Record<string, unknown>
> {
  return server
    .callsFor(modelType)
    .map((call: CappedListCall): Record<string, unknown> => {
      return call.query;
    });
}

describe("Execute Workflow's Workflow", () => {
  test("REGRESSION: a workflow the step holds past the first 10,000 is named - read by its ID - never blank", async () => {
    renderStep(step(ComponentID.WorkflowRun, { workflowId: LATE_WORKFLOW_ID }));

    expect(
      await screen.findByText("Warehouse restock", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(LATE_WORKFLOW_ID);

    // Read by its ID, whichever it sorts after.
    expect(
      readsOf(Workflow).some((query: Record<string, unknown>): boolean => {
        return (
          query["_id"] instanceof Includes &&
          (query["_id"] as Includes).values
            .map(String)
            .includes(LATE_WORKFLOW_ID)
        );
      }),
    ).toBe(true);
    // Nothing read 10,000 up front.
    for (const call of server.callsFor(Workflow)) {
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }
  });

  test("REGRESSION: one past them is found on the server by what is typed, picked, and saved by its ID - the workflow being edited never offered", async () => {
    renderStep(step(ComponentID.WorkflowRun, {}));

    await typeInto("workflow-argument-workflowId", "warehouse");

    expect(
      await screen.findByRole("option", { name: /Warehouse restock/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Warehouse alerts/ }),
    ).toBeNull();

    // Searched by name, every list leaving the workflow being edited out.
    const searches: Array<Record<string, unknown>> = readsOf(Workflow).filter(
      (query: Record<string, unknown>): boolean => {
        return query["name"] instanceof Search;
      },
    );

    expect(searches.length).toBeGreaterThan(0);

    for (const query of readsOf(Workflow)) {
      if (query["_id"] instanceof Includes) {
        continue;
      }

      expect(query["_id"]).toEqual(new NotEqual<string>(CURRENT_WORKFLOW_ID));
    }

    await act(async () => {
      fireEvent.click(
        screen.getByRole("option", { name: /Warehouse restock/ }),
      );
    });

    await waitFor(() => {
      expect(lastArguments()["workflowId"]).toBe(LATE_WORKFLOW_ID);
    });
  });

  test("a workflow the step holds that was deleted since reads 'No longer available', and stays until it is removed", async () => {
    renderStep(
      step(ComponentID.WorkflowRun, { workflowId: DELETED_WORKFLOW_ID }),
    );

    expect(
      await screen.findByText("No longer available", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(DELETED_WORKFLOW_ID);

    // The step still holds it: nothing was taken away by drawing it.
    const changes: Array<Array<unknown>> = onFormChange.mock.calls as Array<
      Array<unknown>
    >;

    for (const [node] of changes) {
      expect(
        ((node as NodeDataProp).arguments as JSONObject)["workflowId"],
      ).toBe(DELETED_WORKFLOW_ID);
    }
  });
});

describe("Create One Incident's Incident Template", () => {
  test("REGRESSION: a template the step holds past the first 10,000 is named, read by its ID", async () => {
    renderStep(
      step("incident-create-one", {
        [INCIDENT_TEMPLATE_ARGUMENT_ID]: LATE_TEMPLATE_ID,
      }),
    );

    expect(
      await screen.findByText("Warehouse fire", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(LATE_TEMPLATE_ID);

    for (const call of server.callsFor(IncidentTemplate)) {
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }
  });

  test("REGRESSION: one past them is found on the server by its name, and picked", async () => {
    renderStep(step("incident-create-one", {}));

    await typeInto(
      `workflow-argument-${INCIDENT_TEMPLATE_ARGUMENT_ID}`,
      "fire",
    );

    const option: HTMLElement = await screen.findByRole("option", {
      name: /Warehouse fire/,
    });

    expect(
      readsOf(IncidentTemplate).some(
        (query: Record<string, unknown>): boolean => {
          return query["templateName"] instanceof Search;
        },
      ),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(lastArguments()[INCIDENT_TEMPLATE_ARGUMENT_ID]).toBe(
        LATE_TEMPLATE_ID,
      );
    });
  });
});
