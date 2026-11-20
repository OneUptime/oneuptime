/*
 * THE ID AND KEY A PROBE'S REPORT OPENS WITH (#10222).
 *
 * Every probe release that uploads a collection - a vCenter's, from 14.0.34,
 * and an OpenStack cloud's, from 14.0.104 - builds the body as
 *
 *   JSON.stringify({ ...ProbeAPIRequest.getDefaultRequestBody(), ...report })
 *
 * so its text opens with the probe's key and id, in that order, before
 * anything of the report:
 *
 *   {"probeKey":"...","probeId":"...","probeCapabilities":[...],...
 *
 * Probes send the two in headers as well from #10222 on (ProbeKeyHeaders),
 * and OneUptime checks them before it reads the body. An older probe sends
 * them in the body alone, so OneUptime reads them off the start of the
 * bytes instead - a few hundred bytes, without parsing the rest - and checks
 * the key before it parses the report. A collection's millions of values are
 * parsed only for a probe whose key is right, whichever release it runs.
 *
 * Read here: the first two members of the object, when they are two strings
 * named probeKey and probeId (in either order, with the white space JSON
 * allows between tokens), their escapes decoded as JSON.parse decodes them.
 * Anything else reads as no opening - another member first, a value that is
 * no string, a string that runs past the bytes read - and the body is parsed
 * as one whose probe is not known: under a large route's limit, with its key
 * read from it then, as it always was.
 */

// The most bytes of a report read for the members it opens with.
export const MAX_REPORT_OPENING_BYTES: number = 4096;

const PROBE_KEY_MEMBER: string = "probeKey";
const PROBE_ID_MEMBER: string = "probeId";

export interface ProbeReportOpeningCredentials {
  probeId: string;
  probeKey: string;
}

// The characters JSON allows between tokens.
const isJsonWhiteSpace: (code: number) => boolean = (code: number): boolean => {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
};

// What a single-character escape stands for.
const SINGLE_CHARACTER_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const HEX_DIGITS: RegExp = /^[0-9a-fA-F]{4}$/;

/*
 * Reads the tokens of a text from its start: each read moves past what it
 * read, and answers null for anything that is not what it reads.
 */
class OpeningReader {
  private position: number = 0;

  public constructor(private readonly text: string) {}

  public skipWhiteSpace(): void {
    while (
      this.position < this.text.length &&
      isJsonWhiteSpace(this.text.charCodeAt(this.position))
    ) {
      this.position++;
    }
  }

  // Whether the next character, after white space, is `character`: read if so.
  public readCharacter(character: string): boolean {
    this.skipWhiteSpace();

    if (this.text[this.position] !== character) {
      return false;
    }

    this.position++;
    return true;
  }

  // The next character after white space, unread: "" at the end.
  public peekCharacter(): string {
    this.skipWhiteSpace();

    return this.text[this.position] || "";
  }

  // A JSON string, after white space, decoded: null for anything else.
  public readString(): string | null {
    if (!this.readCharacter('"')) {
      return null;
    }

    let value: string = "";
    let runStart: number = this.position;

    while (this.position < this.text.length) {
      const code: number = this.text.charCodeAt(this.position);

      // The closing quote.
      if (code === 0x22) {
        value += this.text.slice(runStart, this.position);
        this.position++;
        return value;
      }

      // An escape.
      if (code === 0x5c) {
        value += this.text.slice(runStart, this.position);

        const escaped: string | null = this.readEscape();

        if (escaped === null) {
          return null;
        }

        value += escaped;
        runStart = this.position;
        continue;
      }

      // JSON allows no control character in a string as it is.
      if (code < 0x20) {
        return null;
      }

      this.position++;
    }

    // The string runs past what was read.
    return null;
  }

  // The escape at the position (its backslash), decoded and read past.
  private readEscape(): string | null {
    const kind: string | undefined = this.text[this.position + 1];

    if (kind === undefined) {
      return null;
    }

    const single: string | undefined = SINGLE_CHARACTER_ESCAPES[kind];

    if (single !== undefined) {
      this.position += 2;
      return single;
    }

    if (kind !== "u") {
      return null;
    }

    const hex: string = this.text.slice(this.position + 2, this.position + 6);

    if (!HEX_DIGITS.test(hex)) {
      return null;
    }

    this.position += 6;

    // One UTF-16 code unit, as JSON.parse reads it: a pair is two escapes.
    return String.fromCharCode(parseInt(hex, 16));
  }
}

export default class ProbeReportOpening {
  /*
   * The probe's id and key a report's bytes open with, or null when they
   * open with anything else. Reads at most MAX_REPORT_OPENING_BYTES of
   * them, whatever their length.
   */
  public static read(bytes: Uint8Array): ProbeReportOpeningCredentials | null {
    const text: string = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      Math.min(bytes.byteLength, MAX_REPORT_OPENING_BYTES),
    ).toString("utf8");

    const reader: OpeningReader = new OpeningReader(text);

    if (!reader.readCharacter("{")) {
      return null;
    }

    const members: Map<string, string> = new Map();

    for (let index: number = 0; index < 2; index++) {
      if (index > 0 && !reader.readCharacter(",")) {
        return null;
      }

      const name: string | null = reader.readString();

      if (
        name === null ||
        (name !== PROBE_KEY_MEMBER && name !== PROBE_ID_MEMBER) ||
        members.has(name)
      ) {
        return null;
      }

      if (!reader.readCharacter(":")) {
        return null;
      }

      const value: string | null = reader.readString();

      if (value === null) {
        return null;
      }

      members.set(name, value);
    }

    // What follows them is the rest of the object, or its end.
    const next: string = reader.peekCharacter();

    if (next !== "," && next !== "}") {
      return null;
    }

    return {
      probeId: members.get(PROBE_ID_MEMBER)!,
      probeKey: members.get(PROBE_KEY_MEMBER)!,
    };
  }
}
