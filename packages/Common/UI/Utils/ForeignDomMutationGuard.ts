import { Logger } from "./Logger";

/*
 * Browser extensions edit the page's DOM underneath React. Password managers
 * decorate form fields and inject elements of their own beside ours,
 * translators (Google Translate, the browsers' built-in ones) wrap text nodes
 * in <font> elements, and other extensions wrap, move or remove nodes.
 *
 * React keeps its own record of every node it created and where it put it.
 * When an extension has moved one, React's next commit asks the old parent to
 * remove it, or to insert a new node before it, and the DOM throws
 * NotFoundError ("Failed to execute 'removeChild' on 'Node': The node to be
 * removed is not a child of this node"). An error thrown mid-commit takes the
 * whole tree under the nearest error boundary down with it: the page turns
 * into the error screen for a change the user never made.
 *
 * removeChild and insertBefore are the only DOM writes React makes that can
 * fail that way (facebook/react#11538), so this makes exactly those two
 * failures survivable and leaves every other call to the platform:
 *
 *   - removeChild(child), when `child` is no longer a child of this node: if
 *     it is still inside this node (an extension wrapped it), it is taken out
 *     of the wrapper, which is what removing it was for; if it has left this
 *     node altogether, it is left wherever the extension put it. Either way
 *     `child` is returned, as a successful removal would.
 *   - insertBefore(node, reference), when `reference` is no longer a child of
 *     this node: the node goes in front of the child of this node that now
 *     holds `reference` (the wrapper an extension put around it), or at the
 *     end when `reference` has left this node altogether, so the new content
 *     still shows and keeps its order relative to a wrapped sibling.
 *
 * Calls that would succeed, and calls that fail for any other reason (a
 * non-node argument, a node inserted into its own subtree), behave exactly as
 * they do without the guard. Each tolerated call is logged, up to a cap, so a
 * genuine bug in DOM code of our own still leaves a trace.
 */

type RemoveChildFunction = <T extends Node>(this: Node, child: T) => T;

type InsertBeforeFunction = <T extends Node>(
  this: Node,
  node: T,
  child: Node | null,
) => T;

interface OriginalMethods {
  removeChild: RemoveChildFunction;
  insertBefore: InsertBeforeFunction;
}

/*
 * Kept on Node.prototype rather than in this module, under a registry symbol,
 * so a second copy of this module (another bundle on the page, a hot reload)
 * finds the guard already in place instead of wrapping it a second time.
 */
const GUARD_KEY: unique symbol = Symbol.for(
  "oneuptime.foreignDomMutationGuard",
);

type GuardedPrototype = Node & {
  [GUARD_KEY]?: OriginalMethods | undefined;
};

/*
 * A translator wraps every text node it touches, so one page of tolerated
 * calls can number in the hundreds. The first few are what tell the story.
 */
export const MAX_LOGGED_TOLERATED_CALLS: number = 10;

let loggedToleratedCalls: number = 0;

type IsNodeFunction = (value: unknown) => value is Node;

/*
 * Duck-typed rather than `instanceof Node`, which is false for a node from
 * another realm (an iframe's document).
 */
const isNode: IsNodeFunction = (value: unknown): value is Node => {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Node).nodeType === "number"
  );
};

type DescribeNodeFunction = (node: Node) => string;

const describeNode: DescribeNodeFunction = (node: Node): string => {
  return `<${node.nodeName.toLowerCase()}>`;
};

type LogToleratedCallFunction = (message: string) => void;

const logToleratedCall: LogToleratedCallFunction = (message: string): void => {
  if (loggedToleratedCalls >= MAX_LOGGED_TOLERATED_CALLS) {
    return;
  }

  loggedToleratedCalls++;

  const suffix: string =
    loggedToleratedCalls === MAX_LOGGED_TOLERATED_CALLS
      ? " Further calls like this are not logged."
      : "";

  Logger.warn(
    `${message} Something outside the app - usually a browser extension such as a password manager or a translator - moved it, so the page carried on instead of failing.${suffix}`,
  );
};

type FindChildHoldingFunction = (parent: Node, node: Node) => Node | null;

// The child of `parent` that contains `node`, or null when none does.
const findChildHolding: FindChildHoldingFunction = (
  parent: Node,
  node: Node,
): Node | null => {
  let current: Node | null = node;

  while (current && current.parentNode !== parent) {
    current = current.parentNode;
  }

  return current;
};

export default class ForeignDomMutationGuard {
  /*
   * Patches Node.prototype once per page. Call it before the first render.
   * Safe to call again: a page that already has the guard keeps the one it
   * has.
   */
  public static install(): void {
    if (typeof Node !== "function" || !Node.prototype) {
      return;
    }

    const prototype: GuardedPrototype = Node.prototype as GuardedPrototype;

    if (prototype[GUARD_KEY]) {
      return;
    }

    const originals: OriginalMethods = {
      removeChild: prototype.removeChild as RemoveChildFunction,
      insertBefore: prototype.insertBefore as InsertBeforeFunction,
    };

    prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      if (isNode(child) && child.parentNode !== this) {
        const wrapper: Node | null = child.parentNode;

        if (wrapper && findChildHolding(this, child)) {
          logToleratedCall(
            `Removed a ${describeNode(child)} from the ${describeNode(wrapper)} wrapped around it inside a ${describeNode(this)}, instead of from the ${describeNode(this)} itself.`,
          );

          originals.removeChild.call(wrapper, child);
        } else {
          logToleratedCall(
            `Skipped removing a ${describeNode(child)} from a ${describeNode(this)} it is no longer inside.`,
          );
        }

        return child;
      }

      return originals.removeChild.call(this, child) as T;
    };

    prototype.insertBefore = function <T extends Node>(
      this: Node,
      node: T,
      child: Node | null,
    ): T {
      if (isNode(child) && child.parentNode !== this) {
        const holder: Node | null = findChildHolding(this, child);

        logToleratedCall(
          `Inserted a ${describeNode(node)} into a ${describeNode(this)} ${
            holder
              ? `in front of the ${describeNode(holder)} now wrapped around`
              : "at the end, because it no longer holds"
          } the ${describeNode(child)} it was meant to go before.`,
        );

        return originals.insertBefore.call(this, node, holder) as T;
      }

      return originals.insertBefore.call(this, node, child) as T;
    };

    prototype[GUARD_KEY] = originals;
  }

  public static isInstalled(): boolean {
    return (
      typeof Node === "function" &&
      Boolean((Node.prototype as GuardedPrototype)[GUARD_KEY])
    );
  }

  /*
   * Test-only: puts the platform's methods back and resets the log cap, so a
   * suite can compare the page with and without the guard.
   */
  public static uninstallForTesting(): void {
    loggedToleratedCalls = 0;

    if (typeof Node !== "function") {
      return;
    }

    const prototype: GuardedPrototype = Node.prototype as GuardedPrototype;
    const originals: OriginalMethods | undefined = prototype[GUARD_KEY];

    if (!originals) {
      return;
    }

    prototype.removeChild = originals.removeChild;
    prototype.insertBefore = originals.insertBefore;
    delete prototype[GUARD_KEY];
  }
}
