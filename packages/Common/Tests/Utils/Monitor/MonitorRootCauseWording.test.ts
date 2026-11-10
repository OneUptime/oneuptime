import {
  EvaluationSentence,
  englishOfEvaluationSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import { createTranslator, Translator } from "../../../Types/Translator";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording, {
  RootCauseFinding,
} from "../../../Utils/Monitor/MonitorRootCauseWording";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A WORDED ROOT CAUSE PLACES AS TEXT, AND WHAT IT KEEPS AS WRITTEN.
 *
 * MonitorRootCauseWording rewrites the lines of a stored root cause that are
 * OneUptime's own - a bold label, a fact's label, OneUptime's yes or no, a
 * finding the reader's language words - and leaves every other line, and
 * the rest of a rewritten line, as it was stored. It writes the lines it
 * rewrites with mdText (FeedAndChatPlainTextEscapedGuard), so:
 *
 * - its own words (a label, yes or no, a worded finding) are placed as
 *   text: a locale whose wording holds Markdown cannot add a link or
 *   emphasis;
 * - what the root cause stored after a label is Markdown already, written
 *   by the engine, and is placed as it is - escaped once, not twice;
 * - a finding is recognised by writing its English as the engine wrote it,
 *   so a finding the engine escaped ("1\\. first") is still found.
 */

const WORDS: Record<string, string> = {
  "Filter Conditions Met": "满足的筛选条件",
  "All filters met.": "所有筛选条件均已满足。",
  "Criteria Name": "条件名称",
  "Request Details": "请求详情",
  "Request Method": "请求方法",
  "Timed Out": "已超时",
  Destination: "目标",
  Yes: "是",
  No: "否",
  "Body has {{text}}.": "正文含有 {{text}}。",
  "{{text}} is in the body.": "正文中有 {{text}}。",
};

function translatorWith(words: Record<string, string>): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, "zh-CN");
}

const chinese: Translator = translatorWith(WORDS);

function word(rootCause: string, findings?: Array<RootCauseFinding>): string {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: rootCause,
    translator: chinese,
    findings: findings,
  });
}

// A finding, as the engine stores it: its English and the sentence it was filled from.
function bodyHas(text: string): RootCauseFinding {
  const sentence: EvaluationSentence = {
    template: "Body has {{text}}.",
    values: { text: text },
  };

  return {
    message: englishOfEvaluationSentence(sentence),
    messageSentence: sentence,
  };
}

describe("a fact OneUptime lists under a section", () => {
  test("words its label and keeps its stored value, Markdown and all", () => {
    expect(word("- Destination: [api](https://api.acme.example/v1)")).toBe(
      "- 目标: [api](https://api.acme.example/v1)",
    );
    expect(word("- Request Method: `GET` \\*as sent\\*")).toBe(
      "- 请求方法: `GET` \\*as sent\\*",
    );
  });

  test("words OneUptime's own yes and no", () => {
    expect(word("- Timed Out: Yes")).toBe("- 已超时: 是");
    expect(word("- Timed Out: No")).toBe("- 已超时: 否");
  });

  test("keeps any other value of a yes-or-no fact as stored", () => {
    expect(word("- Timed Out: Maybe")).toBe("- 已超时: Maybe");
  });

  test("places a worded label and a worded yes as text, never as Markdown", () => {
    const markdownWords: Translator = translatorWith({
      "Timed Out": "[Timed](https://evil.example)",
      Yes: "*yes*",
    });

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: "- Timed Out: Yes",
        translator: markdownWords,
      }),
    ).toBe("- \\[Timed\\](https://evil.example): \\*yes\\*");
  });

  test("leaves a fact whose label is not OneUptime's as written", () => {
    expect(word("- Owner: payments team")).toBe("- Owner: payments team");
  });
});

describe("a bold label at a line's start", () => {
  test("a section heading with nothing after it", () => {
    expect(word("**Request Details**")).toBe("**请求详情**");
  });

  test("keeps what follows the label as stored, Markdown and all", () => {
    expect(word("**Criteria Name**: Checkout \\*degraded\\* `v2`")).toBe(
      "**条件名称**: Checkout \\*degraded\\* `v2`",
    );
  });

  test("keeps a label with no colon and words that follow it as stored", () => {
    expect(word("**Request Details** (from the probe)")).toBe(
      "**请求详情** (from the probe)",
    );
  });

  test("places a worded label as text inside the bold, never as Markdown", () => {
    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: "**Criteria Name**: Website is down",
        translator: translatorWith({ "Criteria Name": "**名称** `x`" }),
      }),
    ).toBe("**\\*\\*名称\\*\\* \\`x\\`**: Website is down");
  });
});

describe("the criteria's findings", () => {
  test("All filters met. is worded", () => {
    expect(word("**Filter Conditions Met**: All filters met.")).toBe(
      "**满足的筛选条件**: 所有筛选条件均已满足。",
    );
  });

  test("an Any criteria's finding is worded, its values escaped as the engine escapes them", () => {
    const finding: RootCauseFinding = bodyHas("*error*");
    // How the engine writes an Any criteria's finding into the root cause.
    const stored: string = `**Filter Conditions Met**: ${mdText`${finding.message}`.toString()}`;

    expect(stored).toBe("**Filter Conditions Met**: Body has \\*error\\*.");
    expect(word(stored, [finding])).toBe(
      "**满足的筛选条件**: 正文含有 \\*error\\*。",
    );
  });

  test("a finding the engine escaped at the start of its line is still found", () => {
    const sentence: EvaluationSentence = {
      template: "{{text}} is in the body.",
      values: { text: "1. first" },
    };
    const finding: RootCauseFinding = {
      message: englishOfEvaluationSentence(sentence),
      messageSentence: sentence,
    };
    // The engine writes a finding as a line of its own would start.
    const stored: string = `**Filter Conditions Met**: ${mdText`${finding.message}`.toString()}`;

    expect(stored).toBe(
      "**Filter Conditions Met**: 1\\. first is in the body.",
    );
    expect(word(stored, [finding])).toBe(
      "**满足的筛选条件**: 正文中有 1. first。",
    );
  });

  test("an All criteria's findings are worded line by line", () => {
    const first: RootCauseFinding = bodyHas("*error*");
    const second: RootCauseFinding = bodyHas("timeout");
    const stored: string = [
      "**Filter Conditions Met**: All filters met.",
      mdText`- ${first.message}`.toString(),
      mdText`- ${second.message}`.toString(),
    ].join("\n");

    expect(stored).toContain("- Body has \\*error\\*.");
    expect(word(stored, [first, second])).toBe(
      [
        "**满足的筛选条件**: 所有筛选条件均已满足。",
        "- 正文含有 \\*error\\*。",
        "- 正文含有 timeout。",
      ].join("\n"),
    );
  });

  test("a list item that is no finding the reader's language words reads as written", () => {
    const stored: string = [
      "**Filter Conditions Met**: All filters met.",
      "- Response Status Code was 503.",
    ].join("\n");

    expect(word(stored, [bodyHas("error")])).toBe(
      [
        "**满足的筛选条件**: 所有筛选条件均已满足。",
        "- Response Status Code was 503.",
      ].join("\n"),
    );
  });

  test("a finding without its sentence reads as written", () => {
    const stored: string = "**Filter Conditions Met**: Body has error.";

    expect(word(stored, [{ message: "Body has error." }])).toBe(
      "**满足的筛选条件**: Body has error.",
    );
  });
});

describe("what the wording never changes", () => {
  test("an English reader reads the root cause as stored", () => {
    const stored: string = "**Criteria Name**: x\n- Timed Out: Yes";

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: stored,
        translator: createTranslator(undefined, "en"),
      }),
    ).toBe(stored);
  });

  test("an empty root cause stays empty", () => {
    expect(word("")).toBe("");
  });

  test("a line somebody wrote stays as they wrote it", () => {
    const written: string =
      "Rolled back by **Ana**, see [the run](https://ci.example/1)";

    expect(word(written)).toBe(written);
  });
});
