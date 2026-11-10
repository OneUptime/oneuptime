import {
  describeInvestigationImpactNumbers,
  INVESTIGATION_IMPACT_NUMBERS_LANGUAGE,
  InvestigationImpactCounted,
  InvestigationImpactNumbers,
  investigationImpactNumbersToJSON,
  MAX_INVESTIGATION_IMPACT_BLOCK_LENGTH,
  MAX_INVESTIGATION_IMPACT_COUNT,
  parseInvestigationImpactNumbers,
  takeInvestigationImpactNumbers,
  TakenInvestigationImpactNumbers,
} from "../../../Utils/AI/InvestigationImpactNumbers";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * AN INVESTIGATION'S IMPACT IN NUMBERS (#5715's follow-up).
 *
 * The persona asks the answer to close with one fenced block of JSON in a
 * language of its own (impact-numbers): the users (or sessions, or
 * requests) it hurt, the services it reaches and the SLOs it burns. The
 * engine takes every such block off the answer before anything posts it,
 * and records the numbers of the last one that reads; the AI card reads
 * them back. Display-only: a block that does not read is dropped, the
 * numbers it holds are held to what can be drawn, and the time it takes
 * grows with the answer.
 */

const REPORT: string = [
  "**Summary** — checkout requests queued for a database connection [C1].",
  "",
  "**Impact** —",
  "- **Users:** about 1,240 failed requests between 17:58 and 18:11 UTC [C2].",
  "- **Services:** checkout-api and the storefront [C3].",
  "- **SLOs:** Checkout latency is at risk [C4].",
  "",
  "**Most likely root cause** — the pool was cut from 40 to 10 [C5].",
].join("\n");

const BLOCK: string = [
  "```impact-numbers",
  '{"users": {"count": 1240, "counted": "requests"}, "services": {"count": 2}, "slos": {"affected": 1, "total": 2}}',
  "```",
].join("\n");

const ALL_THREE: InvestigationImpactNumbers = {
  users: { count: 1240, counted: InvestigationImpactCounted.Requests },
  services: { count: 2 },
  slos: { affected: 1, total: 2 },
};

function take(markdown: string): TakenInvestigationImpactNumbers {
  return takeInvestigationImpactNumbers(markdown);
}

describe("takeInvestigationImpactNumbers: the block comes off the answer", () => {
  test("the numbers are read, and the report is left as written", () => {
    expect(take(`${REPORT}\n\n${BLOCK}`)).toEqual({
      markdown: REPORT,
      numbers: ALL_THREE,
    });
  });

  test("its language is the persona's", () => {
    expect(INVESTIGATION_IMPACT_NUMBERS_LANGUAGE).toBe("impact-numbers");
  });

  test("an answer with no block is left exactly as it was", () => {
    const answer: string = `${REPORT}\n\n\`\`\`json\n{"users": 1}\n\`\`\`\n`;

    expect(take(answer)).toEqual({ markdown: answer, numbers: null });
  });

  test("a block in the middle of the answer comes off too, and the text around it stays", () => {
    const answer: string = `**Summary** — the pool [C1].\n\n${BLOCK}\n\n**Most likely root cause** — a release [C2].`;
    const taken: TakenInvestigationImpactNumbers = take(answer);

    expect(taken.numbers).toEqual(ALL_THREE);
    expect(taken.markdown).not.toContain("impact-numbers");
    expect(taken.markdown).toContain("**Summary** — the pool [C1].");
    expect(taken.markdown).toContain(
      "**Most likely root cause** — a release [C2].",
    );
  });

  test("a block that does not read comes off all the same, and records nothing", () => {
    for (const body of [
      "{not json",
      '"just a string"',
      "[1, 2, 3]",
      '{"users": {"count": "many", "counted": "requests"}}',
      "{}",
      "",
    ]) {
      const taken: TakenInvestigationImpactNumbers = take(
        `${REPORT}\n\n\`\`\`impact-numbers\n${body}\n\`\`\``,
      );

      expect({ body, taken }).toEqual({
        body,
        taken: { markdown: REPORT, numbers: null },
      });
    }
  });

  test("a block never closed - the answer was cut short - comes off to the end", () => {
    const taken: TakenInvestigationImpactNumbers = take(
      `${REPORT}\n\n\`\`\`impact-numbers\n{"services": {"count": 3}}`,
    );

    expect(taken.markdown).toBe(REPORT);
    expect(taken.numbers).toEqual({ services: { count: 3 } });
  });

  test("of two blocks, the last that reads wins, and both come off", () => {
    const first: string = '```impact-numbers\n{"services": {"count": 1}}\n```';
    const second: string = '```impact-numbers\n{"services": {"count": 4}}\n```';
    const broken: string = "```impact-numbers\n{oops\n```";

    expect(take(`${first}\n${REPORT}\n${second}\n${broken}`)).toEqual({
      markdown: REPORT,
      numbers: { services: { count: 4 } },
    });
  });

  test.each([
    ["the language in capitals", "```IMPACT-NUMBERS"],
    ["spaces after the fence", "```  impact-numbers  "],
    ["a tilde fence", "~~~impact-numbers"],
    ["four backticks", "````impact-numbers"],
    ["indented by three spaces", "   ```impact-numbers"],
  ])(
    "a fence written with %s is the block's",
    (_how: string, fence: string) => {
      const closing: string = fence.trim().startsWith("~")
        ? "~~~"
        : fence.trim().startsWith("````")
          ? "````"
          : "```";
      const answer: string = `${REPORT}\n\n${fence}\n{"services": {"count": 2}}\n${closing}`;

      expect(take(answer)).toEqual({
        markdown: REPORT,
        numbers: { services: { count: 2 } },
      });
    },
  );

  test("Windows line endings read the same", () => {
    const answer: string = `${REPORT}\r\n\r\n\`\`\`impact-numbers\r\n{"services": {"count": 2}}\r\n\`\`\`\r\n`;
    const taken: TakenInvestigationImpactNumbers = take(answer);

    expect(taken.numbers).toEqual({ services: { count: 2 } });
    expect(taken.markdown).not.toContain("impact-numbers");
  });

  test("other code blocks are never touched: a json block, a block of another language, an indented block", () => {
    const answer: string = [
      REPORT,
      "",
      "```json",
      '{"services": {"count": 9}}',
      "```",
      "",
      "```impact",
      '{"services": {"count": 9}}',
      "```",
      "",
      "    ```impact-numbers",
      "",
      "```impact-numbers-extra",
      "x",
      "```",
    ].join("\n");

    expect(take(answer)).toEqual({ markdown: answer, numbers: null });
  });

  test("a closing fence must be as long as the opening one and say nothing more", () => {
    const answer: string = [
      "````impact-numbers",
      '{"services": {"count": 2}}',
      "```",
      "still inside",
      "```` trailing",
      "````",
      REPORT,
    ].join("\n");

    const taken: TakenInvestigationImpactNumbers = take(answer);

    // The body ran to the four-backtick fence, so it holds more than JSON.
    expect(taken.numbers).toBeNull();
    expect(taken.markdown).toBe(REPORT);
  });

  test("a block longer than a block can be is not read", () => {
    const padding: string = " ".repeat(MAX_INVESTIGATION_IMPACT_BLOCK_LENGTH);
    const taken: TakenInvestigationImpactNumbers = take(
      `${REPORT}\n\`\`\`impact-numbers\n{"services": {"count": 2}${padding}}\n\`\`\``,
    );

    expect(taken).toEqual({ markdown: REPORT, numbers: null });
  });

  /*
   * The answer is the model's, read from telemetry anybody could write
   * into: its time must grow with its length. 400,000 characters of the
   * worst cases - fences that never close, lines of backticks, blocks
   * one after another - within two seconds.
   */
  test.each([
    ["fences that never close", "```impact-numbers\n".repeat(20000)],
    ["lines of backticks", `${"`".repeat(400)}\n`.repeat(1000)],
    [
      "block after block",
      `${BLOCK}\n`.repeat(Math.floor(400000 / (BLOCK.length + 1))),
    ],
    ["one long line", "`~".repeat(200000)],
  ])(
    "%s: in time that grows with the answer",
    (_what: string, answer: string) => {
      const run: FastestRun<TakenInvestigationImpactNumbers> = fastestRun({
        run: (): TakenInvestigationImpactNumbers => {
          return takeInvestigationImpactNumbers(answer);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    },
  );
});

describe("parseInvestigationImpactNumbers: what can be drawn, and nothing else", () => {
  test("all three", () => {
    expect(
      parseInvestigationImpactNumbers({
        users: { count: 1240, counted: "requests" },
        services: { count: 2 },
        slos: { affected: 1, total: 2 },
      }),
    ).toEqual(ALL_THREE);
  });

  test("each alone, the others left out", () => {
    expect(
      parseInvestigationImpactNumbers({
        users: { count: 38, counted: "users" },
      }),
    ).toEqual({
      users: { count: 38, counted: InvestigationImpactCounted.Users },
    });
    expect(parseInvestigationImpactNumbers({ services: { count: 1 } })).toEqual(
      { services: { count: 1 } },
    );
    expect(
      parseInvestigationImpactNumbers({ slos: { affected: 0, total: 3 } }),
    ).toEqual({ slos: { affected: 0, total: 3 } });
  });

  test.each([
    ["users", InvestigationImpactCounted.Users],
    ["Customers", InvestigationImpactCounted.Users],
    ["people", InvestigationImpactCounted.Users],
    ["sessions", InvestigationImpactCounted.Sessions],
    ["User Sessions", InvestigationImpactCounted.Sessions],
    ["requests", InvestigationImpactCounted.Requests],
    ["failed requests", InvestigationImpactCounted.Requests],
    ["root spans", InvestigationImpactCounted.Requests],
    ["errors", InvestigationImpactCounted.Requests],
  ])(
    "what was counted, written %p, reads as %s",
    (word: string, counted: InvestigationImpactCounted) => {
      expect(
        parseInvestigationImpactNumbers({ users: { count: 5, counted: word } }),
      ).toEqual({ users: { count: 5, counted } });
    },
  );

  test("a users' count whose unit is unknown or missing is left out: failed requests are not users", () => {
    expect(
      parseInvestigationImpactNumbers({ users: { count: 5, counted: "pods" } }),
    ).toBeNull();
    expect(parseInvestigationImpactNumbers({ users: { count: 5 } })).toBeNull();
  });

  test.each([
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [MAX_INVESTIGATION_IMPACT_COUNT + 1],
    ["1,240"],
    ["about 40"],
    ["-3"],
    [""],
    [null],
    [true],
    [{}],
  ])("a count of %p is no count", (count: unknown) => {
    expect(parseInvestigationImpactNumbers({ services: { count } })).toBeNull();
  });

  test("a whole count as digits is read, a fraction rounded, the largest kept", () => {
    expect(
      parseInvestigationImpactNumbers({ services: { count: "12" } }),
    ).toEqual({ services: { count: 12 } });
    expect(
      parseInvestigationImpactNumbers({ services: { count: 2.6 } }),
    ).toEqual({ services: { count: 3 } });
    expect(
      parseInvestigationImpactNumbers({
        services: { count: MAX_INVESTIGATION_IMPACT_COUNT },
      }),
    ).toEqual({ services: { count: MAX_INVESTIGATION_IMPACT_COUNT } });
  });

  test("SLOs: at least one counts the subject, and no more burn than count it", () => {
    expect(
      parseInvestigationImpactNumbers({ slos: { affected: 0, total: 0 } }),
    ).toBeNull();
    expect(
      parseInvestigationImpactNumbers({ slos: { affected: 3, total: 2 } }),
    ).toBeNull();
    expect(
      parseInvestigationImpactNumbers({ slos: { affected: 2, total: 2 } }),
    ).toEqual({ slos: { affected: 2, total: 2 } });
    expect(parseInvestigationImpactNumbers({ slos: { total: 2 } })).toBeNull();
  });

  test("anything that is not an object of numbers is nothing", () => {
    for (const value of [
      null,
      undefined,
      "users",
      42,
      [],
      { users: "1240" },
      { services: [2] },
      { slos: "1 of 2" },
    ]) {
      expect(parseInvestigationImpactNumbers(value)).toBeNull();
    }
  });

  test("keys it does not know are left behind, never carried along", () => {
    expect(
      parseInvestigationImpactNumbers({
        services: { count: 2, names: ["checkout"] },
        extra: "<script>",
      }),
    ).toEqual({ services: { count: 2 } });
  });

  test("what the run records reads back as it was", () => {
    expect(
      parseInvestigationImpactNumbers(
        investigationImpactNumbersToJSON(ALL_THREE),
      ),
    ).toEqual(ALL_THREE);
  });
});

describe("describeInvestigationImpactNumbers: the run's English line", () => {
  test("all three, each counted as English counts it", () => {
    expect(describeInvestigationImpactNumbers(ALL_THREE)).toBe(
      "Affected: 1240 requests, 2 services, 1 of 2 SLOs.",
    );
  });

  test("one of each", () => {
    expect(
      describeInvestigationImpactNumbers({
        users: { count: 1, counted: InvestigationImpactCounted.Sessions },
        services: { count: 1 },
        slos: { affected: 1, total: 1 },
      }),
    ).toBe("Affected: 1 session, 1 service, 1 of 1 SLO.");
  });

  test("only what was measured", () => {
    expect(
      describeInvestigationImpactNumbers({
        users: { count: 38, counted: InvestigationImpactCounted.Users },
      }),
    ).toBe("Affected: 38 users.");
  });
});
