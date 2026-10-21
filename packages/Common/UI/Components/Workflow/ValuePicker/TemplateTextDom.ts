/*
 * The reference editor's DOM, and the stored string it stands for.
 *
 * The editor is a contenteditable element holding text nodes and reference
 * chips (see ReferenceChip), and nothing else when it is tidy. What it stores
 * is the string those spell: each text node's text and each chip's reference,
 * in order. Line breaks are "\n" characters in the text, drawn by
 * `white-space: pre-wrap`; a value ending in one gets a <br> after it, the only
 * way a browser draws an empty last line, which counts for nothing.
 *
 * A browser editing the element can leave other things behind - a <div> per
 * line, a <br>, a <span> it wrapped text in. serializeTemplateEditor reads
 * those the way they are drawn, so nothing typed is lost, and the editor then
 * draws the value again from scratch (isTemplateDomTidy says when).
 *
 * Offsets everywhere are offsets into the stored string: a chip is as long as
 * its reference, and the caret is either side of it, never inside.
 */

import { CHIP_REFERENCE_ATTRIBUTE } from "./ReferenceChip";
import {
  TemplateSegment,
  TemplateSegmentKind,
  splitTemplateText,
} from "./TemplateText";

/** Marks the <br> that draws an empty last line. */
export const LINE_END_ATTRIBUTE: string = "data-template-line-end";

const BLOCK_ELEMENTS: Array<string> = [
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
];

const TEXT_NODE: number = 3;
const ELEMENT_NODE: number = 1;

export type BuildChipFunction = (reference: string) => HTMLElement;

type IsChipFunction = (node: Node | null) => boolean;

export const isChipNode: IsChipFunction = (node: Node | null): boolean => {
  return Boolean(
    node &&
      node.nodeType === ELEMENT_NODE &&
      (node as HTMLElement).hasAttribute(CHIP_REFERENCE_ATTRIBUTE),
  );
};

type IsLineEndFunction = (node: Node | null) => boolean;

const isLineEnd: IsLineEndFunction = (node: Node | null): boolean => {
  return Boolean(
    node &&
      node.nodeType === ELEMENT_NODE &&
      node.nodeName === "BR" &&
      (node as HTMLElement).hasAttribute(LINE_END_ATTRIBUTE),
  );
};

export type ChipAncestorFunction = (
  root: HTMLElement,
  node: Node | null,
) => HTMLElement | null;

/** The chip `node` sits in, if any. */
export const chipAncestor: ChipAncestorFunction = (
  root: HTMLElement,
  node: Node | null,
): HTMLElement | null => {
  let current: Node | null = node;

  while (current && current !== root) {
    if (isChipNode(current)) {
      return current as HTMLElement;
    }

    current = current.parentNode;
  }

  return null;
};

export type RenderTemplateValueFunction = (
  root: HTMLElement,
  value: string,
  buildChip: BuildChipFunction,
) => void;

/** Draw `value` into the editor, replacing whatever it held. */
export const renderTemplateValue: RenderTemplateValueFunction = (
  root: HTMLElement,
  value: string,
  buildChip: BuildChipFunction,
): void => {
  const ownerDocument: Document = root.ownerDocument;

  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  for (const segment of splitTemplateText(value)) {
    root.appendChild(
      segment.kind === TemplateSegmentKind.Reference
        ? buildChip(segment.text)
        : ownerDocument.createTextNode(segment.text),
    );
  }

  if (value.endsWith("\n")) {
    const lineEnd: HTMLElement = ownerDocument.createElement("br");
    lineEnd.setAttribute(LINE_END_ATTRIBUTE, "");
    root.appendChild(lineEnd);
  }
};

interface DomPoint {
  node: Node;
  offset: number;
}

interface WalkResult {
  text: string;
  /** Where each requested point falls in the text; -1 if it was not reached. */
  points: Array<number>;
}

type WalkFunction = (root: HTMLElement, points: Array<DomPoint>) => WalkResult;

/*
 * The text the editor's DOM stands for, read the way a browser draws it, and
 * where in that text each given DOM point lands. One walk does both, so the
 * caret and the value can never be read by different rules.
 */
const walk: WalkFunction = (
  root: HTMLElement,
  points: Array<DomPoint>,
): WalkResult => {
  let text: string = "";
  const found: Array<number> = points.map(() => {
    return -1;
  });

  type MarkFunction = (node: Node, offset: number, at: number) => void;

  const mark: MarkFunction = (node: Node, offset: number, at: number): void => {
    points.forEach((point: DomPoint, index: number) => {
      if (
        found[index] === -1 &&
        point.node === node &&
        point.offset === offset
      ) {
        found[index] = at;
      }
    });
  };

  type MarkInsideFunction = (
    container: Node,
    start: number,
    end: number,
  ) => void;

  // A point anywhere inside `container` (a chip): before it at offset 0, else after.
  const markInside: MarkInsideFunction = (
    container: Node,
    start: number,
    end: number,
  ): void => {
    points.forEach((point: DomPoint, index: number) => {
      if (found[index] !== -1 || !container.contains(point.node)) {
        return;
      }

      found[index] =
        point.node === container && point.offset === 0 ? start : end;
    });
  };

  type VisitFunction = (node: Node) => void;

  const visit: VisitFunction = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      const data: string = (node as Text).data;

      points.forEach((point: DomPoint, index: number) => {
        if (found[index] === -1 && point.node === node) {
          found[index] =
            text.length + Math.max(0, Math.min(point.offset, data.length));
        }
      });

      text += data;
      return;
    }

    if (node.nodeType !== ELEMENT_NODE) {
      return;
    }

    const element: HTMLElement = node as HTMLElement;

    if (isChipNode(element)) {
      const reference: string =
        element.getAttribute(CHIP_REFERENCE_ATTRIBUTE) || "";
      const start: number = text.length;
      text += reference;
      markInside(element, start, text.length);
      return;
    }

    if (element.nodeName === "BR") {
      const parent: Node | null = element.parentNode;
      const isOnlyChildOfBlock: boolean = Boolean(
        parent &&
          parent !== root &&
          BLOCK_ELEMENTS.includes(parent.nodeName) &&
          parent.childNodes.length === 1,
      );

      // The <br> drawing an empty last line, or an empty line's placeholder.
      if (!isLineEnd(element) && !isOnlyChildOfBlock) {
        text += "\n";
      }

      mark(element, 0, text.length);
      return;
    }

    const isBlock: boolean =
      element !== root && BLOCK_ELEMENTS.includes(element.nodeName);

    // A block starts a line of its own.
    if (isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }

    const children: Array<Node> = Array.from(element.childNodes);

    children.forEach((child: Node, index: number) => {
      mark(element, index, text.length);
      visit(child);
    });

    mark(element, children.length, text.length);
  };

  visit(root);

  return { text: text, points: found };
};

export type SerializeTemplateEditorFunction = (root: HTMLElement) => string;

/** The string the editor's content stands for. */
export const serializeTemplateEditor: SerializeTemplateEditorFunction = (
  root: HTMLElement,
): string => {
  return walk(root, []).text;
};

export type DomPointToOffsetFunction = (
  root: HTMLElement,
  node: Node,
  offset: number,
) => number;

/** Where a DOM position falls in the stored string. */
export const domPointToOffset: DomPointToOffsetFunction = (
  root: HTMLElement,
  node: Node,
  offset: number,
): number => {
  const result: WalkResult = walk(root, [{ node, offset }]);
  const found: number = result.points[0] as number;

  return found === -1 ? result.text.length : found;
};

export interface TemplateSelection {
  start: number;
  end: number;
}

export type ReadTemplateSelectionFunction = (
  root: HTMLElement,
) => TemplateSelection | null;

/**
 * The document selection as offsets into the stored string, or null when it
 * is not in the editor.
 */
export const readTemplateSelection: ReadTemplateSelectionFunction = (
  root: HTMLElement,
): TemplateSelection | null => {
  const selection: Selection | null =
    root.ownerDocument.defaultView?.getSelection() || null;

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const anchor: Node | null = selection.anchorNode;
  const focus: Node | null = selection.focusNode;

  if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
    return null;
  }

  const result: WalkResult = walk(root, [
    { node: anchor, offset: selection.anchorOffset },
    { node: focus, offset: selection.focusOffset },
  ]);

  const anchorAt: number =
    result.points[0] === -1 ? result.text.length : (result.points[0] as number);
  const focusAt: number =
    result.points[1] === -1 ? result.text.length : (result.points[1] as number);

  return {
    start: Math.min(anchorAt, focusAt),
    end: Math.max(anchorAt, focusAt),
  };
};

export type OffsetToDomPointFunction = (
  root: HTMLElement,
  offset: number,
) => DomPoint;

/**
 * The DOM position for an offset, in a tidy editor. An offset that falls
 * inside a chip goes after it: the caret is never inside one.
 */
export const offsetToDomPoint: OffsetToDomPointFunction = (
  root: HTMLElement,
  offset: number,
): DomPoint => {
  const children: Array<Node> = Array.from(root.childNodes);
  let position: number = 0;

  for (let index: number = 0; index < children.length; index++) {
    const child: Node = children[index]!;

    if (child.nodeType === TEXT_NODE) {
      const length: number = (child as Text).data.length;

      if (offset <= position + length) {
        return { node: child, offset: Math.max(0, offset - position) };
      }

      position += length;
      continue;
    }

    if (isChipNode(child)) {
      const length: number = (
        (child as HTMLElement).getAttribute(CHIP_REFERENCE_ATTRIBUTE) || ""
      ).length;

      if (offset <= position) {
        return { node: root, offset: index };
      }

      if (offset < position + length) {
        return { node: root, offset: index + 1 };
      }

      position += length;
      continue;
    }

    if (isLineEnd(child)) {
      return { node: root, offset: index };
    }
  }

  return { node: root, offset: children.length };
};

export type WriteTemplateSelectionFunction = (
  root: HTMLElement,
  selection: TemplateSelection,
) => void;

/** Put the document selection at these offsets. */
export const writeTemplateSelection: WriteTemplateSelectionFunction = (
  root: HTMLElement,
  selection: TemplateSelection,
): void => {
  const domSelection: Selection | null =
    root.ownerDocument.defaultView?.getSelection() || null;

  if (!domSelection) {
    return;
  }

  const startPoint: DomPoint = offsetToDomPoint(root, selection.start);
  const endPoint: DomPoint = offsetToDomPoint(root, selection.end);

  const range: Range = root.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);

  domSelection.removeAllRanges();
  domSelection.addRange(range);
};

export type IsTemplateDomTidyFunction = (
  root: HTMLElement,
  value: string,
) => boolean;

/**
 * Whether the editor holds exactly what drawing `value` would: its text and
 * chips in order, and the empty-last-line <br> only where the value ends in a
 * line break. If not - the browser left a <div>, or a reference was typed out
 * in full and should become a chip - the editor draws the value again.
 */
export const isTemplateDomTidy: IsTemplateDomTidyFunction = (
  root: HTMLElement,
  value: string,
): boolean => {
  const expected: Array<TemplateSegment> = splitTemplateText(value);
  const actual: Array<{ kind: TemplateSegmentKind; text: string }> = [];
  const children: Array<Node> = Array.from(root.childNodes);

  for (let index: number = 0; index < children.length; index++) {
    const child: Node = children[index]!;

    if (child.nodeType === TEXT_NODE) {
      const data: string = (child as Text).data;
      const last: { kind: TemplateSegmentKind; text: string } | undefined =
        actual[actual.length - 1];

      if (data === "") {
        continue;
      }

      if (last && last.kind === TemplateSegmentKind.Text) {
        last.text += data;
      } else {
        actual.push({ kind: TemplateSegmentKind.Text, text: data });
      }

      continue;
    }

    if (isChipNode(child)) {
      actual.push({
        kind: TemplateSegmentKind.Reference,
        text:
          (child as HTMLElement).getAttribute(CHIP_REFERENCE_ATTRIBUTE) || "",
      });
      continue;
    }

    if (isLineEnd(child) && index === children.length - 1) {
      continue;
    }

    return false;
  }

  const lastChild: Node | null = root.lastChild;
  const hasLineEnd: boolean = isLineEnd(lastChild);

  if (hasLineEnd !== value.endsWith("\n")) {
    return false;
  }

  if (actual.length !== expected.length) {
    return false;
  }

  return expected.every((segment: TemplateSegment, index: number) => {
    const other: { kind: TemplateSegmentKind; text: string } = actual[index]!;
    return other.kind === segment.kind && other.text === segment.text;
  });
};

export interface AdjacentChip {
  element: HTMLElement;
  /** The chip's offsets in the stored string. */
  start: number;
  end: number;
}

export type ChipAtOffsetFunction = (
  root: HTMLElement,
  offset: number,
  direction: "before" | "after",
) => AdjacentChip | null;

/**
 * The chip right before (or right after) an offset, in a tidy editor. Used
 * for the keys that step over or delete a chip as one thing.
 */
export const chipAtOffset: ChipAtOffsetFunction = (
  root: HTMLElement,
  offset: number,
  direction: "before" | "after",
): AdjacentChip | null => {
  let position: number = 0;

  for (const child of Array.from(root.childNodes)) {
    let length: number = 0;

    if (child.nodeType === TEXT_NODE) {
      length = (child as Text).data.length;
    } else if (isChipNode(child)) {
      const chip: HTMLElement = child as HTMLElement;
      length = (chip.getAttribute(CHIP_REFERENCE_ATTRIBUTE) || "").length;

      const start: number = position;
      const end: number = position + length;

      if (direction === "before" && end === offset) {
        return { element: chip, start, end };
      }

      if (direction === "after" && start === offset) {
        return { element: chip, start, end };
      }
    }

    position += length;

    if (position > offset && direction === "before") {
      return null;
    }
  }

  return null;
};
