import { encodeWord } from "nodemailer/lib/mime-funcs";

/*
 * A SENDER AS ONE "Name <address>" TEXT, THE WAY AN HTTP MAIL API READS IT.
 *
 * Amazon SES (FromEmailAddress), Postmark (From) and Resend (from) each take
 * the sender as one text and read it as an address header does (RFC 5322):
 *
 *   - A name of plain words goes as it is: OneUptime <alerts@example.com>.
 *   - A name with a character an address header gives a meaning to - a
 *     comma, a dot, brackets, an @, quotes - goes in quotes, its quotes and
 *     backslashes escaped: "Acme, Inc." <alerts@example.com>. Unquoted,
 *     "Acme, Inc." is two addresses, and the API refuses the sender.
 *   - Amazon SES asks for a name in any script beyond ASCII to be written
 *     as RFC 2047 encoded words ("=?UTF-8?B?...?="): encodeNonAscii. Postmark
 *     and Resend take the JSON's UTF-8 and encode it themselves.
 *
 * A line break in a name is a space: nothing in a name may start a header.
 * Every check is a loop over the characters, linear in the name.
 */

// The characters RFC 5322 allows in an atom (atext), besides letters and digits.
const ATEXT_SYMBOLS: string = "!#$%&'*+-/=?^_`{|}~";

function isAtomCharacter(character: string): boolean {
  const code: number = character.charCodeAt(0);

  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code >= 0x80 ||
    ATEXT_SYMBOLS.includes(character)
  );
}

export function hasNonAsciiCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    if (value.charCodeAt(index) >= 0x80) {
      return true;
    }
  }

  return false;
}

// Words of atoms and the spaces between them: a phrase that needs no quotes.
export function isPlainPhrase(value: string): boolean {
  if (!value) {
    return false;
  }

  for (const character of value) {
    if (character !== " " && !isAtomCharacter(character)) {
      return false;
    }
  }

  return true;
}

export function quoteDisplayName(name: string): string {
  let quoted: string = "";

  for (const character of name) {
    quoted +=
      character === '"' || character === "\\" ? `\\${character}` : character;
  }

  return `"${quoted}"`;
}

export function toOneLine(value: string): string {
  return value.split("\r").join(" ").split("\n").join(" ").trim();
}

export default function formatMailbox(data: {
  name?: string | undefined;
  address: string;
  encodeNonAscii?: boolean | undefined;
}): string {
  const name: string = toOneLine(data.name || "");
  const address: string = data.address.trim();

  if (!name) {
    return address;
  }

  if (data.encodeNonAscii && hasNonAsciiCharacter(name)) {
    // At most 52 bytes a word, as nodemailer writes a name: lines stay short.
    return `${encodeWord(name, "B", 52)} <${address}>`;
  }

  if (isPlainPhrase(name)) {
    return `${name} <${address}>`;
  }

  return `${quoteDisplayName(name)} <${address}>`;
}
