/*
 * Branching on What Happened, On Create or Update's value that says whether
 * a new record or a change to one started the run.
 *
 * It holds one of two words, `created` or `updated`, written as they are -
 * "Created" matches neither. So where If / Else and Switch / Case compare
 * it, the field to type into says both words, as it says "true or false"
 * for a yes/no value, instead of the "e.g. production" every other text
 * value gets. Rendered in the real settings: ArgumentsForm, the If / Else
 * and Switch / Case editors and the value picker; only the API is stood in
 * for.
 */

// Utils.ts imports the database-model registry, which nothing here needs.
jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

jest.mock("../../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

// The picker's requests: no variables, and no fields to read.
jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
    },
  };
});

import ArgumentsForm from "../../../../../UI/Components/Workflow/ArgumentsForm";
import { getCompareWithPlaceholder } from "../../../../../UI/Components/Workflow/Condition/ConditionEditor";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponent from "../../../../../Types/Workflow/Components/BaseModel";
import { ConditionValueType } from "../../../../../Types/Workflow/Components/Condition";
import {
  WHAT_HAPPENED_ID,
  getCreateOrUpdateTriggerId,
} from "../../../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  Translator,
  createTranslator,
} from "../../../../../UI/Utils/TranslateTemplate";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

const TRIGGER_STEP_ID: string = "incident-on-create-or-update-1";

const WHAT_HAPPENED: string = `{{local.components.${TRIGGER_STEP_ID}.returnValues.${WHAT_HAPPENED_ID}}}`;
const TITLE: string = `{{local.components.${TRIGGER_STEP_ID}.returnValues.model.title}}`;

const BOTH_WORDS: string = "created or updated";
const ANY_TEXT: string = "e.g. production";

const triggerMetadata: ComponentMetadata = BaseModelComponent.getComponents(
  new Incident(),
).find((component: ComponentMetadata): boolean => {
  return component.id === getCreateOrUpdateTriggerId("Incident");
})!;

type StepFunction = (
  metadata: ComponentMetadata,
  stepId: string,
  args?: JSONObject,
) => NodeDataProp;

const step: StepFunction = (
  metadata: ComponentMetadata,
  stepId: string,
  args: JSONObject = {},
): NodeDataProp => {
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

const metadataOf: (id: ComponentID) => ComponentMetadata = (
  id: ComponentID,
): ComponentMetadata => {
  return Components.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  })!;
};

const trigger: NodeDataProp = step(triggerMetadata, TRIGGER_STEP_ID, {
  select: { title: true },
});

type RenderStepFunction = (id: ComponentID, args: JSONObject) => void;

// A step's settings, right after the On Create or Update Incident trigger.
const renderStep: RenderStepFunction = (
  id: ComponentID,
  args: JSONObject,
): void => {
  const node: NodeDataProp = step(metadataOf(id), `${id}-1`, args);

  render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={[trigger, node]}
      valueSources={{
        upstream: [trigger],
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      onHasFormValidationErrors={(_errors: Dictionary<boolean>): void => {}}
      onFormChange={(_value: NodeDataProp): void => {}}
    />,
  );
};

const compareWith: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Compare with" });
};

const caseValue: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return screen.getByRole("textbox", { name: `Value for case ${index + 1}` });
};

// English, as a reader without a language of their own sees it.
const ENGLISH: Translator = createTranslator(
  (text: string | undefined): string | undefined => {
    return text;
  },
  "en",
);

afterEach(() => {
  cleanup();
});

describe("If / Else on What Happened", () => {
  test("Compare with says the two words What Happened can hold", () => {
    renderStep(ComponentID.IfElse, {
      "input-1": WHAT_HAPPENED,
      operator: "==",
      "input-2": "",
    });

    expect(compareWith()).toHaveAttribute("aria-placeholder", BOTH_WORDS);
    // Drawn where the typing goes, while nothing is typed.
    expect(
      screen.getByTestId("workflow-argument-input-2-box"),
    ).toHaveTextContent(BOTH_WORDS);
  });

  test("any other value of the same trigger keeps the usual example", () => {
    renderStep(ComponentID.IfElse, {
      "input-1": TITLE,
      operator: "==",
      "input-2": "",
    });

    expect(compareWith()).toHaveAttribute("aria-placeholder", ANY_TEXT);
  });

  test("What Happened with more text around it is not What Happened alone", () => {
    renderStep(ComponentID.IfElse, {
      "input-1": `Incident ${WHAT_HAPPENED}`,
      operator: "==",
      "input-2": "",
    });

    expect(compareWith()).toHaveAttribute("aria-placeholder", ANY_TEXT);
  });
});

describe("Switch / Case on What Happened", () => {
  test("every case's value says the two words", () => {
    renderStep(ComponentID.Switch, {
      value: WHAT_HAPPENED,
      cases: [
        { id: "case-1", comparison: "==", value: "", compareAs: "text" },
        { id: "case-2", comparison: "==", value: "", compareAs: "text" },
      ],
    });

    expect(caseValue(0)).toHaveAttribute("aria-placeholder", BOTH_WORDS);
    expect(caseValue(1)).toHaveAttribute("aria-placeholder", BOTH_WORDS);
  });

  test("a Switch on another value keeps the usual example", () => {
    renderStep(ComponentID.Switch, {
      value: TITLE,
      cases: [{ id: "case-1", comparison: "==", value: "", compareAs: "text" }],
    });

    expect(caseValue(0)).toHaveAttribute("aria-placeholder", ANY_TEXT);
  });
});

describe("the hint itself", () => {
  test("is the two values, joined as the reader's language joins two words", () => {
    expect(
      getCompareWithPlaceholder(
        ENGLISH,
        ConditionValueType.Text,
        WHAT_HAPPENED,
      ),
    ).toBe(BOTH_WORDS);

    const german: Translator = createTranslator(
      (text: string | undefined): string | undefined => {
        return text === "{{first}} or {{second}}"
          ? "{{first}} oder {{second}}"
          : text;
      },
      "de",
    );

    // The words are values to type, so they stay as they are.
    expect(
      getCompareWithPlaceholder(german, ConditionValueType.Text, WHAT_HAPPENED),
    ).toBe("created oder updated");
  });

  test("a number or a yes/no comparison says what it always said", () => {
    expect(
      getCompareWithPlaceholder(
        ENGLISH,
        ConditionValueType.Number,
        WHAT_HAPPENED,
      ),
    ).toBe("e.g. 200");
    expect(
      getCompareWithPlaceholder(
        ENGLISH,
        ConditionValueType.Boolean,
        WHAT_HAPPENED,
      ),
    ).toBe("true or false");
  });

  test("without a value to check, it is the usual example", () => {
    expect(getCompareWithPlaceholder(ENGLISH, ConditionValueType.Text)).toBe(
      ANY_TEXT,
    );
    expect(
      getCompareWithPlaceholder(ENGLISH, ConditionValueType.Text, ""),
    ).toBe(ANY_TEXT);
  });
});
