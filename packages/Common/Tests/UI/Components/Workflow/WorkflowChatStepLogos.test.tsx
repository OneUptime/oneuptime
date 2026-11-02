/*
 * Official logos audit: a workflow step that talks to a chat product - Send
 * Message to Slack, to Discord, to Microsoft Teams, to Telegram, to
 * Mattermost - shows that product's official mark, in the Add Component
 * picker and on the step's card on the canvas, where all five used to share
 * one paper-plane icon. Every other step keeps its icon.
 *
 * Since icons-svg-one-color the mark is drawn exactly where and as the icon
 * is: in the picker's grey icon box, in the canvas header's white on its
 * translucent tile - one colour, inline, so a chat step sits among the
 * other steps as one of them instead of on a white tile of its own.
 */

import WorkflowNode from "../../../../UI/Components/Workflow/Component";
import {
  ComponentTile,
  IconBox,
} from "../../../../UI/Components/Workflow/ComponentPicker/PickerItems";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import ComponentMetadata, {
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import Components from "../../../../Types/Workflow/Components";
import IconProp from "../../../../Types/Icon/IconProp";
import ProviderLogo from "../../../../Types/ProviderLogo/ProviderLogo";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  getDrawnMark,
  getDrawnPathData,
  getMarkPathData,
  preloadProviderLogoMarks,
} from "../../../Helpers/ProviderLogoMarks";

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
    useNodeId: (): string => {
      return "canvas-node";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return (): void => {};
    },
  };
});

jest.mock("../../../../UI/Components/Tooltip/Tooltip", () => {
  return {
    __esModule: true,
    default: (props: { children: ReactElement }) => {
      return props.children;
    },
  };
});

beforeAll(async (): Promise<void> => {
  await preloadProviderLogoMarks();
});

afterEach(() => {
  cleanup();
});

const CHAT_STEPS: Array<{ title: string; logo: ProviderLogo }> = [
  { title: "Send Message to Slack", logo: ProviderLogo.Slack },
  { title: "Send Message to Discord", logo: ProviderLogo.Discord },
  { title: "Send Message to Teams", logo: ProviderLogo.MicrosoftTeams },
  { title: "Send Message to Telegram", logo: ProviderLogo.Telegram },
  { title: "Send Message to Mattermost", logo: ProviderLogo.Mattermost },
];

function stepTitled(title: string): ComponentMetadata {
  const step: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.title === title;
    },
  );

  if (!step) {
    throw new Error(`No step titled ${title}`);
  }

  return step;
}

// A step with no product of its own: run JavaScript, call an API.
function genericStep(): ComponentMetadata {
  const step: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return (
        !component.logo && component.componentType === ComponentType.Component
      );
    },
  );

  if (!step) {
    throw new Error("No generic step");
  }

  return step;
}

function nodeData(metadata: ComponentMetadata): WorkflowNodeRenderData {
  return {
    id: `${metadata.id}-1`,
    internalId: "runner-1",
    nodeType: NodeType.Node,
    componentType: metadata.componentType,
    metadataId: metadata.id,
    metadata,
    error: "",
    arguments: {},
    returnValues: {},
  };
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

describe("the Add Component picker's tiles", () => {
  test.each(CHAT_STEPS)(
    "$title shows its product's mark in the step's grey icon box, decorative: the tile's words name it",
    (step: { title: string; logo: ProviderLogo }) => {
      const { container } = render(
        <ComponentTile
          componentMetadata={stepTitled(step.title)}
          onSelect={(): void => {}}
        />,
      );

      const logo: Element | null = container.querySelector(
        "[data-provider-logo]",
      );

      expect(logo).toHaveAttribute("data-provider-logo", step.logo);
      expect(logo).toHaveAttribute("aria-hidden", "true");
      // Bare, in the colour of the box every step's icon sits in.
      expect(classesOf(logo!)).toContain("text-current");
      expect(classesOf(logo!)).not.toContain("ring-1");
      expect(classesOf(logo!.parentElement!)).toEqual(
        expect.arrayContaining(["bg-gray-100", "text-gray-600", "h-9", "w-9"]),
      );
      expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
        getMarkPathData(step.logo),
      );
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByRole("button")).toHaveTextContent(step.title);
    },
  );

  test("a chat step's box is a generic step's box", () => {
    const { container: chat } = render(
      <ComponentTile
        componentMetadata={stepTitled("Send Message to Slack")}
        onSelect={(): void => {}}
      />,
    );
    const chatBox: string =
      chat.querySelector("[data-provider-logo]")!.parentElement!.className;

    cleanup();

    const { container: generic } = render(
      <ComponentTile
        componentMetadata={genericStep()}
        onSelect={(): void => {}}
      />,
    );
    const genericBox: string =
      generic.querySelector("svg")!.closest("div[aria-hidden='true']")!
        .className;

    expect(chatBox).toBe(genericBox);
  });

  test("a step with no product keeps its icon", () => {
    const { container } = render(
      <ComponentTile
        componentMetadata={genericStep()}
        onSelect={(): void => {}}
      />,
    );

    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("no two chat products' tiles look alike any more", () => {
    const logos: Array<string> = CHAT_STEPS.map(
      (step: { title: string; logo: ProviderLogo }): string => {
        const { container, unmount } = render(
          <ComponentTile
            componentMetadata={stepTitled(step.title)}
            onSelect={(): void => {}}
          />,
        );
        const logo: string =
          container
            .querySelector("[data-provider-logo]")
            ?.getAttribute("data-provider-logo") || "";
        unmount();
        return logo;
      },
    );

    expect(new Set(logos).size).toBe(CHAT_STEPS.length);
  });
});

describe("the picker's icon box", () => {
  test.each([
    ["small", "h-7", 14],
    ["regular", "h-9", 16],
    ["large", "h-11", 20],
  ] as Array<["small" | "regular" | "large", string, number]>)(
    "a %s box (%s) holds a mark as large as its icon (%ipx)",
    (size: "small" | "regular" | "large", box: string, pixels: number) => {
      const { container } = render(
        <IconBox icon={IconProp.SendMessage} logo={ProviderLogo.Slack} size={size} />,
      );
      const logo: Element = container.querySelector("[data-provider-logo]")!;

      expect(classesOf(logo.parentElement!)).toContain(box);
      expect(getDrawnMark(logo)).toHaveAttribute("height", String(pixels));
    },
  );

  test("without a logo it is the icon box it was", () => {
    const { container } = render(<IconBox icon={IconProp.SendMessage} />);

    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("the step's card on the canvas", () => {
  test.each(CHAT_STEPS)(
    "$title shows its product's mark in its header, in the header's icon colour",
    (step: { title: string; logo: ProviderLogo }) => {
      const { container } = render(
        <WorkflowNode data={nodeData(stepTitled(step.title))} selected={false} />,
      );

      const logo: Element | null = container.querySelector(
        "[data-provider-logo]",
      );
      const holder: HTMLElement = container.querySelector(
        "[data-testid='workflow-node-mark']",
      ) as HTMLElement;

      expect(logo).toHaveAttribute("data-provider-logo", step.logo);
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(classesOf(logo!)).toContain("text-current");
      // The header's icon colour, on the translucent tile every step's icon has.
      expect(holder.style.color).toBe("rgb(255, 255, 255)");
      expect(holder.parentElement!.style.backgroundColor).toBe(
        "rgba(255, 255, 255, 0.2)",
      );
      expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
        getMarkPathData(step.logo),
      );
      expect(container).toHaveTextContent(step.title);
    },
  );

  test("a step with no product draws its icon, and no logo", () => {
    const step: ComponentMetadata = genericStep();
    const { container } = render(
      <WorkflowNode data={nodeData(step)} selected={false} />,
    );

    expect(container.querySelector("[data-provider-logo]")).toBeNull();
    expect(container).toHaveTextContent(step.title);
  });
});
