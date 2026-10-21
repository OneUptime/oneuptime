import SessionReplayMaskingMode, {
  doesMaskingModeRecordReadableContent,
  parseSessionReplayMaskingMode,
} from "Common/Types/Rum/SessionReplayMaskingMode";
import { isMobileSessionReplay } from "./ReplayRecorderKind";

/*
 * What the replay does with the recorded page's own images, stylesheets and
 * fonts: whether it loads them at all, what it takes out of the recording
 * before it does, which of them failed to load, and what the player tells
 * the viewer about that.
 *
 * The recorder keeps the ADDRESS of every image, and of every stylesheet it
 * could not read (a cross-origin one), not the file - so the replay loads
 * them from the recorded site, in the viewer's browser, while it plays
 * (REPLAY_DOCUMENT_CSP in ReplayStage.tsx says which kinds may load). One
 * that needs the end user's sign-in, that the site refuses to serve to
 * other sites, whose signed link has expired or that is simply gone does
 * not render, and without this the viewer is left looking at a broken
 * image with no idea why (#4119). ReplayStage listens for each element's
 * error event and hands every address over once; the player turns them
 * into a capture note and the Details panel's Missing assets list, both of
 * which link to the docs that explain the causes and what the site's owner
 * can change.
 *
 * What an element error cannot see, stated plainly: CSS background images,
 * @import and @font-face fetches (no element fails), images a page made in
 * the browser (blob: addresses, which never load outside it), and elements
 * inside a shadow root or a nested frame (the error event does not leave
 * them).
 */

export type ReplayAssetKind = "image" | "stylesheet";

export interface ReplayAssetFailure {
  kind: ReplayAssetKind;
  /* Absolute, as the element resolved it. Also the identity: one per URL. */
  url: string;
  /* Where it came from, for "from cdn.example.com". Includes the port. */
  host: string;
}

export interface ReplayAssetFailureSummary {
  images: number;
  stylesheets: number;
  /* Distinct, in the order they first failed. */
  hosts: Array<string>;
  /* More failed than REPLAY_ASSET_FAILURE_MAX_LISTED; only those are counted. */
  isTruncated: boolean;
}

/*
 * A capture note about what the replay could not LOAD in this browser,
 * rather than what the recorder could not capture.
 */
export interface ReplayPlaybackAssetNote {
  key: "assets-failed" | "images-off";
  testId: string;
  title: string;
  description: string;
  /* Only the failure note links out: the docs say why, and how to allow them. */
  docsHref: string | null;
}

/* The troubleshooting entry every "didn't load" surface links to. */
export const REPLAY_ASSET_FAILURE_DOCS_PATH: string =
  "/rum/session-replay-troubleshooting";
export const REPLAY_ASSET_FAILURE_DOCS_ANCHOR: string =
  "images-icons-or-styles-are-missing-in-the-replay";

/*
 * The most failed addresses one engine keeps. A real page has a handful;
 * a recording built to flood the viewer (tens of thousands of distinct
 * addresses that 404) is refused past this, so neither the list in the
 * Details panel nor the work behind the note grows with it.
 */
export const REPLAY_ASSET_FAILURE_MAX_LISTED: number = 200;

/* Hosts named in the note before the rest are only counted. */
const MAX_NAMED_HOSTS: number = 3;

const WHITESPACE_PATTERN: RegExp = /\s+/;
const URL_SCHEME_PATTERN: RegExp = /^[a-z][a-z0-9+.-]*:/i;

/*
 * Whether a recording is replayed masked: none of the page's images and
 * none of its web fonts are loaded (REPLAY_MASKED_DOCUMENT_CSP). True for
 * Mask all text, whose promise is a wireframe with no readable content -
 * an image is content, and a web font is the one thing left through which
 * a stylesheet in the recording could make requests that depend on what
 * the page shows. An absent or unknown mode is parsed the way the recorder
 * parses one - as Mask all text, the one mode that is never wrong to assume.
 */
export function isMaskedReplay(
  maskingMode: string | null | undefined,
): boolean {
  return !doesMaskingModeRecordReadableContent(
    parseSessionReplayMaskingMode(maskingMode),
  );
}

/* Takes the docs root (DOCS_URL) so this module stays free of Config. */
export function getReplayAssetFailureDocsHref(docsRoot: string): string {
  return `${docsRoot}${REPLAY_ASSET_FAILURE_DOCS_PATH}#${REPLAY_ASSET_FAILURE_DOCS_ANCHOR}`;
}

function stripFragment(address: string): string {
  const hashAt: number = address.indexOf("#");

  return hashAt === -1 ? address : address.slice(0, hashAt);
}

function toFailure(
  kind: ReplayAssetKind,
  address: string,
  element: Element,
): ReplayAssetFailure | null {
  let parsed: URL;

  try {
    parsed = new URL(address);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  /*
   * A recorded asset is never the replay document itself: an address that
   * resolved to it came from an empty attribute, and the page behind it is
   * the Dashboard's own player.
   */
  const documentAddress: string | undefined = element.ownerDocument?.URL;

  if (
    documentAddress &&
    stripFragment(parsed.href) === stripFragment(documentAddress)
  ) {
    return null;
  }

  return { kind: kind, url: parsed.href, host: parsed.host };
}

/*
 * What a failed element was, or null when it is not one this counts.
 *
 * Duck-typed on nodeName: the replay document belongs to another window,
 * so its elements are not instances of this window's HTMLImageElement.
 * Only http(s) addresses count - a data: or blob: image that fails is an
 * artefact of the recording, not something the site's owner can change -
 * and only <img> and <link rel=stylesheet>: media, frames and objects are
 * refused by the replay's policy on purpose, and so is every image of a
 * masked replay, which is why the caller says whether images count at all.
 */
export function describeReplayAssetFailureTarget(
  target: EventTarget | null | undefined,
  countsImages: boolean,
): ReplayAssetFailure | null {
  if (!target || typeof (target as Partial<Element>).nodeName !== "string") {
    return null;
  }

  const element: Element = target as Element;
  const nodeName: string = element.nodeName.toUpperCase();

  if (nodeName === "IMG") {
    if (!countsImages) {
      return null;
    }

    const image: HTMLImageElement = element as HTMLImageElement;

    /*
     * currentSrc is the candidate srcset picked, or the src the request
     * went to. When it is empty no request was made (an empty src fails
     * at once), and the reflected src would resolve "" to the replay
     * document's own address - so only a src that says something counts.
     */
    if (image.currentSrc) {
      return toFailure("image", image.currentSrc, element);
    }

    const source: string = (element.getAttribute("src") ?? "").trim();

    return source ? toFailure("image", image.src, element) : null;
  }

  if (nodeName === "LINK") {
    const rel: Array<string> = (element.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(WHITESPACE_PATTERN);

    if (!rel.includes("stylesheet")) {
      return null;
    }

    const href: string = (element.getAttribute("href") ?? "").trim();

    return href
      ? toFailure("stylesheet", (element as HTMLLinkElement).href, element)
      : null;
  }

  return null;
}

export function summarizeReplayAssetFailures(
  failures: ReadonlyArray<ReplayAssetFailure>,
  isTruncated: boolean = false,
): ReplayAssetFailureSummary {
  /* A Set, not includes(): a flood of distinct hosts must stay linear. */
  const hosts: Set<string> = new Set<string>();
  let images: number = 0;
  let stylesheets: number = 0;

  for (const failure of failures) {
    if (failure.kind === "image") {
      images += 1;
    } else {
      stylesheets += 1;
    }

    hosts.add(failure.host);
  }

  return {
    images: images,
    stylesheets: stylesheets,
    hosts: Array.from(hosts),
    isTruncated: isTruncated,
  };
}

function countWord(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/* "2 images and 1 stylesheet didn't load in this replay" */
export function formatReplayAssetFailureTitle(
  summary: ReplayAssetFailureSummary,
): string {
  const parts: Array<string> = [];

  if (summary.images > 0) {
    parts.push(countWord(summary.images, "image"));
  }

  if (summary.stylesheets > 0) {
    parts.push(countWord(summary.stylesheets, "stylesheet"));
  }

  return `${summary.isTruncated ? "At least " : ""}${parts.join(
    " and ",
  )} didn't load in this replay`;
}

/* "a.com", "a.com and b.com", "a.com, b.com and c.com", "a.com, b.com, c.com and 2 other sites" */
export function formatReplayAssetFailureHosts(
  hosts: ReadonlyArray<string>,
): string {
  if (hosts.length <= 1) {
    return hosts[0] ?? "";
  }

  if (hosts.length <= MAX_NAMED_HOSTS) {
    return `${hosts.slice(0, -1).join(", ")} and ${hosts[hosts.length - 1]}`;
  }

  const rest: number = hosts.length - MAX_NAMED_HOSTS;

  return `${hosts.slice(0, MAX_NAMED_HOSTS).join(", ")} and ${rest} other site${
    rest === 1 ? "" : "s"
  }`;
}

/*
 * Why a failed asset was fetched at all, for what actually failed: a
 * masked replay loads no images, so a note about its stylesheet must not
 * say it loads them.
 */
function describeWhyAssetsAreFetched(
  summary: ReplayAssetFailureSummary,
): string {
  if (summary.stylesheets === 0) {
    return "Recordings keep each image's address rather than the file itself, so the replay loads images from the recorded site while you watch.";
  }

  if (summary.images === 0) {
    return summary.stylesheets === 1
      ? "The recorder could not read this stylesheet, so the recording keeps its address and the replay loads it from the recorded site while you watch."
      : "The recorder could not read these stylesheets, so the recording keeps their addresses and the replay loads them from the recorded site while you watch.";
  }

  return "Recordings keep the address of each image, and of each stylesheet the recorder could not read, rather than the file itself, so the replay loads them from the recorded site while you watch.";
}

export function formatReplayAssetFailureDescription(
  summary: ReplayAssetFailureSummary,
): string {
  const isOne: boolean =
    summary.images + summary.stylesheets === 1 && !summary.isTruncated;
  const subject: string = isOne ? "it" : "they";
  const object: string = isOne ? "it" : "them";

  return (
    `${describeWhyAssetsAreFetched(summary)} ` +
    `${isOne ? "This one" : "These"}, from ${formatReplayAssetFailureHosts(
      summary.hosts,
    )}, did not load in your browser: ${subject} may need the user's sign-in, the site may refuse to serve ${object} to other sites, a signed link may have expired, the file${
      isOne ? " is" : "s are"
    } gone, or something in your browser, such as an ad or tracker blocker, refused ${object}. The user may still have seen ${object}.`
  );
}

export interface ReplayPlaybackAssetNotesInput {
  failures: ReadonlyArray<ReplayAssetFailure>;
  /* The stage stopped listing at REPLAY_ASSET_FAILURE_MAX_LISTED. */
  isTruncated: boolean;
  /* The manifest's, as served: "" from a server that did not say. */
  maskingMode: string;
  recorderKind: string;
  /* DOCS_URL, as a string. */
  docsRoot: string;
}

/* What the masked note says, for what the player knows of the mode. */
function describeMaskedReplay(maskingMode: string): string {
  if (maskingMode === SessionReplayMaskingMode.MaskAllText) {
    return "This session was recorded under Mask all text, which plays back as a wireframe: the recording keeps the addresses of the page's images and web fonts, but the player never loads them. An image the page held as a data: URL is part of the recording itself, and still shows.";
  }

  if (!maskingMode.trim()) {
    return "This session's masking mode was not reported, so, to be safe, the player does not load the page's images or web fonts.";
  }

  return `This session's masking mode (${maskingMode}) is not one this dashboard recognises, so, to be safe, the player does not load the page's images or web fonts.`;
}

/*
 * What the replay could not load, for the capture notes. They lead that
 * list, because they are what a viewer looking at a broken image needs:
 * the failures this browser met while playing, and - for a masked replay
 * - the fact that its images and web fonts are never loaded at all. A
 * React Native recording never carries an address to load, so it gets
 * neither.
 */
export function buildReplayPlaybackAssetNotes(
  input: ReplayPlaybackAssetNotesInput,
): Array<ReplayPlaybackAssetNote> {
  const notes: Array<ReplayPlaybackAssetNote> = [];

  if (input.failures.length > 0) {
    const summary: ReplayAssetFailureSummary = summarizeReplayAssetFailures(
      input.failures,
      input.isTruncated,
    );

    notes.push({
      key: "assets-failed",
      testId: "replay-capture-note-assets",
      title: formatReplayAssetFailureTitle(summary),
      description: formatReplayAssetFailureDescription(summary),
      docsHref: getReplayAssetFailureDocsHref(input.docsRoot),
    });
  }

  if (
    !isMobileSessionReplay(input.recorderKind) &&
    isMaskedReplay(input.maskingMode)
  ) {
    notes.push({
      key: "images-off",
      testId: "replay-capture-note-images-off",
      title: "Images and web fonts are not loaded",
      description: describeMaskedReplay(input.maskingMode),
      docsHref: null,
    });
  }

  return notes;
}

/* ---- The recording, made safe to load from before rrweb builds it. ---- */

/*
 * rrweb's event and node numbering (EventType, IncrementalSource and the
 * serialized NodeType). Spelled out because this file never imports rrweb.
 */
const RRWEB_EVENT_FULL_SNAPSHOT: number = 2;
const RRWEB_EVENT_INCREMENTAL_SNAPSHOT: number = 3;
const RRWEB_EVENT_META: number = 4;
const RRWEB_SOURCE_MUTATION: number = 0;
const RRWEB_NODE_ELEMENT: number = 2;

/* Where the neutralised name of a recorded <meta name=referrer> is kept. */
export const REPLAY_RECORDED_REFERRER_META_ATTRIBUTE: string =
  "data-oneuptime-recorded-name";

/* Attributes rrweb does not make absolute when it records them. */
const UNRESOLVED_ADDRESS_ATTRIBUTES: ReadonlyArray<string> = [
  "poster",
  "background",
];

type RecordedAttributes = Record<string, unknown>;

interface RecordedNode {
  type?: unknown;
  tagName?: unknown;
  attributes?: unknown;
  childNodes?: unknown;
}

interface RecordedEvent {
  type: number;
  data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isReferrerName(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "referrer";
}

/* An address that needs a base: no scheme, and not protocol-relative. */
function isRelativeAddress(value: string): boolean {
  const trimmed: string = value.trim();

  return (
    trimmed.length > 0 &&
    !URL_SCHEME_PATTERN.test(trimmed) &&
    !trimmed.startsWith("//")
  );
}

/* Null when a relative address has nothing to resolve against. */
function resolveAgainst(value: string, base: string | null): string | null {
  try {
    return new URL(value.trim(), base ?? undefined).href;
  } catch {
    return null;
  }
}

/*
 * A tracking or conversion pixel: an <img> declared no bigger than one
 * pixel either way. It shows nothing, so the replay loses nothing by not
 * requesting it - and requesting it would count another page view, sale or
 * conversion, from the viewer's browser and with the viewer's own cookies
 * for the tracker, every time the replay is watched.
 */
function isPixelSized(attributes: RecordedAttributes): boolean {
  const width: number = Number.parseFloat(String(attributes["width"] ?? ""));
  const height: number = Number.parseFloat(String(attributes["height"] ?? ""));

  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= 1 &&
    height <= 1
  );
}

/*
 * What relative addresses resolve against: the recorded page's address
 * (the last Meta event's href), or a recorded <base href> after it. One
 * lives as long as a ChunkLoader - one tab, which is one document, so its
 * origin never changes - because a Meta arrives only with a full snapshot
 * (a checkout a minute) while a chunk is cut every 15 seconds: most chunks
 * carry none of their own.
 */
export interface RecordedPageAddress {
  base: string | null;
}

type AddressContext = RecordedPageAddress;

function prepareElement(
  tagName: string,
  attributes: RecordedAttributes,
  context: AddressContext,
): void {
  /*
   * An element's own referrerpolicy beats the document's no-referrer meta,
   * and the replay document's address is the Dashboard's player page: a
   * tracking pixel's usual "no-referrer-when-downgrade" would hand that
   * address - project, application and session ids - to the tracker.
   */
  delete attributes["referrerpolicy"];

  if (tagName === "meta" && isReferrerName(attributes["name"])) {
    /* The same, page-wide. Kept under another name so it stays inspectable. */
    attributes[REPLAY_RECORDED_REFERRER_META_ATTRIBUTE] = attributes["name"];
    delete attributes["name"];
  }

  if (tagName === "base" && typeof attributes["href"] === "string") {
    /* rrweb made it absolute; relative addresses after it resolve to it. */
    context.base = resolveAgainst(attributes["href"], context.base);
  }

  for (const name of UNRESOLVED_ADDRESS_ATTRIBUTES) {
    const value: unknown = attributes[name];

    if (typeof value === "string" && isRelativeAddress(value)) {
      /*
       * Unresolved, it would resolve against the replay document - the
       * Dashboard - and go there with the viewer's cookies. Against the
       * recorded page it can load; with no page address it is dropped.
       */
      const resolved: string | null = resolveAgainst(value, context.base);

      if (resolved) {
        attributes[name] = resolved;
      } else {
        delete attributes[name];
      }
    }
  }

  if (tagName === "img" && isPixelSized(attributes)) {
    delete attributes["src"];
    delete attributes["srcset"];
  }
}

function prepareNodeTree(root: unknown, context: AddressContext): void {
  /* Iterative, in document order, so a deep DOM cannot overflow the stack. */
  const stack: Array<unknown> = [root];

  while (stack.length > 0) {
    const node: RecordedNode | null = asRecord(
      stack.pop(),
    ) as RecordedNode | null;

    if (!node) {
      continue;
    }

    const attributes: RecordedAttributes | null = asRecord(node.attributes);

    if (
      node.type === RRWEB_NODE_ELEMENT &&
      typeof node.tagName === "string" &&
      attributes
    ) {
      prepareElement(node.tagName.toLowerCase(), attributes, context);
    }

    if (Array.isArray(node.childNodes)) {
      for (
        let index: number = node.childNodes.length - 1;
        index >= 0;
        index--
      ) {
        stack.push(node.childNodes[index]);
      }
    }
  }
}

/*
 * An attribute mutation names only the node's id, not its tag, so the same
 * rules apply to whatever it touches: a referrerpolicy is never applied, a
 * name that would make a <meta> a referrer policy is not either (nothing
 * visible depends on an element's name), and a relative poster or
 * background is resolved or removed.
 */
function prepareAttributeChange(
  attributes: RecordedAttributes,
  context: AddressContext,
): void {
  delete attributes["referrerpolicy"];

  if (isReferrerName(attributes["name"])) {
    delete attributes["name"];
  }

  for (const name of UNRESOLVED_ADDRESS_ATTRIBUTES) {
    const value: unknown = attributes[name];

    if (typeof value === "string" && isRelativeAddress(value)) {
      attributes[name] = resolveAgainst(value, context.base);
    }
  }
}

/*
 * Takes out of a chunk's events what would make the replay request more,
 * or say more, than the recorded page's assets themselves - in place, once,
 * as the chunk is decoded (ChunkLoader), so no Replayer ever builds from
 * the originals:
 *  - every recorded referrerpolicy attribute and <meta name=referrer>, so
 *    no request carries the player's address (see prepareElement);
 *  - poster and background addresses rrweb left relative, resolved against
 *    the recorded page's address (the last Meta event before them, in this
 *    chunk or - through `context`, which the caller keeps for the tab - in
 *    an earlier one) or a recorded <base>, instead of against the
 *    Dashboard; with no address at all they are dropped;
 *  - the src and srcset of pixel-sized images (see isPixelSized).
 * These are the few things the replay document's policy cannot express;
 * script, frames and media it already refuses on its own.
 */
export function prepareRecordedEventsForPlayback(
  events: ReadonlyArray<RecordedEvent>,
  context: RecordedPageAddress = { base: null },
): void {
  for (const event of events) {
    const data: Record<string, unknown> | null = asRecord(event?.data);

    if (!data) {
      continue;
    }

    if (event.type === RRWEB_EVENT_META) {
      context.base = typeof data["href"] === "string" ? data["href"] : null;
      continue;
    }

    if (event.type === RRWEB_EVENT_FULL_SNAPSHOT) {
      prepareNodeTree(data["node"], context);
      continue;
    }

    if (
      event.type !== RRWEB_EVENT_INCREMENTAL_SNAPSHOT ||
      data["source"] !== RRWEB_SOURCE_MUTATION
    ) {
      continue;
    }

    if (Array.isArray(data["adds"])) {
      for (const add of data["adds"]) {
        prepareNodeTree(asRecord(add)?.["node"], context);
      }
    }

    if (Array.isArray(data["attributes"])) {
      for (const change of data["attributes"]) {
        const attributes: RecordedAttributes | null = asRecord(
          asRecord(change)?.["attributes"],
        );

        if (attributes) {
          prepareAttributeChange(attributes, context);
        }
      }
    }
  }
}
