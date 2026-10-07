/*
 * How systemd reads an EnvironmentFile= — the VMware agent's .env when it
 * is installed without Docker — so tests can check what a value written
 * for that file reaches the service as, without systemd.
 *
 * A line-for-line port of parse_env_file_internal() in systemd's
 * src/basic/env-file.c (v255), with the backslash rules systemd 239 (RHEL
 * 8's; src/basic/fileio.c) still had behind `legacy`. systemd's rules are
 * not a shell's, nor Docker Compose's:
 *
 *   - in a single-quoted value, v255 takes everything as written; v239
 *     drops a backslash and keeps the character after it, so
 *     `'DOMAIN\user'` reads `DOMAINuser` there;
 *   - in a double-quoted value a backslash escapes only " \ ` and $, and is
 *     kept before any other character (v239 drops it before any
 *     character); $ is never expanded;
 *   - outside quotes a backslash escapes the next character (so
 *     `DOMAIN\user` reads `DOMAINuser`), surrounding whitespace is trimmed,
 *     and nothing starts a comment after the `=`;
 *   - after a closing quote the rest of the line is read again as a value,
 *     where a quote is an ordinary character: a shell's `'it'\''s'` reads
 *     `it''s'`.
 *
 * Double quotes with only \ and " escaped therefore read the same in both.
 * SystemdEnvironmentFile.test.ts pins the port to what systemd 255 and
 * systemd 239 themselves produced for the same lines.
 */

const COMMENTS: string = "#;";
const WHITESPACE: string = " \t\n\r";
const NEWLINE: string = "\n\r";
const SHELL_NEED_ESCAPE: string = '"\\`$';

enum State {
  PreKey,
  Key,
  PreValue,
  Value,
  ValueEscape,
  SingleQuoteValue,
  SingleQuoteValueEscape,
  DoubleQuoteValue,
  DoubleQuoteValueEscape,
  Comment,
  CommentEscape,
}

export interface SystemdEnvironmentFileOptions {
  // systemd 239's backslash rules (RHEL 8) instead of v255's.
  legacy?: boolean | undefined;
}

// The variables an EnvironmentFile= sets, the last assignment winning.
export function parseSystemdEnvironmentFile(
  contents: string,
  options: SystemdEnvironmentFileOptions = {},
): Map<string, string> {
  const legacy: boolean = Boolean(options.legacy);
  const variables: Map<string, string> = new Map();

  let state: State = State.PreKey;
  let key: string = "";
  let value: string = "";
  // Where trailing whitespace starts in the key or an unquoted value.
  let lastKeyWhitespace: number = -1;
  let lastValueWhitespace: number = -1;

  const push: (trimValue: boolean) => void = (trimValue: boolean): void => {
    const name: string =
      lastKeyWhitespace >= 0 ? key.slice(0, lastKeyWhitespace) : key;
    const read: string =
      trimValue && lastValueWhitespace >= 0
        ? value.slice(0, lastValueWhitespace)
        : value;
    variables.set(name, read);
    key = "";
    value = "";
  };

  for (const c of contents) {
    switch (state) {
      case State.PreKey:
        if (COMMENTS.includes(c)) {
          state = State.Comment;
        } else if (!WHITESPACE.includes(c)) {
          state = State.Key;
          lastKeyWhitespace = -1;
          key += c;
        }
        break;

      case State.Key:
        if (NEWLINE.includes(c)) {
          state = State.PreKey;
          key = "";
        } else if (c === "=") {
          state = State.PreValue;
          lastValueWhitespace = -1;
        } else {
          if (!WHITESPACE.includes(c)) {
            lastKeyWhitespace = -1;
          } else if (lastKeyWhitespace < 0) {
            lastKeyWhitespace = key.length;
          }
          key += c;
        }
        break;

      case State.PreValue:
        if (NEWLINE.includes(c)) {
          state = State.PreKey;
          push(false);
        } else if (c === "'") {
          state = State.SingleQuoteValue;
        } else if (c === '"') {
          state = State.DoubleQuoteValue;
        } else if (c === "\\") {
          state = State.ValueEscape;
        } else if (!WHITESPACE.includes(c)) {
          state = State.Value;
          value += c;
        }
        break;

      case State.Value:
        if (NEWLINE.includes(c)) {
          state = State.PreKey;
          push(true);
        } else if (c === "\\") {
          state = State.ValueEscape;
          lastValueWhitespace = -1;
        } else {
          if (!WHITESPACE.includes(c)) {
            lastValueWhitespace = -1;
          } else if (lastValueWhitespace < 0) {
            lastValueWhitespace = value.length;
          }
          value += c;
        }
        break;

      case State.ValueEscape:
        state = State.Value;
        // An escaped newline is eaten whole: a line continuation.
        if (!NEWLINE.includes(c)) {
          value += c;
        }
        break;

      case State.SingleQuoteValue:
        if (c === "'") {
          state = State.PreValue;
        } else if (legacy && c === "\\") {
          state = State.SingleQuoteValueEscape;
        } else {
          value += c;
        }
        break;

      case State.SingleQuoteValueEscape:
        state = State.SingleQuoteValue;
        if (!NEWLINE.includes(c)) {
          value += c;
        }
        break;

      case State.DoubleQuoteValue:
        if (c === '"') {
          state = State.PreValue;
        } else if (c === "\\") {
          state = State.DoubleQuoteValueEscape;
        } else {
          value += c;
        }
        break;

      case State.DoubleQuoteValueEscape:
        state = State.DoubleQuoteValue;
        if (legacy) {
          if (!NEWLINE.includes(c)) {
            value += c;
          }
        } else if (SHELL_NEED_ESCAPE.includes(c)) {
          value += c;
        } else if (c !== "\n") {
          value += `\\${c}`;
        }
        break;

      case State.Comment:
        if (c === "\\") {
          state = State.CommentEscape;
        } else if (NEWLINE.includes(c)) {
          state = State.PreKey;
        }
        break;

      case State.CommentEscape:
        // v239 carried a comment on over an escaped newline; v254 stopped.
        state = !legacy && NEWLINE.includes(c) ? State.PreKey : State.Comment;
        break;
    }
  }

  // A last line without a newline.
  if (
    [
      State.PreValue,
      State.Value,
      State.ValueEscape,
      State.SingleQuoteValue,
      State.SingleQuoteValueEscape,
      State.DoubleQuoteValue,
      State.DoubleQuoteValueEscape,
    ].includes(state)
  ) {
    push(state === State.Value);
  }

  return variables;
}
