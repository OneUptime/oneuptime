/*
 * The height the player fills on a desktop - the React-free half.
 *
 * At xl and up the player is an app-like surface: header, then [player card
 * | events rail], with the stage taking every pixel the chrome leaves. That
 * only works when the root has a DEFINITE height - a flex column with no
 * height gives its flex-1 child nothing to grow into - and the right height
 * is "from where the player starts on the page to the bottom of the
 * window". CSS cannot say "100vh minus whatever sits above me" (the
 * Dashboard's top bar, breadcrumbs and page tabs vary by page and wrap),
 * so the shell measures the root's document top here and hands the result
 * to Tailwind as a CSS variable (xl:h-[var(--oneuptime-replay-fill-height)]).
 * Below xl the variable is simply unused and the page flows as before.
 *
 * The pure pieces (compute, measure, observe) live here, apart from the
 * useReplayFillHeight hook in ReplayFillHeight.ts, and take plain objects:
 * App's Jest project runs them in the node environment, with no DOM and no
 * React to resolve (App/Tests/FeatureSetImportsStayReactFree.test.ts).
 */

/*
 * The floor: below this a laptop with a tall header would squeeze the
 * stage to a strip. The page scrolls instead, which is the lesser evil.
 */
export const REPLAY_FILL_MIN_HEIGHT_PX: number = 600;

/* Breathing room under the player so its card border is not flush with the window edge. */
export const REPLAY_FILL_BOTTOM_GUTTER_PX: number = 16;

export const REPLAY_FILL_HEIGHT_CSS_VAR: string =
  "--oneuptime-replay-fill-height";

/*
 * max(minHeight, viewportHeight - rootDocumentTop - bottomGutter), rounded
 * down to a whole pixel (a fractional height re-measures as a different
 * value and a round-up can cost a scrollbar). A non-finite input - an
 * unmeasured element, a NaN from a detached node - gives the floor rather
 * than a NaN height.
 */
export function computeReplayFillHeight(args: {
  viewportHeight: number;
  rootDocumentTop: number;
  bottomGutterPx?: number;
  minHeightPx?: number;
}): number {
  const minHeightPx: number =
    typeof args.minHeightPx === "number" && Number.isFinite(args.minHeightPx)
      ? args.minHeightPx
      : REPLAY_FILL_MIN_HEIGHT_PX;
  const bottomGutterPx: number =
    typeof args.bottomGutterPx === "number" &&
    Number.isFinite(args.bottomGutterPx)
      ? args.bottomGutterPx
      : REPLAY_FILL_BOTTOM_GUTTER_PX;

  if (
    typeof args.viewportHeight !== "number" ||
    !Number.isFinite(args.viewportHeight) ||
    typeof args.rootDocumentTop !== "number" ||
    !Number.isFinite(args.rootDocumentTop)
  ) {
    return Math.floor(minHeightPx);
  }

  return Math.floor(
    Math.max(
      minHeightPx,
      args.viewportHeight - args.rootDocumentTop - bottomGutterPx,
    ),
  );
}

/* The subset of an element the measurement reads. */
export interface ReplayFillHeightElementLike {
  getBoundingClientRect(): { top: number };
  parentElement?: Element | null | undefined;
}

export interface ReplayFillHeightResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export type ReplayFillHeightResizeObserverConstructor = new (
  callback: () => void,
) => ReplayFillHeightResizeObserverLike;

/* The subset of window the measurement and the subscription touch. */
export interface ReplayFillHeightViewLike {
  innerHeight: number;
  scrollY: number;
  addEventListener(type: "resize", listener: () => void): void;
  removeEventListener(type: "resize", listener: () => void): void;
  ResizeObserver?: ReplayFillHeightResizeObserverConstructor | undefined;
  document?: { documentElement?: Element | null | undefined } | undefined;
}

/*
 * The fill height for `element` right now. Document top, not viewport top:
 * a viewer who scrolled the page a little must not grow the player by the
 * scrolled amount (and shrink it back on scroll up).
 */
export function measureReplayFillHeight(
  element: ReplayFillHeightElementLike,
  view: ReplayFillHeightViewLike,
): number {
  let viewportTop: number = NaN;

  try {
    viewportTop = element.getBoundingClientRect().top;
  } catch {
    /* A detached or exotic node: the floor below is fine. */
  }

  const scrollY: number = Number.isFinite(view.scrollY) ? view.scrollY : 0;

  return computeReplayFillHeight({
    viewportHeight: view.innerHeight,
    rootDocumentTop: viewportTop + scrollY,
  });
}

/*
 * Measures now and again whenever the answer may have changed: the window
 * resized, or the document or the player's parent changed size (a banner
 * above the player appeared, the side menu collapsed, the page tabs
 * wrapped - none of which fires a window resize). ResizeObserver is used
 * when the browser has it; the window resize listener alone is the
 * fallback. onChange only hears a value that differs from the last one,
 * so the observer firing for the player's own growth - which does not move
 * its top - costs a measurement and nothing else. Returns the cleanup.
 */
export function observeReplayFillHeight(args: {
  element: ReplayFillHeightElementLike;
  view: ReplayFillHeightViewLike;
  onChange: (height: number) => void;
}): () => void {
  let lastHeight: number | null = null;
  let isDisposed: boolean = false;

  const update: () => void = (): void => {
    if (isDisposed) {
      return;
    }

    const next: number = measureReplayFillHeight(args.element, args.view);

    if (next === lastHeight) {
      return;
    }

    lastHeight = next;
    args.onChange(next);
  };

  update();

  args.view.addEventListener("resize", update);

  let observer: ReplayFillHeightResizeObserverLike | null = null;
  const ObserverConstructor:
    | ReplayFillHeightResizeObserverConstructor
    | undefined = args.view.ResizeObserver;

  if (typeof ObserverConstructor === "function") {
    try {
      observer = new ObserverConstructor(update);

      const documentElement: Element | null | undefined =
        args.view.document?.documentElement;

      if (documentElement) {
        observer.observe(documentElement);
      }

      if (args.element.parentElement) {
        observer.observe(args.element.parentElement);
      }
    } catch {
      /* The resize listener still keeps the height right for window changes. */
      observer = null;
    }
  }

  return (): void => {
    isDisposed = true;
    args.view.removeEventListener("resize", update);

    if (observer) {
      observer.disconnect();
    }
  };
}
