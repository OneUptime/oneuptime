/*
 * On Create or Update's settings, as the step's settings form draws them
 * (ArgumentsForm): On Update's two field lists, the same lists, with what
 * Fields to watch says changed to what it does here - it narrows the
 * updates, and a new record always runs the workflow.
 *
 * The form, its fields and the lists are the real thing; only the model's
 * fields come from a stand-in for the API.
 */

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return error instanceof Error ? error.message : String(error);
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
    },
  };
});

// The code editor does not run under jsdom; the box only has to hold text.
jest.mock("../../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      value?: string;
      onChange?: (value: string) => void;
    }): React.ReactElement => {
      return (
        <textarea
          data-testid="code-editor"
          value={props.value || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import BaseModelComponent, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "../../../../Types/Workflow/Components/BaseModel";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import ModelFieldPicker, {
  FieldPickerMode,
  ModelFieldPickerCopy,
} from "../../../../UI/Components/Workflow/ModelFieldPicker";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { INCIDENT_COLUMNS } from "./FieldPicker/FieldPickerFixture";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

type ApiGetFunction = () => MockFunction;

const apiGet: ApiGetFunction = (): MockFunction => {
  return API.get as unknown as MockFunction;
};

beforeEach(() => {
  apiGet().mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        tableName: "Incident",
        columns: INCIDENT_COLUMNS,
      } as unknown as JSONObject,
      {},
    ),
  );
});

afterEach(() => {
  cleanup();
  apiGet().mockReset();
});

const INCIDENT_STEPS: Array<ComponentMetadata> =
  BaseModelComponent.getComponents(new Incident());

type StepFunction = (suffix: string, args?: JSONObject) => NodeDataProp;

const step: StepFunction = (
  suffix: string,
  args: JSONObject = {},
): NodeDataProp => {
  const metadata: ComponentMetadata = INCIDENT_STEPS.find(
    (component: ComponentMetadata): boolean => {
      return component.id === `incident-${suffix}`;
    },
  )!;

  return {
    error: "",
    id: `${metadata.id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${metadata.id}-1-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

type RenderStepFunction = (node: NodeDataProp) => Promise<void>;

const renderStep: RenderStepFunction = async (
  node: NodeDataProp,
): Promise<void> => {
  const onErrors: MockFunction = getJestMockFunction();

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
      onFormChange={() => {}}
    />,
  );

  await screen.findByTestId("fields-to-pass-on");
};

const WATCH_HELP: string =
  "Run on an update only when it changes one of these fields. A new Incident always runs this workflow. Leave it empty to run on every change.";
const PASS_ON_HELP: string =
  "The Incident fields the next steps can use. A field you leave out is empty in later steps.";

describe("On Create or Update's settings", () => {
  test("are On Update's two lists, each with its line", async () => {
    await renderStep(step("on-create-or-update", { select: { title: true } }));

    expect(screen.getByText(WATCHED_FIELDS_NAME)).toBeInTheDocument();
    expect(screen.getByText(SELECT_FIELDS_NAME)).toBeInTheDocument();
    expect(screen.getByText(WATCH_HELP)).toBeInTheDocument();
    expect(screen.getByText(PASS_ON_HELP)).toBeInTheDocument();
    // Fields to watch is the optional one, and says it once.
    expect(screen.getAllByText("(Optional)")).toHaveLength(1);
    expect(screen.queryByText(/^Optional\./)).toBeNull();
  });

  test("Fields to watch, empty, says a new incident and every change run it", async () => {
    await renderStep(step("on-create-or-update", { select: { title: true } }));

    expect(screen.getByTestId("fields-to-watch-empty")).toHaveTextContent(
      /^Every new incident, and every change to one, runs this workflow\.$/,
    );
    // Fields to pass on keeps its own words.
    expect(
      within(screen.getByTestId("fields-to-pass-on")).queryByText(
        /every change/i,
      ),
    ).toBeNull();
  });

  test("Fields to watch with a field chosen lists it, as On Update's does", async () => {
    await renderStep(
      step("on-create-or-update", {
        "listen-on": { title: true },
        select: { title: true },
      }),
    );

    expect(screen.queryByTestId("fields-to-watch-empty")).toBeNull();
    expect(
      within(screen.getByTestId("fields-to-watch")).getByText("Title"),
    ).toBeInTheDocument();
  });

  test("On Update's empty Fields to watch still says what it always said", async () => {
    await renderStep(step("on-update", { select: { title: true } }));

    expect(screen.getByTestId("fields-to-watch-empty")).toHaveTextContent(
      /^Every change to the incident runs this workflow\.$/,
    );
  });
});

describe("the field list's empty line", () => {
  test("is the create-and-update one only when a create always runs the step", async () => {
    render(
      <ModelFieldPicker
        tableName="Incident"
        mode={FieldPickerMode.Watch}
        createAlwaysRuns={true}
        initialValue={{}}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByTestId("fields-to-watch-empty"),
    ).toHaveTextContent(
      "Every new incident, and every change to one, runs this workflow.",
    );
  });

  test("is the update one otherwise", async () => {
    render(
      <ModelFieldPicker
        tableName="Incident"
        mode={FieldPickerMode.Watch}
        initialValue={{}}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByTestId("fields-to-watch-empty"),
    ).toHaveTextContent("Every change to the incident runs this workflow.");
  });

  test("Fields to pass on is never told it, whatever it is handed", async () => {
    render(
      <ModelFieldPicker
        tableName="Incident"
        mode={FieldPickerMode.PassOn}
        createAlwaysRuns={true}
        initialValue={{}}
        onChange={() => {}}
      />,
    );

    expect(
      await screen.findByTestId("fields-to-pass-on-empty"),
    ).toHaveTextContent("Pick the fields the next steps need.");
  });

  test("the sentence is one key, with the record as a value", () => {
    expect(ModelFieldPickerCopy.emptyWatchWithCreate).toBe(
      "Every new {{record}}, and every change to one, runs this workflow.",
    );
  });
});
