import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import PcapFile from "Common/Server/Utils/PacketCapture/PcapFile";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import { PacketCaptureJob } from "Common/Types/PacketCapture/PacketCaptureJob";
import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PacketCaptureLimits,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import {
  buildTcpdumpArguments,
  CaptureCommand,
  CaptureToolInfo,
  describeCaptureToolFailure,
  describeSpawnError,
  detectCaptureTool,
  getRunningCaptureProcessCount,
  holdJobToLimits,
  PacketCaptureRunResult,
  runPacketCapture,
  summarizeToolOutput,
  TCPDUMP_COMMAND,
  TCPDUMP_SNAP_LENGTH,
} from "../../../Utils/PacketCapture/PacketCaptureRunner";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * One packet capture, run with tcpdump - here, with a stand-in that writes
 * pcap files and fails in tcpdump's own words (TestingUtils/FakeTcpdump.cjs),
 * so every way a capture ends runs for real: a real child process, real
 * signals, real pipes. What is pinned:
 *
 *   - tcpdump is started with an argument array and no shell; the filter is
 *     ONE argument after "--"; an interface or filter that could be read as
 *     anything else never reaches it;
 *   - every capture stops at the first of its limits - duration, packets,
 *     file size - or at Stop, and a tcpdump that will not stop is killed;
 *   - the file is cut at a whole packet under the size limit and always
 *     reads back; a capture that never started fails with what to fix.
 */

const FAKE_TCPDUMP: string = path.join(
  __dirname,
  "..",
  "..",
  "TestingUtils",
  "FakeTcpdump.cjs",
);

function fake(mode: string): CaptureCommand {
  return { path: process.execPath, prefixArgs: [FAKE_TCPDUMP, mode] };
}

const PROBE_LIMITS: PacketCaptureLimits = { ...HARD_MAX_PACKET_CAPTURE_LIMITS };

function job(overrides: Partial<PacketCaptureJob> = {}): PacketCaptureJob {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    interfaceName: "eth0",
    bpfFilter: "host 10.0.0.5",
    maxDurationInSeconds: 60,
    maxPackets: 100,
    maxFileSizeInBytes: 1024 * 1024,
    ...overrides,
  };
}

async function run(
  mode: string,
  overrides: Partial<PacketCaptureJob> = {},
  extra: {
    signal?: AbortSignal;
    limits?: PacketCaptureLimits;
    stopGraceInMs?: number;
  } = {},
): Promise<PacketCaptureRunResult> {
  return await runPacketCapture({
    job: job(overrides),
    limits: extra.limits || PROBE_LIMITS,
    command: fake(mode),
    signal: extra.signal,
    stopGraceInMs: extra.stopGraceInMs ?? 2000,
  });
}

// Where the stand-in writes the arguments it was started with ("mode@file").
let argsFile: string = "";

beforeEach(() => {
  argsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fake-tcpdump-")),
    "args.json",
  );
});

afterEach(() => {
  fs.rmSync(path.dirname(argsFile), { recursive: true, force: true });
  expect(getRunningCaptureProcessCount()).toBe(0);
});

describe("holdJobToLimits", () => {
  test("a job inside the probe's limits runs as it was handed", () => {
    expect(
      holdJobToLimits(
        job({ bpfFilter: "  port   53 " }),
        HARD_MAX_PACKET_CAPTURE_LIMITS,
      ),
    ).toEqual({
      interfaceName: "eth0",
      bpfFilter: "port 53",
      maxDurationInSeconds: 60,
      maxPackets: 100,
      maxFileSizeInBytes: 1024 * 1024,
    });
  });

  test("whatever the server sent, the probe's own lower maximums win", () => {
    expect(
      holdJobToLimits(
        job({
          maxDurationInSeconds: 1800,
          maxPackets: 1000000,
          maxFileSizeInBytes: 25 * 1024 * 1024,
        }),
        { maxDurationInSeconds: 300, maxPackets: 1000000, maxFileSizeInMB: 5 },
      ),
    ).toMatchObject({
      maxDurationInSeconds: 300,
      maxPackets: 1000000,
      maxFileSizeInBytes: 5 * 1024 * 1024,
    });
  });

  test("and the hard maximums hold even when the probe's settings say more", () => {
    expect(
      holdJobToLimits(
        job({
          maxDurationInSeconds: 86400,
          maxPackets: 99999999,
          maxFileSizeInBytes: 1024 * 1024 * 1024,
        }),
        {
          maxDurationInSeconds: 99999,
          maxPackets: 99999999,
          maxFileSizeInMB: 999,
        },
      ),
    ).toMatchObject({
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInBytes: 25 * 1024 * 1024,
    });
  });

  test("a limit below its minimum, or not a number, is held to something safe", () => {
    expect(
      holdJobToLimits(
        job({
          maxDurationInSeconds: 1,
          maxPackets: 0,
          maxFileSizeInBytes: Number.NaN,
        }),
        HARD_MAX_PACKET_CAPTURE_LIMITS,
      ),
    ).toMatchObject({
      maxDurationInSeconds: 5,
      maxPackets: 1,
      maxFileSizeInBytes: 25 * 1024 * 1024,
    });
  });
});

describe("buildTcpdumpArguments", () => {
  test("the interface, no name lookups, packet by packet to standard output, the filter as one argument after --", () => {
    expect(
      buildTcpdumpArguments(
        holdJobToLimits(
          job({ bpfFilter: "host 10.0.0.5 and (tcp port 443 or udp port 53)" }),
          PROBE_LIMITS,
        ),
      ),
    ).toEqual([
      "-i",
      "eth0",
      "-n",
      "-U",
      "-s",
      String(TCPDUMP_SNAP_LENGTH),
      "-c",
      "100",
      "-w",
      "-",
      "--",
      "host 10.0.0.5 and (tcp port 443 or udp port 53)",
    ]);
  });

  test("no filter, no -- and nothing after it", () => {
    const args: Array<string> = buildTcpdumpArguments(
      holdJobToLimits(job({ bpfFilter: "" }), PROBE_LIMITS),
    );

    expect(args).not.toContain("--");
    expect(args[args.length - 1]).toBe("-");
  });

  test("an interface name tcpdump could read as an option is refused", () => {
    for (const interfaceName of ["-w", "--help", "eth0;reboot", "", "eth 0"]) {
      expect(() => {
        return buildTcpdumpArguments(
          holdJobToLimits(job({ interfaceName: interfaceName }), PROBE_LIMITS),
        );
      }).toThrow("is not a network interface name this probe can capture on.");
    }
  });

  test("a filter that is not one is refused", () => {
    expect(() => {
      return buildTcpdumpArguments(
        holdJobToLimits(job({ bpfFilter: "port 53; reboot" }), PROBE_LIMITS),
      );
    }).toThrow('The filter can\'t contain ";"');
    expect(() => {
      return buildTcpdumpArguments(
        holdJobToLimits(job({ bpfFilter: "-w /tmp/x" }), PROBE_LIMITS),
      );
    }).toThrow('The filter can\'t start with "-"');
  });

  test("tcpdump itself is started by name, with no shell", () => {
    expect(TCPDUMP_COMMAND).toEqual({ path: "tcpdump" });
  });
});

describe("what tcpdump says", () => {
  test("its routine lines are left out, and its prefix is not repeated", () => {
    expect(
      summarizeToolOutput(
        [
          "tcpdump: listening on eth0, link-type EN10MB (Ethernet), snapshot length 262144 bytes",
          "12 packets captured",
          "12 packets received by filter",
          "0 packets dropped by kernel",
          "tcpdump: pcap_loop: The interface disappeared",
          "",
        ].join("\n"),
      ),
    ).toBe("pcap_loop: The interface disappeared");
  });

  test("is cut short", () => {
    expect(summarizeToolOutput("x".repeat(1000))).toHaveLength(300);
  });

  test("a refused interface is a capability to add", () => {
    expect(
      describeCaptureToolFailure({
        stderr:
          "tcpdump: eth0: You don't have permission to perform this capture on that device\n(socket: Operation not permitted)",
        exitCode: 1,
        interfaceName: "eth0",
      }),
    ).toBe(
      "The probe is not allowed to capture packets on eth0. Run it with the NET_RAW capability, as the packet capture docs show. tcpdump said: eth0: You don't have permission to perform this capture on that device (socket: Operation not permitted)",
    );
  });

  test("a filter it cannot compile is the filter", () => {
    expect(
      describeCaptureToolFailure({
        stderr: "tcpdump: syntax error in filter expression: syntax error",
        exitCode: 1,
        interfaceName: "eth0",
      }),
    ).toBe(
      "tcpdump could not use the filter. tcpdump said: syntax error in filter expression: syntax error",
    );
  });

  test("a missing interface, or one that is down", () => {
    expect(
      describeCaptureToolFailure({
        stderr: "tcpdump: eth9: No such device exists",
        exitCode: 1,
        interfaceName: "eth9",
      }),
    ).toBe(
      'The interface "eth9" does not exist on the probe. tcpdump said: eth9: No such device exists',
    );
    expect(
      describeCaptureToolFailure({
        stderr: "tcpdump: eth1: That device is not up",
        exitCode: 1,
        interfaceName: "eth1",
      }),
    ).toBe(
      'The interface "eth1" is down. tcpdump said: eth1: That device is not up',
    );
  });

  test("anything else in its own words, and nothing said in the exit code", () => {
    expect(
      describeCaptureToolFailure({
        stderr: "tcpdump: something unusual",
        exitCode: 2,
        interfaceName: "eth0",
      }),
    ).toBe("tcpdump stopped with an error. tcpdump said: something unusual");
    expect(
      describeCaptureToolFailure({
        stderr: "",
        exitCode: 1,
        interfaceName: "eth0",
      }),
    ).toBe("tcpdump stopped (exit code 1) before it captured anything.");
    expect(
      describeCaptureToolFailure({
        stderr: "",
        exitCode: null,
        interfaceName: "eth0",
      }),
    ).toBe("tcpdump stopped (exit code none) before it captured anything.");
  });

  test("a tcpdump that is not there, or may not be run", () => {
    expect(
      describeSpawnError(
        Object.assign(new Error("spawn tcpdump ENOENT"), { code: "ENOENT" }),
      ),
    ).toBe(
      "tcpdump is not installed on this probe. Run the official probe image, or install tcpdump where the probe runs.",
    );
    expect(
      describeSpawnError(
        Object.assign(new Error("spawn tcpdump EACCES"), { code: "EACCES" }),
      ),
    ).toBe("The probe is not allowed to run tcpdump.");
    expect(describeSpawnError(new Error("boom"))).toBe(
      "The probe could not start tcpdump: boom",
    );
  });

  /*
   * The docs quote these messages (Docs/Content/<language>/probe/
   * packet-capture.md, Troubleshooting), so a person can search for the
   * words they see.
   */
  test("the messages the docs quote are the ones the probe says", () => {
    const docs: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Docs/Content/en/probe/packet-capture.md",
      ),
      "utf8",
    );

    const permission: string = describeCaptureToolFailure({
      stderr: "permission denied",
      exitCode: 1,
      interfaceName: "eth0",
    });
    const filter: string = describeCaptureToolFailure({
      stderr: "syntax error",
      exitCode: 1,
      interfaceName: "eth0",
    });
    const missing: string = describeCaptureToolFailure({
      stderr: "No such device exists",
      exitCode: 1,
      interfaceName: "eth0",
    });

    expect(
      permission.startsWith(
        "The probe is not allowed to capture packets on eth0.",
      ),
    ).toBe(true);
    expect(docs).toContain(
      ':::details "The probe is not allowed to capture packets on eth0"',
    );
    expect(filter.startsWith("tcpdump could not use the filter.")).toBe(true);
    expect(docs).toContain(':::details "tcpdump could not use the filter"');
    expect(
      missing
        .replace(' "eth0"', "")
        .startsWith("The interface does not exist on the probe."),
    ).toBe(true);
    expect(docs).toContain(
      ':::details "The interface does not exist on the probe"',
    );
    expect(docs).toContain("`--cap-add NET_RAW`");
  });
});

describe("running a capture", () => {
  test("starts tcpdump with the arguments built for the job, and nothing else", async () => {
    await run(`count@${argsFile}`, { maxPackets: 2, bpfFilter: "udp port 53" });

    expect(JSON.parse(fs.readFileSync(argsFile, "utf8"))).toEqual([
      "-i",
      "eth0",
      "-n",
      "-U",
      "-s",
      String(TCPDUMP_SNAP_LENGTH),
      "-c",
      "2",
      "-w",
      "-",
      "--",
      "udp port 53",
    ]);
  });

  test("an unsafe interface or filter never starts tcpdump", async () => {
    const result: PacketCaptureRunResult = await run(`count@${argsFile}`, {
      interfaceName: "--version",
    });

    expect(result.isFailure).toBe(true);
    expect(result.failureMessage).toContain(
      "is not a network interface name this probe can capture on.",
    );
    expect(fs.existsSync(argsFile)).toBe(false);
  });

  test("stops at its packet limit, with every packet in a file that reads back", async () => {
    const result: PacketCaptureRunResult = await run("count", {
      maxPackets: 25,
    });

    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.PacketLimitReached);
    expect(result.packetCount).toBe(25);
    expect(PcapFile.inspect(result.pcap!)).toMatchObject({
      isPcap: true,
      packetCount: 25,
      wholeLength: result.pcap!.length,
    });
  });

  test("stops when the file reaches its size limit, cut at the last whole packet under it", async () => {
    const limit: number = 50 * 1024;

    const result: PacketCaptureRunResult = await run("burst", {
      maxFileSizeInBytes: limit,
    });

    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.FileSizeLimitReached);
    expect(result.pcap!.length).toBeLessThanOrEqual(limit);
    // A whole packet more would not have fitted.
    expect(result.pcap!.length).toBeGreaterThan(limit - (16 + 1500));
    expect(PcapFile.inspect(result.pcap!)).toMatchObject({
      isPcap: true,
      packetCount: result.packetCount,
      wholeLength: result.pcap!.length,
    });
  });

  test("Stop from the dashboard ends it early and keeps what it captured", async () => {
    const controller: AbortController = new AbortController();

    setTimeout(() => {
      controller.abort();
    }, 400);

    const result: PacketCaptureRunResult = await run(
      "stream",
      {},
      { signal: controller.signal },
    );

    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.StoppedFromDashboard);
    expect(result.packetCount).toBeGreaterThan(0);
    expect(PcapFile.inspect(result.pcap!).packetCount).toBe(result.packetCount);
  });

  test("a capture stopped before it captured anything completes with no file", async () => {
    const controller: AbortController = new AbortController();
    controller.abort();

    const result: PacketCaptureRunResult = await run(
      "stream",
      {},
      { signal: controller.signal },
    );

    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.StoppedFromDashboard);
    expect(result.packetCount).toBe(0);
    expect(result.pcap).toBeNull();
  });

  test("a tcpdump that will not stop is killed after the grace period", async () => {
    const controller: AbortController = new AbortController();

    setTimeout(() => {
      controller.abort();
    }, 200);

    const started: number = Date.now();
    const result: PacketCaptureRunResult = await run(
      "ignoresigint",
      {},
      { signal: controller.signal, stopGraceInMs: 300 },
    );

    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.StoppedFromDashboard);
    expect(result.packetCount).toBeGreaterThan(0);
  });

  test("stops when its duration runs out", async () => {
    const started: number = Date.now();
    const result: PacketCaptureRunResult = await run("stream", {
      maxDurationInSeconds: 5,
    });

    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.DurationReached);
    expect(result.packetCount).toBeGreaterThan(10);
  }, 20000);

  test("a tcpdump that stops by itself keeps what it captured, and says what it said", async () => {
    const result: PacketCaptureRunResult = await run("die");

    expect(result.isFailure).toBe(false);
    expect(result.endReason).toBe(PacketCaptureEndReason.CaptureToolStopped);
    expect(result.packetCount).toBe(3);
    expect(result.statusMessage).toBe(
      "tcpdump stopped by itself: pcap_loop: The interface disappeared",
    );
  });

  test.each([
    [
      "permission",
      "The probe is not allowed to capture packets on eth0. Run it with the NET_RAW capability",
    ],
    ["nodevice", 'The interface "eth0" does not exist on the probe.'],
    ["badfilter", "tcpdump could not use the filter."],
    [
      "silentfail",
      "tcpdump stopped (exit code 1) before it captured anything.",
    ],
  ])(
    "a capture tcpdump could not start (%s) fails with what to fix",
    async (mode: string, message: string) => {
      const result: PacketCaptureRunResult = await run(mode);

      expect(result.isFailure).toBe(true);
      expect(result.failureMessage).toContain(message);
      expect(result.pcap).toBeNull();
      expect(result.packetCount).toBe(0);
    },
  );

  test("a probe with no tcpdump says to install it", async () => {
    const result: PacketCaptureRunResult = await runPacketCapture({
      job: job(),
      limits: PROBE_LIMITS,
      command: { path: path.join(os.tmpdir(), "no-such-tcpdump-here") },
    });

    expect(result).toEqual({
      isFailure: true,
      failureMessage:
        "tcpdump is not installed on this probe. Run the official probe image, or install tcpdump where the probe runs.",
      pcap: null,
      packetCount: 0,
    });
  });

  test("captures run side by side, each with its own file", async () => {
    const [first, second] = await Promise.all([
      run("count", { maxPackets: 3 }),
      run("count", { maxPackets: 7 }),
    ]);

    expect(first!.packetCount).toBe(3);
    expect(second!.packetCount).toBe(7);
  });
});

describe("detectCaptureTool", () => {
  test("reports tcpdump and its version line", async () => {
    const info: CaptureToolInfo = await detectCaptureTool(fake("version"));

    expect(info).toEqual({
      isAvailable: true,
      version: "tcpdump version 4.99.3",
    });
  });

  test("a tool that answers without a version is there, with no version", async () => {
    expect(await detectCaptureTool(fake("novline"))).toEqual({
      isAvailable: true,
    });
  });

  test("a tool that fails to answer, or is not there, is missing", async () => {
    expect(await detectCaptureTool(fake("noversion"))).toEqual({
      isAvailable: false,
    });
    expect(
      await detectCaptureTool({
        path: path.join(os.tmpdir(), "no-such-tcpdump-here"),
      }),
    ).toEqual({ isAvailable: false });
  });
});
