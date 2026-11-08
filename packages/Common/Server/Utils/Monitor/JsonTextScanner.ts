/*
 * READS A JSON TEXT ONCE, FRONT TO BACK, WITHOUT BUILDING IT.
 *
 * What the evaluation details need from a JSON response is positional: which
 * field holds the text a filter matched (its JSON path), and where the values
 * of fields whose names say secret sit in the text, so an excerpt cut from
 * the text can mask them. JSON.parse gives neither, so this walks the text
 * itself, with a stack of its own rather than recursion: a response is
 * written by whatever a monitor watches, and its nesting is no reason to run
 * out of stack. Linear in the text's length. A text that is not one complete
 * JSON value scans to null.
 */

export interface JsonTextSpan {
  // Index of the value's first character.
  start: number;
  // Index just past its last.
  end: number;
}

export interface JsonTextScan {
  /*
   * The values of the members whose names isSensitiveName marks, in text
   * order and never overlapping: a container that is masked whole is one
   * span.
   */
  sensitiveSpans: Array<JsonTextSpan>;
  /*
   * The path of the key or value whose text holds `index`, written the way a
   * JavaScript expression of a monitor reads it ("data.items[0].status").
   * Undefined when `index` falls between tokens, and "" for a top-level
   * value.
   */
  pathAtIndex?: string | undefined;
  // The root is an object or an array.
  isContainer: boolean;
}

// Deeper than this is not a response anybody reads by hand.
const MAX_DEPTH: number = 512;

// A key this long is shown as it was written, not decoded.
const MAX_DECODED_KEY_LENGTH: number = 1024;

const IDENTIFIER_START: RegExp = /^[A-Za-z_$]/;
const IDENTIFIER_REST: RegExp = /^[A-Za-z0-9_$]*$/;

type PathSegment = { key: string } | { index: number };

interface ContainerFrame {
  kind: "object" | "array";
  // object: the member being read. array: the element's index.
  segment?: PathSegment | undefined;
  nextIndex: number;
  /*
   * Where the container that is masked whole began, when this frame or one
   * outside it is the value of a sensitive member.
   */
  isMasked: boolean;
  maskStart: number;
  state: "key-or-end" | "colon" | "value" | "comma-or-end";
  // The member's key is sensitive: its value is masked.
  isKeySensitive: boolean;
}

export default class JsonTextScanner {
  public static scan(input: {
    text: string;
    isSensitiveName: (name: string) => boolean;
    index?: number | undefined;
  }): JsonTextScan | null {
    const text: string = input.text;

    if (typeof text !== "string") {
      return null;
    }

    const spans: Array<JsonTextSpan> = [];
    const stack: Array<ContainerFrame> = [];
    let pathAtIndex: string | undefined = undefined;
    let position: number = JsonTextScanner.skipWhitespace(text, 0);
    let hasRoot: boolean = false;
    let isContainer: boolean = false;

    const indexIsIn: (start: number, end: number) => boolean = (
      start: number,
      end: number,
    ): boolean => {
      return (
        input.index !== undefined && input.index >= start && input.index < end
      );
    };

    const currentPath: () => string = (): string => {
      return JsonTextScanner.formatPath(
        stack
          .map((frame: ContainerFrame): PathSegment | undefined => {
            return frame.segment;
          })
          .filter(
            (segment: PathSegment | undefined): segment is PathSegment => {
              return segment !== undefined;
            },
          ),
      );
    };

    // A value begins: the frame it lands in moves on.
    const beginValue: () => ContainerFrame | undefined = ():
      | ContainerFrame
      | undefined => {
      const frame: ContainerFrame | undefined = stack[stack.length - 1];

      if (frame && frame.kind === "array") {
        frame.segment = { index: frame.nextIndex };
        frame.nextIndex++;
      }

      return frame;
    };

    // A value that is not a container ended at `end`.
    const endPrimitive: (
      frame: ContainerFrame | undefined,
      start: number,
      end: number,
    ) => void = (
      frame: ContainerFrame | undefined,
      start: number,
      end: number,
    ): void => {
      if (frame && !frame.isMasked && frame.isKeySensitive) {
        spans.push({ start: start, end: end });
      }

      if (indexIsIn(start, end) && pathAtIndex === undefined) {
        pathAtIndex = currentPath();
      }

      if (frame) {
        frame.state = "comma-or-end";
        frame.isKeySensitive = false;
      }
    };

    while (position < text.length) {
      const frame: ContainerFrame | undefined = stack[stack.length - 1];
      const character: string = text.charAt(position);

      if (!frame && hasRoot) {
        // Text after the one top-level value.
        return null;
      }

      if (frame && frame.state === "key-or-end") {
        if (character === "}") {
          position = JsonTextScanner.closeContainer({
            stack,
            spans,
            position,
          });
          position = JsonTextScanner.skipWhitespace(text, position);
          continue;
        }

        if (character !== '"') {
          return null;
        }

        const keyEnd: number = JsonTextScanner.readString(text, position);

        if (keyEnd === -1) {
          return null;
        }

        const key: string = JsonTextScanner.decodeKey(
          text.slice(position, keyEnd),
        );

        frame.segment = { key: key };
        frame.isKeySensitive = !frame.isMasked && input.isSensitiveName(key);

        if (indexIsIn(position, keyEnd) && pathAtIndex === undefined) {
          pathAtIndex = currentPath();
        }

        frame.state = "colon";
        position = JsonTextScanner.skipWhitespace(text, keyEnd);
        continue;
      }

      if (frame && frame.state === "colon") {
        if (character !== ":") {
          return null;
        }

        frame.state = "value";
        position = JsonTextScanner.skipWhitespace(text, position + 1);
        continue;
      }

      if (frame && frame.state === "comma-or-end") {
        if (character === ",") {
          frame.state = frame.kind === "object" ? "key-or-end" : "value";
          position = JsonTextScanner.skipWhitespace(text, position + 1);

          // A trailing comma is not JSON.
          const next: string = text.charAt(position);

          if (
            (frame.kind === "object" && next === "}") ||
            (frame.kind === "array" && next === "]")
          ) {
            return null;
          }

          continue;
        }

        if (
          (frame.kind === "object" && character === "}") ||
          (frame.kind === "array" && character === "]")
        ) {
          position = JsonTextScanner.closeContainer({
            stack,
            spans,
            position,
          });
          position = JsonTextScanner.skipWhitespace(text, position);
          continue;
        }

        return null;
      }

      // A value: the root, an element, or a member's value.
      if (frame && frame.kind === "array" && character === "]") {
        // An empty array: "[" followed straight by "]".
        if (frame.nextIndex !== 0) {
          return null;
        }

        position = JsonTextScanner.closeContainer({ stack, spans, position });
        position = JsonTextScanner.skipWhitespace(text, position);
        continue;
      }

      const parent: ContainerFrame | undefined = beginValue();
      hasRoot = true;

      if (character === "{" || character === "[") {
        if (stack.length >= MAX_DEPTH) {
          return null;
        }

        if (!parent) {
          isContainer = true;
        }

        const isMasked: boolean = Boolean(
          parent && (parent.isMasked || parent.isKeySensitive),
        );

        if (parent) {
          parent.state = "comma-or-end";
          parent.isKeySensitive = false;
        }

        stack.push({
          kind: character === "{" ? "object" : "array",
          segment: undefined,
          nextIndex: 0,
          isMasked: isMasked,
          maskStart:
            isMasked && parent && !parent.isMasked
              ? position
              : parent?.maskStart ?? -1,
          state: character === "{" ? "key-or-end" : "value",
          isKeySensitive: false,
        });

        position = JsonTextScanner.skipWhitespace(text, position + 1);
        continue;
      }

      if (character === '"') {
        const end: number = JsonTextScanner.readString(text, position);

        if (end === -1) {
          return null;
        }

        endPrimitive(parent, position, end);
        position = JsonTextScanner.skipWhitespace(text, end);
        continue;
      }

      const end: number = JsonTextScanner.readLiteral(text, position);

      if (end === -1) {
        return null;
      }

      endPrimitive(parent, position, end);
      position = JsonTextScanner.skipWhitespace(text, end);
    }

    // Every container closed, and there was a value at all.
    if (stack.length > 0 || !hasRoot) {
      return null;
    }

    return {
      sensitiveSpans: spans,
      pathAtIndex: pathAtIndex,
      isContainer: isContainer,
    };
  }

  /*
   * A path as a monitor's JavaScript expression reads it: names joined by
   * dots, element indexes in brackets, and a name that is no identifier
   * quoted in brackets ("data["content-type"]").
   */
  public static formatPath(segments: Array<PathSegment>): string {
    let path: string = "";

    for (const segment of segments) {
      if ("index" in segment) {
        path += `[${segment.index}]`;
        continue;
      }

      const isIdentifier: boolean =
        IDENTIFIER_START.test(segment.key) &&
        IDENTIFIER_REST.test(segment.key.slice(1));

      if (isIdentifier) {
        path += path ? `.${segment.key}` : segment.key;
        continue;
      }

      path += `[${JSON.stringify(segment.key)}]`;
    }

    return path;
  }

  // Pops the container closing at `position` and returns the next position.
  private static closeContainer(input: {
    stack: Array<ContainerFrame>;
    spans: Array<JsonTextSpan>;
    position: number;
  }): number {
    const frame: ContainerFrame | undefined = input.stack.pop();
    const parent: ContainerFrame | undefined =
      input.stack[input.stack.length - 1];
    const end: number = input.position + 1;

    // The outermost masked container ends: its whole text is one span.
    if (frame && frame.isMasked && (!parent || !parent.isMasked)) {
      input.spans.push({ start: frame.maskStart, end: end });
    }

    return end;
  }

  // The index just past a string starting at `start` ('"'), or -1.
  private static readString(text: string, start: number): number {
    let position: number = start + 1;

    while (position < text.length) {
      const character: string = text.charAt(position);

      if (character === "\\") {
        position += 2;
        continue;
      }

      if (character === '"') {
        return position + 1;
      }

      // A raw line break is not allowed inside a JSON string.
      if (character === "\n" || character === "\r") {
        return -1;
      }

      position++;
    }

    return -1;
  }

  // The index just past a number, true, false or null at `start`, or -1.
  private static readLiteral(text: string, start: number): number {
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, start)) {
        return start + literal.length;
      }
    }

    let position: number = start;

    while (position < text.length) {
      const character: string = text.charAt(position);
      const isNumberCharacter: boolean =
        (character >= "0" && character <= "9") ||
        character === "-" ||
        character === "+" ||
        character === "." ||
        character === "e" ||
        character === "E";

      if (!isNumberCharacter) {
        break;
      }

      position++;
    }

    if (position === start) {
      return -1;
    }

    // Validate the number's own text, bounded by its length.
    const numberText: string = text.slice(start, position);

    if (Number.isNaN(Number(numberText))) {
      return -1;
    }

    return position;
  }

  private static decodeKey(rawKey: string): string {
    if (rawKey.length > MAX_DECODED_KEY_LENGTH || rawKey.indexOf("\\") === -1) {
      return rawKey.slice(1, -1);
    }

    try {
      const decoded: unknown = JSON.parse(rawKey);

      return typeof decoded === "string" ? decoded : rawKey.slice(1, -1);
    } catch {
      return rawKey.slice(1, -1);
    }
  }

  private static skipWhitespace(text: string, start: number): number {
    let position: number = start;

    while (position < text.length) {
      const character: string = text.charAt(position);

      if (
        character !== " " &&
        character !== "\t" &&
        character !== "\n" &&
        character !== "\r"
      ) {
        break;
      }

      position++;
    }

    return position;
  }
}
