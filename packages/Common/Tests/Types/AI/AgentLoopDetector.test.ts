import AgentLoopDetector, {
  AgentLoopToolCall,
  AgentLoopVerdict,
  canonicalArguments,
  fingerprintText,
  NO_PROGRESS_ROUNDS_BEFORE_NUDGE,
  NO_PROGRESS_ROUNDS_BEFORE_STOP,
  REPEATED_FAILURE_LIMIT,
} from "../../../Types/AI/AgentLoopDetector";
import { describe, expect, test } from "@jest/globals";

/*
 * AgentLoopDetector tells a run going in circles from one that is working
 * (issue #6440). With no cap on calls by default, it is what stops a stuck
 * model long before its time limit does - and these pin that it never stops
 * a run that keeps learning something, however many calls that takes.
 */

function call(
  name: string,
  args: unknown,
  output: string,
  isError: boolean = false,
): AgentLoopToolCall {
  return { name, arguments: args, output, isError };
}

describe("the thresholds", () => {
  test("a failure repeated three times, a nudge after three idle rounds, a stop after five", () => {
    expect(REPEATED_FAILURE_LIMIT).toBe(3);
    expect(NO_PROGRESS_ROUNDS_BEFORE_NUDGE).toBe(3);
    expect(NO_PROGRESS_ROUNDS_BEFORE_STOP).toBe(5);
    expect(NO_PROGRESS_ROUNDS_BEFORE_NUDGE).toBeLessThan(
      NO_PROGRESS_ROUNDS_BEFORE_STOP,
    );
  });
});

describe("a run that keeps learning is never stopped", () => {
  test("a thousand rounds of different calls go on", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    for (let round: number = 0; round < 1_000; round++) {
      expect(
        detector.recordRound([
          call(
            "read_file",
            { path: `src/file-${round}.ts` },
            `content ${round}`,
          ),
        ]),
      ).toBe(AgentLoopVerdict.Continue);
    }

    expect(detector.getRoundsWithoutProgress()).toBe(0);
  });

  test("the same call returning something new each time is progress (a status that moves on)", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    for (let round: number = 0; round < 50; round++) {
      expect(
        detector.recordRound([
          call(
            "kubectl",
            { command: "get pods -n payments" },
            `payments-api-0 Running ${round}s`,
          ),
        ]),
      ).toBe(AgentLoopVerdict.Continue);
    }
  });

  test("a file read again after an edit is progress", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const read: () => AgentLoopVerdict = (): AgentLoopVerdict => {
      return detector.recordRound([
        call("read_file", { path: "src/a.ts" }, "const a = 1;"),
      ]);
    };

    expect(read()).toBe(AgentLoopVerdict.Continue);
    expect(
      detector.recordRound([
        call("edit_file", { path: "src/a.ts", text: "2" }, "Edited src/a.ts"),
      ]),
    ).toBe(AgentLoopVerdict.Continue);
    expect(
      detector.recordRound([
        call("read_file", { path: "src/a.ts" }, "const a = 2;"),
      ]),
    ).toBe(AgentLoopVerdict.Continue);
  });

  test("one new result in a round of repeats is progress", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const seen: AgentLoopToolCall = call("search", { q: "timeout" }, "3 hits");

    detector.recordRound([seen]);

    for (let round: number = 0; round < 20; round++) {
      expect(
        detector.recordRound([
          seen,
          call("read_file", { path: `src/hit-${round}.ts` }, `hit ${round}`),
        ]),
      ).toBe(AgentLoopVerdict.Continue);
    }
  });

  test("a failing call made with new arguments each time is the model adapting", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    for (let round: number = 0; round < 10; round++) {
      expect(
        detector.recordRound([
          call(
            "read_file",
            { path: `src/maybe-${round}.ts` },
            "Error: no such file",
            true,
          ),
        ]),
      ).toBe(AgentLoopVerdict.Continue);
    }
  });

  test("a round with no call that ran says nothing either way", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    for (let round: number = 0; round < 20; round++) {
      expect(detector.recordRound([])).toBe(AgentLoopVerdict.Continue);
    }

    expect(detector.getRoundsWithoutProgress()).toBe(0);
  });
});

describe("the same failing call", () => {
  test("stops the run the third time it fails the same way", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const failing: AgentLoopToolCall = call(
      "run_command",
      { command: "npm run lint" },
      "Error: command not found",
      true,
    );

    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Stop);
    expect(detector.describeStop()).toBe(
      "run_command failed the same way 3 times with the same arguments",
    );
  });

  test("counts across the run, with other calls in between", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const failing: AgentLoopToolCall = call(
      "query_logs",
      { service: "checkout" },
      "Error: bad filter",
      true,
    );

    expect(
      detector.recordRound([failing, call("read_file", { p: 1 }, "one")]),
    ).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([call("read_file", { p: 2 }, "two")])).toBe(
      AgentLoopVerdict.Continue,
    );
    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([call("read_file", { p: 3 }, "three")])).toBe(
      AgentLoopVerdict.Continue,
    );
    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Stop);
  });

  test("three in one round is three", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const failing: AgentLoopToolCall = call(
      "kubectl",
      { command: "get pods -n missing" },
      "Error: namespace not found",
      true,
    );

    expect(detector.recordRound([failing, failing, failing])).toBe(
      AgentLoopVerdict.Stop,
    );
  });

  test("failing a different way is not the same failure", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    for (let round: number = 0; round < 6; round++) {
      expect(
        detector.recordRound([
          call(
            "run_command",
            { command: "npm test" },
            `Error: ${round} tests failed`,
            true,
          ),
        ]),
      ).toBe(AgentLoopVerdict.Continue);
    }
  });

  test("the same output that is not an error never counts as a failure", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const same: AgentLoopToolCall = call(
      "run_command",
      { command: "npm test" },
      "Exit code 1: 2 failing",
      false,
    );

    // Only the idle-round rule applies to it.
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
  });

  test("once stopped, it stays stopped", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const failing: AgentLoopToolCall = call("x", {}, "Error: x", true);

    detector.recordRound([failing, failing, failing]);

    expect(detector.recordRound([call("y", { n: 1 }, "new")])).toBe(
      AgentLoopVerdict.Stop,
    );
  });
});

describe("rounds that show the model nothing new", () => {
  test("nudge after three, stop after five", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const same: AgentLoopToolCall = call(
      "get_metrics",
      { name: "cpu" },
      "cpu 40%",
    );

    // The first time is new.
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.getRoundsWithoutProgress()).toBe(2);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Nudge);
    expect(detector.getNudgeInstruction()).toBe(
      "Your last 3 rounds of tool calls returned only results you had already seen. Do not repeat them: try a different approach, or answer with what you have.",
    );
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Continue);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Stop);
    expect(detector.describeStop()).toBe(
      "5 rounds of tool calls in a row returned nothing new",
    );
  });

  test("the nudge is given once a streak", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const same: AgentLoopToolCall = call("a", {}, "same");
    const verdicts: Array<AgentLoopVerdict> = [];

    for (let round: number = 0; round < 6; round++) {
      verdicts.push(detector.recordRound([same]));
    }

    expect(
      verdicts.filter((verdict: AgentLoopVerdict): boolean => {
        return verdict === AgentLoopVerdict.Nudge;
      }),
    ).toHaveLength(1);
  });

  test("progress resets the streak, and a later streak is nudged again", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const same: AgentLoopToolCall = call("a", {}, "same");

    detector.recordRound([same]);
    detector.recordRound([same]);
    detector.recordRound([same]);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Nudge);

    // The model changed course.
    expect(detector.recordRound([call("b", { n: 1 }, "new")])).toBe(
      AgentLoopVerdict.Continue,
    );
    expect(detector.getRoundsWithoutProgress()).toBe(0);

    detector.recordRound([same]);
    detector.recordRound([same]);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Nudge);
    detector.recordRound([same]);
    expect(detector.recordRound([same])).toBe(AgentLoopVerdict.Stop);
  });

  test("alternating between two results already seen is no progress", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const first: AgentLoopToolCall = call("read_file", { p: "a" }, "A");
    const second: AgentLoopToolCall = call("read_file", { p: "b" }, "B");

    detector.recordRound([first]);
    detector.recordRound([second]);

    const verdicts: Array<AgentLoopVerdict> = [];

    for (let round: number = 0; round < 5; round++) {
      verdicts.push(detector.recordRound([round % 2 === 0 ? first : second]));
    }

    expect(verdicts[verdicts.length - 1]).toBe(AgentLoopVerdict.Stop);
  });
});

describe("what counts as the same call", () => {
  test("arguments in another key order or spacing are the same call", () => {
    expect(canonicalArguments({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      canonicalArguments('{ "a": { "c": null, "d": [1, 2] }, "b": 1 }'),
    );
  });

  test("arguments that are not JSON are compared as written", () => {
    expect(canonicalArguments("  ls -la  ")).toBe("ls -la");
    expect(canonicalArguments("{not json")).toBe("{not json");
  });

  test("no arguments at all is one shape", () => {
    expect(canonicalArguments(undefined)).toBe("null");
    expect(canonicalArguments(null)).toBe("null");
    expect(canonicalArguments("null")).toBe("null");
  });

  test("a repeat with reordered arguments is no progress", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    detector.recordRound([call("q", '{"a":1,"b":2}', "same")]);
    detector.recordRound([call("q", { b: 2, a: 1 }, "same")]);
    detector.recordRound([call("q", '{ "b": 2, "a": 1 }', "same")]);

    expect(detector.getRoundsWithoutProgress()).toBe(2);
  });

  test("the same arguments to another tool are another call", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();

    detector.recordRound([call("a", { x: 1 }, "out")]);

    expect(detector.recordRound([call("b", { x: 1 }, "out")])).toBe(
      AgentLoopVerdict.Continue,
    );
    expect(detector.getRoundsWithoutProgress()).toBe(0);
  });
});

describe("after the conversation left results out", () => {
  /*
   * The code agent drops the oldest tool results to stay inside the
   * model's context window (issue #6441). A file read again after that is
   * the model getting back what it lost, not a circle.
   */
  test("a call made again to get a dropped result back is progress", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const read: AgentLoopToolCall = call(
      "read_file",
      { path: "src/cart.ts" },
      "export const cart = 2;",
    );

    detector.recordRound([read]);
    expect(detector.recordRound([read])).toBe(AgentLoopVerdict.Continue);
    expect(detector.getRoundsWithoutProgress()).toBe(1);

    detector.forgetSeenResults();

    expect(detector.getRoundsWithoutProgress()).toBe(0);
    expect(detector.recordRound([read])).toBe(AgentLoopVerdict.Continue);
    expect(detector.getRoundsWithoutProgress()).toBe(0);
  });

  test("rounds without progress start counting again, nudge included", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const idle: AgentLoopToolCall = call(
      "list_directory",
      { path: "." },
      "src/",
    );

    detector.recordRound([idle]);

    for (
      let round: number = 1;
      round < NO_PROGRESS_ROUNDS_BEFORE_NUDGE;
      round++
    ) {
      detector.recordRound([idle]);
    }

    expect(detector.recordRound([idle])).toBe(AgentLoopVerdict.Nudge);

    detector.forgetSeenResults();
    detector.recordRound([idle]);

    for (
      let round: number = 1;
      round < NO_PROGRESS_ROUNDS_BEFORE_NUDGE;
      round++
    ) {
      expect(detector.recordRound([idle])).toBe(AgentLoopVerdict.Continue);
    }

    expect(detector.recordRound([idle])).toBe(AgentLoopVerdict.Nudge);
  });

  test("a call that keeps failing the same way is still stopped", () => {
    const detector: AgentLoopDetector = new AgentLoopDetector();
    const failing: AgentLoopToolCall = call(
      "run_command",
      { command: "npm run build" },
      "Error: missing script",
      true,
    );

    detector.recordRound([failing]);
    detector.recordRound([failing]);
    detector.forgetSeenResults();

    expect(detector.recordRound([failing])).toBe(AgentLoopVerdict.Stop);
  });
});

describe("fingerprintText", () => {
  test("is stable", () => {
    expect(fingerprintText("hello")).toBe(fingerprintText("hello"));
  });

  test("tells apart texts that differ by one character", () => {
    expect(fingerprintText("pod-a Running")).not.toBe(
      fingerprintText("pod-b Running"),
    );
    expect(fingerprintText("")).not.toBe(fingerprintText(" "));
  });

  test("keeps a long output to a short key", () => {
    const fingerprint: string = fingerprintText("x".repeat(500_000));

    expect(fingerprint.length).toBeLessThan(40);
    expect(fingerprint).toMatch(/:500000$/);
  });

  test("few collisions over many different outputs", () => {
    const seen: Set<string> = new Set<string>();

    for (let index: number = 0; index < 20_000; index++) {
      seen.add(fingerprintText(`line ${index} of the log`));
    }

    expect(seen.size).toBe(20_000);
  });
});
