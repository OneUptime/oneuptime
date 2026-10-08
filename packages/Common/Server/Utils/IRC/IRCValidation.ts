/*
 * What the IRC step accepts as a nickname, a channel, a channel key and a
 * password - checked before a connection is opened, so a value that cannot
 * be sent is refused with a sentence that says what to change, rather than
 * by the server in a reply the author never sees.
 *
 * Every one of these values is put on an IRC line, so whatever else a rule
 * allows, it never allows a CR, LF or NUL (IRCMessageUtil.build refuses them
 * again when the line is built). The values may have come from a trigger, so
 * each check looks at the length first and then walks the characters, with
 * no regular expression run over the value.
 *
 * The messages quote a nickname or a channel, which are not secret, and never
 * a key or a password.
 */

import IRCMessageText from "./IRCMessageText";

// The prefixes RFC 2812 gives channels. Anything else is a nickname.
export const IRC_CHANNEL_PREFIXES: ReadonlyArray<string> = ["#", "&", "+", "!"];

// NICKLEN: 16 on Libera.Chat, 30 on most other servers.
export const IRC_NICKNAME_MAX_LENGTH: number = 30;

// CHANNELLEN: 50 on Libera.Chat, 64 on InspIRCd and Ergo.
export const IRC_CHANNEL_MAX_BYTES: number = 64;

export const IRC_CHANNEL_KEY_MAX_LENGTH: number = 64;

// Room enough for a bouncer's "user/network:password".
export const IRC_PASSWORD_MAX_BYTES: number = 300;

// RFC 2812's "special" characters, which a nickname may use like letters.
const NICKNAME_SPECIAL_CHARACTERS: string = "[]\\`_^{|}";

const SPACE_CODE: number = 0x20;
const COMMA_CODE: number = 0x2c;
const DELETE_CODE: number = 0x7f;

export default class IRCValidation {
  public static isChannel(target: string): boolean {
    return IRC_CHANNEL_PREFIXES.some((prefix: string) => {
      return target.startsWith(prefix);
    });
  }

  /*
   * Why `nickname` cannot be used as one, or null when it can. RFC 2812's
   * rule: a letter or special character first, then letters, digits, special
   * characters and "-".
   */
  public static getNicknameProblem(nickname: string): string | null {
    if (nickname.length === 0) {
      return "Nickname is empty.";
    }

    if (nickname.length > IRC_NICKNAME_MAX_LENGTH) {
      return `Nickname ${IRCValidation.quote(nickname)} is longer than ${IRC_NICKNAME_MAX_LENGTH} characters.`;
    }

    for (let index: number = 0; index < nickname.length; index++) {
      const character: string = nickname.charAt(index);
      const isLetter: boolean =
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z");
      const isSpecial: boolean =
        NICKNAME_SPECIAL_CHARACTERS.includes(character);
      const isAllowedLater: boolean =
        (character >= "0" && character <= "9") || character === "-";

      if (!isLetter && !isSpecial && (index === 0 || !isAllowedLater)) {
        return `${IRCValidation.quote(nickname)} is not a valid IRC nickname. A nickname starts with a letter and holds only letters, digits, - and the characters ${NICKNAME_SPECIAL_CHARACTERS}.`;
      }
    }

    return null;
  }

  /*
   * Why `channel` cannot be posted to, or null when it can. The modern rule
   * (https://modern.ircdocs.horse/#channels): a channel prefix, then anything
   * but a space, a comma or a control character - which takes in BELL, the
   * one RFC 2812 forbids by name.
   */
  public static getChannelProblem(channel: string): string | null {
    if (channel.length === 0) {
      return "Channel is empty.";
    }

    /*
     * A nickname is not taken in its place: "ops" typed for "#ops" would
     * send the message to whoever holds that nickname on the network.
     */
    if (!IRCValidation.isChannel(channel)) {
      return `${IRCValidation.quote(channel)} is not a channel. A channel starts with #, such as #ops.`;
    }

    if (IRCMessageText.getByteLength(channel) > IRC_CHANNEL_MAX_BYTES) {
      return `Channel ${IRCValidation.quote(channel)} is longer than ${IRC_CHANNEL_MAX_BYTES} bytes.`;
    }

    if (channel.length < 2) {
      return `Channel ${IRCValidation.quote(channel)} has no name after its ${channel} prefix.`;
    }

    if (IRCValidation.hasSpaceCommaOrControl(channel)) {
      return `Channel ${IRCValidation.quote(channel)} is not a valid IRC channel name. A channel name cannot hold spaces, commas or control characters.`;
    }

    return null;
  }

  // The key of a channel with mode +k. Not quoted: it is a password.
  public static getChannelKeyProblem(key: string): string | null {
    if (key.length > IRC_CHANNEL_KEY_MAX_LENGTH) {
      return `Channel Key is longer than ${IRC_CHANNEL_KEY_MAX_LENGTH} characters.`;
    }

    if (IRCValidation.hasSpaceCommaOrControl(key)) {
      return "Channel Key cannot hold spaces, commas or control characters.";
    }

    // It is sent as a parameter of JOIN, where a leading ":" means the last one.
    if (key.startsWith(":")) {
      return "Channel Key cannot start with a colon.";
    }

    return null;
  }

  /*
   * A server or SASL password, or a SASL username. Spaces are fine: the
   * password goes last on its line, and the SASL values are base64-encoded.
   * A line break or a NUL is not - it would end the line, or, in SASL PLAIN,
   * split the credentials somewhere else.
   */
  public static getCredentialProblem(
    value: string,
    settingName: string,
  ): string | null {
    if (IRCMessageText.getByteLength(value) > IRC_PASSWORD_MAX_BYTES) {
      return `${settingName} is longer than ${IRC_PASSWORD_MAX_BYTES} bytes.`;
    }

    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);

      if (code === 0x00 || code === 0x0a || code === 0x0d) {
        return `${settingName} cannot hold a line break or a NUL character.`;
      }
    }

    return null;
  }

  /*
   * A value for an error message: cut to a readable length, and with no
   * character that could disturb the log it is written to.
   */
  public static quote(value: string): string {
    const maxLength: number = 64;
    let shown: string = "";

    for (const character of value.substring(0, maxLength)) {
      const code: number = character.codePointAt(0) as number;
      shown += code < SPACE_CODE || code === DELETE_CODE ? "?" : character;
    }

    return `"${shown}${value.length > maxLength ? "…" : ""}"`;
  }

  private static hasSpaceCommaOrControl(value: string): boolean {
    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);

      if (code <= SPACE_CODE || code === COMMA_CODE || code === DELETE_CODE) {
        return true;
      }
    }

    return false;
  }
}
