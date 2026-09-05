import {
  SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH,
} from "Common/Types/Rum/SessionReplay";
import {
  SessionReplayClickDroppedPayload,
  SessionReplayClickPayload,
  SessionReplayCustomEventTag,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import CommonMasking from "Common/Utils/Rum/Masking";
import Masking from "./Masking";

/*
 * Every click, as an rrweb type-5 custom event with a structural selector
 * and a MASKED label.
 *
 * rrweb already records that a click happened (a mouse-interaction event
 * against a node id), but a node id is meaningless outside the DOM it
 * indexes: the rail cannot say "clicked Pay now" from it, the list cannot
 * count clicks without decoding the payload, and a heatmap cannot group by
 * button. This module records what a person would say about the click.
 *
 * Two rules protect the end user:
 *
 *   1. The SELECTOR is structure only: tag, id and class names, up to three
 *      ancestors, each token truncated. Never an attribute VALUE - a
 *      data-email="..." or a value="..." would put content on the wire
 *      under the guise of a selector.
 *   2. The LABEL goes through the same masking as page text. Under
 *      MaskAllText it is omitted outright; under the relaxed modes it is
 *      replaced by the text mask whenever the target sits inside a masked
 *      or sensitive region, and a form control's typed value is never used
 *      as a label in any mode.
 *
 * Capped PER CHUNK rather than per session, so a long session keeps
 * labelling clicks after its first hundred; past the cap, clicks are
 * counted and disclosed with one oneuptime.click-dropped marker per chunk.
 */

/* Tokens of the selector are cut here; ids and classes can be very long. */
const MAX_SELECTOR_TOKEN_LENGTH: number = 32;

/* Classes per element and the overall selector length, for the envelope. */
const MAX_CLASSES_PER_ELEMENT: number = 2;
const MAX_SELECTOR_LENGTH: number = 200;

/* target + this many ancestors. */
const MAX_ANCESTORS: number = 3;

/*
 * A tap fires touchend and then, unless the page preventDefault()s it, a
 * synthetic click. The click is the better record (it carries the resolved
 * target and the browser's own coordinates), so a touchend waits this long
 * for its click and is recorded itself only when none arrives.
 */
const TOUCH_CLICK_GRACE_MS: number = 350;

/*
 * Controls whose visible text IS user input. Their typed value must never
 * become a label, in any mode; only an explicit aria-label is used.
 */
const VALUE_BEARING_SELECTOR: string = "input, textarea, select, option";

export interface ClickRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* One labelled click was recorded; the recorder counts it on the chunk. */
  onClick: (atUnixMs: number, click: SessionReplayClickPayload) => void;

  /* The active policy's masking, shared with the rest of the recorder. */
  masking: Masking;
}

interface PendingTouch {
  target: Element | null;
  x: number;
  y: number;
  atUnixMs: number;
  timer: ReturnType<typeof setTimeout>;
}

export default class ClickRecorder {
  private readonly options: ClickRecorderOptions;

  private started: boolean = false;

  /* Per-chunk window: labelled clicks and clicks dropped past the cap. */
  private recordedInChunk: number = 0;
  private droppedInChunk: number = 0;

  private pendingTouch: PendingTouch | null = null;

  private readonly clickListener: (event: MouseEvent) => void;
  private readonly touchEndListener: (event: TouchEvent) => void;

  public constructor(options: ClickRecorderOptions) {
    this.options = options;

    this.clickListener = (event: MouseEvent): void => {
      this.handleClick(event);
    };

    this.touchEndListener = (event: TouchEvent): void => {
      this.handleTouchEnd(event);
    };
  }

  public start(documentRef: Document = document): void {
    if (this.started) {
      return;
    }

    this.started = true;

    /*
     * Capture phase and passive, like the frustration detector: a click a
     * component stops propagating is still a click the user made, and the
     * listener must never delay the page's own handling.
     */
    documentRef.addEventListener("click", this.clickListener as EventListener, {
      capture: true,
      passive: true,
    });
    documentRef.addEventListener(
      "touchend",
      this.touchEndListener as EventListener,
      { capture: true, passive: true },
    );
  }

  public stop(documentRef: Document = document): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    documentRef.removeEventListener(
      "click",
      this.clickListener as EventListener,
      true,
    );
    documentRef.removeEventListener(
      "touchend",
      this.touchEndListener as EventListener,
      true,
    );

    this.cancelPendingTouch();

    /* Whatever was dropped in the open chunk is still owed a disclosure. */
    this.startNewChunk();
  }

  /*
   * The chunk boundary. Called by the recorder when a chunk closes, so the
   * cap is per chunk and the dropped-click disclosure for the chunk that
   * just closed lands at the very start of the next one - at the boundary
   * it describes.
   */
  public startNewChunk(): void {
    if (this.droppedInChunk > 0) {
      const marker: SessionReplayClickDroppedPayload = {
        count: this.droppedInChunk,
      };

      this.options.emitCustomEvent(
        SessionReplayCustomEventTag.ClickDropped,
        marker,
      );
    }

    this.recordedInChunk = 0;
    this.droppedInChunk = 0;
  }

  /* A rotated session is a fresh recording; its first chunk starts clean. */
  public resetForNewSession(): void {
    this.recordedInChunk = 0;
    this.droppedInChunk = 0;
  }

  public getDroppedInChunk(): number {
    return this.droppedInChunk;
  }

  private handleClick(event: MouseEvent): void {
    /*
     * The click that follows a tap: the tap already stands by, waiting for
     * exactly this. Recording both would count one gesture twice.
     */
    this.cancelPendingTouch();

    const target: Element | null = ClickRecorder.elementOf(event.target);

    this.record(target, event.clientX, event.clientY, Date.now());
  }

  private handleTouchEnd(event: TouchEvent): void {
    const touch: Touch | undefined =
      event.changedTouches && event.changedTouches.length > 0
        ? event.changedTouches[0]
        : undefined;

    if (!touch) {
      return;
    }

    this.cancelPendingTouch();

    const target: Element | null = ClickRecorder.elementOf(event.target);
    const atUnixMs: number = Date.now();

    this.pendingTouch = {
      target: target,
      x: touch.clientX,
      y: touch.clientY,
      atUnixMs: atUnixMs,
      timer: setTimeout((): void => {
        const pending: PendingTouch | null = this.pendingTouch;

        this.pendingTouch = null;

        if (pending) {
          this.record(pending.target, pending.x, pending.y, pending.atUnixMs);
        }
      }, TOUCH_CLICK_GRACE_MS),
    };
  }

  private cancelPendingTouch(): void {
    if (this.pendingTouch) {
      clearTimeout(this.pendingTouch.timer);
      this.pendingTouch = null;
    }
  }

  private record(
    target: Element | null,
    x: number,
    y: number,
    atUnixMs: number,
  ): void {
    if (this.recordedInChunk >= SESSION_REPLAY_MAX_CLICK_EVENTS_PER_CHUNK) {
      this.droppedInChunk++;
      return;
    }

    this.recordedInChunk++;

    const click: SessionReplayClickPayload = {
      selector: target ? ClickRecorder.buildSelector(target) : "",
      x: Math.round(x),
      y: Math.round(y),
      atUnixMs: atUnixMs,
    };

    const text: string | null = target ? this.readLabel(target) : null;

    if (text !== null) {
      click.text = text;
    }

    this.options.emitCustomEvent(SessionReplayCustomEventTag.Click, click);
    this.options.onClick(atUnixMs, click);
  }

  /*
   * The label, or null when the mode or the target says none may be
   * recorded. aria-label first (it is what a screen reader would say),
   * then the element's own text; a value-bearing control contributes only
   * its aria-label. Whitespace is collapsed and the result cut at the cap.
   */
  private readLabel(target: Element): string | null {
    const masking: Masking = this.options.masking;

    if (masking.isMaskAllText()) {
      return null;
    }

    let raw: string = "";

    const ariaLabel: string | null = target.getAttribute("aria-label");

    if (ariaLabel && ariaLabel.trim()) {
      raw = ariaLabel;
    } else if (!ClickRecorder.isValueBearing(target)) {
      raw = target.textContent || "";
    }

    const collapsed: string = raw.replace(/\s+/g, " ").trim();

    if (!collapsed) {
      return null;
    }

    const truncated: string = collapsed.slice(
      0,
      SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH,
    );

    /*
     * Inside a masked region the label is exactly the text rrweb would
     * have masked in the snapshot, so it gets the same transform - a
     * length bucket of mask characters, never the words.
     */
    if (this.isInsideMaskedRegion(target)) {
      return CommonMasking.maskText(truncated);
    }

    return truncated;
  }

  private isInsideMaskedRegion(target: Element): boolean {
    const masking: Masking = this.options.masking;

    if (masking.matchesMaskSelector(target)) {
      return true;
    }

    let node: Element | null = target;

    while (node) {
      if (
        masking.isSticky(node) ||
        Masking.isCurrentlySensitive(node) ||
        (node.classList && node.classList.contains("oneuptime-mask"))
      ) {
        return true;
      }

      node = node.parentElement;
    }

    return false;
  }

  private static isValueBearing(target: Element): boolean {
    try {
      return target.matches(VALUE_BEARING_SELECTOR);
    } catch {
      return true;
    }
  }

  /*
   * tag#id.class.class > tag.class > ... up to three ancestors, stopping
   * early at an id (an id is already a stable handle). Only structural
   * tokens: no attribute values, ever.
   */
  public static buildSelector(target: Element): string {
    const parts: Array<string> = [];
    let node: Element | null = target;
    let depth: number = 0;

    while (node && depth <= MAX_ANCESTORS) {
      const tagName: string = (node.tagName || "").toLowerCase();

      if (!tagName || tagName === "html") {
        break;
      }

      let segment: string = tagName;
      let hasId: boolean = false;

      const id: string = node.id;

      if (typeof id === "string" && id.trim()) {
        segment += `#${ClickRecorder.cleanToken(id)}`;
        hasId = true;
      }

      const classList: DOMTokenList | undefined = node.classList;

      if (classList) {
        let used: number = 0;

        for (let index: number = 0; index < classList.length; index++) {
          const className: string | null = classList.item(index);

          if (!className) {
            continue;
          }

          segment += `.${ClickRecorder.cleanToken(className)}`;
          used++;

          if (used >= MAX_CLASSES_PER_ELEMENT) {
            break;
          }
        }
      }

      parts.unshift(segment);

      if (hasId) {
        break;
      }

      node = node.parentElement;
      depth++;
    }

    return parts.join(" > ").slice(0, MAX_SELECTOR_LENGTH);
  }

  private static cleanToken(token: string): string {
    return token.replace(/\s+/g, "").slice(0, MAX_SELECTOR_TOKEN_LENGTH);
  }

  private static elementOf(target: EventTarget | null): Element | null {
    if (!target || typeof Element === "undefined") {
      return null;
    }

    if (target instanceof Element) {
      return target;
    }

    /* A text node: the click landed on its parent element. */
    const parent: unknown = (target as unknown as Record<string, unknown>)[
      "parentElement"
    ];

    return parent instanceof Element ? parent : null;
  }
}
