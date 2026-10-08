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
 * screenshot arrives as megabytes of base64 on one line - so nothing here runs
 * a regular expression over it (see "Megabyte-long values" in AGENTS.md), and
 * no more of it is read than the capped lines can hold.
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

const TAB: number = 0x09;
const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;
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

    /*
     * A line of IRC holds no more characters than it holds bytes, so no more
     * of any one line of the message than this can ever be sent.
     */
    const maxCharactersPerLine: number = linesWanted * data.maxBytesPerLine;

    let position: number = 0;

    while (position < text.length && lines.length < linesWanted) {
      let lineEnd: number = position;

      while (lineEnd < text.length) {
        const code: number = text.charCodeAt(lineEnd);

        if (code === LINE_FEED || code === CARRIAGE_RETURN) {
          break;
        }

        lineEnd++;
      }

      const line: string = IRCMessageText.sanitizeLine(
        text.substring(
          position,
          Math.min(lineEnd, position + maxCharactersPerLine),
        ),
      );

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

      for (const piece of IRCMessageText.splitLine(
        line,
        data.maxBytesPerLine,
        linesWanted - lines.length,
      )) {
        lines.push(piece);
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
   * One line of the message, with every character IRC cannot carry taken out
   * and a tab made a space. IRC's formatting codes stay.
   */
  public static sanitizeLine(line: string): string {
    let sanitized: string = "";

    for (let index: number = 0; index < line.length; index++) {
      const code: number = line.charCodeAt(index);

      if (code === TAB) {
        sanitized += SPACE;
        continue;
      }

      if ((code < 0x20 && !FORMATTING_CODES.has(code)) || code === DELETE) {
        continue;
      }

      sanitized += line.charAt(index);
    }

    return sanitized;
  }

  /*
   * Cuts a line into pieces of at most maxBytes bytes of UTF-8, and returns
   * no more than maxPieces of them. A piece ends at the last space before the
   * limit when that leaves it at least half full; otherwise it is cut at the
   * limit, between two characters. Blank pieces are dropped: IRC refuses an
   * empty message.
   */
  public static splitLine(
    line: string,
    maxBytes: number,
    maxPieces: number,
  ): Array<string> {
    const pieces: Array<string> = [];
    let current: string = "";
    let currentBytes: number = 0;

    const addPiece: (piece: string) => void = (piece: string): void => {
      if (piece.trim().length > 0) {
        pieces.push(piece);
      }
    };

    // Iterating a string yields whole code points, never half a surrogate pair.
    for (const character of line) {
      if (pieces.length >= maxPieces) {
        return pieces;
      }

      const characterBytes: number = IRCMessageText.getByteLength(character);

      while (current.length > 0 && currentBytes + characterBytes > maxBytes) {
        const lastSpace: number = current.lastIndexOf(SPACE);

        if (
          lastSpace > 0 &&
          IRCMessageText.getByteLength(current.substring(0, lastSpace)) * 2 >=
            maxBytes
        ) {
          addPiece(current.substring(0, lastSpace));
          current = current.substring(lastSpace + 1);
        } else {
          addPiece(current);
          current = "";
        }

        if (pieces.length >= maxPieces) {
          return pieces;
        }

        currentBytes = IRCMessageText.getByteLength(current);
      }

      current += character;
      currentBytes += characterBytes;
    }

    if (pieces.length < maxPieces) {
      addPiece(current);
    }

    return pieces;
  }

  /*
   * The length of `text` in UTF-8, the way Buffer.from(text, "utf8") encodes
   * it: a lone surrogate becomes U+FFFD, three bytes.
   */
  public static getByteLength(text: string): number {
    let bytes: number = 0;

    for (const character of text) {
      const codePoint: number = character.codePointAt(0) as number;

      if (codePoint < 0x80) {
        bytes += 1;
      } else if (codePoint < 0x800) {
        bytes += 2;
      } else if (codePoint < 0x10000) {
        bytes += 3;
      } else {
        bytes += 4;
      }
    }

    return bytes;
  }
}
