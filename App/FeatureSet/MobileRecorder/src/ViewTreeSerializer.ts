import {
  RrwebEvent,
  RrwebEventType,
  RrwebIncrementalSource,
  SessionReplayFidelityNotice,
} from "./Contract";
import { NativeViewKind, NativeViewTreeNode } from "./NativeViewTree";

export const RRWEB_DOCUMENT_NODE_ID: number = 1;
export const RRWEB_HTML_NODE_ID: number = 3;
export const RRWEB_HEAD_NODE_ID: number = 4;
export const RRWEB_BODY_NODE_ID: number = 5;
const FIRST_VIEW_NODE_ID: number = 10;
const MAX_VIEW_TREE_DEPTH: number = 64;
const MAX_VIEW_TREE_NODES: number = 5_000;
const MAX_GEOMETRY_VALUE: number = 100_000;

const SAFE_KINDS: ReadonlySet<NativeViewKind> = new Set<NativeViewKind>([
  "view",
  "scroll",
  "button",
  "text",
  "input",
  "image",
  "webview",
  "canvas",
  "masked",
  "unknown",
]);

interface SerializedElement {
  type: 2;
  tagName: "div";
  attributes: Record<string, string>;
  childNodes: Array<SerializedElement>;
  id: number;
}

interface SerializedRecord {
  key: string;
  id: number;
  parentId: number;
  attributes: Record<string, string>;
  node: SerializedElement;
}

export interface SerializedCapture {
  events: Array<RrwebEvent>;
  hasFullSnapshot: boolean;
  fidelityNotices: Array<SessionReplayFidelityNotice>;
  droppedNodes: number;
}

interface BuildResult {
  root: SerializedElement;
  records: Map<string, SerializedRecord>;
  byId: Map<number, SerializedRecord>;
  fidelity: Set<SessionReplayFidelityNotice>;
  droppedNodes: number;
}

function finiteGeometry(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(MAX_GEOMETRY_VALUE, Math.max(-MAX_GEOMETRY_VALUE, value));
}

function safeKind(value: unknown): NativeViewKind {
  if (typeof value === "string" && SAFE_KINDS.has(value as NativeViewKind)) {
    return value as NativeViewKind;
  }

  return "unknown";
}

function geometryStyle(node: NativeViewTreeNode): string {
  const x: number = finiteGeometry(node.x);
  const y: number = finiteGeometry(node.y);
  const width: number = Math.max(0, finiteGeometry(node.width));
  const height: number = Math.max(0, finiteGeometry(node.height));
  const style: Array<string> = [
    "position:absolute",
    `left:${x}px`,
    `top:${y}px`,
    `width:${width}px`,
    `height:${height}px`,
    "box-sizing:border-box",
    "overflow:hidden",
    "outline:1px solid rgba(148,163,184,0.18)",
  ];
  const backgroundColor: string | null = safeColor(node.backgroundColor);
  const borderColor: string | null = safeColor(node.borderColor);
  const borderWidth: number = clampedStyleNumber(node.borderWidth, 0, 100, 0);
  const borderRadius: number = clampedStyleNumber(
    node.borderRadius,
    0,
    MAX_GEOMETRY_VALUE,
    0,
  );
  const opacity: number = clampedStyleNumber(node.opacity, 0, 1, 1);
  const zIndex: number = clampedStyleNumber(node.zIndex, -10_000, 10_000, 0);

  if (backgroundColor) {
    style.push(`background-color:${backgroundColor}`);
  }
  if (borderColor && borderWidth > 0) {
    style.push(`border:${borderWidth}px solid ${borderColor}`);
  }
  if (borderRadius > 0) {
    style.push(`border-radius:${borderRadius}px`);
  }
  if (opacity < 1) {
    style.push(`opacity:${opacity}`);
  }
  if (zIndex !== 0) {
    style.push(`z-index:${zIndex}`);
  }

  return style.join(";");
}

const HEX_COLOR_PATTERN: RegExp = /^#[0-9a-f]{6}([0-9a-f]{2})?$/u;

function safeColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null;
}

function clampedStyleNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, value));
}

function cloneNode(node: SerializedElement): SerializedElement {
  return {
    ...node,
    attributes: { ...node.attributes },
    childNodes: node.childNodes.map(cloneNode),
  };
}

function sameAttributes(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys: Array<string> = Object.keys(left);
  const rightKeys: Array<string> = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key: string): boolean => {
      return left[key] === right[key];
    })
  );
}

export default class ViewTreeSerializer {
  private readonly nodeIds: Map<string, number> = new Map<string, number>();
  private nextNodeId: number = FIRST_VIEW_NODE_ID;
  private previous: BuildResult | null = null;

  public capture(
    input: NativeViewTreeNode,
    options: {
      timestamp: number;
      url: string;
      viewportWidth: number;
      viewportHeight: number;
      forceFullSnapshot?: boolean;
    },
  ): SerializedCapture {
    const shouldTakeFullSnapshot: boolean =
      !this.previous || options.forceFullSnapshot === true;
    if (options.forceFullSnapshot === true && this.previous) {
      this.previous = null;
      this.nodeIds.clear();
      this.nextNodeId = FIRST_VIEW_NODE_ID;
    }
    const current: BuildResult = this.build(input);
    const events: Array<RrwebEvent> = shouldTakeFullSnapshot
      ? this.fullSnapshot(current, options)
      : this.mutations(
          this.previous as BuildResult,
          current,
          options.timestamp,
        );

    this.previous = current;
    for (const key of this.nodeIds.keys()) {
      if (!current.records.has(key)) {
        this.nodeIds.delete(key);
      }
    }

    return {
      events,
      hasFullSnapshot: shouldTakeFullSnapshot,
      fidelityNotices: Array.from(current.fidelity),
      droppedNodes: current.droppedNodes,
    };
  }

  public reset(): void {
    this.previous = null;
    this.nodeIds.clear();
    this.nextNodeId = FIRST_VIEW_NODE_ID;
  }

  private build(input: NativeViewTreeNode): BuildResult {
    const records: Map<string, SerializedRecord> = new Map<
      string,
      SerializedRecord
    >();
    const byId: Map<number, SerializedRecord> = new Map<
      number,
      SerializedRecord
    >();
    const fidelity: Set<SessionReplayFidelityNotice> =
      new Set<SessionReplayFidelityNotice>([
        SessionReplayFidelityNotice.MobileAnimationSampled,
      ]);
    let visited: number = 0;
    let droppedNodes: number =
      typeof input.truncatedNodes === "number" &&
      Number.isSafeInteger(input.truncatedNodes) &&
      input.truncatedNodes > 0
        ? Math.min(input.truncatedNodes, 1_000_000)
        : 0;

    const visit: (
      candidate: NativeViewTreeNode,
      parentId: number,
      path: string,
      depth: number,
    ) => SerializedElement | null = (
      candidate: NativeViewTreeNode,
      parentId: number,
      path: string,
      depth: number,
    ): SerializedElement | null => {
      if (
        depth > MAX_VIEW_TREE_DEPTH ||
        visited >= MAX_VIEW_TREE_NODES ||
        !candidate ||
        typeof candidate !== "object"
      ) {
        droppedNodes += 1;
        return null;
      }

      visited += 1;
      const kind: NativeViewKind = candidate.masked
        ? "masked"
        : safeKind(candidate.kind);
      const key: string = `${typeof candidate.nativeId}:${String(
        candidate.nativeId,
      )}:${path}`;
      let id: number | undefined = this.nodeIds.get(key);
      if (id === undefined) {
        id = this.nextNodeId;
        this.nextNodeId += 1;
        this.nodeIds.set(key, id);
      }

      const attributes: Record<string, string> = {
        style: geometryStyle(candidate),
        "data-oneuptime-mobile-view": kind,
      };
      const isOpaque: boolean =
        candidate.opaque === true ||
        kind === "image" ||
        kind === "webview" ||
        kind === "canvas" ||
        kind === "masked";

      if (isOpaque) {
        attributes["data-oneuptime-replay-placeholder"] = kind;
        if (!safeColor(candidate.backgroundColor)) {
          attributes["style"] += ";background-color:#94a3b833";
        }
      } else if (kind === "text" || kind === "input") {
        /* Fixed fill makes masked copy visible without carrying its value. */
        attributes["style"] += ";background-color:#94a3b826";
      }

      switch (kind) {
        case "image":
          fidelity.add(SessionReplayFidelityNotice.MobileImagesOpaque);
          break;
        case "webview":
          fidelity.add(SessionReplayFidelityNotice.MobileWebViewOpaque);
          break;
        case "canvas":
          fidelity.add(SessionReplayFidelityNotice.MobileCanvasOpaque);
          break;
        default:
          break;
      }

      const element: SerializedElement = {
        type: 2,
        tagName: "div",
        attributes,
        childNodes: [],
        id,
      };
      const record: SerializedRecord = {
        key,
        id,
        parentId,
        attributes,
        node: element,
      };
      records.set(key, record);
      byId.set(id, record);

      /* Masked and opaque content is a hard subtree boundary. */
      if (!isOpaque && Array.isArray(candidate.children)) {
        candidate.children.forEach(
          (child: NativeViewTreeNode, index: number): void => {
            const serialized: SerializedElement | null = visit(
              child,
              id as number,
              `${path}.${index}`,
              depth + 1,
            );
            if (serialized) {
              element.childNodes.push(serialized);
            }
          },
        );
      }

      return element;
    };

    const root: SerializedElement = visit(
      input,
      RRWEB_BODY_NODE_ID,
      "0",
      0,
    ) ?? {
      type: 2,
      tagName: "div",
      attributes: {
        style:
          "position:absolute;left:0px;top:0px;width:0px;height:0px;box-sizing:border-box;overflow:hidden",
        "data-oneuptime-mobile-view": "unknown",
      },
      childNodes: [],
      id: this.nextNodeId++,
    };

    if (droppedNodes > 0) {
      fidelity.add(SessionReplayFidelityNotice.BufferOverflow);
    }

    return { root, records, byId, fidelity, droppedNodes };
  }

  private fullSnapshot(
    current: BuildResult,
    options: {
      timestamp: number;
      url: string;
      viewportWidth: number;
      viewportHeight: number;
    },
  ): Array<RrwebEvent> {
    const width: number = Math.max(0, finiteGeometry(options.viewportWidth));
    const height: number = Math.max(0, finiteGeometry(options.viewportHeight));
    return [
      {
        type: RrwebEventType.Meta,
        data: {
          href: options.url,
          width,
          height,
        },
        timestamp: options.timestamp,
      },
      {
        type: RrwebEventType.FullSnapshot,
        data: {
          node: {
            type: 0,
            childNodes: [
              {
                type: 1,
                name: "html",
                publicId: "",
                systemId: "",
                id: 2,
              },
              {
                type: 2,
                tagName: "html",
                attributes: {},
                childNodes: [
                  {
                    type: 2,
                    tagName: "head",
                    attributes: {},
                    childNodes: [],
                    id: RRWEB_HEAD_NODE_ID,
                  },
                  {
                    type: 2,
                    tagName: "body",
                    attributes: {
                      style: `margin:0;position:relative;width:${width}px;height:${height}px;overflow:hidden`,
                      "data-oneuptime-recorder-kind": "rn-view-tree",
                    },
                    childNodes: [cloneNode(current.root)],
                    id: RRWEB_BODY_NODE_ID,
                  },
                ],
                id: RRWEB_HTML_NODE_ID,
              },
            ],
            id: RRWEB_DOCUMENT_NODE_ID,
          },
          initialOffset: { top: 0, left: 0 },
        },
        timestamp: options.timestamp,
      },
    ];
  }

  private mutations(
    previous: BuildResult,
    current: BuildResult,
    timestamp: number,
  ): Array<RrwebEvent> {
    const additions: Array<{
      parentId: number;
      nextId: null;
      node: SerializedElement;
    }> = [];
    const removals: Array<{ parentId: number; id: number }> = [];
    const attributes: Array<{
      id: number;
      attributes: Record<string, string>;
    }> = [];

    for (const record of current.records.values()) {
      const before: SerializedRecord | undefined = previous.records.get(
        record.key,
      );
      if (!before) {
        const parentWasAdded: boolean =
          record.parentId !== RRWEB_BODY_NODE_ID &&
          !previous.byId.has(record.parentId);
        if (!parentWasAdded) {
          additions.push({
            parentId: record.parentId,
            nextId: null,
            node: cloneNode(record.node),
          });
        }
      } else if (!sameAttributes(before.attributes, record.attributes)) {
        attributes.push({
          id: record.id,
          attributes: { ...record.attributes },
        });
      }
    }

    for (const record of previous.records.values()) {
      if (!current.records.has(record.key)) {
        const parentWasRemoved: boolean =
          record.parentId !== RRWEB_BODY_NODE_ID &&
          !current.byId.has(record.parentId);
        if (!parentWasRemoved) {
          removals.push({ parentId: record.parentId, id: record.id });
        }
      }
    }

    if (
      additions.length === 0 &&
      removals.length === 0 &&
      attributes.length === 0
    ) {
      return [];
    }

    return [
      {
        type: RrwebEventType.IncrementalSnapshot,
        data: {
          source: RrwebIncrementalSource.Mutation,
          texts: [],
          attributes,
          removes: removals,
          adds: additions,
        },
        timestamp,
      },
    ];
  }
}
