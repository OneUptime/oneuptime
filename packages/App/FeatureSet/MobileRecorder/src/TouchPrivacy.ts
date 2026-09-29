import { NativeViewTreeNode } from "./NativeViewTree";

const MAX_PRIVACY_TREE_NODES: number = 5_000;
const OPAQUE_KINDS: ReadonlySet<string> = new Set<string>([
  "image",
  "webview",
  "canvas",
  "masked",
]);

export interface OpaqueTouchRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TouchPrivacyMap {
  regions: Array<OpaqueTouchRegion>;
  suppressAll: boolean;
}

export const CONSERVATIVE_TOUCH_PRIVACY_MAP: TouchPrivacyMap = {
  regions: [],
  suppressAll: true,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function deriveTouchPrivacyMap(
  root: NativeViewTreeNode,
): TouchPrivacyMap {
  const regions: Array<OpaqueTouchRegion> = [];
  const hasRootOrigin: boolean =
    finite(root.touchOriginX) && finite(root.touchOriginY);
  const rootX: number = hasRootOrigin ? (root.touchOriginX as number) : 0;
  const rootY: number = hasRootOrigin ? (root.touchOriginY as number) : 0;
  let suppressAll: boolean =
    finite(root.truncatedNodes) && root.truncatedNodes > 0;
  let visited: number = 0;

  const visit: (
    node: NativeViewTreeNode,
    parentX: number,
    parentY: number,
    alignedPath: boolean,
    isRoot: boolean,
  ) => void = (
    node: NativeViewTreeNode,
    parentX: number,
    parentY: number,
    alignedPath: boolean,
    isRoot: boolean,
  ): void => {
    if (visited >= MAX_PRIVACY_TREE_NODES) {
      suppressAll = true;
      return;
    }
    visited += 1;

    const hasGeometry: boolean =
      finite(node.x) &&
      finite(node.y) &&
      finite(node.width) &&
      finite(node.height);
    const left: number = isRoot
      ? parentX
      : parentX + (finite(node.x) ? node.x : 0);
    const top: number = isRoot
      ? parentY
      : parentY + (finite(node.y) ? node.y : 0);
    const pathIsAligned: boolean = alignedPath && hasGeometry;
    const opaque: boolean =
      node.masked === true ||
      node.opaque === true ||
      OPAQUE_KINDS.has(typeof node.kind === "string" ? node.kind : "");

    if (opaque) {
      if (!pathIsAligned || !hasRootOrigin) {
        suppressAll = true;
        return;
      }
      if ((node.width as number) > 0 && (node.height as number) > 0) {
        regions.push({
          left,
          top,
          right: left + (node.width as number),
          bottom: top + (node.height as number),
        });
      }
      return;
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === "object") {
          visit(child, left, top, pathIsAligned, false);
        }
      }
    }
  };

  visit(root, rootX, rootY, hasRootOrigin, true);
  return { regions, suppressAll };
}

export function isTouchPrivate(
  privacyMap: TouchPrivacyMap,
  x: number,
  y: number,
): boolean {
  if (privacyMap.suppressAll || !finite(x) || !finite(y)) {
    return true;
  }
  return privacyMap.regions.some((region: OpaqueTouchRegion): boolean => {
    return (
      x >= region.left &&
      x <= region.right &&
      y >= region.top &&
      y <= region.bottom
    );
  });
}
