/*
 * PEM private key blocks in text, found and replaced whole.
 *
 * A block runs from a header line, "-----BEGIN <words> PRIVATE KEY-----",
 * to the first footer line after it, "-----END <words> PRIVATE KEY-----",
 * whatever lies between (BEGIN lines included); the words are capitals and
 * digits (RSA, EC, OPENSSH, ENCRYPTED...), as a PEM label writes them. A
 * header with no footer after it is left as it is.
 *
 * Read in time in line with the text's length. One pattern with a lazy body
 * between header and footer reads the rest of the text from every header
 * that has no footer after it, so on text that repeats a BEGIN line its time
 * grows with the square of the text's length. Here the text is read once:
 * each search for a footer starts after its header, the next header is
 * looked for after that footer, and a header with no footer after it ends
 * the search, since no later header has one either.
 */

// A header and a footer: neither repeat can run past the next "-".
const PRIVATE_KEY_HEADER: RegExp =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;
const PRIVATE_KEY_FOOTER: RegExp = /-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

// What every header starts with: text without it holds no block.
const HEADER_START: string = "-----BEGIN ";

export interface ReplacedPrivateKeyBlocks {
  text: string;
  // How many blocks were replaced.
  count: number;
}

// Where a block is in a text: from its header's first character to just after its footer.
export interface PrivateKeyBlockSpan {
  start: number;
  end: number;
}

export type FindPrivateKeyBlocksFunction = (
  text: string,
) => Array<PrivateKeyBlockSpan>;

/*
 * Every block of a text, in order, as replacePrivateKeyBlocks replaces
 * them: read_code_file reads a file a window at a time, and a window that
 * cut a block would show the part of it it holds - no footer in it, so
 * nothing to replace (issue #6388). It widens the window to whole blocks.
 */
export const findPrivateKeyBlocks: FindPrivateKeyBlocksFunction = (
  text: string,
): Array<PrivateKeyBlockSpan> => {
  const blocks: Array<PrivateKeyBlockSpan> = [];

  if (text.indexOf(HEADER_START) === -1) {
    return blocks;
  }

  let position: number = 0;

  for (;;) {
    PRIVATE_KEY_HEADER.lastIndex = position;

    const header: RegExpExecArray | null = PRIVATE_KEY_HEADER.exec(text);

    if (!header) {
      break;
    }

    PRIVATE_KEY_FOOTER.lastIndex = header.index + header[0].length;

    const footer: RegExpExecArray | null = PRIVATE_KEY_FOOTER.exec(text);

    if (!footer) {
      // No footer after this header, and so none after any later one.
      break;
    }

    position = footer.index + footer[0].length;
    blocks.push({ start: header.index, end: position });
  }

  return blocks;
};

export type ReplacePrivateKeyBlocksFunction = (
  text: string,
  replacement: string,
) => ReplacedPrivateKeyBlocks;

export const replacePrivateKeyBlocks: ReplacePrivateKeyBlocksFunction = (
  text: string,
  replacement: string,
): ReplacedPrivateKeyBlocks => {
  const blocks: Array<PrivateKeyBlockSpan> = findPrivateKeyBlocks(text);

  if (blocks.length === 0) {
    return { text: text, count: 0 };
  }

  const kept: Array<string> = [];
  let position: number = 0;

  for (const block of blocks) {
    kept.push(text.slice(position, block.start), replacement);
    position = block.end;
  }

  kept.push(text.slice(position));

  return { text: kept.join(""), count: blocks.length };
};
