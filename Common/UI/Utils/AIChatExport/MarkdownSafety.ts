import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/*
 * Neutralizes the exfiltration channels in assistant markdown before it is
 * written to an exported file.
 *
 * The chat UI already does this on screen: SafeChatMarkdown renders through
 * MarkdownViewer in safeMode, which drops every href and never emits an <img>.
 * The reason is that an assistant answer is derived from attacker-influenceable
 * telemetry (a log body or exception message can carry markdown), so a
 * prompt-injected response must not be able to render a tracking pixel or hand
 * the reader a clickable exfil URL. An export that turned those back into live
 * links would reopen that hole in a file that then gets shared around, so the
 * exports hold the same line.
 *
 * Unlike the on-screen path we keep the URL visible — a reader auditing a
 * transcript should be able to see where a link pointed — but only ever as
 * inert text. In markdown that means wrapping it in a code span: a bare URL in
 * a .md file would otherwise be turned back into a live link by GFM's autolink
 * literals, which is precisely what we are trying to prevent.
 *
 * This works on the PARSED tree rather than by regex over the raw string, for
 * the same reason MarkdownViewer does: no CommonMark edge case (reference
 * links, autolinks, raw HTML, nesting) can slip a link past a parser, whereas
 * regexes miss those forms routinely.
 */

/*
 * A structural view of the mdast nodes we touch. Declared locally rather than
 * imported from @types/mdast: the version hoisted into Common/node_modules is
 * v3 (pulled in by slackify-markdown's old unified 9 tree) while the mdast-util
 * packages here expect v4, so importing those types would fight the resolver
 * for no benefit.
 */
interface MarkdownNode {
  type: string;
  value?: string | undefined;
  url?: string | undefined;
  alt?: string | null | undefined;
  identifier?: string | undefined;
  children?: Array<MarkdownNode> | undefined;
}

type MarkdownRoot = Parameters<typeof toMarkdown>[0];

// Node types that may only appear inside a block, never directly under the root.
const PHRASING_TYPES: Set<string> = new Set(["text", "inlineCode"]);

function textNode(value: string): MarkdownNode {
  return { type: "text", value: value };
}

function codeNode(value: string): MarkdownNode {
  return { type: "inlineCode", value: value };
}

// The visible text of a subtree, used to decide whether a label adds anything.
function textOf(nodes: Array<MarkdownNode>): string {
  return nodes
    .map((node: MarkdownNode) => {
      if (node.type === "text" || node.type === "inlineCode") {
        return node.value || "";
      }
      return node.children ? textOf(node.children) : "";
    })
    .join("");
}

/*
 * "label (`url`)" — or just "`url`" when the label is only a repeat of the URL,
 * which is what an autolink or a GFM bare URL parses into.
 */
function inertLink(
  label: Array<MarkdownNode>,
  url: string,
): Array<MarkdownNode> {
  const labelText: string = textOf(label);
  const hasDistinctLabel: boolean = Boolean(labelText) && labelText !== url;

  if (!url) {
    return hasDistinctLabel ? label : [textNode(labelText)];
  }

  if (!hasDistinctLabel) {
    return [codeNode(url)];
  }

  return [...label, textNode(" ("), codeNode(url), textNode(")")];
}

function neutralizeNode(
  node: MarkdownNode,
  definitions: Map<string, string>,
  isRootChild: boolean,
): Array<MarkdownNode> {
  // Depth first, so a link nested inside emphasis is rewritten before its parent.
  if (node.children) {
    const rewritten: Array<MarkdownNode> = [];
    for (const child of node.children) {
      rewritten.push(...neutralizeNode(child, definitions, false));
    }
    node.children = rewritten;
  }

  const identifier: string = (node.identifier || "").toLowerCase();

  switch (node.type) {
    /*
     * Drop link definitions outright. Their referents have already been
     * inlined below, and leaving a definition behind would let "[x][ref]"
     * resolve to a live link again.
     */
    case "definition":
      return [];

    /*
     * Raw HTML is inert on screen (react-markdown does not render it without
     * rehype-raw), but a .md file is rendered by viewers that do, where an
     * <img src> or <a href> would be live. Demote it to text — toMarkdown
     * escapes the angle brackets on the way out.
     */
    case "html": {
      const asText: MarkdownNode = textNode(node.value || "");
      return isRootChild
        ? [{ type: "paragraph", children: [asText] }]
        : [asText];
    }

    case "link":
      return inertLink(node.children || [], node.url || "");

    case "image":
      return inertLink(
        [textNode(`[image: ${node.alt || ""}]`)],
        node.url || "",
      );

    case "linkReference":
      return inertLink(node.children || [], definitions.get(identifier) || "");

    case "imageReference":
      return inertLink(
        [textNode(`[image: ${node.alt || ""}]`)],
        definitions.get(identifier) || "",
      );

    default:
      return [node];
  }
}

function collectDefinitions(
  node: MarkdownNode,
  into: Map<string, string>,
): void {
  if (node.type === "definition" && node.identifier) {
    into.set(node.identifier.toLowerCase(), node.url || "");
  }
  for (const child of node.children || []) {
    collectDefinitions(child, into);
  }
}

/*
 * Rewrites every link, image and raw HTML node in `text` into inert text, and
 * returns the result as markdown. Safe to call on any string; a parse failure
 * degrades to a fenced code block rather than emitting unneutralized markdown.
 */
export default function neutralizeAssistantMarkdown(text: string): string {
  if (!text) {
    return "";
  }

  try {
    const tree: MarkdownNode = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(text) as unknown as MarkdownNode;

    const definitions: Map<string, string> = new Map();
    collectDefinitions(tree, definitions);

    const children: Array<MarkdownNode> = [];
    for (const child of tree.children || []) {
      children.push(...neutralizeNode(child, definitions, true));
    }

    /*
     * A root child demoted to phrasing (a stray inline node left behind once
     * its link wrapper was removed) is not valid at root level; wrap it back
     * into a paragraph so the serializer stays on its typed path.
     */
    tree.children = children.map((child: MarkdownNode) => {
      return PHRASING_TYPES.has(child.type)
        ? { type: "paragraph", children: [child] }
        : child;
    });

    return toMarkdown(tree as unknown as MarkdownRoot, {
      extensions: [gfmToMarkdown()],
      bullet: "-",
    }).trim();
  } catch {
    /*
     * Never fall back to returning the raw string: that would ship exactly the
     * live links this function exists to remove. A fence renders the content
     * verbatim and inert.
     */
    return ["```", text.replace(/```/g, "'''"), "```"].join("\n");
  }
}
