/*
 * The IRC wire format, both ways: reading the lines a server sends, and
 * building the lines the workflow "Send Message to IRC" step sends.
 *
 * IRC is a text protocol of CRLF-terminated lines
 * (https://modern.ircdocs.horse/#messages):
 *
 *   [@tags ][:source ]COMMAND[ param ...][ :trailing param]
 *
 * Every value the step puts on the wire comes from the workflow's settings,
 * which any workflow author writes and which can be filled in from a trigger's
 * data. A CR or LF in one of them would end the line early and start a command
 * of the sender's choosing - "#ops\r\nPRIVMSG NickServ :DROP" - so build()
 * refuses every value that could break out of its place in the line, whatever
 * the caller checked before.
 *
 * Kept free of sockets, so all of it can be tested on its own.
 */

export interface IRCMessage {
  // The server, or the "nick!user@host" of a user. Absent when not sent.
  source?: string | undefined;
  // Upper case: "PRIVMSG", or a three-digit numeric reply such as "001".
  command: string;
  // Every parameter, the trailing one last and without its ":".
  params: Array<string>;
}

// CR, LF and NUL end or corrupt a line wherever they appear in it.
const LINE_BREAKING_CHARACTERS: Array<string> = ["\r", "\n", "\0"];

export default class IRCMessageUtil {
  /*
   * Reads one line, without its CRLF, into its parts. Answers null for a line
   * that is not IRC: no command, or a command that is neither a word nor a
   * three-digit numeric ("HTTP/1.1 400 Bad Request", an SSH banner). The
   * caller treats that as talking to something other than an IRC server.
   *
   * Scans with indexOf rather than a regular expression: a line is capped by
   * the reader, but the cap is generous, and this way the cost is linear
   * whatever it holds.
   */
  public static parse(line: string): IRCMessage | null {
    let position: number = 0;

    // Message tags (IRCv3) carry nothing this step uses. Skip them.
    if (line.startsWith("@")) {
      const tagsEnd: number = line.indexOf(" ");

      if (tagsEnd === -1) {
        return null;
      }

      position = IRCMessageUtil.skipSpaces(line, tagsEnd);
    }

    let source: string | undefined = undefined;

    if (line.charAt(position) === ":") {
      const sourceEnd: number = line.indexOf(" ", position);

      if (sourceEnd === -1) {
        return null;
      }

      source = line.substring(position + 1, sourceEnd);
      position = IRCMessageUtil.skipSpaces(line, sourceEnd);
    }

    let commandEnd: number = line.indexOf(" ", position);

    if (commandEnd === -1) {
      commandEnd = line.length;
    }

    const command: string = line.substring(position, commandEnd);

    if (!IRCMessageUtil.isCommand(command)) {
      return null;
    }

    const params: Array<string> = [];
    position = IRCMessageUtil.skipSpaces(line, commandEnd);

    while (position < line.length) {
      if (line.charAt(position) === ":") {
        params.push(line.substring(position + 1));
        break;
      }

      let paramEnd: number = line.indexOf(" ", position);

      if (paramEnd === -1) {
        paramEnd = line.length;
      }

      params.push(line.substring(position, paramEnd));
      position = IRCMessageUtil.skipSpaces(line, paramEnd);
    }

    return {
      source: source,
      command: command.toUpperCase(),
      params: params,
    };
  }

  /*
   * Builds one line, without its CRLF. `middle` parameters are single words;
   * `trailing`, when given, is the last parameter and may hold spaces.
   *
   * Throws on any value that would not stay in its place: a line break or NUL
   * anywhere, and in a middle parameter a space, a leading ":" or nothing at
   * all. Those would end the line, start another parameter, or turn the rest
   * of the line into the trailing one.
   */
  public static build(data: {
    command: string;
    middle?: Array<string> | undefined;
    trailing?: string | undefined;
  }): string {
    if (!IRCMessageUtil.isCommand(data.command)) {
      throw new Error(`"${data.command}" is not an IRC command.`);
    }

    const parts: Array<string> = [data.command];

    for (const param of data.middle || []) {
      if (!IRCMessageUtil.isSafeMiddleParam(param)) {
        throw new Error(
          `A parameter of ${data.command} would break the IRC line it is in.`,
        );
      }

      parts.push(param);
    }

    if (data.trailing !== undefined) {
      if (IRCMessageUtil.hasLineBreakingCharacter(data.trailing)) {
        throw new Error(
          `The last parameter of ${data.command} would break the IRC line it is in.`,
        );
      }

      parts.push(`:${data.trailing}`);
    }

    return parts.join(" ");
  }

  /*
   * The nickname a source names: "alice" of "alice!~a@example.com". A server
   * source has no "!" or "@" and is returned as it is.
   */
  public static getNickname(source: string | undefined): string {
    if (!source) {
      return "";
    }

    for (const separator of ["!", "@"]) {
      const index: number = source.indexOf(separator);

      if (index !== -1) {
        return source.substring(0, index);
      }
    }

    return source;
  }

  /*
   * Whether two nicknames or channel names are the same to the server. IRC's
   * traditional rfc1459 case mapping also folds []\~ into {}|^, because they
   * were the upper and lower case of the same letters in Scandinavian ASCII.
   * It is the default when a server does not say otherwise, and a superset of
   * the plain "ascii" mapping, so it never calls two of our own names
   * different when the server calls them the same.
   */
  public static isSameName(left: string, right: string): boolean {
    return (
      IRCMessageUtil.toLowerCase(left) === IRCMessageUtil.toLowerCase(right)
    );
  }

  public static toLowerCase(name: string): string {
    let lower: string = "";

    for (const character of name.toLowerCase()) {
      switch (character) {
        case "[":
          lower += "{";
          break;
        case "]":
          lower += "}";
          break;
        case "\\":
          lower += "|";
          break;
        case "~":
          lower += "^";
          break;
        default:
          lower += character;
      }
    }

    return lower;
  }

  public static hasLineBreakingCharacter(value: string): boolean {
    return LINE_BREAKING_CHARACTERS.some((character: string) => {
      return value.includes(character);
    });
  }

  public static isSafeMiddleParam(param: string): boolean {
    return (
      param.length > 0 &&
      !param.startsWith(":") &&
      !param.includes(" ") &&
      !IRCMessageUtil.hasLineBreakingCharacter(param)
    );
  }

  /*
   * A command word ("PRIVMSG", in either case) or a three-digit numeric reply
   * ("433"). ASCII only: toUpperCase would turn a dotless "ı" into an "I".
   */
  private static isCommand(command: string): boolean {
    if (command.length === 0) {
      return false;
    }

    let allLetters: boolean = true;
    let allDigits: boolean = true;

    for (let index: number = 0; index < command.length; index++) {
      const code: number = command.charCodeAt(index);
      const isLetter: boolean =
        (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      const isDigit: boolean = code >= 48 && code <= 57;

      allLetters = allLetters && isLetter;
      allDigits = allDigits && isDigit;
    }

    return allLetters || (allDigits && command.length === 3);
  }

  private static skipSpaces(line: string, position: number): number {
    let next: number = position;

    while (line.charAt(next) === " ") {
      next++;
    }

    return next;
  }
}
