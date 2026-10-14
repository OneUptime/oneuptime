/*
 * A MICROSOFT TEAMS MESSAGE WITHOUT ITS MENTIONS, IN TIME THAT GROWS WITH THE
 * MESSAGE.
 *
 * Teams writes a mention into a message as a tag around the name it shows:
 *
 *   <at>OneUptime</at> show active incidents
 *   <at id="0">OneUptime</at> which monitors are down?
 *
 * The bot reads a command or a question once its mentions are gone. This was
 * a regular expression, /<at[^>]*>.*?<\/at>/g, which is tried again from
 * every "<at" of a message to the end of it: 400,000 characters of "<at"
 * took minutes. The message is somebody's own text, so it is read here with
 * one walk instead - each character is looked at a bounded number of times.
 *
 * A mention is "<at", then ">" or a space and the tag's attributes (no "<"
 * or ">" among them), then the name (no "<" in it: Teams sends a "<" a
 * person typed as "&lt;"), then "</at>". Anything else - "<attachment ...>",
 * an "<at" that never closes - is text, and stays.
 */

const MENTION_OPEN: string = "<at";
const MENTION_CLOSE: string = "</at>";

export default class MicrosoftTeamsMentionText {
  // The message with every mention left out (see the header).
  public static removeMentions(text: string): string {
    if (!text || text.indexOf(MENTION_OPEN) === -1) {
      return text || "";
    }

    const kept: Array<string> = [];
    // Where the text not yet kept starts.
    let keptUpTo: number = 0;
    // Where the next mention is looked for.
    let from: number = 0;

    while (from < text.length) {
      const open: number = text.indexOf(MENTION_OPEN, from);

      if (open === -1) {
        break;
      }

      const afterOpen: number = open + MENTION_OPEN.length;
      const next: string = text.charAt(afterOpen);

      // "<attachment", "<atom>": another tag, not a mention.
      if (next !== ">" && !MicrosoftTeamsMentionText.isSpace(next)) {
        from = afterOpen;
        continue;
      }

      // The end of the opening tag: its ">", or a "<" that says it is none.
      const openEnd: number = MicrosoftTeamsMentionText.indexOfEither(
        text,
        afterOpen,
        ">",
        "<",
      );

      if (openEnd === -1) {
        // No ">" or "<" after it: no mention can follow.
        break;
      }

      if (text.charAt(openEnd) === "<") {
        // A tag that never ended: look again from the "<" that cut it short.
        from = openEnd;
        continue;
      }

      // The name runs to the next "<", which must start "</at>".
      const nameEnd: number = text.indexOf("<", openEnd + 1);

      if (nameEnd === -1) {
        break;
      }

      if (!text.startsWith(MENTION_CLOSE, nameEnd)) {
        from = nameEnd;
        continue;
      }

      kept.push(text.substring(keptUpTo, open));
      keptUpTo = nameEnd + MENTION_CLOSE.length;
      from = keptUpTo;
    }

    kept.push(text.substring(keptUpTo));

    return kept.join("");
  }

  /*
   * The first of two characters at or after `from`, or -1: one walk, where
   * two indexOf calls could each read to the end of the text.
   */
  private static indexOfEither(
    text: string,
    from: number,
    first: string,
    second: string,
  ): number {
    for (let index: number = from; index < text.length; index++) {
      const character: string = text.charAt(index);

      if (character === first || character === second) {
        return index;
      }
    }

    return -1;
  }

  private static isSpace(character: string): boolean {
    return (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    );
  }
}
