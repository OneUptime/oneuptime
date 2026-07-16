import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/*
 * Flattens markdown into a small list of drawable blocks.
 *
 * The PDF exporter cannot use the chat's React markdown renderer, but it should
 * not hand-roll a markdown parser either — that is how exports end up rendering
 * a code fence as bold text. So the same parser the chat uses (remark + GFM)
 * produces the tree, and this module lowers it into a shape a drawing routine
 * can consume without knowing anything about mdast.
 *
 * Only the constructs an assistant answer actually produces are modelled.
 * Anything unrecognized degrades to its text content rather than disappearing.
 */

export enum MarkdownBlockType {
  Heading = "Heading",
  Paragraph = "Paragraph",
  ListItem = "ListItem",
  Code = "Code",
  Quote = "Quote",
  Table = "Table",
  Rule = "Rule",
}

export interface MarkdownInline {
  text: string;
  isBold?: boolean | undefined;
  isItalic?: boolean | undefined;
  isCode?: boolean | undefined;
  isStrikethrough?: boolean | undefined;
}

export interface MarkdownBlock {
  type: MarkdownBlockType;
  // Heading level 1-6.
  level?: number | undefined;
  inlines?: Array<MarkdownInline> | undefined;
  // Code blocks.
  code?: string | undefined;
  language?: string | undefined;
  // List items.
  indent?: number | undefined;
  marker?: string | undefined;
  // Tables.
  headers?: Array<string> | undefined;
  rows?: Array<Array<string>> | undefined;
  alignments?: Array<"left" | "right" | "center"> | undefined;
}

interface MarkdownNode {
  type: string;
  value?: string | undefined;
  lang?: string | undefined;
  depth?: number | undefined;
  ordered?: boolean | undefined;
  start?: number | null | undefined;
  align?: Array<string | null> | undefined;
  children?: Array<MarkdownNode> | undefined;
}

interface InlineStyle {
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  isStrikethrough: boolean;
}

const BASE_STYLE: InlineStyle = {
  isBold: false,
  isItalic: false,
  isCode: false,
  isStrikethrough: false,
};

function collectInlines(
  nodes: Array<MarkdownNode>,
  style: InlineStyle,
  into: Array<MarkdownInline>,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (node.value) {
          into.push({
            text: node.value,
            isBold: style.isBold,
            isItalic: style.isItalic,
            isStrikethrough: style.isStrikethrough,
          });
        }
        break;

      case "inlineCode":
        into.push({
          text: node.value || "",
          isCode: true,
          isBold: style.isBold,
          isItalic: style.isItalic,
        });
        break;

      case "strong":
        collectInlines(node.children || [], { ...style, isBold: true }, into);
        break;

      case "emphasis":
        collectInlines(node.children || [], { ...style, isItalic: true }, into);
        break;

      case "delete":
        collectInlines(
          node.children || [],
          { ...style, isStrikethrough: true },
          into,
        );
        break;

      case "break":
        into.push({ text: "\n" });
        break;

      /*
       * Links and images should already have been rewritten into text by the
       * neutralizer before this runs. If one survives, keep its text and drop
       * the destination rather than carrying a live URL forward.
       */
      case "link":
      case "image":
      case "linkReference":
      case "imageReference":
        collectInlines(node.children || [], style, into);
        break;

      default:
        if (node.children) {
          collectInlines(node.children, style, into);
        } else if (node.value) {
          into.push({ text: node.value, isBold: style.isBold });
        }
        break;
    }
  }
}

function inlinesOf(nodes: Array<MarkdownNode>): Array<MarkdownInline> {
  const inlines: Array<MarkdownInline> = [];
  collectInlines(nodes, BASE_STYLE, inlines);
  return inlines;
}

function plainTextOf(nodes: Array<MarkdownNode>): string {
  return inlinesOf(nodes)
    .map((inline: MarkdownInline) => {
      return inline.text;
    })
    .join("");
}

function tableToBlock(node: MarkdownNode): MarkdownBlock {
  const rows: Array<Array<string>> = (node.children || []).map(
    (row: MarkdownNode) => {
      return (row.children || []).map((cell: MarkdownNode) => {
        return plainTextOf(cell.children || []);
      });
    },
  );

  const headers: Array<string> =
    rows.length > 0 ? (rows[0] as Array<string>) : [];

  const alignments: Array<"left" | "right" | "center"> = (node.align || []).map(
    (align: string | null) => {
      if (align === "right") {
        return "right";
      }
      if (align === "center") {
        return "center";
      }
      return "left";
    },
  );

  return {
    type: MarkdownBlockType.Table,
    headers: headers,
    rows: rows.slice(1),
    alignments: alignments,
  };
}

function flattenList(
  node: MarkdownNode,
  indent: number,
  into: Array<MarkdownBlock>,
): void {
  const isOrdered: boolean = node.ordered === true;
  let counter: number = typeof node.start === "number" ? node.start : 1;

  for (const item of node.children || []) {
    const inlines: Array<MarkdownInline> = [];
    const nested: Array<MarkdownBlock> = [];

    for (const child of item.children || []) {
      if (child.type === "list") {
        flattenList(child, indent + 1, nested);
      } else if (child.type === "paragraph") {
        // Multiple paragraphs in one item are joined by a soft break.
        if (inlines.length > 0) {
          inlines.push({ text: "\n" });
        }
        collectInlines(child.children || [], BASE_STYLE, inlines);
      } else {
        toBlocks(child, nested, indent + 1);
      }
    }

    into.push({
      type: MarkdownBlockType.ListItem,
      inlines: inlines,
      indent: indent,
      marker: isOrdered ? `${counter}.` : "-",
    });
    into.push(...nested);

    counter++;
  }
}

function toBlocks(
  node: MarkdownNode,
  into: Array<MarkdownBlock>,
  indent: number = 0,
): void {
  switch (node.type) {
    case "heading":
      into.push({
        type: MarkdownBlockType.Heading,
        level: node.depth || 1,
        inlines: inlinesOf(node.children || []),
      });
      break;

    case "paragraph":
      into.push({
        type: MarkdownBlockType.Paragraph,
        inlines: inlinesOf(node.children || []),
        indent: indent,
      });
      break;

    case "list":
      flattenList(node, indent, into);
      break;

    case "code":
      into.push({
        type: MarkdownBlockType.Code,
        code: node.value || "",
        language: node.lang || "",
      });
      break;

    case "blockquote":
      for (const child of node.children || []) {
        const quoted: Array<MarkdownBlock> = [];
        toBlocks(child, quoted, indent);
        for (const block of quoted) {
          into.push({ ...block, type: MarkdownBlockType.Quote });
        }
      }
      break;

    case "table":
      into.push(tableToBlock(node));
      break;

    case "thematicBreak":
      into.push({ type: MarkdownBlockType.Rule });
      break;

    case "html":
      // Raw HTML is inert text here; show it rather than silently dropping it.
      if (node.value) {
        into.push({
          type: MarkdownBlockType.Paragraph,
          inlines: [{ text: node.value }],
          indent: indent,
        });
      }
      break;

    default:
      if (node.children) {
        for (const child of node.children) {
          toBlocks(child, into, indent);
        }
      }
      break;
  }
}

export default function parseMarkdownBlocks(
  text: string,
): Array<MarkdownBlock> {
  if (!text) {
    return [];
  }

  try {
    const tree: MarkdownNode = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .parse(text) as unknown as MarkdownNode;

    const blocks: Array<MarkdownBlock> = [];
    for (const child of tree.children || []) {
      toBlocks(child, blocks);
    }
    return blocks;
  } catch {
    // A parse failure should still show the answer, just without formatting.
    return [{ type: MarkdownBlockType.Paragraph, inlines: [{ text: text }] }];
  }
}
