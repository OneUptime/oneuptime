import {
  MetricKitCallStackTree,
  formatMetricKitCallStackTree,
  parseMetricKitCallStackTree,
  toReadableMetricKitStackTrace,
} from "../../../Utils/Telemetry/MetricKitCallStack";
import { describe, expect, test } from "@jest/globals";

/*
 * #9712: the call stacks of an iOS app's MetricKit crash or hang, as
 * opentelemetry-swift sends them in `exception.stacktrace`.
 *
 * The two payloads below are the ones its repository documents:
 * SIMPLIFIED_TREE is the example in Sources/Instrumentation/MetricKit/
 * StackTraceFormat.md (what 2.5.2 and later send by default), and
 * APPLE_TREE is Apple's MXCallStackTree.jsonRepresentation() shape, which
 * 2.3.0 to 2.5.1 sent as it was (their transform only read a wrapped tree,
 * and that method writes it unwrapped) and `useAppleStacktraceFormat`
 * sends on purpose.
 */

const SIMPLIFIED_TREE: string = JSON.stringify({
  callStackPerThread: true,
  callStacks: [
    {
      threadAttributed: false,
      callStackFrames: [
        {
          binaryUUID: "70B89F27-1634-3580-A695-57CDB41D7743",
          offsetAddress: 165304,
          binaryName: "MetricKitTestApp",
        },
        {
          binaryUUID: "77A62F2E-8212-30F3-84C1-E8497440ACF8",
          offsetAddress: 6948,
          binaryName: "libdyld.dylib",
        },
      ],
    },
    {
      threadAttributed: true,
      callStackFrames: [
        {
          binaryUUID: "A1B2C3D4-5678-90AB-CDEF-1234567890AB",
          offsetAddress: 42000,
          binaryName: "Foundation",
        },
      ],
    },
  ],
});

// Apple's own shape, as jsonRepresentation() pretty-prints it.
const APPLE_TREE: string = `{
  "callStacks" : [
    {
      "threadAttributed" : true,
      "callStackRootFrames" : [
        {
          "binaryUUID" : "70B89F27-1634-3580-A695-57CDB41D7743",
          "offsetIntoBinaryTextSegment" : 165304,
          "sampleCount" : 1,
          "subFrames" : [
            {
              "binaryUUID" : "77A62F2E-8212-30F3-84C1-E8497440ACF8",
              "offsetIntoBinaryTextSegment" : 6948,
              "sampleCount" : 1,
              "binaryName" : "libdyld.dylib",
              "address" : 7449245604
            }
          ],
          "binaryName" : "MetricKitTestApp",
          "address" : 4295123128
        }
      ]
    }
  ],
  "callStackPerThread" : true
}`;

describe("parseMetricKitCallStackTree", () => {
  test("reads opentelemetry-swift's own shape, a thread's frames flat", () => {
    const tree: MetricKitCallStackTree | null =
      parseMetricKitCallStackTree(SIMPLIFIED_TREE);

    expect(tree).not.toBeNull();
    expect(tree!.callStackPerThread).toBe(true);
    expect(tree!.callStacks).toHaveLength(2);
    expect(tree!.callStacks[0]!.threadAttributed).toBe(false);
    expect(tree!.callStacks[0]!.frames).toEqual([
      {
        binaryName: "MetricKitTestApp",
        binaryUUID: "70B89F27-1634-3580-A695-57CDB41D7743",
        offset: 165304,
        address: null,
      },
      {
        binaryName: "libdyld.dylib",
        binaryUUID: "77A62F2E-8212-30F3-84C1-E8497440ACF8",
        offset: 6948,
        address: null,
      },
    ]);
    expect(tree!.callStacks[1]!.threadAttributed).toBe(true);
  });

  test("reads Apple's shape, its callers nested in subFrames, innermost first", () => {
    const tree: MetricKitCallStackTree | null =
      parseMetricKitCallStackTree(APPLE_TREE);

    expect(tree!.callStacks).toHaveLength(1);
    expect(tree!.callStacks[0]!.frames).toEqual([
      {
        binaryName: "MetricKitTestApp",
        binaryUUID: "70B89F27-1634-3580-A695-57CDB41D7743",
        offset: 165304,
        address: 4295123128,
      },
      {
        binaryName: "libdyld.dylib",
        binaryUUID: "77A62F2E-8212-30F3-84C1-E8497440ACF8",
        offset: 6948,
        address: 7449245604,
      },
    ]);
  });

  test("reads Apple's shape inside its callStackTree wrapper too", () => {
    const wrapped: string = JSON.stringify({
      callStackTree: JSON.parse(APPLE_TREE),
    });

    expect(parseMetricKitCallStackTree(wrapped)).toEqual(
      parseMetricKitCallStackTree(APPLE_TREE),
    );
  });

  test("keeps a sampled tree's branches, depth first", () => {
    const tree: MetricKitCallStackTree | null = parseMetricKitCallStackTree(
      JSON.stringify({
        callStackPerThread: false,
        callStacks: [
          {
            callStackRootFrames: [
              {
                binaryName: "App",
                binaryUUID: "U1",
                offsetIntoBinaryTextSegment: 1,
                subFrames: [
                  {
                    binaryName: "A",
                    binaryUUID: "U2",
                    offsetIntoBinaryTextSegment: 2,
                    subFrames: [
                      {
                        binaryName: "B",
                        binaryUUID: "U3",
                        offsetIntoBinaryTextSegment: 3,
                      },
                    ],
                  },
                  {
                    binaryName: "C",
                    binaryUUID: "U4",
                    offsetIntoBinaryTextSegment: 4,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(tree!.callStackPerThread).toBe(false);
    expect(
      tree!.callStacks[0]!.frames.map((frame: { binaryName: string }) => {
        return frame.binaryName;
      }),
    ).toEqual(["App", "A", "B", "C"]);
  });

  test("skips a frame it cannot read, and keeps the rest", () => {
    const tree: MetricKitCallStackTree | null = parseMetricKitCallStackTree(
      JSON.stringify({
        callStackPerThread: true,
        callStacks: [
          {
            threadAttributed: true,
            callStackFrames: [
              { binaryName: "", binaryUUID: "U", offsetAddress: 1 },
              { binaryName: "NoOffset", binaryUUID: "U" },
              { binaryName: "Negative", binaryUUID: "U", offsetAddress: -4 },
              "not a frame",
              { binaryName: "Good", binaryUUID: "U", offsetAddress: "12" },
            ],
          },
        ],
      }),
    );

    expect(tree!.callStacks[0]!.frames).toEqual([
      { binaryName: "Good", binaryUUID: "U", offset: 12, address: null },
    ]);
  });

  test.each([
    ["an empty text", ""],
    ["text that is no JSON", "Thread 0 Crashed:\n0 libsystem_kernel.dylib"],
    ["a JSON array", "[1, 2]"],
    ["a JSON object with no call stacks", '{"callStackPerThread": true}'],
    ["call stacks that are no list", '{"callStacks": {}}'],
    ["broken JSON", '{"callStacks": [}'],
    [
      "a tree with no frame at all",
      '{"callStackPerThread": true, "callStacks": [{"callStackFrames": []}]}',
    ],
    [
      "a Java stack trace",
      "java.lang.IllegalStateException: boom\n\tat a.b(C.java:1)",
    ],
  ])("%s is no tree", (_label: string, text: string) => {
    expect(parseMetricKitCallStackTree(text)).toBeNull();
  });

  test("text that is not a string is no tree, and does not throw", () => {
    expect(
      parseMetricKitCallStackTree(undefined as unknown as string),
    ).toBeNull();
    expect(parseMetricKitCallStackTree(42 as unknown as string)).toBeNull();
  });

  test("a deep chain of subframes is read up to its bound, never past it", () => {
    let frame: Record<string, unknown> = {
      binaryName: "Leaf",
      binaryUUID: "U",
      offsetIntoBinaryTextSegment: 0,
    };

    for (let depth: number = 0; depth < 2000; depth++) {
      frame = {
        binaryName: "App",
        binaryUUID: "U",
        offsetIntoBinaryTextSegment: depth,
        subFrames: [frame],
      };
    }

    const tree: MetricKitCallStackTree | null = parseMetricKitCallStackTree(
      JSON.stringify({
        callStackPerThread: true,
        callStacks: [{ threadAttributed: true, callStackRootFrames: [frame] }],
      }),
    );

    expect(tree!.callStacks[0]!.frames.length).toBeLessThanOrEqual(512);
    expect(tree!.callStacks[0]!.frames.length).toBeGreaterThan(100);
  });
});

describe("formatMetricKitCallStackTree", () => {
  test("draws the crashed thread first, as Apple's crash reports do", () => {
    const text: string = formatMetricKitCallStackTree(
      parseMetricKitCallStackTree(SIMPLIFIED_TREE)!,
      "crash",
    );

    expect(text).toBe(
      [
        "Thread 1 Crashed:",
        "0   Foundation                     Foundation + 42000",
        "",
        "Thread 0:",
        "0   MetricKitTestApp               MetricKitTestApp + 165304",
        "1   libdyld.dylib                  libdyld.dylib + 6948",
        "",
        "Binary Images:",
        "Foundation <A1B2C3D4-5678-90AB-CDEF-1234567890AB>",
        "MetricKitTestApp <70B89F27-1634-3580-A695-57CDB41D7743>",
        "libdyld.dylib <77A62F2E-8212-30F3-84C1-E8497440ACF8>",
      ].join("\n"),
    );
  });

  test("a hang's thread is the one that hung", () => {
    const text: string = formatMetricKitCallStackTree(
      parseMetricKitCallStackTree(SIMPLIFIED_TREE)!,
      "hang",
    );

    expect(text.split("\n")[0]).toBe("Thread 1 Hung:");
    expect(text).not.toContain("Crashed");
  });

  test("with Apple's addresses, a frame reads its address and its binary's load address", () => {
    const text: string = formatMetricKitCallStackTree(
      parseMetricKitCallStackTree(APPLE_TREE)!,
      "crash",
    );

    // 4295123128 is 0x1000260b8, 165304 bytes into a binary loaded at 0xffffdb00.
    expect(text).toContain(
      "0   MetricKitTestApp               0x00000001000260b8 0xffffdb00 + 165304",
    );
    expect(text.split("\n")[0]).toBe("Thread 0 Crashed:");
  });

  test("a sampled tree's stacks are call stacks, not threads", () => {
    const text: string = formatMetricKitCallStackTree(
      {
        callStackPerThread: false,
        callStacks: [
          {
            threadAttributed: false,
            frames: [
              { binaryName: "App", binaryUUID: "", offset: 9, address: null },
            ],
          },
        ],
      },
      "hang",
    );

    expect(text).toBe(
      [
        "Call stack 0:",
        "0   App                            App + 9",
        "",
        "Binary Images:",
        "App",
      ].join("\n"),
    );
  });

  test("a stack with no frames is left out, numbers kept", () => {
    const text: string = formatMetricKitCallStackTree(
      {
        callStackPerThread: true,
        callStacks: [
          { threadAttributed: false, frames: [] },
          {
            threadAttributed: false,
            frames: [
              { binaryName: "App", binaryUUID: "U", offset: 1, address: null },
            ],
          },
        ],
      },
      "crash",
    );

    expect(text.startsWith("Thread 1:\n")).toBe(true);
    expect(text).not.toContain("Thread 0:");
  });
});

describe("toReadableMetricKitStackTrace", () => {
  test("turns either shape into the threads of a crash report", () => {
    for (const json of [SIMPLIFIED_TREE, APPLE_TREE]) {
      const text: string | null = toReadableMetricKitStackTrace(json, "crash");

      expect(text).not.toBeNull();
      expect(text).toContain("Crashed:");
      expect(text).toContain("MetricKitTestApp");
      expect(text).toContain("Binary Images:");
      expect(text).not.toContain("{");
    }
  });

  test("is null for a stack that is no tree, so the caller keeps it", () => {
    expect(
      toReadableMetricKitStackTrace("Thread 0 Crashed:\n0 App", "crash"),
    ).toBeNull();
    expect(toReadableMetricKitStackTrace("", "hang")).toBeNull();
  });
});
