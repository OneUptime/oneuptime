import { MAX_SYSLOG_RAW_LENGTH } from "Common/Types/Syslog/SyslogMessage";

/*
 * SYSLOG OVER TCP: WHERE ONE MESSAGE ENDS.
 *
 * A UDP datagram is one message. A TCP connection is a stream of bytes, and
 * RFC 6587 describes the two ways senders mark the end of a message in it:
 *
 *   - Octet counting: "83 <34>1 2026-10-13T..." - the length of the
 *     message in bytes, a space, then exactly that many bytes. What
 *     rsyslog, syslog-ng and FortiGate's "reliable" mode send. A message
 *     may hold line feeds.
 *   - Non-transparent framing: the message, then a line feed. What most
 *     network devices send. (Some end with CR LF or a NUL instead; both are
 *     read the same way.)
 *
 * A sender uses one or the other, but nothing says which before the first
 * byte, so each message is read by how it starts: digits, a space and "<"
 * is a counted message; anything else runs to the end of its line.
 *
 * The framer never holds more than one message's worth of bytes. A sender
 * that claims a message longer than a syslog message can be, or sends that
 * many bytes without ending a line, is not speaking syslog: the framer
 * says it is broken, and the receiver closes the connection.
 */

// The longest message taken, in bytes: the most a UDP datagram could carry.
export const MAX_SYSLOG_FRAME_LENGTH: number = MAX_SYSLOG_RAW_LENGTH;

const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;
const NUL: number = 0x00;
const SPACE: number = 0x20;
const LESS_THAN: number = 0x3c;
const DIGIT_ZERO: number = 0x30;
const DIGIT_NINE: number = 0x39;

// "65536" - the longest count a message of the longest length can have.
const MAX_COUNT_DIGITS: number = String(MAX_SYSLOG_FRAME_LENGTH).length;

const EMPTY: Buffer = Buffer.alloc(0);

interface CountedFrame {
  // Where the message starts, after "LENGTH ".
  start: number;
  length: number;
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= DIGIT_ZERO && byte <= DIGIT_NINE;
}

function isTerminator(byte: number | undefined): boolean {
  return byte === LINE_FEED || byte === NUL;
}

export default class SyslogStreamFramer {
  private pending: Buffer = EMPTY;

  /*
   * How much of `pending` is already known to hold no end of line, so a
   * message that arrives a few bytes at a time is searched once, not once
   * per piece.
   */
  private searched: number = 0;

  private broken: boolean = false;

  // True once the stream has stopped being syslog. Nothing more is read.
  public get isBroken(): boolean {
    return this.broken;
  }

  // The bytes held back, waiting for the rest of their message.
  public get pendingLength(): number {
    return this.pending.length;
  }

  /*
   * Takes the next bytes of the stream and returns the messages they
   * complete, in order.
   */
  public push(chunk: Buffer): Array<string> {
    if (this.broken || chunk.length === 0) {
      return [];
    }

    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

    const messages: Array<string> = [];
    let offset: number = 0;

    while (offset < this.pending.length) {
      const first: number = this.pending[offset]!;

      // What ended the message before: LF, CR LF or NUL - or padding.
      if (isTerminator(first) || first === CARRIAGE_RETURN) {
        offset++;
        this.searched = 0;
        continue;
      }

      const counted: CountedFrame | "incomplete" | null =
        this.readCount(offset);

      if (counted === "incomplete") {
        break;
      }

      if (counted) {
        if (counted.length > MAX_SYSLOG_FRAME_LENGTH) {
          this.broken = true;
          break;
        }

        const end: number = counted.start + counted.length;

        if (end > this.pending.length) {
          // The rest of the message has not arrived yet.
          break;
        }

        messages.push(this.pending.toString("utf8", counted.start, end));
        offset = end;
        this.searched = 0;
        continue;
      }

      const end: number = this.findTerminator(offset + this.searched);

      if (end === -1) {
        this.searched = this.pending.length - offset;

        if (this.searched > MAX_SYSLOG_FRAME_LENGTH) {
          this.broken = true;
        }

        break;
      }

      messages.push(this.pending.toString("utf8", offset, end));
      offset = end + 1;
      this.searched = 0;
    }

    if (this.broken) {
      this.pending = EMPTY;
      this.searched = 0;
    } else if (offset > 0) {
      /*
       * Copied, not sliced: a slice would keep the whole chunk it came
       * from alive for as long as a few bytes of it are waiting.
       */
      this.pending =
        offset >= this.pending.length
          ? EMPTY
          : Buffer.from(this.pending.subarray(offset));
    }

    return messages;
  }

  /*
   * The stream ended. A line the sender did not end before closing is
   * still a message; a counted message that was cut short is not.
   */
  public end(): Array<string> {
    if (this.broken || this.pending.length === 0) {
      this.pending = EMPTY;
      this.searched = 0;

      return [];
    }

    const rest: Buffer = this.pending;

    this.pending = EMPTY;
    this.searched = 0;

    if (this.readCountIn(rest, 0) !== null) {
      return [];
    }

    return [rest.toString("utf8")];
  }

  private readCount(offset: number): CountedFrame | "incomplete" | null {
    return this.readCountIn(this.pending, offset);
  }

  /*
   * "LENGTH <" at the offset: a counted message. "incomplete" while the
   * bytes so far could still become one; null when they cannot.
   */
  private readCountIn(
    buffer: Buffer,
    offset: number,
  ): CountedFrame | "incomplete" | null {
    // A count never starts with 0.
    if (!isDigit(buffer[offset]) || buffer[offset] === DIGIT_ZERO) {
      return null;
    }

    let index: number = offset;

    while (
      index < buffer.length &&
      isDigit(buffer[index]) &&
      index - offset <= MAX_COUNT_DIGITS
    ) {
      index++;
    }

    if (index - offset > MAX_COUNT_DIGITS) {
      // A number too long to be a length: the start of a line of text.
      return null;
    }

    if (index === buffer.length) {
      return "incomplete";
    }

    if (buffer[index] !== SPACE) {
      return null;
    }

    if (index + 1 === buffer.length) {
      return "incomplete";
    }

    // A syslog message starts with its priority.
    if (buffer[index + 1] !== LESS_THAN) {
      return null;
    }

    return {
      start: index + 1,
      length: parseInt(buffer.toString("latin1", offset, index), 10),
    };
  }

  private findTerminator(from: number): number {
    for (let index: number = from; index < this.pending.length; index++) {
      if (isTerminator(this.pending[index])) {
        return index;
      }
    }

    return -1;
  }
}
