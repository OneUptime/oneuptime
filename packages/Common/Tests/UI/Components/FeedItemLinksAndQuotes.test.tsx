/*
 * Links and quotes in a feed entry, as the incident, alert, episode and
 * maintenance feeds draw them.
 *
 * The maintainer's screenshots: a private note saved from Slack, whose
 * "📎 image.png" link took over the OneUptime tab, and a quote in a note,
 * drawn with an amber exclamation mark. Here a FeedItem renders through the
 * real MarkdownViewer (LazyMarkdownViewer resolved at once) and its real
 * renderers and remark plugins. react-markdown does not run under Common's
 * jest, so a small stand-in reads the few things these entries are made
 * of - paragraphs, "> " quotes, [links](...) - into the tree remark would
 * build; the real parser draws the same entries in a browser in
 * packages/E2E/EventOverview (?feed=links-and-quotes).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual(
        "../../../UI/Components/Markdown.tsx/MarkdownViewer",
      ) as { default: unknown }
    ).default,
  };
});

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: MockReactMarkdownProps): React.ReactElement => {
      return renderMockMarkdown(props);
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import FeedItem, { FeedItemProps } from "../../../UI/Components/Feed/FeedItem";
import { FeedTimelineEntry } from "../../../UI/Components/Feed/FeedTimeline";
import { CalloutMarkdownNode } from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  MARKDOWN_QUOTED_TEXT_CLASS_NAME,
  MARKDOWN_QUOTE_CLASS_NAME,
} from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import { Blue500 } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

type Node = CalloutMarkdownNode;
type MockComponentMap = Record<string, React.ElementType>;

interface MockReactMarkdownProps {
  children?: string;
  components?: MockComponentMap;
  remarkPlugins?: Array<unknown>;
}

const MOCK_LINK: RegExp = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const MOCK_QUOTE_PREFIX: RegExp = /^> ?/;

// "[words](address)" in a text, as remark's link nodes.
function mockInlines(text: string): Array<Node> {
  const nodes: Array<Node> = [];
  let cursor: number = 0;

  for (const match of text.matchAll(MOCK_LINK)) {
    const start: number = match.index || 0;

    if (start > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, start) });
    }

    nodes.push({
      type: "link",
      url: match[2],
      children: [{ type: "text", value: match[1] }],
    });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push({ type: "text", value: text.slice(cursor) });
  }

  return nodes;
}

// Paragraphs and "> " quotes, as remark reads them.
function mockParse(markdown: string): Node {
  const blocks: Array<string> = markdown
    .split("\n\n")
    .filter((block: string): boolean => {
      return block.trim() !== "";
    });

  return {
    type: "root",
    children: blocks.map((block: string): Node => {
      const lines: Array<string> = block.split("\n");

      if (
        lines.every((line: string): boolean => {
          return line.startsWith(">");
        })
      ) {
        const quoted: string = lines
          .map((line: string): string => {
            return line.replace(MOCK_QUOTE_PREFIX, "");
          })
          .join("\n");

        return {
          type: "blockquote",
          children: [{ type: "paragraph", children: mockInlines(quoted) }],
        };
      }

      return { type: "paragraph", children: mockInlines(block) };
    }),
  };
}

function runMockPlugins(plugins: Array<unknown>, tree: Node): void {
  for (const plugin of plugins) {
    const attacher: unknown = Array.isArray(plugin) ? plugin[0] : plugin;
    const parameters: Array<unknown> = Array.isArray(plugin)
      ? plugin.slice(1)
      : [];
    const transformer: unknown =
      typeof attacher === "function"
        ? (attacher as (...args: Array<unknown>) => unknown)(...parameters)
        : undefined;

    if (typeof transformer === "function") {
      (transformer as (node: Node) => void)(tree);
    }
  }
}

const MOCK_TAG_BY_NODE_TYPE: Record<string, string> = {
  paragraph: "p",
  link: "a",
  blockquote: "blockquote",
};

function renderMockNode(
  node: Node,
  components: MockComponentMap,
  key: number,
): React.ReactNode {
  if (node.type === "text") {
    return node.value || "";
  }

  const tagName: string = MOCK_TAG_BY_NODE_TYPE[node.type] || "span";
  const component: React.ElementType = (components[tagName] ||
    tagName) as React.ElementType;
  const props: Record<string, unknown> = { key: key };

  if (typeof component !== "string") {
    props["node"] = node;
  }

  for (const [name, value] of Object.entries(node.data?.hProperties || {})) {
    props[
      name.replace(/[A-Z]/g, (letter: string): string => {
        return `-${letter.toLowerCase()}`;
      })
    ] = value;
  }

  if (node.type === "link") {
    props["href"] = node["url"];
  }

  return React.createElement(
    component,
    props,
    ...(node.children || []).map((child: Node, index: number) => {
      return renderMockNode(child, components, index);
    }),
  );
}

function renderMockMarkdown(props: MockReactMarkdownProps): ReactElement {
  const tree: Node = mockParse(props.children || "");
  runMockPlugins(props.remarkPlugins || [], tree);

  return React.createElement(
    React.Fragment,
    {},
    ...(tree.children || []).map((child: Node, index: number) => {
      return renderMockNode(child, props.components || {}, index);
    }),
  );
}

/*
 * ---------------------------------------------------------------------------
 * Entries
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11";
const INCIDENT_LINK: string = `/dashboard/${PROJECT_ID}/incidents/9a3c0f6e-2b1d-4c5e-8f7a-1d2e3f4a5b6c`;
const SLACK_FILE: string =
  "https://acme.slack.com/files/U0123ABCD/F0123ABCD/image.png";
const ATTACHMENT: string = `/api/incident-internal-note/attachment/${PROJECT_ID}/0c2f1b0a-7d11-4e8f-9a3c-0f6e2b1d4c5e/1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a`;

const nitin: () => User = (): User => {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.name = new Name("Nitin Kumar");
  return user;
};

const entry: (item: FeedItemProps) => FeedTimelineEntry<FeedItemProps> = (
  item: FeedItemProps,
): FeedTimelineEntry<FeedItemProps> => {
  return {
    item,
    time: {
      label: "3:25 PM",
      isShown: true,
      fullLabel: "Tuesday, October 13, 2026 at 3:25:00 PM UTC",
      isoString: "2026-10-13T15:25:00.000Z",
    },
    isInBurst: false,
  };
};

const renderNote: (
  textInMarkdown: string,
  extra?: Partial<FeedItemProps>,
) => void = (textInMarkdown: string, extra?: Partial<FeedItemProps>): void => {
  render(
    <ul>
      <FeedItem
        entry={entry({
          key: "note",
          textInMarkdown: textInMarkdown,
          itemDateTime: new Date("2026-10-13T15:25:00.000Z"),
          icon: IconProp.Lock,
          color: Blue500,
          user: nitin(),
          isNote: true,
          ...(extra || {}),
        })}
        isLastInDay={true}
      />
    </ul>,
  );
};

beforeEach(() => {
  // The incident page the feed is on.
  window.history.pushState({}, "", INCIDENT_LINK);
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("a note in the feed", () => {
  test("saved from Slack: the file it carried opens in a new tab (the maintainer's first screenshot)", () => {
    renderNote(
      `📄 posted **private note** for this [Incident INC-8](${INCIDENT_LINK}):\n\n📎 [image.png](${SLACK_FILE})`,
    );

    const card: HTMLElement = screen.getByTestId("feed-entry-body");
    const fileLink: HTMLElement = within(card).getByRole("link", {
      name: "image.png",
    });

    expect(card).toHaveAttribute("data-note", "true");
    expect(fileLink).toHaveAttribute("href", SLACK_FILE);
    expect(fileLink).toHaveAttribute("target", "_blank");
    expect(fileLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(fileLink).toHaveAttribute("aria-description", "Opens in a new tab");
  });

  test("the incident it names stays in the tab", () => {
    renderNote(
      `📄 posted **private note** for this [Incident INC-8](${INCIDENT_LINK}):\n\nRolling back now.`,
    );

    const incident: HTMLElement = within(
      screen.getByTestId("feed-entry-lead"),
    ).getByRole("link", { name: "Incident INC-8" });

    expect(incident).toHaveAttribute("href", INCIDENT_LINK);
    expect(incident).not.toHaveAttribute("target");
    expect(incident).not.toHaveAttribute("rel");
  });

  test("its attachment opens in a new tab", () => {
    renderNote(
      `📄 posted **private note** for this [Incident INC-8](${INCIDENT_LINK}):\n\nRolled back.\n\n- [runbook.pdf](${ATTACHMENT})`,
    );

    const attachment: HTMLElement = screen.getByRole("link", {
      name: "runbook.pdf",
    });

    expect(attachment).toHaveAttribute("target", "_blank");
    expect(attachment).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("a quote in it is a quote, with no warning sign (the maintainer's second screenshot)", () => {
    renderNote(
      `📄 posted **private note** for this [Incident INC-8](${INCIDENT_LINK}):\n\n> They said something`,
    );

    const card: HTMLElement = screen.getByTestId("feed-entry-body");
    const quote: HTMLElement = card.querySelector("blockquote") as HTMLElement;

    expect(quote).not.toBeNull();
    expect(quote.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(quote).toHaveTextContent(/^They said something$/);
    expect(quote.querySelector("svg")).toBeNull();
    expect(quote).not.toHaveAttribute("role");
    expect(within(quote).getByText("They said something")).toHaveClass(
      MARKDOWN_QUOTED_TEXT_CLASS_NAME,
    );
    expect(within(card).queryByRole("note")).toBeNull();
  });

  test("a callout in it is one", () => {
    renderNote(
      `📄 posted **private note** for this [Incident INC-8](${INCIDENT_LINK}):\n\n> [!WARNING]\n> Do not restart the primary.`,
    );

    const callout: HTMLElement = within(
      screen.getByTestId("feed-entry-body"),
    ).getByRole("note", { name: "Warning" });

    expect(callout).toHaveTextContent(/^Do not restart the primary\.$/);
  });
});

describe("an AI entry, in safe mode", () => {
  test("a quote is a quote, and a link opens nothing", () => {
    render(
      <ul>
        <FeedItem
          entry={entry({
            key: "ai",
            textInMarkdown: `> The pool ran dry\n\nSee [the vendor](${SLACK_FILE}).`,
            itemDateTime: new Date("2026-10-13T15:25:00.000Z"),
            icon: IconProp.Sparkles,
            color: Blue500,
            safeMode: true,
          })}
          isLastInDay={true}
        />
      </ul>,
    );

    const quote: HTMLElement = screen
      .getByText("The pool ran dry")
      .closest("blockquote") as HTMLElement;

    expect(quote.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(quote.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("the vendor")).not.toHaveAttribute("target");
  });
});
