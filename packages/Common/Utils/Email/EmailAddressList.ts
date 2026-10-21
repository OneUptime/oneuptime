/*
 * The addresses in a header that lists mailboxes: To, Cc, or the recipient
 * list of an inbound provider's envelope.
 *
 * A header like that is not a comma-separated list of addresses. Display
 * names come first and may be quoted ("Doe, Jane" <jane@example.com>), may
 * hold a comma or a semicolon of their own, and RFC 5322 also allows groups
 * ("Ops team: a@example.com, b@example.com;") and comments in parentheses.
 * Splitting on commas reads `"Doe` and `Jane" <jane@example.com>` as two
 * recipients. So this walks the header once, splitting only where a comma or
 * semicolon is outside quotes, angle brackets and comments, and keeps just the
 * address of each mailbox: lowercased, because that is how every address the
 * inbound path compares is written, and once each.
 *
 * Semicolons separate too: they end a group, and people paste lists the way
 * Outlook writes them ("a@example.com; b@example.com").
 */

// Characters an address written without angle brackets cannot contain.
const BARE_ADDRESS: RegExp = /^[^\s@<>()",;:[\]\\]+@[^\s@<>()",;:[\]\\]+$/;

type SplitMailboxesFunction = (header: string) => Array<string>;

const splitMailboxes: SplitMailboxesFunction = (
  header: string,
): Array<string> => {
  const parts: Array<string> = [];
  let current: string = "";
  let isInQuotes: boolean = false;
  let isEscaped: boolean = false;
  let angleDepth: number = 0;
  let commentDepth: number = 0;

  for (const character of header) {
    if (isInQuotes) {
      current += character;

      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        isInQuotes = false;
      }

      continue;
    }

    if (character === '"') {
      isInQuotes = true;
      current += character;
      continue;
    }

    if (character === "(") {
      commentDepth++;
    } else if (character === ")" && commentDepth > 0) {
      commentDepth--;
    } else if (character === "<") {
      angleDepth++;
    } else if (character === ">" && angleDepth > 0) {
      angleDepth--;
    }

    const isSeparator: boolean =
      (character === "," || character === ";") &&
      angleDepth === 0 &&
      commentDepth === 0;

    if (isSeparator) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);

  return parts;
};

type AddressOfMailboxFunction = (mailbox: string) => string | null;

// `Jane <jane@example.com>`, `jane@example.com`, `Group: jane@example.com`.
const addressOfMailbox: AddressOfMailboxFunction = (
  mailbox: string,
): string | null => {
  // Comments carry no address: `jane@example.com (Jane Doe)`.
  let text: string = mailbox.replace(/\([^()]*\)/g, " ").trim();

  if (!text) {
    return null;
  }

  const bracketed: RegExpMatchArray | null = text.match(/<([^<>]*)>\s*$/);

  if (bracketed) {
    text = (bracketed[1] || "").trim();
  } else {
    // The first mailbox of a group comes after the group's name and a colon.
    const colonIndex: number = text.lastIndexOf(":");

    if (colonIndex !== -1 && !text.startsWith('"')) {
      text = text.substring(colonIndex + 1).trim();
    }
  }

  const address: string = text.toLowerCase();

  return BARE_ADDRESS.test(address) ? address : null;
};

export default class EmailAddressList {
  /*
   * Every address in `header`, in the order written, lowercased and once
   * each. Empty for an empty header and for one that names nobody (a bare
   * group such as `undisclosed-recipients:;`).
   */
  public static parse(header: string | null | undefined): Array<string> {
    if (!header || typeof header !== "string") {
      return [];
    }

    const addresses: Array<string> = [];

    for (const mailbox of splitMailboxes(header)) {
      const address: string | null = addressOfMailbox(mailbox);

      if (address && !addresses.includes(address)) {
        addresses.push(address);
      }
    }

    return addresses;
  }

  /*
   * The addresses of several lists together, in order and once each: the To
   * and Cc of one email, say.
   */
  public static merge(
    ...lists: Array<Array<string> | null | undefined>
  ): Array<string> {
    const addresses: Array<string> = [];

    for (const list of lists) {
      for (const address of list || []) {
        const normalized: string = address.trim().toLowerCase();

        if (normalized && !addresses.includes(normalized)) {
          addresses.push(normalized);
        }
      }
    }

    return addresses;
  }

  // The addresses as one line, the way an email client shows them.
  public static format(addresses: Array<string> | null | undefined): string {
    return (addresses || []).join(", ");
  }
}
