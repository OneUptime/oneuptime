/*
 * Whether a step's settings dialog lets it be saved.
 *
 * The dialog collects two reports - the step's settings, and its identifier -
 * and turns Save off, saying why, while either has a problem (bd554d8eb0:
 * "show broken settings in the builder instead of at run time"). It merged
 * each report into the copy of its state it had when it last drew. Both
 * report as the dialog opens, in the same moment, so the second overwrote the
 * first: a step opened with an empty required setting showed Save on, and
 * could be saved or run on its own until something was typed. Each report
 * now lands on the latest state.
 */

// Utils.ts imports the database-model registry, which nothing here needs.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      }),
    },
  };
});

import ComponentSettingsModal from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { placeCaret } from "./ValuePicker/ValuePickerTestUtils";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

const FIX_MESSAGE: string =
  "Some settings need fixing before this can be saved.";

type StepFunction = (
  id: ComponentID,
  stepId: string,
  args?: JSONObject,
) => NodeDataProp;

const step: StepFunction = (
  id: ComponentID,
  stepId: string,
  args: JSONObject = {},
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata) => {
      return component.id === id;
    },
  ) as ComponentMetadata;

  return {
    error: "",
    id: stepId,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${stepId}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

type RenderFunction = (node: NodeDataProp) => {
  onSave: MockFunction;
  user: UserEvent;
};

const renderDialog: RenderFunction = (
  node: NodeDataProp,
): { onSave: MockFunction; user: UserEvent } => {
  const onSave: MockFunction = getJestMockFunction();

  render(
    <ComponentSettingsModal
      title={node.metadata.title}
      description={node.metadata.description}
      onClose={() => {}}
      onSave={(component: NodeDataProp) => {
        onSave(component);
      }}
      onDelete={() => {}}
      onRunStep={() => {}}
      component={node}
      graphComponents={[node]}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
    />,
  );

  return { onSave: onSave, user: userEvent.setup({ delay: null }) };
};

type SaveFunction = () => HTMLElement;

const save: SaveFunction = (): HTMLElement => {
  return screen.getByTestId("modal-footer-submit-button");
};

afterEach(() => {
  cleanup();
});

describe("a step's dialog lets it be saved only when its settings work", () => {
  test.each([
    [ComponentID.Log, "value"],
    [ComponentID.IfElse, "input-1"],
  ])(
    "%s opened with an empty required setting: Save is off and the footer says why",
    async (id: ComponentID) => {
      renderDialog(step(id, `${id}-1`));

      await waitFor(() => {
        expect(save()).toBeDisabled();
      });
      expect(screen.getByText(FIX_MESSAGE)).toBeInTheDocument();
      // Nor can a step that would fail be run on its own.
      expect(
        screen.queryByRole("button", { name: "Run just this step" }),
      ).toBeNull();
    },
  );

  test("filling the setting in turns Save on, and the step can be run on its own", async () => {
    const { user, onSave } = renderDialog(step(ComponentID.Log, "log-1"));

    await waitFor(() => {
      expect(save()).toBeDisabled();
    });

    placeCaret(screen.getByTestId("workflow-argument-value"), 0);
    await user.keyboard("Hello");

    await waitFor(() => {
      expect(save()).toBeEnabled();
    });
    expect(screen.queryByText(FIX_MESSAGE)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Run just this step" }),
    ).toBeInTheDocument();

    await user.click(save());

    expect((onSave.mock.calls[0]![0] as NodeDataProp).arguments["value"]).toBe(
      "Hello",
    );
  });

  test("a step whose settings work opens with Save on", async () => {
    renderDialog(step(ComponentID.Log, "log-1", { value: "Hello" }));

    await waitFor(() => {
      expect(save()).toBeEnabled();
    });
    expect(screen.queryByText(FIX_MESSAGE)).toBeNull();
  });

  test("editing the identifier does not turn Save on while a setting is still empty", async () => {
    const { user } = renderDialog(step(ComponentID.Log, "log-1"));

    const identifier: HTMLElement = screen.getByRole("textbox", {
      name: /^Identifier/,
    });

    await user.clear(identifier);
    await user.type(identifier, "say-hello");

    await waitFor(() => {
      expect(identifier).toHaveValue("say-hello");
    });
    expect(save()).toBeDisabled();
    expect(screen.getByText(FIX_MESSAGE)).toBeInTheDocument();
  });

  test("an empty identifier turns Save off however good the settings are", async () => {
    const { user } = renderDialog(
      step(ComponentID.Log, "log-1", { value: "Hello" }),
    );

    await waitFor(() => {
      expect(save()).toBeEnabled();
    });

    await user.clear(screen.getByRole("textbox", { name: /^Identifier/ }));

    await waitFor(() => {
      expect(save()).toBeDisabled();
    });
  });
});
