/*
 * THE ATTACHMENT LINKS OLD FEED ENTRIES CARRY, MADE TO WORK.
 *
 * A note's feed entry lists the note's files as links
 * (FileAttachmentMarkdownUtil), to the route its note API serves them at.
 * In November 2025 those routes gained the project id the reader's access
 * is checked against (`<note>/attachment/:projectId/:noteId/:fileId`,
 * 30651f1ca7), and the feed went on writing the old address without it
 * until #4925: every attachment link in every feed entry written in between
 * - and before - is a 404. Feed entries are stored Markdown, so they kept
 * it; the RewriteFeedAttachmentLinks data migration rewrites them with this.
 *
 * An old link is `/api/<note>/attachment/<noteId>/<fileId>` as a Markdown
 * link's address - followed by the ")" (or the ">" of an address written
 * in angle brackets) that ends it - with both ids whole. It becomes:
 *
 *   - for a note whose API serves its files, the address with the feed
 *     entry's project id before the note's: the route that serves it, the
 *     link the feed writes today;
 *   - for an episode's private note, which has no route to download from,
 *     the file's name as text, as the feed writes it today - its link could
 *     only ever open a 404.
 *
 * Nothing else is touched: a link written today (three ids), an address in
 * the text of a note, any other link. Rewriting what it wrote leaves it as
 * it is, so it can run again. Read with indexOf and a character at a time,
 * never reading a character back twice: linear in the Markdown, however it
 * is written.
 */

// The note APIs that serve a note's files, by the route of their API.
export const FEED_ATTACHMENT_ROUTES_SERVED: ReadonlyArray<string> = [
  "incident-internal-note",
  "incident-public-note",
  "alert-internal-note",
  "incident-episode-public-note",
  "scheduled-maintenance-internal-note",
  "scheduled-maintenance-public-note",
];

/*
 * The notes whose old feed entries linked a route that never existed: the
 * episodes' private notes, whose files are now listed by name.
 */
export const FEED_ATTACHMENT_ROUTES_NOT_SERVED: ReadonlyArray<string> = [
  "incident-episode-internal-note",
  "alert-episode-internal-note",
];

const UUID_LENGTH: number = 36;

// Where a UUID's dashes are: 8-4-4-4-12.
const UUID_DASHES: ReadonlySet<number> = new Set<number>([8, 13, 18, 23]);

const isHexDigit: (code: number) => boolean = (code: number): boolean => {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x61 && code <= 0x66) ||
    (code >= 0x41 && code <= 0x46)
  );
};

// Whether a whole UUID starts at `at` in `text`.
export const isUuidAt: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  if (at < 0 || at + UUID_LENGTH > text.length) {
    return false;
  }

  for (let offset: number = 0; offset < UUID_LENGTH; offset++) {
    const code: number = text.charCodeAt(at + offset);

    if (UUID_DASHES.has(offset) ? code !== 0x2d : !isHexDigit(code)) {
      return false;
    }
  }

  return true;
};

export interface FeedAttachmentLinksRewrite {
  markdown: string;
  // How many links were rewritten (0: the Markdown is returned as it was).
  rewritten: number;
}

interface OldLink {
  // Where the address starts ("/api/...") and ends (before ")" or ">").
  start: number;
  end: number;
  // Where the note's id starts.
  noteIdAt: number;
  isServed: boolean;
}

interface LinkWords {
  // Where the link's "[" is, and where its words start and end.
  linkStart: number;
  wordsStart: number;
  wordsEnd: number;
}

const ROUTE_PREFIX: string = "/api/";
const ROUTE_SUFFIX: string = "/attachment/";

/*
 * The old link at `at`, the "/api/" of an address, or null: a note's route,
 * two whole ids, then the end of a link's address.
 */
const readOldLink: (markdown: string, at: number) => OldLink | null = (
  markdown: string,
  at: number,
): OldLink | null => {
  const routeStart: number = at + ROUTE_PREFIX.length;

  for (const isServed of [true, false]) {
    const routes: ReadonlyArray<string> = isServed
      ? FEED_ATTACHMENT_ROUTES_SERVED
      : FEED_ATTACHMENT_ROUTES_NOT_SERVED;

    for (const route of routes) {
      const path: string = route + ROUTE_SUFFIX;

      if (!markdown.startsWith(path, routeStart)) {
        continue;
      }

      const noteIdAt: number = routeStart + path.length;
      const fileIdAt: number = noteIdAt + UUID_LENGTH + 1;
      const end: number = fileIdAt + UUID_LENGTH;

      if (
        !isUuidAt(markdown, noteIdAt) ||
        markdown.charAt(noteIdAt + UUID_LENGTH) !== "/" ||
        !isUuidAt(markdown, fileIdAt) ||
        (markdown.charAt(end) !== ")" && markdown.charAt(end) !== ">")
      ) {
        return null;
      }

      return { start: at, end: end, noteIdAt: noteIdAt, isServed: isServed };
    }
  }

  return null;
};

/*
 * The words of the link whose address starts at `addressStart`, or null
 * when the address does not end a "[words](" of the line it is on. A "]"
 * or "[" in the words is written "\]" or "\[" (FeedMarkdown.link), so the
 * first "[" before the words that is not escaped starts them. Read back no
 * further than `floor` - where the link before it ended - so no character
 * is read back twice, whatever a line holds.
 */
const readLinkWords: (
  markdown: string,
  addressStart: number,
  floor: number,
) => LinkWords | null = (
  markdown: string,
  addressStart: number,
  floor: number,
): LinkWords | null => {
  // The "]" before "(", or before "(<" for an address in angle brackets.
  const close: number =
    markdown.charAt(addressStart - 1) === "<"
      ? addressStart - 3
      : addressStart - 2;

  if (
    close < floor ||
    markdown.charAt(close) !== "]" ||
    markdown.charAt(close + 1) !== "("
  ) {
    return null;
  }

  for (let at: number = close - 1; at >= floor; at--) {
    const character: string = markdown.charAt(at);

    if (character === "\n") {
      return null;
    }

    if (character !== "[") {
      continue;
    }

    let backslashes: number = 0;

    while (
      at - 1 - backslashes >= floor &&
      markdown.charAt(at - 1 - backslashes) === "\\"
    ) {
      backslashes++;
    }

    if (backslashes % 2 === 0) {
      return { linkStart: at, wordsStart: at + 1, wordsEnd: close };
    }
  }

  return null;
};

export default class FeedAttachmentLinks {
  /*
   * `markdown` - a feed entry's - with every old attachment link rewritten
   * (see the top) for the entry's project. Unchanged, with 0, when it holds
   * none, or when `projectId` is no id.
   */
  public static rewriteOldLinks(
    markdown: string | null | undefined,
    projectId: string | null | undefined,
  ): FeedAttachmentLinksRewrite {
    const text: string = markdown || "";
    const project: string = (projectId || "").toString().trim();

    if (!text || project.length !== UUID_LENGTH || !isUuidAt(project, 0)) {
      return { markdown: text, rewritten: 0 };
    }

    let written: string = "";
    let copiedUpTo: number = 0;
    let rewritten: number = 0;
    // Where the last old link ended: a link's words are read back to here.
    let floor: number = 0;
    let at: number = text.indexOf(ROUTE_PREFIX);

    while (at !== -1) {
      const link: OldLink | null = readOldLink(text, at);

      if (!link) {
        at = text.indexOf(ROUTE_PREFIX, at + 1);
        continue;
      }

      if (link.isServed) {
        written += text.slice(copiedUpTo, link.noteIdAt) + project + "/";
        copiedUpTo = link.noteIdAt;
        floor = link.end;
        rewritten++;
        at = text.indexOf(ROUTE_PREFIX, link.end);
        continue;
      }

      const words: LinkWords | null = readLinkWords(
        text,
        link.start,
        Math.max(floor, copiedUpTo),
      );

      floor = link.end;

      if (!words) {
        at = text.indexOf(ROUTE_PREFIX, link.end);
        continue;
      }

      // The link's end: its ")", after the ">" of an address in brackets.
      const linkEnd: number =
        text.charAt(link.end) === ">" ? link.end + 2 : link.end + 1;

      written +=
        text.slice(copiedUpTo, words.linkStart) +
        text.slice(words.wordsStart, words.wordsEnd);
      copiedUpTo = linkEnd;
      floor = linkEnd;
      rewritten++;
      at = text.indexOf(ROUTE_PREFIX, linkEnd);
    }

    if (rewritten === 0) {
      return { markdown: text, rewritten: 0 };
    }

    return { markdown: written + text.slice(copiedUpTo), rewritten: rewritten };
  }
}
