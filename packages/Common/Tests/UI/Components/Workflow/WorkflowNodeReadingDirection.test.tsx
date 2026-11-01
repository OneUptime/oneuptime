/*
 * A WORKFLOW STEP'S CARD READS THE WAY ITS WORDS ARE WRITTEN.
 *
 * A step's card on the canvas shows its name and its description from the
 * step catalogue - English - or what a set-up step does, in the reader's
 * language: "environment را با ۲ حالت مقایسه می‌کند" for a Switch / Case on a
 * Persian page, starting with the field it checks. The canvas is laid out
 * left to right in every language, and each line of a card reads the way
 * most of its words do (IsolatedText): an English description keeps its full
 * stop at its end on a Persian page, and a Persian summary reads from the
 * right though its first word is English - read by its first letter, it
 * would read left to right.
 *
 * Theme.css says how the rest of a node's lines read on a page read right to
 * left (unicode-bidi: plaintext); jsdom applies no styles, so the rule is
 * read here and Chromium's half is the ReadingDirection browser suite ("a
 * canvas").
 */

// React Flow's Handle needs the canvas's store: each dot is drawn as a plain element.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (): ReactElement => {
      return <span data-testid="handle" />;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    useNodeId: (): string => {
      return "canvas-node-1";
    },
    useUpdateNodeInternals: (): ((nodeId: string) => void) => {
      return (): void => {};
    },
  };
});

import WorkflowNode from "../../../../UI/Components/Workflow/Component";
import { WorkflowNodeRenderData } from "../../../../UI/Components/Workflow/GraphLintSummary";
import ComponentMetadata, {
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

const LOG_METADATA: ComponentMetadata = Components.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.Log;
  },
) as ComponentMetadata;

const PERSIAN_SUMMARY: string = "environment را با ۲ حالت مقایسه می‌کند";

type DataFunction = (
  metadata?: Partial<ComponentMetadata>,
) => WorkflowNodeRenderData;

const logData: DataFunction = (
  metadata: Partial<ComponentMetadata> = {},
): WorkflowNodeRenderData => {
  return {
    error: "",
    id: "log-1",
    nodeType: NodeType.Node,
    metadata: { ...LOG_METADATA, ...metadata },
    metadataId: LOG_METADATA.id,
    internalId: "log-internal",
    arguments: { value: "Checked" },
    returnValues: {},
    componentType: LOG_METADATA.componentType,
  };
};

// The isolate a card's line is drawn in.
const isolateOf: (testId: string) => Element | null = (
  testId: string,
): Element | null => {
  return screen.getByTestId(testId).querySelector("bdi");
};

// A run of white space: the stylesheet is read with each run as one space.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

// A rule that turns a node itself right to left: its card, not its words.
const NODE_TURNED_REGEX: RegExp =
  /\.react-flow__node:dir\(rtl\)[^{]*\{\s*direction:/;

const THEME_CSS: string = fs
  .readFileSync(
    path.resolve(__dirname, "../../../../UI/Styles/Theme.css"),
    "utf8",
  )
  .replace(WHITESPACE_RUN_REGEX, " ");

afterEach(() => {
  cleanup();
});

describe("a step's card", () => {
  test("its English name and description read left to right, the full stop at the end", () => {
    render(<WorkflowNode data={logData()} selected={false} />);

    expect(isolateOf("workflow-node-title")).toHaveAttribute("dir", "ltr");
    expect(isolateOf("workflow-node-title")).toHaveTextContent(
      LOG_METADATA.title,
    );

    const description: Element | null = isolateOf("workflow-node-description");

    expect(description).toHaveAttribute("dir", "ltr");
    expect(description?.textContent).toBe(LOG_METADATA.description);
    expect(LOG_METADATA.description.endsWith(".")).toBe(true);
  });

  test("a Persian line that starts with an English word reads right to left, by most of its words", () => {
    render(
      <WorkflowNode
        data={logData({ title: "ثبت در گزارش", description: PERSIAN_SUMMARY })}
        selected={false}
      />,
    );

    expect(isolateOf("workflow-node-title")).toHaveAttribute("dir", "rtl");
    expect(isolateOf("workflow-node-description")).toHaveAttribute(
      "dir",
      "rtl",
    );
    expect(isolateOf("workflow-node-description")?.textContent).toBe(
      PERSIAN_SUMMARY,
    );
  });

  test("its name stays whole under the pointer", () => {
    render(<WorkflowNode data={logData()} selected={false} />);

    expect(screen.getByTestId("workflow-node-title")).toHaveAttribute(
      "title",
      LOG_METADATA.title,
    );
  });
});

describe("Theme.css", () => {
  test("on a page read right to left a node's lines read their own way, and a card that says its way is left to it", () => {
    const rule: string =
      THEME_CSS.split(
        ".react-flow__node:dir(rtl), .react-flow__node:dir(rtl) :not([dir], .react-flow__node [dir] *), .react-flow__edgelabel-renderer:dir(rtl) :not([dir], .react-flow__edgelabel-renderer [dir] *) {",
      )[1]?.split("}")[0] || "";

    expect(rule).toContain("unicode-bidi: plaintext;");
  });

  test("a node is laid out as its canvas is: its words never turn the card round", () => {
    expect(THEME_CSS).not.toContain(".react-flow__node:dir(rtl) {");
    expect(THEME_CSS).not.toMatch(NODE_TURNED_REGEX);
  });

  test("the panels over the canvas read the page's way", () => {
    expect(THEME_CSS).toContain(
      ".react-flow__panel:dir(rtl) { direction: rtl; }",
    );
  });
});
