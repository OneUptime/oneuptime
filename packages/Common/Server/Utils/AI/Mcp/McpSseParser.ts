/*
 * Server-sent events, read the way the HTML standard says - for MCP's two
 * HTTP transports, which both carry JSON-RPC messages as SSE events: a
 * Streamable HTTP server may answer a POST with an event stream, and an
 * older HTTP+SSE server sends every answer down one long-lived GET stream.
 *
 * The stream is text from a server outside OneUptime, so it is read in one
 * pass, in time that grows in line with its length however the server
 * splits it: each chunk is searched for line ends once, with indexOf -
 * never a regular expression - and the start of a line that has not ended
 * is kept as pieces, joined once when its end arrives, so a server that
 * sends a long line a few bytes at a time costs no more than one that
 * sends it whole. An event larger than `maxEventChars` stops the stream:
 * it is reported, never buffered.
 */

export interface McpSseEvent {
  // The event's type: "message" unless the server named another.
  event: string;
  data: string;
  id?: string | undefined;
}

export class McpSseEventTooLargeError extends Error {
  public constructor(maxEventChars: number) {
    super(
      `The server sent an event larger than ${maxEventChars} characters, more than OneUptime reads.`,
    );
  }
}

const LINE_FEED: string = "\n";
const CARRIAGE_RETURN: string = "\r";

export default class McpSseParser {
  // The start of a line that has not ended yet, as it arrived.
  private pendingPieces: Array<string> = [];
  private pendingChars: number = 0;
  // A line ended with \r: a \n right after it belongs to the same line end.
  private skipLeadingLineFeed: boolean = false;
  private dataLines: Array<string> = [];
  private dataChars: number = 0;
  private eventName: string = "";
  private eventId: string | undefined = undefined;
  private readonly maxEventChars: number;

  public constructor(options: { maxEventChars: number }) {
    this.maxEventChars = options.maxEventChars;
  }

  /*
   * Reads a chunk of the stream and returns the events it completed, in
   * order. Throws McpSseEventTooLargeError once an event (or a line) grows
   * past the limit.
   */
  public push(chunk: string): Array<McpSseEvent> {
    const events: Array<McpSseEvent> = [];

    if (!chunk) {
      return events;
    }

    let position: number = 0;

    if (this.skipLeadingLineFeed) {
      this.skipLeadingLineFeed = false;

      if (chunk[0] === LINE_FEED) {
        position = 1;
      }
    }

    while (position < chunk.length) {
      const lineEnd: number = this.findLineEnd(chunk, position);

      if (lineEnd === -1) {
        this.keepPending(chunk.slice(position));
        break;
      }

      const line: string = this.takeLine(chunk.slice(position, lineEnd));

      position = lineEnd + 1;

      if (chunk[lineEnd] === CARRIAGE_RETURN) {
        if (position < chunk.length) {
          if (chunk[position] === LINE_FEED) {
            position++;
          }
        } else {
          // The \n of a \r\n may come with the next chunk.
          this.skipLeadingLineFeed = true;
        }
      }

      const event: McpSseEvent | null = this.readLine(line);

      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /*
   * The stream ended. An event that was never finished with a blank line is
   * dropped, as the standard says.
   */
  public end(): Array<McpSseEvent> {
    this.pendingPieces = [];
    this.pendingChars = 0;
    this.skipLeadingLineFeed = false;
    this.resetEvent();
    return [];
  }

  private findLineEnd(chunk: string, from: number): number {
    const lineFeed: number = chunk.indexOf(LINE_FEED, from);
    const carriageReturn: number = chunk.indexOf(CARRIAGE_RETURN, from);

    if (lineFeed === -1) {
      return carriageReturn;
    }

    if (carriageReturn === -1) {
      return lineFeed;
    }

    return Math.min(lineFeed, carriageReturn);
  }

  private keepPending(piece: string): void {
    this.pendingChars += piece.length;

    if (this.pendingChars > this.maxEventChars) {
      throw new McpSseEventTooLargeError(this.maxEventChars);
    }

    this.pendingPieces.push(piece);
  }

  // The whole line: what was kept of its start, and its end.
  private takeLine(end: string): string {
    if (this.pendingPieces.length === 0) {
      return end;
    }

    this.pendingPieces.push(end);

    const line: string = this.pendingPieces.join("");

    this.pendingPieces = [];
    this.pendingChars = 0;

    return line;
  }

  // One line of the stream; the event it completes, if it is a blank line.
  private readLine(line: string): McpSseEvent | null {
    if (line === "") {
      return this.dispatch();
    }

    // A comment, such as a keep-alive.
    if (line[0] === ":") {
      return null;
    }

    const colon: number = line.indexOf(":");
    const field: string = colon === -1 ? line : line.slice(0, colon);
    let value: string = colon === -1 ? "" : line.slice(colon + 1);

    if (value[0] === " ") {
      value = value.slice(1);
    }

    switch (field) {
      case "data":
        this.dataChars += value.length + 1;

        if (this.dataChars > this.maxEventChars) {
          throw new McpSseEventTooLargeError(this.maxEventChars);
        }

        this.dataLines.push(value);
        break;
      case "event":
        this.eventName = value;
        break;
      case "id":
        if (!value.includes("\u0000")) {
          this.eventId = value;
        }
        break;
      default:
        // "retry" and unknown fields are ignored.
        break;
    }

    return null;
  }

  private dispatch(): McpSseEvent | null {
    if (this.dataLines.length === 0) {
      this.resetEvent();
      return null;
    }

    const event: McpSseEvent = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
    };

    if (this.eventId !== undefined) {
      event.id = this.eventId;
    }

    this.resetEvent();

    return event;
  }

  private resetEvent(): void {
    this.dataLines = [];
    this.dataChars = 0;
    this.eventName = "";
    this.eventId = undefined;
  }
}
