import {
  SANDBOX_DEADLINE_GRACE_MS,
  SandboxWorkerEntry,
  getDefaultWorkerEntry,
  runSandboxedStep,
} from "../../../../Utils/JavaScriptSandbox/SandboxProcess";
import {
  SANDBOX_LAUNCHER_PATH,
  SandboxIdentityPool,
  SandboxIsolation,
  SandboxIsolationDecision,
  callLauncher,
  decideSandboxIsolation,
  hasLiveProcessOfUser,
} from "../../../../Utils/JavaScriptSandbox/SandboxIdentity";
import { JavaScriptStepOutcome } from "../../../../Utils/JavaScriptSandbox/JavaScriptStepResult";
import fs from "fs";
import path from "path";

/*
 * Runs inside the launcher's test container (SandboxLauncherInDocker.test.ts),
 * as the Runner's user, with the launcher installed setuid as the image
 * installs it: real steps through runSandboxedStep, each as a user of its
 * own, and prints one JSON report. Not a test file itself.
 */

async function main(): Promise<void> {
  const decision: SandboxIsolationDecision = await decideSandboxIsolation({
    launcherPath: SANDBOX_LAUNCHER_PATH,
    call: callLauncher,
    platform: process.platform,
    launcherExists: fs.existsSync,
  });

  const identities: SandboxIdentityPool = new SandboxIdentityPool({
    launcherPath: SANDBOX_LAUNCHER_PATH,
    call: callLauncher,
    hasLiveProcess: hasLiveProcessOfUser,
  });

  const escapedEntry: SandboxWorkerEntry = {
    path: path.join(__dirname, "EscapedStep.js"),
    kind: "source",
  };

  const run: (
    script: string,
    entry?: SandboxWorkerEntry,
  ) => Promise<JavaScriptStepOutcome> = (
    script: string,
    entry?: SandboxWorkerEntry,
  ): Promise<JavaScriptStepOutcome> => {
    return runSandboxedStep(
      {
        script,
        args: { greeting: "hello" },
        timeoutInMs: 5000,
        maxOutputBytes: 50_000,
        policy: {
          allowPrivateNetworkRequests: false,
          privateNetworkAccessIsAllowed: false,
          includeResolutionDetailInError: false,
        },
      },
      {
        isolation: decision,
        identities:
          decision.isolation === SandboxIsolation.OwnUser ? identities : null,
        launcherPath: SANDBOX_LAUNCHER_PATH,
        workerEntry: entry || getDefaultWorkerEntry(),
        deadlineGraceMs: SANDBOX_DEADLINE_GRACE_MS,
      },
    );
  };

  const started: number = Date.now();
  const returned: JavaScriptStepOutcome = await run(
    "console.log(args.greeting); return 6 * 7;",
  );
  const returnedMs: number = Date.now() - started;

  const concurrent: Array<JavaScriptStepOutcome> = await Promise.all([
    run("return 1;"),
    run("return 2;"),
    run("return 3;"),
  ]);

  const privateAddress: JavaScriptStepOutcome = await run(
    "await axios.get('http://127.0.0.1:9/'); return 'reached';",
  );

  process.stdout.write(
    `${JSON.stringify({
      decision,
      workerEntry: getDefaultWorkerEntry(),
      returned,
      returnedMs,
      concurrent,
      privateAddress,
      activeAfter: identities.activeCount,
      escapedEntry: escapedEntry.path,
    })}\n`,
  );
}

void main();
