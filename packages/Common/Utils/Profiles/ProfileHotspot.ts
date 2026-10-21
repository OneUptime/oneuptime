import { isOwnProfileFrame } from "./ProfileFrames";

/*
 * ONE FUNCTION'S PART OF A PROFILE, READ FROM ITS CALLERS AND CALLEES.
 *
 * The aggregation service's function focus (ProfileAggregationService.
 * getFunctionFocus) answers with two trees rooted at the function: who
 * calls it, and what it calls. These helpers read what a person - or the
 * AI - needs from them:
 *
 *   - its "own-code time": the time it and the library, runtime and system
 *     code it calls take, down to the next function of the application's
 *     own. That is the time a change to this function can win back. A
 *     parser whose time all goes to JSON.parse has almost no self time, but
 *     the fix is in the parser; a request handler whose time all goes to
 *     the parser below it has a large total but no own-code time - the fix
 *     is not in the handler.
 *   - its heaviest caller chains and callees, for the evidence a fix starts
 *     from.
 *
 * Pure: the server (the fix suggestion, the AI tools) and the Dashboard
 * import it alike.
 */

export interface ProfileTreeNode {
  functionName: string;
  fileName: string;
  frameType?: string | undefined;
  selfValue: number;
  totalValue: number;
  children: Array<ProfileTreeNode>;
}

function isOwn(node: ProfileTreeNode): boolean {
  return isOwnProfileFrame(node.fileName, node.functionName, node.frameType);
}

/*
 * The value of the stacks below `node` that reach no code of the
 * application's own (node included): what a frame of other code passes on
 * to the function above it.
 */
function valueWithoutOwnCode(node: ProfileTreeNode): number {
  if (isOwn(node)) {
    return 0;
  }

  let value: number = Math.max(0, Number(node.selfValue) || 0);

  for (const child of node.children) {
    value += valueWithoutOwnCode(child);
  }

  return value;
}

/*
 * The function's own-code time, read from its callees tree (rooted at the
 * function): its self time, plus the time of every chain below it that
 * reaches no other function of the application's own.
 */
export function getOwnCodeValue(callees: ProfileTreeNode): number {
  let value: number = Math.max(0, Number(callees.selfValue) || 0);

  for (const child of callees.children) {
    value += valueWithoutOwnCode(child);
  }

  return Math.min(value, Math.max(0, Number(callees.totalValue) || 0));
}

export interface ProfileCallChain {
  // The chain read outward from the function: its direct caller first.
  frames: Array<{ functionName: string; fileName: string }>;
  value: number;
}

/*
 * The heaviest caller chains of a function, read from its callers tree
 * (rooted at the function): each chain follows the heaviest caller at every
 * step, up to `depth` callers.
 */
export function getTopCallerChains(
  callers: ProfileTreeNode,
  options?: { limit?: number | undefined; depth?: number | undefined },
): Array<ProfileCallChain> {
  const limit: number = options?.limit ?? 5;
  const depth: number = options?.depth ?? 4;

  const chains: Array<ProfileCallChain> = [];
  const direct: Array<ProfileTreeNode> = [...callers.children].sort(
    (a: ProfileTreeNode, b: ProfileTreeNode): number => {
      return b.totalValue - a.totalValue;
    },
  );

  for (const first of direct.slice(0, limit)) {
    const frames: Array<{ functionName: string; fileName: string }> = [];
    let current: ProfileTreeNode | undefined = first;

    while (current && frames.length < depth) {
      frames.push({
        functionName: current.functionName,
        fileName: current.fileName,
      });

      current = [...current.children].sort(
        (a: ProfileTreeNode, b: ProfileTreeNode): number => {
          return b.totalValue - a.totalValue;
        },
      )[0];
    }

    chains.push({ frames, value: first.totalValue });
  }

  return chains;
}

export interface ProfileCallee {
  functionName: string;
  fileName: string;
  frameType: string;
  // The time spent in it and below it, when called from the function.
  value: number;
}

/*
 * What a function spends its time calling, heaviest first, read from its
 * callees tree: every function below it, each counted once with all the
 * time spent in it and below it on the way down from the function.
 */
export function getTopCallees(
  callees: ProfileTreeNode,
  options?: { limit?: number | undefined },
): Array<ProfileCallee> {
  const limit: number = options?.limit ?? 8;
  const byFunction: Map<string, ProfileCallee> = new Map();

  const walk: (node: ProfileTreeNode, onPath: Set<string>) => void = (
    node: ProfileTreeNode,
    onPath: Set<string>,
  ): void => {
    for (const child of node.children) {
      const key: string = `${child.functionName}\u0000${child.fileName}`;
      /*
       * A function met again lower in the same chain (recursion) is
       * already counted with the time below its first occurrence.
       */
      const isRepeat: boolean = onPath.has(key);

      if (!isRepeat) {
        const existing: ProfileCallee | undefined = byFunction.get(key);

        if (existing) {
          existing.value += child.totalValue;
        } else {
          byFunction.set(key, {
            functionName: child.functionName,
            fileName: child.fileName,
            frameType: child.frameType || "",
            value: child.totalValue,
          });
        }
      }

      const nextPath: Set<string> = new Set(onPath);
      nextPath.add(key);
      walk(child, nextPath);
    }
  };

  walk(callees, new Set<string>());

  return Array.from(byFunction.values())
    .sort((a: ProfileCallee, b: ProfileCallee): number => {
      return b.value - a.value;
    })
    .slice(0, limit);
}

// A share of a window (0-100), safe against an empty window.
export function getShareOfWindow(value: number, windowTotal: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(windowTotal)) {
    return 0;
  }

  if (windowTotal <= 0) {
    return 0;
  }

  return (Math.max(0, value) / windowTotal) * 100;
}
