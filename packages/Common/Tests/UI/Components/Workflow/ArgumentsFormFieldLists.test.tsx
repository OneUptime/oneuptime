/*
 * A record step's two field lists, as the step's settings form draws them
 * (ArgumentsForm): the name, the line under it, the list, and what it says
 * when it must hold a field and holds none.
 *
 * "Triggers: Listen on and Select fields - Please make them a lot better.
 * They are very confusing now." Every other setting's help starts with
 * "Required." or "Optional."; under "Fields to watch (Optional)" that read
 * "Optional. Run only when ... Leave it empty to ..." - one thing said three
 * times, over a list that says what empty means itself. A field list's help
 * is what the list is for, and no more.
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
  Argument,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import BaseModelComponent, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "../../../../Types/Workflow/Components/BaseModel";
import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import API from "../../../../UI/Utils/API/API";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { INCIDENT_COLUMNS } from "./FieldPicker/FieldPickerFixture";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

// One of the Incident's record steps, as the builder holds it.
const step: StepFunction = (
  suffix: string,
  args: JSONObject = {},
): NodeDataProp => {
  const metadata: ComponentMetadata | undefined = INCIDENT_STEPS.find(
    (component: ComponentMetadata): boolean => {
      return component.id === `incident-${suffix}`;
    },
  );

  if (!metadata) {
    throw new Error(`No Incident step ${suffix}`);
  }

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

interface Rendered {
  onErrors: MockFunction;
  onFormChange: MockFunction;
}

type RenderStepFunction = (node: NodeDataProp) => Promise<Rendered>;

const renderStep: RenderStepFunction = async (
  node: NodeDataProp,
): Promise<Rendered> => {
  const onErrors: MockFunction = getJestMockFunction();
  const onFormChange: MockFunction = getJestMockFunction();

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

  await screen.findByTestId("fields-to-pass-on");

  return { onErrors: onErrors, onFormChange: onFormChange };
};

type ArgumentOfFunction = (node: NodeDataProp, id: string) => Argument;

const argumentOf: ArgumentOfFunction = (
  node: NodeDataProp,
  id: string,
): Argument => {
  const found: Argument | undefined = node.metadata.arguments.find(
    (argument: Argument): boolean => {
      return argument.id === id;
    },
  );

  if (!found) {
    throw new Error(`No setting ${id}`);
  }

  return found;
};

const WATCH_HELP: string =
  "Run only when an update changes one of these fields. Leave it empty to run on every change to the Incident.";
const PASS_ON_HELP: string =
  "The Incident fields the next steps can use. A field you leave out is empty in later steps.";

describe("a record trigger's field lists, in its settings", () => {
  test("each is named, and says what it is for in one line", async () => {
    await renderStep(step("on-update", { select: { title: true } }));

    expect(screen.getByText(WATCHED_FIELDS_NAME)).toBeInTheDocument();
    expect(screen.getByText(SELECT_FIELDS_NAME)).toBeInTheDocument();
    // The lines are the steps' own, word for word.
    expect(screen.getByText(WATCH_HELP)).toBeInTheDocument();
    expect(screen.getByText(PASS_ON_HELP)).toBeInTheDocument();
  });

  test("the line under Fields to watch does not say Optional again", async () => {
    const node: NodeDataProp = step("on-update", { select: { title: true } });

    await renderStep(node);

    // It is optional, and its name says so, as every optional field's does.
    expect(argumentOf(node, "listen-on").required).toBe(false);
    expect(screen.getByText("(Optional)")).toBeInTheDocument();
    // Once is enough: the help used to start "Optional. Run only when ...".
    expect(screen.queryByText(`Optional. ${WATCH_HELP}`)).toBeNull();
    expect(screen.queryByText(/^Optional\./)).toBeNull();
    // And the list says what empty means itself.
    expect(screen.getByTestId("fields-to-watch-empty")).toHaveTextContent(
      "Every change to the incident runs this workflow.",
    );
  });

  test("the line under Fields to pass on does not start with Required", async () => {
    const node: NodeDataProp = step("on-update", { select: { title: true } });

    await renderStep(node);

    expect(argumentOf(node, "select").required).toBe(true);
    expect(screen.queryByText(`Required. ${PASS_ON_HELP}`)).toBeNull();
    expect(screen.queryByText(/^Required\./)).toBeNull();
    // Its name carries no "(Optional)": one field of two is optional here.
    expect(screen.getAllByText("(Optional)")).toHaveLength(1);
  });

  test("the help is the step's own description of the setting, unchanged", async () => {
    const node: NodeDataProp = step("on-update", { select: { title: true } });

    await renderStep(node);

    expect(argumentOf(node, "listen-on").description).toBe(WATCH_HELP);
    expect(argumentOf(node, "select").description).toBe(PASS_ON_HELP);
  });

  test("On Create has the one list, with the same line", async () => {
    await renderStep(step("on-create", { select: { title: true } }));

    expect(screen.getByText(PASS_ON_HELP)).toBeInTheDocument();
    expect(screen.queryByTestId("fields-to-watch")).toBeNull();
    expect(screen.queryByText(/^Required\./)).toBeNull();
    expect(screen.queryByText(/^Optional\./)).toBeNull();
  });
});

describe("a Find step's Fields to pass on, beside its other settings", () => {
  test("its line is the list's own; the settings beside it keep theirs", async () => {
    const node: NodeDataProp = step("find-one", {
      query: {},
      select: { title: true },
    });

    await renderStep(node);

    expect(screen.getByText(PASS_ON_HELP)).toBeInTheDocument();
    expect(screen.queryByText(`Required. ${PASS_ON_HELP}`)).toBeNull();

    // Query is any other setting: its help still says whether it is required.
    const query: Argument = argumentOf(node, "query");

    expect(
      screen.getByText(
        `${query.required ? "Required" : "Optional"}. ${query.description}`,
      ),
    ).toBeInTheDocument();
  });
});

describe("a list that must hold a field, and holds none", () => {
  test("says so under the list, in its own words, once the last field is taken out", async () => {
    const { onErrors } = await renderStep(
      step("on-update", { select: { title: true } }),
    );

    const passOn: HTMLElement = screen.getByTestId("fields-to-pass-on");

    expect(within(passOn).queryByTestId("error-message")).toBeNull();

    fireEvent.click(within(passOn).getByTestId("fields-to-pass-on-remove"));

    const message: HTMLElement =
      await within(passOn).findByTestId("error-message");

    expect(message).toHaveTextContent(/^Pick at least one field\.$/);
    // Not the form's words for any box left blank.
    expect(screen.queryByText("Fields to pass on is required.")).toBeNull();
    // The dialog cannot be saved until it is fixed.
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: true });
    // The message shares its line with Edit as JSON, right under the list.
    expect(
      within(passOn).getByTestId("fields-to-pass-on-edit-json").parentElement,
    ).toContainElement(message);
  });

  test("picking a field takes the message away, and the dialog can be saved", async () => {
    const { onErrors, onFormChange } = await renderStep(
      step("on-update", { select: { title: true } }),
    );

    const passOn: HTMLElement = screen.getByTestId("fields-to-pass-on");

    fireEvent.click(within(passOn).getByTestId("fields-to-pass-on-remove"));
    await within(passOn).findByTestId("error-message");

    fireEvent.click(within(passOn).getByTestId("fields-to-pass-on-add"));
    fireEvent.click(screen.getByTestId("fields-to-pass-on-option-declaredAt"));

    await waitFor(() => {
      expect(within(passOn).queryByTestId("error-message")).toBeNull();
    });
    expect(onErrors).toHaveBeenLastCalledWith({ arguments: false });

    const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
      Array<unknown>
    >;

    expect(
      (calls[calls.length - 1]![0] as NodeDataProp).arguments["select"],
    ).toBe(JSON.stringify({ declaredAt: true }));
  });

  test("Fields to watch emptied says nothing: empty is every change", async () => {
    const { onErrors } = await renderStep(
      step("on-update", {
        "listen-on": { title: true },
        select: { title: true },
      }),
    );

    const watch: HTMLElement = screen.getByTestId("fields-to-watch");

    fireEvent.click(within(watch).getByTestId("fields-to-watch-remove"));

    expect(screen.getByTestId("fields-to-watch-empty")).toHaveTextContent(
      "Every change to the incident runs this workflow.",
    );
    expect(within(watch).queryByTestId("error-message")).toBeNull();
    expect(onErrors).not.toHaveBeenLastCalledWith({ arguments: true });
  });
});
