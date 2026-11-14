/*
 * THE SECRETS AN OPENSTACK LOG LINE CAN HOLD, TAKEN OUT BEFORE IT IS STORED.
 *
 * OpenStack's debug logs have leaked tokens and passwords, and a Fernet token in a log
 * is a login. So what a service wrote goes through this as it arrives, whatever rules a
 * project has set, and nothing turns it off. It takes out:
 *
 *   - a Fernet token, a JWS token or a PKI token, wherever it stands, by its shape;
 *   - the value of anything named as a secret: password, token, auth_token, secret,
 *     X-Auth-Token, adminPass and the like, as key=value, key: value, 'key': 'value',
 *     "key": "value", the same inside escaped JSON however deep, ('key', 'value') and
 *     --key value;
 *   - the password in a URL: rabbit://user:password@host, mysql+pymysql://user:password@host;
 *   - a private key.
 *
 * Whatever it is unsure of goes. A value runs to its end however long it is. A password can
 * hold a quote, a bracket, a comma or a slash, so one of those only ends a value when nothing
 * of a value comes after it, and password=a,b=c loses b=c too. That costs a person a little
 * of a line. The other way round costs someone a credential.
 *
 * Logs are text anyone can write into, so every step reads the line with indexOf and a
 * loop, never a regular expression with a quantifier, and never reads a stretch twice:
 * the search for a word goes on from where its value stopped, so a thousand opening quotes
 * cost what one does, and the time this takes is in line with the line, whatever the line
 * holds (Docs/notifications/README.md, "Megabyte-long values").
 */

export const OPENSTACK_SCRUBBED_VALUE: string = "[REDACTED]";

// What a token's shape has to reach before it counts as one.
const MIN_TOKEN_LENGTH: number = 32;

/*
 * The names a value is secret under. Each is found anywhere in a longer name, so `password`
 * is also admin_password and rabbit_password, and `token` is X-Auth-Token. A name that runs
 * on past one is another name (password_expires_at), so what runs on and is secret is listed.
 * Most of these are what oslo.utils itself masks in the logs that go through it. They are
 * kept under what they all hold, so a line that holds none of that costs one look per group.
 */
const KEY_WORD_GROUPS: ReadonlyArray<{
  holds: string;
  words: ReadonlyArray<string>;
}> = [
  {
    holds: "pass",
    words: [
      "password",
      "password_hash",
      "passwd",
      "passphrase",
      "adminpass",
      "admin_pass",
      "new_pass",
    ],
  },
  { holds: "pwd", words: ["pwd"] },
  { holds: "pswd", words: ["pswd"] },
  { holds: "secret", words: ["secret", "secret_key", "secret_uuid"] },
  {
    holds: "key",
    words: [
      "access_key",
      "private_key",
      "api_key",
      "api-key",
      "apikey",
      "auth_key",
      "auth-key",
      "encrypted_key",
      "encryption_key",
      "fernetkey",
      "fernet_key",
      "sslkey",
      "ssl_key",
      "temp_url_key",
      "temp-url-key",
    ],
  },
  { holds: "sig", words: ["temp_url_sig", "signature"] },
  { holds: "token", words: ["token", "token_id"] },
  { holds: "authorization", words: ["authorization"] },
  {
    holds: "credential",
    words: ["credential", "credentials", "credential_blob"],
  },
  { holds: "blob", words: ["blob"] },
  { holds: "configdrive", words: ["configdrive"] },
  { holds: "cookie", words: ["cookie"] },
];

// A word that names something secret only when what follows it can be a value.
const VALUES_THAT_ARE_NOT_SECRETS: ReadonlyArray<string> = [
  "none",
  "null",
  "true",
  "false",
  "",
];

const LONGEST_VALUE_THAT_IS_NOT_A_SECRET: number = 8;

const AUTHORIZATION_SCHEMES: ReadonlyArray<string> = [
  "basic",
  "bearer",
  "token",
  "negotiate",
  "digest",
];

const LONGEST_PORT: number = 5;

// How far ahead a closing character looks for the next name: password=a,user=b.
const LONGEST_NAME_AFTER_A_VALUE: number = 64;

interface TextRange {
  start: number;
  end: number;
}

interface ValueRead {
  valueStart: number;
  valueEnd: number;
  // Where the search for the next one goes on from.
  closedAt: number;
}

const BACKSLASH: number = 92;
const DOUBLE_QUOTE: number = 34;
const SINGLE_QUOTE: number = 39;
const COLON: number = 58;

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  );
}

function isKeyCharacter(code: number): boolean {
  // A word goes on through these: password_expires_at, token-type, secret.ref.
  return (
    isAsciiLetterOrDigit(code) || code === 95 || code === 45 || code === 46
  );
}

function isBase64UrlCharacter(code: number): boolean {
  return (
    isAsciiLetterOrDigit(code) || code === 95 || code === 45 || code === 61
  );
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isQuote(code: number): boolean {
  return code === DOUBLE_QUOTE || code === SINGLE_QUOTE;
}

// What can end an unquoted value: see closesValue.
function isCloser(code: number): boolean {
  return (
    isQuote(code) ||
    code === 44 || // ,
    code === 59 || // ;
    code === 38 || // &
    code === 41 || // )
    code === 93 || // ]
    code === 125 // }
  );
}

/*
 * The same length as the text, so a place in one is a place in the other: lower-casing
 * a few characters outside ASCII changes how long a string is.
 */
function toSameLengthLowerCase(text: string): string {
  const lower: string = text.toLowerCase();

  if (lower.length === text.length) {
    return lower;
  }

  const parts: Array<string> = [];

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    parts.push(
      code >= 65 && code <= 90
        ? String.fromCharCode(code + 32)
        : text.charAt(index),
    );
  }

  return parts.join("");
}

// The backslashes right before a place, no further back than `floor`.
function countBackslashesBefore(
  text: string,
  position: number,
  floor: number,
): number {
  let count: number = 0;

  for (let index: number = position - 1; index >= floor; index--) {
    if (text.charCodeAt(index) !== BACKSLASH) {
      break;
    }
    count++;
  }

  return count;
}

/*
 * Whether another name starts here, which is what a,b=c and a&b=c look like between two values
 * and rarely inside one: a=1,b=2,c=3, as Python writes an object and a URL writes its query.
 * Looks a short way, so a line of nothing but commas is still read once.
 */
function startsName(text: string, position: number): boolean {
  const limit: number = Math.min(
    text.length,
    position + LONGEST_NAME_AFTER_A_VALUE,
  );

  for (let index: number = position; index < limit; index++) {
    const code: number = text.charCodeAt(index);

    if (code === 61) {
      return index > position;
    }

    if (!isKeyCharacter(code)) {
      return false;
    }
  }

  return false;
}

/*
 * Whether a closing character at this place ends a value that has no opening quote: only
 * when nothing of a value comes after it. A password can hold any of them.
 */
function closesValue(
  text: string,
  position: number,
  onlyQuotes: boolean,
): boolean {
  const code: number = text.charCodeAt(position);

  if (onlyQuotes ? !isQuote(code) : !isCloser(code)) {
    return false;
  }

  if (position + 1 >= text.length) {
    return true;
  }

  const next: number = text.charCodeAt(position + 1);

  return (
    isWhitespace(next) ||
    isCloser(next) ||
    next === BACKSLASH ||
    next === COLON ||
    (!onlyQuotes && !isQuote(code) && startsName(text, position + 1))
  );
}

/*
 * A quoted value, to its closing quote however far that is, or to the end of the text. A
 * quote escaped as many times as the opening one closes it, or fewer; one escaped more
 * times is in the value. So JSON inside JSON closes where it should. A quote that opened
 * unescaped closes when an even number of backslashes come before it.
 */
function readQuotedValue(data: {
  text: string;
  valueStart: number;
  quote: string;
  openingBackslashes: number;
}): ValueRead {
  const { text, valueStart, quote, openingBackslashes } = data;
  let from: number = valueStart;

  for (;;) {
    const at: number = text.indexOf(quote, from);

    if (at === -1) {
      return { valueStart, valueEnd: text.length, closedAt: text.length };
    }

    const before: number = countBackslashesBefore(text, at, valueStart);

    if (openingBackslashes === 0 && before % 2 === 0) {
      return { valueStart, valueEnd: at, closedAt: at + 1 };
    }

    if (openingBackslashes > 0 && before <= openingBackslashes) {
      return { valueStart, valueEnd: at - before, closedAt: at + 1 };
    }

    from = at + 1;
  }
}

function readUnquotedValue(data: {
  text: string;
  start: number;
  untilLineEnd: boolean;
}): ValueRead {
  const { text, start, untilLineEnd } = data;
  const first: number = text.charCodeAt(start);
  // A value that opens with a bracket keeps the bracket that closes it.
  let ownCloser: number = first === 123 ? 125 : first === 91 ? 93 : -1;
  let position: number = start;

  while (position < text.length) {
    const code: number = text.charCodeAt(position);

    if (untilLineEnd ? code === 10 || code === 13 : isWhitespace(code)) {
      break;
    }

    // Backslashes before a closing quote belong to the quote: JSON inside JSON.
    if (code === BACKSLASH) {
      let after: number = position + 1;

      while (after < text.length && text.charCodeAt(after) === BACKSLASH) {
        after++;
      }

      if (
        after < text.length &&
        isQuote(text.charCodeAt(after)) &&
        closesValue(text, after, untilLineEnd)
      ) {
        break;
      }

      position = after;
      continue;
    }

    if (code === ownCloser) {
      ownCloser = -1;
      position++;
      continue;
    }

    if (closesValue(text, position, untilLineEnd)) {
      break;
    }

    position++;
  }

  return { valueStart: start, valueEnd: position, closedAt: position };
}

/*
 * An object or a list is not one value: what is secret inside it is found on its own. It
 * shows by what follows its bracket. Anything else is a value that starts with a bracket:
 * password={abc}, X-Auth-Token: {SHA256}abc.
 */
function opensStructure(text: string, position: number): boolean {
  const opener: number = text.charCodeAt(position);

  if (opener !== 123 && opener !== 91) {
    return false;
  }

  let next: number = position + 1;

  while (next < text.length && isWhitespace(text.charCodeAt(next))) {
    next++;
  }

  if (next >= text.length) {
    return true;
  }

  const code: number = text.charCodeAt(next);

  return (
    isQuote(code) ||
    code === BACKSLASH ||
    code === 123 ||
    code === 91 ||
    code === 125 ||
    code === 93 ||
    ((code === 98 || code === 117) && isQuote(text.charCodeAt(next + 1)))
  );
}

// Where the value that starts at `start` ends.
function readValue(data: {
  text: string;
  start: number;
  untilLineEnd: boolean;
}): ValueRead | null {
  const { text, start } = data;

  if (start >= text.length) {
    return null;
  }

  // Already taken out, by this or by anything before it.
  if (text.startsWith(OPENSTACK_SCRUBBED_VALUE, start)) {
    const end: number = start + OPENSTACK_SCRUBBED_VALUE.length;

    return { valueStart: end, valueEnd: end, closedAt: end };
  }

  let position: number = start;

  // Python's own b'...' and u'...', in a dict a service logged as it stood.
  if (
    (text.charAt(position) === "b" ||
      text.charAt(position) === "u" ||
      text.charAt(position) === "r") &&
    isQuote(text.charCodeAt(position + 1))
  ) {
    position += 1;
  }

  let backslashes: number = 0;

  while (text.charCodeAt(position + backslashes) === BACKSLASH) {
    backslashes++;
  }

  if (isQuote(text.charCodeAt(position + backslashes))) {
    return readQuotedValue({
      text,
      valueStart: position + backslashes + 1,
      quote: text.charAt(position + backslashes),
      openingBackslashes: backslashes,
    });
  }

  if (opensStructure(text, position)) {
    return null;
  }

  return readUnquotedValue({
    text,
    start: position,
    untilLineEnd: data.untilLineEnd,
  });
}

// Stars are how oslo.utils and oslo.config write a secret they have already taken out.
function isOnlyStars(text: string, from: number, to: number): boolean {
  for (let index: number = from; index < to; index++) {
    if (text.charCodeAt(index) !== 42) {
      return false;
    }
  }

  return true;
}

function isNotASecret(text: string, read: ValueRead): boolean {
  return (
    read.valueEnd <= read.valueStart ||
    (read.valueEnd - read.valueStart <= LONGEST_VALUE_THAT_IS_NOT_A_SECRET &&
      (isOnlyStars(text, read.valueStart, read.valueEnd) ||
        VALUES_THAT_ARE_NOT_SECRETS.includes(
          text.slice(read.valueStart, read.valueEnd).trim().toLowerCase(),
        )))
  );
}

/*
 * What a word found in the line names, if it names a value. A word running on into
 * another (password_expires_at, tokens) is another word, and a word with nothing to say
 * after it is prose: "Failed to validate token (HTTP 404)".
 */
function readNamedValue(data: {
  text: string;
  wordStart: number;
  wordEnd: number;
  word: string;
}): { range: TextRange | null; resumeAt: number } {
  const { text, wordStart, wordEnd, word } = data;
  let position: number = wordEnd;

  // password1=, as a config with several of them names them.
  while (position < text.length && isDigit(text.charCodeAt(position))) {
    position++;
  }

  if (position < text.length && isKeyCharacter(text.charCodeAt(position))) {
    return { range: null, resumeAt: wordEnd };
  }

  // The key's own closing quote, escaped however many times or not.
  let backslashes: number = 0;

  while (text.charCodeAt(position + backslashes) === BACKSLASH) {
    backslashes++;
  }

  const isKeyQuoted: boolean = isQuote(text.charCodeAt(position + backslashes));

  if (isKeyQuoted) {
    position += backslashes + 1;
  }

  let spaces: number = 0;

  while (
    position < text.length &&
    (text.charCodeAt(position) === 32 || text.charCodeAt(position) === 9)
  ) {
    position++;
    spaces++;
  }

  const separator: string = text.charAt(position);
  let valueStart: number = -1;

  if (separator === "=" || separator === ":") {
    // A path's last word, as uWSGI writes a request: POST /v3/auth/token => generated 207 bytes.
    if (spaces > 0 && wordStart > 0 && text.charAt(wordStart - 1) === "/") {
      return { range: null, resumeAt: wordEnd };
    }

    valueStart = position + 1;
    // Python's own => and Ruby's, as a few of these are written.
    if (text.charAt(valueStart) === ">") {
      valueStart += 1;
    }
    while (
      valueStart < text.length &&
      (text.charCodeAt(valueStart) === 32 || text.charCodeAt(valueStart) === 9)
    ) {
      valueStart++;
    }
  } else if (separator === "," && isKeyQuoted) {
    // ('password', 'value'): only a quote after it makes this a pair, not a list of names.
    valueStart = position + 1;
    while (
      valueStart < text.length &&
      (text.charCodeAt(valueStart) === 32 || text.charCodeAt(valueStart) === 9)
    ) {
      valueStart++;
    }

    let quoteAt: number = valueStart;

    while (text.charCodeAt(quoteAt) === BACKSLASH) {
      quoteAt++;
    }

    if (!isQuote(text.charCodeAt(quoteAt))) {
      return { range: null, resumeAt: wordEnd };
    }
  } else if (
    spaces > 0 &&
    wordStart > 0 &&
    text.charAt(wordStart - 1) === "-"
  ) {
    // --password value, on a command a service logged.
    valueStart = position;
  } else {
    return { range: null, resumeAt: wordEnd };
  }

  const read: ValueRead | null = readValue({
    text,
    start: valueStart,
    untilLineEnd: word === "cookie",
  });

  if (!read) {
    return { range: null, resumeAt: valueStart };
  }

  /*
   * What a shell calls the folder it is in, as sudo writes it for every command it runs: a
   * password is a folder rarely enough, and a folder is a password never.
   */
  if (
    isNotASecret(text, read) ||
    (word === "pwd" && text.charAt(read.valueStart) === "/")
  ) {
    return { range: null, resumeAt: read.closedAt };
  }

  // A scheme is no secret, and what comes after it is: Authorization: Bearer abc.
  if (
    word === "authorization" &&
    read.valueEnd - read.valueStart <= LONGEST_VALUE_THAT_IS_NOT_A_SECRET + 1 &&
    AUTHORIZATION_SCHEMES.includes(
      text.slice(read.valueStart, read.valueEnd).toLowerCase(),
    ) &&
    text.charCodeAt(read.valueEnd) === 32
  ) {
    const rest: ValueRead | null = readValue({
      text,
      start: read.valueEnd + 1,
      untilLineEnd: false,
    });

    if (rest) {
      return {
        range:
          rest.valueEnd > rest.valueStart
            ? { start: rest.valueStart, end: rest.valueEnd }
            : null,
        resumeAt: rest.closedAt,
      };
    }
  }

  return {
    range: { start: read.valueStart, end: read.valueEnd },
    resumeAt: read.closedAt,
  };
}

function findNamedValues(data: {
  text: string;
  lower: string;
  ranges: Array<TextRange>;
}): void {
  for (const group of KEY_WORD_GROUPS) {
    if (data.lower.indexOf(group.holds) === -1) {
      continue;
    }

    for (const word of group.words) {
      let from: number = 0;

      for (;;) {
        const at: number = data.lower.indexOf(word, from);

        if (at === -1) {
          break;
        }

        const read: { range: TextRange | null; resumeAt: number } =
          readNamedValue({
            text: data.text,
            wordStart: at,
            wordEnd: at + word.length,
            word,
          });

        if (read.range) {
          data.ranges.push(read.range);
        }

        from = Math.max(read.resumeAt, at + word.length);
      }
    }
  }
}

/*
 * A token by its shape: its start, and at least MIN_TOKEN_LENGTH characters a token can
 * hold. The search goes on from its end, so a line of nothing but token characters is
 * read once.
 */
function findTokensByShape(data: {
  text: string;
  start: string;
  isTokenCharacter: (code: number) => boolean;
  minimumLength: number;
  ranges: Array<TextRange>;
}): void {
  let from: number = 0;

  for (;;) {
    const at: number = data.text.indexOf(data.start, from);

    if (at === -1) {
      return;
    }

    let end: number = at + data.start.length;

    while (
      end < data.text.length &&
      data.isTokenCharacter(data.text.charCodeAt(end))
    ) {
      end++;
    }

    if (end - at >= data.minimumLength) {
      data.ranges.push({ start: at, end });
    }

    from = end;
  }
}

function isJwsCharacter(code: number): boolean {
  return isBase64UrlCharacter(code) || code === 46;
}

function isBase64Character(code: number): boolean {
  return isBase64UrlCharacter(code) || code === 43 || code === 47;
}

// Whether what stands between two places is a port, or nothing. A short look.
function isPort(text: string, from: number, to: number): boolean {
  if (to - from > LONGEST_PORT) {
    return false;
  }

  for (let index: number = from; index < to; index++) {
    if (!isDigit(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

/*
 * The password of a URL: scheme://user:password@host, and each one of a bus's several
 * hosts, rabbit://user:password@one:5672,user:password@two:5672/. A password can hold a
 * comma, an @ and, unencoded, a slash: so a comma only ends a host that has its @, the last
 * @ before the host ends a password, and a slash only ends the first part of an address
 * when what comes after its colon could be a port. A text cut short can end inside a
 * password, with no @ left to say so.
 */
function findUrlPasswords(data: {
  text: string;
  ranges: Array<TextRange>;
  wasCut: boolean;
}): void {
  const { text, ranges } = data;
  let from: number = 0;

  for (;;) {
    const at: number = text.indexOf("://", from);

    if (at === -1) {
      return;
    }

    const start: number = at + 3;
    let position: number = start;
    let hostStart: number = start;
    let colon: number = -1;
    let lastAt: number = -1;
    let isInBrackets: boolean = false;
    let heldPassword: boolean = false;

    const closeHost: () => void = (): void => {
      if (colon !== -1 && lastAt > colon + 1) {
        ranges.push({ start: colon + 1, end: lastAt });
        heldPassword = true;
      } else if (lastAt > hostStart && heldPassword) {
        // What is left of a password holding both an @ and a comma.
        ranges.push({ start: hostStart, end: lastAt });
      }
      colon = -1;
      lastAt = -1;
    };

    while (position < text.length) {
      const code: number = text.charCodeAt(position);

      if (isWhitespace(code) || closesValue(text, position, true)) {
        break;
      }

      if (code === 47 || code === 63 || code === 35) {
        // / ? #
        if (
          lastAt !== -1 ||
          colon === -1 ||
          isPort(text, colon + 1, position)
        ) {
          break;
        }
      } else if (code === 44) {
        // A comma, with a host's @ behind it.
        if (lastAt !== -1) {
          closeHost();
          hostStart = position + 1;
        }
      } else if (code === 91 && colon === -1) {
        // An IPv6 host: http://[::1]:5000/.
        isInBrackets = true;
      } else if (code === 93) {
        isInBrackets = false;
      } else if (code === COLON && colon === -1 && !isInBrackets) {
        colon = position;
      } else if (code === 64) {
        lastAt = position;
      }

      position++;
    }

    if (
      data.wasCut &&
      position >= text.length &&
      colon !== -1 &&
      lastAt === -1 &&
      !isPort(text, colon + 1, position)
    ) {
      ranges.push({ start: colon + 1, end: text.length });
    } else {
      closeHost();
    }

    /*
     * Read once: the next search starts where this one stopped. One character back, because
     * the colon of another :// can be what the slash that stopped it comes after.
     */
    from = Math.max(position - 1, start);
  }
}

function findPrivateKeys(text: string, ranges: Array<TextRange>): void {
  let from: number = 0;
  const marker: string = "PRIVATE KEY-----";

  for (;;) {
    const at: number = text.indexOf(marker, from);

    if (at === -1) {
      return;
    }

    // Looked for just before it, so a line of nothing but these is read once.
    const beginWindowStart: number = Math.max(from, at - 64);
    const beginInWindow: number = text
      .slice(beginWindowStart, at)
      .lastIndexOf("-----BEGIN");
    const start: number =
      beginInWindow === -1 ? at : beginWindowStart + beginInWindow;
    const end: number = text.indexOf("-----END", at + marker.length);

    // A key with no end has no end: everything after it goes.
    if (end === -1) {
      ranges.push({ start, end: text.length });
      return;
    }

    const close: number = text.indexOf(marker, end);
    const stop: number = close === -1 ? end + 8 : close + marker.length;

    ranges.push({ start, end: stop });
    from = stop;
  }
}

/*
 * The text with its secrets taken out. The same string when it holds none. `wasCut` says
 * the text ends where something else cut it, which may be in the middle of a secret.
 */
export function scrubOpenStackSecrets(
  text: string,
  options?: { wasCut?: boolean | undefined },
): string {
  if (!text) {
    return text;
  }

  const ranges: Array<TextRange> = [];
  const lower: string = toSameLengthLowerCase(text);

  findNamedValues({ text, lower, ranges });
  findUrlPasswords({
    text,
    ranges,
    wasCut: Boolean(options && options.wasCut),
  });
  findPrivateKeys(text, ranges);
  findTokensByShape({
    text,
    start: "gAAAA",
    isTokenCharacter: isBase64UrlCharacter,
    minimumLength: MIN_TOKEN_LENGTH,
    ranges,
  });
  findTokensByShape({
    text,
    start: "eyJ",
    isTokenCharacter: isJwsCharacter,
    minimumLength: MIN_TOKEN_LENGTH,
    ranges,
  });
  // A PKI token: long, because plenty of ordinary base64 starts this way too.
  findTokensByShape({
    text,
    start: "MII",
    isTokenCharacter: isBase64Character,
    minimumLength: 200,
    ranges,
  });
  findTokensByShape({
    text,
    start: "PKIZ_",
    isTokenCharacter: isBase64Character,
    minimumLength: MIN_TOKEN_LENGTH,
    ranges,
  });

  if (ranges.length === 0) {
    return text;
  }

  ranges.sort((a: TextRange, b: TextRange): number => {
    return a.start - b.start;
  });

  const parts: Array<string> = [];
  let position: number = 0;

  for (const range of ranges) {
    if (range.end <= position) {
      continue;
    }

    if (range.start > position) {
      parts.push(text.slice(position, range.start));
      parts.push(OPENSTACK_SCRUBBED_VALUE);
    } else if (parts.length === 0) {
      parts.push(OPENSTACK_SCRUBBED_VALUE);
    }

    position = range.end;
  }

  parts.push(text.slice(position));

  return parts.join("");
}

/*
 * ANSI colour codes, which DevStack writes into every line. Read in one pass: an escape
 * followed by [, digits and semicolons, and an m.
 */
export function stripAnsiCodes(text: string): string {
  if (!text || text.indexOf("\u001b[") === -1) {
    return text;
  }

  const parts: Array<string> = [];
  let position: number = 0;

  for (;;) {
    const at: number = text.indexOf("\u001b[", position);

    if (at === -1) {
      parts.push(text.slice(position));
      break;
    }

    parts.push(text.slice(position, at));

    let end: number = at + 2;

    while (end < text.length) {
      const code: number = text.charCodeAt(end);

      if ((code >= 48 && code <= 57) || code === 59) {
        end++;
        continue;
      }
      break;
    }

    // A code it does not know is left out to here and no further.
    position = text.charAt(end) === "m" ? end + 1 : end;
  }

  return parts.join("");
}

/*
 * Whether a field's name is one a value is secret under, by the same words as a line's: its
 * name ends with one, as admin_password does and password_expires_at does not.
 */
function isSecretFieldName(lowerName: string): boolean {
  if (lowerName.length > MAX_FIELD_NAME_LENGTH) {
    return false;
  }

  for (const group of KEY_WORD_GROUPS) {
    for (const word of group.words) {
      const at: number = lowerName.lastIndexOf(word);

      if (at === -1) {
        continue;
      }

      let end: number = at + word.length;

      while (end < lowerName.length && isDigit(lowerName.charCodeAt(end))) {
        end++;
      }

      if (end === lowerName.length) {
        return true;
      }
    }
  }

  return false;
}

/*
 * A notification's or an audit event's fields with what must never be stored taken out:
 * whatever a credential holds, what a request or response held, and an oslo.context's
 * own copy of its token. By key, on the parsed value, and every text left is scrubbed on its
 * own: a line's scrub reads text and cannot see where a string of JSON ends, so it can take
 * more than it should and leave what no longer parses. Depth is bounded because a value
 * anyone can write decides it, and a walk that recursed for each level could run out of
 * stack on one long nesting.
 */
const REMOVED_KEYS: ReadonlySet<string> = new Set([
  "attachments",
  "credential",
  "credentials",
  "auth_token",
  "token",
  "password",
  "adminpass",
  "admin_pass",
  "admin_password",
  "secret",
  "blob",
  "user_data",
  "requestpayload",
  "responsepayload",
  "reqpayload",
  "respayload",
  "request_payload",
  "response_payload",
  "request_body",
  "response_body",
]);

const MAX_CLEANED_DEPTH: number = 32;

const MAX_FIELD_NAME_LENGTH: number = 128;

export function removeOpenStackSecretFields(
  value: unknown,
  depth: number = 0,
): unknown {
  if (Array.isArray(value)) {
    if (depth >= MAX_CLEANED_DEPTH) {
      return [];
    }

    return value.map((item: unknown): unknown => {
      return removeOpenStackSecretFields(item, depth + 1);
    });
  }

  if (value && typeof value === "object") {
    if (depth >= MAX_CLEANED_DEPTH) {
      return {};
    }

    const cleaned: Record<string, unknown> = {};

    for (const key of Object.keys(value as Record<string, unknown>)) {
      const lower: string = key.toLowerCase();

      if (
        REMOVED_KEYS.has(lower) ||
        lower.startsWith("_context_") ||
        lower === "__proto__"
      ) {
        continue;
      }

      const field: unknown = (value as Record<string, unknown>)[key];

      if (
        typeof field === "string" &&
        isSecretFieldName(lower) &&
        !isOnlyStars(field, 0, field.length) &&
        !VALUES_THAT_ARE_NOT_SECRETS.includes(field.trim().toLowerCase())
      ) {
        cleaned[key] = OPENSTACK_SCRUBBED_VALUE;
        continue;
      }

      cleaned[key] = removeOpenStackSecretFields(field, depth + 1);
    }

    return cleaned;
  }

  return typeof value === "string" ? scrubOpenStackSecrets(value) : value;
}
