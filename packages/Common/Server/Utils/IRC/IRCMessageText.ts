/*
 * Turns a workflow's message into the lines IRC can carry.
 *
 * IRC has no multi-line messages and no long ones: a line is at most 512
 * bytes with its CRLF, and the server puts ":nick!user@host " in front of it
 * before passing it on. So each line of the message is sent as a message of
 * its own, a long line is cut into pieces that fit (between words where it
 * can, and never inside a UTF-8 character), and the number of lines is capped,
 * since a server disconnects a client that sends too much at once.
 *
 * The text can be anything a trigger carried - a synthetic monitor's
 * screenshot arrives as megabytes of base64 on one line, and a webhook's body
 * can be megabytes of blank lines - so nothing here runs a regular expression
 * over it (see "Megabyte-long values" in AGENTS.md). The text is read once,
 * a character at a time; what is not sent (blank lines, control characters,
 * a long run of spaces) costs a comparison and no more, and reading stops as
 * soon as there are more lines than can be sent.
 */

export interface PreparedIRCText {
  lines: Array<string>;
  // Some of the message did not fit, and the last line says so.
  isTruncated: boolean;
}

// The whole line, with its CRLF (RFC 1459 section 2.3).
export const IRC_LINE_MAX_BYTES: number = 512;

/*
 * What a server can put in front of a line it passes on, besides the
 * nickname: "!" + a username (10, USERLEN on most servers) + "@" + a host
 * (63, HOSTLEN) + ":" and a space. Generous, so a line never ends up cut
 * short by the server instead.
 */
const SOURCE_ALLOWANCE_BYTES: number = 1 + 10 + 1 + 63 + 2;

const SPACE: string = " ";

/*
 * C0 control characters with a meaning in IRC formatting, kept as typed:
 * bold, colour, hex colour, reset, monospace, reverse, italic,
 * strikethrough and underline. Every other control character goes - NUL
 * cannot be sent at all, and 0x01 would turn the line into a CTCP request.
 */
const FORMATTING_CODES: ReadonlySet<number> = new Set<number>([
  0x02, 0x03, 0x04, 0x0f, 0x11, 0x16, 0x1d, 0x1e, 0x1f,
]);

/*
 * The white space String.prototype.trim removes beyond ASCII. A line of
 * nothing else is blank, and so is a piece of one.
 */
const UNICODE_SPACES: ReadonlySet<number> = new Set<number>([
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
]);

const TAB: number = 0x09;
const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;
const SPACE_CODE: number = 0x20;
const DELETE: number = 0x7f;

export default class IRCMessageText {
  public static getTruncationNotice(maxLines: number): string {
    return `… (message cut short: it is longer than ${maxLines} IRC lines)`;
  }

  /*
   * The most bytes of text one PRIVMSG to `target` can carry, sent as
   * `nickname`, once the server has put its prefix in front of it.
   */
  public static getMaxTextBytes(data: {
    nickname: string;
    target: string;
  }): number {
    return (
      IRC_LINE_MAX_BYTES -
      2 -
      IRCMessageText.getByteLength(data.nickname) -
      SOURCE_ALLOWANCE_BYTES -
      IRCMessageText.getByteLength(`PRIVMSG ${data.target} :`)
    );
  }

  public static prepare(data: {
    text: string;
    maxBytesPerLine: number;
    maxLines: number;
  }): PreparedIRCText {
    if (data.maxLines < 1) {
      throw new Error("An IRC message needs room for at least one line.");
    }

    // Four bytes is the longest UTF-8 character; anything less cannot work.
    if (data.maxBytesPerLine < 16) {
      throw new Error("An IRC line needs room for at least 16 bytes.");
    }

    const text: string = data.text;
    const lines: Array<string> = [];

    // One line more than allowed is enough to know the message is too long.
    const linesWanted: number = data.maxLines + 1;

    let position: number = 0;

    while (position < text.length && lines.length < linesWanted) {
      // Where the line ends, and whether it shows anything at all.
      let lineEnd: number = position;
      let isVisible: boolean = false;

      while (lineEnd < text.length) {
        const code: number = text.charCodeAt(lineEnd);

        if (code === LINE_FEED || code === CARRIAGE_RETURN) {
          break;
        }

        if (!isVisible && !IRCMessageText.isBlankCode(code)) {
          isVisible = true;
        }

        lineEnd++;
      }

      // A blank line is left out: IRC refuses an empty message.
      if (isVisible) {
        for (const piece of IRCMessageText.splitRange({
          text: text,
          start: position,
          end: lineEnd,
          maxBytes: data.maxBytesPerLine,
          maxPieces: linesWanted - lines.length,
        })) {
          lines.push(piece);
        }
      }

      // CRLF is one line break, and so are a lone CR and a lone LF.
      position = lineEnd;

      if (
        text.charCodeAt(position) === CARRIAGE_RETURN &&
        text.charCodeAt(position + 1) === LINE_FEED
      ) {
        position += 2;
      } else if (position < text.length) {
        position += 1;
      }
    }

    if (lines.length > data.maxLines) {
      return {
        lines: [
          ...lines.slice(0, data.maxLines - 1),
          IRCMessageText.getTruncationNotice(data.maxLines),
        ],
        isTruncated: true,
      };
    }

    return { lines: lines, isTruncated: false };
  }

  /*
   * Whether the message shows anything at all - whether prepare() would give
   * it a line - at the cost of one scan, which stops at the first character
   * that shows.
   */
  public static hasVisibleText(text: string): boolean {
    for (let index: number = 0; index < text.length; index++) {
      if (!IRCMessageText.isBlankCode(text.charCodeAt(index))) {
        return true;
      }
    }

    return false;
  }

  /*
   * One line of the message, with every character IRC cannot carry taken out
   * and a tab made a space. IRC's formatting codes stay.
   */
  public static sanitizeLine(line: string): string {
    let sanitized: string = "";

    for (let index: number = 0; index < line.length; index++) {
      const code: number = line.charCodeAt(index);

      if (code === TAB) {
        sanitized += SPACE;
      } else if (!IRCMessageText.isRemoved(code)) {
        sanitized += line.charAt(index);
      }
    }

    return sanitized;
  }

  /*
   * Cuts a line into pieces of at most maxBytes bytes of UTF-8, sanitized as
   * sanitizeLine does, and returns no more than maxPieces of them.
   */
  public static splitLine(
    line: string,
    maxBytes: number,
    maxPieces: number,
  ): Array<string> {
    return IRCMessageText.splitRange({
      text: line,
      start: 0,
      end: line.length,
      maxBytes: maxBytes,
      maxPieces: maxPieces,
    });
  }

  /*
   * The length of `text` in UTF-8, the way Buffer.from(text, "utf8") encodes
   * it: a lone surrogate becomes U+FFFD, three bytes.
   */
  public static getByteLength(text: string): number {
    let bytes: number = 0;

    for (const character of text) {
      bytes += IRCMessageText.getCodePointBytes(
        character.codePointAt(0) as number,
      );
    }

    return bytes;
  }

  /*
   * text[start, end) cut into pieces of at most maxBytes bytes, no more than
   * maxPieces of them. A piece ends at the last space before the limit when
   * that leaves it at least half full; otherwise it is cut at the limit,
   * between two characters. A piece that is cut loses the white space it
   * ends with, and blank pieces are dropped.
   *
   * Reads one character at a time and keeps no more than one piece in hand,
   * so a long line costs what its first maxPieces pieces cost, and a run of
   * spaces longer than a piece - which could only ever make a blank one - is
   * passed over without being copied.
   */
  private static splitRange(data: {
    text: string;
    start: number;
    end: number;
    maxBytes: number;
    maxPieces: number;
  }): Array<string> {
    const text: string = data.text;
    const pieces: Array<string> = [];
    let current: string = "";
    let currentBytes: number = 0;
    let isCurrentBlank: boolean = true;
    // A blank run too long for one piece is being passed over.
    let isSkippingBlankRun: boolean = false;

    const addPiece: (piece: string) => void = (piece: string): void => {
      if (!IRCMessageText.isBlankText(piece)) {
        pieces.push(piece);
      }
    };

    let index: number = data.start;

    while (index < data.end) {
      if (pieces.length >= data.maxPieces) {
        return pieces;
      }

      const code: number = text.charCodeAt(index);

      if (IRCMessageText.isRemoved(code)) {
        index++;
        continue;
      }

      /*
       * A run of blank characters - spaces, formatting codes, NBSP - longer
       * than a piece can hold shows nothing, wherever it is cut. Once the
       * blank piece in hand is full, the rest of the run is passed over
       * rather than added to it a character at a time, and what shows next
       * starts a piece of its own, without the run in front of it.
       */
      if (isCurrentBlank && IRCMessageText.isBlankCode(code)) {
        if (
          isSkippingBlankRun ||
          currentBytes + IRCMessageText.getCodePointBytes(code) > data.maxBytes
        ) {
          isSkippingBlankRun = true;
          index++;
          continue;
        }
      } else if (isSkippingBlankRun) {
        current = "";
        currentBytes = 0;
        isSkippingBlankRun = false;
      }

      const isSpace: boolean = code === SPACE_CODE || code === TAB;

      // One whole character: both halves of a surrogate pair together.
      let character: string = isSpace ? SPACE : text.charAt(index);
      let codePoint: number = isSpace ? SPACE_CODE : code;

      if (code >= 0xd800 && code <= 0xdbff && index + 1 < data.end) {
        const low: number = text.charCodeAt(index + 1);

        if (low >= 0xdc00 && low <= 0xdfff) {
          character = text.substring(index, index + 2);
          codePoint = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        }
      }

      index += character.length;

      const characterBytes: number =
        IRCMessageText.getCodePointBytes(codePoint);

      while (
        current.length > 0 &&
        currentBytes + characterBytes > data.maxBytes
      ) {
        const lastSpace: number = current.lastIndexOf(SPACE);

        if (
          lastSpace > 0 &&
          IRCMessageText.getByteLength(current.substring(0, lastSpace)) * 2 >=
            data.maxBytes
        ) {
          // Spaces at the end of a piece cut between words show nothing.
          addPiece(current.substring(0, lastSpace).trimEnd());
          current = current.substring(lastSpace + 1);
        } else {
          // White space at the end of a piece shows nothing, here too.
          addPiece(current.trimEnd());
          current = "";
        }

        if (pieces.length >= data.maxPieces) {
          return pieces;
        }

        currentBytes = IRCMessageText.getByteLength(current);
        isCurrentBlank = IRCMessageText.isBlankText(current);
      }

      current += character;
      currentBytes += characterBytes;

      if (isCurrentBlank && !IRCMessageText.isBlankCode(codePoint)) {
        isCurrentBlank = false;
      }
    }

    if (pieces.length < data.maxPieces) {
      addPiece(current);
    }

    return pieces;
  }

  // A control character IRC cannot carry: everything but formatting and tab.
  private static isRemoved(code: number): boolean {
    return (
      (code < SPACE_CODE && code !== TAB && !FORMATTING_CODES.has(code)) ||
      code === DELETE
    );
  }

  // Shows nothing: white space, or a control or formatting character.
  private static isBlankCode(code: number): boolean {
    return code <= SPACE_CODE || code === DELETE || UNICODE_SPACES.has(code);
  }

  private static isBlankText(text: string): boolean {
    for (let index: number = 0; index < text.length; index++) {
      if (!IRCMessageText.isBlankCode(text.charCodeAt(index))) {
        return false;
      }
    }

    return true;
  }

  /*
   * A lone surrogate is encoded as U+FFFD, three bytes, which is what a code
   * point below 0x10000 is counted as here.
   */
  private static getCodePointBytes(codePoint: number): number {
    if (codePoint < 0x80) {
      return 1;
    }

    if (codePoint < 0x800) {
      return 2;
    }

    if (codePoint < 0x10000) {
      return 3;
    }

    return 4;
  }
}
