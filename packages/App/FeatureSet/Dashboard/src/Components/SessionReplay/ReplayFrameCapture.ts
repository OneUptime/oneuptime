import {
  REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE,
  REPLAY_TEXT_SELECTION_ATTRIBUTE,
  REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE,
} from "./ReplayStage";

/*
 * Turns the paused replay document into a PNG.
 *
 * The browser has no API that reads back the pixels of a DOM subtree, and
 * the screen-capture API asks the viewer for permission every time, so the
 * frame is re-drawn instead: the replay document is cloned, the clone is
 * wrapped in an SVG <foreignObject>, the SVG is loaded as an image and
 * that image is painted onto a canvas.
 *
 * General-purpose "DOM to image" libraries were measured against a real
 * paused replay and got it visibly wrong - they dropped the fixed header,
 * lost the values typed into inputs, and re-downloaded the recorded site's
 * images with the Dashboard as referrer. They are built for pages a script
 * wrote. This is built for the one kind of document the player shows, and
 * it knows where that document keeps its state:
 *
 *  - STYLES live in the CSSOM. The replay adds rules with insertRule and
 *    adoptedStyleSheets (CSS-in-JS, and the player's own pause rule),
 *    which a <style> element's text never shows, so every sheet is
 *    re-serialised from cssRules.
 *  - FORM STATE lives in properties. Replayed input sets .value and
 *    .checked, not the attributes a serialiser writes out.
 *  - SCROLL lives in the layout, and a clone has none. It is put back with
 *    scroll snapping, which an SVG image does honour: the frame is a
 *    snap container whose only snap target is a marker at the recorded
 *    scroll offset, and a scrolled box snaps to its first child at the
 *    offset that child was drawn at. The picture then really is scrolled,
 *    so sticky headers stick, fixed boxes stay put, a z-index:-1 backdrop
 *    stays behind the page, and scrollbar thumbs sit where they sat.
 *  - SHADOW DOM cannot be serialised, so a shadow tree is flattened into
 *    its host with every element's computed style inlined (its scoped
 *    rules would otherwise leak or stop matching), pseudo-elements
 *    included.
 *  - ANIMATIONS are frozen: the clone would restart them at their first
 *    keyframe, so every animated property is pinned to its paused value.
 *  - THE TOP LAYER cannot be serialised either, so a modal dialog is drawn
 *    fixed over everything, with its ::backdrop painted behind it.
 *
 * The live replay document is only read, never written to, and nothing
 * here makes a network request. An SVG image loads no subresources, and
 * every url() the page's CSS mentions is rewritten to an empty data: URL
 * besides. What the stage shows agrees with that: the replay document's
 * own CSP (REPLAY_DOCUMENT_CSP) keeps it from loading anything that is not
 * a data: URL, so a recorded image that never loaded stays broken here,
 * exactly as it is on the stage.
 *
 * The clone is taken synchronously when the capture starts, so pressing
 * Play while the PNG is being encoded does not change what is in it.
 */

const XHTML_NAMESPACE: string = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE: string = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE: string = "http://www.w3.org/XML/1998/namespace";

/*
 * Node types by number: the replay document is another window, so its
 * nodes are not instances of THIS window's Element or ShadowRoot and an
 * instanceof check would reject every one of them.
 */
const ELEMENT_NODE: number = 1;
const TEXT_NODE: number = 3;
const CDATA_SECTION_NODE: number = 4;

/* Crisp on a retina display, without a 4x canvas on a 4K one. */
export const REPLAY_FRAME_MAX_PIXEL_RATIO: number = 2;

/*
 * 4096 x 4096. Safari refuses a canvas larger than 16.7M pixels and the
 * other engines slow to a crawl well before their own limits; a frame that
 * would exceed it is drawn at a lower ratio instead.
 */
export const REPLAY_FRAME_MAX_CANVAS_PIXELS: number = 16777216;

/* A page in an iframe in an iframe; deeper frames are left blank. */
export const REPLAY_FRAME_MAX_FRAME_DEPTH: number = 2;

/* The stage paints the replay iframe white (REPLAY_STAGE_CSS). */
export const REPLAY_FRAME_DEFAULT_BACKGROUND: string = "#ffffff";

/*
 * An image source that fails without a request: a recorded image the
 * stage never loaded is drawn broken, as the stage draws it.
 */
export const REPLAY_FRAME_BROKEN_IMAGE: string = "data:,";

/* 1x1 #e5e7eb: an image the stage drew but the browser will not let us read. */
export const REPLAY_FRAME_IMAGE_PLACEHOLDER: string =
  "data:image/gif;base64,R0lGODlhAQABAIAAAOXn6wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

/* 1x1 transparent: a frame or embed there is nothing to draw for. */
export const REPLAY_FRAME_TRANSPARENT_IMAGE: string =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/*
 * The capture's own rules, last in the clone's <head>. Transitions and
 * animations stop where they are (the paused values are inlined per
 * element), the caret does not blink into the picture, and the page's own
 * scroll snapping is switched off so that the only snap targets are the
 * ones that put each scroll offset back.
 */
export const REPLAY_FRAME_FREEZE_CSS: string =
  "html, html *, html *::before, html *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-snap-type: none !important; scroll-snap-align: none !important; }";

/*
 * In the SVG image the document root is the <svg>, not the page's <html>:
 * every page rule written against :root would match the wrapper instead,
 * and the page's variables, theme and rem base would go with it. :root is
 * rewritten to a selector that matches <html> at the same specificity -
 * :is() takes its most specific argument, here a class.
 */
export const REPLAY_FRAME_ROOT_SELECTOR: string =
  ":is(html, .oneuptime-frame-root)";

/* Class prefix for the rules that carry a flattened pseudo-element. */
const REPLAY_FRAME_PSEUDO_CLASS_PREFIX: string = "oneuptime-frame-pseudo-";

/*
 * Stand-in for a nested frame's picture until it has been rendered.
 * Only letters, digits and dashes, so it survives serialisation verbatim
 * and a plain string replace can swap the data URL in.
 */
const REPLAY_FRAME_TOKEN_PREFIX: string = "oneuptime-frame-";

const XML_NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const EVENT_HANDLER_ATTRIBUTE_PATTERN: RegExp = /^on/i;
const INVALID_XML_CHARACTERS: RegExp = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;
const TRANSPARENT_COLOR_PATTERN: RegExp =
  /^(?:transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|rgba\(0 0 0 \/ 0\))$/;
const UPPERCASE_PATTERN: RegExp = /[A-Z]/g;
const WHITESPACE_PATTERN: RegExp = /\s+/;
const PIXEL_LENGTH_PATTERN: RegExp = /^\d+(?:\.\d+)?px$/;
const DATA_URL_PATTERN: RegExp = /^\s*data:/i;
const URL_FUNCTION_PATTERN: RegExp = /^url\(/i;
const ROOT_PSEUDO_CLASS_PATTERN: RegExp = /^:root(?![\w-])/i;
const QUOTED_PATTERN: RegExp = /^(['"])([\s\S]*)\1$/;

/* The page background, when it moves from the root to the frame. */
const PROPAGATED_BACKGROUND_PROPERTIES: Array<string> = [
  "background-color",
  "background-image",
  "background-repeat",
  "background-position",
  "background-size",
  "background-origin",
  "background-clip",
  "background-attachment",
];

export type ReplayFrameCaptureFailure =
  | "no-document"
  | "empty-viewport"
  | "render-failed"
  | "encode-failed";

export class ReplayFrameCaptureError extends Error {
  public readonly reason: ReplayFrameCaptureFailure;

  public constructor(reason: ReplayFrameCaptureFailure, message: string) {
    super(message);
    this.name = "ReplayFrameCaptureError";
    this.reason = reason;
  }
}

export interface ReplayFrameViewport {
  width: number;
  height: number;
}

/* Where the stage's pointer is drawn, in recorded CSS pixels. */
export interface ReplayFramePointer {
  x: number;
  y: number;
}

export interface ReplayNestedFrame {
  token: string;
  serialization: ReplayFrameSerialization;
}

export interface ReplayFrameSerialization {
  viewport: ReplayFrameViewport;
  /* A complete SVG document drawing the frame. */
  svg: string;
  /*
   * What the canvas is filled with first: the stage's white for the
   * recorded page itself, nothing for a nested frame (an iframe is
   * transparent where its page paints nothing).
   */
  backgroundColor: string | null;
  /* Same-origin child documents, rendered first and swapped in by token. */
  frames: Array<ReplayNestedFrame>;
}

export interface ReplayScrollOffset {
  x: number;
  y: number;
}

interface CloneContext {
  /* Inside a flattened shadow tree: styles are inlined, not matched. */
  isInShadow: boolean;
  /* Text sitting directly in a scrolled box that could not be snapped. */
  textScroll: ReplayScrollOffset | null;
}

interface ScrollPlan {
  offset: ReplayScrollOffset;
  /* The child snapped into place; null when there is none to use. */
  anchor: Element | null;
  isPositioned: boolean;
}

/* ---- Pure helpers. ---- */

export function isXmlSafeName(name: string): boolean {
  return XML_NAME_PATTERN.test(name);
}

export function stripInvalidXmlCharacters(text: string): string {
  return text.replace(INVALID_XML_CHARACTERS, "");
}

export function escapeXmlAttribute(value: string): string {
  return stripInvalidXmlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* "backgroundColor" -> "background-color", "cssFloat" -> "float". */
export function toCssPropertyName(keyframeKey: string): string {
  if (keyframeKey === "cssFloat") {
    return "float";
  }

  if (keyframeKey === "cssOffset") {
    return "offset";
  }

  return keyframeKey.replace(UPPERCASE_PATTERN, (letter: string): string => {
    return `-${letter.toLowerCase()}`;
  });
}

export function isTransparentColor(color: string): boolean {
  const trimmed: string = color.trim();

  return trimmed === "" || TRANSPARENT_COLOR_PATTERN.test(trimmed);
}

function findQuotedEnd(css: string, start: number): number {
  const quote: string = css.charAt(start);
  let index: number = start + 1;

  while (index < css.length && css.charAt(index) !== quote) {
    if (css.charAt(index) === "\\") {
      index++;
    }

    index++;
  }

  return Math.min(css.length, index + 1);
}

function findUrlEnd(css: string, start: number): number {
  let index: number = start;

  while (index < css.length && css.charAt(index) !== ")") {
    const character: string = css.charAt(index);

    if (character === '"' || character === "'") {
      index = findQuotedEnd(css, index);
      continue;
    }

    if (character === "\\") {
      index++;
    }

    index++;
  }

  return index;
}

/*
 * Makes the page's CSS safe and correct for the SVG image, skipping over
 * strings and comments so their contents are never touched:
 *  - every url() that is not a data: URL becomes url("data:,"): the image
 *    would not fetch it anyway, and the stage never loaded it,
 *  - :root becomes REPLAY_FRAME_ROOT_SELECTOR (see there).
 */
export function rewriteReplayCss(css: string): string {
  let output: string = "";
  let index: number = 0;

  while (index < css.length) {
    const character: string = css.charAt(index);

    if (character === '"' || character === "'") {
      const end: number = findQuotedEnd(css, index);
      output += css.slice(index, end);
      index = end;
      continue;
    }

    if (character === "/" && css.charAt(index + 1) === "*") {
      const close: number = css.indexOf("*/", index + 2);
      const end: number = close === -1 ? css.length : close + 2;
      output += css.slice(index, end);
      index = end;
      continue;
    }

    if (
      (character === "u" || character === "U") &&
      URL_FUNCTION_PATTERN.test(css.slice(index, index + 4))
    ) {
      const close: number = findUrlEnd(css, index + 4);
      const raw: string = css.slice(index + 4, close).trim();
      const unquoted: string = raw.replace(QUOTED_PATTERN, "$2");

      output += DATA_URL_PATTERN.test(unquoted)
        ? css.slice(index, close + 1)
        : `url("${REPLAY_FRAME_BROKEN_IMAGE}")`;
      index = close + 1;
      continue;
    }

    if (
      character === ":" &&
      ROOT_PSEUDO_CLASS_PATTERN.test(css.slice(index, index + 6))
    ) {
      output += REPLAY_FRAME_ROOT_SELECTOR;
      index += 5;
      continue;
    }

    output += character;
    index++;
  }

  return output;
}

/*
 * The scroll-margin that makes a child the snap target for its scroll
 * container's recorded offset. A snap aligns the child's border box,
 * grown by its scroll-margin, with the container's padding edge; the
 * container therefore lands where the child sits exactly `margin` pixels
 * past that edge - which is where it was drawn when the frame was
 * captured. The margin is negative once the child has scrolled up out of
 * view, and snapping honours that.
 */
export function computeScrollSnapMargin(input: {
  childStart: number;
  containerStart: number;
  containerBorder: number;
}): number {
  return input.childStart - input.containerStart - input.containerBorder;
}

/*
 * The largest ratio <= the requested one (itself capped at
 * REPLAY_FRAME_MAX_PIXEL_RATIO) whose canvas stays within
 * REPLAY_FRAME_MAX_CANVAS_PIXELS. A huge recorded viewport may come out
 * below 1.
 */
export function resolveReplayFramePixelRatio(
  requested: number | null | undefined,
  viewport: ReplayFrameViewport,
): number {
  const base: number =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? requested
      : 1;
  let ratio: number = Math.min(REPLAY_FRAME_MAX_PIXEL_RATIO, Math.max(1, base));
  const area: number = viewport.width * viewport.height;

  if (area > 0 && area * ratio * ratio > REPLAY_FRAME_MAX_CANVAS_PIXELS) {
    ratio = Math.sqrt(REPLAY_FRAME_MAX_CANVAS_PIXELS / area);
  }

  return ratio;
}

export interface ReplayFrameSvgInput {
  xhtml: string;
  viewport: ReplayFrameViewport;
  scroll: ReplayScrollOffset;
  /* The page root's computed font-size: the rem base (see below). */
  rootFontSize?: string | undefined;
  /* Declarations for the frame box: the page background, the overflow. */
  frameDeclarations?: Array<string> | undefined;
}

/*
 * The SVG around the page.
 *
 * The <div> is the viewport: a snap container of the recorded size whose
 * one snap target, the marker, sits at the recorded scroll offset - so it
 * renders scrolled exactly as far as the stage was. It is positioned and
 * a stacking context, the way the real viewport's initial containing
 * block is: absolutely placed boxes with no other container scroll with
 * it, and a z-index:-1 box paints above its background but below the
 * page.
 *
 * The page's stylesheets apply to the whole SVG document, so the wrapper
 * pins every property that could move, clip or hide it with inline
 * !important, which no stylesheet outranks - a preflight's `svg { height:
 * auto }` must not resize the frame. The <svg> carries the page root's
 * font-size because rem units resolve against the document root, and in
 * the image that is the <svg>.
 */
export function buildReplayFrameSvg(input: ReplayFrameSvgInput): string {
  const width: number = input.viewport.width;
  const height: number = input.viewport.height;
  const fontSize: string =
    input.rootFontSize && PIXEL_LENGTH_PATTERN.test(input.rootFontSize.trim())
      ? ` font-size: ${input.rootFontSize.trim()} !important;`
      : "";
  const pinned: string =
    "visibility: visible !important; opacity: 1 !important; transform: none !important; translate: none !important; scale: none !important; rotate: none !important; filter: none !important; clip-path: none !important; mask: none !important;";
  const box: string = `margin: 0px !important; padding: 0px !important; border: 0px none !important; min-width: 0px !important; min-height: 0px !important; max-width: none !important; max-height: none !important; width: ${width}px !important; height: ${height}px !important;`;
  const svgStyle: string = `display: block !important; position: static !important; overflow: hidden !important; background: none !important; ${box} ${pinned}${fontSize}`;
  const foreignObjectStyle: string = `display: inline !important; overflow: hidden !important; width: ${width}px !important; height: ${height}px !important; ${pinned}`;
  const frameStyle: string = [
    "display: block !important",
    "position: relative !important",
    "z-index: 0 !important",
    "box-sizing: content-box !important",
    "scroll-snap-type: both mandatory !important",
    "scroll-padding: 0px !important",
    "scroll-behavior: auto !important",
    ...(input.frameDeclarations ?? ["overflow: hidden !important"]),
  ].join("; ");
  const markerStyle: string = `display: block !important; position: absolute !important; left: ${input.scroll.x}px !important; top: ${input.scroll.y}px !important; width: 1px !important; height: 1px !important; margin: 0px !important; padding: 0px !important; border: 0px none !important; scroll-snap-align: start !important; scroll-margin: 0px !important; pointer-events: none !important;`;

  return `<svg xmlns="${SVG_NAMESPACE}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="${escapeXmlAttribute(
    svgStyle,
  )}"><foreignObject x="0" y="0" width="${width}" height="${height}" style="${escapeXmlAttribute(
    foreignObjectStyle,
  )}"><div xmlns="${XHTML_NAMESPACE}" style="${escapeXmlAttribute(
    `${box} ${pinned} ${frameStyle}`,
  )}">${input.xhtml}<div style="${escapeXmlAttribute(
    markerStyle,
  )}"></div></div></foreignObject></svg>`;
}

/*
 * A data: URL, never a blob: one - Chromium and WebKit taint a canvas an
 * SVG <foreignObject> image from a blob: URL was drawn on. Base64, which
 * for markup is far shorter than percent-encoding.
 */
export function toSvgDataUrl(svg: string): string {
  const bytes: Uint8Array = new TextEncoder().encode(svg);
  const chunkSize: number = 0x8000;
  let binary: string = "";

  for (let index: number = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(index, index + chunkSize)),
    );
  }

  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function isElement(node: Node | null | undefined): node is Element {
  return Boolean(node) && (node as Node).nodeType === ELEMENT_NODE;
}

function isHtmlElement(element: Element): boolean {
  return (
    element.namespaceURI === XHTML_NAMESPACE || element.namespaceURI === null
  );
}

/* Serialises a sheet from the CSSOM; null when the browser will not say. */
export function readStyleSheetText(
  sheet: CSSStyleSheet | null | undefined,
): string | null {
  if (!sheet) {
    return null;
  }

  let rules: CSSRuleList;

  try {
    rules = sheet.cssRules;
  } catch {
    return null;
  }

  const texts: Array<string> = [];

  for (let index: number = 0; index < rules.length; index++) {
    const rule: CSSRule | null = rules.item(index);

    if (!rule) {
      continue;
    }

    /*
     * An @import is replaced by what it imported: the replay document has
     * it parsed already, and the image would not fetch it.
     */
    if (rule.cssText.trim().startsWith("@import")) {
      const imported: CSSRule & {
        styleSheet?: CSSStyleSheet | null;
        media?: MediaList;
      } = rule;
      const importedText: string | null = readStyleSheetText(
        imported.styleSheet,
      );
      const media: string = imported.media
        ? imported.media.mediaText.trim()
        : "";

      if (importedText) {
        texts.push(
          media ? `@media ${media} {\n${importedText}\n}` : importedText,
        );
      }

      continue;
    }

    texts.push(rule.cssText);
  }

  return texts.join("\n");
}

/* ---- The serialiser. ---- */

class ReplayFrameSerializer {
  private readonly document: Document;
  private readonly window: Window;
  private readonly viewport: ReplayFrameViewport;
  private readonly depth: number;
  private readonly output: Document;
  private readonly styles: Map<Element, CSSStyleDeclaration> = new Map<
    Element,
    CSSStyleDeclaration
  >();
  private readonly scrollPlans: Map<Element, ScrollPlan> = new Map<
    Element,
    ScrollPlan
  >();
  private readonly snapAnchors: Map<Element, ReplayScrollOffset> = new Map<
    Element,
    ReplayScrollOffset
  >();
  private readonly gutterlessScrollers: Set<Element> = new Set<Element>();
  private readonly animatedProperties: Map<Element, Set<string>> = new Map<
    Element,
    Set<string>
  >();
  private readonly modalDialogs: Set<Element> = new Set<Element>();
  private readonly frameTokens: Map<Element, string> = new Map<
    Element,
    string
  >();
  private readonly frames: Array<ReplayNestedFrame> = [];
  private readonly pseudoRules: Array<string> = [];
  private rootScroll: ReplayScrollOffset = { x: 0, y: 0 };
  private rootScroller: Element;

  public constructor(
    replayDocument: Document,
    viewport: ReplayFrameViewport,
    depth: number,
  ) {
    const view: Window | null = replayDocument.defaultView;

    if (!view || !replayDocument.documentElement) {
      throw new ReplayFrameCaptureError(
        "no-document",
        "The replay document is not available.",
      );
    }

    this.document = replayDocument;
    this.window = view;
    this.viewport = viewport;
    this.depth = depth;
    this.rootScroller =
      replayDocument.scrollingElement ?? replayDocument.documentElement;
    /*
     * An inert document to build the clone in: it has no browsing
     * context, so an <img> created in it never starts a load.
     */
    this.output = replayDocument.implementation.createHTMLDocument("");
  }

  public serialize(): ReplayFrameSerialization {
    this.measure();

    const liveRoot: Element = this.document.documentElement;
    const root: Node | null = this.cloneElement(liveRoot, {
      isInShadow: false,
      textScroll: null,
    });

    if (!isElement(root)) {
      throw new ReplayFrameCaptureError(
        "render-failed",
        "The replay document has no root element.",
      );
    }

    root.removeAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE);

    const frameDeclarations: Array<string> = this.applyRootPropagation(root);
    const head: Element = this.ensureHead(root);
    const adoptedText: string = this.readAdoptedStyleSheets();

    if (adoptedText) {
      head.appendChild(this.createStyle(adoptedText));
    }

    if (this.pseudoRules.length > 0) {
      head.appendChild(this.createStyle(this.pseudoRules.join("\n")));
    }

    head.appendChild(this.createStyle(REPLAY_FRAME_FREEZE_CSS));

    const xhtml: string = new XMLSerializer().serializeToString(root);

    return {
      viewport: this.viewport,
      svg: buildReplayFrameSvg({
        xhtml: xhtml,
        viewport: this.viewport,
        scroll: this.rootScroll,
        rootFontSize: this.getStyle(liveRoot).getPropertyValue("font-size"),
        frameDeclarations: frameDeclarations,
      }),
      backgroundColor:
        this.depth === 0 ? REPLAY_FRAME_DEFAULT_BACKGROUND : null,
      frames: this.frames,
    };
  }

  /* ---- Measurement: reads the live document, never writes to it. ---- */

  private getStyle(element: Element, pseudo?: string): CSSStyleDeclaration {
    if (pseudo) {
      return this.window.getComputedStyle(element, pseudo);
    }

    let style: CSSStyleDeclaration | undefined = this.styles.get(element);

    if (!style) {
      style = this.window.getComputedStyle(element);
      this.styles.set(element, style);
    }

    return style;
  }

  private forEachElement(root: Node, visit: (element: Element) => void): void {
    const children: HTMLCollection | undefined = (
      root as ParentNode & { children?: HTMLCollection }
    ).children;

    if (!children) {
      return;
    }

    for (let index: number = 0; index < children.length; index++) {
      const child: Element | null = children.item(index);

      if (!child) {
        continue;
      }

      visit(child);

      if (child.shadowRoot) {
        this.forEachElement(child.shadowRoot, visit);
      }

      this.forEachElement(child, visit);
    }
  }

  private measure(): void {
    this.rootScroll = {
      x: this.rootScroller.scrollLeft || 0,
      y: this.rootScroller.scrollTop || 0,
    };

    this.forEachElement(this.document, (element: Element): void => {
      const style: CSSStyleDeclaration = this.getStyle(element);

      if (
        element !== this.rootScroller &&
        this.isOverlayScroller(element, style)
      ) {
        this.gutterlessScrollers.add(element);
      }

      if (this.isModalDialog(element)) {
        this.modalDialogs.add(element);
      }

      if (element === this.rootScroller || !this.canScrollContents(element)) {
        return;
      }

      const offset: ReplayScrollOffset = {
        x: element.scrollLeft || 0,
        y: element.scrollTop || 0,
      };

      if (offset.x !== 0 || offset.y !== 0) {
        this.planScroll(element, style, offset);
      }
    });

    this.measureAnimations();
  }

  /* Form controls and frames scroll their own contents; nothing to snap. */
  private canScrollContents(element: Element): boolean {
    if (!isHtmlElement(element)) {
      return false;
    }

    const name: string = element.localName;

    return (
      name !== "textarea" &&
      name !== "select" &&
      name !== "input" &&
      name !== "iframe"
    );
  }

  /*
   * A scrolling box whose scrollbar takes no room: overlay scrollbars
   * (macOS, mobile, a hidden-scrollbar style). The image renderer may draw
   * classic ones, whose gutter would narrow the content, so the clone
   * drops the scrollbar for these boxes; a box that does have a gutter
   * keeps a real scrollbar, whose thumb the snap puts in the right place.
   */
  private isOverlayScroller(
    element: Element,
    style: CSSStyleDeclaration,
  ): boolean {
    if (!isHtmlElement(element)) {
      return false;
    }

    const isScrollable: (value: string) => boolean = (
      value: string,
    ): boolean => {
      const trimmed: string = value.trim();

      return trimmed === "auto" || trimmed === "scroll";
    };

    if (
      !isScrollable(style.getPropertyValue("overflow-x")) &&
      !isScrollable(style.getPropertyValue("overflow-y"))
    ) {
      return false;
    }

    const box: HTMLElement = element as HTMLElement;
    const borderX: number =
      (parseFloat(style.getPropertyValue("border-left-width")) || 0) +
      (parseFloat(style.getPropertyValue("border-right-width")) || 0);
    const borderY: number =
      (parseFloat(style.getPropertyValue("border-top-width")) || 0) +
      (parseFloat(style.getPropertyValue("border-bottom-width")) || 0);
    const verticalGutter: number =
      (box.offsetWidth || 0) - (box.clientWidth || 0) - borderX;
    const horizontalGutter: number =
      (box.offsetHeight || 0) - (box.clientHeight || 0) - borderY;

    return verticalGutter < 1 && horizontalGutter < 1;
  }

  private isModalDialog(element: Element): boolean {
    if (element.localName !== "dialog" || !isHtmlElement(element)) {
      return false;
    }

    try {
      return element.matches(":modal");
    } catch {
      return false;
    }
  }

  /*
   * Picks the child a scrolled box snaps to: the first one laid out in
   * flow, untransformed, whose position therefore moves with the scroll
   * and nothing else. A sticky child is skipped - its box sits where the
   * scroll pushed it, not where its layout put it.
   */
  private planScroll(
    scroller: Element,
    style: CSSStyleDeclaration,
    offset: ReplayScrollOffset,
  ): void {
    const position: string = style.getPropertyValue("position").trim();
    const plan: ScrollPlan = {
      offset: offset,
      anchor: null,
      isPositioned: position !== "" && position !== "static",
    };
    const candidates: HTMLCollection = (scroller.shadowRoot ?? scroller)
      .children;
    const scrollerBox: DOMRect = scroller.getBoundingClientRect();

    for (let index: number = 0; index < candidates.length; index++) {
      const child: Element | null = candidates.item(index);

      if (!child || !this.isSnapCandidate(child)) {
        continue;
      }

      const childBox: DOMRect = child.getBoundingClientRect();

      plan.anchor = child;
      this.snapAnchors.set(child, {
        x: computeScrollSnapMargin({
          childStart: childBox.left,
          containerStart: scrollerBox.left,
          containerBorder: scroller.clientLeft || 0,
        }),
        y: computeScrollSnapMargin({
          childStart: childBox.top,
          containerStart: scrollerBox.top,
          containerBorder: scroller.clientTop || 0,
        }),
      });
      break;
    }

    this.scrollPlans.set(scroller, plan);
  }

  private isSnapCandidate(child: Element): boolean {
    if (child.localName === "slot" || child.localName === "style") {
      return false;
    }

    if (
      typeof child.getClientRects !== "function" ||
      child.getClientRects().length === 0
    ) {
      return false;
    }

    const style: CSSStyleDeclaration = this.getStyle(child);
    const position: string = style.getPropertyValue("position").trim();
    const display: string = style.getPropertyValue("display").trim();
    const transform: string = style.getPropertyValue("transform").trim();
    const translate: string = style.getPropertyValue("translate").trim();

    return (
      (position === "" || position === "static" || position === "relative") &&
      display !== "contents" &&
      display !== "none" &&
      (transform === "" || transform === "none") &&
      (translate === "" || translate === "none")
    );
  }

  private measureAnimations(): void {
    const getAnimations: (() => Array<Animation>) | undefined = (
      this.document as Document & { getAnimations?: () => Array<Animation> }
    ).getAnimations;

    if (typeof getAnimations !== "function") {
      return;
    }

    let animations: Array<Animation> = [];

    try {
      animations = getAnimations.call(this.document);
    } catch {
      return;
    }

    for (const animation of animations) {
      const effect: KeyframeEffect | null =
        animation.effect as KeyframeEffect | null;

      if (
        !effect ||
        typeof effect.getKeyframes !== "function" ||
        effect.pseudoElement ||
        !isElement(effect.target)
      ) {
        continue;
      }

      const target: Element = effect.target;
      let properties: Set<string> | undefined =
        this.animatedProperties.get(target);

      if (!properties) {
        properties = new Set<string>();
        this.animatedProperties.set(target, properties);
      }

      for (const keyframe of effect.getKeyframes()) {
        for (const key of Object.keys(keyframe)) {
          if (
            key === "offset" ||
            key === "computedOffset" ||
            key === "easing" ||
            key === "composite"
          ) {
            continue;
          }

          properties.add(toCssPropertyName(key));
        }
      }
    }
  }

  /* ---- The root: what the real viewport did for the page. ---- */

  /*
   * The real viewport takes two things from the root: its overflow (from
   * <html>, or from <body> when <html> leaves it visible) and its
   * background (from <html>, or from <body> when <html> has none). In the
   * image the frame <div> is the viewport, so both move there, and the
   * element they came from stops applying them itself - an <html> that
   * clipped, or a <body> that painted its background over a z-index:-1
   * backdrop, would be wrong.
   */
  private applyRootPropagation(root: Element): Array<string> {
    const liveRoot: Element = this.document.documentElement;
    const liveBody: HTMLElement | null = this.document.body;
    const rootStyle: CSSStyleDeclaration = this.getStyle(liveRoot);
    const cloneBody: Element | null = this.findChild(root, "body");

    const isRootOverflowVisible: boolean =
      rootStyle.getPropertyValue("overflow-x").trim() === "visible" &&
      rootStyle.getPropertyValue("overflow-y").trim() === "visible";

    if (isRootOverflowVisible && cloneBody) {
      this.appendDeclarations(cloneBody, ["overflow: visible !important"]);
    } else {
      this.appendDeclarations(root, ["overflow: visible !important"]);
    }

    const hasBackground: (style: CSSStyleDeclaration) => boolean = (
      style: CSSStyleDeclaration,
    ): boolean => {
      return (
        !isTransparentColor(style.getPropertyValue("background-color")) ||
        style.getPropertyValue("background-image").trim() !== "none"
      );
    };

    const declarations: Array<string> = [];
    let backgroundSource: CSSStyleDeclaration | null = null;

    if (hasBackground(rootStyle)) {
      backgroundSource = rootStyle;
      this.appendDeclarations(root, ["background: none !important"]);
    } else if (liveBody && cloneBody) {
      const bodyStyle: CSSStyleDeclaration = this.getStyle(liveBody);

      if (hasBackground(bodyStyle)) {
        backgroundSource = bodyStyle;
        this.appendDeclarations(cloneBody, ["background: none !important"]);
      }
    }

    if (backgroundSource) {
      for (const property of PROPAGATED_BACKGROUND_PROPERTIES) {
        const value: string = backgroundSource.getPropertyValue(property);

        if (value) {
          declarations.push(
            `${property}: ${rewriteReplayCss(value)} !important`,
          );
        }
      }
    }

    /*
     * A classic scrollbar takes width from the viewport; keep it (the snap
     * puts its thumb where it was) so the page lays out at the width it
     * was drawn at. An overlay scrollbar takes nothing and is left out.
     */
    const hasVerticalGutter: boolean =
      liveRoot.clientWidth > 0 && liveRoot.clientWidth < this.viewport.width;
    const hasHorizontalGutter: boolean =
      liveRoot.clientHeight > 0 && liveRoot.clientHeight < this.viewport.height;

    declarations.push(
      `overflow-x: ${hasHorizontalGutter ? "scroll" : "hidden"} !important`,
      `overflow-y: ${hasVerticalGutter ? "scroll" : "hidden"} !important`,
    );

    if (!hasVerticalGutter && !hasHorizontalGutter) {
      declarations.push("scrollbar-width: none !important");
    }

    return declarations;
  }

  private findChild(parent: Element, name: string): Element | null {
    for (let index: number = 0; index < parent.children.length; index++) {
      const child: Element | null = parent.children.item(index);

      if (child && child.localName === name) {
        return child;
      }
    }

    return null;
  }

  private ensureHead(root: Element): Element {
    const existing: Element | null = this.findChild(root, "head");

    if (existing) {
      return existing;
    }

    const head: Element = this.output.createElementNS(XHTML_NAMESPACE, "head");
    root.insertBefore(head, root.firstChild);

    return head;
  }

  private createStyle(text: string): Element {
    const style: Element = this.output.createElementNS(
      XHTML_NAMESPACE,
      "style",
    );
    style.textContent = stripInvalidXmlCharacters(text);

    return style;
  }

  private readAdoptedStyleSheets(): string {
    const sheets: ReadonlyArray<CSSStyleSheet> | undefined = (
      this.document as Document & {
        adoptedStyleSheets?: ReadonlyArray<CSSStyleSheet>;
      }
    ).adoptedStyleSheets;

    if (!sheets || sheets.length === 0) {
      return "";
    }

    return sheets
      .map((sheet: CSSStyleSheet): string => {
        return rewriteReplayCss(readStyleSheetText(sheet) ?? "");
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      })
      .join("\n");
  }

  private appendDeclarations(
    clone: Element,
    declarations: Array<string>,
  ): void {
    if (declarations.length === 0) {
      return;
    }

    const existing: string = (clone.getAttribute("style") ?? "").trim();
    const joined: string = declarations.join("; ");

    clone.setAttribute(
      "style",
      existing
        ? `${existing}${existing.endsWith(";") ? "" : ";"} ${joined}`
        : joined,
    );
  }

  /* ---- Cloning. ---- */

  private cloneNode(live: Node, context: CloneContext): Node | null {
    if (live.nodeType === TEXT_NODE || live.nodeType === CDATA_SECTION_NODE) {
      const text: Text = this.output.createTextNode(
        stripInvalidXmlCharacters((live as CharacterData).data),
      );

      return context.textScroll
        ? this.wrapScrolledText(text, context.textScroll)
        : text;
    }

    if (isElement(live)) {
      return this.cloneElement(live, context);
    }

    return null;
  }

  /*
   * Text sitting directly in a scrolled box that has no child to snap to
   * is moved by the box's offset instead. A relatively positioned inline
   * box moves without changing anything else's layout.
   */
  private wrapScrolledText(text: Text, scroll: ReplayScrollOffset): Element {
    const span: Element = this.output.createElementNS(XHTML_NAMESPACE, "span");
    span.setAttribute(
      "style",
      `position: relative; left: ${-scroll.x}px; top: ${-scroll.y}px`,
    );
    span.appendChild(text);

    return span;
  }

  private cloneElement(live: Element, context: CloneContext): Node | null {
    const name: string = live.localName;
    const isHtml: boolean = isHtmlElement(live);

    if (name === "style") {
      return this.cloneStyleElement(live, context);
    }

    if (isHtml) {
      if (
        name === "script" ||
        name === "noscript" ||
        name === "template" ||
        name === "meta" ||
        name === "base" ||
        name === "title" ||
        name === "source" ||
        name === "track"
      ) {
        return null;
      }

      if (name === "link") {
        return this.cloneLinkElement(live, context);
      }

      if (
        name === "iframe" ||
        name === "frame" ||
        name === "object" ||
        name === "embed"
      ) {
        return this.cloneEmbed(live);
      }
    }

    const clone: Element = this.createClone(live);

    this.copyAttributes(live, clone);

    const declarations: Array<string> = [];

    if (context.isInShadow || this.modalDialogs.has(live)) {
      /* Flattened shadow content keeps its look only through its style. */
      clone.setAttribute("style", this.computedStyleText(live));

      if (context.isInShadow) {
        this.flattenPseudoElements(live, clone);
      }
    }

    if (isHtml && name === "img") {
      this.applyImage(live as HTMLImageElement, clone, declarations);
    }

    if (isHtml && name === "input") {
      this.applyInputState(live as HTMLInputElement, clone);
    }

    if (isHtml && name === "option") {
      if ((live as HTMLOptionElement).selected) {
        clone.setAttribute("selected", "selected");
      } else {
        clone.removeAttribute("selected");
      }
    }

    this.collectDeclarations(live, declarations);
    this.appendDeclarations(clone, declarations);

    const backdrop: Element | null = this.modalDialogs.has(live)
      ? this.createModalBackdrop(live)
      : null;

    if (isHtml && name === "textarea") {
      clone.textContent = stripInvalidXmlCharacters(
        (live as HTMLTextAreaElement).value,
      );

      return this.withBackdrop(clone, backdrop);
    }

    this.cloneChildren(live, clone, context);

    return this.withBackdrop(clone, backdrop);
  }

  private withBackdrop(clone: Element, backdrop: Element | null): Node {
    if (!backdrop) {
      return clone;
    }

    const fragment: DocumentFragment = this.output.createDocumentFragment();
    fragment.appendChild(backdrop);
    fragment.appendChild(clone);

    return fragment;
  }

  private createClone(live: Element): Element {
    const name: string = live.localName;

    if (isHtmlElement(live)) {
      return this.output.createElementNS(
        XHTML_NAMESPACE,
        isXmlSafeName(name) ? name : "span",
      );
    }

    return this.output.createElementNS(
      live.namespaceURI,
      isXmlSafeName(name) ? name : "g",
    );
  }

  private copyAttributes(live: Element, clone: Element): void {
    const isHtml: boolean = isHtmlElement(live);
    const name: string = live.localName;

    for (let index: number = 0; index < live.attributes.length; index++) {
      const attribute: Attr | null = live.attributes.item(index);

      if (!attribute) {
        continue;
      }

      const attributeName: string = attribute.localName;
      const value: string = stripInvalidXmlCharacters(attribute.value);

      if (
        attribute.namespaceURI === XLINK_NAMESPACE ||
        attribute.namespaceURI === XML_NAMESPACE
      ) {
        if (attributeName === "href" && !this.isInertReference(value)) {
          continue;
        }

        try {
          clone.setAttributeNS(attribute.namespaceURI, attribute.name, value);
        } catch {
          /* An attribute the output document will not take is dropped. */
        }

        continue;
      }

      if (attribute.namespaceURI !== null || !isXmlSafeName(attributeName)) {
        continue;
      }

      if (EVENT_HANDLER_ATTRIBUTE_PATTERN.test(attributeName)) {
        continue;
      }

      if (
        isHtml &&
        (attributeName === "src" ||
          attributeName === "srcset" ||
          attributeName === "sizes" ||
          attributeName === "loading" ||
          attributeName === "decoding" ||
          attributeName === "poster" ||
          attributeName === "autofocus" ||
          (attributeName === "data" && name === "object"))
      ) {
        continue;
      }

      if (
        !isHtml &&
        attributeName === "href" &&
        !this.isInertReference(value)
      ) {
        continue;
      }

      try {
        clone.setAttribute(
          attributeName,
          attributeName === "style" ? rewriteReplayCss(value) : value,
        );
      } catch {
        /* An attribute the output document will not take is dropped. */
      }
    }
  }

  /* A reference an SVG image resolves without fetching anything. */
  private isInertReference(value: string): boolean {
    const trimmed: string = value.trim();

    return trimmed.startsWith("#") || DATA_URL_PATTERN.test(trimmed);
  }

  private collectDeclarations(
    live: Element,
    declarations: Array<string>,
  ): void {
    const properties: Set<string> | undefined =
      this.animatedProperties.get(live);

    if (properties && properties.size > 0) {
      const style: CSSStyleDeclaration = this.getStyle(live);

      for (const property of properties) {
        const value: string = style.getPropertyValue(property);

        if (value) {
          declarations.push(
            `${property}: ${rewriteReplayCss(value)} !important`,
          );
        }
      }
    }

    if (this.gutterlessScrollers.has(live)) {
      declarations.push("scrollbar-width: none !important");
    }

    if (this.scrollPlans.has(live)) {
      declarations.push(
        "scroll-snap-type: both mandatory !important",
        "scroll-padding: 0px !important",
        "scroll-behavior: auto !important",
      );
    }

    const anchor: ReplayScrollOffset | undefined = this.snapAnchors.get(live);

    if (anchor) {
      declarations.push(
        "scroll-snap-align: start !important",
        `scroll-margin-top: ${anchor.y}px !important`,
        `scroll-margin-left: ${anchor.x}px !important`,
        "scroll-margin-bottom: 0px !important",
        "scroll-margin-right: 0px !important",
      );
    }

    if (this.modalDialogs.has(live)) {
      declarations.push("z-index: 2147483647 !important");
    }
  }

  private cloneChildren(
    live: Element,
    clone: Element,
    context: CloneContext,
  ): void {
    const plan: ScrollPlan | undefined = this.scrollPlans.get(live);
    const childContext: CloneContext = {
      isInShadow: context.isInShadow || Boolean(live.shadowRoot),
      textScroll:
        plan && !plan.anchor && !plan.isPositioned ? plan.offset : null,
    };

    if (live.shadowRoot) {
      this.appendClones(live.shadowRoot.childNodes, clone, childContext);
    } else if (
      context.isInShadow &&
      live.localName === "slot" &&
      typeof (live as HTMLSlotElement).assignedNodes === "function" &&
      (live as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
    ) {
      this.appendClones(
        (live as HTMLSlotElement).assignedNodes({ flatten: true }),
        clone,
        childContext,
      );
    } else {
      this.appendClones(live.childNodes, clone, childContext);
    }

    /*
     * A positioned box with no child to snap to gets a marker of its own,
     * the way the frame does; it is absolutely placed, so it moves
     * nothing.
     */
    if (plan && !plan.anchor && plan.isPositioned) {
      const marker: Element = this.output.createElementNS(
        XHTML_NAMESPACE,
        "span",
      );
      marker.setAttribute(
        "style",
        `display: block !important; position: absolute !important; left: ${plan.offset.x}px !important; top: ${plan.offset.y}px !important; width: 1px !important; height: 1px !important; scroll-snap-align: start !important; scroll-margin: 0px !important; pointer-events: none !important`,
      );
      clone.appendChild(marker);
    }
  }

  private appendClones(
    nodes: ArrayLike<Node>,
    parent: Element,
    context: CloneContext,
  ): void {
    for (let index: number = 0; index < nodes.length; index++) {
      const node: Node | undefined = nodes[index];

      if (!node) {
        continue;
      }

      const clone: Node | null = this.cloneNode(node, context);

      if (clone) {
        parent.appendChild(clone);
      }
    }
  }

  private computedStyleText(live: Element, pseudo?: string): string {
    const style: CSSStyleDeclaration = this.getStyle(live, pseudo);
    const parts: Array<string> = [];

    for (let index: number = 0; index < style.length; index++) {
      const property: string = style.item(index);

      if (
        !property ||
        property.startsWith("animation") ||
        property.startsWith("transition")
      ) {
        continue;
      }

      const value: string = style.getPropertyValue(property);

      if (!value) {
        continue;
      }

      parts.push(
        `${property}: ${rewriteReplayCss(stripInvalidXmlCharacters(value))} !important`,
      );
    }

    return parts.join("; ");
  }

  /*
   * ::before and ::after of a flattened shadow element: its scoped rule
   * is gone, so each is re-created as a class rule carrying its computed
   * style.
   */
  private flattenPseudoElements(live: Element, clone: Element): void {
    for (const pseudo of ["::before", "::after"]) {
      let content: string = "";

      try {
        content = this.getStyle(live, pseudo).getPropertyValue("content");
      } catch {
        content = "";
      }

      if (!content || content === "none" || content === "normal") {
        continue;
      }

      const className: string = `${REPLAY_FRAME_PSEUDO_CLASS_PREFIX}${this.depth}-${this.pseudoRules.length}`;
      const existing: string = clone.getAttribute("class") ?? "";

      clone.setAttribute("class", `${existing} ${className}`.trim());
      this.pseudoRules.push(
        `.${className}${pseudo} { ${this.computedStyleText(live, pseudo)} }`,
      );
    }
  }

  private cloneStyleElement(live: Element, context: CloneContext): Node | null {
    if (
      context.isInShadow ||
      live.hasAttribute(REPLAY_TEXT_SELECTION_STYLE_ATTRIBUTE) ||
      live.hasAttribute(REPLAY_SHADOW_TEXT_SELECTION_STYLE_ATTRIBUTE)
    ) {
      return null;
    }

    const sheet: CSSStyleSheet | null = (live as HTMLStyleElement).sheet;

    if (sheet && sheet.disabled) {
      return null;
    }

    const text: string = rewriteReplayCss(
      readStyleSheetText(sheet) ?? live.textContent ?? "",
    );
    const style: Element = this.createStyle(text);
    const media: string | null = live.getAttribute("media");

    if (media) {
      style.setAttribute("media", stripInvalidXmlCharacters(media));
    }

    return style;
  }

  private cloneLinkElement(live: Element, context: CloneContext): Node | null {
    const rel: string = (live.getAttribute("rel") ?? "").toLowerCase();

    if (
      context.isInShadow ||
      !rel.split(WHITESPACE_PATTERN).includes("stylesheet")
    ) {
      return null;
    }

    const sheet: CSSStyleSheet | null = (live as HTMLLinkElement).sheet;

    if (!sheet || sheet.disabled) {
      return null;
    }

    const text: string | null = readStyleSheetText(sheet);

    if (!text) {
      return null;
    }

    const style: Element = this.createStyle(rewriteReplayCss(text));
    const media: string | null = live.getAttribute("media");

    if (media) {
      style.setAttribute("media", stripInvalidXmlCharacters(media));
    }

    return style;
  }

  /*
   * An image keeps a data: source as it is. One the replay document did
   * decode from elsewhere (possible only where its CSP lets it) is copied
   * in when the browser lets its pixels be read, and becomes a grey box of
   * the same size when it does not. Anything else never drew on the stage
   * and is drawn broken here too.
   */
  private applyImage(
    live: HTMLImageElement,
    clone: Element,
    declarations: Array<string>,
  ): void {
    const source: string = live.currentSrc || live.getAttribute("src") || "";

    if (DATA_URL_PATTERN.test(source)) {
      clone.setAttribute("src", stripInvalidXmlCharacters(source.trim()));
      return;
    }

    if (!live.complete || !(live.naturalWidth > 0)) {
      clone.setAttribute("src", REPLAY_FRAME_BROKEN_IMAGE);
      return;
    }

    const copied: string | null = this.readImagePixels(live);

    if (copied) {
      clone.setAttribute("src", copied);
      return;
    }

    clone.setAttribute("src", REPLAY_FRAME_IMAGE_PLACEHOLDER);

    const style: CSSStyleDeclaration = this.getStyle(live);
    const width: string = style.getPropertyValue("width");
    const height: string = style.getPropertyValue("height");

    if (width && width !== "auto") {
      declarations.push(`width: ${width} !important`);
    }

    if (height && height !== "auto") {
      declarations.push(`height: ${height} !important`);
    }

    declarations.push("object-fit: fill !important");
  }

  private readImagePixels(live: HTMLImageElement): string | null {
    const box: DOMRect | null =
      typeof live.getBoundingClientRect === "function"
        ? live.getBoundingClientRect()
        : null;
    /*
     * At most twice the size it is drawn at: a 6000px photo shown as a
     * thumbnail does not need to be encoded at 6000px.
     */
    const width: number = Math.max(
      1,
      Math.round(
        Math.min(
          live.naturalWidth,
          box && box.width > 0
            ? box.width * REPLAY_FRAME_MAX_PIXEL_RATIO
            : live.naturalWidth,
        ),
      ),
    );
    const height: number = Math.max(
      1,
      Math.round((live.naturalHeight * width) / live.naturalWidth),
    );

    try {
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context: CanvasRenderingContext2D | null = canvas.getContext("2d");

      if (!context) {
        return null;
      }

      context.drawImage(live, 0, 0, width, height);

      const url: string = canvas.toDataURL("image/png");

      return typeof url === "string" && url.startsWith("data:image/")
        ? url
        : null;
    } catch {
      /* A cross-origin image taints the canvas: SecurityError. */
      return null;
    }
  }

  private applyInputState(live: HTMLInputElement, clone: Element): void {
    const type: string = (live.type || "text").toLowerCase();

    if (type === "checkbox" || type === "radio") {
      if (live.checked) {
        clone.setAttribute("checked", "checked");
      } else {
        clone.removeAttribute("checked");
      }

      return;
    }

    if (type === "file" || type === "image") {
      return;
    }

    clone.setAttribute("value", stripInvalidXmlCharacters(live.value ?? ""));
  }

  /*
   * A replaced box stands in for a frame, an object or an embed: an image
   * of the same computed box. A readable nested document is captured
   * with this same serialiser and painted into it; anything else is left
   * transparent, as an unloaded frame is.
   */
  private cloneEmbed(live: Element): Node {
    const image: Element = this.output.createElementNS(XHTML_NAMESPACE, "img");
    const id: string | null = live.getAttribute("id");
    const className: string | null = live.getAttribute("class");

    if (id) {
      image.setAttribute("id", stripInvalidXmlCharacters(id));
    }

    if (className) {
      image.setAttribute("class", stripInvalidXmlCharacters(className));
    }

    image.setAttribute("alt", "");
    image.setAttribute("style", this.computedStyleText(live));
    image.setAttribute("src", this.resolveFrameSource(live));

    const declarations: Array<string> = [];
    this.collectDeclarations(live, declarations);
    this.appendDeclarations(image, declarations);

    return image;
  }

  private resolveFrameSource(live: Element): string {
    const cached: string | undefined = this.frameTokens.get(live);

    if (cached) {
      return cached;
    }

    const name: string = live.localName;

    if (
      (name !== "iframe" && name !== "frame") ||
      this.depth >= REPLAY_FRAME_MAX_FRAME_DEPTH
    ) {
      return REPLAY_FRAME_TRANSPARENT_IMAGE;
    }

    let childDocument: Document | null = null;

    try {
      childDocument = (live as HTMLIFrameElement).contentDocument;
    } catch {
      childDocument = null;
    }

    const width: number = (live as HTMLElement).clientWidth || 0;
    const height: number = (live as HTMLElement).clientHeight || 0;

    if (
      !childDocument ||
      !childDocument.documentElement ||
      width <= 0 ||
      height <= 0
    ) {
      return REPLAY_FRAME_TRANSPARENT_IMAGE;
    }

    try {
      const serialization: ReplayFrameSerialization = new ReplayFrameSerializer(
        childDocument,
        { width: width, height: height },
        this.depth + 1,
      ).serialize();
      const token: string = `${REPLAY_FRAME_TOKEN_PREFIX}${this.depth}-${this.frames.length}`;

      this.frames.push({ token: token, serialization: serialization });
      this.frameTokens.set(live, token);

      return token;
    } catch {
      return REPLAY_FRAME_TRANSPARENT_IMAGE;
    }
  }

  /*
   * A modal dialog lives in the top layer, above everything and with a
   * ::backdrop behind it; a serialised copy is an ordinary element. It is
   * drawn with its computed (modal) style at the top of the stack, over a
   * box painted with the backdrop's colour.
   */
  private createModalBackdrop(live: Element): Element | null {
    let color: string = "";

    try {
      color = this.getStyle(live, "::backdrop").getPropertyValue(
        "background-color",
      );
    } catch {
      color = "";
    }

    if (isTransparentColor(color)) {
      return null;
    }

    const backdrop: Element = this.output.createElementNS(
      XHTML_NAMESPACE,
      "div",
    );
    backdrop.setAttribute(
      "style",
      `position: fixed !important; inset: 0px !important; z-index: 2147483646 !important; background-color: ${color} !important`,
    );

    return backdrop;
  }
}

export function serializeReplayFrame(
  replayDocument: Document,
  viewport: ReplayFrameViewport,
): ReplayFrameSerialization {
  if (
    !(viewport.width > 0) ||
    !(viewport.height > 0) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height)
  ) {
    throw new ReplayFrameCaptureError(
      "empty-viewport",
      "The recorded viewport has no size yet.",
    );
  }

  return new ReplayFrameSerializer(replayDocument, viewport, 0).serialize();
}

/* ---- Rasterising. ---- */

export interface ReplayFrameRasterDeps {
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  loadImage: (url: string) => Promise<CanvasImageSource>;
  /* Resolves after the next frame has been painted. */
  nextFrame: () => Promise<void>;
}

export interface ReplayFrameRasterizeOptions {
  pixelRatio?: number | undefined;
  pointer?: ReplayFramePointer | null | undefined;
  deps?: Partial<ReplayFrameRasterDeps> | undefined;
}

function createCanvasDefault(width: number, height: number): HTMLCanvasElement {
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  return canvas;
}

function loadImageDefault(url: string): Promise<CanvasImageSource> {
  return new Promise<HTMLImageElement>(
    (
      resolve: (image: HTMLImageElement) => void,
      reject: (error: Error) => void,
    ): void => {
      const image: HTMLImageElement = new Image();
      image.decoding = "sync";
      image.onload = (): void => {
        resolve(image);
      };
      image.onerror = (): void => {
        reject(
          new ReplayFrameCaptureError(
            "render-failed",
            "The browser could not draw this frame.",
          ),
        );
      };
      image.src = url;
    },
  ).then(async (image: HTMLImageElement): Promise<CanvasImageSource> => {
    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        /* Already loaded; decode() only makes the first draw complete. */
      }
    }

    return image;
  });
}

function nextFrameDefault(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      setTimeout(resolve, 16);
      return;
    }

    window.requestAnimationFrame((): void => {
      resolve();
    });
  });
}

/*
 * The stage's pointer, as the stage draws it: an indigo dot with a ring
 * (REPLAY_STAGE_CSS .replayer-mouse), centred on the given point.
 */
export function drawReplayFramePointer(
  context: CanvasRenderingContext2D,
  pointer: ReplayFramePointer,
  pixelRatio: number,
): void {
  context.save();
  context.beginPath();
  context.arc(
    pointer.x * pixelRatio,
    pointer.y * pixelRatio,
    10 * pixelRatio,
    0,
    Math.PI * 2,
  );
  context.fillStyle = "rgba(73, 80, 246, 0.35)";
  context.fill();
  context.lineWidth = 2 * pixelRatio;
  context.strokeStyle = "rgba(73, 80, 246, 0.9)";
  context.stroke();
  context.restore();
}

async function renderSerialization(
  serialization: ReplayFrameSerialization,
  pixelRatio: number,
  deps: ReplayFrameRasterDeps,
): Promise<HTMLCanvasElement> {
  let svg: string = serialization.svg;

  for (const frame of serialization.frames) {
    let url: string = REPLAY_FRAME_TRANSPARENT_IMAGE;

    try {
      const child: HTMLCanvasElement = await renderSerialization(
        frame.serialization,
        pixelRatio,
        deps,
      );
      url = child.toDataURL("image/png");
    } catch {
      url = REPLAY_FRAME_TRANSPARENT_IMAGE;
    }

    svg = svg.split(frame.token).join(url);
  }

  const width: number = Math.max(
    1,
    Math.round(serialization.viewport.width * pixelRatio),
  );
  const height: number = Math.max(
    1,
    Math.round(serialization.viewport.height * pixelRatio),
  );
  const canvas: HTMLCanvasElement = deps.createCanvas(width, height);
  const context: CanvasRenderingContext2D | null = canvas.getContext("2d");

  if (!context) {
    throw new ReplayFrameCaptureError(
      "render-failed",
      "This browser cannot draw the frame (no 2D canvas).",
    );
  }

  const image: CanvasImageSource = await deps.loadImage(toSvgDataUrl(svg));
  const paint: () => void = (): void => {
    context.clearRect(0, 0, width, height);

    if (serialization.backgroundColor) {
      context.fillStyle = serialization.backgroundColor;
      context.fillRect(0, 0, width, height);
    }

    context.drawImage(image, 0, 0, width, height);
  };

  /*
   * Painted twice, a frame apart, from a cleared canvas each time: WebKit
   * can draw an SVG image before the images inside it have decoded, and
   * the second pass picks them up without blending over the first.
   */
  paint();
  await deps.nextFrame();
  paint();

  return canvas;
}

export async function rasterizeReplayFrame(
  serialization: ReplayFrameSerialization,
  options?: ReplayFrameRasterizeOptions | undefined,
): Promise<HTMLCanvasElement> {
  const deps: ReplayFrameRasterDeps = {
    createCanvas: options?.deps?.createCanvas ?? createCanvasDefault,
    loadImage: options?.deps?.loadImage ?? loadImageDefault,
    nextFrame: options?.deps?.nextFrame ?? nextFrameDefault,
  };
  const pixelRatio: number = resolveReplayFramePixelRatio(
    options?.pixelRatio,
    serialization.viewport,
  );
  const canvas: HTMLCanvasElement = await renderSerialization(
    serialization,
    pixelRatio,
    deps,
  );
  const pointer: ReplayFramePointer | null | undefined = options?.pointer;

  if (
    pointer &&
    Number.isFinite(pointer.x) &&
    Number.isFinite(pointer.y) &&
    pointer.x >= 0 &&
    pointer.y >= 0 &&
    pointer.x <= serialization.viewport.width &&
    pointer.y <= serialization.viewport.height
  ) {
    const context: CanvasRenderingContext2D | null = canvas.getContext("2d");

    if (context) {
      drawReplayFramePointer(context, pointer, pixelRatio);
    }
  }

  return canvas;
}

export function encodeReplayFrameCanvas(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise<Blob>(
    (resolve: (blob: Blob) => void, reject: (error: Error) => void): void => {
      try {
        canvas.toBlob((blob: Blob | null): void => {
          if (blob) {
            resolve(blob);
            return;
          }

          reject(
            new ReplayFrameCaptureError(
              "encode-failed",
              "The frame could not be encoded as a PNG.",
            ),
          );
        }, "image/png");
      } catch {
        /* A tainted canvas throws SecurityError from toBlob. */
        reject(
          new ReplayFrameCaptureError(
            "encode-failed",
            "The browser would not export this frame.",
          ),
        );
      }
    },
  );
}

export interface ReplayFrameCaptureInput {
  document: Document;
  viewport: ReplayFrameViewport;
  pointer?: ReplayFramePointer | null | undefined;
  pixelRatio?: number | undefined;
  deps?: Partial<ReplayFrameRasterDeps> | undefined;
}

export function toReplayFrameCaptureError(
  error: unknown,
): ReplayFrameCaptureError {
  if (error instanceof ReplayFrameCaptureError) {
    return error;
  }

  return new ReplayFrameCaptureError(
    "render-failed",
    "The browser could not draw this frame.",
  );
}

/*
 * Clone now, draw and encode later. The returned promise rejects with a
 * ReplayFrameCaptureError, whatever went wrong.
 */
export function captureReplayFrame(
  input: ReplayFrameCaptureInput,
): Promise<Blob> {
  let serialization: ReplayFrameSerialization;

  try {
    serialization = serializeReplayFrame(input.document, input.viewport);
  } catch (error: unknown) {
    return Promise.reject(toReplayFrameCaptureError(error));
  }

  return rasterizeReplayFrame(serialization, {
    pixelRatio: input.pixelRatio,
    pointer: input.pointer,
    deps: input.deps,
  })
    .then((canvas: HTMLCanvasElement): Promise<Blob> => {
      return encodeReplayFrameCanvas(canvas);
    })
    .catch((error: unknown): never => {
      throw toReplayFrameCaptureError(error);
    });
}
