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

export type ReplayStageFit = "contain" | "actual";

export interface ReplayStageProps {
  engine: ReplayEngine;
  /*
   * The recorded viewport from the manifest header. Reserves the stage's
   * aspect ratio before rrweb reports its first Meta, so the layout below
   * the stage does not jump when the first frame lands.
   */
  viewportWidth?: number | null | undefined;
  viewportHeight?: number | null | undefined;
  /* Native fullscreen: the height bound becomes 100vh instead of 70vh. */
  isTheater?: boolean | undefined;
  /* "contain" (Fit) scales to fit both axes; "actual" is 1:1 in a scroll box. */
  fit?: ReplayStageFit | undefined;
  /* Draw the phone frame. Defaults to "recorded width below 600px". */
  isMobile?: boolean | undefined;
  /* The scale in force, for the "1440x900 -> 62%" chip. */
  onScaleChange?: ((scale: number) => void) | undefined;
  /* Reserve space for the timeline and transport on desktop. */
  reservedBottomHeightPx?: number | undefined;
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

/* Contain-fit bounds, from the design: 70vh normally, 100vh in theater. */
export const REPLAY_STAGE_MAX_HEIGHT_VH: number = 70;
export const REPLAY_STAGE_THEATER_MAX_HEIGHT_VH: number = 100;
export const REPLAY_STAGE_MIN_HEIGHT_REM: number = 24;

/* Recordings narrower than this get the phone-shaped frame. */
export const REPLAY_STAGE_MOBILE_MAX_WIDTH_PX: number = 600;

/* rrweb draws a 28px ring where a TouchStart landed. */
export const REPLAY_STAGE_TOUCH_RING_PX: number = 28;
const TOUCH_RING_LIFETIME_MS: number = 700;

/* Fallback aspect before any size is known. */
const DEFAULT_ASPECT: ReplayRecordedSize = { width: 16, height: 9 };

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

const REPLAY_TEXT_SELECTION_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection";
const REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-text-selection-style";
const REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE: string =
  "data-oneuptime-replay-shadow-text-selection-style";

/*
 * One listener set per Document. A full-snapshot rebuild replaces <html> and
 * <head>, but keeps the Document object; the WeakSet prevents duplicate
 * guards while still allowing a destroyed Replayer and its document to be
 * collected.
 */
const guardedReplayDocuments: WeakSet<Document> = new WeakSet<Document>();
const enabledReplayDocuments: WeakSet<Document> = new WeakSet<Document>();
const observedReplayFrames: WeakSet<HTMLIFrameElement> =
  new WeakSet<HTMLIFrameElement>();
const observedReplayShadowRoots: WeakSet<ShadowRoot> =
  new WeakSet<ShadowRoot>();
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

/* Recorded open shadow roots need their own cascade and mutation observer. */
function enableReplayShadowRoots(root: ParentNode, doc: Document): void {
  rememberReplayRootScrollPositions(doc, root);
  const elements: NodeListOf<Element> = root.querySelectorAll("*");

  for (const element of Array.from(elements)) {
    const shadowRoot: ShadowRoot | null = element.shadowRoot;

    if (!shadowRoot) {
      continue;
    }

    if (
      !shadowRoot.querySelector(
        `style[${REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE}]`,
      )
    ) {
      const style: HTMLStyleElement = doc.createElement("style");
      style.setAttribute(REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE, "true");
      style.textContent = REPLAY_SHADOW_TEXT_SELECTION_CSS;
      shadowRoot.appendChild(style);
    }

    if (!observedReplayShadowRoots.has(shadowRoot)) {
      const MutationObserverClass: typeof MutationObserver | undefined =
        doc.defaultView?.MutationObserver;

      if (MutationObserverClass) {
        const observer: MutationObserver = new MutationObserverClass(
          (): void => {
            if (enabledReplayDocuments.has(doc)) {
              enableReplayShadowRoots(shadowRoot, doc);
              enableNestedReplayDocuments(doc, shadowRoot);
            }
          },
        );
        observer.observe(shadowRoot, { childList: true, subtree: true });
      }

      observedReplayShadowRoots.add(shadowRoot);
    }

    enableNestedReplayDocuments(doc, shadowRoot);
    enableReplayShadowRoots(shadowRoot, doc);
  }
}

function disableReplayShadowRoots(root: ParentNode): void {
  const elements: NodeListOf<Element> = root.querySelectorAll("*");

  for (const element of Array.from(elements)) {
    const shadowRoot: ShadowRoot | null = element.shadowRoot;

    if (!shadowRoot) {
      continue;
    }

    shadowRoot
      .querySelector(`style[${REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE}]`)
      ?.remove();

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

    disableReplayShadowRoots(shadowRoot);
  }
}

/*
 * Make the replay a read-only text surface.
 *
 * We do not call rrweb's enableInteract(): besides pointer hit-testing it
 * turns scrolling back on, and unrestricted interaction lets links navigate,
 * controls toggle, forms submit and inputs diverge from the recording. Native
 * selection only needs the iframe to receive pointer events. The capture
 * guards below keep every state-changing browser default inert while leaving
 * selection, the context menu and the copy event alone.
 */
function enableReplayDocumentTextSelection(doc: Document): void {
  enabledReplayDocuments.add(doc);
  const root: HTMLElement | null = doc.documentElement;
  const head: HTMLHeadElement | null = doc.head;

  if (root) {
    root.setAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE, "true");
  }

  if (
    head &&
    !head.querySelector(`style[${REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE}]`)
  ) {
    const style: HTMLStyleElement = doc.createElement("style");
    style.setAttribute(REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE, "true");
    style.textContent = REPLAY_TEXT_SELECTION_CSS;
    head.appendChild(style);
  }

  if (!guardedReplayDocuments.has(doc)) {
    /*
     * click/auxclick cover links, buttons, checkboxes, details and file
     * inputs. submit covers keyboard-submitted forms. beforeinput plus the
     * clipboard and drag events keep inputs/contenteditable nodes read-only
     * without disabling them (disabled fields cannot select text).
     */
    for (const type of [
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
    ]) {
      doc.addEventListener(type, preventReplayDefault, {
        capture: true,
        passive: false,
      });
    }

    for (const type of ["pointerdown", "mousedown", "touchstart"]) {
      doc.addEventListener(type, preventReplayControlPointerMutation, {
        capture: true,
        passive: false,
      });
    }

    doc.addEventListener("keydown", preventReplayKeyboardMutation, true);

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
    }

    guardedReplayDocuments.add(doc);
  }

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
        try {
          if (enabledReplayDocuments.has(doc) && frame.contentDocument) {
            enableReplayDocumentTextSelection(frame.contentDocument);
          }
        } catch {
          // A child that navigated cross-origin is intentionally opaque.
        }
      });
      observedReplayFrames.add(frame);
    }

    try {
      if (frame.contentDocument) {
        enableReplayDocumentTextSelection(frame.contentDocument);
      }
    } catch {
      // A genuinely cross-origin child remains an opaque recorded frame.
    }
  }
}

function disableReplayDocumentTextSelection(doc: Document): void {
  if (!enabledReplayDocuments.delete(doc)) {
    return;
  }

  doc.documentElement?.removeAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE);
  doc.head
    ?.querySelector(`style[${REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE}]`)
    ?.remove();
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

interface BoxSize {
  width: number;
  height: number;
}

export function computeReplayStageHeight(
  viewportHeight: number,
  stageTop: number,
  reservedBottomHeight: number,
): number {
  return Math.max(256, viewportHeight - stageTop - reservedBottomHeight);
}

const ReplayStage: FunctionComponent<ReplayStageProps> = (
  props: ReplayStageProps,
): ReactElement => {
  const { engine } = props;
  const fit: ReplayStageFit = props.fit ?? "contain";
  const isTheater: boolean = props.isTheater ?? false;

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

  const [boxSize, setBoxSize] = useState<BoxSize | null>(null);
  const [viewportHeightLimit, setViewportHeightLimit] = useState<number | null>(
    null,
  );
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
   * the recorded size changes: entering theater, collapsing the sidebar or
   * resizing the window all change the available space, and a stale scale
   * either crops the recording or leaves it postage-stamped.
   */
  useEffect(() => {
    const outer: HTMLDivElement | null = outerRef.current;

    if (!outer) {
      return;
    }

    const measure: () => void = (): void => {
      const width: number = outer.clientWidth;
      const height: number = outer.clientHeight;

      setViewportHeightLimit(
        props.reservedBottomHeightPx !== undefined && window.innerWidth >= 1280
          ? computeReplayStageHeight(
              window.innerHeight,
              outer.getBoundingClientRect().top +
                (isTheater ? 0 : window.scrollY),
              props.reservedBottomHeightPx,
            )
          : null,
      );

      setBoxSize((current: BoxSize | null): BoxSize | null => {
        if (current && current.width === width && current.height === height) {
          return current;
        }

        return { width: width, height: height };
      });
    };

    measure();

    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((): void => {
        measure();
      });
      observer.observe(outer);

      /*
       * Header notices and clipboard fallbacks move the stage without
       * resizing it. Observe that sibling even in a fixed-height theater.
       */
      const layout: Element | null = outer.closest("[data-replay-layout]");
      const header: Element | null = layout?.querySelector("header") ?? null;
      if (layout) {
        observer.observe(layout);
      }
      if (header) {
        observer.observe(header);
      }
    }

    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isTheater, fit, props.reservedBottomHeightPx]);

  const scale: number = useMemo((): number => {
    if (fit === "actual" || !recorded || !boxSize) {
      return 1;
    }

    return computeContainScale(boxSize.width, boxSize.height, recorded);
  }, [fit, recorded, boxSize]);

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

  const aspect: ReplayRecordedSize = recorded ?? DEFAULT_ASPECT;
  const scaledWidth: number = Math.round(aspect.width * scale);
  const scaledHeight: number = Math.round(aspect.height * scale);

  const frameStyle: CSSProperties =
    fit === "actual"
      ? {
          position: "relative",
          width: `${aspect.width}px`,
          height: `${aspect.height}px`,
        }
      : {
          position: "absolute",
          left: `${Math.max(
            0,
            Math.round(((boxSize?.width ?? scaledWidth) - scaledWidth) / 2),
          )}px`,
          top: `${Math.max(
            0,
            Math.round(((boxSize?.height ?? scaledHeight) - scaledHeight) / 2),
          )}px`,
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        };

  const outerStyle: CSSProperties & Record<string, string> = {
    minHeight:
      viewportHeightLimit !== null
        ? "16rem"
        : `${REPLAY_STAGE_MIN_HEIGHT_REM}rem`,
    maxHeight:
      viewportHeightLimit !== null
        ? `${viewportHeightLimit}px`
        : `${isTheater ? REPLAY_STAGE_THEATER_MAX_HEIGHT_VH : REPLAY_STAGE_MAX_HEIGHT_VH}vh`,
    /* Aspect reserved from the recorded viewport before the first frame. */
    aspectRatio: `${aspect.width} / ${aspect.height}`,
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
      data-replay-frame={isMobile ? "phone" : "desktop"}
      role="region"
      aria-label="Session replay"
      aria-busy={isBusy}
      className={`oneuptime-replay-stage relative w-full bg-gray-100 ${
        fit === "actual" ? "overflow-auto" : "overflow-hidden"
      } ${props.className ?? ""}`}
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
