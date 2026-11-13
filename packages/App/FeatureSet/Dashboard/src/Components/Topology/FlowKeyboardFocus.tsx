import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import { ReactFlowState, useStore, useStoreApi } from "reactflow";
import { panDeltaToReveal } from "./FlowViewport";

/* How far inside the canvas edge a focused card is brought, in pixels. */
export const FOCUS_REVEAL_PADDING_PX: number = 24;
/*
 * How soon after the window regains focus a focusin counts as the browser
 * handing focus back to the element that had it, rather than the user.
 */
export const WINDOW_REFOCUS_MS: number = 100;

/*
 * Focus the browser would show a focus ring for: Tab, or a script focusing
 * after a key press. A card a pointer presses is focused too, but that is
 * not followed: moving the map under the pointer between press and release
 * loses the click. A browser (or test DOM) that cannot answer counts every
 * focus.
 */
export function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

const selectDomNode: (state: ReactFlowState) => HTMLDivElement | null = (
  state: ReactFlowState,
): HTMLDivElement | null => {
  return state.domNode;
};

/*
 * Keeps the keyboard's focus on a React Flow canvas in view (issues #4117
 * and #6779). Called from a component rendered as a child of <ReactFlow>,
 * the one place React Flow's store can be read.
 *
 * React Flow 11 never brings a focused card into view. Left alone, the
 * browser scrolls React Flow's overflow:hidden box to show one below or
 * right of the view - sliding everything React Flow draws, its controls
 * included, off the canvas while its viewport, as far as React Flow knows,
 * never moved - and cannot reach one above or left of it at all. Keyboard
 * focus is followed with a pan of the viewport instead, in any direction
 * and within the pan extent, and a scroll the browser makes anyway is
 * turned into the same pan. Focus a pointer gives a card is left alone: the
 * card is under the pointer already, and moving it between press and
 * release would lose the click. Nor is focus the browser hands back as the
 * window regains it followed: the view may have moved on since.
 *
 * `onViewMoved` is told of each pan that moved the view, so the map can
 * treat the view as the reader's from then on (a resize no longer frames
 * the drawing again, carrying the focused card back out of view). React
 * Flow tells nothing of a pan made through its store: its onMoveStart and
 * onMoveEnd carry the reader's own gestures only.
 */
export function useFlowKeyboardFocus(onViewMoved: () => void): void {
  const store: ReturnType<typeof useStoreApi> = useStoreApi();
  const domNode: HTMLDivElement | null = useStore(selectDomNode);
  /* The latest callback, for an effect that must not re-run when it changes. */
  const onViewMovedRef: MutableRefObject<() => void> =
    useRef<() => void>(onViewMoved);
  onViewMovedRef.current = onViewMoved;

  useEffect(() => {
    if (!domNode) {
      return undefined;
    }
    /*
     * Pan by a screen-pixel delta through React Flow's own panBy, which
     * keeps the view inside the pan extent (setViewport would not, and the
     * next drag would jump back into it). Synchronously: whatever measures
     * the page next — the reveal below, or the browser's own scroll into
     * view — has to see the pan, not the layout before it.
     */
    const panBy: (x: number, y: number) => void = (
      x: number,
      y: number,
    ): void => {
      let moved: boolean = false;
      flushSync(() => {
        moved = store.getState().panBy({ x, y });
      });
      if (moved) {
        onViewMovedRef.current();
      }
    };
    const reveal: (target: Element) => void = (target: Element): void => {
      const pane: HTMLElement | null = domNode.querySelector<HTMLElement>(
        ".react-flow__renderer",
      );
      // The controls sit outside the pane and are always on the canvas.
      if (!pane || !pane.contains(target)) {
        return;
      }
      const view: DOMRect = pane.getBoundingClientRect();
      const box: DOMRect = target.getBoundingClientRect();
      const x: number = panDeltaToReveal(
        box.left,
        box.right,
        view.left,
        view.right,
        FOCUS_REVEAL_PADDING_PX,
      );
      const y: number = panDeltaToReveal(
        box.top,
        box.bottom,
        view.top,
        view.bottom,
        FOCUS_REVEAL_PADDING_PX,
      );
      if (x || y) {
        panBy(x, y);
      }
    };
    let windowFocusedAt: number = Number.NEGATIVE_INFINITY;
    const noteWindowFocus: (event: FocusEvent) => void = (
      event: FocusEvent,
    ): void => {
      windowFocusedAt = event.timeStamp;
    };
    const followFocus: (event: FocusEvent) => void = (
      event: FocusEvent,
    ): void => {
      const target: EventTarget | null = event.target;
      if (
        !(target instanceof Element) ||
        !isKeyboardFocus(target) ||
        /*
         * Coming back to the tab sends focus to the element that had it
         * again. That is not the user moving focus, and the view may have
         * moved on since.
         */
        event.timeStamp - windowFocusedAt < WINDOW_REFOCUS_MS
      ) {
        return;
      }
      /*
       * Chromium scrolls React Flow's box to the element before focusin
       * fires. That scroll is the browser's way of showing the element, and
       * the pan below does it instead, so drop it here: left in place, the
       * scroll listener would turn it into a second pan, carrying the
       * element far off the canvas.
       */
      domNode.scrollLeft = 0;
      domNode.scrollTop = 0;
      reveal(target);
      /*
       * The browser may have scrolled the page, too, towards where the
       * element was before the pan. Show it where it is now.
       */
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    };
    const undoScroll: () => void = (): void => {
      const left: number = domNode.scrollLeft;
      const top: number = domNode.scrollTop;
      if (!left && !top) {
        return;
      }
      domNode.scrollLeft = 0;
      domNode.scrollTop = 0;
      panBy(-left, -top);
      /*
       * The browser scrolled to show something. The extent may have kept
       * the pan short of that, so make sure the focused element shows.
       */
      const focused: Element | null = document.activeElement;
      if (focused && domNode.contains(focused) && isKeyboardFocus(focused)) {
        reveal(focused);
      }
    };
    window.addEventListener("focus", noteWindowFocus);
    domNode.addEventListener("focusin", followFocus);
    domNode.addEventListener("scroll", undoScroll);
    return () => {
      window.removeEventListener("focus", noteWindowFocus);
      domNode.removeEventListener("focusin", followFocus);
      domNode.removeEventListener("scroll", undoScroll);
    };
  }, [domNode, store]);
}

export interface ComponentProps {
  /* A pan here moved the view: the view is the reader's from now on. */
  onViewMoved: () => void;
}

/*
 * The same, for a map that has nothing else to read from React Flow's
 * store: render it as a child of <ReactFlow>.
 */
const FlowKeyboardFocus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  useFlowKeyboardFocus(props.onViewMoved);
  return <></>;
};

export default FlowKeyboardFocus;
