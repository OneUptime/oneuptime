import { afterEach, describe, expect, it, jest } from "@jest/globals";
import childProcess, { ChildProcess } from "node:child_process";
import { SpyInstance } from "jest-mock";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import DiscoveryPing from "../../../Utils/Discovery/DiscoveryPing";

const temporaryDirectories: Array<string> = [];
const originalPath: string | undefined = process.env["PATH"];

afterEach(() => {
  jest.restoreAllMocks();
  if (originalPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function installPingScript(script: string): void {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "discovery-ping-"),
  );
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, "ping"), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
  process.env["PATH"] = `${directory}:${originalPath || ""}`;
  jest.spyOn(os, "platform").mockReturnValue("linux");
}

describe("DiscoveryPing process bounds and reachability", () => {
  it("passes native and parent-side deadlines without a shell", async () => {
    installPingScript("exit 0");
    const execute: SpyInstance<
      (
        ...args: Parameters<typeof childProcess.execFile>
      ) => ReturnType<typeof childProcess.execFile>
    > = jest.spyOn(childProcess, "execFile");
    await expect(DiscoveryPing.probe("192.0.2.1")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      "ping",
      ["-n", "-c", "1", "-W", "1", "-w", "2", "192.0.2.1"],
      expect.objectContaining({
        timeout: 2500,
        killSignal: "SIGKILL",
        maxBuffer: 16384,
      }),
      expect.any(Function),
    );
  });

  it("treats no replies as an ordinary unreachable host", async () => {
    installPingScript("exit 1");
    await expect(DiscoveryPing.probe("192.0.2.1")).resolves.toBe(false);
  });

  it("surfaces an ICMP privilege failure instead of declaring the subnet empty", async () => {
    installPingScript(
      "echo 'ping: socket: Operation not permitted' >&2\nexit 2",
    );
    await expect(DiscoveryPing.probe("192.0.2.1")).rejects.toThrow(
      "ICMP ping is not usable",
    );
  });

  it("kills a real stalled child when its scan is aborted", async () => {
    installPingScript("exec /bin/sleep 60");
    const execute: SpyInstance<
      (
        ...args: Parameters<typeof childProcess.execFile>
      ) => ReturnType<typeof childProcess.execFile>
    > = jest.spyOn(childProcess, "execFile");
    const controller: AbortController = new AbortController();
    const probing: Promise<boolean> = DiscoveryPing.probe(
      "192.0.2.1",
      controller.signal,
    );
    const child: ChildProcess = execute.mock.results[0]!.value as ChildProcess;
    const closed: Promise<void> = new Promise<void>((resolve: () => void) => {
      child.once("close", () => {
        resolve();
      });
    });
    const rejected: Promise<void> =
      expect(probing).rejects.toThrow("scan deadline");
    controller.abort(new Error("scan deadline"));
    await rejected;
    await closed;
    expect(child.killed).toBe(true);
    expect(() => {
      process.kill(child.pid!, 0);
    }).toThrow();
  });

  it("enforces its hard deadline and reaps a real unresponsive child", async () => {
    installPingScript("exec /bin/sleep 60");
    const execute: SpyInstance<
      (
        ...args: Parameters<typeof childProcess.execFile>
      ) => ReturnType<typeof childProcess.execFile>
    > = jest.spyOn(childProcess, "execFile");
    const probing: Promise<boolean> = DiscoveryPing.probe("192.0.2.1");
    const child: ChildProcess = execute.mock.results[0]!.value as ChildProcess;
    await expect(probing).resolves.toBe(false);
    expect(child.killed).toBe(true);
    expect(() => {
      process.kill(child.pid!, 0);
    }).toThrow();
  }, 10000);

  it("does not spawn a child for an already-aborted scan", async () => {
    const execute: SpyInstance<
      (
        ...args: Parameters<typeof childProcess.execFile>
      ) => ReturnType<typeof childProcess.execFile>
    > = jest.spyOn(childProcess, "execFile");
    const controller: AbortController = new AbortController();
    controller.abort(new Error("expired"));
    await expect(
      DiscoveryPing.probe("192.0.2.1", controller.signal),
    ).rejects.toThrow("expired");
    expect(execute).not.toHaveBeenCalled();
  });
});
