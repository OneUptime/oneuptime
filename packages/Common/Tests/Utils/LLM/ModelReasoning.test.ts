import ModelReasoning, {
  ModelReasoningReading,
} from "../../../Utils/LLM/ModelReasoning";
import { fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A MODEL'S REASONING IS NEVER PART OF ITS ANSWER (issue #11255).
 *
 * A self-hosted 17.3.0 with an internal reasoning model showed OneUptime
 * AI's answers as "</think>I now have a comprehensive picture of this
 * incident...", in Ask AI and on postmortem pages: the provider left the
 * model's reasoning tags (and, without a reasoning parser, the reasoning)
 * in the text, and OneUptime took the text as the answer. ModelReasoning
 * reads every reply: the answer is what the model wrote after its
 * reasoning, and anything that is not the model's own wrapper - the word
 * "think", a tag in prose or in code - stays exactly as it was written.
 *
 * The replies below are written the way each family of model sends them:
 * where its tags go, the white space around them, and whether its chat
 * template opens the block (then only "</think>" is in the text).
 * ---------------------------------------------------------------------------
 */

const read: (text: string) => ModelReasoningReading = (
  text: string,
): ModelReasoningReading => {
  return ModelReasoning.read(text);
};

// A reply read as having no reasoning: the same text, character for character.
const expectUntouched: (text: string) => void = (text: string): void => {
  const reading: ModelReasoningReading = read(text);

  expect(reading.answer).toBe(text);
  expect(reading.reasoning).toBe("");
  expect(reading.hadReasoning).toBe(false);
  expect(reading.closedBlockItNeverOpened).toBe(false);
  expect(reading.endedInsideReasoning).toBe(false);
};

describe("the stray </think> of issue #11255", () => {
  test("the answer the customer saw reads without its closing tag", () => {
    const reading: ModelReasoningReading = read(
      "</think>I now have a comprehensive picture of this incident. Let me summarize my findings.",
    );

    expect(reading.answer).toBe(
      "I now have a comprehensive picture of this incident. Let me summarize my findings.",
    );
    expect(reading.hadReasoning).toBe(true);
    expect(reading.closedBlockItNeverOpened).toBe(true);
    expect(reading.reasoning).toBe("");
  });

  test("a closing tag on its own line, with the blank lines a reasoning parser leaves", () => {
    expect(
      read("\n</think>\n\nThe root cause is the connection pool.").answer,
    ).toBe("The root cause is the connection pool.");
  });

  test("the reasoning a template opened, with no reasoning parser, is left out with its tag", () => {
    const reading: ModelReasoningReading = read(
      [
        "Okay, so the user wants the most likely root cause of this incident. Let me look at what the tools returned.",
        "",
        "The error rate on checkout-api rose at 02:38, right after deploy 4f1c. The database looked healthy.",
        "</think>",
        "",
        "## Most likely root cause",
        "",
        "Deploy 4f1c to **checkout-api** at 02:38 [C1].",
      ].join("\n"),
    );

    expect(reading.answer).toBe(
      "## Most likely root cause\n\nDeploy 4f1c to **checkout-api** at 02:38 [C1].",
    );
    expect(reading.reasoning).toContain("Okay, so the user wants");
    expect(reading.reasoning).toContain("The database looked healthy.");
    expect(reading.reasoning).not.toContain("</think>");
    expect(reading.closedBlockItNeverOpened).toBe(true);
    expect(reading.endedInsideReasoning).toBe(false);
  });

  test("a closing tag written straight after the reasoning, on the same line", () => {
    expect(
      read("so the deploy is the cause.</think>The deploy is the cause.")
        .answer,
    ).toBe("The deploy is the cause.");
  });

  test("only the first closing tag ends the reasoning: a later one is the answer's", () => {
    expect(
      read("thinking</think>A stray </think> in the answer stays.").answer,
    ).toBe("A stray </think> in the answer stays.");
  });

  test("the reasoning may quote the tags in code before it closes", () => {
    const reading: ModelReasoningReading = read(
      "The logs show `<think>` and `</think>` markers from the app.\n</think>\n\nThe app's model leaks its reasoning.",
    );

    expect(reading.answer).toBe("The app's model leaks its reasoning.");
    expect(reading.closedBlockItNeverOpened).toBe(true);
  });

  test("the reasoning may hold a closed fenced block before it closes", () => {
    expect(
      read(
        "Let me check the query:\n```sql\nSELECT * FROM incidents;\n```\nLooks fine.\n</think>\nThe query is fine.",
      ).answer,
    ).toBe("The query is fine.");
  });

  test("a closing tag in any case", () => {
    expect(read("reasoning</THINK>Answer").answer).toBe("Answer");
    expect(read("reasoning</Think>\n\nAnswer").answer).toBe("Answer");
  });

  test("a block right after the template's closing tag is reasoning too", () => {
    expect(read("reasoning</think>\n\n<think>\n\n</think>\n\nAnswer").answer).toBe(
      "Answer",
    );
  });
});

describe("a reasoning block the reply opens with", () => {
  test("DeepSeek-R1 and Qwen3 write their block first, then a blank line", () => {
    const reading: ModelReasoningReading = read(
      "<think>\nOkay, let me analyze the incident timeline.\n</think>\n\nThe incident started at 02:38.",
    );

    expect(reading.answer).toBe("The incident started at 02:38.");
    expect(reading.reasoning).toBe("Okay, let me analyze the incident timeline.");
    expect(reading.hadReasoning).toBe(true);
    expect(reading.closedBlockItNeverOpened).toBe(false);
    expect(reading.endedInsideReasoning).toBe(false);
  });

  test("Qwen3's empty block when it does not think", () => {
    const reading: ModelReasoningReading = read(
      "<think>\n\n</think>\n\nThe incident started at 02:38.",
    );

    expect(reading.answer).toBe("The incident started at 02:38.");
    expect(reading.reasoning).toBe("");
    expect(reading.hadReasoning).toBe(true);
  });

  test("white space and a byte order mark before the block", () => {
    expect(read("\n\n  <think>plan</think>Answer").answer).toBe("Answer");
    expect(read("\uFEFF<think>plan</think>Answer").answer).toBe("Answer");
  });

  test("an opening tag in any case", () => {
    expect(read("<THINK>plan</THINK>Answer").answer).toBe("Answer");
    expect(read("<Think>plan</think>Answer").answer).toBe("Answer");
  });

  test("several blocks one after another are all reasoning", () => {
    const reading: ModelReasoningReading = read(
      "<think>first</think>\n<think>second</think>\n\nAnswer",
    );

    expect(reading.answer).toBe("Answer");
    expect(reading.reasoning).toBe("first\n\nsecond");
  });

  test("the first closing tag ends the block, as a model cannot write one inside its reasoning", () => {
    expect(
      read("<think>a tag `</think>` here</think> rest").answer,
    ).toBe("` here</think> rest");
  });

  test("an opening tag inside the block is part of the reasoning", () => {
    expect(read("<think>I said <think> once</think>Answer").answer).toBe(
      "Answer",
    );
  });

  test("the answer keeps its own white space at its end and its Markdown", () => {
    expect(
      read("<think>x</think>\n\n# Root cause\n\n- one\n- two\n").answer,
    ).toBe("# Root cause\n\n- one\n- two\n");
  });

  test("a tag in the answer after the block is the answer's", () => {
    expect(
      read("<think>plan</think>Models wrap their reasoning in `<think>` tags.")
        .answer,
    ).toBe("Models wrap their reasoning in `<think>` tags.");
  });

  test("characters whose lower case is longer do not move the tags", () => {
    // "İ" becomes two characters in lower case; the tags must not shift.
    const reading: ModelReasoningReading = read(
      `<think>${"İ".repeat(40)}</think>İstanbul is down.`,
    );

    expect(reading.answer).toBe("İstanbul is down.");
    expect(reading.reasoning).toBe("İ".repeat(40));
    expect(read(`${"İ".repeat(40)}</think>İzmir`).answer).toBe("İzmir");
  });
});

describe("a block the reply opens and never closes", () => {
  test("is all reasoning: the model was cut off while it thought", () => {
    const reading: ModelReasoningReading = read(
      "<think>\nOkay, the user wants the root cause. Let me look at the",
    );

    expect(reading.answer).toBe("");
    expect(reading.reasoning).toBe(
      "Okay, the user wants the root cause. Let me look at the",
    );
    expect(reading.hadReasoning).toBe(true);
    expect(reading.endedInsideReasoning).toBe(true);
  });

  test("an opening tag alone", () => {
    const reading: ModelReasoningReading = read("<think>");

    expect(reading.answer).toBe("");
    expect(reading.endedInsideReasoning).toBe(true);
  });

  test("after a closed block, a second one left open is reasoning too", () => {
    const reading: ModelReasoningReading = read(
      "<think>first</think>\n<think>second, cut off",
    );

    expect(reading.answer).toBe("");
    expect(reading.reasoning).toBe("first\n\nsecond, cut off");
    expect(reading.endedInsideReasoning).toBe(true);
  });

  test("a closing tag alone is the end of reasoning, with no answer after it", () => {
    const reading: ModelReasoningReading = read("</think>");

    expect(reading.answer).toBe("");
    expect(reading.hadReasoning).toBe(true);
    expect(reading.closedBlockItNeverOpened).toBe(true);
    expect(reading.endedInsideReasoning).toBe(false);
  });
});

describe("the reasoning wrappers of other model families", () => {
  test.each([
    ["Claude-style prompts", "<thinking>\nplan\n</thinking>\n\nAnswer"],
    ["models that think in thoughts", "<thought>plan</thought>\nAnswer"],
    ["models that reason in tags", "<reasoning>plan</reasoning>\n\nAnswer"],
    ["models that reason in short tags", "<reason>plan</reason>Answer"],
    ["ByteDance's Seed-OSS", "<seed:think>plan</seed:think>\n\nAnswer"],
    [
      "Open-Thoughts and Sky-T1",
      "<|begin_of_thought|>\n\nplan\n\n<|end_of_thought|>\n\nAnswer",
    ],
    ["Moonshot's Kimi", "\u25C1think\u25B7plan\u25C1/think\u25B7Answer"],
    ["Mistral's Magistral, served raw", "[THINK]plan[/THINK]Answer"],
  ])("%s", (_family: string, reply: string) => {
    const reading: ModelReasoningReading = read(reply);

    expect(reading.answer).toBe("Answer");
    expect(reading.reasoning).toBe("plan");
    expect(reading.hadReasoning).toBe(true);
  });

  test("Magistral's tags match only as written: an answer that opens with a link stays", () => {
    expectUntouched("[Think](https://example.com/runbook) of the queue first.");
    expectUntouched("[think]ing about it[/think]");
  });

  test("only </think> closes a block a template opened: other closing tags in an answer are text", () => {
    expectUntouched("The model output ends with </thinking> and then the answer.");
    expectUntouched("A stray </reasoning> tag shows in the widget.");
    expectUntouched("Look for [/THINK] in the logs.");
  });
});

describe("what is not the model's reasoning stays exactly as written", () => {
  test("the word think, in any form", () => {
    expectUntouched("I think the root cause is the database.");
    expectUntouched("Think step by step: first the deploy, then the pool.");
    expectUntouched("thinking, thinks, rethink, overthinking");
    expectUntouched("The user asked: \"Do you think it's the cache?\"");
  });

  test("tag-like text that is no tag", () => {
    expectUntouched("<think about it> is not a tag.");
    expectUntouched("<thinker>Ada</thinker>");
    expectUntouched("<think");
    expectUntouched("</think");
    expectUntouched("think>");
  });

  test("a closing tag in a code span", () => {
    expectUntouched(
      "To strip a model's reasoning, remove `</think>` and everything before it.",
    );
    expectUntouched("Models end their reasoning with ``</think>``.");
  });

  test("code spans pair as CommonMark pairs them: a run of backticks closes only one of its length", () => {
    /*
     * "`" opens a span the next single "`" closes - not the "```" between
     * them - so the first "</think>" is code and the second is not: it
     * ends reasoning a template opened, as a Markdown reader would show it.
     */
    expect(read("`</think>```a ` </think> b``").answer).toBe("b``");
    expectUntouched("`</think>` ``a ` </think> b``");
  });

  test("a closing tag in a fenced code block", () => {
    expectUntouched(
      [
        "The model's raw output was:",
        "",
        "```",
        "Okay, the user wants the cause.</think>The cause is X.",
        "```",
        "",
        "so its server needs a reasoning parser.",
      ].join("\n"),
    );
    expectUntouched("Output:\n~~~text\nplan</think>answer\n~~~\nDone.");
    expectUntouched("Output:\n  ```\n  </think>\n  ```\nDone.");
  });

  test("a closing tag in a fence that never closes", () => {
    expectUntouched("Output:\n```\nplan</think>answer");
  });

  test("a closing tag on a line indented as code", () => {
    expectUntouched("Output:\n\n    plan</think>answer\n\nDone.");
    expectUntouched("Output:\n\n\t</think>\n\nDone.");
  });

  test("a reply that opens with an indented example of a model's output", () => {
    expectUntouched("    <think>example</think>\n    answer");
  });

  test("a tag written after a backslash", () => {
    expectUntouched("Escape it as \\</think> in Markdown.");
  });

  test("both tags in prose: the closing tag closes the one before it", () => {
    expectUntouched("Use <think> and </think> to wrap the reasoning.");
    expectUntouched(
      "Some models write <think>...</think> before their answer.",
    );
  });

  test("a block in the middle of an answer is text", () => {
    expectUntouched("The answer is X <think>maybe Y</think> and that is all.");
  });

  test("an opening tag anywhere but the start is text", () => {
    expectUntouched("Watch for a <think> tag in the output.");
  });

  test("an answer with a code span holding the opening tag, and the pair in prose", () => {
    expectUntouched(
      "The `<think>` tag, and <think> with </think> in prose, are text.",
    );
  });

  test("empty, white space and a missing reply", () => {
    expectUntouched("");
    expectUntouched("   \n\t ");
    expect(ModelReasoning.read(undefined).answer).toBe("");
    expect(ModelReasoning.read(null).answer).toBe("");
  });

  test("white space around an answer with no reasoning is kept", () => {
    expectUntouched("\n\n  The answer.  \n");
  });

  test("a reply quoting a whole conversation keeps every tag in code", () => {
    expectUntouched(
      [
        "Here is what your app sent the model and what came back:",
        "",
        "```json",
        '{"role": "assistant", "content": "<think>plan</think>Hi"}',
        "```",
        "",
        "The `</think>` above is the model's; `<think>` opens it.",
      ].join("\n"),
    );
  });
});

describe("removeFrom", () => {
  test("is the answer of read", () => {
    expect(ModelReasoning.removeFrom("<think>x</think>Answer")).toBe("Answer");
    expect(ModelReasoning.removeFrom("x</think>Answer")).toBe("Answer");
    expect(ModelReasoning.removeFrom("I think so.")).toBe("I think so.");
    expect(ModelReasoning.removeFrom(undefined)).toBe("");
  });
});

/*
 * Answers made from pieces that each hold a tag the model did not write as
 * its wrapper - in code, in prose, after a backslash - are read as they are;
 * and any of them after a reasoning block reads as the answer, whole.
 */
describe("generated answers", () => {
  const SAFE_PIECES: ReadonlyArray<string> = [
    "The root cause is the pool.",
    " ",
    "\n",
    "\n\n",
    "I think",
    " so.",
    "Think about it.",
    "`</think>`",
    "`<think>`",
    "``a ` </think> b``",
    "\n```\nplan</think>answer\n```\n",
    "\n~~~\n<think>x</think>\n~~~\n",
    "\n\n    </think> in an indented line\n\n",
    "\\</think>",
    " <think> and </think> ",
    "<thinker>",
    "[think]",
    "</thinking>",
    "# Heading",
    "- a list item",
  ];

  const generate: (random: SeededRandom, pieces: number) => string = (
    random: SeededRandom,
    pieces: number,
  ): string => {
    // An answer starts with a word, never with an opening tag.
    const parts: Array<string> = ["Answer:"];

    for (let index: number = 0; index < pieces; index++) {
      parts.push(SAFE_PIECES[random(SAFE_PIECES.length)]!);
    }

    /*
     * Apart: two pieces side by side can make one run of backticks of
     * them ("`</think>`" then "``a ` </think> b``" is "```" in the middle),
     * which pairs the code spans differently - as every Markdown reader
     * pairs them, which the test below shows.
     */
    return parts.join(" ");
  };

  test("an answer with no reasoning wrapper is never changed", () => {
    const random: SeededRandom = seededRandom(11255);

    for (let index: number = 0; index < 2000; index++) {
      const answer: string = generate(random, 1 + random(12));
      const reading: ModelReasoningReading = read(answer);

      expect(reading.answer).toBe(answer);
      expect(reading.hadReasoning).toBe(false);
    }
  });

  test("the same answer after a reasoning block reads whole", () => {
    const random: SeededRandom = seededRandom(255);

    for (let index: number = 0; index < 2000; index++) {
      const answer: string = generate(random, 1 + random(12));

      expect(read(`<think>\nplan ${index}\n</think>\n\n${answer}`).answer).toBe(
        answer,
      );
      expect(read(`plan ${index}\n</think>\n\n${answer}`).answer).toBe(answer);
    }
  });
});

/*
 * A model's reply is outside text a prompt can steer, and can be long: it is
 * read in time in line with its length, its worst shapes included.
 */
describe("linear time", () => {
  const LENGTH: number = 400000;

  const timeOf: (run: () => unknown) => number = (
    run: () => unknown,
  ): number => {
    return fastestRun({ run: run, limitInMs: 2000 }).inMs;
  };

  const repeat: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  };

  test.each([
    ["closing tags cut short", repeat("</think")],
    ["closing tags in code spans", `${repeat("`</think>` ")}</think>x`],
    ["opening tags in code before a closing tag", `${repeat("`<think>` ")}</think>x`],
    ["opening tags in prose before a closing tag", `${repeat("a <think> ")}</think>`],
    ["empty blocks on one line", repeat("<think></think>")],
    ["blocks that open and never close", `<think>${repeat("<think>")}`],
    ["backtick runs of every length", `${repeat("` `` ``` ")}</think>`],
    ["fence lines", `${repeat("```\n")}</think>`],
    ["indented lines", `${repeat("    </think>\n")}`],
    ["one long line of white space", `${repeat(" ")}</think>x`],
  ])("%s", (_shape: string, text: string) => {
    expect(timeOf(() => {
      return ModelReasoning.read(text);
    })).toBeLessThan(2000);
  });
});
