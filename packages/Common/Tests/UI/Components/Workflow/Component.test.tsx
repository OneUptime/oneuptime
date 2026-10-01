/*
 * A step's card on the workflow canvas, and what it says about the step.
 *
 * Settings no longer open by themselves when a step is added, so the card is
 * where a builder learns a step still needs setting up. Pinned here:
 *   - "Click to set up" while required settings are empty, with which ones
 *     on hover, and no red badge for that alone;
 *   - a badge for anything else the checks found: red for an error, which
 *     also reddens the border, amber for a warning;
 *   - nothing of either in a preview, and nothing on the trigger placeholder.
 *
 * jsdom's CSS parser drops var() and color-mix() values, so the colour checks
 * read the raw style objects through react-test-renderer.
 */

import WorkflowNode, {
  WORKFLOW_NODE_SETUP_TEXT,
} from "../../../../UI/Components/Workflow/Component";
import {
  WorkflowLintTone,
  WorkflowNodeIssueSummary,
  WorkflowNodeRenderData,
} from "../../../../UI/Components/Workflow/GraphLintSummary";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

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

// Records what each tooltip would say, without Tippy's hover machinery.
jest.mock("../../../../UI/Components/Tooltip/Tooltip", () => {
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

const METADATA: ComponentMetadata = {
  id: "slack-send-message-to-channel",
  title: "Send Message to Slack",
  description: "Send message to slack channel",
  category: "Slack",
  iconProp: IconProp.Slack,
  componentType: ComponentType.Component,
  arguments: [
    {
      id: "webhook-url",
      name: "Slack Incoming Webhook URL",
      description: "Where to send it.",
      required: true,
      type: ComponentInputType.URL,
    },
    {
      id: "text",
      name: "Message Text",
      description: "What to send.",
      required: true,
      type: ComponentInputType.Markdown,
    },
  ],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "Start." }],
  outPorts: [
    { id: "success", title: "Success", description: "Sent." },
    { id: "error", title: "Error", description: "Not sent." },
  ],
};

const MISSING: Array<string> = [
  '"Slack Incoming Webhook URL" is required but empty.',
  '"Message Text" is required but empty.',
];
const UNCONNECTED: string =
  "Nothing connects to this step from the trigger, so it will never run.";
const BAD_JSON: string = '"Headers" is not valid JSON. Unexpected token.';

// What an error does to the card's border.
const RED_BORDER: string = "#fca5a5";

type SummaryFunction = (
  params: Partial<WorkflowNodeIssueSummary>,
) => WorkflowNodeIssueSummary;

const summary: SummaryFunction = (
  params: Partial<WorkflowNodeIssueSummary>,
): WorkflowNodeIssueSummary => {
  return {
    missingSettingMessages: params.missingSettingMessages || [],
    errorMessages: params.errorMessages || [],
    warningMessages: params.warningMessages || [],
  };
};

type MakeDataFunction = (
  overrides?: Partial<WorkflowNodeRenderData>,
) => WorkflowNodeRenderData;

const makeData: MakeDataFunction = (
  overrides: Partial<WorkflowNodeRenderData> = {},
): WorkflowNodeRenderData => {
  return {
    id: "slack-send-message-to-channel-1",
    internalId: "runner-1",
    nodeType: NodeType.Node,
    componentType: ComponentType.Component,
    metadataId: METADATA.id,
    metadata: METADATA,
    error: "",
    arguments: {},
    returnValues: {},
    ...overrides,
  };
};

type RenderCardFunction = (
  data: WorkflowNodeRenderData,
  selected?: boolean,
) => void;

const renderCard: RenderCardFunction = (
  data: WorkflowNodeRenderData,
  selected: boolean = false,
): void => {
  render(<WorkflowNode data={data} selected={selected} />);
};

type TooltipTextOfFunction = (element: HTMLElement) => string | null;

const tooltipTextOf: TooltipTextOfFunction = (
  element: HTMLElement,
): string | null => {
  return (
    element
      .closest('[data-testid="tooltip"]')
      ?.getAttribute("data-tooltip-text") ?? null
  );
};

type GetCardFunction = () => HTMLElement;

// The card is the outermost element the component draws.
const getCard: GetCardFunction = (): HTMLElement => {
  return screen
    .getByText(METADATA.title)
    .closest('[class="cursor-pointer"]') as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe("Workflow step card: a step that still needs setting up", () => {
  test("says Click to set up, and which settings are empty on hover", () => {
    renderCard(
      makeData({
        issueSummary: summary({ missingSettingMessages: MISSING }),
      }),
    );

    const prompt: HTMLElement = screen.getByTestId("workflow-node-setup-hint");
    expect(prompt).toHaveTextContent(WORKFLOW_NODE_SETUP_TEXT);
    expect(WORKFLOW_NODE_SETUP_TEXT).toBe("Click to set up");
    expect(tooltipTextOf(prompt)).toBe(MISSING.join("\n"));
  });

  test("an empty required setting alone draws no badge and no red border", () => {
    renderCard(
      makeData({
        issueSummary: summary({ missingSettingMessages: MISSING }),
        // The plain text still names it, as it always has; the summary wins.
        error: MISSING.join("\n"),
      }),
    );

    expect(
      screen.queryByTestId("workflow-node-issue-badge"),
    ).not.toBeInTheDocument();
    expect(getCard().style.borderColor).not.toBe(RED_BORDER);
  });

  test("a step that is also not connected gets an amber badge for that, beside the prompt", () => {
    renderCard(
      makeData({
        issueSummary: summary({
          missingSettingMessages: MISSING,
          warningMessages: [UNCONNECTED],
        }),
      }),
    );

    const badge: HTMLElement = screen.getByTestId("workflow-node-issue-badge");
    expect(badge).toHaveAttribute("data-tone", WorkflowLintTone.Warning);
    expect(tooltipTextOf(badge)).toBe(UNCONNECTED);
    expect(screen.getByTestId("workflow-node-setup-hint")).toBeInTheDocument();
    expect(getCard().style.borderColor).not.toBe(RED_BORDER);
  });

  test("the prompt sits under the step's description, inside the card", () => {
    renderCard(
      makeData({
        issueSummary: summary({ missingSettingMessages: MISSING }),
      }),
    );

    const description: HTMLElement = screen.getByText(METADATA.description);
    const prompt: HTMLElement = screen.getByTestId("workflow-node-setup-hint");

    expect(getCard()).toContainElement(prompt);
    expect(
      description.compareDocumentPosition(prompt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Workflow step card: problems the checks found", () => {
  test("an error draws a red badge and a red border", () => {
    renderCard(
      makeData({
        issueSummary: summary({ errorMessages: [BAD_JSON] }),
      }),
    );

    const badge: HTMLElement = screen.getByTestId("workflow-node-issue-badge");
    expect(badge).toHaveAttribute("data-tone", WorkflowLintTone.Error);
    expect(tooltipTextOf(badge)).toBe(BAD_JSON);
    expect(getCard().style.borderColor).toBe(RED_BORDER);
    expect(
      screen.queryByTestId("workflow-node-setup-hint"),
    ).not.toBeInTheDocument();
  });

  test("an error outranks a warning, and the badge reads the error first", () => {
    renderCard(
      makeData({
        issueSummary: summary({
          errorMessages: [BAD_JSON],
          warningMessages: [UNCONNECTED],
        }),
      }),
    );

    const badge: HTMLElement = screen.getByTestId("workflow-node-issue-badge");
    expect(badge).toHaveAttribute("data-tone", WorkflowLintTone.Error);
    expect(tooltipTextOf(badge)).toBe(`${BAD_JSON}\n${UNCONNECTED}`);
  });

  test("a warning alone leaves the border to the step's own colours", () => {
    renderCard(
      makeData({
        issueSummary: summary({ warningMessages: [UNCONNECTED] }),
      }),
      true,
    );

    expect(screen.getByTestId("workflow-node-issue-badge")).toHaveAttribute(
      "data-tone",
      WorkflowLintTone.Warning,
    );
    // Slack's notification green, as for any selected Slack step.
    expect(getCard().style.borderColor).toBe("#10b981");
  });

  test("a step can need setting up and have an error at once, and says both", () => {
    renderCard(
      makeData({
        issueSummary: summary({
          missingSettingMessages: [MISSING[1] as string],
          errorMessages: [BAD_JSON],
        }),
      }),
    );

    expect(screen.getByTestId("workflow-node-setup-hint")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-node-issue-badge")).toHaveAttribute(
      "data-tone",
      WorkflowLintTone.Error,
    );
    expect(tooltipTextOf(screen.getByTestId("workflow-node-issue-badge"))).toBe(
      BAD_JSON,
    );
  });

  test("plain error text with no summary still shows as an error", () => {
    renderCard(makeData({ error: "Something is wrong with this step." }));

    const badge: HTMLElement = screen.getByTestId("workflow-node-issue-badge");
    expect(badge).toHaveAttribute("data-tone", WorkflowLintTone.Error);
    expect(tooltipTextOf(badge)).toBe("Something is wrong with this step.");
  });

  test("a step the checks are happy with shows neither", () => {
    renderCard(makeData({ arguments: { "webhook-url": "x", text: "y" } }));

    expect(
      screen.queryByTestId("workflow-node-issue-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-node-setup-hint"),
    ).not.toBeInTheDocument();
  });
});

describe("Workflow step card: where nothing is said", () => {
  test("a preview shows no prompt and no badge", () => {
    renderCard(
      makeData({
        isPreview: true,
        issueSummary: summary({
          missingSettingMessages: MISSING,
          errorMessages: [BAD_JSON],
        }),
      }),
    );

    expect(
      screen.queryByTestId("workflow-node-setup-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-node-issue-badge"),
    ).not.toBeInTheDocument();
  });

  test("the trigger placeholder is an empty slot, not a step to set up", () => {
    renderCard(
      makeData({
        nodeType: NodeType.PlaceholderNode,
        componentType: ComponentType.Trigger,
        metadata: {
          ...METADATA,
          title: "Trigger",
          description: "Choose what starts this workflow",
          componentType: ComponentType.Trigger,
        },
        issueSummary: summary({ missingSettingMessages: MISSING }),
      }),
    );

    expect(
      screen.getByText("Choose what starts this workflow"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-node-setup-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-node-issue-badge"),
    ).not.toBeInTheDocument();
  });

  test("clicking the card still reaches a click handler handed to it", () => {
    const onClick: MockFunction = getJestMockFunction();
    renderCard(
      makeData({
        onClick: onClick as unknown as NonNullable<
          WorkflowNodeRenderData["onClick"]
        >,
        issueSummary: summary({ missingSettingMessages: MISSING }),
      }),
    );

    fireEvent.click(screen.getByTestId("workflow-node-setup-hint"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Workflow step card: colours that hold in dark mode", () => {
  type FindByTestIdFunction = (
    tree: ReactTestRenderer,
    testId: string,
  ) => ReactTestInstance;

  const findByTestId: FindByTestIdFunction = (
    tree: ReactTestRenderer,
    testId: string,
  ): ReactTestInstance => {
    return tree.root.find((instance: ReactTestInstance) => {
      return (
        typeof instance.type === "string" &&
        instance.props["data-testid"] === testId
      );
    });
  };

  test("the prompt draws on the theme's surface and text colours", () => {
    let tree: ReactTestRenderer | null = null;
    renderer.act(() => {
      tree = renderer.create(
        <WorkflowNode
          data={makeData({
            issueSummary: summary({ missingSettingMessages: MISSING }),
          })}
          selected={false}
        />,
      );
    });

    const style: React.CSSProperties = findByTestId(
      tree as unknown as ReactTestRenderer,
      "workflow-node-setup-hint",
    ).props["style"] as React.CSSProperties;

    expect(String(style.backgroundColor)).toContain("var(--ou-surface-primary");
    expect(String(style.color)).toContain("var(--ou-text-secondary");
    expect(String(style.border)).toContain("dashed");
  });

  test("both badges mix their tint into the theme's surface", () => {
    for (const issueSummary of [
      summary({ errorMessages: [BAD_JSON] }),
      summary({ warningMessages: [UNCONNECTED] }),
    ]) {
      let tree: ReactTestRenderer | null = null;
      renderer.act(() => {
        tree = renderer.create(
          <WorkflowNode
            data={makeData({ issueSummary: issueSummary })}
            selected={false}
          />,
        );
      });

      const style: React.CSSProperties = findByTestId(
        tree as unknown as ReactTestRenderer,
        "workflow-node-issue-badge",
      ).props["style"] as React.CSSProperties;

      expect(String(style.backgroundColor)).toContain(
        "var(--ou-surface-primary",
      );
    }
  });
});
