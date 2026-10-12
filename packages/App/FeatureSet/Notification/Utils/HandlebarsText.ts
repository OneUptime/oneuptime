import { randomBytes } from "crypto";
import Handlebars from "handlebars";

/*
 * TEXT TOO LONG FOR HANDLEBARS TO READ.
 *
 * An email sent with a body of its own (no template) has that body compiled
 * as a Handlebars template, so its "{{variables}}" are filled in - and the
 * body is whatever the sender put there: a description, a log, a response,
 * megabytes of it. Handlebars reads a template with regular expressions (its
 * lexer takes "everything up to the next {{" with a lazy quantifier), and V8
 * matches a regular expression on a backtracking stack that can grow with
 * every character a quantifier takes. A process that has compiled enough
 * code - a worker that has been up a while, a CI test worker - compiles
 * regular expressions unoptimized, and then Handlebars runs out of stack
 * ("Maximum call stack size exceeded") on a few megabytes of text, and the
 * email is never sent. (Common/Utils/Markdown/OverLongText.ts is the same
 * limit, for the Markdown parsers.)
 *
 * So Handlebars is never given such text:
 *
 *   - a text with no "{{" is what Handlebars would render it as - itself -
 *     and is not compiled at all;
 *   - in any other, the middle of every run of plain text between two
 *     mustaches longer than LONG_TEMPLATE_RUN_LENGTH characters is held
 *     back: Handlebars reads a short token in its place, and the text is
 *     written back wherever Handlebars put the token - once for every time
 *     the template rendered it ({{#each}}), not at all where it did not
 *     ({{#if}}). The run keeps its first and last
 *     LONG_TEMPLATE_RUN_KEPT_LENGTH characters, and all the whitespace at
 *     its ends: what a "~" or a block on a line of its own trims, and the
 *     backslash that escapes a mustache, are where Handlebars looks for them.
 *
 * Text inside a mustache, a comment or a raw block is never held back. A
 * mustache that does not close ends the holding back there: Handlebars
 * refuses the text anyway. No regular expression runs over the text: it is
 * scanned with indexOf and loops.
 */

// A run of plain text longer than this is too long for Handlebars to read.
export const LONG_TEMPLATE_RUN_LENGTH: number = 65536;

// What a held-back run keeps of its start, and of its end.
export const LONG_TEMPLATE_RUN_KEPT_LENGTH: number = 1024;

const OPEN: string = "{{";
const CLOSE: string = "}}";

// One character, as Handlebars' whitespace control (\s) counts it.
const WHITESPACE_CHARACTER: RegExp = /^\s$/;

interface HeldBackTemplate {
  // What Handlebars reads: the template with tokens for what was held back.
  template: string;
  // The token's start; the token is `${prefix}${index}${TOKEN_END}`.
  prefix: string;
  // What each token stands for, by index.
  heldBack: Array<string>;
}

const TOKEN_END: string = "x";

export default class HandlebarsText {
  /*
   * `template` compiled with Handlebars and rendered with `vars`, as
   * Handlebars.compile(template)(vars) renders it - without Handlebars ever
   * reading a long run of its plain text.
   */
  public static render(
    template: string,
    vars: Record<string, unknown>,
  ): string {
    if (template.indexOf(OPEN) === -1) {
      return template;
    }

    const held: HeldBackTemplate = this.holdBackLongRuns(template);

    const rendered: string = Handlebars.compile(held.template)(vars).toString();

    return held.heldBack.length > 0
      ? this.writeBack(rendered, held.prefix, held.heldBack)
      : rendered;
  }

  /*
   * The template with the middle of every over-long run of plain text
   * replaced by a token, and what each token stands for.
   */
  public static holdBackLongRuns(template: string): HeldBackTemplate {
    const prefix: string = this.makeTokenPrefix(template);
    const heldBack: Array<string> = [];
    const parts: Array<string> = [];
    let copiedUpTo: number = 0;

    for (const [start, end] of this.findPlainRuns(template)) {
      if (end - start <= LONG_TEMPLATE_RUN_LENGTH) {
        continue;
      }

      // Past the run's leading whitespace, then its first kept characters.
      let middleStart: number = start;

      while (middleStart < end && this.isWhitespace(template, middleStart)) {
        middleStart++;
      }

      middleStart = Math.min(end, middleStart + LONG_TEMPLATE_RUN_KEPT_LENGTH);

      // Before the run's trailing whitespace, then its last kept characters.
      let middleEnd: number = end;

      while (
        middleEnd > middleStart &&
        this.isWhitespace(template, middleEnd - 1)
      ) {
        middleEnd--;
      }

      middleEnd = Math.max(
        middleStart,
        middleEnd - LONG_TEMPLATE_RUN_KEPT_LENGTH,
      );

      // A middle shorter than what it keeps spares Handlebars nothing.
      if (middleEnd - middleStart <= LONG_TEMPLATE_RUN_KEPT_LENGTH) {
        continue;
      }

      parts.push(template.slice(copiedUpTo, middleStart));
      parts.push(`${prefix}${heldBack.length}${TOKEN_END}`);
      heldBack.push(template.slice(middleStart, middleEnd));
      copiedUpTo = middleEnd;
    }

    parts.push(template.slice(copiedUpTo));

    return {
      template: parts.join(""),
      prefix: prefix,
      heldBack: heldBack,
    };
  }

  /*
   * The runs of plain text in `template`, as [start, end): the text before
   * the first mustache, between two, and after the last. A mustache runs
   * from "{{" to the "}}" that closes it, past any "}}" in a quoted string
   * or a [segment]; a comment to its "}}" ("{{!--" to its "--}}"); a raw
   * block ("{{{{name}}}}") to the end of its closing "{{{{/name}}}}".
   */
  public static findPlainRuns(template: string): Array<[number, number]> {
    const runs: Array<[number, number]> = [];
    let position: number = 0;

    while (position < template.length) {
      const open: number = template.indexOf(OPEN, position);

      if (open === -1) {
        runs.push([position, template.length]);
        break;
      }

      if (open > position) {
        runs.push([position, open]);
      }

      const end: number = this.findMustacheEnd(template, open);

      if (end === -1) {
        // Handlebars refuses a mustache that does not close.
        break;
      }

      position = end;
    }

    return runs;
  }

  // Where the mustache that opens at `open` ends, or -1 when it does not.
  private static findMustacheEnd(template: string, open: number): number {
    // A raw block: "{{{{name}}}}", its text as written, "{{{{/name}}}}".
    if (template.startsWith("{{{{", open)) {
      const openTagEnd: number = template.indexOf("}}}}", open + 4);

      if (openTagEnd === -1) {
        return -1;
      }

      const closeTag: number = template.indexOf("{{{{/", openTagEnd + 4);

      if (closeTag === -1) {
        return -1;
      }

      const closeTagEnd: number = template.indexOf("}}}}", closeTag + 5);

      return closeTagEnd === -1 ? -1 : closeTagEnd + 4;
    }

    const bodyStart: number = template[open + 2] === "~" ? open + 3 : open + 2;

    // A comment that may hold "}}": "{{!--" to "--}}" or "--~}}".
    if (template.startsWith("!--", bodyStart)) {
      let search: number = bodyStart + 3;

      for (;;) {
        const close: number = template.indexOf(CLOSE, search);

        if (close === -1) {
          return -1;
        }

        const dashes: number =
          template[close - 1] === "~" ? close - 3 : close - 2;

        if (dashes >= bodyStart + 3 && template.startsWith("--", dashes)) {
          return close + 2;
        }

        search = close + 1;
      }
    }

    // A comment: "{{!" to the first "}}".
    if (template[bodyStart] === "!") {
      const close: number = template.indexOf(CLOSE, bodyStart + 1);

      return close === -1 ? -1 : close + 2;
    }

    const isTripleStash: boolean = template[bodyStart] === "{";

    // Any other: to the first "}}" outside a string or a [segment].
    let index: number = bodyStart;

    while (index < template.length) {
      const character: string = template[index]!;

      if (character === '"' || character === "'") {
        index = this.skipQuoted(template, index, character);

        if (index === -1) {
          return -1;
        }

        continue;
      }

      if (character === "[") {
        index = this.skipQuoted(template, index, "]");

        if (index === -1) {
          return -1;
        }

        continue;
      }

      if (character === "}" && template[index + 1] === "}") {
        if (isTripleStash) {
          return template[index + 2] === "}" ? index + 3 : -1;
        }

        return index + 2;
      }

      index++;
    }

    return -1;
  }

  /*
   * The index past the string (or [segment]) opening at `open`, which ends
   * at the first `closing` not escaped with a backslash; -1 when it does
   * not end.
   */
  private static skipQuoted(
    template: string,
    open: number,
    closing: string,
  ): number {
    let index: number = open + 1;

    while (index < template.length) {
      const character: string = template[index]!;

      if (character === "\\" && template[index + 1] === closing) {
        index += 2;
        continue;
      }

      if (character === closing) {
        return index + 1;
      }

      index++;
    }

    return -1;
  }

  /*
   * `rendered` with every token written back as the text it stands for. A
   * token rendered twice is written back twice; one not rendered, not at all.
   */
  private static writeBack(
    rendered: string,
    prefix: string,
    heldBack: Array<string>,
  ): string {
    const parts: Array<string> = [];
    let copiedUpTo: number = 0;
    let search: number = 0;

    for (;;) {
      const tokenStart: number = rendered.indexOf(prefix, search);

      if (tokenStart === -1) {
        break;
      }

      const indexStart: number = tokenStart + prefix.length;
      const tokenEnd: number = rendered.indexOf(TOKEN_END, indexStart);
      const index: number = Number(rendered.slice(indexStart, tokenEnd));

      if (
        tokenEnd === -1 ||
        tokenEnd === indexStart ||
        !Number.isInteger(index) ||
        heldBack[index] === undefined
      ) {
        search = indexStart;
        continue;
      }

      parts.push(rendered.slice(copiedUpTo, tokenStart));
      parts.push(heldBack[index]!);
      copiedUpTo = tokenEnd + TOKEN_END.length;
      search = copiedUpTo;
    }

    parts.push(rendered.slice(copiedUpTo));

    return parts.join("");
  }

  // A token prefix the template does not contain: random, retried until so.
  private static makeTokenPrefix(template: string): string {
    for (;;) {
      const prefix: string = `heldback${randomBytes(8).toString("hex")}n`;

      if (template.indexOf(prefix) === -1) {
        return prefix;
      }
    }
  }

  private static isWhitespace(text: string, index: number): boolean {
    return WHITESPACE_CHARACTER.test(text[index]!);
  }
}
