import { isUnnamedProfileFunction } from "Common/Utils/Profiles/ProfileFunctionNames";
import type { FlamegraphNode } from "../Components/Profiles/FlamegraphView";

/*
 * CODE WITHOUT SYMBOLS, GROUPED.
 *
 * Native code built without symbols reaches the Profiler as addresses: the
 * eBPF profiler records "0x270675" where it cannot name a function. Drawn
 * as they come, a stripped binary is a forest of addresses - hundreds of
 * frames, each a sliver, none of which says anything - and it pushes the
 * code a person can read out of view.
 *
 * groupUnnamedFrames folds them: under any frame, its unnamed children are
 * one frame, and a run of unnamed frames, one under another, is one frame
 * too. The named frames below them are kept, and merged where the same
 * function sits under several addresses. Every value is kept: a grouped
 * frame's self time is its addresses' self time, its total their total,
 * so the graph's widths and the root's total do not move.
 *
 * Pure: the flame graph groups its tree with it, and its tests read it.
 */

function frameKey(node: FlamegraphNode): string {
  return `${node.name}\u0000${node.fileName}`;
}

function isUnnamedFrame(node: FlamegraphNode): boolean {
  return (
    (node.unnamedFrameCount || 0) > 0 || isUnnamedProfileFunction(node.name)
  );
}

// A deep copy, so merging never changes the tree the page was handed.
function copyFrame(node: FlamegraphNode): FlamegraphNode {
  return {
    ...node,
    children: node.children.map(copyFrame),
  };
}

// Adds `source` into `target`: values summed, children merged by function.
function mergeFrameInto(target: FlamegraphNode, source: FlamegraphNode): void {
  target.selfValue += source.selfValue;
  target.totalValue += source.totalValue;

  for (const child of source.children) {
    const match: FlamegraphNode | undefined = target.children.find(
      (existing: FlamegraphNode): boolean => {
        return frameKey(existing) === frameKey(child);
      },
    );

    if (match) {
      mergeFrameInto(match, child);
    } else {
      target.children.push(copyFrame(child));
    }
  }
}

/*
 * The unnamed frames among one frame's children, as one: their self and
 * total summed, the unnamed frames below them absorbed, and the named
 * frames below them gathered (each function once).
 */
function mergeUnnamedFrames(unnamed: Array<FlamegraphNode>): FlamegraphNode {
  const merged: FlamegraphNode = {
    name: "",
    fileName: "",
    lineNumber: 0,
    frameType: "",
    category: "unknown",
    selfValue: 0,
    totalValue: 0,
    children: [],
    unnamedFrameCount: 0,
  };

  const addresses: Set<string> = new Set();
  const named: Array<FlamegraphNode> = [];

  // Absorbs one unnamed frame and every unnamed frame directly under it.
  const absorb: (node: FlamegraphNode) => void = (
    node: FlamegraphNode,
  ): void => {
    merged.selfValue += node.selfValue;

    if (node.unnamedFrameCount) {
      merged.unnamedFrameCount =
        (merged.unnamedFrameCount || 0) + node.unnamedFrameCount;
    } else {
      addresses.add(node.name);
      merged.unnamedFrameCount = (merged.unnamedFrameCount || 0) + 1;
    }

    for (const child of node.children) {
      if (isUnnamedFrame(child)) {
        absorb(child);
      } else {
        named.push(child);
      }
    }
  };

  for (const node of unnamed) {
    merged.totalValue += node.totalValue;
    absorb(node);
  }

  // One address keeps its name, for the tooltip to show.
  if (addresses.size === 1 && merged.unnamedFrameCount === 1) {
    merged.name = Array.from(addresses)[0] || "";
  }

  for (const child of named) {
    const match: FlamegraphNode | undefined = merged.children.find(
      (existing: FlamegraphNode): boolean => {
        return frameKey(existing) === frameKey(child);
      },
    );

    if (match) {
      mergeFrameInto(match, child);
    } else {
      merged.children.push(copyFrame(child));
    }
  }

  return merged;
}

export function groupUnnamedFrames(root: FlamegraphNode): FlamegraphNode {
  const named: Array<FlamegraphNode> = [];
  const unnamed: Array<FlamegraphNode> = [];

  for (const child of root.children) {
    if (isUnnamedFrame(child)) {
      unnamed.push(child);
    } else {
      named.push(child);
    }
  }

  const children: Array<FlamegraphNode> = named.map(groupUnnamedFrames);

  if (unnamed.length > 0) {
    const merged: FlamegraphNode = mergeUnnamedFrames(unnamed);
    children.push({
      ...merged,
      children: merged.children.map(groupUnnamedFrames),
    });
  }

  return { ...root, children };
}

/*
 * How much of a tree runs in code without symbols: the total of every
 * unnamed frame with no unnamed frame above it, so nothing counts twice.
 */
export function getUnnamedValue(root: FlamegraphNode): number {
  let value: number = 0;

  const walk: (node: FlamegraphNode) => void = (node: FlamegraphNode): void => {
    for (const child of node.children) {
      if (isUnnamedFrame(child)) {
        value += child.totalValue;
      } else {
        walk(child);
      }
    }
  };

  walk(root);

  return value;
}

export function hasUnnamedFrames(root: FlamegraphNode): boolean {
  return getUnnamedValue(root) > 0;
}
