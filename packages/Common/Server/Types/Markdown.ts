import { Renderer, marked } from "marked";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import markdownSlugify from "./MarkdownSlugify";

export type MarkdownRenderer = Renderer;

export enum MarkdownContentType {
  Docs,
  Blog,
  Email,
  // Compact rendering tuned for small surfaces (e.g. the blog validation modal).
  BlogValidation,
}

/*
 * Private Use Area sentinels used by convertToPlainText. Any already in the
 * input are held back first, so every sentinel in the working text is one
 * the function put there. Always write them as \u escapes, never as raw
 * characters.
 *   PLACEHOLDER_OPEN + index + PLACEHOLDER_CLOSE  held-back literal text
 *   PARAGRAPH_BREAK     marks a blank line while emphasis is removed
 *   LITERAL_UNDERSCORE  an intraword "_" (snake_case), restored as "_"
 *   WORD_EDGE           sits between a letter/digit and an underscore run
 */
const PLACEHOLDER_OPEN: string = "\uE000";
const PLACEHOLDER_CLOSE: string = "\uE001";
const PLACEHOLDER_PATTERN: RegExp = /\uE000(\d+)\uE001/g;
const PARAGRAPH_BREAK: string = "\uE002";
const LITERAL_UNDERSCORE: string = "\uE003";
const WORD_EDGE: string = "\uE004";
const INPUT_SENTINELS: RegExp = /[\uE000-\uE004]+/g;

const FENCE_OPEN: RegExp =
  /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(?:(`{3,})[^`]*|(~{3,}).*)$/;
const FENCE_CLOSE: RegExp = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/;

const ESCAPE_OR_BACKTICK_RUN: RegExp = /\\([!-/:-@[-`{-~])|`+/g;
const BACKTICK_RUN: RegExp = /`+/g;
const NOT_ONLY_SPACES: RegExp = /[^ ]/;

// GFM autolink literals leave these trailing characters outside the URL.
const BARE_URL_TRAILING_PUNCTUATION: string = "?!.,:*_~'\"";

const HTML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

type HoldFunction = (value: string) => string;

interface BacktickRuns {
  starts: Array<number>;
  next: number;
}

export default class Markdown {
  /*
   * Markdown to plain text, for SMS, calls, push notifications, email
   * subjects and preheaders.
   *
   * THE ORDER OF THE STEPS IS THE POINT. Fenced code is dropped and code
   * spans, backslash-escaped characters and any sentinel character already
   * in the input are swapped for placeholders BEFORE any markup step runs,
   * and swapped back AFTER the last one, so no markup step can see inside
   * code or pair a marker inside it with a marker outside it: the "_" in
   * `http.status_code` must never pair with the "_" of a later _italic_
   * note, and `<pod>` inside a code span must never be stripped as a tag.
   * Autolink addresses are held back the same way before tags are stripped,
   * and bare URLs after tags, images and links are converted (so a URL in a
   * link target goes with the link) but before emphasis.
   *
   * Every regex is linear in the input. The emphasis regexes run WITHOUT the
   * u flag: a u-flag regex whose loop crosses a multi-MB two-byte string
   * overflows V8's backtrack stack (RangeError). The two Unicode-aware steps
   * (which underscores touch a letter or digit) loop over "_" alone and
   * leave marks that the emphasis steps read.
   */
  @CaptureSpan()
  public static convertToPlainText(markdown: string): string {
    if (!markdown) {
      return "";
    }

    // A caller typed `string` can still hand over a number at runtime.
    let text: string =
      typeof markdown === "string" ? markdown : String(markdown);

    /*
     * Literal text held back from the markup steps, by placeholder index. A
     * value is resolved before it is stored, so it never contains a
     * placeholder and one restore pass at the end is enough.
     */
    const held: Array<string> = [];

    const restore: (value: string) => string = (value: string): string => {
      return value.replace(
        PLACEHOLDER_PATTERN,
        (_match: string, index: string): string => {
          return held[Number(index)] ?? "";
        },
      );
    };

    const hold: HoldFunction = (value: string): string => {
      held.push(restore(value));
      return `${PLACEHOLDER_OPEN}${held.length - 1}${PLACEHOLDER_CLOSE}`;
    };

    // Normalize line endings, so "\n" is the only line break the steps see.
    text = text.replace(/\r\n?/g, "\n");

    // Hold back sentinel characters already in the input, verbatim.
    text = text.replace(INPUT_SENTINELS, hold);

    /*
     * CODE FIRST. Drop fenced code blocks, then hold back code spans and
     * escaped characters. Everything after this point sees code only as an
     * opaque placeholder.
     */
    text = Markdown.removeFencedCodeBlocks(text);
    text = Markdown.holdInlineCodeAndEscapes(text, hold);

    /*
     * Mark blank lines, so bold, strikethrough and HTML tags (which may wrap
     * onto the next line) cannot reach across a paragraph break.
     */
    text = text.replace(/\n(?=[^\S\n]*\n)/g, `\n${PARAGRAPH_BREAK}`);

    /*
     * Autolinks <https://...> and <someone@example.com> read as the address.
     * Entities are decoded now, as they are in a bare URL, because the entity
     * step below never sees held-back text ("?a=1&amp;b=2" reads "?a=1&b=2").
     */
    text = text.replace(
      /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g,
      (_match: string, uri: string): string => {
        return hold(Markdown.decodeHtmlEntities(uri));
      },
    );
    text = text.replace(
      /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+)>/g,
      (_match: string, email: string): string => {
        return hold(Markdown.decodeHtmlEntities(email));
      },
    );

    /*
     * Underscores next to letters or digits (the only Unicode-aware steps;
     * their loops are over "_" alone). A run with a letter, mark or digit on
     * both sides is intraword (snake_case, http.status_code, k8s.pod_name)
     * and is never emphasis, as in CommonMark: it becomes LITERAL_UNDERSCORE.
     * Any other run touching a letter or digit gets a WORD_EDGE on that side,
     * which tells the underscore steps below that it cannot open (letter
     * before it) or cannot close (letter after it) emphasis, so they need no
     * u flag. This runs BEFORE tags, links and emphasis are removed, so
     * flanking is judged on the source text: in "**b**_x_", "[l](u)_x_" and
     * "_x_[l](u)" the "_" touches punctuation, not the letters that end up
     * next to it.
     */
    text = text.replace(
      /(?<=[\p{L}\p{M}\p{N}])_+(?=[\p{L}\p{M}\p{N}])/gu,
      (run: string): string => {
        return LITERAL_UNDERSCORE.repeat(run.length);
      },
    );
    text = text.replace(
      /(?<=[\p{L}\p{M}\p{N}])(_+)|(?<!_)(_+)(?=[\p{L}\p{M}\p{N}])/gu,
      (
        _match: string,
        afterLetter: string | undefined,
        beforeLetter: string | undefined,
      ): string => {
        return afterLetter !== undefined
          ? WORD_EDGE + afterLetter
          : (beforeLetter ?? "") + WORD_EDGE;
      },
    );

    /*
     * Remove HTML tags: <tag ...>, </tag>, <!-- ... -->, <!DOCTYPE ...>,
     * <?...?>. Only a "<" that starts a tag counts, so "a < b and c > d"
     * survives. A tag never spans a placeholder or a blank line, so held-back
     * code ("Map<String, `k8s.pod_name`>") is never removed as part of a tag.
     * A backslash-escaped character is held back too, so it also keeps the
     * text around it from being read as a tag ("List<Foo\_Bar>" stays).
     * A comment may span both: it is hidden when rendered, code and all.
     */
    text = text.replace(/<(?:\/?[A-Za-z][^<>\uE000-\uE002]*|[!?][^<>]*)>/g, "");

    /*
     * Convert markdown images ![alt](url) to just alt text. Before links, or
     * the link step would leave the "!" behind.
     */
    text = text.replace(
      /!\[([^[\]]*)\]\((?!\))[^()]*(?:\([^()]*\)[^()]*)?\)/g,
      "$1",
    );

    /*
     * Convert markdown links [text](url) to just text. The URL may contain
     * one pair of parentheses, e.g. https://en.wikipedia.org/wiki/Foo_(bar).
     */
    text = text.replace(
      /\[([^[\]]+)\]\((?!\))[^()]*(?:\([^()]*\)[^()]*)?\)/g,
      "$1",
    );

    /*
     * Bare http(s) URLs are held back (GFM autolink literals), so emphasis
     * cannot eat a "_" or "*" inside one ("/d/_abc_/cpu_usage"). After tags
     * and links, so a URL in a tag attribute or a link target goes with it.
     */
    text = text.replace(/\bhttps?:\/\/[^\s<>]+/g, (url: string): string => {
      return Markdown.holdBareUrl(url, hold);
    });

    /*
     * Remove markdown bold/italic markers. An opening marker must be
     * followed by a non-space and a closing marker preceded by one, so
     * "5 * 3 * 2" and "* bullet" are not emphasis. Single markers (* and _)
     * never pair across a line break; double markers may wrap onto the next
     * line but never cross a blank line. An underscore run with a letter or
     * digit on its outer side (a WORD_EDGE there) cannot open or close. Bold
     * runs again after italic to unwrap "**a *b* c**"; italic runs after
     * bold to unwrap "***a***".
     */
    const boldStars: RegExp = /\*\*(?![\s*])([^*\uE002]*[^\s*\uE002])\*\*/g;
    const italicStar: RegExp = /\*(?![\s*])([^*\n]*[^\s*])\*/g;
    const boldUnderscores: RegExp =
      /(?<!\uE004)__(?![\s_])([^_\uE002]*[^\s_\uE002])__(?!\uE004)/g;
    const italicUnderscore: RegExp =
      /(?<![_\uE004])_(?![\s_])([^_\n]*[^\s_])_(?![_\uE004])/g;

    text = text.replace(boldStars, "$1"); // **bold**
    text = text.replace(italicStar, "$1"); // *italic*
    text = text.replace(boldStars, "$1"); // **bold *italic* bold**
    text = text.replace(boldUnderscores, "$1"); // __bold__
    text = text.replace(italicUnderscore, "$1"); // _italic_
    text = text.replace(boldUnderscores, "$1"); // __bold _italic_ bold__

    // Remove markdown strikethrough
    text = text.replace(/~~(?![\s~])([^~\uE002]*[^\s~\uE002])~~/g, "$1");

    // Drop the blank-line and word-edge marks again.
    text = text.split(PARAGRAPH_BREAK).join("");
    text = text.split(WORD_EDGE).join("");

    // Remove markdown headers
    text = text.replace(/^#{1,6}\s+/gm, "");

    // Remove markdown blockquotes
    text = text.replace(/^>\s+/gm, "");

    // Remove markdown horizontal rules: "---", "***", "___", "* * *", "- - -"
    text = text.replace(
      /^(?=[ \t]*[-*_][ \t]*[-*_][ \t]*[-*_])[-*_ \t]*$/gm,
      "",
    );

    // Remove markdown list markers
    text = text.replace(/^[^\S\n]*[-*+]\s+/gm, "");
    text = text.replace(/^[^\S\n]*\d+\.\s+/gm, "");

    /*
     * Decode HTML entities. Code is still a placeholder here, so entities
     * inside code stay literal ("`a &amp;&amp; b`" shows as written).
     */
    text = Markdown.decodeHtmlEntities(text);

    /*
     * Put the held-back text back. This must run after every markup step and
     * the entity step (so code stays literal) and before the whitespace
     * steps (so whitespace inside code collapses like the rest of the text).
     * Intraword underscores first: a held-back input sentinel may itself be
     * a U+E003 and must come back as one.
     */
    text = text.split(LITERAL_UNDERSCORE).join("_");
    text = restore(text);

    // Normalize whitespace - collapse multiple spaces/newlines
    text = text.replace(/\n\s*\n/g, "\n");
    text = text.replace(/[ \t]+/g, " ");

    // Trim whitespace
    text = text.trim();

    return text;
  }

  /*
   * Fenced code blocks are dropped, but only real ones: a line that opens
   * with three or more backticks or tildes (after optional indentation, ">"
   * quote markers and list markers such as "- " or "1. "; a backtick fence's
   * info string holds no backtick), through the next line holding only a
   * fence of the same character at least as long. A fence that is never
   * closed stays as ordinary text instead of swallowing the rest of the
   * message, and "Run ```npm install``` first" is a code span, not a fence.
   * The list markers matter: without them the indented closer of
   * "1. ```bash" would open a block of its own and swallow the list items
   * up to the next fence.
   *
   * The block becomes one empty line, so the text on either side stays two
   * paragraphs and no emphasis pairs across it.
   *
   * Linear: the longest closing fence at or after each line is computed
   * once, from the end, so an unclosed opener is recognised without
   * rescanning.
   */
  private static removeFencedCodeBlocks(text: string): string {
    if (text.indexOf("```") === -1 && text.indexOf("~~~") === -1) {
      return text;
    }

    const lines: Array<string> = text.split("\n");

    // The fence (e.g. "```") a line closes with, or "" when it is no closer.
    const closingFences: Array<string> = lines.map((line: string): string => {
      return FENCE_CLOSE.exec(line)?.[1] ?? "";
    });

    const longestBacktickCloseFrom: Array<number> = new Array<number>(
      lines.length + 1,
    ).fill(0);
    const longestTildeCloseFrom: Array<number> = new Array<number>(
      lines.length + 1,
    ).fill(0);

    for (let i: number = lines.length - 1; i >= 0; i--) {
      const fence: string = closingFences[i] ?? "";
      const backtickAfter: number = longestBacktickCloseFrom[i + 1] ?? 0;
      const tildeAfter: number = longestTildeCloseFrom[i + 1] ?? 0;

      longestBacktickCloseFrom[i] = fence.startsWith("`")
        ? Math.max(backtickAfter, fence.length)
        : backtickAfter;
      longestTildeCloseFrom[i] = fence.startsWith("~")
        ? Math.max(tildeAfter, fence.length)
        : tildeAfter;
    }

    const kept: Array<string> = [];
    let i: number = 0;

    while (i < lines.length) {
      const line: string = lines[i] ?? "";
      const open: RegExpExecArray | null = FENCE_OPEN.exec(line);
      const fence: string = open ? open[1] ?? open[2] ?? "" : "";
      const longestCloseAfter: number = fence.startsWith("`")
        ? longestBacktickCloseFrom[i + 1] ?? 0
        : longestTildeCloseFrom[i + 1] ?? 0;

      if (fence && longestCloseAfter >= fence.length) {
        let end: number = i + 1;

        while (
          !(
            (closingFences[end] ?? "").startsWith(fence[0] ?? "") &&
            (closingFences[end] ?? "").length >= fence.length
          )
        ) {
          end++;
        }

        kept.push("");
        i = end + 1;
        continue;
      }

      kept.push(line);
      i++;
    }

    return kept.join("\n");
  }

  /*
   * Inline code spans and backslash escapes, in one left-to-right pass
   * because each decides what the other means: "\`" is a literal backtick,
   * not the start of a span, while a backslash inside a span is literal.
   *
   * A span opens with a run of N backticks and closes at the next run of
   * exactly N backticks ON THE SAME LINE, so ``a`b`` is "a`b" and a stray
   * backtick in one table row or list item can never pair with a code span
   * on the next. A run with no closer on its line stays as literal backticks.
   *
   * When N >= 2, one leading and one trailing space are stripped when both
   * are present (CommonMark), which is how AffectedResourceList.code() pads
   * a name that contains a backtick ("`` web`01 ``"). A single-backtick
   * span keeps its content unchanged, so two stray backticks that happen to
   * pair ("Don't paste ` here. It's `broken") never glue words together.
   *
   * A backslash before ASCII punctuation is dropped and the character is
   * held back, so "\*" is a literal "*".
   *
   * Linear: every backtick run is indexed by length up front and each
   * length's cursor only moves forward, so a run that never closes is not
   * rescanned.
   */
  private static holdInlineCodeAndEscapes(
    text: string,
    hold: HoldFunction,
  ): string {
    if (text.indexOf("`") === -1 && text.indexOf("\\") === -1) {
      return text;
    }

    const runsByLength: Map<number, BacktickRuns> = new Map();
    const runPattern: RegExp = new RegExp(BACKTICK_RUN.source, "g");
    let run: RegExpExecArray | null = runPattern.exec(text);

    while (run !== null) {
      let runs: BacktickRuns | undefined = runsByLength.get(run[0].length);

      if (!runs) {
        runs = { starts: [], next: 0 };
        runsByLength.set(run[0].length, runs);
      }

      runs.starts.push(run.index);
      run = runPattern.exec(text);
    }

    const tokenPattern: RegExp = new RegExp(ESCAPE_OR_BACKTICK_RUN.source, "g");
    let result: string = "";
    let copiedUpTo: number = 0;
    let lineEnd: number = -1;
    let token: RegExpExecArray | null = tokenPattern.exec(text);

    for (; token !== null; token = tokenPattern.exec(text)) {
      const escaped: string | undefined = token[1];

      if (escaped !== undefined) {
        result += text.slice(copiedUpTo, token.index) + hold(escaped);
        copiedUpTo = tokenPattern.lastIndex;
        continue;
      }

      const fenceLength: number = token[0].length;
      const openEnd: number = tokenPattern.lastIndex;

      if (lineEnd < token.index) {
        lineEnd = text.indexOf("\n", token.index);

        if (lineEnd === -1) {
          lineEnd = text.length;
        }
      }

      /*
       * After an escaped backtick the opener is the rest of a longer run,
       * and may have no same-length run anywhere.
       */
      const runs: BacktickRuns | undefined = runsByLength.get(fenceLength);

      if (!runs) {
        continue;
      }

      while ((runs.starts[runs.next] ?? Infinity) < openEnd) {
        runs.next++;
      }

      const closeStart: number | undefined = runs.starts[runs.next];

      if (closeStart === undefined || closeStart > lineEnd) {
        continue;
      }

      let code: string = text.slice(openEnd, closeStart);

      if (
        fenceLength >= 2 &&
        code.startsWith(" ") &&
        code.endsWith(" ") &&
        NOT_ONLY_SPACES.test(code)
      ) {
        code = code.slice(1, -1);
      }

      result += text.slice(copiedUpTo, token.index) + hold(code);
      copiedUpTo = closeStart + fenceLength;
      tokenPattern.lastIndex = copiedUpTo;
    }

    return result + text.slice(copiedUpTo);
  }

  /*
   * Hold back a bare URL found by /\bhttps?:\/\/[^\s<>]+/. As in GFM,
   * trailing punctuation (".", ",", "*", "_", ...) and an unbalanced ")"
   * stay outside the URL, so "_see https://x.example/a_" still loses its
   * emphasis markers. Entities in the URL are decoded now, as they would
   * have been in the text ("?a=1&amp;b=2" reads "?a=1&b=2").
   *
   * Linear: parentheses are counted once and the trim only moves backwards.
   */
  private static holdBareUrl(url: string, hold: HoldFunction): string {
    const opens: number = url.split("(").length - 1;
    let closes: number = url.split(")").length - 1;
    let end: number = url.length;

    while (end > 0) {
      const last: string = url[end - 1] ?? "";

      /*
       * A WORD_EDGE only ends up last once the "_" after it was trimmed; it
       * leaves with that "_", so the "_" keeps its flanking.
       */
      if (BARE_URL_TRAILING_PUNCTUATION.includes(last) || last === WORD_EDGE) {
        end--;
        continue;
      }

      if (last === ")" && closes > opens) {
        closes--;
        end--;
        continue;
      }

      break;
    }

    // The URL's underscores were marked like any other text: unmark them.
    const address: string = url
      .slice(0, end)
      .split(WORD_EDGE)
      .join("")
      .split(LITERAL_UNDERSCORE)
      .join("_");

    return hold(Markdown.decodeHtmlEntities(address)) + url.slice(end);
  }

  /*
   * Decode &lt; &gt; &amp; &quot; &#39; and &nbsp;, in one pass, so
   * "&amp;quot;" becomes "&quot;" instead of being decoded twice.
   */
  private static decodeHtmlEntities(text: string): string {
    return text.replace(
      /&(lt|gt|amp|quot|#39|nbsp);/g,
      (match: string, name: string): string => {
        return HTML_ENTITIES[name] ?? match;
      },
    );
  }

  private static blogRenderer: Renderer | null = null;
  private static docsRenderer: Renderer | null = null;
  private static emailRenderer: Renderer | null = null;
  private static blogValidationRenderer: Renderer | null = null;

  @CaptureSpan()
  public static async convertToHTML(
    markdown: string,
    contentType: MarkdownContentType,
  ): Promise<string> {
    let renderer: Renderer | null = null;

    if (contentType === MarkdownContentType.Blog) {
      renderer = this.getBlogRenderer();
    }

    if (contentType === MarkdownContentType.Docs) {
      renderer = this.getDocsRenderer();
    }

    if (contentType === MarkdownContentType.Email) {
      renderer = this.getEmailRenderer();
    }

    if (contentType === MarkdownContentType.BlogValidation) {
      renderer = this.getBlogValidationRenderer();
    }

    /*
     * Escape raw HTML tokens in the markdown source to prevent XSS.
     * This only affects raw HTML that users type directly (e.g. <img onerror=...>),
     * not HTML generated by the renderer methods (headings, paragraphs, etc.).
     */
    if (renderer) {
      renderer.html = (html: string): string => {
        return Markdown.escapeHtml(html);
      };
    }

    const htmlBody: string = await marked(markdown, {
      renderer: renderer,
    });

    return htmlBody;
  }

  /**
   * Escape the five characters that can break out of HTML text or an
   * attribute value.
   *
   * Public because it is not only marked's business: code that hand-builds
   * an email fragment by string interpolation needs the same escaping, and
   * a second implementation is a second thing to get wrong.
   */
  public static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /*
   * The email renderer.
   *
   * Everything here is an INLINE style, and that is not a preference.
   * MailService compiles the Handlebars template and sends it — there is no
   * CSS inlining step anywhere in the pipeline — and Gmail strips <style>
   * blocks from the document head, so a class name emitted here reaches the
   * reader as nothing at all. That is why the Docs/Blog renderers' Tailwind
   * classes cannot be copied even though the override shape can.
   *
   * Until this existed the renderer was a bare `new Renderer()`. Alert and
   * incident root causes carry a GitHub-flavoured table of breaching
   * samples, and marked emitted it as a naked <table> with no borders, no
   * padding and no alignment: every row ran into the next, which is
   * precisely the part of the email an on-call engineer reads first.
   *
   * Outlook renders through Word, which ignores border-radius, box-shadow
   * and — importantly — overflow, so the scrolling wrapper the Docs and
   * Blog renderers use does not transfer. The table has to FIT instead:
   * the DetailBox card is 472px wide with 28px of padding either side,
   * leaving roughly 416px for a root-cause table that routinely runs to
   * four or more columns. Hence `width:100%` with `table-layout:auto` and
   * `word-break:break-word` on the cells — a long metric name wraps inside
   * its column rather than pushing the table past the body width.
   */
  private static getEmailRenderer(): Renderer {
    if (this.emailRenderer !== null) {
      return this.emailRenderer;
    }

    const renderer: Renderer = new Renderer();

    const cellFont: string =
      "font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;font-size:13px;line-height:20px;";

    renderer.table = function (header: string, body: string): string {
      return (
        `<table cellpadding="0" cellspacing="0" border="0" width="100%" ` +
        `style="border-collapse:collapse;width:100%;table-layout:auto;` +
        `margin:12px 0;border:1px solid #e2e8f0;">` +
        `<thead>${header}</thead><tbody>${body}</tbody></table>`
      );
    };

    renderer.tablerow = function (content: string): string {
      return `<tr>${content}</tr>`;
    };

    renderer.tablecell = function (
      content: string,
      flags: { header?: boolean; align?: string | null },
    ): string {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? `text-align:${flags.align};` : "";

      /*
       * A header cell gets the tinted band and the heavier bottom rule; a
       * body cell gets a hairline so consecutive rows stay separable. Both
       * keep the same padding so the columns line up.
       */
      const tone: string = flags.header
        ? "background-color:#f8fafc;color:#475569;font-weight:600;border-bottom:1px solid #cbd5e1;"
        : "color:#1e293b;font-weight:400;border-bottom:1px solid #f1f5f9;";

      return (
        `<${tag} style="padding:8px 10px;${cellFont}${tone}` +
        `word-break:break-word;${align || "text-align:left;"}">` +
        `${content}</${tag}>`
      );
    };

    /*
     * Lists. A platform monitor's root cause lists its affected resources
     * as a numbered list with a bullet list of details nested under each
     * item, and the cluster and metric details above it are bullets too.
     *
     * Left to the client, Gmail and Apple Mail indent every list level by
     * 40px — close to a tenth of the card, twice over for a nested list —
     * and Outlook's Word engine ignores padding on <ul>/<ol> and picks its
     * own margins. So the indent is a margin-left, which Outlook honours,
     * with padding zeroed: 24px holds a bullet, and 32px holds a numbered
     * marker up to three digits ("100."). The vertical margins give each
     * item's nested details a little air above and a gap below that
     * separates it from the next item.
     *
     * margin-left is a physical side, so it is followed by the logical
     * margin-inline-start / -end: a client that understands them moves
     * the indent to the marker side in right-to-left text, and one that
     * does not keeps the margin-left.
     */
    renderer.list = function (
      body: string,
      ordered: boolean,
      start: number | "",
    ): string {
      const tag: string = ordered ? "ol" : "ul";
      const startAttribute: string =
        ordered && start !== "" && start !== 1 ? ` start="${start}"` : "";
      const indent: string = ordered ? "32px" : "24px";

      return (
        `<${tag}${startAttribute} style="margin:6px 0 12px 0;` +
        `margin-left:${indent};margin-inline-start:${indent};` +
        `margin-inline-end:0;padding:0;">` +
        `${body}</${tag}>`
      );
    };

    renderer.listitem = function (text: string): string {
      return `<li style="margin:0 0 4px;padding:0;">${text}</li>`;
    };

    /*
     * The root cause backticks metric names, aliases and timestamps. Left
     * bare they were indistinguishable from the prose around them.
     *
     * `code` arrives ALREADY escaped — marked escapes codespan text before
     * it reaches the renderer — so escaping again here would turn a typed
     * "<img>" into the literal "&lt;img&gt;" on screen rather than the
     * "<img>" the author wrote. (The Docs and BlogValidation renderers do
     * escape a second time; that is a separate defect in those surfaces,
     * not a pattern to copy.)
     */
    renderer.codespan = function (code: string): string {
      return (
        `<code style="background-color:#f1f5f9;color:#0f172a;` +
        `padding:1px 5px;border-radius:4px;` +
        `font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;` +
        `font-size:12px;">${code}</code>`
      );
    };

    this.emailRenderer = renderer;

    return renderer;
  }

  /*
   * Compact renderer for small surfaces like the blog validation modal. Smaller,
   * quieter headings (no oversized doc titles, no permalink anchors), tight
   * paragraph/list rhythm, and subtle code styling so a long report stays
   * readable in a constrained, scrollable panel.
   */
  private static getBlogValidationRenderer(): Renderer {
    if (this.blogValidationRenderer !== null) {
      return this.blogValidationRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.heading = function (text, level) {
      if (level <= 2) {
        return `<h3 class="mt-7 mb-3 pt-6 border-t border-gray-100 first:mt-0 first:pt-0 first:border-t-0 text-[0.7rem] font-semibold uppercase tracking-wider text-emerald-700">${text}</h3>`;
      }
      if (level === 3) {
        return `<h4 class="mt-5 mb-1.5 text-sm font-semibold text-gray-900">${text}</h4>`;
      }
      return `<h5 class="mt-4 mb-1 text-sm font-semibold text-gray-700">${text}</h5>`;
    };

    renderer.paragraph = function (text) {
      return `<p class="my-2.5 text-sm leading-relaxed text-gray-600">${text}</p>`;
    };

    renderer.list = function (body, ordered, start) {
      const tag: string = ordered ? "ol" : "ul";
      const cls: string = ordered
        ? "list-decimal pl-5 my-2 space-y-1.5 text-sm text-gray-600 marker:text-gray-400"
        : "list-disc pl-5 my-2 space-y-1.5 text-sm text-gray-600 marker:text-gray-300";
      const startAttr: string =
        ordered && start !== 1 ? ` start="${start}"` : "";
      return `<${tag}${startAttr} class="${cls}">${body}</${tag}>`;
    };
    renderer.listitem = function (text) {
      return `<li class="leading-relaxed pl-1">${text}</li>`;
    };

    renderer.strong = function (text) {
      return `<strong class="font-semibold text-gray-800">${text}</strong>`;
    };
    renderer.em = function (text) {
      return `<em class="italic">${text}</em>`;
    };

    renderer.blockquote = function (quote) {
      return `<blockquote class="my-3 border-s-2 border-emerald-200 ps-3 text-sm text-gray-600">${quote}</blockquote>`;
    };

    renderer.hr = function () {
      return '<hr class="my-5 border-t border-gray-100" />';
    };

    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded bg-gray-100 px-1.5 py-0.5 text-[0.8125rem] text-gray-700 font-mono break-words">${escaped}</code>`;
    };

    renderer.code = function (code, language) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre class="my-3 overflow-x-auto rounded-lg bg-gray-50 border border-gray-100 p-3 text-xs leading-relaxed"><code class="language-${language} font-mono text-gray-700">${escaped}</code></pre>`;
    };

    renderer.table = function (header, body) {
      return `<div class="my-4 overflow-x-auto rounded-lg border border-gray-100"><table class="min-w-full text-sm text-left">${header}${body}</table></div>`;
    };
    renderer.tablerow = function (content) {
      return `<tr class="border-b border-gray-100 last:border-b-0">${content}</tr>`;
    };
    renderer.tablecell = function (content, flags) {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const headerClass: string = flags.header
        ? " font-semibold text-gray-900 bg-gray-50"
        : " text-gray-600";
      return `<${tag} class="px-3 py-2${align}${headerClass}">${content}</${tag}>`;
    };

    renderer.link = function (href, _title, text) {
      if (!href) {
        return text as string;
      }
      const isExternal: boolean = href.startsWith("http");
      const rel: string = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${href}"${rel} class="text-emerald-700 font-medium underline decoration-emerald-200 underline-offset-2 hover:decoration-emerald-400 break-words">${text}</a>`;
    };

    this.blogValidationRenderer = renderer;

    return renderer;
  }

  /*
   * Heading text -> the `id` used for in-page anchors. The rules live in
   * MarkdownSlugify.ts, a dependency-free module, so the docs anchor scripts
   * (Scripts/Docs/CheckAnchors.ts, FixAnchors.ts) can share them without
   * pulling in marked or the telemetry stack — see the comment there.
   */
  public static slugify(text: string): string {
    return markdownSlugify(text);
  }

  /*
   * Human-readable names for the languages a docs code fence can declare.
   * Rendered into the code block's header bar. A fence with no language, or
   * one that is not listed here, gets no label rather than a guess — the
   * label used to come from highlight.js auto-detection, which cheerfully
   * announced shell snippets as "PHP".
   */
  private static readonly codeLanguageNames: Record<string, string> = {
    apache: "Apache",
    bash: "Bash",
    c: "C",
    cpp: "C++",
    csharp: "C#",
    css: "CSS",
    diff: "Diff",
    dns: "DNS Zone",
    docker: "Dockerfile",
    dockerfile: "Dockerfile",
    go: "Go",
    graphql: "GraphQL",
    groovy: "Groovy",
    hcl: "HCL",
    html: "HTML",
    http: "HTTP",
    ini: "INI",
    java: "Java",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    kotlin: "Kotlin",
    lua: "Lua",
    makefile: "Makefile",
    markdown: "Markdown",
    md: "Markdown",
    nginx: "Nginx",
    perl: "Perl",
    php: "PHP",
    powershell: "PowerShell",
    proto: "Protobuf",
    py: "Python",
    python: "Python",
    r: "R",
    rb: "Ruby",
    ruby: "Ruby",
    rust: "Rust",
    scala: "Scala",
    sh: "Shell",
    shell: "Shell",
    sql: "SQL",
    swift: "Swift",
    terraform: "Terraform",
    toml: "TOML",
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
    zsh: "Shell",
  };

  private static getDocsRenderer(): Renderer {
    if (this.docsRenderer !== null) {
      return this.docsRenderer;
    }

    const renderer: Renderer = new Renderer();

    /*
     * The docs renderer emits semantic markup with a small set of stable class
     * names and leaves every colour, size and spacing decision to
     * Docs/Static/css/style.css. Utility classes used to be baked in here,
     * which meant the same element was styled from two places at once and made
     * a dark theme impossible without editing this file.
     */

    renderer.paragraph = function (text) {
      return `<p>${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      const calloutMatch: RegExpMatchArray | null = quote.match(
        /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution):?<\/strong>/i,
      );

      if (calloutMatch) {
        const type: string = calloutMatch[1]!.toLowerCase();
        const configMap: Record<string, { icon: string; label: string }> = {
          note: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
            label: "Note",
          },
          info: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
            label: "Info",
          },
          tip: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>`,
            label: "Tip",
          },
          warning: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>`,
            label: "Warning",
          },
          caution: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>`,
            label: "Caution",
          },
          danger: {
            icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
            label: "Danger",
          },
        };

        const config: { icon: string; label: string } =
          configMap[type] || configMap["note"]!;

        const content: string = quote.replace(
          /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution):?<\/strong>\s*/i,
          "<p>",
        );

        return `<div class="docs-callout docs-callout--${type}">
          <div class="docs-callout__head">
            <svg class="docs-callout__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${config.icon}</svg>
            <span class="docs-callout__label">${config.label}</span>
          </div>
          <div class="docs-callout__body">${content}</div>
        </div>`;
      }

      return `<blockquote class="docs-quote">${quote}</blockquote>`;
    };

    renderer.image = function (href, title, text) {
      const titleAttr: string = title
        ? ` title="${Markdown.escapeHtml(title)}"`
        : "";
      return `<img src="${href}" alt="${text || ""}"${titleAttr} class="docs-image" loading="lazy" decoding="async" />`;
    };

    renderer.link = function (href, title, text) {
      if (!href) {
        return text as string;
      }

      const target: string = href.toLowerCase();
      const isExternal: boolean =
        (target.startsWith("http://") || target.startsWith("https://")) &&
        !target.includes("oneuptime.com");
      const titleAttr: string = title
        ? ` title="${Markdown.escapeHtml(title)}"`
        : "";
      const externalAttrs: string = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      const marker: string = isExternal
        ? '<svg class="docs-link__external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>'
        : "";

      return `<a class="docs-link" href="${href}"${titleAttr}${externalAttrs}>${text}${marker}</a>`;
    };

    renderer.code = function (code, language) {
      const lang: string = (language || "").trim().toLowerCase();

      if (lang === "mermaid") {
        /*
         * Mermaid reads the diagram from textContent, so escaping here keeps
         * the diagram identical while making sure a `<` in a node label can
         * never be parsed as markup.
         */
        return `<div class="docs-diagram"><div class="mermaid">${Markdown.escapeHtml(code)}</div></div>`;
      }

      const escaped: string = Markdown.escapeHtml(code);
      const label: string | undefined = Markdown.codeLanguageNames[lang];
      /*
       * `nohighlight` stops highlight.js auto-detecting a language for fences
       * that never declared one — plain text is honest, a wrong grammar is not.
       */
      const codeClass: string = lang ? `language-${lang}` : "nohighlight";
      /*
       * The copy button ships hidden and the page's script unhides it once it
       * has wired up the click handler and filled in the translated label —
       * without scripting it would be a dead control with an English name.
       * The bar reserves its height either way, so nothing shifts.
       */
      const bar: string = `<div class="docs-code__bar">
          <span class="docs-code__lang">${label || ""}</span>
          <button type="button" class="docs-code__copy" data-copy-code hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <span class="docs-code__copy-text"></span>
          </button>
        </div>`;

      return `<div class="docs-code"${lang ? ` data-language="${lang}"` : ""}>${bar}<pre><code class="${codeClass}">${escaped}</code></pre></div>`;
    };

    renderer.heading = function (text, level) {
      const slug: string = Markdown.slugify(text);
      const anchor: string =
        level >= 2 && level <= 4
          ? `<a class="docs-anchor" href="#${slug}" aria-hidden="true" tabindex="-1">#</a>`
          : "";

      const safeLevel: number = Math.min(Math.max(level, 1), 6);

      return `<h${safeLevel} id="${slug}" class="docs-heading docs-h${safeLevel}"><span class="docs-heading__text">${text}</span>${anchor}</h${safeLevel}>`;
    };

    renderer.hr = function () {
      return '<hr class="docs-hr" />';
    };

    renderer.table = function (header, body) {
      return `<div class="docs-table-wrapper" tabindex="0"><table class="docs-table">${header}${body}</table></div>`;
    };

    renderer.tablerow = function (content) {
      return `<tr>${content}</tr>`;
    };

    renderer.tablecell = function (content, flags) {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align
        ? ` style="text-align:${flags.align}"`
        : "";
      return `<${tag}${align}>${content}</${tag}>`;
    };

    // Inline code
    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="docs-code-inline">${escaped}</code>`;
    };

    this.docsRenderer = renderer;

    return renderer;
  }

  private static getBlogRenderer(): Renderer {
    if (this.blogRenderer !== null) {
      return this.blogRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.paragraph = function (text) {
      return `<p class="mt-5 mb-2 leading-8 text-gray-600 text-lg">${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
    };

    renderer.code = function (code, language) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre class="language-${language} rounded-md"><code class="language-${language} rounded-md">${escaped}</code></pre>`;
    };

    renderer.heading = function (text, level) {
      if (level === 1) {
        return `<h1 class="my-5 mt-8 text-4xl font-bold tracking-tight text-gray-800">${text}</h1>`;
      } else if (level === 2) {
        return `<h2 class="my-5  mt-8 text-3xl font-bold tracking-tight text-gray-800">${text}</h2>`;
      } else if (level === 3) {
        return `<h3 class="my-5  mt-8 text-2xl font-bold tracking-tight text-gray-800">${text}</h3>`;
      } else if (level === 4) {
        return `<h4 class="my-5  mt-8 text-xl font-bold tracking-tight text-gray-800">${text}</h4>`;
      } else if (level === 5) {
        return `<h5 class="my-5  mt-8 text-lg font-bold tracking-tight text-gray-800">${text}</h5>`;
      }
      return `<h6 class="my-5 tracking-tight font-bold text-gray-800">${text}</h6>`;
    };

    // Lists
    renderer.list = function (body, ordered, start) {
      const tag: string = ordered ? "ol" : "ul";
      const cls: string = ordered
        ? "list-decimal pl-6 my-6 space-y-2 text-gray-700"
        : "list-disc pl-6 my-6 space-y-2 text-gray-700";
      const startAttr: string =
        ordered && start !== 1 ? ` start="${start}"` : "";
      return `<${tag}${startAttr} class="${cls}">${body}</${tag}>`;
    };
    renderer.listitem = function (text) {
      return `<li class="leading-7">${text}</li>`;
    };

    // Tables
    renderer.table = function (header, body) {
      return `<div class="overflow-x-auto my-8"><table class="min-w-full border border-gray-200 text-sm text-left">
        ${header}${body}
      </table></div>`;
    };
    renderer.tablerow = function (content) {
      return `<tr class="border-b last:border-b-0">${content}</tr>`;
    };
    renderer.tablecell = function (content, flags) {
      const type: string = flags.header ? "th" : "td";
      const base: string = "px-4 py-2 border-r last:border-r-0 border-gray-200";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const weight: string = flags.header ? " font-semibold bg-gray-50" : "";
      return `<${type} class="${base}${align}${weight}">${content}</${type}>`;
    };

    // Inline code
    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded-md bg-gray-100 px-1.5 py-0.5 text-sm text-pink-600">${escaped}</code>`;
    };

    // Horizontal rule
    renderer.hr = function () {
      return '<hr class="my-12 border-t border-gray-200" />';
    };

    // Emphasis / Strong / Strikethrough
    renderer.strong = function (text) {
      return `<strong class="font-semibold text-gray-800">${text}</strong>`;
    };
    renderer.em = function (text) {
      return `<em class="italic text-gray-700">${text}</em>`;
    };
    renderer.del = function (text) {
      return `<del class="line-through text-gray-400">${text}</del>`;
    };

    // Images
    renderer.image = function (href, _title, text) {
      return `<figure class="my-8"><img src="${href}" alt="${text}" class="rounded-xl shadow-sm border border-gray-200" loading="lazy"/><figcaption class="mt-2 text-center text-sm text-gray-500">${text || ""}</figcaption></figure>`;
    };

    /*
     * Links
     * We explicitly add underline + color classes because Tailwind Typography (prose-*)
     * styles may get overridden by surrounding utility classes or global resets.
     * External links open in a new tab with proper rel attributes; internal links stay in-page.
     */
    renderer.link = function (href, title, text) {
      // Guard: if no href, just return the text.
      if (!href) {
        return text as string;
      }

      const isHash: boolean = href.startsWith("#");
      const isMailTo: boolean = href.startsWith("mailto:");
      const isTel: boolean = href.startsWith("tel:");
      const isInternal: boolean =
        href.startsWith("/") ||
        href.includes("oneuptime.com") ||
        isHash ||
        isMailTo ||
        isTel;

      const baseClasses: string = [
        "font-semibold",
        "text-indigo-600",
        "underline",
        "underline-offset-2",
        "decoration-indigo-300",
        "hover:decoration-indigo-500",
        "hover:text-indigo-500",
        "transition-colors",
      ].join(" ");

      const titleAttr: string = title ? ` title="${title}"` : "";
      const externalAttrs: string = isInternal
        ? ""
        : ' target="_blank" rel="noopener noreferrer"';

      return `<a href="${href}"${titleAttr} class="${baseClasses}"${externalAttrs}>${text}</a>`;
    };

    this.blogRenderer = renderer;

    return renderer;
  }
}
