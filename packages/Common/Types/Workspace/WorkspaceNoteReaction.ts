/*
 * Reacting to a chat message with one of these emojis saves the message as a
 * note on the incident / alert / scheduled maintenance / episode the channel
 * belongs to: a pin makes a private note, a megaphone or loudspeaker a public
 * one.
 *
 * Slack names its emojis ("pushpin", "mega"). Microsoft Teams does not agree
 * with itself: Graph reports the emoji itself ("📌") in reactionType plus a
 * display name ("Pushpin"), and other surfaces use ids such as
 * "1f4cc_pushpin". getNoteType accepts all of these.
 */

export enum WorkspaceNoteType {
  Private = "private",
  Public = "public",
}

// Emoji names that save a message as a Private Note (Internal Note).
export const PrivateNoteReactionNames: Array<string> = [
  "pushpin",
  "round_pushpin",
  "pin",
];

// Emoji names that save a message as a Public Note.
export const PublicNoteReactionNames: Array<string> = [
  "mega",
  "loudspeaker",
  "megaphone",
  "announcement",
  "speaking_head_in_silhouette",
  "speaking_head",
];

// The same emojis as Unicode characters, which is how Teams reports them.
const PrivateNoteReactionCharacters: Array<string> = [
  "\u{1F4CC}", // 📌 pushpin
  "\u{1F4CD}", // 📍 round pushpin
];

const PublicNoteReactionCharacters: Array<string> = [
  "\u{1F4E3}", // 📣 megaphone
  "\u{1F4E2}", // 📢 loudspeaker
  "\u{1F5E3}", // 🗣 speaking head
];

export interface WorkspaceReaction {
  // Slack's emoji name, or Teams' reactionType (an emoji, or a legacy name).
  reactionType?: string | undefined | null;
  // Teams' reaction display name, e.g. "Pushpin".
  displayName?: string | undefined | null;
}

export default class WorkspaceNoteReactionUtil {
  public static getNoteType(
    reaction: string | WorkspaceReaction | undefined | null,
  ): WorkspaceNoteType | null {
    if (!reaction) {
      return null;
    }

    const candidates: Array<string | undefined | null> =
      typeof reaction === "string"
        ? [reaction]
        : [reaction.reactionType, reaction.displayName];

    for (const candidate of candidates) {
      const noteType: WorkspaceNoteType | null =
        this.getNoteTypeForValue(candidate);

      if (noteType) {
        return noteType;
      }
    }

    return null;
  }

  public static isNoteReaction(
    reaction: string | WorkspaceReaction | undefined | null,
  ): boolean {
    return this.getNoteType(reaction) !== null;
  }

  private static getNoteTypeForValue(
    value: string | undefined | null,
  ): WorkspaceNoteType | null {
    if (!value || typeof value !== "string") {
      return null;
    }

    const character: string = this.stripEmojiModifiers(value).trim();

    if (PrivateNoteReactionCharacters.includes(character)) {
      return WorkspaceNoteType.Private;
    }

    if (PublicNoteReactionCharacters.includes(character)) {
      return WorkspaceNoteType.Public;
    }

    const name: string = this.normalizeName(value);

    if (PrivateNoteReactionNames.includes(name)) {
      return WorkspaceNoteType.Private;
    }

    if (PublicNoteReactionNames.includes(name)) {
      return WorkspaceNoteType.Public;
    }

    return null;
  }

  // Drops the emoji variation selectors and zero-width joiner, which are presentation only.
  private static stripEmojiModifiers(value: string): string {
    return value.replace(/[\uFE0E\uFE0F\u200D]/g, "");
  }

  /*
   * ":Round Pushpin:" → "round_pushpin", "1f4cc_pushpin" → "pushpin",
   * "speaking-head" → "speaking_head".
   */
  private static normalizeName(value: string): string {
    return this.stripEmojiModifiers(value)
      .trim()
      .toLowerCase()
      .replace(/^:+|:+$/g, "")
      .replace(/[\s-]+/g, "_")
      .replace(/^(?:[0-9a-f]{4,6}_)+/, "");
  }
}
