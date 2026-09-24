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
 *    re-serialised from cssRules - with its @media conditions settled
 *    against the replay's own window, because an image answers (hover)
 *    and (pointer) differently from the page the stage shows.
 *  - FORM STATE lives in properties. Replayed input sets .value and
 *    .checked, not the attributes a serialiser writes out.
 *  - SCROLL lives in the layout, and a clone has none. It is put back with
 *    scroll snapping, which an SVG image does honour: the frame is a
 *    snap container whose only snap target is a marker at the recorded
 *    scroll offset, and a scrolled box snaps to the first box laid out in
 *    it, at the offset that box was drawn at. The picture then really is
 *    scrolled, so sticky headers stick, fixed boxes stay put, a
 *    z-index:-1 backdrop stays behind the page, and scrollbar thumbs sit
 *    where they sat. A box that scrolls from its end (right-to-left, a
 *    reversed flex box) goes into negative offsets a snap cannot reach
 *    inside an image, so its children are moved by the offset instead.
 *  - THE ROOT is not the root inside an image. What the viewport took
 *    from it - the overflow, the background, the colour scheme - moves to
 *    the frame, and what the root resolved against itself (the rem base,
 *    :root rules) is pinned or rewritten.
 *  - SHADOW DOM cannot be serialised, so a shadow tree is flattened into
 *    its host with every element's computed style inlined behind
 *    `all: unset` (its scoped rules would otherwise leak or stop
 *    matching), the host's :host rules and pseudo-elements included.
 *  - ANIMATIONS are frozen: the clone would restart them at their first
 *    keyframe, so every animated property is pinned to its paused value.
 *  - THE TOP LAYER cannot be serialised either, so a modal dialog is drawn
 *    last and fixed over everything, with its ::backdrop behind it.
 *
 * The live replay document is only read, never written to - the one
 * thing the capture adds to a document is a blank, hidden reference frame
 * in the Dashboard's own, for the initial style values, removed before
 * it returns - and nothing here makes a network request. An SVG image
 * loads no subresources, and
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

/* The quirks-mode behaviour a standards-mode image most visibly lacks. */
export const REPLAY_FRAME_QUIRKS_CSS: string =
  "html { height: 100%; } body { min-height: 100%; } table { font-size: medium; font-weight: normal; font-style: normal; line-height: normal; white-space: normal; }";

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
const INVALID_XML_CHARACTERS: RegExp =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
/*
 * Any colour whose alpha is zero: "transparent", rgba(r, g, b, 0) of any
 * hue, and the space-separated "... / 0" forms computed colours can take.
 */
const TRANSPARENT_COLOR_PATTERN: RegExp =
  /^(?:transparent|[a-z-]+\(\s*[^,()]+,\s*[^,()]+,\s*[^,()]+,\s*0(?:\.0*)?%?\s*\)|[a-z-]+\([^()]*\/\s*0(?:\.0*)?%?\s*\))$/i;
const UPPERCASE_PATTERN: RegExp = /[A-Z]/g;
const WHITESPACE_PATTERN: RegExp = /\s+/;
const PIXEL_LENGTH_PATTERN: RegExp = /^\d+(?:\.\d+)?px$/;
const DATA_URL_PATTERN: RegExp = /^\s*data:/i;
const URL_FUNCTION_PATTERN: RegExp = /^url\(/i;
const ROOT_PSEUDO_CLASS_PATTERN: RegExp = /^:root(?![\w-])/i;
const LINK_PSEUDO_CLASS_PATTERN: RegExp =
  /^:(?:-webkit-any-link|-moz-any-link|any-link|link)(?![\w-])/i;
const VISITED_PSEUDO_CLASS_PATTERN: RegExp = /^:visited(?![\w-])/i;
const CLASS_SELECTOR_PATTERN: RegExp = /^\.[A-Za-z_][\w-]*/;
const WIDTH_PROPERTY_PATTERN: RegExp = /-width$/;
/*
 * Properties whose initial value is currentcolor: behind all: unset they
 * take the element's OWN colour, so matching the probe's (black) colour
 * says nothing about them.
 */
const CURRENT_COLOR_INITIAL_PATTERN: RegExp =
  /^(?:border(?:-(?:top|right|bottom|left|block-start|block-end|inline-start|inline-end))?-color|outline-color|column-rule-color|text-decoration-color|text-emphasis-color|-webkit-text-fill-color|-webkit-text-stroke-color|caret-color)$/;
const AUTO_SIZE_PROPERTIES: Array<string> = [
  "width",
  "height",
  "inline-size",
  "block-size",
];
const FLEX_OR_GRID_PATTERN: RegExp = /flex|grid/;
/* The element a flow marker is made of: nothing in a page styles it. */
const REPLAY_FRAME_SCROLL_MARKER_NAME: string = "oneuptime-scroll-marker";
const WHITESPACE_CHARACTER_PATTERN: RegExp = /\s/;
const NAMESPACE_AT_RULE_PATTERN: RegExp = /^@namespace\b/i;
const MEDIA_AT_RULE_PATTERN: RegExp = /^@media\b/i;
const GROUPING_AT_RULE_PATTERN: RegExp =
  /^@(?:supports|layer|container|scope|document|-moz-document|starting-style)\b/i;
const COLOR_SCHEME_WORD_PATTERN: RegExp = /[a-z-]+/gi;
const RGB_CHANNELS_PATTERN: RegExp = /[\d.]+/g;

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

const RGB_FUNCTION_PATTERN: RegExp = /^rgba?\(/i;

/*
 * Computed colours stay in their own space - oklch(), lab(), color() - in
 * Chromium and Firefox; a canvas paints any of them and reads back sRGB.
 */
function normaliseColor(color: string): string {
  const trimmed: string = color.trim();

  if (!trimmed || RGB_FUNCTION_PATTERN.test(trimmed)) {
    return trimmed;
  }

  try {
    const canvas: HTMLCanvasElement = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;

    const context: CanvasRenderingContext2D | null = canvas.getContext("2d");

    if (!context) {
      return trimmed;
    }

    context.fillStyle = "#000000";
    context.fillStyle = trimmed;
    context.fillRect(0, 0, 1, 1);

    const pixel: Uint8ClampedArray = context.getImageData(0, 0, 1, 1).data;

    return `rgb(${pixel[0] ?? 0}, ${pixel[1] ?? 0}, ${pixel[2] ?? 0})`;
  } catch {
    return trimmed;
  }
}

/*
 * Whether a computed colour is light: the stage's resolved text colour
 * tells which scheme the engine really drew the page in.
 */
export function isLightColor(color: string): boolean {
  const normalised: string = normaliseColor(color);
  const channels: Array<number> = (normalised.match(RGB_CHANNELS_PATTERN) ?? [])
    .slice(0, 3)
    .map((channel: string): number => {
      return Number(channel);
    });

  if (channels.length < 3) {
    return false;
  }

  const [red, green, blue]: Array<number> = channels;

  return (
    0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0) > 128
  );
}
const QUOTED_PATTERN: RegExp = /^(['"])([\s\S]*)\1$/;

/*
 * What makes a link look like one. An SVG image has no browsing context,
 * so nothing in it is a :link - the UA's blue underline, and every page
 * rule written for a:link, would silently stop applying. A link carries
 * these computed values across instead.
 */
export const REPLAY_FRAME_LINK_PROPERTIES: Array<string> = [
  "color",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-underline-offset",
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
  /* Every child of a reverse-origin scroller moves by its offset. */
  childScroll: ReplayScrollOffset | null;
  /* The live style of the element the clone's parent stands for. */
  parentStyle: CSSStyleDeclaration | null;
}

interface ScrollPlan {
  offset: ReplayScrollOffset;
  /*
   * Scrolls from its end (right-to-left, or a reversed flex box), into
   * negative offsets a snap cannot reach inside an image: its children
   * are moved by the offset instead.
   */
  isReverse: boolean;
  /* The box snapped into place; null when there is none to use. */
  anchor: Element | null;
  isPositioned: boolean;
  /*
   * No box to snap to in a block container: a zero-height marker goes in
   * front of its content (see cloneChildren). A flex or grid container
   * would lay a marker out as an item - one more gap - so there the
   * children are moved by the offset instead.
   */
  canTakeFlowMarker: boolean;
  /* The content edge a flow marker sits at, inside the padding box. */
  paddingTop: number;
  paddingLeft: number;
}

interface SnapMargins {
  top: number;
  left: number;
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
  /* Custom properties come back exactly as they were declared. */
  if (keyframeKey.startsWith("--")) {
    return keyframeKey;
  }

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
 *  - :root becomes REPLAY_FRAME_ROOT_SELECTOR (see there),
 *  - :link and :any-link become [href]: nothing in an image document is
 *    a link, so a:link rules would silently stop matching; :visited
 *    becomes :not(*), as the computed styles read from the stage are the
 *    unvisited ones (browsers never reveal visited styling),
 *  - an @namespace rule is left exactly as it is - its url() is a name,
 *    not a resource, and rewriting it would stop every type selector in
 *    the sheet from matching.
 */
export function rewriteReplayCss(
  css: string,
  options?: { isQuirksMode?: boolean | undefined } | undefined,
): string {
  const isQuirksMode: boolean = Boolean(options?.isQuirksMode);
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
      character === "@" &&
      NAMESPACE_AT_RULE_PATTERN.test(css.slice(index, index + 11))
    ) {
      let end: number = index;

      while (end < css.length && css.charAt(end) !== ";") {
        const inner: string = css.charAt(end);
        end =
          inner === '"' || inner === "'" ? findQuotedEnd(css, end) : end + 1;
      }

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

    if (isQuirksMode && character === ".") {
      const className: RegExpExecArray | null = CLASS_SELECTOR_PATTERN.exec(
        css.slice(index, index + 256),
      );

      if (className) {
        output += className[0].toLowerCase();
        index += className[0].length;
        continue;
      }
    }

    if (character === ":" && css.charAt(index + 1) !== ":") {
      const link: RegExpExecArray | null = LINK_PSEUDO_CLASS_PATTERN.exec(
        css.slice(index, index + 20),
      );

      if (link) {
        output += "[href]";
        index += link[0].length;
        continue;
      }

      const visited: RegExpExecArray | null = VISITED_PSEUDO_CLASS_PATTERN.exec(
        css.slice(index, index + 10),
      );

      if (visited) {
        output += ":not(*)";
        index += visited[0].length;
        continue;
      }
    }

    output += character;
    index++;
  }

  return output;
}

/*
 * Splits a value on the whitespace that is not inside any parentheses,
 * however deeply nested: "calc(10% + min(1px, 2px)) 4px" is two parts.
 */
export function splitTopLevelWhitespace(value: string): Array<string> {
  const parts: Array<string> = [];
  let depth: number = 0;
  let current: string = "";

  for (const character of value) {
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (depth === 0 && WHITESPACE_CHARACTER_PATTERN.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/*
 * A translate that moves a box by -offset on top of whatever translate it
 * already declares. The individual `translate` property composes with
 * `transform` rather than replacing it, which is why it is used here.
 */
export function composeTranslate(
  existing: string,
  offset: ReplayScrollOffset,
): string {
  const dx: string = `${-offset.x}px`;
  const dy: string = `${-offset.y}px`;
  const trimmed: string = existing.trim();

  if (!trimmed || trimmed === "none") {
    return `${dx} ${dy}`;
  }

  const parts: Array<string> = splitTopLevelWhitespace(trimmed);
  const x: string = parts[0] ?? "0px";
  const y: string = parts[1] ?? "0px";
  const z: string = parts[2] ? ` ${parts[2]}` : "";

  return `calc(${x} + ${dx}) calc(${y} + ${dy})${z}`;
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

/*
 * The canvas for a viewport at a ratio. Floored, not rounded: rounding
 * both sides up can push a frame the ratio was chosen to fit back over
 * REPLAY_FRAME_MAX_CANVAS_PIXELS.
 */
export function resolveReplayFrameCanvasSize(
  viewport: ReplayFrameViewport,
  pixelRatio: number,
): ReplayFrameViewport {
  return {
    width: Math.max(1, Math.floor(viewport.width * pixelRatio)),
    height: Math.max(1, Math.floor(viewport.height * pixelRatio)),
  };
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
  /*
   * A right-to-left root scrolls into negative offsets, which a snap
   * cannot reach inside an image; it is drawn at its horizontal origin.
   */
  const markerStyle: string = `display: block !important; position: absolute !important; left: ${Math.max(0, input.scroll.x)}px !important; top: ${Math.max(0, input.scroll.y)}px !important; width: 1px !important; height: 1px !important; margin: 0px !important; padding: 0px !important; border: 0px none !important; scroll-snap-align: start !important; scroll-margin: 0px !important; pointer-events: none !important;`;

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

/*
 * Answers a media query the way the live replay document does. Inside the
 * SVG image some features read differently - (hover), (pointer) and
 * (color) are false there in Chromium and WebKit - so conditions are
 * settled here, against the replay's own window, and the image is handed
 * rules with no @media left to evaluate.
 */
export type ReplayMediaMatcher = (query: string) => boolean;

function serializeRules(
  rules: CSSRuleList,
  matchMedia: ReplayMediaMatcher | null,
): Array<string> {
  const texts: Array<string> = [];

  for (let index: number = 0; index < rules.length; index++) {
    const rule: CSSRule | null = rules.item
      ? rules.item(index)
      : (rules as unknown as Array<CSSRule>)[index] ?? null;

    if (!rule) {
      continue;
    }

    const cssText: string = rule.cssText.trim();
    const grouping: CSSRule & {
      cssRules?: CSSRuleList;
      media?: MediaList;
      styleSheet?: CSSStyleSheet | null;
    } = rule;

    /*
     * An @import is replaced by what it imported: the replay document has
     * it parsed already, and the image would not fetch it.
     */
    if (cssText.startsWith("@import")) {
      const media: string = grouping.media
        ? grouping.media.mediaText.trim()
        : "";

      if (media && matchMedia && !matchMedia(media)) {
        continue;
      }

      const importedText: string | null = readStyleSheetText(
        grouping.styleSheet,
        matchMedia,
      );

      if (importedText) {
        texts.push(
          media && !matchMedia
            ? `@media ${media} {\n${importedText}\n}`
            : importedText,
        );
      }

      continue;
    }

    if (MEDIA_AT_RULE_PATTERN.test(cssText) && grouping.cssRules) {
      if (!matchMedia) {
        texts.push(rule.cssText);
        continue;
      }

      const media: string = grouping.media
        ? grouping.media.mediaText
        : cssText.slice(6, cssText.indexOf("{")).trim();

      if (matchMedia(media)) {
        texts.push(...serializeRules(grouping.cssRules, matchMedia));
      }

      continue;
    }

    /*
     * @supports, @layer and the like keep their wrapper (the image
     * evaluates those the same way) but their contents go through here,
     * for the @media nested inside them.
     */
    if (
      GROUPING_AT_RULE_PATTERN.test(cssText) &&
      grouping.cssRules &&
      cssText.includes("{")
    ) {
      const prelude: string = cssText.slice(0, cssText.indexOf("{")).trim();

      texts.push(
        `${prelude} {\n${serializeRules(grouping.cssRules, matchMedia).join(
          "\n",
        )}\n}`,
      );
      continue;
    }

    /*
     * A style rule with rules nested in it (CSS nesting) may hold @media
     * of its own; it is rebuilt around its settled contents.
     */
    const styleRule: CSSRule & {
      selectorText?: string;
      style?: CSSStyleDeclaration;
    } = rule;

    if (
      matchMedia &&
      typeof styleRule.selectorText === "string" &&
      styleRule.style &&
      grouping.cssRules &&
      grouping.cssRules.length > 0
    ) {
      texts.push(
        `${styleRule.selectorText} { ${styleRule.style.cssText}\n${serializeRules(
          grouping.cssRules,
          matchMedia,
        ).join("\n")}\n}`,
      );
      continue;
    }

    texts.push(rule.cssText);
  }

  return texts;
}

/* Serialises a sheet from the CSSOM; null when the browser will not say. */
export function readStyleSheetText(
  sheet: CSSStyleSheet | null | undefined,
  matchMedia?: ReplayMediaMatcher | null | undefined,
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

  if (!rules) {
    return null;
  }

  return serializeRules(rules, matchMedia ?? null).join("\n");
}

/*
 * The initial value of every property, read once from an `all: initial`
 * probe in a blank reference document. Flattened shadow content has its
 * style inlined behind `all: unset`: page rules must not reach into what
 * was a shadow tree. Behind that reset a property the clone leaves out
 * inherits from its parent if it is inherited and takes its initial value
 * if not - so a property whose value is BOTH its initial value and the
 * parent's can be left out whichever it is. That keeps an element to a
 * few dozen declarations instead of several hundred: a web-component
 * page of a few thousand elements would otherwise freeze the tab for
 * seconds and build a SVG of tens of megabytes.
 */
class ReplayInitialStyles {
  private frame: HTMLIFrameElement | null = null;
  private values: Map<string, string> | null = null;
  private isUnavailable: boolean = false;

  public get(): Map<string, string> | null {
    if (this.values || this.isUnavailable) {
      return this.values;
    }

    try {
      const frame: HTMLIFrameElement = document.createElement("iframe");

      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute(
        "style",
        "position: fixed; left: -10000px; top: -10000px; width: 0px; height: 0px; border: 0px; visibility: hidden; pointer-events: none;",
      );
      (document.body ?? document.documentElement).appendChild(frame);
      this.frame = frame;

      const reference: Document | null = frame.contentDocument;
      const view: Window | null = reference?.defaultView ?? null;

      if (!reference || !view || !reference.body) {
        throw new Error("No reference document.");
      }

      const probe: HTMLElement = reference.createElement("span");

      probe.setAttribute("style", "all: initial");
      reference.body.appendChild(probe);

      const style: CSSStyleDeclaration = view.getComputedStyle(probe);
      const values: Map<string, string> = new Map<string, string>();

      for (let index: number = 0; index < style.length; index++) {
        const property: string = style.item(index);

        values.set(property, style.getPropertyValue(property));
      }

      this.values = values;
    } catch {
      this.isUnavailable = true;
    } finally {
      this.dispose();
    }

    return this.values;
  }

  public dispose(): void {
    if (this.frame) {
      this.frame.remove();
    }

    this.frame = null;
  }
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
  private readonly snapAnchors: Map<Element, SnapMargins> = new Map<
    Element,
    SnapMargins
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
  private readonly pseudoAnimations: Map<Element, Map<string, Set<string>>> =
    new Map<Element, Map<string, Set<string>>>();
  /* Modal dialogs and their backdrops, drawn last: the top layer. */
  private readonly topLayer: Array<Node> = [];
  private readonly isQuirksMode: boolean;
  private readonly initialStyles: ReplayInitialStyles;
  private readonly matchMedia: ReplayMediaMatcher | null;
  private rootScroll: ReplayScrollOffset = { x: 0, y: 0 };
  private rootScroller: Element;

  public constructor(
    replayDocument: Document,
    viewport: ReplayFrameViewport,
    depth: number,
    initialStyles: ReplayInitialStyles,
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
    this.initialStyles = initialStyles;
    this.isQuirksMode = replayDocument.compatMode === "BackCompat";
    this.matchMedia =
      typeof view.matchMedia === "function"
        ? (query: string): boolean => {
            try {
              return view.matchMedia(query).matches;
            } catch {
              return true;
            }
          }
        : null;
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
      childScroll: null,
      parentStyle: null,
    });

    if (!isElement(root)) {
      throw new ReplayFrameCaptureError(
        "render-failed",
        "The replay document has no root element.",
      );
    }

    root.removeAttribute(REPLAY_TEXT_SELECTION_ATTRIBUTE);

    const topLayerParent: Element = this.findChild(root, "body") ?? root;

    for (const node of this.topLayer) {
      topLayerParent.appendChild(node);
    }

    const frameDeclarations: Array<string> = this.applyRootPropagation(root);
    const head: Element = this.ensureHead(root);
    const adoptedText: string = this.readAdoptedStyleSheets();

    if (adoptedText) {
      head.appendChild(this.createStyle(adoptedText));
    }

    if (this.pseudoRules.length > 0) {
      head.appendChild(this.createStyle(this.pseudoRules.join("\n")));
    }

    /*
     * A page without a doctype is replayed in quirks mode, and an image
     * always lays out in standards mode. The quirks that change a page
     * most are approximated; case-insensitive class matching and
     * percentage heights through auto-height ancestors are not.
     */
    if (this.document.compatMode === "BackCompat") {
      head.appendChild(this.createStyle(REPLAY_FRAME_QUIRKS_CSS));
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
   * Picks the box a scrolled box snaps to: the first one laid out in flow,
   * untransformed, whose position therefore moves with the scroll and
   * nothing else. The search looks through what has no box of its own -
   * display:contents wrappers, slots, plain inline elements - the way
   * layout does; a sticky, fixed, absolute or transformed box is passed
   * over, because where it is drawn is not where its layout put it.
   */
  private planScroll(
    scroller: Element,
    style: CSSStyleDeclaration,
    offset: ReplayScrollOffset,
  ): void {
    const position: string = style.getPropertyValue("position").trim();
    const isPositioned: boolean = position !== "" && position !== "static";
    /*
     * Only an axis that scrolls from its end (right-to-left, a reversed
     * flex box) has negative offsets, and only those are out of a snap's
     * reach; a right-to-left list scrolled down still snaps.
     */
    const isReverse: boolean = offset.x < 0 || offset.y < 0;
    const display: string = style.getPropertyValue("display").trim();
    const anchor: Element | null = isReverse
      ? null
      : this.findSnapAnchor(
          Array.from((scroller.shadowRoot ?? scroller).children),
          0,
        );
    const plan: ScrollPlan = {
      offset: offset,
      isReverse: isReverse,
      anchor: anchor,
      isPositioned: isPositioned,
      canTakeFlowMarker: !FLEX_OR_GRID_PATTERN.test(display),
      paddingTop: parseFloat(style.getPropertyValue("padding-top")) || 0,
      paddingLeft: parseFloat(style.getPropertyValue("padding-left")) || 0,
    };

    if (anchor) {
      const scrollerBox: DOMRect = scroller.getBoundingClientRect();
      const anchorBox: DOMRect = anchor.getBoundingClientRect();
      /*
       * Box deltas are in zoomed pixels; a scroll-margin is in the
       * anchor's own CSS pixels, which its effective zoom scales again.
       */
      const scale: number = this.readZoom(anchor, anchorBox);

      this.snapAnchors.set(anchor, {
        top:
          computeScrollSnapMargin({
            childStart: anchorBox.top,
            containerStart: scrollerBox.top,
            containerBorder: (scroller.clientTop || 0) * scale,
          }) / scale,
        left:
          computeScrollSnapMargin({
            childStart: anchorBox.left,
            containerStart: scrollerBox.left,
            containerBorder: (scroller.clientLeft || 0) * scale,
          }) / scale,
      });
    }

    this.scrollPlans.set(scroller, plan);
  }

  private findSnapAnchor(
    candidates: Array<Element>,
    depth: number,
  ): Element | null {
    for (const child of candidates) {
      const name: string = child.localName;

      if (
        name === "style" ||
        name === "script" ||
        name === "template" ||
        name === "br"
      ) {
        continue;
      }

      if (name === "slot") {
        const assigned: Array<Element> =
          typeof (child as HTMLSlotElement).assignedElements === "function"
            ? (child as HTMLSlotElement).assignedElements({ flatten: true })
            : [];
        const found: Element | null =
          depth < 8
            ? this.findSnapAnchor(
                assigned.length > 0 ? assigned : Array.from(child.children),
                depth + 1,
              )
            : null;

        if (found) {
          return found;
        }

        continue;
      }

      const style: CSSStyleDeclaration = this.getStyle(child);
      const display: string = style.getPropertyValue("display").trim();

      if (display === "none") {
        continue;
      }

      if (
        display === "contents" ||
        (display === "inline" && !this.isReplaced(child))
      ) {
        const found: Element | null =
          depth < 8
            ? this.findSnapAnchor(
                Array.from((child.shadowRoot ?? child).children),
                depth + 1,
              )
            : null;

        if (found) {
          return found;
        }

        continue;
      }

      if (this.isSnapCandidate(child, style)) {
        return child;
      }
    }

    return null;
  }

  private isReplaced(element: Element): boolean {
    const name: string = element.localName;

    return (
      name === "img" ||
      name === "svg" ||
      name === "video" ||
      name === "canvas" ||
      name === "iframe" ||
      name === "embed" ||
      name === "object" ||
      name === "input" ||
      name === "select" ||
      name === "textarea" ||
      name === "button"
    );
  }

  private isSnapCandidate(child: Element, style: CSSStyleDeclaration): boolean {
    if (
      typeof child.getClientRects !== "function" ||
      child.getClientRects().length === 0
    ) {
      return false;
    }

    const position: string = style.getPropertyValue("position").trim();
    const transform: string = style.getPropertyValue("transform").trim();
    const translate: string = style.getPropertyValue("translate").trim();

    return (
      (position === "" || position === "static" || position === "relative") &&
      (transform === "" || transform === "none") &&
      (translate === "" || translate === "none")
    );
  }

  /*
   * The anchor's effective zoom. currentCSSZoom says it outright where it
   * exists; otherwise the drawn box against the layout box tells, but only
   * a difference of a pixel or more - offsetHeight is rounded, and a 22.5px
   * row is not zoomed.
   */
  private readZoom(anchor: Element, box: DOMRect): number {
    const cssZoom: number | undefined = (
      anchor as Element & { currentCSSZoom?: number }
    ).currentCSSZoom;

    if (
      typeof cssZoom === "number" &&
      cssZoom > 0 &&
      Number.isFinite(cssZoom)
    ) {
      return cssZoom;
    }

    const width: number = (anchor as HTMLElement).offsetWidth || 0;
    const height: number = (anchor as HTMLElement).offsetHeight || 0;
    let zoom: number = 1;

    if (height > 0 && Math.abs(box.height - height) >= 1) {
      zoom = box.height / height;
    } else if (width > 0 && Math.abs(box.width - width) >= 1) {
      zoom = box.width / width;
    }

    return zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
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
        !isElement(effect.target)
      ) {
        continue;
      }

      const target: Element = effect.target;
      const pseudo: string | null = effect.pseudoElement ?? null;
      let properties: Set<string> | undefined;

      if (pseudo) {
        if (pseudo !== "::before" && pseudo !== "::after") {
          continue;
        }

        let byPseudo: Map<string, Set<string>> | undefined =
          this.pseudoAnimations.get(target);

        if (!byPseudo) {
          byPseudo = new Map<string, Set<string>>();
          this.pseudoAnimations.set(target, byPseudo);
        }

        properties = byPseudo.get(pseudo);

        if (!properties) {
          properties = new Set<string>();
          byPseudo.set(pseudo, properties);
        }
      } else {
        properties = this.animatedProperties.get(target);

        if (!properties) {
          properties = new Set<string>();
          this.animatedProperties.set(target, properties);
        }
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
   * The real viewport takes three things from the root: its overflow
   * (from <html>, or from <body> when <html> leaves it visible), its
   * background colour (from <html>, or from <body> when <html> has none)
   * and its colour scheme. In the image the frame <div> is the viewport,
   * so they move there, and the element they came from stops applying
   * them itself - an <html> that clipped, or a <body> that painted its
   * colour over a z-index:-1 backdrop, would be wrong. Background IMAGES
   * stay where they were declared, so a gradient or pattern still spans
   * and scrolls with the page rather than being squeezed into the frame.
   *
   * The clone's <html> is no longer the document root either, so what it
   * computes against the root is pinned from the live one: its font-size
   * (a relative `html { font-size: 125% }` would otherwise be applied on
   * top of the <svg>'s already-resolved size) and its colour (which would
   * otherwise inherit the image's default black).
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

    const rootDeclarations: Array<string> = [];
    const fontSize: string = rootStyle.getPropertyValue("font-size").trim();
    const color: string = rootStyle.getPropertyValue("color").trim();

    if (fontSize) {
      rootDeclarations.push(`font-size: ${fontSize} !important`);
    }

    if (color) {
      rootDeclarations.push(`color: ${color} !important`);
    }

    const declarations: Array<string> = [];
    const hasBackground: (style: CSSStyleDeclaration) => boolean = (
      style: CSSStyleDeclaration,
    ): boolean => {
      return (
        !isTransparentColor(style.getPropertyValue("background-color")) ||
        style.getPropertyValue("background-image").trim() !== "none"
      );
    };
    let backgroundSource: CSSStyleDeclaration | null = null;

    if (hasBackground(rootStyle)) {
      backgroundSource = rootStyle;
      rootDeclarations.push("background: none !important");
    } else if (liveBody && cloneBody) {
      const bodyStyle: CSSStyleDeclaration = this.getStyle(liveBody);

      if (hasBackground(bodyStyle)) {
        backgroundSource = bodyStyle;
        this.appendDeclarations(cloneBody, ["background: none !important"]);
      }
    }

    if (backgroundSource) {
      for (const property of PROPAGATED_BACKGROUND_PROPERTIES) {
        let value: string = backgroundSource.getPropertyValue(property).trim();

        if (!value) {
          continue;
        }

        /*
         * The canvas background scrolls with the document; on the frame,
         * which is the scroller, that is "local" - "scroll" would pin it
         * to the frame's box and squeeze a page-long gradient into it.
         */
        if (property === "background-attachment") {
          value = value
            .split(",")
            .map((part: string): string => {
              return part.trim() === "scroll" ? "local" : part.trim();
            })
            .join(", ");
        }

        declarations.push(`${property}: ${rewriteReplayCss(value)} !important`);
      }
    }

    const isDark: boolean = this.isDarkColorScheme(rootStyle);

    if (isDark) {
      rootDeclarations.push("color-scheme: dark !important");
      declarations.push("color-scheme: dark !important");

      /*
       * What a dark page with no background colour of its own is painted
       * with - where the engine paints one at all (see isSafariWebKit).
       */
      if (
        !isSafariWebKitHere() &&
        (!backgroundSource ||
          isTransparentColor(
            backgroundSource.getPropertyValue("background-color"),
          ))
      ) {
        declarations.push("background-color: Canvas !important");
      }
    }

    this.appendDeclarations(root, rootDeclarations);

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

  /*
   * Whether the page is drawn in its dark scheme: the root's color-scheme
   * (or the page's <meta name="color-scheme">, which the clone drops)
   * offers dark, either offers nothing else or the viewer prefers it -
   * and the engine really used it, which its resolved text colour shows
   * (WebKit keeps a replay's canvas light whatever the page asks for).
   */
  private isDarkColorScheme(rootStyle: CSSStyleDeclaration): boolean {
    if (!isLightColor(rootStyle.getPropertyValue("color"))) {
      return false;
    }

    let scheme: string = rootStyle.getPropertyValue("color-scheme").trim();

    if (!scheme || scheme === "normal") {
      const meta: Element | null = this.document.querySelector(
        'meta[name="color-scheme"]',
      );

      scheme = meta ? meta.getAttribute("content") ?? "" : "";
    }

    const words: Array<string> = (
      scheme.match(COLOR_SCHEME_WORD_PATTERN) ?? []
    ).map((word: string): string => {
      return word.toLowerCase();
    });

    if (!words.includes("dark")) {
      return false;
    }

    if (!words.includes("light")) {
      return true;
    }

    return this.matchMedia
      ? this.matchMedia("(prefers-color-scheme: dark)")
      : false;
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
        return rewriteReplayCss(
          readStyleSheetText(sheet, this.matchMedia) ?? "",
          { isQuirksMode: this.isQuirksMode },
        );
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

    const isModal: boolean = this.modalDialogs.has(live);

    if (isModal) {
      /* Its UA :modal rules no longer apply once it is serialised. */
      clone.setAttribute("style", this.computedStyleText(live));
    } else if (context.isInShadow || live.shadowRoot) {
      /*
       * Flattened shadow content keeps its look only through its style -
       * and so does the host, whose :host rules lived in the shadow tree.
       */
      clone.setAttribute(
        "style",
        this.computedStyleText(live, undefined, context.parentStyle),
      );
      this.flattenPseudoElements(live, clone);
    } else {
      this.freezePseudoAnimations(live, clone);
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

    this.collectDeclarations(live, declarations, context);

    if (this.isQuirksMode && isHtml) {
      this.applyQuirks(live, clone, declarations);
    }

    this.appendDeclarations(clone, declarations);

    /*
     * The top layer is above everything and positioned against the
     * viewport whatever its ancestors do, so a modal dialog leaves its
     * place in the tree - where a transformed or clipped ancestor would
     * capture it - and is drawn last, over its backdrop. Its place in that
     * layer is taken before its children are cloned, so a modal opened
     * from inside it comes after it, on top, as it was opened.
     */
    if (isModal) {
      const backdrop: Element | null = this.createModalBackdrop(live);

      if (backdrop) {
        this.topLayer.push(backdrop);
      }

      this.topLayer.push(clone);
    }

    if (isHtml && name === "textarea") {
      const textarea: HTMLTextAreaElement = live as HTMLTextAreaElement;

      if (textarea.scrollTop || textarea.scrollLeft) {
        return this.cloneScrolledTextarea(textarea, context);
      }

      clone.textContent = stripInvalidXmlCharacters(textarea.value);
    } else {
      this.cloneChildren(
        live,
        clone,
        isModal ? { ...context, isInShadow: true } : context,
      );
    }

    return isModal ? null : clone;
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

      /*
       * Namespace declarations belong to the serialiser: an exported
       * page's stray xmlns="http://www.w3.org/TR/REC-html40" would put
       * the whole clone in a namespace nothing renders.
       */
      if (
        attribute.namespaceURI !== null ||
        !isXmlSafeName(attributeName) ||
        attributeName === "xmlns"
      ) {
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

  private isLink(live: Element): boolean {
    for (const selector of [":any-link", ":link"]) {
      try {
        return live.matches(selector);
      } catch {
        /* An engine without this pseudo-class; try the next. */
      }
    }

    return false;
  }

  private collectDeclarations(
    live: Element,
    declarations: Array<string>,
    context?: CloneContext | undefined,
  ): void {
    if (context && context.childScroll) {
      const style: CSSStyleDeclaration = this.getStyle(live);
      const position: string = style.getPropertyValue("position").trim();
      const display: string = style.getPropertyValue("display").trim();

      if (
        display === "inline" &&
        (position === "static" || position === "relative")
      ) {
        /*
         * A translate does nothing to an inline box; relative offsets do,
         * on top of any it already has.
         */
        const readOffset: (property: string) => string = (
          property: string,
        ): string => {
          const value: string = style.getPropertyValue(property).trim();

          return position === "relative" && value && value !== "auto"
            ? value
            : "0px";
        };

        declarations.push(
          "position: relative !important",
          `left: calc(${readOffset("left")} + ${-context.childScroll.x}px) !important`,
          `top: calc(${readOffset("top")} + ${-context.childScroll.y}px) !important`,
        );
      } else if (position !== "fixed") {
        declarations.push(
          `translate: ${composeTranslate(
            style.getPropertyValue("translate"),
            context.childScroll,
          )} !important`,
        );
      }
    }

    if (this.isLink(live)) {
      const style: CSSStyleDeclaration = this.getStyle(live);

      for (const property of REPLAY_FRAME_LINK_PROPERTIES) {
        const value: string = style.getPropertyValue(property);

        if (value) {
          declarations.push(`${property}: ${value}`);
        }
      }
    }

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

    const plan: ScrollPlan | undefined = this.scrollPlans.get(live);

    if (plan) {
      declarations.push(
        "scroll-snap-type: both mandatory !important",
        "scroll-padding: 0px !important",
        "scroll-behavior: auto !important",
      );
    }

    const anchor: SnapMargins | undefined = this.snapAnchors.get(live);

    if (anchor) {
      declarations.push(
        "scroll-snap-align: start !important",
        `scroll-margin-top: ${anchor.top}px !important`,
        `scroll-margin-left: ${anchor.left}px !important`,
        "scroll-margin-bottom: 0px !important",
        "scroll-margin-right: 0px !important",
      );
    }

    if (this.modalDialogs.has(live)) {
      declarations.push(
        "position: fixed !important",
        "z-index: 2147483647 !important",
      );
    }
  }

  private cloneChildren(
    live: Element,
    clone: Element,
    context: CloneContext,
  ): void {
    const plan: ScrollPlan | undefined = this.scrollPlans.get(live);
    const needsMarker: boolean = Boolean(
      plan && !plan.anchor && !plan.isReverse,
    );
    const hasAbsoluteMarker: boolean = Boolean(
      needsMarker && plan && plan.isPositioned,
    );
    const hasFlowMarker: boolean = Boolean(
      needsMarker && plan && !plan.isPositioned && plan.canTakeFlowMarker,
    );
    /* Neither marker fits: the children are moved instead. */
    const movesChildren: boolean = Boolean(
      plan &&
        (plan.isReverse ||
          (needsMarker && !hasAbsoluteMarker && !hasFlowMarker)),
    );
    /*
     * A display:contents box (a slot among them) has no box to move, so
     * an offset handed to it passes on to its children.
     */
    const isContents: boolean =
      this.getStyle(live).getPropertyValue("display").trim() === "contents";
    const childContext: CloneContext = {
      isInShadow: context.isInShadow || Boolean(live.shadowRoot),
      textScroll:
        plan && movesChildren
          ? plan.offset
          : isContents
            ? context.textScroll
            : null,
      childScroll:
        plan && movesChildren
          ? plan.offset
          : isContents
            ? context.childScroll
            : null,
      parentStyle: this.getStyle(live),
    };

    /*
     * A block box with nothing to snap to gets a zero-height marker in
     * front of its content, snapped the way an anchor is: it sits at the
     * content edge, so its margin is that edge's distance from the
     * scrolled-to position. In flow it changes no containing block and no
     * stacking; its own element name keeps type selectors off it.
     */
    if (plan && hasFlowMarker) {
      const marker: Element = this.output.createElementNS(
        XHTML_NAMESPACE,
        REPLAY_FRAME_SCROLL_MARKER_NAME,
      );
      marker.setAttribute(
        "style",
        `display: block !important; width: 0px !important; height: 0px !important; margin: 0px !important; padding: 0px !important; border: 0px none !important; float: none !important; scroll-snap-align: start !important; scroll-margin-top: ${plan.paddingTop - plan.offset.y}px !important; scroll-margin-left: ${plan.paddingLeft - plan.offset.x}px !important; scroll-margin-bottom: 0px !important; scroll-margin-right: 0px !important; pointer-events: none !important`,
      );
      clone.appendChild(marker);
    }

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
     * A positioned box with nothing to snap to gets an absolutely placed
     * marker of its own, the way the frame does: it moves nothing.
     */
    if (plan && hasAbsoluteMarker) {
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

  /*
   * An element's computed style as inline declarations. Given the parent's
   * style it is written behind `all: unset`, leaving out what the reset
   * already gets right (see ReplayInitialStyles).
   */
  private computedStyleText(
    live: Element,
    pseudo?: string,
    parentStyle?: CSSStyleDeclaration | null,
    keepUsedSizes?: boolean,
  ): string {
    const style: CSSStyleDeclaration = this.getStyle(live, pseudo);
    const initial: Map<string, string> | null =
      !pseudo && parentStyle ? this.initialStyles.get() : null;
    const parts: Array<string> = initial ? ["all: unset !important"] : [];
    /*
     * A stand-in of another kind (a frame drawn as an <img>, a textarea as
     * a <div>) cannot rebuild the live element's intrinsic size, so it
     * keeps the used one.
     */
    const autoSizes: Set<string> =
      pseudo || keepUsedSizes ? new Set<string>() : this.readAutoSizes(live);

    for (let index: number = 0; index < style.length; index++) {
      const property: string = style.item(index);

      if (autoSizes.has(property)) {
        continue;
      }

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

      /*
       * A border, outline or column-rule width computes to 0 while its
       * style is none, so the probe's "initial" 0px is not what the reset
       * gives it once a style is set: widths are always written out.
       */
      if (
        initial &&
        parentStyle &&
        !WIDTH_PROPERTY_PATTERN.test(property) &&
        (!CURRENT_COLOR_INITIAL_PATTERN.test(property) ||
          value === style.getPropertyValue("color")) &&
        initial.get(property) === value &&
        parentStyle.getPropertyValue(property) === value
      ) {
        continue;
      }

      parts.push(
        `${property}: ${rewriteReplayCss(stripInvalidXmlCharacters(value))} !important`,
      );
    }

    return parts.join("; ");
  }

  /*
   * The sizes an element leaves to layout. getComputedStyle answers width
   * and height with the USED size, and pinning that turns an auto height
   * into a fixed one - which, among other things, stops a child's margin
   * collapsing through it. The typed computed style still says "auto";
   * an engine without it (Firefox) gets the used size, as before.
   */
  private readAutoSizes(live: Element): Set<string> {
    const autoSizes: Set<string> = new Set<string>();
    const readMap: (() => StylePropertyMapReadOnly) | undefined = (
      live as Element & { computedStyleMap?: () => StylePropertyMapReadOnly }
    ).computedStyleMap;

    if (typeof readMap !== "function") {
      return autoSizes;
    }

    try {
      const map: StylePropertyMapReadOnly = readMap.call(live);

      for (const property of AUTO_SIZE_PROPERTIES) {
        const value: CSSStyleValue | undefined = map.get(property);

        if (value && value.toString() === "auto") {
          autoSizes.add(property);
        }
      }
    } catch {
      /* No typed values for this element; the used sizes will do. */
    }

    return autoSizes;
  }

  /*
   * An animated ::before / ::after: the frozen clone would drop it back to
   * its unanimated style (a badge that faded in would vanish), so its
   * animated properties are pinned at their paused values in a rule.
   */
  private freezePseudoAnimations(live: Element, clone: Element): void {
    const byPseudo: Map<string, Set<string>> | undefined =
      this.pseudoAnimations.get(live);

    if (!byPseudo) {
      return;
    }

    for (const [pseudo, properties] of byPseudo) {
      let style: CSSStyleDeclaration;

      try {
        style = this.getStyle(live, pseudo);
      } catch {
        continue;
      }

      const declarations: Array<string> = [];

      for (const property of properties) {
        const value: string = style.getPropertyValue(property);

        if (value) {
          declarations.push(
            `${property}: ${rewriteReplayCss(stripInvalidXmlCharacters(value))} !important`,
          );
        }
      }

      if (declarations.length > 0) {
        this.addPseudoRule(clone, pseudo, declarations.join("; "));
      }
    }
  }

  private addPseudoRule(
    clone: Element,
    pseudo: string,
    declarations: string,
  ): void {
    const className: string = `${REPLAY_FRAME_PSEUDO_CLASS_PREFIX}${this.depth}-${this.pseudoRules.length}`;
    const existing: string = clone.getAttribute("class") ?? "";

    clone.setAttribute("class", `${existing} ${className}`.trim());
    this.pseudoRules.push(`.${className}${pseudo} { ${declarations} }`);
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

      this.addPseudoRule(clone, pseudo, this.computedStyleText(live, pseudo));
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

    const media: string | null = live.getAttribute("media");

    if (media && this.matchMedia && !this.matchMedia(media)) {
      return null;
    }

    const text: string = rewriteReplayCss(
      readStyleSheetText(sheet, this.matchMedia) ?? live.textContent ?? "",
      { isQuirksMode: this.isQuirksMode },
    );
    const style: Element = this.createStyle(text);

    if (media && !this.matchMedia) {
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

    const media: string | null = live.getAttribute("media");

    if (media && this.matchMedia && !this.matchMedia(media)) {
      return null;
    }

    const text: string | null = readStyleSheetText(sheet, this.matchMedia);

    if (!text) {
      return null;
    }

    const style: Element = this.createStyle(
      rewriteReplayCss(text, { isQuirksMode: this.isQuirksMode }),
    );

    if (media && !this.matchMedia) {
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

  /*
   * Quirks mode, which an image cannot use. Its percentage-height quirk
   * (a % height resolved against the viewport through auto-height
   * ancestors) moves pages the most, so every box keeps the height it was
   * laid out at; and class names match case-insensitively, so they are
   * lowercased here and in the rules (rewriteReplayCss).
   */
  private applyQuirks(
    live: Element,
    clone: Element,
    declarations: Array<string>,
  ): void {
    /*
     * Lowercase copies are added, not swapped in: [class*="Btn"] is still
     * case-sensitive in quirks mode and must keep matching the original.
     */
    const className: string | null = clone.getAttribute("class");

    if (className) {
      const tokens: Array<string> = className
        .split(WHITESPACE_PATTERN)
        .filter((token: string): boolean => {
          return token.length > 0;
        });
      const lowered: Array<string> = tokens
        .map((token: string): string => {
          return token.toLowerCase();
        })
        .filter((token: string): boolean => {
          return !tokens.includes(token);
        });

      if (lowered.length > 0) {
        clone.setAttribute("class", [...tokens, ...lowered].join(" "));
      }
    }

    const style: CSSStyleDeclaration = this.getStyle(live);
    const display: string = style.getPropertyValue("display").trim();
    const height: string = style.getPropertyValue("height").trim();

    if (
      display !== "inline" &&
      display !== "none" &&
      display !== "contents" &&
      PIXEL_LENGTH_PATTERN.test(height)
    ) {
      declarations.push(`height: ${height} !important`);
    }

    /*
     * The quirky default margin: the UA's top margin on the first block in
     * <body> (a <p>, a heading) is dropped altogether, where standards
     * mode collapses it through the body. The live layout shows which:
     * the block sits nearer the top of the page than its own margin.
     */
    const body: HTMLElement | null = this.document.body;

    if (
      body &&
      live.parentElement === body &&
      body.firstElementChild === live
    ) {
      const marginTop: number =
        parseFloat(style.getPropertyValue("margin-top")) || 0;
      const top: number =
        live.getBoundingClientRect().top -
        this.document.documentElement.getBoundingClientRect().top;

      if (marginTop > 0 && top < marginTop) {
        declarations.push("margin-top: 0px !important");
      }
    }
  }

  /*
   * A textarea cannot be scrolled inside an image, so a scrolled one is
   * drawn as a box with its computed style and its text moved by the
   * offset - the lines the user was looking at, not the first ones.
   */
  private cloneScrolledTextarea(
    live: HTMLTextAreaElement,
    context: CloneContext,
  ): Element {
    const box: Element = this.output.createElementNS(XHTML_NAMESPACE, "div");
    const text: Element = this.output.createElementNS(XHTML_NAMESPACE, "div");
    const declarations: Array<string> = [
      "overflow: hidden !important",
      "white-space: pre-wrap !important",
    ];

    for (const attribute of ["id", "class"]) {
      const value: string | null = live.getAttribute(attribute);

      if (value) {
        box.setAttribute(attribute, stripInvalidXmlCharacters(value));
      }
    }

    box.setAttribute(
      "style",
      this.computedStyleText(live, undefined, undefined, true),
    );
    this.collectDeclarations(live, declarations, context);
    this.appendDeclarations(box, declarations);
    text.setAttribute(
      "style",
      `position: relative; left: ${-(live.scrollLeft || 0)}px; top: ${-(live.scrollTop || 0)}px`,
    );
    text.textContent = stripInvalidXmlCharacters(live.value);
    box.appendChild(text);

    return box;
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

    /*
     * A submit, reset or button input with no value shows the browser's
     * own label ("Submit"); writing value="" would blank it.
     */
    if (
      (type === "submit" || type === "reset" || type === "button") &&
      !live.hasAttribute("value")
    ) {
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
    image.setAttribute(
      "style",
      this.computedStyleText(live, undefined, undefined, true),
    );
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
        this.initialStyles,
      ).serialize();
      /*
       * Terminated, so no token is the start of another: "-0-1-src" is
       * not a prefix of "-0-10-src", where "-0-1" was of "-0-10".
       */
      const token: string = `${REPLAY_FRAME_TOKEN_PREFIX}${this.depth}-${this.frames.length}-src`;

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
      /*
       * The same z-index as every other top-layer box: they stack in the
       * order they were opened, each backdrop over the dialogs before it.
       */
      `position: fixed !important; inset: 0px !important; z-index: 2147483647 !important; background-color: ${color} !important`,
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

  const initialStyles: ReplayInitialStyles = new ReplayInitialStyles();

  try {
    return new ReplayFrameSerializer(
      replayDocument,
      viewport,
      0,
      initialStyles,
    ).serialize();
  } finally {
    initialStyles.dispose();
  }
}

/* ---- Rasterising. ---- */

export interface ReplayFrameRasterDeps {
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  loadImage: (url: string) => Promise<CanvasImageSource>;
  /* Resolves after the next frame has been painted. */
  nextFrame: () => Promise<void>;
  /* Milliseconds, for the settle loop below. */
  now: () => number;
  /*
   * How long to keep repainting a frame that embeds nested frames, for an
   * engine that decodes the pictures inside an SVG image late.
   */
  getSettleMs: (embeddedBytes: number) => number;
}

/*
 * Safari's engine, told apart from the Blink browsers that also say
 * AppleWebKit. It differs from them twice here: it decodes a data: <img>
 * inside an SVG image asynchronously, and a large one (a nested frame's
 * picture) can still be missing a few hundred milliseconds after the
 * image itself loaded, so every repaint in that time is a chance to pick
 * it up; and it never paints a replay iframe's canvas in the page's dark
 * scheme.
 */
export function isSafariWebKit(userAgent: string): boolean {
  return (
    userAgent.includes("AppleWebKit") &&
    !userAgent.includes("Chrome") &&
    !userAgent.includes("Chromium") &&
    /* "Edg/" is Chromium Edge; Edge on iOS (EdgiOS) is WebKit. */
    !userAgent.includes("Edg/")
  );
}

function isSafariWebKitHere(): boolean {
  return (
    typeof navigator !== "undefined" && isSafariWebKit(navigator.userAgent)
  );
}

export function resolveReplayFrameSettleMs(
  embeddedBytes: number,
  isLateDecoder: boolean,
): number {
  if (!isLateDecoder || embeddedBytes <= 0) {
    return 0;
  }

  return Math.min(2000, 600 + Math.round(embeddedBytes / 2000));
}

function getSettleMsDefault(embeddedBytes: number): number {
  return resolveReplayFrameSettleMs(embeddedBytes, isSafariWebKitHere());
}

function nowDefault(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : 0;
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
  let embeddedBytes: number = 0;

  for (const frame of serialization.frames) {
    let url: string = REPLAY_FRAME_TRANSPARENT_IMAGE;

    try {
      /*
       * Each frame gets its own budget: a tall auto-height iframe at the
       * page's ratio can be over the canvas limit on its own.
       */
      const child: HTMLCanvasElement = await renderSerialization(
        frame.serialization,
        resolveReplayFramePixelRatio(pixelRatio, frame.serialization.viewport),
        deps,
      );
      url = child.toDataURL("image/png");
    } catch {
      url = REPLAY_FRAME_TRANSPARENT_IMAGE;
    }

    embeddedBytes += url.length;
    svg = svg.split(frame.token).join(url);
  }

  const size: ReplayFrameViewport = resolveReplayFrameCanvasSize(
    serialization.viewport,
    pixelRatio,
  );
  const width: number = size.width;
  const height: number = size.height;
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

  const settleMs: number = deps.getSettleMs(embeddedBytes);

  if (settleMs > 0) {
    const start: number = deps.now();

    while (deps.now() - start < settleMs) {
      await deps.nextFrame();
      paint();
    }
  }

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
    now: options?.deps?.now ?? nowDefault,
    getSettleMs: options?.deps?.getSettleMs ?? getSettleMsDefault,
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
