/*
 * WHAT FOLLOWS "page": WHO TO PAGE, THEN WHAT TO TELL THEM.
 *
 *   /oneuptime page @nawaz The checkout API is throwing 500s
 *   /oneuptime page @nawaz, @simon: the replica is 10 minutes behind
 *   @OneUptime page @Nawaz The checkout API is throwing 500s   (Teams)
 *
 * Each chat hands over what followed the word as tokens - the people it
 * @mentions, as the chat names them (a Slack user id, a Microsoft Teams
 * member), and the text around them - and both are read here alike:
 *
 *   - WHO is the run of @mentions the text starts with, one after another,
 *     with spaces, commas, "&", "+" or "and" between them.
 *   - THE MESSAGE is everything after that, as typed, without a ":" or a
 *     dash that only parts it from the names. An @mention inside the
 *     message is part of it ("ask @simon to join"), written "@name".
 *
 * Only people are read from the text. A user group ("@oncall-db"), or an
 * "@name" a chat sent as plain text - a Slack app created from an older
 * manifest sends names, not people - names nobody OneUptime can tell, so
 * it is kept to be said in the answer. A team, an on-call schedule or an
 * on-call policy is picked in the form the command opens instead
 * (WorkspacePage): its name at the start of the text fills the form in
 * (startsWithName), but never pages anybody by itself - a team named
 * "Database" must not be paged by "/oneuptime page database is slow".
 *
 * Read one character at a time, in time that grows with the text: what a
 * person types reaches a server as it is.
 */

// One person the text @mentions, as the chat names them.
export interface WorkspacePagePerson {
  // Their id in the chat: a Slack user id, a Microsoft Teams member id.
  workspaceUserId: string;
  // Their name as the chat wrote it, without the "@". May be empty.
  name: string;
}

// What a chat sent after "page", in order.
export type WorkspacePageToken =
  | { kind: "text"; text: string }
  | { kind: "person"; person: WorkspacePagePerson }
  // A user group, or @here / @channel: a name, without the "@".
  | { kind: "group"; name: string };

// The text, read.
export interface WorkspacePageText {
  // The people @mentioned before the message, each once, in order.
  people: Array<WorkspacePagePerson>;
  // The groups @mentioned before the message: "oncall-db", "here".
  groups: Array<string>;
  // The "@name"s sent as plain text before the message: "@nawaz".
  unknownNames: Array<string>;
  // The message, as typed, trimmed. Empty when there is none.
  message: string;
}

// Words that join two people: "@nawaz and @simon".
const JOINING_WORDS: ReadonlyArray<string> = ["and", "&", "+"];

// What may part the people from the message: "@nawaz: ...", "@nawaz - ...".
const MESSAGE_SEPARATORS: string = ":-–—";

// Punctuation an "@name" typed as text may end with: "@nawaz," "@nawaz:".
const NAME_TRAILING_PUNCTUATION: string = ",:;.!?";

function isWhiteSpace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\n" ||
    character === "\t" ||
    character === "\r" ||
    // A no-break space, and the ideographic space of CJK input.
    character === "\u{a0}" ||
    character === "\u{3000}"
  );
}

// "@nawaz," is "@nawaz": read from the end, a character at a time.
function withoutTrailing(word: string, characters: string): string {
  let end: number = word.length;

  while (end > 0 && characters.includes(word[end - 1]!)) {
    end--;
  }

  return word.substring(0, end);
}

export default class WorkspacePageTextReader {
  // Reads the tokens a chat sent after "page" (see the header).
  public static read(tokens: Array<WorkspacePageToken>): WorkspacePageText {
    const people: Array<WorkspacePagePerson> = [];
    const groups: Array<string> = [];
    const unknownNames: Array<string> = [];

    let tokenIndex: number = 0;
    // Where in the current text token reading is.
    let position: number = 0;
    // Whether anybody has been named yet: "and" joins only after somebody.
    let hasNamedSomebody: boolean = false;

    const addPerson: (person: WorkspacePagePerson) => void = (
      person: WorkspacePagePerson,
    ): void => {
      const isNamed: boolean = people.some(
        (named: WorkspacePagePerson): boolean => {
          return named.workspaceUserId === person.workspaceUserId;
        },
      );

      if (!isNamed) {
        people.push({
          workspaceUserId: person.workspaceUserId,
          name: person.name.trim(),
        });
      }
    };

    /*
     * Whether a mention - of a person or a group, or an "@name" typed as
     * text - comes next after `index` in the text token (skipping white
     * space), or as the next token when the text token ends first.
     */
    const isMentionNext: (
      fromToken: number,
      fromPosition: number,
    ) => boolean = (fromToken: number, fromPosition: number): boolean => {
      let current: number = fromToken;
      let at: number = fromPosition;

      while (current < tokens.length) {
        const token: WorkspacePageToken = tokens[current]!;

        if (token.kind !== "text") {
          return true;
        }

        while (at < token.text.length && isWhiteSpace(token.text[at])) {
          at++;
        }

        if (at < token.text.length) {
          return token.text[at] === "@" && at + 1 < token.text.length;
        }

        current++;
        at = 0;
      }

      return false;
    };

    // ---- who -------------------------------------------------------------

    reading: while (tokenIndex < tokens.length) {
      const token: WorkspacePageToken = tokens[tokenIndex]!;

      if (token.kind === "person") {
        addPerson(token.person);
        hasNamedSomebody = true;
        tokenIndex++;
        position = 0;
        continue;
      }

      if (token.kind === "group") {
        if (token.name.trim() && !groups.includes(token.name.trim())) {
          groups.push(token.name.trim());
        }

        hasNamedSomebody = true;
        tokenIndex++;
        position = 0;
        continue;
      }

      const text: string = token.text;

      while (position < text.length) {
        if (isWhiteSpace(text[position]) || text[position] === ",") {
          position++;
          continue;
        }

        // The next word, up to white space or a comma.
        let end: number = position;

        while (
          end < text.length &&
          !isWhiteSpace(text[end]) &&
          text[end] !== ","
        ) {
          end++;
        }

        const word: string = text.substring(position, end);

        if (
          hasNamedSomebody &&
          JOINING_WORDS.includes(word.toLowerCase()) &&
          isMentionNext(tokenIndex, end)
        ) {
          position = end;
          continue;
        }

        const name: string = withoutTrailing(word, NAME_TRAILING_PUNCTUATION);

        if (name.length > 1 && name.startsWith("@")) {
          if (!unknownNames.includes(name)) {
            unknownNames.push(name);
          }

          hasNamedSomebody = true;
          position = end;
          continue;
        }

        // The message starts here.
        break reading;
      }

      tokenIndex++;
      position = 0;
    }

    // ---- the message -----------------------------------------------------

    let message: string = "";

    for (let index: number = tokenIndex; index < tokens.length; index++) {
      const token: WorkspacePageToken = tokens[index]!;

      if (token.kind === "text") {
        message +=
          index === tokenIndex ? token.text.substring(position) : token.text;
        continue;
      }

      if (token.kind === "person") {
        message += `@${token.person.name.trim() || "someone"}`;
        continue;
      }

      message += `@${token.name.trim()}`;
    }

    return {
      people: people,
      groups: groups,
      unknownNames: unknownNames,
      message: WorkspacePageTextReader.withoutSeparator(message),
    };
  }

  /*
   * Reads text that has no mentions in it: a chat that sent the text alone
   * (a form's message, a test).
   */
  public static readText(text: string): WorkspacePageText {
    return WorkspacePageTextReader.read([{ kind: "text", text: text }]);
  }

  /*
   * The name, of `names`, the text starts with - in any case, as a whole
   * word: "Primary On-Call the DB is down" starts with "primary on-call" -
   * the longest one when several do. Null when it starts with none. For
   * filling in the form; nothing is paged on a name alone.
   */
  public static startsWithName(
    text: string,
    names: ReadonlyArray<string>,
  ): string | null {
    const lowerText: string = text.trimStart().toLowerCase();
    let found: string | null = null;

    for (const name of names) {
      const lowerName: string = name.trim().toLowerCase();

      if (!lowerName || !lowerText.startsWith(lowerName)) {
        continue;
      }

      const after: string | undefined = lowerText[lowerName.length];

      // A whole word: "Platform" does not start "Platformer is down".
      if (
        after !== undefined &&
        !isWhiteSpace(after) &&
        !MESSAGE_SEPARATORS.includes(after) &&
        after !== ","
      ) {
        continue;
      }

      if (!found || lowerName.length > found.trim().length) {
        found = name;
      }
    }

    return found;
  }

  // What follows a name the text starts with: the message.
  public static afterName(text: string, name: string): string {
    const trimmed: string = text.trimStart();

    return WorkspacePageTextReader.withoutSeparator(
      trimmed.substring(name.trim().length),
    );
  }

  /*
   * The message without what only parted it from the names: white space,
   * then one ":" or dash, then white space - "@nawaz: the DB" is "the DB".
   */
  public static withoutSeparator(text: string): string {
    let start: number = 0;

    while (start < text.length && isWhiteSpace(text[start])) {
      start++;
    }

    if (start < text.length && MESSAGE_SEPARATORS.includes(text[start]!)) {
      start++;
    }

    return text.substring(start).trim();
  }
}
