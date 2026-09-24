import React, {
  CSSProperties,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ReplayEngine,
  ReplayEngineListener,
  ReplayEngineReplayerEvent,
  ReplayEngineSnapshot,
  ReplayRecordedSize,
  ReplayerLike,
} from "./Engine/ReplayEngineTypes";
import {
  SESSION_REPLAY_LEGACY_MOUSEMOVE_SAMPLE_MS,
  SESSION_REPLAY_MOUSEMOVE_SAMPLE_MS,
} from "Common/Types/Rum/SessionReplay";

/*
 * The playback surface, as a thin React binding over the engine.
 *
 * Everything about WHAT plays (chunk feeding, seeks, stalls, gaps, idle
 * skips) lives in Engine/ReplayEngine.ts and is tested there without a
 * DOM. This component owns only what needs one: mounting the engine's
 * host element, measuring the box and scaling the picture to fit it,
 * reserving the recorded aspect before the first frame, the phone frame
 * for mobile recordings, the CSP meta injected into every rebuilt replay
 * document, the touch ring, and the cursor/trail styles.
 *
 * This file never imports rrweb. The Replayer is constructed by the
 * engine through a factory that SessionReplayPlayer.tsx - the single file
 * allowed to reference the package, behind a dynamic import() - hands in.
 */

/*
 * "contain" (Fit) scales the whole recorded viewport into the box;
 * "width" fills the box's width and scrolls the page vertically inside it,
 * which is what a tall recording in a wide player wants; "actual" draws it
 * 1:1 in a scroll box.
 */
export type ReplayStageFit = "contain" | "width" | "actual";

/*
 * Where the box's height comes from.
 *
 * "responsive": below xl the box follows document flow - its height is the
 * recorded aspect over the available width, capped so a tall recording does
 * not push the transport off screen. From xl up the player is an app-like
 * surface with a definite height, and the box takes all the height its
 * flex column leaves over.
 *
 * "fill": the box takes the leftover height at every width. Theater
 * (native fullscreen) always has a definite height, so it uses this.
 */
export type ReplayStageSizing = "responsive" | "fill";

export interface ReplayStageProps {
  engine: ReplayEngine;
  /*
   * The recorded viewport from the manifest header. Reserves the stage's
   * aspect ratio before rrweb reports its first Meta, so the layout below
   * the stage does not jump when the first frame lands.
   */
  viewportWidth?: number | null | undefined;
  viewportHeight?: number | null | undefined;
  /* How the box gets its height; see ReplayStageSizing. */
  sizing?: ReplayStageSizing | undefined;
  /*
   * Superseded by `sizing`. Honoured only when `sizing` is absent, where
   * theater means "fill", so a caller that has not moved over yet still
   * gets a full-height stage in fullscreen.
   */
  isTheater?: boolean | undefined;
  fit?: ReplayStageFit | undefined;
  /* Draw the phone frame. Defaults to "recorded width below 600px". */
  isMobile?: boolean | undefined;
  /* The scale in force, for the "1440x900 -> 62%" chip. */
  onScaleChange?: ((scale: number) => void) | undefined;
  /*
   * Paused, read-only inspection mode. rrweb disables iframe hit-testing by
   * default; this opt-in lets a viewer select and copy the captured text.
   */
  isTextSelectionEnabled?: boolean | undefined;
  /*
   * What the recorder said it could do, from the manifest. Only one entry
   * matters here: whether mouse movement was sampled at the faster
   * cadence, which sets how long the cursor takes to cross between two
   * recorded positions.
   */
  recorderCapabilities?: ReadonlyArray<string> | undefined;
  className?: string | undefined;
}

/*
 * Flow-mode bounds (below xl, not theater). The cap keeps a tall recording
 * from pushing the timeline and transport below the fold on a tablet; the
 * floor keeps a very wide one from collapsing into a strip. From xl up the
 * height comes from the player's flex column instead and neither applies.
 * The class strings below spell these out literally (Tailwind needs whole
 * class names in the source); a test keeps the two in step.
 */
export const REPLAY_STAGE_FLOW_MAX_HEIGHT_VH: number = 70;
export const REPLAY_STAGE_FLOW_MIN_HEIGHT_REM: number = 14;

/* The recorded "W / H", read by the responsive box's aspect-ratio class. */
export const REPLAY_STAGE_ASPECT_CSS_VAR: string = "--oneuptime-replay-aspect";

export const REPLAY_STAGE_RESPONSIVE_BOX_CLASS: string =
  "oneuptime-replay-stage relative w-full bg-gray-100 [aspect-ratio:var(--oneuptime-replay-aspect)] max-h-[70vh] min-h-[14rem] xl:h-full xl:min-h-0 xl:max-h-none xl:flex-1 xl:[aspect-ratio:auto]";
export const REPLAY_STAGE_FILL_BOX_CLASS: string =
  "oneuptime-replay-stage relative h-full min-h-0 w-full flex-1 bg-gray-100";

/*
 * Scrolling per fit. Width-fit scrolls only vertically, and keeps the
 * scrollbar gutter reserved: otherwise the scrollbar appearing narrows the
 * box, the narrower box scales the page down until it no longer overflows,
 * the scrollbar goes away and the two fight forever at the boundary.
 */
export const REPLAY_STAGE_FIT_OVERFLOW_CLASS: Record<ReplayStageFit, string> = {
  contain: "overflow-hidden",
  width: "overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
  actual: "overflow-auto",
};

/*
 * The stage box's classes, exported so the shell's placeholder (drawn
 * before the engine exists) reserves exactly the same box and the layout
 * does not jump when the real stage replaces it.
 */
export function getReplayStageBoxClassName(
  sizing: ReplayStageSizing,
  fit: ReplayStageFit,
): string {
  const sizingClass: string =
    sizing === "fill"
      ? REPLAY_STAGE_FILL_BOX_CLASS
      : REPLAY_STAGE_RESPONSIVE_BOX_CLASS;

  return `${sizingClass} ${
    REPLAY_STAGE_FIT_OVERFLOW_CLASS[fit] ??
    REPLAY_STAGE_FIT_OVERFLOW_CLASS.contain
  }`;
}

/* Recordings narrower than this get the phone-shaped frame. */
export const REPLAY_STAGE_MOBILE_MAX_WIDTH_PX: number = 600;

/*
 * The phone frame's ring (Tailwind ring-8) is a box-shadow drawn OUTSIDE
 * the frame. The box clips, so the fit reserves this much on every side;
 * otherwise a height-limited phone recording lost its ring top and bottom.
 */
export const REPLAY_STAGE_PHONE_RING_PX: number = 8;

/* rrweb draws a 28px ring where a TouchStart landed. */
export const REPLAY_STAGE_TOUCH_RING_PX: number = 28;
const TOUCH_RING_LIFETIME_MS: number = 700;

/* Fallback aspect before any size is known. */
const DEFAULT_ASPECT: ReplayRecordedSize = { width: 16, height: 9 };

/*
 * The value for REPLAY_STAGE_ASPECT_CSS_VAR: the recorded size, or 16 / 9
 * before any size is known (a missing or non-positive dimension counts as
 * unknown).
 */
export function formatReplayStageAspect(
  recorded: ReplayRecordedSize | null | undefined,
): string {
  const aspect: ReplayRecordedSize =
    recorded && recorded.width > 0 && recorded.height > 0
      ? recorded
      : DEFAULT_ASPECT;

  return `${aspect.width} / ${aspect.height}`;
}

/*
 * The Content-Security-Policy injected INSIDE the replay document.
 *
 * Scope, precisely: this meta tag is inserted on construction (into the
 * blank document, which rrweb then discards) and again on every
 * "fullsnapshot-rebuilded" event. rrweb emits that event AFTER rebuild()
 * has built the whole DOM and after insertStyleRules, so any subresource
 * the snapshot itself references - img src, link href, srcset, font URLs
 * - has already been requested by the time these directives exist. What
 * the tag genuinely covers is everything the document does AFTER a
 * rebuild: the incremental mutations rrweb applies as playback advances.
 *
 * The real control is sandbox="allow-same-origin" with no allow-scripts,
 * which rrweb sets and which UNSAFE_replayCanvas: false keeps in place.
 *
 * What is NOT closed here, stated plainly so nobody reads this comment as
 * a guarantee: rebuild-time outbound requests to hosts the recorded page
 * referenced still leave the viewer's browser from the Dashboard origin.
 * The referrer meta below stops the replay URL (with the session id)
 * riding along on them; removing them entirely needs the recorded
 * resource URLs neutralised at ingest, which is tracked as a follow-up
 * and is not something this component can do after the fact.
 */
export const REPLAY_DOCUMENT_CSP: string =
  "script-src 'none'; default-src 'none'; img-src data: blob:; " +
  "style-src 'unsafe-inline'; font-src data:; media-src 'none'; connect-src 'none'";

/*
 * rrweb deliberately starts every replay iframe with pointer-events:none.
 * That is a safe playback default, but it also means a viewer cannot select
 * the already-recorded, already-masked DOM text to paste into a bug report.
 *
 * The attribute selector gives this rule enough specificity to beat common
 * `.select-none` utility classes. It is injected after the recorded page's
 * styles and uses !important because selection is a viewer affordance, not a
 * visual property whose recorded value needs to be preserved.
 */
export const REPLAY_TEXT_SELECTION_CSS: string = `
html[data-oneuptime-replay-text-selection],
html[data-oneuptime-replay-text-selection] body,
html[data-oneuptime-replay-text-selection] body * {
  -webkit-user-select: text !important;
  user-select: text !important;
}
html[data-oneuptime-replay-text-selection] textarea {
  resize: none !important;
}
html[data-oneuptime-replay-text-selection] audio,
html[data-oneuptime-replay-text-selection] video,
html[data-oneuptime-replay-text-selection] embed,
html[data-oneuptime-replay-text-selection] object {
  pointer-events: none !important;
}
`;
const REPLAY_SHADOW_TEXT_SELECTION_CSS: string = `
:host,
:host * {
  -webkit-user-select: text !important;
  user-select: text !important;
}
:host textarea {
  resize: none !important;
}
:host audio,
:host video,
:host embed,
:host object {
  pointer-events: none !important;
}
`;

/*
 * Exported so the frame capture (ReplayFrameCapture) can leave the
 * selection affordances out of a screenshot: they are viewer chrome, not
 * something the recorded page drew.
 */
export const REPLAY_TEXT_SELECTION_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection";
export const REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection-style";
export const REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-shadow-text-selection-style";

const enabledReplayDocuments: WeakSet<Document> = new WeakSet<Document>();
const observedReplayFrames: WeakSet<HTMLIFrameElement> =
  new WeakSet<HTMLIFrameElement>();
const replayDocumentMutationObservers: WeakMap<Document, MutationObserver> =
  new WeakMap<Document, MutationObserver>();
const replayRootSelectionAttributes: WeakMap<
  Document,
  Map<HTMLElement, string | null>
> = new WeakMap<Document, Map<HTMLElement, string | null>>();
const replayDocumentSelectionStyles: WeakMap<
  Document,
  Set<HTMLStyleElement>
> = new WeakMap<Document, Set<HTMLStyleElement>>();
interface ReplayShadowRootState {
  observer: MutationObserver | null;
  style: HTMLStyleElement | null;
}
const replayShadowRootStates: WeakMap<
  Document,
  Map<ShadowRoot, ReplayShadowRootState>
> = new WeakMap<Document, Map<ShadowRoot, ReplayShadowRootState>>();
interface ReplayNavigationTargetAttributes {
  href: string | null;
  xlinkHref: string | null;
}
const replayNavigationTargetHrefs: WeakMap<
  Document,
  Map<Element, ReplayNavigationTargetAttributes>
> = new WeakMap<Document, Map<Element, ReplayNavigationTargetAttributes>>();
const XLINK_NAMESPACE: string = "http://www.w3.org/1999/xlink";
/*
 * A fixed no-op keeps :link selectors intact without giving native browser
 * menus a destination. The replay iframe has no allow-scripts sandbox token
 * and REPLAY_DOCUMENT_CSP also declares script-src 'none', so even a browser
 * UI action that bypasses DOM events cannot evaluate this URL.
 */
const DISABLED_REPLAY_NAVIGATION_URL: string = "javascript:void(0)";
interface ReplayScrollPosition {
  left: number;
  top: number;
}
const replayScrollPositions: WeakMap<
  Document,
  Map<Element, ReplayScrollPosition>
> = new WeakMap<Document, Map<Element, ReplayScrollPosition>>();
const replayInlineStyles: WeakMap<
  Document,
  Map<Element, string | null>
> = new WeakMap<Document, Map<Element, string | null>>();
interface ReplayFrameInteractionAttributes {
  inert: string | null;
  tabIndex: string | null;
}
const replayFrameInteractionAttributes: WeakMap<
  Document,
  Map<HTMLIFrameElement, ReplayFrameInteractionAttributes>
> = new WeakMap<
  Document,
  Map<HTMLIFrameElement, ReplayFrameInteractionAttributes>
>();

function applyReplayInlineStyle(
  doc: Document,
  element: Element,
  property: string,
  value: string,
): void {
  const style: CSSStyleDeclaration | undefined = (
    element as Element & { style?: CSSStyleDeclaration }
  ).style;

  if (!style) {
    return;
  }

  let elements: Map<Element, string | null> | undefined =
    replayInlineStyles.get(doc);

  if (!elements) {
    elements = new Map<Element, string | null>();
    replayInlineStyles.set(doc, elements);
  }

  if (!elements.has(element)) {
    /*
     * Keep the complete attribute, including whether it existed at all.
     * Chromium aliases user-select and -webkit-user-select in the style
     * declaration, so restoring properties independently can preserve our
     * second override. Restoring the exact attribute also avoids leaving
     * style="" behind on a previously style-less recorded element.
     */
    elements.set(element, element.getAttribute("style"));
  }

  style.setProperty(property, value, "important");
}

function restoreReplayInlineStyles(doc: Document): void {
  const elements: Map<Element, string | null> | undefined =
    replayInlineStyles.get(doc);

  if (!elements) {
    return;
  }

  for (const [element, previous] of elements) {
    if (previous === null) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", previous);
    }
  }

  replayInlineStyles.delete(doc);
}

function getReplayFrameInteractionAttributes(
  doc: Document,
  frame: HTMLIFrameElement,
): ReplayFrameInteractionAttributes {
  let frames:
    | Map<HTMLIFrameElement, ReplayFrameInteractionAttributes>
    | undefined = replayFrameInteractionAttributes.get(doc);

  if (!frames) {
    frames = new Map<HTMLIFrameElement, ReplayFrameInteractionAttributes>();
    replayFrameInteractionAttributes.set(doc, frames);
  }

  let attributes: ReplayFrameInteractionAttributes | undefined =
    frames.get(frame);

  if (!attributes) {
    attributes = {
      inert: frame.getAttribute("inert"),
      tabIndex: frame.getAttribute("tabindex"),
    };
    frames.set(frame, attributes);
  }

  return attributes;
}

function restoreReplayFrameInteractionAttributes(doc: Document): void {
  const frames:
    | Map<HTMLIFrameElement, ReplayFrameInteractionAttributes>
    | undefined = replayFrameInteractionAttributes.get(doc);

  if (!frames) {
    return;
  }

  for (const [frame, attributes] of frames) {
    for (const [name, value] of [
      ["inert", attributes.inert],
      ["tabindex", attributes.tabIndex],
    ] as const) {
      if (value === null) {
        frame.removeAttribute(name);
      } else {
        frame.setAttribute(name, value);
      }
    }
  }

  replayFrameInteractionAttributes.delete(doc);
}

function markReplayDocumentRoot(doc: Document, root: HTMLElement): void {
  let roots: Map<HTMLElement, string | null> | undefined =
    replayRootSelectionAttributes.get(doc);

  if (!roots) {
    roots = new Map<HTMLElement, string | null>();
    replayRootSelectionAttributes.set(doc, roots);
  }

  if (!roots.has(root)) {
    roots.set(root, root.getAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE));
  }

  root.setAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE, "true");
}

function restoreReplayDocumentRoots(doc: Document): void {
  const roots: Map<HTMLElement, string | null> | undefined =
    replayRootSelectionAttributes.get(doc);

  if (!roots) {
    return;
  }

  for (const [root, previous] of roots) {
    if (previous === null) {
      root.removeAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE);
    } else {
      root.setAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE, previous);
    }
  }

  replayRootSelectionAttributes.delete(doc);
}

function ensureReplayDocumentSelectionStyle(
  doc: Document,
  head: HTMLHeadElement,
): void {
  let styles: Set<HTMLStyleElement> | undefined =
    replayDocumentSelectionStyles.get(doc);

  if (!styles) {
    styles = new Set<HTMLStyleElement>();
    replayDocumentSelectionStyles.set(doc, styles);
  }

  for (const style of styles) {
    if (style.parentNode === head) {
      return;
    }
  }

  const style: HTMLStyleElement = doc.createElement("style");
  style.setAttribute(REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE, "true");
  style.textContent = REPLAY_TEXT_SELECTION_CSS;
  head.appendChild(style);
  styles.add(style);
}

function removeReplayDocumentSelectionStyles(doc: Document): void {
  const styles: Set<HTMLStyleElement> | undefined =
    replayDocumentSelectionStyles.get(doc);

  if (!styles) {
    return;
  }

  for (const style of styles) {
    style.remove();
  }

  replayDocumentSelectionStyles.delete(doc);
}

function neutralizeReplayNavigationTargets(
  doc: Document,
  root: ParentNode,
): void {
  const targets: NodeListOf<Element> = root.querySelectorAll("a, area");
  let hrefs: Map<Element, ReplayNavigationTargetAttributes> | undefined =
    replayNavigationTargetHrefs.get(doc);

  for (const target of Array.from(targets)) {
    const href: string | null = target.getAttribute("href");
    const xlinkHref: string | null = target.getAttributeNS(
      XLINK_NAMESPACE,
      "href",
    );

    if (href === null && xlinkHref === null) {
      continue;
    }

    if (!hrefs) {
      hrefs = new Map<Element, ReplayNavigationTargetAttributes>();
      replayNavigationTargetHrefs.set(doc, hrefs);
    }

    if (!hrefs.has(target)) {
      hrefs.set(target, { href: href, xlinkHref: xlinkHref });
    }

    /*
     * Keep :link/:any-link/a[href] matching so the paused picture does not
     * reflow, but replace native context-menu/callout destinations with a
     * harmless document. Capture listeners remain the first line of defence.
     */
    if (href !== null) {
      target.setAttribute("href", DISABLED_REPLAY_NAVIGATION_URL);
    }

    if (xlinkHref !== null) {
      target.setAttributeNS(
        XLINK_NAMESPACE,
        "xlink:href",
        DISABLED_REPLAY_NAVIGATION_URL,
      );
    }
  }
}

function restoreReplayNavigationTargets(doc: Document): void {
  const hrefs: Map<Element, ReplayNavigationTargetAttributes> | undefined =
    replayNavigationTargetHrefs.get(doc);

  if (!hrefs) {
    return;
  }

  for (const [target, attributes] of hrefs) {
    if (attributes.href !== null) {
      target.setAttribute("href", attributes.href);
    }

    if (attributes.xlinkHref !== null) {
      target.setAttributeNS(
        XLINK_NAMESPACE,
        "xlink:href",
        attributes.xlinkHref,
      );
    }
  }

  replayNavigationTargetHrefs.delete(doc);
}

function getReplayScrollPositions(
  doc: Document,
): Map<Element, ReplayScrollPosition> {
  const existing: Map<Element, ReplayScrollPosition> | undefined =
    replayScrollPositions.get(doc);

  if (existing) {
    return existing;
  }

  const positions: Map<Element, ReplayScrollPosition> = new Map<
    Element,
    ReplayScrollPosition
  >();
  replayScrollPositions.set(doc, positions);
  return positions;
}

function rememberReplayRootScrollPositions(
  doc: Document,
  root: ParentNode,
): void {
  const positions: Map<Element, ReplayScrollPosition> =
    getReplayScrollPositions(doc);
  const elements: NodeListOf<Element> = root.querySelectorAll("*");

  for (const element of Array.from(elements)) {
    const tagName: string = element.tagName.toLowerCase();
    const computedStyle: CSSStyleDeclaration | undefined =
      doc.defaultView?.getComputedStyle(element);
    const effectiveUserSelect: string | undefined =
      computedStyle?.getPropertyValue("user-select") ||
      computedStyle?.getPropertyValue("-webkit-user-select");

    /*
     * The injected !important rules handle normal recorded CSS. Only touch
     * an element inline when its stronger recorded cascade still wins (most
     * commonly an inline !important declaration), keeping the live replay
     * DOM as close to the snapshot as possible.
     */
    if (effectiveUserSelect !== "text") {
      applyReplayInlineStyle(doc, element, "user-select", "text");
      applyReplayInlineStyle(doc, element, "-webkit-user-select", "text");
    }

    if (
      tagName === "textarea" &&
      computedStyle?.getPropertyValue("resize") !== "none"
    ) {
      applyReplayInlineStyle(doc, element, "resize", "none");
    }

    if (
      ["audio", "video", "embed", "object"].includes(tagName) &&
      computedStyle?.getPropertyValue("pointer-events") !== "none"
    ) {
      applyReplayInlineStyle(doc, element, "pointer-events", "none");
    }

    if (!positions.has(element)) {
      positions.set(element, {
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    }
  }

  const scrollingElement: Element | null = doc.scrollingElement;

  if (scrollingElement && !positions.has(scrollingElement)) {
    positions.set(scrollingElement, {
      left: scrollingElement.scrollLeft,
      top: scrollingElement.scrollTop,
    });
  }
}

function restoreReplayScrollPosition(
  element: Element,
  position: ReplayScrollPosition,
): void {
  if (
    element.scrollLeft === position.left &&
    element.scrollTop === position.top
  ) {
    return;
  }

  const style: CSSStyleDeclaration | undefined = (
    element as Element & { style?: CSSStyleDeclaration }
  ).style;
  const previousStyleAttribute: string | null = element.getAttribute("style");

  style?.setProperty("scroll-behavior", "auto", "important");
  element.scrollLeft = position.left;
  element.scrollTop = position.top;

  if (previousStyleAttribute === null) {
    element.removeAttribute("style");
  } else {
    element.setAttribute("style", previousStyleAttribute);
  }
}

function preventReplayDefault(event: Event): void {
  if (!enabledReplayDocuments.has(event.currentTarget as Document)) {
    return;
  }

  event.preventDefault();
}

function closestReplayElement(
  target: EventTarget | null,
  selector: string,
): Element | null {
  const closest: ((value: string) => Element | null) | undefined = (
    target as Element | null
  )?.closest;

  return typeof closest === "function" ? closest.call(target, selector) : null;
}

function getReplayEventPath(event: Event): EventTarget[] {
  if (typeof event.composedPath === "function") {
    return event.composedPath();
  }

  return event.target ? [event.target] : [];
}

function closestReplayEventElement(
  event: Event,
  selector: string,
): Element | null {
  const path: EventTarget[] = getReplayEventPath(event);

  for (const target of path) {
    const match: Element | null = closestReplayElement(target, selector);

    if (match) {
      return match;
    }
  }

  return null;
}

function isTextSelectableControl(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  const tagName: string = element.tagName.toLowerCase();

  if (tagName === "textarea") {
    return true;
  }

  const contentEditable: string | null =
    element.getAttribute("contenteditable");

  if (contentEditable !== null) {
    return contentEditable.toLowerCase() !== "false";
  }

  if (tagName !== "input") {
    return false;
  }

  return ["email", "password", "search", "tel", "text", "url"].includes(
    ((element as HTMLInputElement).type || "text").toLowerCase(),
  );
}

function rememberReplayScrollPositions(event: Event): void {
  const doc: Document = event.currentTarget as Document;
  const positions: Map<Element, ReplayScrollPosition> =
    getReplayScrollPositions(doc);

  const path: EventTarget[] = getReplayEventPath(event);

  for (const target of path) {
    const element: Element = target as Element;

    if (
      typeof element.scrollLeft === "number" &&
      typeof element.scrollTop === "number" &&
      !positions.has(element)
    ) {
      positions.set(element, {
        left: element.scrollLeft,
        top: element.scrollTop,
      });
    }
  }

  const scrollingElement: Element | null = doc.scrollingElement;

  if (scrollingElement && !positions.has(scrollingElement)) {
    positions.set(scrollingElement, {
      left: scrollingElement.scrollLeft,
      top: scrollingElement.scrollTop,
    });
  }
}

/*
 * A click guard is too late for sliders, colour/date pickers and similar
 * controls: browsers may mutate them during pointer handling. Text fields and
 * textareas remain pointer-selectable; every other native control is inert.
 */
function preventReplayControlPointerMutation(event: Event): void {
  if (!enabledReplayDocuments.has(event.currentTarget as Document)) {
    return;
  }

  rememberReplayScrollPositions(event);
  const control: Element | null = closestReplayEventElement(
    event,
    "input, select, option, audio, video, embed, object",
  );

  if (control && !isTextSelectableControl(control)) {
    event.preventDefault();
  }
}

/*
 * Text selection may focus a recorded form control. Let the viewer use the
 * native copy/select-all shortcuts and extend a selection with Shift+Arrow,
 * but suppress keys that could edit or operate that recorded control.
 */
function preventReplayKeyboardMutation(event: Event): void {
  if (!enabledReplayDocuments.has(event.currentTarget as Document)) {
    return;
  }

  const keyboardEvent: KeyboardEvent = event as KeyboardEvent;
  const key: string = keyboardEvent.key.toLowerCase();
  const interactive: Element | null = closestReplayEventElement(
    keyboardEvent,
    "input, textarea, select, button, a[href], summary, audio[controls], video[controls], embed, object, [contenteditable]",
  );
  const isStatefulControl: boolean =
    interactive !== null &&
    [
      "input",
      "select",
      "button",
      "summary",
      "audio",
      "video",
      "embed",
      "object",
    ].includes(interactive.tagName.toLowerCase()) &&
    !isTextSelectableControl(interactive);
  const isCopyOrSelectAll: boolean =
    (keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
    (key === "c" || key === "a" || key === "insert");
  const isExtendingSelection: boolean =
    keyboardEvent.shiftKey &&
    !isStatefulControl &&
    ["arrowleft", "arrowright", "arrowup", "arrowdown", "home", "end"].includes(
      key,
    );
  const isFocusTraversal: boolean = key === "tab";

  if (isCopyOrSelectAll || isExtendingSelection || isFocusTraversal) {
    return;
  }

  const scrollKeys: string[] = [
    " ",
    "spacebar",
    "pageup",
    "pagedown",
    "arrowleft",
    "arrowright",
    "arrowup",
    "arrowdown",
    "home",
    "end",
  ];
  const hasCommandModifier: boolean =
    keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey;
  const isEditingKey: boolean =
    interactive !== null &&
    ((!hasCommandModifier && key.length === 1) ||
      ["backspace", "delete", "enter", "escape"].includes(key) ||
      ((keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
        ["v", "x", "y", "z"].includes(key)) ||
      (isStatefulControl && scrollKeys.includes(key)));
  const isPageScroll: boolean =
    scrollKeys.includes(key) &&
    (!isTextSelectableControl(interactive) ||
      ["pageup", "pagedown"].includes(key));

  if (isEditingKey || isPageScroll) {
    keyboardEvent.preventDefault();
  }
}

/*
 * Keep the native copy menu available over ordinary text (including link
 * text, whose destination is neutralised separately), but do not expose
 * browser actions that can reload or navigate a captured frame.
 */
function preventReplayNavigationContextMenu(event: Event): void {
  if (!enabledReplayDocuments.has(event.currentTarget as Document)) {
    return;
  }

  if (closestReplayEventElement(event, "iframe")) {
    event.preventDefault();
  }
}

const REPLAY_DEFAULT_GUARD_EVENTS: ReadonlyArray<string> = [
  "click",
  "auxclick",
  "submit",
  "beforeinput",
  "paste",
  "cut",
  "dragstart",
  "drop",
  "wheel",
  "touchmove",
];
const REPLAY_POINTER_GUARD_EVENTS: ReadonlyArray<string> = [
  "pointerdown",
  "mousedown",
  "touchstart",
];

function removeReplayDocumentGuards(doc: Document): void {
  for (const type of REPLAY_DEFAULT_GUARD_EVENTS) {
    doc.removeEventListener(type, preventReplayDefault, true);
  }

  for (const type of REPLAY_POINTER_GUARD_EVENTS) {
    doc.removeEventListener(type, preventReplayControlPointerMutation, true);
  }

  doc.removeEventListener("keydown", preventReplayKeyboardMutation, true);
  doc.removeEventListener(
    "contextmenu",
    preventReplayNavigationContextMenu,
    true,
  );
  replayDocumentMutationObservers.get(doc)?.disconnect();
  replayDocumentMutationObservers.delete(doc);
}

function installReplayDocumentGuards(doc: Document): void {
  /*
   * rrweb rebuilds a FullSnapshot with document.open(). Chromium keeps the
   * Document identity but removes its listeners, so a WeakSet cannot tell us
   * whether guards still exist. Removing the stable callbacks first makes
   * installation idempotent and also repairs that rebuild case.
   */
  removeReplayDocumentGuards(doc);

  for (const type of REPLAY_DEFAULT_GUARD_EVENTS) {
    doc.addEventListener(type, preventReplayDefault, {
      capture: true,
      passive: false,
    });
  }

  for (const type of REPLAY_POINTER_GUARD_EVENTS) {
    doc.addEventListener(type, preventReplayControlPointerMutation, {
      capture: true,
      passive: false,
    });
  }

  doc.addEventListener("keydown", preventReplayKeyboardMutation, true);
  doc.addEventListener("contextmenu", preventReplayNavigationContextMenu, true);

  const MutationObserverClass: typeof MutationObserver | undefined =
    doc.defaultView?.MutationObserver;

  if (MutationObserverClass) {
    const observer: MutationObserver = new MutationObserverClass((): void => {
      if (enabledReplayDocuments.has(doc)) {
        enableNestedReplayDocuments(doc);
        enableReplayShadowRoots(doc, doc);
      }
    });
    observer.observe(doc, { childList: true, subtree: true });
    replayDocumentMutationObservers.set(doc, observer);
  }
}

/* Recorded open shadow roots need their own cascade and mutation observer. */
function enableReplayShadowRoots(root: ParentNode, doc: Document): void {
  rememberReplayRootScrollPositions(doc, root);
  neutralizeReplayNavigationTargets(doc, root);
  const elements: NodeListOf<Element> = root.querySelectorAll("*");

  for (const element of Array.from(elements)) {
    const shadowRoot: ShadowRoot | null = element.shadowRoot;

    if (!shadowRoot) {
      continue;
    }

    let states: Map<ShadowRoot, ReplayShadowRootState> | undefined =
      replayShadowRootStates.get(doc);

    if (!states) {
      states = new Map<ShadowRoot, ReplayShadowRootState>();
      replayShadowRootStates.set(doc, states);
    }

    let state: ReplayShadowRootState | undefined = states.get(shadowRoot);

    if (!state) {
      const MutationObserverClass: typeof MutationObserver | undefined =
        doc.defaultView?.MutationObserver;
      let observer: MutationObserver | null = null;

      if (MutationObserverClass) {
        observer = new MutationObserverClass((): void => {
          if (enabledReplayDocuments.has(doc)) {
            enableReplayShadowRoots(shadowRoot, doc);
            enableNestedReplayDocuments(doc, shadowRoot);
          }
        });
        observer.observe(shadowRoot, { childList: true, subtree: true });
      }

      state = { observer: observer, style: null };
      states.set(shadowRoot, state);
    }

    if (!state.style || state.style.parentNode !== shadowRoot) {
      const style: HTMLStyleElement = doc.createElement("style");
      style.setAttribute(REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE, "true");
      style.textContent = REPLAY_SHADOW_TEXT_SELECTION_CSS;
      shadowRoot.appendChild(style);
      state.style = style;
    }

    enableNestedReplayDocuments(doc, shadowRoot);
    enableReplayShadowRoots(shadowRoot, doc);
  }
}

function disableReplayShadowRoots(doc: Document): void {
  const states: Map<ShadowRoot, ReplayShadowRootState> | undefined =
    replayShadowRootStates.get(doc);

  if (!states) {
    return;
  }

  for (const [shadowRoot, state] of states) {
    state.observer?.disconnect();
    state.style?.remove();
    const frames: NodeListOf<HTMLIFrameElement> =
      shadowRoot.querySelectorAll<HTMLIFrameElement>("iframe");

    for (const frame of Array.from(frames)) {
      try {
        if (frame.contentDocument) {
          disableReplayDocumentTextSelection(frame.contentDocument);
        }
      } catch {
        // Cross-origin shadow children were never enabled.
      }
    }
  }

  replayShadowRootStates.delete(doc);
}

/*
 * Make the replay a read-only text surface.
 *
 * We do not call rrweb's enableInteract(): besides pointer hit-testing it
 * turns scrolling back on, and unrestricted interaction lets links navigate,
 * controls toggle, forms submit and inputs diverge from the recording. Native
 * selection only needs the iframe to receive pointer events. The capture
 * guards below keep every state-changing browser default inert while leaving
 * selection and copy alone. The context menu is available on ordinary text,
 * but suppressed on recorded navigation targets.
 */
function enableReplayDocumentTextSelection(doc: Document): void {
  enabledReplayDocuments.add(doc);
  const root: HTMLElement | null = doc.documentElement;
  const head: HTMLHeadElement | null = doc.head;

  if (root) {
    markReplayDocumentRoot(doc, root);
  }

  if (head) {
    ensureReplayDocumentSelectionStyle(doc, head);
  }

  /*
   * click/auxclick cover links, buttons, checkboxes, details and file inputs.
   * submit covers keyboard-submitted forms. beforeinput plus clipboard and
   * drag events keep inputs/contenteditable nodes read-only without disabling
   * them (disabled fields cannot select text).
   */
  installReplayDocumentGuards(doc);

  enableNestedReplayDocuments(doc);
  enableReplayShadowRoots(doc, doc);
}

function enableNestedReplayDocuments(
  doc: Document,
  root: ParentNode = doc,
): void {
  const frames: NodeListOf<HTMLIFrameElement> =
    root.querySelectorAll<HTMLIFrameElement>("iframe");

  for (const frame of Array.from(frames)) {
    if (!observedReplayFrames.has(frame)) {
      frame.addEventListener("load", (): void => {
        if (enabledReplayDocuments.has(doc)) {
          enableNestedReplayFrame(doc, frame);
        }
      });
      observedReplayFrames.add(frame);
    }

    enableNestedReplayFrame(doc, frame);
  }
}

function enableNestedReplayFrame(
  parentDocument: Document,
  frame: HTMLIFrameElement,
): void {
  let childDocument: Document | null = null;

  try {
    childDocument = frame.contentDocument;
  } catch {
    // Cross-origin documents are intentionally opaque to the viewer.
  }

  if (!childDocument) {
    /*
     * Events inside an opaque child cannot reach the parent document's
     * guards. Make the recorded frame inert instead of exposing its links or
     * controls, and restore its exact inline style when inspection ends.
     */
    applyReplayInlineStyle(parentDocument, frame, "pointer-events", "none");
    getReplayFrameInteractionAttributes(parentDocument, frame);
    frame.blur();
    frame.setAttribute("inert", "");
    frame.setAttribute("tabindex", "-1");
    return;
  }

  /* Recorded CSS must not prevent selection inside a safe same-origin child. */
  const attributes: ReplayFrameInteractionAttributes =
    getReplayFrameInteractionAttributes(parentDocument, frame);
  frame.removeAttribute("inert");

  if (attributes.tabIndex === null) {
    frame.removeAttribute("tabindex");
  } else {
    frame.setAttribute("tabindex", attributes.tabIndex);
  }

  applyReplayInlineStyle(parentDocument, frame, "pointer-events", "auto");
  enableReplayDocumentTextSelection(childDocument);
}

function disableReplayDocumentTextSelection(doc: Document): void {
  if (!enabledReplayDocuments.delete(doc)) {
    return;
  }

  removeReplayDocumentGuards(doc);

  restoreReplayDocumentRoots(doc);
  removeReplayDocumentSelectionStyles(doc);
  doc.defaultView?.getSelection()?.removeAllRanges();

  const positions: Map<Element, ReplayScrollPosition> | undefined =
    replayScrollPositions.get(doc);

  if (positions) {
    for (const [element, position] of positions) {
      restoreReplayScrollPosition(element, position);
    }
    replayScrollPositions.delete(doc);
  }

  restoreReplayInlineStyles(doc);
  restoreReplayFrameInteractionAttributes(doc);
  restoreReplayNavigationTargets(doc);

  disableReplayShadowRoots(doc);

  const frames: NodeListOf<HTMLIFrameElement> =
    doc.querySelectorAll<HTMLIFrameElement>("iframe");

  for (const frame of Array.from(frames)) {
    try {
      if (frame.contentDocument) {
        disableReplayDocumentTextSelection(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames were never enabled and need no cleanup.
    }
  }
}

export function enableReplayTextSelection(replayer: ReplayerLike): void {
  const iframe: HTMLIFrameElement = replayer.iframe;

  try {
    iframe.style.pointerEvents = "auto";
    iframe.setAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE, "true");
  } catch {
    // A destroyed iframe has no text surface left to enable.
    return;
  }

  const doc: Document | null = iframe.contentDocument;

  if (doc) {
    enableReplayDocumentTextSelection(doc);
  }
}

/* Restore rrweb's non-interactive playback surface when inspection ends. */
export function disableReplayTextSelection(replayer: ReplayerLike): void {
  const iframe: HTMLIFrameElement = replayer.iframe;

  try {
    iframe.style.pointerEvents = "none";
    iframe.removeAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE);
  } catch {
    return;
  }

  const doc: Document | null = iframe.contentDocument;

  if (!doc) {
    return;
  }

  disableReplayDocumentTextSelection(doc);
}

function configureReplayTextSelection(
  replayer: ReplayerLike,
  isEnabled: boolean,
): void {
  if (isEnabled) {
    enableReplayTextSelection(replayer);
    return;
  }

  disableReplayTextSelection(replayer);
}

/*
 * The subset of rrweb/dist/style.css the player actually needs, inlined.
 *
 * Importing the package stylesheet would pull a CSS file into the lazily
 * loaded chunk, and the shared esbuild config has no CSS handling wired for
 * dynamically imported chunks. These are the rules without which the
 * cursor, its trail and the stage are mispositioned.
 *
 * The pointer rules are not decoration. rrweb records mouse movement, but
 * a replay draws no system cursor of its own, so without a visible pointer
 * a recording of somebody hunting around a page reads as a still image
 * with occasional mutations. The cursor is drawn large, ringed and
 * animated between samples (mousemove is sampled every 100ms, so the
 * transition is what turns eight positions a second into a movement), and
 * the tail canvas draws the path it took to get there.
 *
 * The transition duration is a CSS variable the stage sets from the
 * recording's own mouse-sampling interval divided by the playback speed,
 * so one segment ends exactly as the next begins: the pointer glides
 * continuously instead of moving for part of the gap and parking for the
 * rest (80ms against a 100ms sample) or lagging behind the click it
 * caused. A recording that advertises the faster cadence is drawn from
 * that cadence; older footage keeps the interval it was recorded at.
 *
 * The .active ripple is rrweb's click affordance: the class lands on the
 * cursor for the length of a MouseInteraction, and without a rule for it a
 * click is invisible on playback.
 */
export const REPLAY_STAGE_CSS: string = `
.oneuptime-replay-stage .oneuptime-replay-host { position: relative; transform-origin: top left; }
.oneuptime-replay-stage .replayer-wrapper { position: absolute; top: 0; left: 0; transform-origin: top left; }
.oneuptime-replay-stage .replayer-wrapper iframe { border: none; background: #ffffff; }
.oneuptime-replay-stage .replayer-mouse { position: absolute; width: 20px; height: 20px; border-radius: 100%; background: rgba(73,80,246,0.35); box-shadow: 0 0 0 2px rgba(73,80,246,0.9), 0 1px 6px rgba(15,23,42,0.35); transition: left var(--oneuptime-replay-cursor-ms, ${SESSION_REPLAY_LEGACY_MOUSEMOVE_SAMPLE_MS}ms) linear, top var(--oneuptime-replay-cursor-ms, ${SESSION_REPLAY_LEGACY_MOUSEMOVE_SAMPLE_MS}ms) linear; pointer-events: none; z-index: 2147483647; }
.oneuptime-replay-stage .replayer-mouse::after { content: ""; display: inline-block; width: 20px; height: 20px; border-radius: 100%; background: rgba(73,80,246,0.4); transform: translate(-50%, -50%); opacity: 0; }
.oneuptime-replay-stage .replayer-mouse.active::after { animation: oneuptime-replay-click 0.4s ease-in-out 1; }
.oneuptime-replay-stage .replayer-mouse-tail { position: absolute; pointer-events: none; top: 0; left: 0; z-index: 2147483646; }
.oneuptime-replay-stage .oneuptime-replay-touch-ring { position: absolute; width: ${REPLAY_STAGE_TOUCH_RING_PX}px; height: ${REPLAY_STAGE_TOUCH_RING_PX}px; margin-left: -${REPLAY_STAGE_TOUCH_RING_PX / 2}px; margin-top: -${REPLAY_STAGE_TOUCH_RING_PX / 2}px; border-radius: 100%; border: 3px solid rgba(73,80,246,0.9); box-shadow: 0 0 0 2px rgba(255,255,255,0.7); pointer-events: none; z-index: 2147483647; animation: oneuptime-replay-touch 0.6s ease-out 1 forwards; }
@keyframes oneuptime-replay-click { 0% { opacity: 0.6; transform: translate(-50%, -50%) scale(0.4); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(3); } }
@keyframes oneuptime-replay-touch { 0% { opacity: 0.9; transform: scale(0.6); } 100% { opacity: 0; transform: scale(1.8); } }
`;

/*
 * Contain-fit: the largest scale at which the whole recorded viewport fits
 * the box on both axes. Not capped at 1: theater on a wide display, and
 * phone recordings on any display, are meant to grow. An unmeasured box
 * (jsdom, or a container that is display:none) keeps the picture at 1:1
 * rather than collapsing it to nothing.
 */
export function computeContainScale(
  containerWidth: number,
  containerHeight: number,
  recorded: ReplayRecordedSize,
): number {
  if (
    !(containerWidth > 0) ||
    !(containerHeight > 0) ||
    !(recorded.width > 0) ||
    !(recorded.height > 0)
  ) {
    return 1;
  }

  return Math.min(
    containerWidth / recorded.width,
    containerHeight / recorded.height,
  );
}

/*
 * The capability a recorder advertises when it sampled mouse movement at
 * the faster cadence. Older recordings carry no such entry and were
 * sampled at the legacy interval, so their cursor must be given the
 * longer transition or it arrives early and waits.
 */
export const REPLAY_CURSOR_SAMPLE_CAPABILITY: string = "mousemove-50ms";

/*
 * How long the cursor takes to travel between two recorded positions:
 * one sample interval, divided by the speed it is being played at. The
 * 16ms floor is one frame - below that the transition cannot resolve and
 * only delays rrweb's next re-target. Speed is clamped so a very slow
 * playback does not produce a transition longer than the gap it spans.
 */
export function resolveCursorTransitionMs(
  recorderCapabilities: ReadonlyArray<string> | undefined,
  speed: number,
): number {
  const sampleMs: number = recorderCapabilities?.includes(
    REPLAY_CURSOR_SAMPLE_CAPABILITY,
  )
    ? SESSION_REPLAY_MOUSEMOVE_SAMPLE_MS
    : SESSION_REPLAY_LEGACY_MOUSEMOVE_SAMPLE_MS;

  return Math.max(16, Math.round(sampleMs / Math.max(0.25, speed)));
}

/*
 * Re-applied after every full-snapshot rebuild, which replaces <head>.
 * Exported so the test can pin it against a fake Replayer.
 */
export function injectDocumentCsp(replayer: ReplayerLike): void {
  const doc: Document | null = replayer.iframe.contentDocument;

  if (!doc) {
    return;
  }

  const head: HTMLHeadElement | null = doc.head;

  if (!head) {
    return;
  }

  if (!head.querySelector("meta[data-oneuptime-replay-csp]")) {
    const meta: HTMLMetaElement = doc.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", REPLAY_DOCUMENT_CSP);
    meta.setAttribute("data-oneuptime-replay-csp", "true");
    head.insertBefore(meta, head.firstChild);
  }

  if (!head.querySelector("meta[data-oneuptime-replay-referrer]")) {
    const referrer: HTMLMetaElement = doc.createElement("meta");
    referrer.setAttribute("name", "referrer");
    referrer.setAttribute("content", "no-referrer");
    referrer.setAttribute("data-oneuptime-replay-referrer", "true");
    head.insertBefore(referrer, head.firstChild);
  }
}

interface TouchRing {
  id: number;
  x: number;
  y: number;
}

export interface ReplayStageBoxSize {
  width: number;
  height: number;
}

/*
 * Width-fit: the scale at which the recorded viewport spans the box's
 * width exactly, whatever that does to the height (the box scrolls it).
 * Like contain-fit it is not capped at 1, and an unmeasured box or an
 * unknown size keeps the picture at 1:1.
 */
export function computeWidthScale(
  containerWidth: number,
  recorded: ReplayRecordedSize,
): number {
  if (!(containerWidth > 0) || !(recorded.width > 0)) {
    return 1;
  }

  return containerWidth / recorded.width;
}

export interface ReplayStageFrameGeometryInput {
  fit: ReplayStageFit;
  /* The box's client size; null before the first measurement. */
  box: ReplayStageBoxSize | null;
  recorded: ReplayRecordedSize | null;
  isPhoneFrame: boolean;
}

export interface ReplayStageFrameGeometry {
  scale: number;
  /*
   * "absolute" (contain): centred and letterboxed inside the box.
   * "relative" (width, actual): in flow, so the box's scroll area is the
   * frame's own size.
   */
  position: "absolute" | "relative";
  left: number;
  top: number;
  /* The drawn (scaled) size of the frame. */
  width: number;
  height: number;
  /*
   * Room kept around an in-flow phone frame so its ring is not clipped by
   * the scroll box; 0 for everything else (an absolute frame reserves it
   * through left/top instead).
   */
  margin: number;
}

/*
 * Where the frame goes and how big it is drawn, for one fit. Pure, so every
 * branch is pinned without layout.
 *
 * The phone ring is reserved only when the box is bigger than the ring on
 * both axes: a box too small to hold even the ring is not measured yet in
 * any meaningful sense, and insetting it would fall back to 1:1.
 */
export function computeReplayStageFrameGeometry(
  input: ReplayStageFrameGeometryInput,
): ReplayStageFrameGeometry {
  const aspect: ReplayRecordedSize = input.recorded ?? DEFAULT_ASPECT;
  const box: ReplayStageBoxSize | null = input.box;
  const ringPx: number = REPLAY_STAGE_PHONE_RING_PX;

  if (input.fit === "actual") {
    return {
      scale: 1,
      position: "relative",
      left: 0,
      top: 0,
      width: aspect.width,
      height: aspect.height,
      margin: input.isPhoneFrame ? ringPx : 0,
    };
  }

  const inset: number =
    input.isPhoneFrame &&
    box !== null &&
    box.width > 2 * ringPx &&
    box.height > 2 * ringPx
      ? ringPx
      : 0;
  const availableWidth: number = box ? box.width - 2 * inset : 0;
  const availableHeight: number = box ? box.height - 2 * inset : 0;

  let scale: number = 1;

  if (input.recorded && box) {
    scale =
      input.fit === "width"
        ? computeWidthScale(availableWidth, input.recorded)
        : computeContainScale(availableWidth, availableHeight, input.recorded);
  }

  const width: number = Math.round(aspect.width * scale);
  const height: number = Math.round(aspect.height * scale);

  if (input.fit === "width") {
    return {
      scale: scale,
      position: "relative",
      left: 0,
      /*
       * A recording shorter than the box at full width sits in the middle,
       * as it does under Fit, rather than jumping to the top on the switch.
       */
      top: Math.max(
        0,
        Math.round(((box ? availableHeight : height) - height) / 2),
      ),
      width: width,
      height: height,
      margin: inset,
    };
  }

  return {
    scale: scale,
    position: "absolute",
    left:
      inset +
      Math.max(0, Math.round(((box ? availableWidth : width) - width) / 2)),
    top:
      inset +
      Math.max(0, Math.round(((box ? availableHeight : height) - height) / 2)),
    width: width,
    height: height,
    margin: 0,
  };
}

const ReplayStage: FunctionComponent<ReplayStageProps> = (
  props: ReplayStageProps,
): ReactElement => {
  const { engine } = props;
  const fit: ReplayStageFit = props.fit ?? "contain";
  const sizing: ReplayStageSizing =
    props.sizing ?? (props.isTheater ? "fill" : "responsive");

  /* Wrapped so a method-based engine keeps its `this`. */
  /*
   * The structural channel: this component reads recordedSize, speed and
   * phase, none of which move with the playhead, so there is no reason
   * for it to re-render thirty times a second alongside the clock.
   */
  const subscribe: (listener: ReplayEngineListener) => () => void = useCallback(
    (listener: ReplayEngineListener): (() => void) => {
      return engine.subscribeStructural
        ? engine.subscribeStructural(listener)
        : engine.subscribe(listener);
    },
    [engine],
  );
  const getSnapshot: () => ReplayEngineSnapshot =
    useCallback((): ReplayEngineSnapshot => {
      return engine.getStructuralSnapshot
        ? engine.getStructuralSnapshot()
        : engine.getSnapshot();
    }, [engine]);

  const snapshot: ReplayEngineSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const outerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const mountRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const replayersRef: React.MutableRefObject<Set<ReplayerLike>> = useRef<
    Set<ReplayerLike>
  >(new Set<ReplayerLike>());
  const isTextSelectionEnabled: boolean = props.isTextSelectionEnabled ?? false;
  const isTextSelectionEnabledRef: React.MutableRefObject<boolean> =
    useRef<boolean>(isTextSelectionEnabled);
  isTextSelectionEnabledRef.current = isTextSelectionEnabled;

  const [boxSize, setBoxSize] = useState<ReplayStageBoxSize | null>(null);
  const [touchRings, setTouchRings] = useState<Array<TouchRing>>([]);
  const ringIdRef: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * The recorded size: rrweb's Meta once it has cast one, the header's
   * viewport before that. Both are "what the end user's window was".
   */
  const recorded: ReplayRecordedSize | null =
    useMemo((): ReplayRecordedSize | null => {
      if (snapshot.recordedSize) {
        return snapshot.recordedSize;
      }

      if (
        props.viewportWidth &&
        props.viewportHeight &&
        props.viewportWidth > 0 &&
        props.viewportHeight > 0
      ) {
        return { width: props.viewportWidth, height: props.viewportHeight };
      }

      return null;
    }, [snapshot.recordedSize, props.viewportWidth, props.viewportHeight]);

  const isMobile: boolean =
    props.isMobile ??
    (recorded !== null && recorded.width < REPLAY_STAGE_MOBILE_MAX_WIDTH_PX);

  /* Mount the engine's host into this stage; unmount on the way out. */
  useEffect(() => {
    const mount: HTMLDivElement | null = mountRef.current;

    if (!mount) {
      return;
    }

    engine.attach(mount);

    return () => {
      engine.detach();
    };
  }, [engine]);

  /* CSP + iframe title/selection policy on every (re)built document; touch rings. */
  useEffect(() => {
    const timers: Set<ReturnType<typeof setTimeout>> = new Set<
      ReturnType<typeof setTimeout>
    >();

    const unsubscribe: () => void = engine.onReplayer(
      (event: ReplayEngineReplayerEvent): void => {
        if (event.type === "destroyed") {
          configureReplayTextSelection(event.replayer, false);
          replayersRef.current.delete(event.replayer);
          return;
        }

        if (
          event.type === "created" ||
          event.type === "fullsnapshot-rebuilded"
        ) {
          replayersRef.current.add(event.replayer);
          injectDocumentCsp(event.replayer);
          configureReplayTextSelection(
            event.replayer,
            isTextSelectionEnabledRef.current,
          );

          try {
            event.replayer.iframe.title = "Recorded page";
          } catch {
            // A destroyed iframe has nothing to name.
          }
          return;
        }

        if (event.type === "touch") {
          ringIdRef.current += 1;
          const ring: TouchRing = {
            id: ringIdRef.current,
            x: event.x,
            y: event.y,
          };

          setTouchRings((current: Array<TouchRing>): Array<TouchRing> => {
            return [...current, ring];
          });

          const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
            timers.delete(timer);
            setTouchRings((current: Array<TouchRing>): Array<TouchRing> => {
              return current.filter((candidate: TouchRing): boolean => {
                return candidate.id !== ring.id;
              });
            });
          }, TOUCH_RING_LIFETIME_MS);

          timers.add(timer);
        }
      },
    );

    return () => {
      unsubscribe();

      for (const replayer of replayersRef.current) {
        configureReplayTextSelection(replayer, false);
      }

      replayersRef.current.clear();

      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [engine]);

  /* Apply a toolbar toggle to the Replayer that is already on screen. */
  useLayoutEffect(() => {
    for (const replayer of replayersRef.current) {
      configureReplayTextSelection(replayer, isTextSelectionEnabled);
    }
  }, [isTextSelectionEnabled]);

  /*
   * Measure the box. Recomputed on CONTAINER resizes too, not only when
   * the recorded size changes: entering theater, collapsing the sidebar,
   * dragging the rail or resizing the window all change the available
   * space, and a stale scale either crops the recording or leaves it
   * postage-stamped.
   *
   * Only the box itself is observed. Its height comes from CSS (the flex
   * column from xl up and in theater, the recorded aspect below xl), so
   * anything that moves the space around it - a header notice, a longer
   * tab strip, the scrubber growing - resizes the box, and that is what
   * the observer reports. Nothing here reads the viewport or the page
   * offset any more.
   */
  useEffect(() => {
    const outer: HTMLDivElement | null = outerRef.current;

    if (!outer) {
      return;
    }

    const measure: () => void = (): void => {
      const width: number = outer.clientWidth;
      const height: number = outer.clientHeight;

      setBoxSize(
        (current: ReplayStageBoxSize | null): ReplayStageBoxSize | null => {
          if (current && current.width === width && current.height === height) {
            return current;
          }

          return { width: width, height: height };
        },
      );
    };

    measure();

    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((): void => {
        measure();
      });
      observer.observe(outer);
    }

    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [sizing, fit]);

  const geometry: ReplayStageFrameGeometry =
    useMemo((): ReplayStageFrameGeometry => {
      return computeReplayStageFrameGeometry({
        fit: fit,
        box: boxSize,
        recorded: recorded,
        isPhoneFrame: isMobile,
      });
    }, [fit, boxSize, recorded, isMobile]);
  const scale: number = geometry.scale;

  const { onScaleChange } = props;

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  /*
   * The engine's host holds every Replayer wrapper (old and new during a
   * hold-last-frame rebuild), so scaling the host moves both together.
   */
  useEffect(() => {
    const host: HTMLElement | null = engine.getHostElement();

    if (!host) {
      return;
    }

    if (recorded) {
      host.style.width = `${recorded.width}px`;
      host.style.height = `${recorded.height}px`;
    }

    host.style.transformOrigin = "top left";
    host.style.transform = scale === 1 ? "" : `scale(${scale})`;
  }, [engine, recorded, scale]);

  /*
   * 1:1 keeps its historical in-flow frame with no offsets: the scroll box
   * starts at the recording's top-left corner.
   */
  const frameStyle: CSSProperties = {
    position: geometry.position,
    ...(fit === "actual"
      ? {}
      : { left: `${geometry.left}px`, top: `${geometry.top}px` }),
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
    ...(geometry.margin > 0 ? { margin: `${geometry.margin}px` } : {}),
  };

  const outerStyle: CSSProperties & Record<string, string> = {
    /*
     * Aspect reserved from the recorded viewport before the first frame;
     * only the responsive box below xl reads it (see the box classes).
     * Spelled out rather than keyed by REPLAY_STAGE_ASPECT_CSS_VAR so the
     * literal stays a typed style key; a test pins the two together.
     */
    "--oneuptime-replay-aspect": formatReplayStageAspect(recorded),
    "--oneuptime-replay-cursor-ms": `${resolveCursorTransitionMs(
      props.recorderCapabilities,
      snapshot.speed,
    )}ms`,
  };

  const isBusy: boolean =
    snapshot.phase === "loading" ||
    snapshot.phase === "seeking" ||
    snapshot.phase === "buffering";

  return (
    <div
      ref={outerRef}
      data-testid="replay-stage"
      data-replay-phase={snapshot.phase}
      data-replay-fit={fit}
      data-replay-sizing={sizing}
      data-replay-frame={isMobile ? "phone" : "desktop"}
      role="region"
      aria-label="Session replay"
      aria-busy={isBusy}
      className={`${getReplayStageBoxClassName(sizing, fit)} ${
        props.className ?? ""
      }`}
      style={outerStyle}
    >
      <style>{REPLAY_STAGE_CSS}</style>
      {/*
       * The engine phase, as one word, for assistive tech and the E2E
       * hooks. aria-live so a screen-reader user hears "buffering",
       * "ended" or "error" when the picture changes state - the visible
       * overlays are drawn by the player shell and are not announced.
       */}
      <span
        data-testid="replay-phase"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {snapshot.phase}
      </span>
      <div
        data-testid="replay-stage-frame"
        className={
          isMobile
            ? "overflow-hidden rounded-xl ring-8 ring-gray-800 bg-black"
            : "bg-white shadow-sm ring-1 ring-gray-200"
        }
        style={frameStyle}
      >
        <div ref={mountRef} className="absolute inset-0" />
        {touchRings.map((ring: TouchRing): ReactElement => {
          return (
            <div
              key={ring.id}
              data-testid="replay-touch-ring"
              className="oneuptime-replay-touch-ring"
              style={{
                left: `${Math.round(ring.x * scale)}px`,
                top: `${Math.round(ring.y * scale)}px`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ReplayStage;
