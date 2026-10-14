/*
 * A Page step's card on the canvas.
 *
 * Two things are its own. Its line says who the step pages and what about -
 * "2 users · New alert" - in place of the description all steps of its kind
 * share, so a workflow that pages different people down different paths can
 * be read without opening each step. And it has a colour of its own: the
 * one colour on the canvas that means a phone rings.
 *
 * Everything else is the card every step has: the title, the step's id, a
 * name above each output's dot, "Click to set up" while a required setting
 * is empty.
 *
 * jsdom's CSS parser drops var() and color-mix() values, so the colour
 * checks read the raw style objects through react-test-renderer.
 */

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
          data-background={String(props.style?.["background"] ?? "")}
          data-border={String(props.style?.["border"] ?? "")}
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
      return "canvas-page-1";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return (): void => {};
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
  WORKFLOW_NODE_SETUP_TEXT,
  getStepSummary,
} from "../../../../../UI/Components/Workflow/Component";
import {
  WorkflowNodeRenderData,
  buildNodeIssueSummaries,
} from "../../../../../UI/Components/Workflow/GraphLintSummary";
import { lintWorkflowGraph } from "../../../../../UI/Components/Workflow/GraphLint";
import { loadComponentsAndCategories } from "../../../../../UI/Components/Workflow/Utils";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { ON_CALL_COMPONENT_CATEGORY } from "../../../../../Types/Workflow/Components/OnCall";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
} from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test } from "@jest/globals";

const JANE: string = "10000000-0000-4000-8000-000000000001";
const JOHN: string = "10000000-0000-4000-8000-000000000002";
const PRIMARY: string = "5c4e0000-0000-4000-8000-000000000001";
const OWNERS: string =
  "{{local.components.incident-on-create-1.returnValues.model.ownerUsers}}";
const INCIDENT_ID: string =
  "{{local.components.incident-on-create-1.returnValues.model._id}}";

// The page colour, as the header and the dots draw it.
const PINK: string = "#ec4899";

// The darker pink beside it: the header's gradient and the rim of each dot.
const DARK_PINK: string = "#db2777";

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

// Every step the Builder offers: the hand-written ones and each database model's.
const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

function metadataOf(id: string): ComponentMetadata {
  return [...Components, ...CATALOG].find(
    (component: ComponentMetadata): boolean => {
      return component.id === id;
    },
  )!;
}

function dataFor(metadata: ComponentMetadata): WorkflowNodeRenderData {
  return {
    error: "",
    id: `${metadata.id}-1`,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${metadata.id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
  };
}

function dataOf(
  id: string,
  args: JSONObject = {},
  extra: Partial<WorkflowNodeRenderData> = {},
): WorkflowNodeRenderData {
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
}

function outputNames(): Array<string> {
  return screen
    .getAllByTestId("workflow-node-output")
    .map((output: HTMLElement): string => {
      return output.textContent || "";
    });
}

// Every style object the card draws with, as one text.
function stylesOf(data: WorkflowNodeRenderData, selected: boolean): string {
  let tree: ReactTestRenderer | null = null;

  renderer.act(() => {
    tree = renderer.create(<WorkflowNode data={data} selected={selected} />);
  });

  return (tree as unknown as ReactTestRenderer).root
    .findAll((instance: ReactTestInstance): boolean => {
      return (
        typeof instance.type === "string" && Boolean(instance.props["style"])
      );
    })
    .map((instance: ReactTestInstance): string => {
      return JSON.stringify(instance.props["style"]);
    })
    .join("\n");
}

afterEach(() => {
  cleanup();
});

describe("what the card says", () => {
  test("who the step pages and what about, in place of the shared description", () => {
    render(
      <WorkflowNode
        data={dataOf(ComponentID.PageUsers, {
          [PAGE_ARGUMENT_IDS.users]: [JANE, JOHN],
          [PAGE_ARGUMENT_IDS.title]: "Database CPU is above 90%",
        })}
        selected={false}
      />,
    );

    expect(screen.getByText("Page Users")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-node-summary")).toHaveTextContent(
      "2 users · New alert",
    );
    // The whole line on hover, should the card ever cut it short.
    expect(screen.getByTestId("workflow-node-summary")).toHaveAttribute(
      "title",
      "2 users · New alert",
    );
    expect(screen.queryByTestId("workflow-node-description")).toBeNull();
    expect(
      screen.queryByText(metadataOf(ComponentID.PageUsers).description),
    ).toBeNull();
  });

  test("two Page steps on two paths are told apart by their lines", () => {
    render(
      <div>
        <WorkflowNode
          data={dataOf(ComponentID.PageOnCall, {
            [PAGE_ARGUMENT_IDS.onCallSchedules]: [PRIMARY],
            [PAGE_ARGUMENT_IDS.about]: PageAbout.Incident,
            [PAGE_ARGUMENT_IDS.incidentId]: INCIDENT_ID,
          })}
          selected={false}
        />
        <WorkflowNode
          data={dataOf(ComponentID.PageUsers, {
            [PAGE_ARGUMENT_IDS.users]: [OWNERS],
            [PAGE_ARGUMENT_IDS.about]: PageAbout.Incident,
            [PAGE_ARGUMENT_IDS.incidentId]: INCIDENT_ID,
          })}
          selected={false}
        />
      </div>,
    );

    expect(
      screen
        .getAllByTestId("workflow-node-summary")
        .map((line: HTMLElement): string => {
          return line.textContent || "";
        }),
    ).toEqual([
      "On call in 1 schedule · Incident",
      "Users from an earlier step · Incident",
    ]);
  });

  test.each(PAGE_STEP_IDS.map(String))(
    "%s with nobody named: its description, and Click to set up",
    (id: string) => {
      const data: WorkflowNodeRenderData = dataOf(id);

      // The checks the Builder runs, on a workflow that is this step alone.
      const issueSummary: WorkflowNodeRenderData["issueSummary"] =
        buildNodeIssueSummaries(
          lintWorkflowGraph({
            nodes: [{ id: "node-1", data: data }],
            edges: [],
          }).issues,
        )["node-1"];

      // Who to page and, for a page about something new, its title.
      expect(issueSummary!.missingSettingMessages).toHaveLength(2);

      render(
        <WorkflowNode
          data={{ ...data, issueSummary: issueSummary }}
          selected={false}
        />,
      );

      expect(screen.getByTestId("workflow-node-description")).toHaveTextContent(
        metadataOf(id).description,
      );
      expect(screen.queryByTestId("workflow-node-summary")).toBeNull();
      expect(screen.getByTestId("workflow-node-setup-hint")).toHaveTextContent(
        WORKFLOW_NODE_SETUP_TEXT,
      );
    },
  );

  test.each(PAGE_STEP_IDS.map(String))(
    "%s: its two outputs are named above their dots, Success first",
    (id: string) => {
      render(<WorkflowNode data={dataOf(id)} selected={false} />);

      expect(outputNames()).toEqual(["Success", "Error"]);
    },
  );

  test("the line is the step's summary, which is what the card asks for", () => {
    expect(
      getStepSummary(
        dataOf(ComponentID.PageTeam, {
          [PAGE_ARGUMENT_IDS.teams]: [JANE],
          [PAGE_ARGUMENT_IDS.about]: PageAbout.Alert,
        }),
      ),
    ).toBe("1 team · Alert");
    expect(getStepSummary(dataOf(ComponentID.PageTeam))).toBeNull();
  });

  test("a step that is not a Page step keeps the line it had", () => {
    expect(
      getStepSummary(
        dataOf(ComponentID.Log, { [PAGE_ARGUMENT_IDS.users]: [JANE] }),
      ),
    ).toBeNull();
  });
});

describe("the page colour", () => {
  test.each(PAGE_STEP_IDS.map(String))(
    "%s: the header, the border when selected and the dots are pink",
    (id: string) => {
      expect(metadataOf(id).category).toBe(ON_CALL_COMPONENT_CATEGORY);

      const selected: string = stylesOf(dataOf(id), true);

      expect(selected).toContain(
        `linear-gradient(135deg, ${PINK}, ${DARK_PINK})`,
      );
      // Selected: the border and its glow.
      expect(selected).toContain(`2px solid ${PINK}`);
      expect(selected).toContain("rgba(236, 72, 153, 0.2)");
    },
  );

  test("the body is the page colour mixed into the theme's surface, so it holds in dark mode", () => {
    const styles: string = stylesOf(dataOf(ComponentID.PageUsers), false);

    expect(styles).toContain(
      `color-mix(in srgb, ${PINK} 12%, var(--ou-surface-primary, #ffffff))`,
    );
    expect(styles).toContain(
      `color-mix(in srgb, ${PINK} 38%, var(--ou-border-default, #e5e7eb))`,
    );
  });

  test("the dots of a Page step are the page colour", () => {
    render(
      <WorkflowNode data={dataOf(ComponentID.PageUsers)} selected={false} />,
    );

    const dots: Array<HTMLElement> = [
      ...screen.getAllByTestId("handle-source"),
      ...screen.getAllByTestId("handle-target"),
    ];

    expect(dots.length).toBe(3);

    for (const dot of dots) {
      expect(dot.getAttribute("data-background")).toBe(PINK);
      expect(dot.getAttribute("data-border")).toBe(`2px solid ${DARK_PINK}`);
    }
  });

  test("no other step in the catalog is drawn in it", () => {
    const others: Array<ComponentMetadata> = CATALOG.filter(
      (component: ComponentMetadata): boolean => {
        return !PAGE_STEP_IDS.map(String).includes(component.id);
      },
    );

    expect(others.length).toBeGreaterThan(1500);
    // The Page steps are in the catalog the Builder offers.
    expect(CATALOG.length - others.length).toBe(PAGE_STEP_IDS.length);

    // Each category once, as a trigger and as a step: the colour is chosen by those two.
    const seen: Set<string> = new Set<string>();

    for (const component of others) {
      const key: string = `${component.category}|${component.componentType}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const styles: string = stylesOf(dataFor(component), true);

      expect(styles).not.toContain(PINK);
      expect(styles).not.toContain(DARK_PINK);
    }

    expect(seen.size).toBeGreaterThan(100);
  });

  test("the on-call resources' own steps are database steps like any other: only the Page steps are pink", () => {
    const resourceSteps: Array<ComponentMetadata> = CATALOG.filter(
      (component: ComponentMetadata): boolean => {
        return (
          component.category !== ON_CALL_COMPONENT_CATEGORY &&
          component.category.toLowerCase().startsWith("on-call")
        );
      },
    );

    // On-Call Policy, On-Call Schedule and the rest each have steps of their own.
    expect(resourceSteps.length).toBeGreaterThan(10);

    const categories: Set<string> = new Set<string>(
      resourceSteps.map((component: ComponentMetadata): string => {
        return component.category;
      }),
    );

    expect(categories.has("On-Call Policy")).toBe(true);

    for (const category of categories) {
      const component: ComponentMetadata = resourceSteps.find(
        (candidate: ComponentMetadata): boolean => {
          return (
            candidate.category === category &&
            candidate.componentType === ComponentType.Component
          );
        },
      )!;

      const styles: string = stylesOf(dataFor(component), true);

      expect(styles).not.toContain(PINK);
      expect(styles).not.toContain(DARK_PINK);

      if (category === "On-Call Policy") {
        // The colour every database step has.
        expect(styles).toContain("linear-gradient(135deg, #6366f1, #4f46e5)");
      }
    }
  });
});
