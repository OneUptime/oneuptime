/*
 * A Switch / Case step's card on the canvas: one output per case, each named
 * after its case - "Critical Incident", "contains timeout", "is empty" - and
 * Default, each name right above its dot; what the step checks, in a line;
 * a card wide enough for its names; and React Flow told to measure the dots
 * again whenever the cases change, or a connection drawn from a new case's
 * dot would go nowhere.
 *
 * The other steps' cards get the same layout: every output's name above its
 * own dot, where Yes and No used to sit at the card's two edges, away from
 * the dots they named.
 */

// The global jest's own mock type: jest.fn here is the global one.
const mockUpdateNodeInternals: jest.Mock<void, [string]> = jest.fn(
  (_nodeId: string): void => {},
);

// React Flow's Handle needs the canvas's store: each dot is drawn as a plain element.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (props: {
      id: string;
      type: string;
      style?: Record<string, unknown>;
    }): ReactElement => {
      return (
        <span
          data-testid={`handle-${props.type}`}
          data-handle-id={props.id}
          data-left={String(props.style?.["left"] ?? "")}
        />
      );
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    useNodeId: (): string => {
      return "canvas-switch-1";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return mockUpdateNodeInternals;
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
import {
  getStarterSwitchCases,
  toStoredSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const SEVERITY: string =
  "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}";

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

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => JSONObject;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = "text",
): JSONObject => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const SEVERITY_SWITCH: JSONObject = {
  value: SEVERITY,
  cases: [
    aCase("case-1", "==", "Critical Incident"),
    aCase("case-2", "==", "Major Incident"),
  ],
};

type OutputNamesFunction = () => Array<string>;

const outputNames: OutputNamesFunction = (): Array<string> => {
  return screen
    .getAllByTestId("workflow-node-output")
    .map((output: HTMLElement): string => {
      return output.textContent || "";
    });
};

type DotsFunction = () => Array<{ id: string; left: string }>;

const outputDots: DotsFunction = (): Array<{ id: string; left: string }> => {
  return screen
    .getAllByTestId("handle-source")
    .map((dot: HTMLElement): { id: string; left: string } => {
      return {
        id: dot.getAttribute("data-handle-id") || "",
        left: dot.getAttribute("data-left") || "",
      };
    });
};

type CardFunction = (view: RenderResult) => HTMLElement;

// The card itself: the outermost element the node draws.
const card: CardFunction = (view: RenderResult): HTMLElement => {
  return view.container.firstElementChild as HTMLElement;
};

beforeEach(() => {
  mockUpdateNodeInternals.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("a Switch / Case card's outputs", () => {
  test("one per case, named after it, then Default", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    expect(outputNames()).toEqual([
      "Critical Incident",
      "Major Incident",
      "Default",
    ]);
  });

  test("each output's dot is the case's id, so a connection leaves from that case", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    expect(
      outputDots().map((dot: { id: string }): string => {
        return dot.id;
      }),
    ).toEqual(["case-1", "case-2", "default"]);
  });

  test("every name sits right above its dot: equal columns, each dot in the middle of its own", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    const lefts: Array<number> = outputDots().map(
      (dot: { left: string }): number => {
        return parseFloat(dot.left);
      },
    );

    expect(lefts[0]).toBeCloseTo(100 / 6, 5);
    expect(lefts[1]).toBeCloseTo(50, 5);
    expect(lefts[2]).toBeCloseTo((5 * 100) / 6, 5);

    for (const dot of outputDots()) {
      expect(dot.left.endsWith("%")).toBe(true);
    }

    // One column per name, shared out evenly.
    for (const name of screen.getAllByTestId("workflow-node-output")) {
      expect(
        (name.parentElement?.parentElement as HTMLElement).style.flex,
      ).toBe("1 1 0px");
    }
  });

  test("each case's name has its case's condition on hover", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    const tips: Array<string> = screen
      .getAllByTestId("workflow-node-output")
      .map((name: HTMLElement): string => {
        return (
          name
            .closest("[data-testid='tooltip']")
            ?.getAttribute("data-tooltip-text") || ""
        );
      });

    expect(tips).toEqual([
      "Runs next when the value is equal to “Critical Incident”.",
      "Runs next when the value is equal to “Major Incident” and no case above it matches.",
      "Runs next when no case matches.",
    ]);
  });

  test("a case that is not set up yet is named by its place: a new step shows Case 1, Case 2 and Default", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          cases: toStoredSwitchCases(getStarterSwitchCases()),
        })}
        selected={false}
      />,
    );

    expect(outputNames()).toEqual(["Case 1", "Case 2", "Default"]);
  });

  test("other comparisons are named with their value, and those without one by the comparison", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          value: "{{local.components.api-get-1.returnValues.response-status}}",
          cases: [
            aCase("case-1", "<", "300", "number"),
            aCase("case-2", "is empty"),
            aCase("case-3", "contains", "timeout"),
          ],
        })}
        selected={false}
      />,
    );

    expect(outputNames()).toEqual([
      "is less than 300",
      "is empty",
      "contains timeout",
      "Default",
    ]);
  });

  test("a step with no cases at all still has Default to connect", () => {
    render(
      <WorkflowNode data={dataOf(ComponentID.Switch, {})} selected={false} />,
    );

    expect(outputNames()).toEqual(["Default"]);
  });
});

describe("what a Switch / Case card says", () => {
  test("what it checks, and against how many cases", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    expect(screen.getByTestId("workflow-node-summary")).toHaveTextContent(
      "Checks incidentSeverity.name against 2 cases",
    );
    expect(screen.queryByTestId("workflow-node-description")).toBeNull();
  });

  test("its description until there is something to check", () => {
    const data: WorkflowNodeRenderData = dataOf(ComponentID.Switch, {
      cases: toStoredSwitchCases(getStarterSwitchCases()),
    });

    render(<WorkflowNode data={data} selected={false} />);

    expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
      data.metadata.description,
    );
  });

  test("a preview, in the picker, says nothing of a step's own", () => {
    expect(
      getStepSummary(
        dataOf(ComponentID.Switch, SEVERITY_SWITCH, { isPreview: true }),
      ),
    ).toBeNull();
  });

  test("no outputs on a preview", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH, { isPreview: true })}
        selected={false}
      />,
    );

    expect(screen.queryAllByTestId("workflow-node-output")).toHaveLength(0);
    expect(screen.queryAllByTestId("handle-source")).toHaveLength(0);
  });
});

describe("how wide a card is", () => {
  test("wide enough for names like Critical Incident", () => {
    const view: RenderResult = render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    const width: string = card(view).style.width;

    expect(width.endsWith("px")).toBe(true);
    expect(parseFloat(width)).toBeGreaterThan(256);
  });

  test("the usual 16rem when the names fit", () => {
    const view: RenderResult = render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          cases: toStoredSwitchCases(getStarterSwitchCases()),
        })}
        selected={false}
      />,
    );

    expect(card(view).style.width).toBe("16rem");
  });

  test("every other step keeps the usual 16rem", () => {
    for (const id of [
      ComponentID.IfElse,
      ComponentID.Log,
      ComponentID.ApiGet,
    ]) {
      const view: RenderResult = render(
        <WorkflowNode data={dataOf(id)} selected={false} />,
      );

      expect({ id, width: card(view).style.width }).toEqual({
        id,
        width: "16rem",
      });

      view.unmount();
    }
  });
});

describe("the other steps' outputs, laid out the same way", () => {
  test("Yes and No: each name above its own dot, a quarter and three quarters across", () => {
    render(<WorkflowNode data={dataOf(ComponentID.IfElse)} selected={false} />);

    expect(outputNames()).toEqual(["Yes", "No"]);
    expect(outputDots()).toEqual([
      { id: "yes", left: "25%" },
      { id: "no", left: "75%" },
    ]);
  });

  test("a step with one output: its dot in the middle", () => {
    render(<WorkflowNode data={dataOf(ComponentID.Log)} selected={false} />);

    expect(outputNames()).toEqual(["Out"]);
    expect(outputDots()).toEqual([{ id: "out", left: "50%" }]);
  });
});

describe("telling React Flow to measure the dots again", () => {
  test("not when the card is first drawn: React Flow measures it then", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    expect(mockUpdateNodeInternals).not.toHaveBeenCalled();
  });

  test("when a case is added, removed or moved, for this card", () => {
    const view: RenderResult = render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    // Added.
    view.rerender(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          ...SEVERITY_SWITCH,
          cases: [
            ...(SEVERITY_SWITCH["cases"] as Array<JSONObject>),
            aCase("case-3", "==", "Minor Incident"),
          ],
        })}
        selected={false}
      />,
    );

    expect(mockUpdateNodeInternals).toHaveBeenCalledTimes(1);
    expect(mockUpdateNodeInternals).toHaveBeenLastCalledWith("canvas-switch-1");

    // Moved.
    view.rerender(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          ...SEVERITY_SWITCH,
          cases: [
            aCase("case-3", "==", "Minor Incident"),
            ...(SEVERITY_SWITCH["cases"] as Array<JSONObject>),
          ],
        })}
        selected={false}
      />,
    );

    expect(mockUpdateNodeInternals).toHaveBeenCalledTimes(2);

    // Removed.
    view.rerender(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    expect(mockUpdateNodeInternals).toHaveBeenCalledTimes(3);
  });

  test("not for a change that leaves every dot where it was", () => {
    const view: RenderResult = render(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, SEVERITY_SWITCH)}
        selected={false}
      />,
    );

    // A new value of the same length, and selection: the dots stay put.
    view.rerender(
      <WorkflowNode
        data={dataOf(ComponentID.Switch, {
          ...SEVERITY_SWITCH,
          cases: [
            aCase("case-1", "==", "Critical Incidenx"),
            aCase("case-2", "==", "Major Incident"),
          ],
        })}
        selected={true}
      />,
    );

    expect(mockUpdateNodeInternals).not.toHaveBeenCalled();
  });

  test("never for a step whose outputs do not change", () => {
    const view: RenderResult = render(
      <WorkflowNode data={dataOf(ComponentID.IfElse)} selected={false} />,
    );

    view.rerender(
      <WorkflowNode
        data={dataOf(ComponentID.IfElse, {
          "input-1": "x",
          operator: "==",
          "input-2": "y",
        })}
        selected={true}
      />,
    );

    expect(mockUpdateNodeInternals).not.toHaveBeenCalled();
  });
});
