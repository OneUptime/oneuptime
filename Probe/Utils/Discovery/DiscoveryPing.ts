import childProcess, { ExecFileException } from "node:child_process";
import os from "node:os";

const PING_FAILURE_MARKERS: Array<string> = [
  "operation not permitted",
  "permission denied",
  "must be superuser",
  "lacks privilege",
  "socket:",
  "not found",
  "no such file",
  "cannot open",
];

export default class DiscoveryPing {
  public static async probe(
    host: string,
    scanSignal?: AbortSignal,
  ): Promise<boolean> {
    /*
     * Each request has its own signal so large pools do not attach hundreds
     * of listeners to the scan's shared AbortSignal.
     */
    const signal: AbortSignal | undefined = scanSignal
      ? AbortSignal.any([scanSignal])
      : undefined;
    signal?.throwIfAborted();
    const platform: string = os.platform();
    const windows: boolean = platform === "win32";
    const mac: boolean = platform === "darwin" || platform === "freebsd";
    const command: string = mac ? "/sbin/ping" : "ping";
    const args: Array<string> = windows
      ? ["-n", "1", "-w", "1000", host]
      : mac
        ? ["-n", "-c", "1", "-W", "1000", "-t", "2", host]
        : ["-n", "-c", "1", "-W", "1", "-w", "2", host];

    return await new Promise<boolean>(
      (resolve: (alive: boolean) => void, reject: (error: unknown) => void) => {
        /*
         * A reply timeout does not bound the process lifetime. Enforce both
         * the native deadline and a parent-side kill, including scan aborts.
         */
        childProcess.execFile(
          command,
          args,
          {
            encoding: "utf8",
            timeout: 2500,
            killSignal: "SIGKILL",
            maxBuffer: 16 * 1024,
            signal: signal,
            env: { ...process.env, LANG: "C", LC_ALL: "C" },
          },
          (
            error: ExecFileException | null,
            stdout: string,
            stderr: string,
          ): void => {
            if (signal?.aborted) {
              reject(signal.reason);
              return;
            }
            const output: string = `${stdout}\n${stderr}`.toLowerCase();
            if (
              PING_FAILURE_MARKERS.some((marker: string) => {
                return output.includes(marker);
              }) ||
              (error && typeof error.code === "string")
            ) {
              reject(
                new Error(
                  `ICMP ping is not usable: ${stderr.trim() || error?.message || stdout.trim()}`,
                ),
              );
              return;
            }
            // Windows can exit successfully for an unreachable destination.
            resolve(!error && (!windows || stdout.search(/ttl=\d+/i) >= 0));
          },
        );
      },
    );
  }
}
