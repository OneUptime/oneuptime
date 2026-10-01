/*
 * An If / Else step's card on the workflow canvas says its condition - "If
 * environment is equal to “production”" - in place of the description every
 * If / Else shares, so a workflow can be read without opening each check.
 */

// React Flow's Handle needs the canvas's store; the card is tested on its own.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (): null => {
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
  };
});

jest.mock("../../../../../UI/Components/Tooltip/Tooltip", () => {
  return {
    __esModule: true,
    default: (props: { text?: string; children: ReactElement }) => {
      return (
        <span data-testid="tooltip" data-tooltip-text={props.text || ""}>
          {props.children}
        </span>
      );
    },
  };
});

import WorkflowNode, {
  getStepSummary,
} from "../../../../../UI/Components/Workflow/Component";
import { WorkflowNodeRenderData } from "../../../../../UI/Components/Workflow/GraphLintSummary";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

type DataFunction = (
  id: ComponentID,
  args?: JSONObject,
  extra?: Partial<WorkflowNodeRenderData>,
) => WorkflowNodeRenderData;

const dataOf: DataFunction = (
  id: ComponentID,
  args: JSONObject = {},
  extra: Partial<WorkflowNodeRenderData> = {},
): WorkflowNodeRenderData => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: `${id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
    ...extra,
  };
};

const PRODUCTION_CHECK: JSONObject = {
  "input-1-type": "text",
  "input-1":
    "{{local.components.webhook-1.returnValues.request-body.environment}}",
  operator: "==",
  "input-2-type": "text",
  "input-2": "production",
};

afterEach(() => {
  cleanup();
});

describe("what an If / Else card says", () => {
  test("its condition, read the way the settings read it", () => {
    expect(getStepSummary(dataOf(ComponentID.IfElse, PRODUCTION_CHECK))).toBe(
      "If environment is equal to “production”",
    );
    expect(
      getStepSummary(
        dataOf(ComponentID.IfElse, {
          "input-1":
            "{{local.components.api-get-1.returnValues.response-status}}",
          operator: ">=",
          "input-2": "400",
          "input-1-type": "number",
          "input-2-type": "number",
        }),
      ),
    ).toBe("If response-status is greater than or equal to 400");
    expect(
      getStepSummary(
        dataOf(ComponentID.IfElse, {
          "input-1-type": "boolean",
          "input-1":
            "{{local.components.javascript-1.returnValues.returnValue.proceed}}",
          operator: "==",
          "input-2-type": "boolean",
          "input-2": true,
        }),
      ),
    ).toBe("If proceed is true");
    expect(
      getStepSummary(
        dataOf(ComponentID.IfElse, {
          "input-1": "{{local.variables.DEPLOY_ENV}}",
          operator: "is empty",
        }),
      ),
    ).toBe("If DEPLOY_ENV is empty");
  });

  test("nothing of its own until it has a value to check", () => {
    expect(getStepSummary(dataOf(ComponentID.IfElse))).toBeNull();
    expect(
      getStepSummary(dataOf(ComponentID.IfElse, { operator: "==" })),
    ).toBeNull();
  });

  test("nothing in the Add Component list, and nothing for other steps", () => {
    expect(
      getStepSummary(
        dataOf(ComponentID.IfElse, PRODUCTION_CHECK, { isPreview: true }),
      ),
    ).toBeNull();
    expect(
      getStepSummary(dataOf(ComponentID.Log, { value: "hello" })),
    ).toBeNull();
  });

  test("the card shows the condition, with all of it on hover", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.IfElse, PRODUCTION_CHECK)}
        selected={false}
      />,
    );

    const summary: HTMLElement = screen.getByTestId("workflow-node-summary");

    expect(summary).toHaveTextContent(
      "If environment is equal to “production”",
    );
    expect(summary).toHaveAttribute(
      "title",
      "If environment is equal to “production”",
    );
    expect(
      screen.queryByText(metadataOf(ComponentID.IfElse).description),
    ).toBeNull();
  });

  test("a card not set up yet keeps the step's description", () => {
    render(<WorkflowNode data={dataOf(ComponentID.IfElse)} selected={false} />);

    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      "Checks a condition, then continues on Yes or No.",
    );
    expect(screen.queryByTestId("workflow-node-summary")).toBeNull();
  });

  test("its outputs are Yes and No, with what each means on hover", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.IfElse, PRODUCTION_CHECK)}
        selected={false}
      />,
    );

    const tooltips: Array<string> = screen
      .getAllByTestId("tooltip")
      .map((tooltip: HTMLElement) => {
        return `${tooltip.textContent}: ${tooltip.getAttribute("data-tooltip-text")}`;
      });

    expect(tooltips).toEqual(
      expect.arrayContaining([
        "Yes: Runs next when the condition is met.",
        "No: Runs next when the condition is not met.",
      ]),
    );
  });
});
