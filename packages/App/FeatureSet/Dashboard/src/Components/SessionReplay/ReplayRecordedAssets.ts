import SessionReplayMaskingMode, {
  doesMaskingModeRecordReadableContent,
  parseSessionReplayMaskingMode,
} from "Common/Types/Rum/SessionReplayMaskingMode";
import { isMobileSessionReplay } from "./ReplayRecorderKind";

/*
 * What the replay does with the recorded page's own images and stylesheets:
 * whether it loads them at all, which of them failed to load, and what the
 * player tells the viewer about that.
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
 * @import and @font-face fetches (no element fails), and elements inside a
 * shadow root or a nested frame (the error event does not leave them).
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

/* Hosts named in the note before the rest are only counted. */
const MAX_NAMED_HOSTS: number = 3;

const WHITESPACE_PATTERN: RegExp = /\s+/;

/*
 * Whether a recording's replay may load the recorded page's images. Only a
 * mode that records readable content anyway does: Mask all text promises a
 * wireframe with no readable content, and an image is content. An absent
 * or unknown mode is parsed the way the recorder parses one - as Mask all
 * text, the one mode that is never wrong to assume.
 */
export function doesReplayLoadRecordedImages(
  maskingMode: string | null | undefined,
): boolean {
  return doesMaskingModeRecordReadableContent(
    parseSessionReplayMaskingMode(maskingMode),
  );
}

/* Takes the docs root (DOCS_URL) so this module stays free of Config. */
export function getReplayAssetFailureDocsHref(docsRoot: string): string {
  return `${docsRoot}${REPLAY_ASSET_FAILURE_DOCS_PATH}#${REPLAY_ASSET_FAILURE_DOCS_ANCHOR}`;
}

function toFailure(
  kind: ReplayAssetKind,
  address: string,
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
 * refused by the replay's policy on purpose, and so is every image under a
 * policy that does not load them (Mask all text), which is why the caller
 * says whether images count at all.
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

    /* currentSrc is the candidate srcset picked; src the plain attribute. */
    return toFailure("image", image.currentSrc || image.src || "");
  }

  if (nodeName === "LINK") {
    const rel: Array<string> = (element.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(WHITESPACE_PATTERN);

    if (!rel.includes("stylesheet")) {
      return null;
    }

    return toFailure("stylesheet", (element as HTMLLinkElement).href || "");
  }

  return null;
}

export function summarizeReplayAssetFailures(
  failures: ReadonlyArray<ReplayAssetFailure>,
): ReplayAssetFailureSummary {
  const hosts: Array<string> = [];
  let images: number = 0;
  let stylesheets: number = 0;

  for (const failure of failures) {
    if (failure.kind === "image") {
      images += 1;
    } else {
      stylesheets += 1;
    }

    if (!hosts.includes(failure.host)) {
      hosts.push(failure.host);
    }
  }

  return { images: images, stylesheets: stylesheets, hosts: hosts };
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

  return `${parts.join(" and ")} didn't load in this replay`;
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

export function formatReplayAssetFailureDescription(
  summary: ReplayAssetFailureSummary,
): string {
  const isOne: boolean = summary.images + summary.stylesheets === 1;
  const subject: string = isOne ? "it" : "they";
  const object: string = isOne ? "it" : "them";

  return (
    "Recordings keep the address of each image, and of each stylesheet the recorder could not read, rather than the file itself, so the replay loads them from the recorded site while you watch. " +
    `${isOne ? "This one" : "These"}, from ${formatReplayAssetFailureHosts(
      summary.hosts,
    )}, did not load in your browser: ${subject} may need the user's sign-in, the site may refuse to serve ${object} to other sites, a signed link may have expired, or the file${
      isOne ? " is" : "s are"
    } gone. The user may still have seen ${object}.`
  );
}

export interface ReplayPlaybackAssetNotesInput {
  failures: ReadonlyArray<ReplayAssetFailure>;
  /* The manifest's, as served: "" from a server that did not say. */
  maskingMode: string;
  recorderKind: string;
  /* DOCS_URL, as a string. */
  docsRoot: string;
}

/*
 * What the replay could not load, for the capture notes. They lead that
 * list, because they are what a viewer looking at a broken image needs:
 * the failures this browser met while playing, and - for a recording made
 * under Mask all text - the fact that its images are never loaded at all.
 * A React Native recording never carries an image address to load, so it
 * gets neither.
 */
export function buildReplayPlaybackAssetNotes(
  input: ReplayPlaybackAssetNotesInput,
): Array<ReplayPlaybackAssetNote> {
  const notes: Array<ReplayPlaybackAssetNote> = [];

  if (input.failures.length > 0) {
    const summary: ReplayAssetFailureSummary = summarizeReplayAssetFailures(
      input.failures,
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
    !doesReplayLoadRecordedImages(input.maskingMode)
  ) {
    notes.push({
      key: "images-off",
      testId: "replay-capture-note-images-off",
      title: "Images are not loaded",
      description:
        input.maskingMode === SessionReplayMaskingMode.MaskAllText
          ? "This session was recorded under Mask all text, which plays back as a wireframe: the recording keeps each image's address, but the player never loads it."
          : "This session's masking mode is not one this dashboard knows, so it plays back the way Mask all text does: as a wireframe, without loading the page's images.",
      docsHref: null,
    });
  }

  return notes;
}
