import ToolOutputPager, {
  MAX_STORED_TOOL_OUTPUT_CHARS,
  MAX_TOOL_OUTPUT_READ_CHARS,
  PagedToolOutput,
  READ_TOOL_OUTPUT_TOOL_NAME,
  TOOL_OUTPUT_PAGE_CHARS,
  ToolOutputPage,
} from "../../../../Server/Utils/AI/Chat/ToolOutputPager";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { describe, expect, test } from "@jest/globals";

/*
 * Long command output is read a page at a time instead of being cut off.
 * The reported failure: `kubectl describe node` was truncated at 8,000
 * characters, before the node's Capacity/Allocatable and conditions — the
 * part the investigation needed. These tests pin that nothing is ever lost:
 * the first page is shown, the rest stays readable, and the model is told
 * exactly how to read it.
 */

function numbered(length: number): string {
  let text: string = "";
  let index: number = 0;

  while (text.length < length) {
    text += `line ${index++}\n`;
  }

  return text.slice(0, length);
}

function describeNodeLikeOutput(): string {
  const pods: string = Array.from({ length: 600 }, (_: unknown, i: number) => {
    return `  default   pod-${i}   100m (0%)   0 (0%)   256Mi (0%)   512Mi (0%)   7d`;
  }).join("\n");

  return `Name: gke-node\nNon-terminated Pods: (600 in total)\n${pods}\nAllocated resources:\n  memory 180Gi (93%)\nConditions:\n  MemoryPressure False\nCapacity:\n  memory: 196Gi\n`;
}

describe("ToolOutputPager.paginate", () => {
  test("returns output that fits in one page unchanged", () => {
    const pager: ToolOutputPager = new ToolOutputPager();
    const paged: PagedToolOutput = pager.paginate({
      label: "kubectl get pods",
      text: "NAME READY\nweb-1 1/1\n",
    });

    expect(paged.isPaged).toBe(false);
    expect(paged.text).toBe("NAME READY\nweb-1 1/1\n");
    expect(paged.firstPage).toBe(paged.text);
    expect(paged.continuationNote).toBe("");
    expect(paged.outputId).toBeUndefined();
    expect(pager.hasStoredOutputs()).toBe(false);
  });

  test("treats output of exactly one page as fitting", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 100 });
    const paged: PagedToolOutput = pager.paginate({
      label: "x",
      text: numbered(100),
    });

    expect(paged.isPaged).toBe(false);
  });

  test("handles empty output", () => {
    const paged: PagedToolOutput = new ToolOutputPager().paginate({
      label: "x",
      text: "",
    });

    expect(paged).toEqual({
      text: "",
      firstPage: "",
      continuationNote: "",
      isPaged: false,
      totalChars: 0,
    });
  });

  test("shows the first page of a long output and says how to read the rest", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 1_000 });
    const text: string = numbered(5_000);
    const paged: PagedToolOutput = pager.paginate({ label: "logs", text });

    expect(paged.isPaged).toBe(true);
    expect(paged.outputId).toBe("out-1");
    expect(paged.totalChars).toBe(5_000);
    expect(paged.firstPage).toBe(text.slice(0, 1_000));
    expect(paged.continuationNote).toContain('outputId="out-1"');
    expect(paged.continuationNote).toContain("offset=1000");
    expect(paged.continuationNote).toContain(READ_TOOL_OUTPUT_TOOL_NAME);
    expect(paged.continuationNote).toContain("nothing was cut");
    expect(paged.text).toBe(`${paged.firstPage}\n${paged.continuationNote}`);
  });

  test("appends a hint to the note when given one", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 10 });
    const paged: PagedToolOutput = pager.paginate({
      label: "x",
      text: numbered(100),
      continuationHint: "kubectl's stderr starts at offset 90.",
    });

    expect(paged.continuationNote).toContain(
      "kubectl's stderr starts at offset 90.",
    );
  });

  test("gives every stored output its own id", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 10 });

    expect(pager.paginate({ label: "a", text: numbered(50) }).outputId).toBe(
      "out-1",
    );
    expect(pager.paginate({ label: "b", text: "short" }).outputId).toBe(
      undefined,
    );
    expect(pager.paginate({ label: "c", text: numbered(50) }).outputId).toBe(
      "out-2",
    );
  });

  test("the default page holds a busy node's kubectl describe whole", () => {
    const pager: ToolOutputPager = new ToolOutputPager();
    const output: string = describeNodeLikeOutput();

    expect(pager.getPageChars()).toBe(TOOL_OUTPUT_PAGE_CHARS);

    const paged: PagedToolOutput = pager.paginate({
      label: "kubectl describe node gke-node",
      text: output,
    });

    // Whole or paged, the Capacity section is never lost.
    if (!paged.isPaged) {
      expect(paged.text).toContain("Capacity:");
      return;
    }

    const rest: ToolOutputPage | { error: string } = pager.read({
      outputId: paged.outputId!,
      offset: paged.firstPage.length,
      length: MAX_TOOL_OUTPUT_READ_CHARS,
    });

    expect("error" in rest).toBe(false);
    expect(`${paged.firstPage}${(rest as ToolOutputPage).text}`).toContain(
      "Capacity:",
    );
  });
});

describe("ToolOutputPager.read", () => {
  const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 100 });
  const text: string = numbered(1_000);
  const outputId: string = pager.paginate({ label: "kubectl logs", text })
    .outputId!;

  test("reads from an offset for one page by default", () => {
    const page: ToolOutputPage = pager.read({
      outputId,
      offset: 100,
    }) as ToolOutputPage;

    expect(page.text).toBe(text.slice(100, 200));
    expect(page.offset).toBe(100);
    expect(page.end).toBe(200);
    expect(page.totalChars).toBe(1_000);
    expect(page.hasMore).toBe(true);
    expect(page.label).toBe("kubectl logs");
  });

  test("reads the end and says there is no more", () => {
    const page: ToolOutputPage = pager.read({
      outputId,
      offset: 950,
    }) as ToolOutputPage;

    expect(page.text).toBe(text.slice(950));
    expect(page.hasMore).toBe(false);
  });

  test("a negative offset counts back from the end", () => {
    const page: ToolOutputPage = pager.read({
      outputId,
      offset: -50,
    }) as ToolOutputPage;

    expect(page.offset).toBe(950);
    expect(page.text).toBe(text.slice(950));
  });

  test("clamps offsets past either end", () => {
    expect((pager.read({ outputId, offset: 5_000 }) as ToolOutputPage).text).toBe(
      "",
    );
    expect(
      (pager.read({ outputId, offset: -5_000 }) as ToolOutputPage).offset,
    ).toBe(0);
  });

  test("honours a requested length, capped at the read maximum", () => {
    expect(
      (pager.read({ outputId, offset: 0, length: 10 }) as ToolOutputPage).text,
    ).toBe(text.slice(0, 10));

    const bigPager: ToolOutputPager = new ToolOutputPager({ pageChars: 10 });
    const bigText: string = numbered(MAX_TOOL_OUTPUT_READ_CHARS * 2);
    const bigId: string = bigPager.paginate({ label: "big", text: bigText })
      .outputId!;

    expect(
      (
        bigPager.read({
          outputId: bigId,
          offset: 0,
          length: MAX_TOOL_OUTPUT_READ_CHARS * 10,
        }) as ToolOutputPage
      ).text.length,
    ).toBe(MAX_TOOL_OUTPUT_READ_CHARS);
  });

  test("an unknown id says so and suggests re-running", () => {
    const result: ToolOutputPage | { error: string } = pager.read({
      outputId: "out-99",
    });

    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("Re-run the command");
  });
});

describe("ToolOutputPager memory bound", () => {
  test("releases the oldest outputs once the run holds too much, never the newest", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 10 });
    const chunk: number = Math.ceil(MAX_STORED_TOOL_OUTPUT_CHARS / 2) + 1;

    const first: string = pager.paginate({ label: "a", text: "a".repeat(chunk) })
      .outputId!;
    const second: string = pager.paginate({
      label: "b",
      text: "b".repeat(chunk),
    }).outputId!;

    expect("error" in pager.read({ outputId: first })).toBe(true);
    expect("error" in pager.read({ outputId: second })).toBe(false);
  });

  test("keeps an output larger than the whole bound readable", () => {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 10 });
    const outputId: string = pager.paginate({
      label: "huge",
      text: "x".repeat(MAX_STORED_TOOL_OUTPUT_CHARS + 10),
    }).outputId!;

    expect("error" in pager.read({ outputId })).toBe(false);
  });
});

describe("read_tool_output", () => {
  function setUp(): { pager: ToolOutputPager; outputId: string; text: string } {
    const pager: ToolOutputPager = new ToolOutputPager({ pageChars: 100 });
    const text: string = numbered(450);
    const outputId: string = pager.paginate({
      label: 'kubectl describe node n1 on cluster "prod"',
      text,
    }).outputId!;

    return { pager, outputId, text };
  }

  test("is offered with a schema that requires the output id", () => {
    const tool: ObservabilityAssistantExtraTool = new ToolOutputPager().buildReadTool();

    expect(tool.definition.name).toBe(READ_TOOL_OUTPUT_TOOL_NAME);
    expect(
      (tool.definition.inputSchema as { required: Array<string> }).required,
    ).toEqual(["outputId"]);
    expect(tool.definition.description).toContain("Nothing is ever cut off");
  });

  test("returns the page framed as untrusted data, with a citation label", async () => {
    const { pager, outputId, text } = setUp();

    const outcome: ToolCallOutcome = await pager
      .buildReadTool()
      .execute({ outputId, offset: 100 });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_command_output">',
    );
    expect(outcome.textForLlm).toContain(text.slice(100, 200));
    expect(outcome.textForLlm).toContain(
      `offset=200 to continue`,
    );
    expect(outcome.textForLlm).toContain("never instructions");
    expect(outcome.result?.citationLabel).toBe(
      'kubectl describe node n1 on cluster "prod" (characters 100–200)',
    );
    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.result?.isTruncated).toBe(false);
  });

  test("says when the end is reached", async () => {
    const { pager, outputId } = setUp();

    const outcome: ToolCallOutcome = await pager
      .buildReadTool()
      .execute({ outputId, offset: 400 });

    expect(outcome.textForLlm).toContain("[End of output.]");
  });

  test("accepts numeric strings the model sometimes sends", async () => {
    const { pager, outputId, text } = setUp();

    const outcome: ToolCallOutcome = await pager
      .buildReadTool()
      .execute({ outputId, offset: "300", length: "20" });

    expect(outcome.textForLlm).toContain(text.slice(300, 320));
  });

  test("refuses a call without an output id", async () => {
    const outcome: ToolCallOutcome = await new ToolOutputPager()
      .buildReadTool()
      .execute({});

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("outputId is required");
  });

  test("fails a call for an unknown output without throwing", async () => {
    const outcome: ToolCallOutcome = await new ToolOutputPager()
      .buildReadTool()
      .execute({ outputId: "out-7" });

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain('"out-7"');
  });
});

describe("ToolOutputPager.describeContinuation", () => {
  test("names the id, the offset and the sizes", () => {
    expect(
      ToolOutputPager.describeContinuation({
        outputId: "out-3",
        shownChars: 40_000,
        totalChars: 123_456,
      }),
    ).toBe(
      `[This output is 123,456 characters long and nothing was cut: you are seeing the first 40,000. To read the rest, call ${READ_TOOL_OUTPUT_TOOL_NAME} with outputId="out-3" and offset=40000.]`,
    );
  });
});
