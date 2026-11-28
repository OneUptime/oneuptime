/*
 * A MODEL'S REASONING IS NEVER PART OF ITS ANSWER (issue #11255).
 *
 * Reasoning models (DeepSeek-R1, QwQ, Qwen3, MiniMax, GLM, Magistral and
 * more) think before they answer. A provider that knows the model sends the
 * thinking apart from the answer: in reasoning_content or reasoning, in a
 * thinking block (Anthropic, Mistral) or in Ollama's thinking field. One that
 * does not - a server started without its reasoning parser, a gateway,
 * Groq's raw reasoning format, an older Ollama - leaves the thinking in the
 * text, in the model's own tags:
 *
 *   <think>The user asks for the root cause...</think>The root cause is...
 *
 * and a model whose chat template opens the block itself (DeepSeek-R1, QwQ,
 * Qwen3's thinking models) writes only its end:
 *
 *   The user asks for the root cause...</think>The root cause is...
 *
 * OneUptime took that text as the answer, so the reasoning and a stray
 * "</think>" showed in Ask AI and were saved into postmortems. Every reply
 * of every provider is read here instead (LLMService), and the answer is
 * what the model wrote after its reasoning:
 *
 *  - a reasoning block the reply opens with is left out, up to the tag that
 *    closes it - the first one, as a reasoning model cannot write that tag
 *    inside its reasoning without ending it - with any block right after;
 *  - a block the reply opens and never closes is all reasoning: the model
 *    was cut off while it thought, or never got to its answer;
 *  - a "</think>" the reply never opened ends the reasoning its template
 *    opened, so everything before it is reasoning too.
 *
 * Only the model's own wrapper is taken. A reply that mentions a tag, says
 * the word "think" or shows the tags in code - "`</think>`", a fenced block
 * of a model's output, an indented line - is the answer as it was written:
 * a closing tag in code or after a backslash, an opening tag anywhere but
 * the very start, and a block in the middle of the answer are text. A reply
 * with no reasoning comes back exactly as it was, character for character.
 *
 * A streamed reply is read whole, once its last piece is in
 * (LLMStreamedAnswer): a tag split across two pieces is one tag, and a
 * closing tag in the last piece still makes everything before it
 * reasoning. No piece is judged on its own.
 *
 * Linear in the length of the text: every tag is found with indexOf, from
 * where the last one was, and code is found line by line.
 *
 * Pure, with no database or React imports.
 */

interface ReasoningTags {
  // The tag that opens the block, as the model writes it.
  open: string;
  close: string;
  // Whether the tags match only as written. XML-like tags match in any case.
  caseSensitive: boolean;
  /*
   * Whether a closing tag on its own ends reasoning the reply never opened:
   * only "</think>", the block a chat template opens for the model
   * (DeepSeek-R1, QwQ, Qwen3's thinking models), and the one a provider's
   * reasoning parser leaves behind when it takes the thinking out.
   */
  closesTemplateBlock: boolean;
}

/*
 * The reasoning wrappers models write, with the families they are seen in.
 * "<think>" is most of them: DeepSeek-R1 and its distills, Qwen3 and QwQ,
 * MiniMax-M2, GLM-4.5 and later, Phi-4-reasoning, and Groq's raw format.
 */
const REASONING_TAGS: ReadonlyArray<ReasoningTags> = [
  {
    open: "<think>",
    close: "</think>",
    caseSensitive: false,
    closesTemplateBlock: true,
  },
  // A model asked to think in tags first, as Claude-style prompts ask.
  {
    open: "<thinking>",
    close: "</thinking>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  {
    open: "<thought>",
    close: "</thought>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  {
    open: "<reasoning>",
    close: "</reasoning>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  {
    open: "<reason>",
    close: "</reason>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  // ByteDance's Seed-OSS.
  {
    open: "<seed:think>",
    close: "</seed:think>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  // Open-Thoughts and Sky-T1.
  {
    open: "<|begin_of_thought|>",
    close: "<|end_of_thought|>",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  // Moonshot's Kimi thinking models.
  {
    open: "◁think▷",
    close: "◁/think▷",
    caseSensitive: false,
    closesTemplateBlock: false,
  },
  /*
   * Mistral's Magistral, served without Mistral's own API. As written only:
   * "[Think](...)" opening an answer is a link.
   */
  {
    open: "[THINK]",
    close: "[/THINK]",
    caseSensitive: true,
    closesTemplateBlock: false,
  },
];

export interface ModelReasoningReading {
  // What the model answered, its reasoning left out.
  answer: string;
  /*
   * The reasoning that was left out, without its tags, or "" when there
   * was none. Never shown and never stored: it says only what was taken.
   */
  reasoning: string;
  // Whether the text held the model's reasoning wrapper, an empty one too.
  hadReasoning: boolean;
  /*
   * The text closed a reasoning block it never opened: the model's chat
   * template opened it, so the model starts its replies inside its
   * reasoning.
   */
  closedBlockItNeverOpened: boolean;
  // The text ended inside a reasoning block it opened and never closed.
  endedInsideReasoning: boolean;
}

// A part of the text that is code: [start, end) offsets.
type CodeRange = [number, number];

/*
 * A line that opens or closes a fence, read as leniently as anything that
 * shows the text reads one: three or more backticks or tildes after any
 * indentation (as UntrustedMarkdown's findFencedCode reads them).
 */
const FENCE_LINE_PATTERN: RegExp = /^[ \t]*(`{3,}|~{3,})/;

// A line indented as code: four spaces, or a tab, before anything else.
const INDENTED_CODE_LINE_PATTERN: RegExp = /^(?: {4}|[ ]{0,3}\t)/;

// White space only, as the rest of a closing fence's line must be.
const BLANK_PATTERN: RegExp = /^\s*$/;

const BACKTICK_RUN_PATTERN: RegExp = /`+/g;

// One character of white space (a line break and a byte order mark too).
const WHITE_SPACE_CHARACTER: RegExp = /\s/;

const UPPER_CASE_LETTERS_PATTERN: RegExp = /[A-Z]+/g;

/*
 * The text with its ASCII capitals in lower case, and nothing else changed:
 * every character stays where it was, so a tag found in it is found at the
 * same place in the text. (String.prototype.toLowerCase may change the
 * length of a text: "İ" becomes two characters.)
 */
const toAsciiLowerCase: (text: string) => string = (text: string): string => {
  return text.replace(UPPER_CASE_LETTERS_PATTERN, (letters: string): string => {
    return letters.toLowerCase();
  });
};

// Where the white space that starts at `from` ends.
const skipWhiteSpace: (text: string, from: number) => number = (
  text: string,
  from: number,
): number => {
  let position: number = from;

  while (
    position < text.length &&
    WHITE_SPACE_CHARACTER.test(text.charAt(position))
  ) {
    position++;
  }

  return position;
};

// Where the line that holds `offset` starts.
const lineStartOf: (text: string, offset: number) => number = (
  text: string,
  offset: number,
): number => {
  return text.lastIndexOf("\n", offset - 1) + 1;
};

/*
 * The code spans of one line, as CommonMark pairs them: a run of backticks
 * opens one that the next run of the same length on the line closes. (A
 * span that goes on to another line is not seen.)
 */
const addLineCodeSpans: (
  text: string,
  lineStart: number,
  lineEnd: number,
  ranges: Array<CodeRange>,
) => void = (
  text: string,
  lineStart: number,
  lineEnd: number,
  ranges: Array<CodeRange>,
): void => {
  const line: string = text.slice(lineStart, lineEnd);

  if (!line.includes("`")) {
    return;
  }

  const runs: Array<RegExpMatchArray> = Array.from(
    line.matchAll(BACKTICK_RUN_PATTERN),
  );

  // For each run, the next run of the same length, found from the end.
  const nextOfSameLength: Array<number> = [];
  const lastByLength: Map<number, number> = new Map<number, number>();

  for (let index: number = runs.length - 1; index >= 0; index--) {
    const length: number = runs[index]![0].length;

    nextOfSameLength[index] = lastByLength.get(length) ?? -1;
    lastByLength.set(length, index);
  }

  for (let index: number = 0; index < runs.length; ) {
    const closer: number = nextOfSameLength[index]!;

    if (closer === -1) {
      index++;
      continue;
    }

    const opener: RegExpMatchArray = runs[index]!;
    const closing: RegExpMatchArray = runs[closer]!;

    ranges.push([
      lineStart + (opener.index || 0),
      lineStart + (closing.index || 0) + closing[0].length,
    ]);

    index = closer + 1;
  }
};

/*
 * Every part of the text a reader shows as code, in order: fenced code
 * blocks (an unclosed fence runs to the end, as CommonMark has it), lines
 * indented as code, and code spans. Read leniently: a line that might be
 * code is code, so a tag shown in code is never taken for the model's.
 */
const findCode: (text: string) => Array<CodeRange> = (
  text: string,
): Array<CodeRange> => {
  const ranges: Array<CodeRange> = [];

  // The fence run that opened the block the line is in, if any.
  let openFence: string | null = null;
  let fenceStart: number = 0;
  let lineStart: number = 0;

  while (lineStart <= text.length) {
    const newLine: number = text.indexOf("\n", lineStart);
    const lineEnd: number = newLine === -1 ? text.length : newLine;
    const line: string = text.slice(lineStart, lineEnd);
    const fence: RegExpExecArray | null = FENCE_LINE_PATTERN.exec(line);

    if (openFence !== null) {
      const rest: string = fence ? line.slice(fence[0].length) : "";

      if (
        fence &&
        fence[1]!.charAt(0) === openFence.charAt(0) &&
        fence[1]!.length >= openFence.length &&
        BLANK_PATTERN.test(rest)
      ) {
        ranges.push([fenceStart, lineEnd]);
        openFence = null;
      }
    } else if (
      fence &&
      // A backtick fence's info string has no backtick in it.
      !(fence[1]!.startsWith("`") && line.slice(fence[0].length).includes("`"))
    ) {
      openFence = fence[1]!;
      fenceStart = lineStart;
    } else if (INDENTED_CODE_LINE_PATTERN.test(line)) {
      ranges.push([lineStart, lineEnd]);
    } else {
      addLineCodeSpans(text, lineStart, lineEnd, ranges);
    }

    if (newLine === -1) {
      break;
    }

    lineStart = newLine + 1;
  }

  if (openFence !== null) {
    ranges.push([fenceStart, text.length]);
  }

  return ranges;
};

// Whether the offset is inside one of the ranges, which are in order.
const isInCode: (
  ranges: ReadonlyArray<CodeRange>,
  offset: number,
) => boolean = (ranges: ReadonlyArray<CodeRange>, offset: number): boolean => {
  let low: number = 0;
  let high: number = ranges.length - 1;

  while (low <= high) {
    const middle: number = Math.floor((low + high) / 2);
    const range: CodeRange = ranges[middle]!;

    if (offset < range[0]) {
      high = middle - 1;
    } else if (offset >= range[1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
};

/*
 * The text the tags are looked for in: as written for tags that match as
 * written, with its capitals in lower case for the rest (the tags are
 * written in lower case).
 */
interface SearchTexts {
  asWritten: string;
  folded: string;
}

const searchTextFor: (tags: ReasoningTags, texts: SearchTexts) => string = (
  tags: ReasoningTags,
  texts: SearchTexts,
): string => {
  return tags.caseSensitive ? texts.asWritten : texts.folded;
};

// The wrapper whose opening tag starts the text at `position`, if any.
const openingAt: (
  texts: SearchTexts,
  position: number,
) => ReasoningTags | undefined = (
  texts: SearchTexts,
  position: number,
): ReasoningTags | undefined => {
  return REASONING_TAGS.find((tags: ReasoningTags): boolean => {
    return searchTextFor(tags, texts).startsWith(tags.open, position);
  });
};

// Whether the tag at `offset` is written after a backslash, as text.
const isEscaped: (text: string, offset: number) => boolean = (
  text: string,
  offset: number,
): boolean => {
  return offset > 0 && text.charAt(offset - 1) === "\\";
};

/*
 * Where a closing tag the text never opened is, outside code: the first
 * one outside code, if no opening tag outside code comes before it (then it
 * closes that block, written in the middle of the answer, which is text).
 * -1 when there is none.
 */
const findUnopenedClose: (
  texts: SearchTexts,
  tags: ReasoningTags,
  getCode: () => ReadonlyArray<CodeRange>,
) => number = (
  texts: SearchTexts,
  tags: ReasoningTags,
  getCode: () => ReadonlyArray<CodeRange>,
): number => {
  const searchText: string = searchTextFor(tags, texts);
  let from: number = 0;

  for (;;) {
    const closeAt: number = searchText.indexOf(tags.close, from);

    if (closeAt === -1) {
      return -1;
    }

    if (!isEscaped(texts.asWritten, closeAt) && !isInCode(getCode(), closeAt)) {
      // An opening tag outside code before it makes it a block's close.
      for (
        let openAt: number = searchText.indexOf(tags.open);
        openAt !== -1 && openAt < closeAt;
        openAt = searchText.indexOf(tags.open, openAt + tags.open.length)
      ) {
        if (
          !isEscaped(texts.asWritten, openAt) &&
          !isInCode(getCode(), openAt)
        ) {
          return -1;
        }
      }

      return closeAt;
    }

    from = closeAt + tags.close.length;
  }
};

const noReasoning: (text: string) => ModelReasoningReading = (
  text: string,
): ModelReasoningReading => {
  return {
    answer: text,
    reasoning: "",
    hadReasoning: false,
    closedBlockItNeverOpened: false,
    endedInsideReasoning: false,
  };
};

export default class ModelReasoning {
  /**
   * A model's reply, read: its answer, and the reasoning left out of it.
   * Text with no reasoning comes back as it was.
   */
  public static read(text: string | null | undefined): ModelReasoningReading {
    const source: string = typeof text === "string" ? text : "";

    if (!source) {
      return noReasoning(source);
    }

    const texts: SearchTexts = {
      asWritten: source,
      folded: toAsciiLowerCase(source),
    };

    // Found once, and only when a closing tag asks where the code is.
    let code: ReadonlyArray<CodeRange> | null = null;

    const getCode: () => ReadonlyArray<CodeRange> =
      (): ReadonlyArray<CodeRange> => {
        if (code === null) {
          code = findCode(source);
        }

        return code;
      };

    const reasoningParts: Array<string> = [];
    let closedBlockItNeverOpened: boolean = false;
    let answerStart: number = skipWhiteSpace(source, 0);
    const opensWithBlock: boolean = openingAt(texts, answerStart) !== undefined;

    /*
     * An opening tag on a line indented as code is code: a reply that starts
     * with an indented example of a model's output.
     */
    if (
      opensWithBlock &&
      INDENTED_CODE_LINE_PATTERN.test(
        source.slice(lineStartOf(source, answerStart), answerStart + 1),
      )
    ) {
      return noReasoning(source);
    }

    /*
     * A closing "</think>" the reply never opened: everything before it is
     * the reasoning the model's template opened. A reply that opens with a
     * block of its own says where its reasoning is itself.
     */
    if (!opensWithBlock) {
      let firstClose: number = -1;
      let firstCloseTags: ReasoningTags | undefined = undefined;

      for (const tags of REASONING_TAGS) {
        if (!tags.closesTemplateBlock) {
          continue;
        }

        const closeAt: number = findUnopenedClose(texts, tags, getCode);

        if (closeAt !== -1 && (firstClose === -1 || closeAt < firstClose)) {
          firstClose = closeAt;
          firstCloseTags = tags;
        }
      }

      if (!firstCloseTags) {
        return noReasoning(source);
      }

      reasoningParts.push(source.slice(0, firstClose));
      closedBlockItNeverOpened = true;
      answerStart = skipWhiteSpace(
        source,
        firstClose + firstCloseTags.close.length,
      );
    }

    /*
     * The blocks the reply opens with, one after another: each up to the
     * first tag that closes it. One that never closes holds the rest.
     */
    for (;;) {
      const tags: ReasoningTags | undefined = openingAt(texts, answerStart);

      if (!tags) {
        break;
      }

      const blockStart: number = answerStart + tags.open.length;
      const closeAt: number = searchTextFor(tags, texts).indexOf(
        tags.close,
        blockStart,
      );

      if (closeAt === -1) {
        reasoningParts.push(source.slice(blockStart));

        return {
          answer: "",
          reasoning: ModelReasoning.joinReasoning(reasoningParts),
          hadReasoning: true,
          closedBlockItNeverOpened: closedBlockItNeverOpened,
          endedInsideReasoning: true,
        };
      }

      reasoningParts.push(source.slice(blockStart, closeAt));
      answerStart = skipWhiteSpace(source, closeAt + tags.close.length);
    }

    if (reasoningParts.length === 0) {
      return noReasoning(source);
    }

    return {
      answer: source.slice(answerStart),
      reasoning: ModelReasoning.joinReasoning(reasoningParts),
      hadReasoning: true,
      closedBlockItNeverOpened: closedBlockItNeverOpened,
      endedInsideReasoning: false,
    };
  }

  // A model's reply without its reasoning (read(text).answer).
  public static removeFrom(text: string | null | undefined): string {
    return ModelReasoning.read(text).answer;
  }

  private static joinReasoning(parts: Array<string>): string {
    return parts
      .map((part: string): string => {
        return part.trim();
      })
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join("\n\n");
  }
}
