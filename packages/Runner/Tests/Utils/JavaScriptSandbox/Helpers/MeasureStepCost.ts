import {
  SANDBOX_DEADLINE_GRACE_MS,
  getDefaultWorkerEntry,
  runSandboxedStep,
} from "../../../../Utils/JavaScriptSandbox/SandboxProcess";
import {
  SANDBOX_IDENTITY_MAX,
  SANDBOX_IDENTITY_MIN,
  SANDBOX_LAUNCHER_PATH,
  SandboxIdentityPool,
  SandboxIsolation,
  callLauncher,
  hasLiveProcessOfUser,
} from "../../../../Utils/JavaScriptSandbox/SandboxIdentity";
import {
  SANDBOX_NO_NETWORK_PATH,
  decideSandboxNetwork,
} from "../../../../Utils/JavaScriptSandbox/SandboxNetwork";
import fs from "fs";

/*
 * What one JavaScript step's process costs in the Runner's image: the wall
 * time of steps that return at once, one after another, through the image's
 * launcher and bundle, and the resident and proportional memory of a step's
 * process while it runs. Not a test file itself; run it in the built image
 * as root (which may read another user's smaps_rollup), with the Runner's
 * sources mounted over the image's:
 *
 *   docker run --rm -u 0 --cap-add SYS_PTRACE \
 *     -v "$PWD/packages/Runner:/usr/src/app:ro" \
 *     -v "$PWD/packages/Common:/usr/src/Common:ro" \
 *     oneuptime/runner:<tag> node --no-node-snapshot \
 *     --require ts-node/register/transpile-only \
 *     Tests/Utils/JavaScriptSandbox/Helpers/MeasureStepCost.ts
 *
 * For #6115 it read about 0.3 s a step and 126 MB resident (105 MB
 * proportional) while a step ran.
 */

function readKilobytes(file: string, field: string): number | null {
  try {
    const line: string | undefined = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .find((entry: string): boolean => {
        return entry.startsWith(`${field}:`);
      });
    return line ? Number(line.replace(/[^0-9]/g, "")) : null;
  } catch {
    return null;
  }
}

const PROCESS_ID_PATTERN: RegExp = /^\d+$/;

function findStepProcess(): number | null {
  for (const entry of fs.readdirSync("/proc")) {
    if (!PROCESS_ID_PATTERN.test(entry)) {
      continue;
    }
    let status: string;
    try {
      status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
    } catch {
      continue;
    }
    const uidLine: string | undefined = status
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("Uid:");
      });
    const realUid: number = Number((uidLine || "").split(/\s+/)[1]);
    if (realUid >= SANDBOX_IDENTITY_MIN && realUid <= SANDBOX_IDENTITY_MAX) {
      return Number(entry);
    }
  }
  return null;
}

async function main(): Promise<void> {
  const identities: SandboxIdentityPool = new SandboxIdentityPool({
    launcherPath: SANDBOX_LAUNCHER_PATH,
    call: callLauncher,
    hasLiveProcess: hasLiveProcessOfUser,
  });

  const options: Parameters<typeof runSandboxedStep>[1] = {
    isolation: { isolation: SandboxIsolation.OwnUser, reason: null },
    identities,
    launcherPath: SANDBOX_LAUNCHER_PATH,
    network: await decideSandboxNetwork({
      noNetworkPath: SANDBOX_NO_NETWORK_PATH,
      call: callLauncher,
      platform: process.platform,
      exists: fs.existsSync,
    }),
    noNetworkPath: SANDBOX_NO_NETWORK_PATH,
    workerEntry: getDefaultWorkerEntry(),
    deadlineGraceMs: SANDBOX_DEADLINE_GRACE_MS,
  };

  const step: (script: string) => Promise<unknown> = (
    script: string,
  ): Promise<unknown> => {
    return runSandboxedStep(
      {
        script,
        args: {},
        timeoutInMs: 10_000,
        maxOutputBytes: 50_000,
        policy: { privateNetworkAccessIsAllowed: false },
      },
      options,
    );
  };

  const timings: Array<number> = [];

  for (let index: number = 0; index < 6; index++) {
    const started: number = Date.now();
    await step("return 1;");
    timings.push(Date.now() - started);
  }

  let peakRssKb: number = 0;
  let peakPssKb: number = 0;

  const sampler: ReturnType<typeof setInterval> = setInterval(() => {
    const pid: number | null = findStepProcess();
    if (pid === null) {
      return;
    }
    peakRssKb = Math.max(
      peakRssKb,
      readKilobytes(`/proc/${pid}/status`, "VmRSS") || 0,
    );
    peakPssKb = Math.max(
      peakPssKb,
      readKilobytes(`/proc/${pid}/smaps_rollup`, "Pss") || 0,
    );
  }, 50);

  await step("await sleep(2000); return 1;");
  clearInterval(sampler);

  process.stdout.write(
    `${JSON.stringify({
      workerEntry: options.workerEntry,
      timingsMs: timings,
      peakRssMb: Math.round(peakRssKb / 1024),
      peakPssMb: Math.round(peakPssKb / 1024),
    })}\n`,
  );
}

void main();
