import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  REPLAY_ASSET_FAILURE_DOCS_ANCHOR,
  REPLAY_ASSET_FAILURE_DOCS_PATH,
  ReplayPlaybackAssetNote,
  buildReplayPlaybackAssetNotes,
  doesReplayLoadRecordedImages,
  formatReplayAssetFailureTitle,
} from "../../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayRecordedAssets";
import slugify from "Common/Server/Types/MarkdownSlugify";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4119: what a replay loads from the recorded site, and what a
 * viewer can do when it does not.
 *
 * A recording keeps the addresses of the page's images, of the stylesheets
 * the recorder could not read and of its web fonts, never the files, so the
 * player loads them from those addresses while it plays. Its policy used to
 * refuse all of them, and the docs described the result - "falls back to a
 * system font stack", "plays back unstyled with a notice" - as properties
 * of the recording. The player now lets them through (REPLAY_DOCUMENT_CSP in
 * ReplayStage.tsx), keeps them out for Mask all text recordings, and links
 * every "didn't load" note to a troubleshooting entry.
 *
 * These tests pin that story against the code that tells it: the heading
 * the player's docs link lands on, the blocked list against the directives
 * the policy sets to 'none', the Mask all text promise against the policy
 * and the decision the stage makes, the note titles the docs quote against
 * the functions that write them - in English and in the Persian mirrors,
 * which are served in place of the English pages and which no other test
 * watches for this change.
 */
const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DASHBOARD_REPLAY_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Components/SessionReplay",
);
const RECORDER_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/BrowserRecorder",
);

const NAV_GROUP_TITLE: string = "Real User Monitoring";

const PLAYBACK_HEADING: string = "## Images, styles and fonts during playback";
const PLAYBACK_ANCHOR: string = "images-styles-and-fonts-during-playback";
const TROUBLESHOOTING_HEADING: string =
  "## Images, icons or styles are missing in the replay";
const STYLESHEET_HEADING: string =
  "### Recording a stylesheet from another origin";

const PERSIAN_PLAYBACK_HEADING: string =
  "## تصویرها، سبک‌ها و فونت‌ها هنگام پخش";
const PERSIAN_TROUBLESHOOTING_HEADING: string =
  "## تصویرها، آیکون‌ها یا سبک‌ها در بازپخش غایب‌اند";

/*
 * What the playback section names for each directive REPLAY_DOCUMENT_CSP
 * sets to 'none'. A directive added to the policy without an entry here
 * fails the test that reads it, so the "stays blocked" list a reader relies
 * on cannot fall behind the policy that enforces it. default-src appears as
 * frames: frame-src falls back to it, and a frame that never loads is what
 * a viewer would notice (workers already fall back to script-src).
 */
const BLOCKED_WORDING: Record<string, Array<string>> = {
  "script-src": ["scripts"],
  "default-src": ["frame"],
  "connect-src": ["`fetch`", "XHR", "WebSocket"],
  "object-src": ["`<object>`", "`<embed>`"],
  "media-src": ["video", "audio"],
  "form-action": ["form submission"],
};

const PERSIAN_BLOCKED_WORDING: Record<string, Array<string>> = {
  "script-src": ["اسکریپت‌ها"],
  "default-src": ["iframe"],
  "connect-src": ["`fetch`", "XHR", "WebSocket"],
  "object-src": ["`<object>`", "`<embed>`"],
  "media-src": ["ویدیو و صدا"],
  "form-action": ["فرستادن فرم"],
};

/* The directives that let the recorded page's own files through. */
const LOADED_WORDING: Record<string, string> = {
  "img-src": "Images",
  "style-src": "stylesheets",
  "font-src": "web fonts",
};

/*
 * Claims the player no longer makes: a system font as the rule rather
 * than the fallback, an unstyled replay as the rule, a media placeholder
 * nothing draws, and query strings dropped from addresses that playback
 * has to load as they are.
 */
const RETIRED_ENGLISH_CLAIMS: Array<string> = [
  "system font stack",
  "play back unstyled with a notice",
  "labelled placeholder",
  "dropped from every recorded URL",
];

const RETIRED_PERSIAN_CLAIMS: Array<string> = [
  "پشته فونت سیستمی",
  "بدون سبک بازپخش می‌شود",
  "جانگهداری برچسب‌دار",
  "از هر نشانی ضبط‌شده انداخته می‌شوند",
];

const FENCE_LINE: RegExp = /^\s*```/;
const SECTION_HEADING_LINE: RegExp = /^## /;
const WHITESPACE: RegExp = /\s/;
const IDENTIFIER_START: RegExp = /[A-Za-z_$]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_$]/;
const IDENTIFIER: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ASCII_ONLY: RegExp = /^[\x20-\x7E]+$/;

function readContent(language: string, relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, relative), "utf8");
}

function readSource(directory: string, relative: string): string {
  return fs.readFileSync(path.join(directory, relative), "utf8");
}

/* Prose lines only: a "# comment" or a link inside a code sample is neither. */
function proseLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines;
}

/*
 * Headings become ids through the renderer's own slugify, the import
 * Scripts/Docs/CheckAnchors.ts uses, so an anchor that passes here
 * resolves on the rendered page too - Persian ones included.
 */
function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();

  for (const line of proseLines(markdown)) {
    const match: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);

    if (match) {
      slugs.add(slugify(match[1] as string));
    }
  }

  return slugs;
}

function headingSlug(heading: string): string {
  return slugify(heading.replace(/^#+\s+/, "").trim());
}

/* The page's H2 headings, in order. */
function sectionHeadings(markdown: string): Array<string> {
  return proseLines(markdown).filter((line: string): boolean => {
    return SECTION_HEADING_LINE.test(line);
  });
}

/* One heading's body, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* The first line of a block of markdown that contains a phrase. */
function lineContaining(markdown: string, phrase: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.includes(phrase);
    });

  expect([phrase, line !== undefined]).toEqual([phrase, true]);

  return line as string;
}

/* One bullet or numbered step's line, found by how it starts. */
function lineStartingWith(markdown: string, start: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect([start, line !== undefined]).toEqual([start, true]);

  return line as string;
}

/* A table row's text, found by its first cell. */
function tableRow(markdown: string, firstCell: string): string {
  const pattern: RegExp = new RegExp(
    `^\\|\\s*\\u200f?${firstCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
  );
  const row: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return pattern.test(line);
    });

  expect([firstCell, row !== undefined]).toEqual([firstCell, true]);

  return row as string;
}

/* Every in-page `](#anchor)` link target. */
function inPageLinks(markdown: string): Array<string> {
  return Array.from(
    proseLines(markdown)
      .join("\n")
      .matchAll(/\]\(#([^)\s]+)\)/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

function ownGroup(): NavGroup | undefined {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === NAV_GROUP_TITLE;
  });
}

/*
 * The note the player puts under a Mask all text recording, written by the
 * same function the player calls, so the docs quote its title as shown.
 */
function maskAllTextImagesNote(): ReplayPlaybackAssetNote {
  const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes({
    failures: [],
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    recorderKind: "",
    docsRoot: "https://oneuptime.com/docs",
  });

  expect(
    notes.map((note: ReplayPlaybackAssetNote): string => {
      return note.key;
    }),
  ).toEqual(["images-off"]);

  return notes[0] as ReplayPlaybackAssetNote;
}

/* The failure note's title for two broken images, as the player words it. */
function twoImagesFailedTitle(): string {
  return formatReplayAssetFailureTitle({
    images: 2,
    stylesheets: 0,
    hosts: ["cdn.example.com"],
  });
}

interface SourceLiteral {
  value: string;
  end: number;
}

function unescapeCharacter(character: string | undefined): string {
  if (character === "n") {
    return "\n";
  }

  if (character === "t") {
    return "\t";
  }

  return character ?? "";
}

function readQuotedLiteral(
  source: string,
  start: number,
  quote: string,
): SourceLiteral {
  let value: string = "";
  let position: number = start + 1;

  while (position < source.length) {
    const character: string = source[position] as string;

    if (character === "\\") {
      value += unescapeCharacter(source[position + 1]);
      position += 2;
      continue;
    }

    if (character === quote) {
      return { value: value, end: position + 1 };
    }

    if (character === "\n") {
      break;
    }

    value += character;
    position++;
  }

  throw new Error(`Unterminated string literal at offset ${start}`);
}

function readTemplateLiteral(
  source: string,
  start: number,
  resolving: Array<string>,
): SourceLiteral {
  let value: string = "";
  let position: number = start + 1;

  while (position < source.length) {
    const character: string = source[position] as string;

    if (character === "\\") {
      value += unescapeCharacter(source[position + 1]);
      position += 2;
      continue;
    }

    if (character === "`") {
      return { value: value, end: position + 1 };
    }

    if (source.startsWith("${", position)) {
      const close: number = source.indexOf("}", position);
      const placeholder: string = source.slice(position + 2, close).trim();

      if (close === -1 || !IDENTIFIER.test(placeholder)) {
        throw new Error(
          `Cannot read the placeholder at offset ${position}: only names of other string constants are understood`,
        );
      }

      value += evaluateStringConstant(source, placeholder, resolving);
      position = close + 1;
      continue;
    }

    value += character;
    position++;
  }

  throw new Error(`Unterminated template literal at offset ${start}`);
}

/*
 * The value of `const NAME: string = <expression>;` in a source file, for
 * an expression made of string literals, template literals whose
 * placeholders name other such constants, those constants themselves, and
 * `+`. That is how ReplayStage.tsx builds its two policies, from shared
 * pieces, so reading one literal would see half a policy; importing the
 * component instead would pull React and the replay engine into a docs
 * test, which App cannot load. Anything else in the expression throws, so
 * a rewrite of the constant fails here loudly rather than being misread.
 */
function evaluateStringConstant(
  source: string,
  name: string,
  resolving: Array<string> = [],
): string {
  if (resolving.includes(name)) {
    throw new Error(`${[...resolving, name].join(" -> ")} is circular`);
  }

  const declaration: RegExpMatchArray | null = source.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*:\\s*string\\s*=`,
    ),
  );

  if (!declaration || declaration.index === undefined) {
    throw new Error(`No "const ${name}: string =" in the source`);
  }

  const chain: Array<string> = [...resolving, name];
  let value: string = "";
  let position: number = declaration.index + declaration[0].length;

  while (position < source.length) {
    const character: string = source[position] as string;

    if (WHITESPACE.test(character) || character === "+") {
      position++;
      continue;
    }

    if (source.startsWith("/*", position)) {
      const commentEnd: number = source.indexOf("*/", position + 2);

      if (commentEnd === -1) {
        throw new Error(
          `Unterminated comment in ${name} at offset ${position}`,
        );
      }

      position = commentEnd + 2;
      continue;
    }

    if (source.startsWith("//", position)) {
      const lineEnd: number = source.indexOf("\n", position);
      position = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (character === ";") {
      return value;
    }

    if (character === '"' || character === "'") {
      const literal: SourceLiteral = readQuotedLiteral(
        source,
        position,
        character,
      );
      value += literal.value;
      position = literal.end;
      continue;
    }

    if (character === "`") {
      const literal: SourceLiteral = readTemplateLiteral(
        source,
        position,
        chain,
      );
      value += literal.value;
      position = literal.end;
      continue;
    }

    if (IDENTIFIER_START.test(character)) {
      let end: number = position + 1;

      while (
        end < source.length &&
        IDENTIFIER_PART.test(source[end] as string)
      ) {
        end++;
      }

      value += evaluateStringConstant(
        source,
        source.slice(position, end),
        chain,
      );
      position = end;
      continue;
    }

    throw new Error(
      `Cannot read ${name}: "${character}" at offset ${position} is not part of a string expression`,
    );
  }

  throw new Error(`${name} has no terminating semicolon`);
}

/* A policy's directives, each with its source list. */
function parsePolicy(policy: string): Map<string, Array<string>> {
  const directives: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const part of policy.split(";")) {
    const tokens: Array<string> = part
      .trim()
      .split(/\s+/)
      .filter((token: string): boolean => {
        return token.length > 0;
      });

    if (tokens.length === 0) {
      continue;
    }

    const [directive, ...sources]: Array<string> = tokens;

    directives.set((directive as string).toLowerCase(), sources);
  }

  return directives;
}

/* The directives a policy sets to 'none' and nothing else, sorted. */
function refusedDirectives(policy: Map<string, Array<string>>): Array<string> {
  return Array.from(policy.entries())
    .filter(([, sources]: [string, Array<string>]): boolean => {
      return sources.length === 1 && sources[0] === "'none'";
    })
    .map(([directive]: [string, Array<string>]): string => {
      return directive;
    })
    .sort();
}

describe("Session Replay docs: images, styles and fonts during playback (issue #4119)", (): void => {
  const page: string = readContent("en", "telemetry/session-replay.md");
  const troubleshooting: string = readContent(
    "en",
    "rum/session-replay-troubleshooting.md",
  );
  const stageSource: string = readSource(
    DASHBOARD_REPLAY_DIR,
    "ReplayStage.tsx",
  );
  const policy: Map<string, Array<string>> = parsePolicy(
    evaluateStringConstant(stageSource, "REPLAY_DOCUMENT_CSP"),
  );
  const policyWithoutImages: Map<string, Array<string>> = parsePolicy(
    evaluateStringConstant(stageSource, "REPLAY_DOCUMENT_CSP_WITHOUT_IMAGES"),
  );

  /*
   * The player's "didn't load" note and the Details panel's Missing assets
   * list both link here. The anchor is computed from heading text, so a
   * reworded heading breaks both links with no compile error anywhere.
   */
  it("gives the link on every failed-asset note a heading on the English troubleshooting page", (): void => {
    expect(REPLAY_ASSET_FAILURE_DOCS_PATH).toBe(
      "/rum/session-replay-troubleshooting",
    );
    expect(
      (ownGroup()?.links || []).some((link: NavLink): boolean => {
        return link.url === `/docs${REPLAY_ASSET_FAILURE_DOCS_PATH}`;
      }),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(CONTENT_DIR, "en", `${REPLAY_ASSET_FAILURE_DOCS_PATH}.md`),
      ),
    ).toBe(true);

    expect(headingSlug(TROUBLESHOOTING_HEADING)).toBe(
      REPLAY_ASSET_FAILURE_DOCS_ANCHOR,
    );
    expect(proseLines(troubleshooting)).toContain(TROUBLESHOOTING_HEADING);
    expect(
      headingSlugs(troubleshooting).has(REPLAY_ASSET_FAILURE_DOCS_ANCHOR),
    ).toBe(true);
  });

  it("puts the playback section after What is not recorded, at the anchor the pages link to", (): void => {
    const headings: Array<string> = sectionHeadings(page);
    const index: number = headings.indexOf(PLAYBACK_HEADING);

    expect(index).toBeGreaterThan(0);
    expect(headings[index - 1]).toBe("## What is not recorded");
    expect(headings[index + 1]).toBe("## Retention and deletion");
    expect(headingSlug(PLAYBACK_HEADING)).toBe(PLAYBACK_ANCHOR);
  });

  it("links the troubleshooting entry and the playback section to each other", (): void => {
    const entry: string = section(troubleshooting, TROUBLESHOOTING_HEADING);
    const playback: string = section(page, PLAYBACK_HEADING);
    const failureLink: string = `(/docs${REPLAY_ASSET_FAILURE_DOCS_PATH}#${REPLAY_ASSET_FAILURE_DOCS_ANCHOR})`;

    expect(entry).toContain(
      `(/docs/telemetry/session-replay#${PLAYBACK_ANCHOR})`,
    );
    expect(playback).toContain(failureLink);
    expect(section(page, "## Troubleshooting")).toContain(failureLink);

    /* The troubleshooting intro is all about "no requests"; it points on. */
    const opening: string = troubleshooting.split("\n## ")[0] as string;

    expect(opening).toContain(`](#${REPLAY_ASSET_FAILURE_DOCS_ANCHOR})`);
  });

  it("lists as blocked exactly what the replay's policy refuses", (): void => {
    const refused: Array<string> = refusedDirectives(policy);

    /* A new 'none' directive needs a word in the docs, and here. */
    expect(refused).toEqual(Object.keys(BLOCKED_WORDING).sort());

    const blocked: string = lineContaining(
      section(page, PLAYBACK_HEADING),
      "stays blocked",
    );

    for (const directive of refused) {
      const phrases: Array<string> = BLOCKED_WORDING[directive] || [];

      for (const phrase of phrases) {
        expect([directive, phrase, blocked.includes(phrase)]).toEqual([
          directive,
          phrase,
          true,
        ]);
      }
    }

    /* And nothing the policy lets through is listed as blocked. */
    for (const word of ["image", "stylesheet", "font"]) {
      expect([word, blocked.toLowerCase().includes(word)]).toEqual([
        word,
        false,
      ]);
    }
  });

  it("says images, stylesheets and fonts load from their original addresses, as the policy lets them", (): void => {
    for (const directive of Object.keys(LOADED_WORDING)) {
      const sources: Array<string> = policy.get(directive) || [];

      expect([
        directive,
        sources.includes("http:") && sources.includes("https:"),
      ]).toEqual([directive, true]);
    }

    const playback: string = section(page, PLAYBACK_HEADING);
    const loads: string = lineContaining(
      playback,
      "from their original addresses",
    );

    for (const phrase of Object.values(LOADED_WORDING)) {
      expect([phrase, loads.includes(phrase)]).toEqual([phrase, true]);
    }

    /* From the viewer's browser, on the Dashboard's origin, for every recording. */
    expect(loads).toContain("in your browser");
    expect(loads).toContain("OneUptime origin");
    expect(loads).toContain("including those made before");
  });

  it("never loads images for a Mask all text recording, and says so wherever the mode is described", (): void => {
    const imageSources: Array<string> =
      policyWithoutImages.get("img-src") || [];

    expect(imageSources).not.toContain("http:");
    expect(imageSources).not.toContain("https:");

    /* Only images differ: styles and fonts load in every mode. */
    for (const [directive, sources] of policy.entries()) {
      if (directive !== "img-src") {
        expect([directive, policyWithoutImages.get(directive)]).toEqual([
          directive,
          sources,
        ]);
      }
    }

    /* The stage's decision, which an absent or unknown mode falls into too. */
    expect(
      doesReplayLoadRecordedImages(SessionReplayMaskingMode.MaskAllText),
    ).toBe(false);
    expect(
      doesReplayLoadRecordedImages(SessionReplayMaskingMode.MaskInputsOnly),
    ).toBe(true);
    expect(
      doesReplayLoadRecordedImages(
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      ),
    ).toBe(true);
    expect(doesReplayLoadRecordedImages("")).toBe(false);
    expect(doesReplayLoadRecordedImages("SomeFutureMode")).toBe(false);

    const imagesOffTitle: string = `_${maskAllTextImagesNote().title}_`;
    const playback: string = section(page, PLAYBACK_HEADING);

    expect(playback).toContain(
      "Under _Mask all text_ the player never loads images",
    );
    expect(playback).toContain(imagesOffTitle);
    expect(playback).toContain("Stylesheets and fonts still load");
    expect(playback).toContain("does not recognise plays back the same way");

    expect(section(page, "### Choose a masking mode deliberately")).toContain(
      "the player never loads the page's images",
    );
    expect(tableRow(page, "Images")).toContain("never under _Mask all text_");
    expect(tableRow(page, "`<video>` / `<audio>`")).toContain(
      "(not under _Mask all text_)",
    );
    expect(section(troubleshooting, TROUBLESHOOTING_HEADING)).toContain(
      imagesOffTitle,
    );
  });

  it("names what a file needs in order to show, and what never renders", (): void => {
    const needs: string = section(
      page,
      "### What a file needs to show in the replay",
    );

    for (const phrase of [
      "**It needs no sign-in.**",
      "none of your user's session",
      "`Referer`",
      "`Cross-Origin-Resource-Policy: same-origin`",
      "send `cross-origin`",
      "`Access-Control-Allow-Origin`",
      "your OneUptime origin",
      "`crossorigin` attribute",
      "expired signed link",
      "hashed files",
      "intranet",
      "VPN",
      "IP allowlist",
      "mixed content",
      '`<use href="/icons.svg#close">`',
      '`<use href="#close">`',
      "`Content-Security-Policy`",
      "reverse proxy",
    ]) {
      expect([phrase, needs.includes(phrase)]).toEqual([phrase, true]);
    }
  });

  /*
   * crossorigin on its own makes the customer's page refuse the stylesheet;
   * the header on its own changes nothing. Both, and the header first.
   */
  it("asks for the CORS header and the crossorigin attribute together, never the attribute alone", (): void => {
    const recording: string = section(page, STYLESHEET_HEADING);

    expect(recording).toContain("`Access-Control-Allow-Origin`");
    expect(recording).toContain('crossorigin="anonymous"');
    expect(recording).toContain("allows your site");
    expect(recording).toContain("never add the attribute on its own");

    const csp: string = section(page, "## Content Security Policy");

    expect(csp).toContain(`(#${PLAYBACK_ANCHOR})`);
    expect(csp).toContain("`Access-Control-Allow-Origin`");
    expect(csp).toContain('`crossorigin="anonymous"`');
    expect(csp).toContain("makes your own page refuse the stylesheet");
  });

  it("says what the replay's requests carry, as the stage's referrer policy decides", (): void => {
    expect(stageSource).toMatch(/setAttribute\("name", "referrer"\)/);
    expect(stageSource).toMatch(/setAttribute\("content", "no-referrer"\)/);

    const reveals: string = section(page, "### What watching a replay reveals");

    for (const phrase of [
      "IP address and user agent",
      "Image and stylesheet requests carry no `Referer`",
      "at most the OneUptime origin",
      "None of them carries the replay's URL or the session id",
      "`.oneuptime-block`",
      "**Block selectors**",
      "(#marking-your-own-content)",
    ]) {
      expect([phrase, reveals.includes(phrase)]).toEqual([phrase, true]);
    }
  });

  it("points to the notes the player shows when a file does not load, by the names it gives them", (): void => {
    const panel: string = readSource(
      DASHBOARD_REPLAY_DIR,
      "ReplayCorrelationPanel.tsx",
    );

    expect(panel).toContain('title="Missing assets"');

    for (const markdown of [
      section(page, "### When a file does not load"),
      section(troubleshooting, TROUBLESHOOTING_HEADING),
    ]) {
      expect(markdown).toContain(`_${twoImagesFailedTitle()}_`);
      expect(markdown).toContain(
        "**Session details** (`I`) → **Fidelity** → **Missing assets**",
      );
    }

    /* What the note cannot see is said, so its silence is not read as "all loaded". */
    expect(section(page, "### When a file does not load")).toContain(
      "A CSS background image or a font that fails is not listed",
    );
    expect(section(troubleshooting, "## Still stuck")).toContain(
      "**Missing assets**",
    );
  });

  /*
   * The screenshot is redrawn without a request, so once the stage loads
   * files from other sites the two differ; the page says how, and keeps
   * the two promises SessionReplayDocs.test.ts pins.
   */
  it("says how a paused-frame screenshot differs from the stage, and keeps its promises", (): void => {
    const screenshot: string = lineContaining(
      section(page, "### The player"),
      "nothing is fetched",
    );

    for (const phrase of [
      "masked or blocked at capture time stays masked",
      "grey boxes",
      "CSS background images and web fonts are left out",
      "the elements it hides stay hidden",
      "drawn broken",
      "left blank",
    ]) {
      expect([phrase, screenshot.includes(phrase)]).toEqual([phrase, true]);
    }
  });

  it("describes the What is not recorded rows the way playback now treats them", (): void => {
    const images: string = tableRow(page, "Images");
    const fonts: string = tableRow(page, "Web fonts");
    const media: string = tableRow(page, "`<video>` / `<audio>`");
    const stylesheets: string = tableRow(page, "Cross-origin stylesheets");

    expect(images).toContain(`(#${PLAYBACK_ANCHOR})`);
    expect(fonts).toContain("original addresses");
    expect(fonts).toContain("falls back to a system font");
    expect(fonts).toContain(`(#${PLAYBACK_ANCHOR})`);
    expect(media).toContain("poster");
    expect(stylesheets).toContain("`Access-Control-Allow-Origin`");
    expect(stylesheets).toContain("`crossorigin`");
    expect(stylesheets).toContain("original addresses");
    expect(stylesheets).toContain(`(#${headingSlug(STYLESHEET_HEADING)})`);
  });

  /*
   * The recorder scrubs page and request URLs in every mode, link targets
   * only under Mask all text, and asset addresses never: the player has to
   * load them as they were written.
   */
  it("limits the dropped-query-string promise to the URLs the recorder scrubs", (): void => {
    const masking: string = readSource(RECORDER_DIR, "src/Masking.ts");

    expect(masking).toContain(
      'const LINK_TAGS: Array<string> = ["a", "area"];',
    );

    const bullet: string = lineStartingWith(
      section(page, "### Always masked"),
      "- **Query strings and fragments**",
    );

    expect(bullet).toContain("network request");
    expect(bullet).toContain("only under _Mask all text_");
    expect(bullet).toContain(
      "Image, stylesheet and font addresses are kept as the page wrote them",
    );
    expect(bullet).toContain(`(#${PLAYBACK_ANCHOR})`);
  });

  it("walks through the Power Pages portal from the report, with the settings that fix it", (): void => {
    const errorRecorder: string = readSource(
      RECORDER_DIR,
      "src/ErrorRecorder.ts",
    );

    /* The rail row the entry tells a reader to look for. */
    expect(errorRecorder).toContain("Resource failed to load:");

    const entry: string = section(troubleshooting, TROUBLESHOOTING_HEADING);

    for (const phrase of [
      '"web" or "close"',
      "_You're offline. This is a read only version of the page._",
      "not OneUptime's [offline mode](/docs/telemetry/session-replay#offline-mode)",
      "`content.powerapps.com`",
      "Glyphicons",
      "`HTTP/Access-Control-Allow-Origin`",
      "**Security** → **Advanced settings** → **CORS**",
      "_Resource failed to load_",
      "`401` or `403`",
      "`404` or `410`",
      "_CORS error_",
      "`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`",
      "`(blocked:mixed-content)`",
      "`(blocked:csp)`",
      "reverse proxy",
    ]) {
      expect([phrase, entry.includes(phrase)]).toEqual([phrase, true]);
    }

    expect(headingSlugs(page).has("offline-mode")).toBe(true);
  });

  it("says in the recorder's own notes what playback loads and what its requests carry", (): void => {
    /* The README is hard-wrapped, so a phrase may cross a line break. */
    const limits: string = section(
      readSource(RECORDER_DIR, "README.md"),
      "### Known limits, stated plainly",
    ).replace(/\s+/g, " ");

    expect(limits).toContain(
      "Under `MaskAllText` the addresses are kept but never loaded",
    );
    expect(limits).toContain("the player loads them from there");
    expect(limits).toContain("carry no `Referer`");

    expect(readSource(RECORDER_DIR, "src/Recorder.ts")).not.toContain(
      "the player's CSP refuses",
    );
  });

  it("no longer states the claims playback stopped making", (): void => {
    for (const [relative, markdown] of [
      ["en/telemetry/session-replay.md", page],
      ["en/rum/session-replay-troubleshooting.md", troubleshooting],
    ]) {
      for (const claim of RETIRED_ENGLISH_CLAIMS) {
        expect([relative, claim, (markdown as string).includes(claim)]).toEqual(
          [relative, claim, false],
        );
      }
    }
  });
});

/*
 * The Persian pages are served instead of the English ones, so a sentence
 * left false there stays live for every Persian reader. No test enforces
 * en/fa parity for the RUM pages in general; these pin this change.
 */
describe("the Persian mirrors carry the playback sections", (): void => {
  const page: string = readContent("fa", "telemetry/session-replay.md");
  const troubleshooting: string = readContent(
    "fa",
    "rum/session-replay-troubleshooting.md",
  );
  const stageSource: string = readSource(
    DASHBOARD_REPLAY_DIR,
    "ReplayStage.tsx",
  );
  const playbackSlug: string = headingSlug(PERSIAN_PLAYBACK_HEADING);
  const troubleshootingSlug: string = headingSlug(
    PERSIAN_TROUBLESHOOTING_HEADING,
  );

  it("puts both sections where the English pages have them", (): void => {
    const headings: Array<string> = sectionHeadings(page);
    const index: number = headings.indexOf(PERSIAN_PLAYBACK_HEADING);

    expect(index).toBeGreaterThan(0);
    expect(headings[index - 1]).toBe("## آنچه ضبط نمی‌شود");
    expect(headings[index + 1]).toBe("## نگهداشت و حذف");

    const troubleshootingHeadings: Array<string> =
      sectionHeadings(troubleshooting);
    const entry: number = troubleshootingHeadings.indexOf(
      PERSIAN_TROUBLESHOOTING_HEADING,
    );

    expect(entry).toBeGreaterThan(0);
    expect(troubleshootingHeadings[entry - 1]).toBe(
      "## پخش‌کننده می‌گوید Buffering، یا قطعه‌ای بارگذاری نشد",
    );
    expect(troubleshootingHeadings[entry + 1]).toBe(
      '## برنامه RUM می‌گوید "Disconnected"',
    );
  });

  /*
   * Translated headings produce Persian ids, so the links between the two
   * new sections use them; an English anchor would land a Persian reader at
   * the top of the page.
   */
  it("links the two sections to each other by their Persian anchors", (): void => {
    expect(section(troubleshooting, PERSIAN_TROUBLESHOOTING_HEADING)).toContain(
      `(/docs/telemetry/session-replay#${playbackSlug})`,
    );
    expect(section(page, PERSIAN_PLAYBACK_HEADING)).toContain(
      `(/docs/rum/session-replay-troubleshooting#${troubleshootingSlug})`,
    );
    expect(troubleshooting.split("\n## ")[0]).toContain(
      `](#${troubleshootingSlug})`,
    );

    for (const [relative, markdown] of [
      ["fa/telemetry/session-replay.md", page],
      ["fa/rum/session-replay-troubleshooting.md", troubleshooting],
    ]) {
      for (const match of (markdown as string).matchAll(
        /\]\((\/docs\/[a-z0-9/_-]+)#([^)\s]+)\)/g,
      )) {
        const anchor: string = match[2] as string;

        /* English anchors are the RUM pages' convention for other pages. */
        if (ASCII_ONLY.test(anchor)) {
          continue;
        }

        const target: string = readContent(
          "fa",
          `${(match[1] as string).replace(/^\/docs\//, "")}.md`,
        );

        expect([relative, match[0], headingSlugs(target).has(anchor)]).toEqual([
          relative,
          match[0],
          true,
        ]);
      }
    }
  });

  /* What docs:check-anchors enforces in CI, for the four pages this change edits. */
  it("points every in-page link on the edited pages at a heading on that page", (): void => {
    for (const [language, relative] of [
      ["en", "telemetry/session-replay.md"],
      ["en", "rum/session-replay-troubleshooting.md"],
      ["fa", "telemetry/session-replay.md"],
      ["fa", "rum/session-replay-troubleshooting.md"],
    ]) {
      const markdown: string = readContent(
        language as string,
        relative as string,
      );
      const slugs: Set<string> = headingSlugs(markdown);

      for (const anchor of inPageLinks(markdown)) {
        expect([language, relative, anchor, slugs.has(anchor)]).toEqual([
          language,
          relative,
          anchor,
          true,
        ]);
      }
    }
  });

  it("lists the same blocked requests, requirements and notes in Persian", (): void => {
    const refused: Array<string> = refusedDirectives(
      parsePolicy(evaluateStringConstant(stageSource, "REPLAY_DOCUMENT_CSP")),
    );

    expect(Object.keys(PERSIAN_BLOCKED_WORDING).sort()).toEqual(refused);

    const playback: string = section(page, PERSIAN_PLAYBACK_HEADING);
    const blocked: string = lineContaining(playback, "مسدود می‌ماند");

    for (const directive of refused) {
      const phrases: Array<string> = PERSIAN_BLOCKED_WORDING[directive] || [];

      for (const phrase of phrases) {
        expect([directive, phrase, blocked.includes(phrase)]).toEqual([
          directive,
          phrase,
          true,
        ]);
      }
    }

    for (const token of [
      "_Mask all text_",
      "`Referer`",
      "`Cross-Origin-Resource-Policy: same-origin`",
      "`Access-Control-Allow-Origin`",
      'crossorigin="anonymous"',
      '`<use href="/icons.svg#close">`',
      "`Content-Security-Policy`",
      "`.oneuptime-block`",
      "**Block selectors**",
      "**Missing assets**",
      "اینترانت",
      "محتوای مختلط",
      "هرگز صفت را به‌تنهایی نیفزایید",
      "هیچ‌کدام نشانی بازپخش یا شناسه نشست را حمل نمی‌کند",
      `_${maskAllTextImagesNote().title}_`,
    ]) {
      expect([token, playback.includes(token)]).toEqual([token, true]);
    }
  });

  it("carries the troubleshooting steps and the Power Pages settings", (): void => {
    const entry: string = section(
      troubleshooting,
      PERSIAN_TROUBLESHOOTING_HEADING,
    );

    for (const token of [
      `_${twoImagesFailedTitle()}_`,
      "_You're offline. This is a read only version of the page._",
      "`content.powerapps.com`",
      "Glyphicons",
      "`HTTP/Access-Control-Allow-Origin`",
      "**Security** → **Advanced settings** → **CORS**",
      "_Resource failed to load_",
      "`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`",
      "`(blocked:mixed-content)`",
      "`(blocked:csp)`",
      "**Session details** (`I`) → **Fidelity** → **Missing assets**",
      "نه حالت آفلاین OneUptime",
    ]) {
      expect([token, entry.includes(token)]).toEqual([token, true]);
    }

    expect(section(troubleshooting, "## هنوز گیر کرده‌اید")).toContain(
      "**Missing assets**",
    );
  });

  it("corrects the Persian sentences the English page corrected", (): void => {
    expect(tableRow(page, "تصویرها")).toContain("هرگز زیر _Mask all text_");
    expect(tableRow(page, "فونت‌های وب")).toContain("فونتی سیستمی");
    expect(tableRow(page, "`<video>` / `<audio>`")).toContain("پوستر");
    expect(tableRow(page, "صفحه‌های سبک مبدأ دیگر")).toContain(
      "`Access-Control-Allow-Origin`",
    );
    expect(section(page, "### حالت پوشاندن را آگاهانه برگزینید")).toContain(
      "پخش‌کننده هرگز تصویرهای صفحه را بارگذاری نمی‌کند",
    );
    expect(
      lineStartingWith(
        section(page, "### همیشه پوشانده"),
        "- **رشته‌های پرس‌وجو و پاره‌ها**",
      ),
    ).toContain("فقط زیر _Mask all text_");
    expect(section(page, "## سیاست امنیت محتوا")).toContain(
      `(#${playbackSlug})`,
    );

    for (const [relative, markdown] of [
      ["fa/telemetry/session-replay.md", page],
      ["fa/rum/session-replay-troubleshooting.md", troubleshooting],
    ]) {
      for (const claim of RETIRED_PERSIAN_CLAIMS) {
        expect([relative, claim, (markdown as string).includes(claim)]).toEqual(
          [relative, claim, false],
        );
      }
    }
  });
});
