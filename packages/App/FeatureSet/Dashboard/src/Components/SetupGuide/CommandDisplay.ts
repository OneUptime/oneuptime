/*
 * A shell command as it is drawn, in pieces: its words, and the spaces and
 * line breaks between them. A word no longer than a phone's line is kept
 * whole on screen (CopyableCommand draws it white-space: nowrap), so a long
 * command wraps only at a space - never after the dash of a flag ("sh -" /
 * "s --") or of a name ("oneuptime-" / "collector"), where a browser breaks
 * it otherwise. A longer word (an address) may still break where it must.
 *
 * Joined back, the pieces are the command, character for character. One
 * pass over the text, no regular expression: linear in its length.
 *
 * React-free: App tests read it.
 */

// The longest word kept on one line: about a phone's line of code text.
export const COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH: number = 32;

export interface CommandDisplayPart {
  text: string;
  isKeptWhole: boolean;
}

function isBlank(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

export function splitCommandForDisplay(
  command: string,
): Array<CommandDisplayPart> {
  const parts: Array<CommandDisplayPart> = [];
  let current: string = "";
  let isCurrentBlank: boolean = false;

  const flush: () => void = (): void => {
    if (!current) {
      return;
    }

    parts.push({
      text: current,
      isKeptWhole:
        !isCurrentBlank && current.length <= COMMAND_WORD_KEPT_WHOLE_MAX_LENGTH,
    });
    current = "";
  };

  for (const character of command) {
    const isCharacterBlank: boolean = isBlank(character);

    if (current && isCharacterBlank !== isCurrentBlank) {
      flush();
    }

    isCurrentBlank = isCharacterBlank;
    current += character;
  }

  flush();

  return parts;
}

/*
 * A command in pieces with a line break allowed between them, for a line
 * of code that draws them with <wbr> between: a word longer than a phone's
 * line (an address) may break after each slash of its path -
 * "https://oneuptime.com/" "install/" "proxmox-agent/" "troubleshoot.sh" -
 * but never between the two slashes after its scheme, nor right after them.
 * A browser otherwise breaks an address wherever its line ends
 * ("https://oneuptime.com/instal" / "l/proxmox-agent/..."). Shorter words
 * break as before, at a space.
 *
 * Joined, the pieces are the command, character for character. One pass,
 * no regular expression: linear in its length.
 */
export function splitCommandAtAddressSlashes(command: string): Array<string> {
  const pieces: Array<string> = [];
  let current: string = "";

  for (const part of splitCommandForDisplay(command)) {
    if (part.isKeptWhole || !part.text.trim()) {
      current += part.text;
      continue;
    }

    const characters: Array<string> = Array.from(part.text);

    for (let index: number = 0; index < characters.length; index++) {
      const character: string = characters[index]!;
      const next: string | undefined = characters[index + 1];

      current += character;

      if (
        character === "/" &&
        characters[index - 1] !== "/" &&
        next !== undefined &&
        next !== "/"
      ) {
        pieces.push(current);
        current = "";
      }
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}
