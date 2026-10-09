import PcapFile, {
  PcapTruncation,
} from "Common/Server/Utils/PacketCapture/PcapFile";
import PacketCaptureCapabilityUtil from "Common/Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import PacketCaptureFilterUtil from "Common/Types/PacketCapture/PacketCaptureFilter";
import { PacketCaptureJob } from "Common/Types/PacketCapture/PacketCaptureJob";
import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import { ChildProcess, ExecException, execFile, spawn } from "child_process";

/*
 * Runs one packet capture with tcpdump and hands back the pcap file.
 *
 * tcpdump is started with execFile semantics - spawn, an argument array, no
 * shell - so nothing a person typed is ever read by a shell. The filter is
 * ONE argument, after "--", so tcpdump can only take it as a filter, never
 * as an option; the interface name is checked before it is passed. The pcap
 * goes to tcpdump's standard output (-w -), packet by packet (-U), and is
 * held in memory: no file is written on the probe, so there is nothing to
 * clean up and nothing another process on the host could read.
 *
 * Every capture stops at the first of:
 *
 *   - its duration          the probe sends tcpdump SIGINT, which flushes and exits;
 *   - its packet limit      tcpdump stops by itself (-c);
 *   - its file size         the probe counts the bytes and sends SIGINT;
 *   - a Stop from the dashboard (the abort signal);
 *
 * and a tcpdump that does not exit within a few seconds of SIGINT is
 * killed. Each limit is held to this probe's maximums (its operator's
 * PROBE_PACKET_CAPTURE_MAX_* settings) and the hard maximums, whatever the
 * server sent. The file is cut at the last whole packet under the size
 * limit, so it always opens in Wireshark.
 */

// How much of each packet tcpdump keeps: all of it (tcpdump's own default).
export const TCPDUMP_SNAP_LENGTH: number = 262144;

// How long tcpdump has to exit after SIGINT before it is killed.
export const DEFAULT_STOP_GRACE_IN_MS: number = 5000;

// How much of tcpdump's own messages is kept for a failure reason.
const MAX_TOOL_OUTPUT_LENGTH: number = 8192;

/*
 * How far past the size limit the bytes are kept, so the last whole packet
 * under the limit can be found: at most one record past it.
 */
const SIZE_LIMIT_SLACK_IN_BYTES: number = TCPDUMP_SNAP_LENGTH + 64;

// The program the capture runs, and anything to put before its arguments.
export interface CaptureCommand {
  path: string;
  prefixArgs?: Array<string> | undefined;
}

export const TCPDUMP_COMMAND: CaptureCommand = { path: "tcpdump" };

export interface RunPacketCaptureOptions {
  job: PacketCaptureJob;
  // This probe's maximums: the operator's settings.
  limits: PacketCaptureLimits;
  // Aborted when the dashboard asks for the capture to stop.
  signal?: AbortSignal | undefined;
  command?: CaptureCommand | undefined;
  stopGraceInMs?: number | undefined;
}

export interface PacketCaptureRunResult {
  // True when nothing usable was captured; failureMessage says why.
  isFailure: boolean;
  failureMessage?: string | undefined;
  // The pcap file, cut at a whole packet; null when it holds no packets.
  pcap: Buffer | null;
  packetCount: number;
  endReason?: PacketCaptureEndReason | undefined;
  // What tcpdump said when it stopped by itself, if it did.
  statusMessage?: string | undefined;
}

// The limits a capture runs to: the job's, held to the probe's and the hard ones.
export interface HeldPacketCaptureJob {
  interfaceName: string;
  bpfFilter: string;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInBytes: number;
}

export function holdJobToLimits(
  job: PacketCaptureJob,
  limits: PacketCaptureLimits,
): HeldPacketCaptureJob {
  const maximums: PacketCaptureLimits =
    PacketCaptureLimitsUtil.getMaximums(limits);

  const holdTo: (value: unknown, max: number, min: number) => number = (
    value: unknown,
    max: number,
    min: number,
  ): number => {
    const parsed: number = Number(value);

    if (!Number.isFinite(parsed)) {
      return max;
    }

    return Math.max(min, Math.min(Math.floor(parsed), max));
  };

  return {
    interfaceName: job.interfaceName,
    bpfFilter: PacketCaptureFilterUtil.normalize(job.bpfFilter),
    maxDurationInSeconds: holdTo(
      job.maxDurationInSeconds,
      maximums.maxDurationInSeconds,
      PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
    ),
    maxPackets: holdTo(
      job.maxPackets,
      Math.min(maximums.maxPackets, HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets),
      1,
    ),
    maxFileSizeInBytes: holdTo(
      job.maxFileSizeInBytes,
      PacketCaptureLimitsUtil.toBytes(maximums.maxFileSizeInMB),
      1,
    ),
  };
}

/*
 * tcpdump's arguments for one capture. Throws on an interface name tcpdump
 * could read as anything but a name, or a filter that is not one - the
 * server refuses both too, so only a row written by hand gets here.
 */
export function buildTcpdumpArguments(job: HeldPacketCaptureJob): Array<string> {
  if (!PacketCaptureCapabilityUtil.isInterfaceName(job.interfaceName)) {
    throw new Error(
      `"${job.interfaceName}" is not a network interface name this probe can capture on.`,
    );
  }

  const filterError: string | null = PacketCaptureFilterUtil.validate(
    job.bpfFilter,
  );

  if (filterError) {
    throw new Error(filterError);
  }

  const args: Array<string> = [
    "-i",
    job.interfaceName,
    // Never look names up: the file is what matters, not tcpdump's printing.
    "-n",
    // Write each packet as it arrives, so the byte count is current.
    "-U",
    "-s",
    String(TCPDUMP_SNAP_LENGTH),
    "-c",
    String(job.maxPackets),
    "-w",
    "-",
  ];

  const filter: string = PacketCaptureFilterUtil.normalize(job.bpfFilter);

  if (filter) {
    args.push("--", filter);
  }

  return args;
}

// The informative lines tcpdump prints to stderr on every run.
const ROUTINE_TOOL_LINE: RegExp =
  /^(tcpdump: listening on|\d+ packets? (captured|received by filter|dropped by kernel)|tcpdump: verbose output suppressed)/i;
const PERMISSION_PROBLEM: RegExp =
  /(permission|not permitted|you don't have|operation not permitted)/i;
const MISSING_INTERFACE: RegExp =
  /(no such device|doesn't exist|does not exist|not found|no such interface)/i;
const FILTER_PROBLEM: RegExp =
  /(syntax error|can't parse filter|parse error|unknown host|illegal|expression rejects|unknown (port|protocol|network))/i;
const INTERFACE_DOWN: RegExp = /(not up|network is down)/i;
const LINE_BREAK: RegExp = /\r?\n/;

/*
 * What tcpdump said that was not routine, on one line, cut short: the words
 * a failure shows. Empty when it said nothing else.
 */
export function summarizeToolOutput(stderr: string): string {
  return stderr
    .split(LINE_BREAK)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0 && !ROUTINE_TOOL_LINE.test(line);
    })
    .join(" ")
    .substring(0, 300);
}

// Why a capture produced nothing, in words someone can act on.
export function describeCaptureToolFailure(data: {
  stderr: string;
  exitCode: number | null;
  interfaceName: string;
}): string {
  const said: string = summarizeToolOutput(data.stderr);
  const quoted: string = said ? ` tcpdump said: ${said}` : "";

  if (PERMISSION_PROBLEM.test(said)) {
    return `The probe is not allowed to capture packets on ${data.interfaceName}. Run it with the NET_RAW and NET_ADMIN capabilities, as the packet capture docs show.${quoted}`;
  }

  if (FILTER_PROBLEM.test(said)) {
    return `tcpdump could not use the filter.${quoted}`;
  }

  if (MISSING_INTERFACE.test(said)) {
    return `The interface "${data.interfaceName}" does not exist on the probe.${quoted}`;
  }

  if (INTERFACE_DOWN.test(said)) {
    return `The interface "${data.interfaceName}" is down.${quoted}`;
  }

  if (said) {
    return `tcpdump stopped with an error.${quoted}`;
  }

  return `tcpdump stopped (exit code ${data.exitCode === null ? "none" : data.exitCode}) before it captured anything.`;
}

// Why tcpdump could not be started at all.
export function describeSpawnError(error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") {
    return "tcpdump is not installed on this probe. Run the official probe image, or install tcpdump where the probe runs.";
  }

  if (error.code === "EACCES") {
    return "The probe is not allowed to run tcpdump.";
  }

  return `The probe could not start tcpdump: ${error.message}`;
}

/*
 * Every tcpdump this process started and has not seen exit, so none
 * outlives the probe: they are killed when the process exits.
 */
const runningCaptures: Set<ChildProcess> = new Set();
let isExitHookInstalled: boolean = false;

function installExitHook(): void {
  if (isExitHookInstalled) {
    return;
  }

  isExitHookInstalled = true;

  process.once("exit", () => {
    for (const child of runningCaptures) {
      child.kill("SIGKILL");
    }
  });
}

// Exported for tests: how many captures this process is running.
export function getRunningCaptureProcessCount(): number {
  return runningCaptures.size;
}

function failed(message: string): PacketCaptureRunResult {
  return {
    isFailure: true,
    failureMessage: message,
    pcap: null,
    packetCount: 0,
  };
}

export async function runPacketCapture(
  options: RunPacketCaptureOptions,
): Promise<PacketCaptureRunResult> {
  const job: HeldPacketCaptureJob = holdJobToLimits(
    options.job,
    options.limits,
  );

  let args: Array<string>;

  try {
    args = buildTcpdumpArguments(job);
  } catch (err) {
    return failed((err as Error).message);
  }

  const command: CaptureCommand = options.command || TCPDUMP_COMMAND;
  const stopGraceInMs: number =
    options.stopGraceInMs ?? DEFAULT_STOP_GRACE_IN_MS;
  const signal: AbortSignal | undefined = options.signal;

  installExitHook();

  return await new Promise<PacketCaptureRunResult>(
    (resolve: (result: PacketCaptureRunResult) => void): void => {
      let child: ChildProcess;

      try {
        child = spawn(command.path, [...(command.prefixArgs || []), ...args], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
      } catch (err) {
        resolve(failed(describeSpawnError(err as NodeJS.ErrnoException)));
        return;
      }

      runningCaptures.add(child);

      const chunks: Array<Buffer> = [];
      const keepLimit: number =
        job.maxFileSizeInBytes + SIZE_LIMIT_SLACK_IN_BYTES;
      let kept: number = 0;
      let received: number = 0;
      let stderr: string = "";
      let endReason: PacketCaptureEndReason | undefined = undefined;
      let isSettled: boolean = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined = undefined;

      const stop: (reason: PacketCaptureEndReason) => void = (
        reason: PacketCaptureEndReason,
      ): void => {
        if (endReason || isSettled) {
          return;
        }

        endReason = reason;
        child.kill("SIGINT");

        killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, stopGraceInMs);
      };

      const durationTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        stop(PacketCaptureEndReason.DurationReached);
      }, job.maxDurationInSeconds * 1000);

      const onAbort: () => void = (): void => {
        stop(PacketCaptureEndReason.StoppedFromDashboard);
      };

      child.stdout?.on("data", (chunk: Buffer): void => {
        received += chunk.length;

        if (kept < keepLimit) {
          const part: Buffer = chunk.subarray(0, keepLimit - kept);
          chunks.push(part);
          kept += part.length;
        }

        if (received >= job.maxFileSizeInBytes) {
          stop(PacketCaptureEndReason.FileSizeLimitReached);
        }
      });

      child.stderr?.on("data", (chunk: Buffer): void => {
        if (stderr.length < MAX_TOOL_OUTPUT_LENGTH) {
          stderr += chunk
            .toString("utf8")
            .substring(0, MAX_TOOL_OUTPUT_LENGTH - stderr.length);
        }
      });

      const finish: (outcome: {
        error?: NodeJS.ErrnoException;
        exitCode?: number | null;
      }) => void = (outcome: {
        error?: NodeJS.ErrnoException;
        exitCode?: number | null;
      }): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(durationTimer);

        if (killTimer) {
          clearTimeout(killTimer);
        }

        signal?.removeEventListener("abort", onAbort);
        runningCaptures.delete(child);

        if (outcome.error) {
          resolve(failed(describeSpawnError(outcome.error)));
          return;
        }

        const output: Buffer = Buffer.concat(chunks);
        const truncation: PcapTruncation = PcapFile.truncate(
          output,
          job.maxFileSizeInBytes,
        );
        const exitCode: number | null = outcome.exitCode ?? null;
        const toolMessage: string = summarizeToolOutput(stderr);

        if (!endReason) {
          /*
           * tcpdump stopped by itself: its packet limit, or an error. One
           * that wrote no pcap at all never started - the interface, the
           * permissions, the filter.
           */
          if (exitCode === 0 && truncation.packetCount >= job.maxPackets) {
            endReason = PacketCaptureEndReason.PacketLimitReached;
          } else if (truncation.packetCount === 0) {
            resolve(
              failed(
                describeCaptureToolFailure({
                  stderr: stderr,
                  exitCode: exitCode,
                  interfaceName: job.interfaceName,
                }),
              ),
            );
            return;
          } else {
            endReason = PacketCaptureEndReason.CaptureToolStopped;
          }
        } else if (!PcapFile.isPcap(output) && toolMessage) {
          // Stopped by the probe before tcpdump got going, and it complained.
          resolve(
            failed(
              describeCaptureToolFailure({
                stderr: stderr,
                exitCode: exitCode,
                interfaceName: job.interfaceName,
              }),
            ),
          );
          return;
        }

        const result: PacketCaptureRunResult = {
          isFailure: false,
          pcap: truncation.packetCount > 0 ? truncation.buffer : null,
          packetCount: truncation.packetCount,
          endReason: endReason,
        };

        if (
          endReason === PacketCaptureEndReason.CaptureToolStopped &&
          toolMessage
        ) {
          result.statusMessage = `tcpdump stopped by itself: ${toolMessage}`;
        }

        resolve(result);
      };

      child.once("error", (error: NodeJS.ErrnoException): void => {
        finish({ error: error });
      });

      child.once("close", (exitCode: number | null): void => {
        finish({ exitCode: exitCode });
      });

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    },
  );
}

export interface CaptureToolInfo {
  isAvailable: boolean;
  version?: string | undefined;
}

const VERSION_LINE: RegExp = /tcpdump version/i;

/*
 * Whether tcpdump is installed, and its version line, from
 * `tcpdump --version`. Asked once a report; a tool that does not answer in
 * five seconds counts as missing.
 */
export async function detectCaptureTool(
  command: CaptureCommand = TCPDUMP_COMMAND,
): Promise<CaptureToolInfo> {
  return await new Promise<CaptureToolInfo>(
    (resolve: (info: CaptureToolInfo) => void): void => {
      try {
        execFile(
          command.path,
          [...(command.prefixArgs || []), "--version"],
          {
            timeout: 5000,
            windowsHide: true,
            maxBuffer: 64 * 1024,
            encoding: "utf8",
          },
          (error: ExecException | null, stdout: string, stderr: string): void => {
            const lines: Array<string> = `${stdout}\n${stderr}`
              .split(LINE_BREAK)
              .map((line: string): string => {
                return line.trim();
              })
              .filter((line: string): boolean => {
                return line.length > 0;
              });

            const versionLine: string | undefined = lines.find(
              (line: string): boolean => {
                return VERSION_LINE.test(line);
              },
            );

            if (versionLine) {
              resolve({
                isAvailable: true,
                version: versionLine.substring(0, 120),
              });
              return;
            }

            resolve({ isAvailable: !error });
          },
        );
      } catch {
        resolve({ isAvailable: false });
      }
    },
  );
}
