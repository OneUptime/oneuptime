/*
 * ---------------------------------------------------------------------------
 * A RUNNER'S OWN KEY NEVER LEAVES IN WHAT A STEP PRINTED.
 *
 * A step runs without the Runner's own settings in its environment
 * (RunnerOwnEnvironment), but as the Runner's user: one that read the key
 * from somewhere else - the Runner's own process environment, a file the
 * key was mounted from - and printed it would hand it to everyone who reads
 * the runbook's runs. So before a step's result leaves the host, the
 * Runner's own credentials are replaced with [REDACTED], as the secret
 * runbook variables the step was handed are: the key it presents now (the
 * one the server issued at registration, or the one it was started with),
 * the ingestion key and the server's secret. The server hides the key again
 * (RunnerIngressResultHidesRunnerKey).
 *
 * The unit, then a REAL Bash step through Executor.executeAndReport, with
 * only the server calls mocked.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: {
      submitJobResult: jest.fn().mockResolvedValue(true),
      jobHeartbeat: jest.fn().mockResolvedValue(true),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import Executor, {
  redactRunnerCredentialsFromResult,
} from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import {
  MIN_REDACTED_RUNNER_CREDENTIAL_LENGTH,
  getRunnerOwnCredentialValues,
  redactRunnerOwnCredentials,
} from "../../Utils/RunnerCredentialRedaction";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;

const STARTED_WITH_KEY: string = "8c1f2a4e-6b7d-4e9f-a0b1-c2d3e4f5a6b7";
const ISSUED_KEY: string = "1d2c3b4a-0000-4000-8000-issuedatregister";
const INGESTION_KEY: string = "telemetry-ingestion-key-0123456789";
const SERVER_SECRET: string = "the-servers-cluster-secret-0123456789";

const NAMES: Array<string> = [
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_INGESTION_KEY",
  "ONEUPTIME_SECRET",
];

const saved: Record<string, string | undefined> = {};
let scratch: string;

beforeEach(() => {
  submitJobResult.mockClear();

  for (const name of NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }

  process.env["ONEUPTIME_RUNNER_KEY"] = STARTED_WITH_KEY;

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runner-credentials-"));
});

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }

  LocalCache.setString("RUNNER", "RUNNER_KEY", "");

  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("the Runner's own credentials", () => {
  test("are the key it was started with", () => {
    expect(getRunnerOwnCredentialValues()).toEqual([STARTED_WITH_KEY]);
  });

  test("and the key the server issued it at registration, the ingestion key and the server's secret", () => {
    LocalCache.setString("RUNNER", "RUNNER_KEY", ISSUED_KEY);
    process.env["ONEUPTIME_INGESTION_KEY"] = INGESTION_KEY;
    process.env["ONEUPTIME_SECRET"] = SERVER_SECRET;

    expect(getRunnerOwnCredentialValues().sort()).toEqual(
      [ISSUED_KEY, STARTED_WITH_KEY, INGESTION_KEY, SERVER_SECRET].sort(),
    );
  });

  test("each once, without the white space around it", () => {
    LocalCache.setString("RUNNER", "RUNNER_KEY", ` ${STARTED_WITH_KEY}\n`);

    expect(getRunnerOwnCredentialValues()).toEqual([STARTED_WITH_KEY]);
  });

  test("a value too short to look for safely is left out, whatever its name", () => {
    process.env["ONEUPTIME_RUNNER_KEY"] = "a".repeat(
      MIN_REDACTED_RUNNER_CREDENTIAL_LENGTH - 1,
    );
    process.env["ONEUPTIME_SECRET"] = "true";

    expect(getRunnerOwnCredentialValues()).toEqual([]);
  });

  test("a Runner that holds none has none", () => {
    delete process.env["ONEUPTIME_RUNNER_KEY"];

    expect(getRunnerOwnCredentialValues()).toEqual([]);
    expect(redactRunnerOwnCredentials("nothing to hide")).toBe(
      "nothing to hide",
    );
  });
});

describe("redactRunnerOwnCredentials", () => {
  test("replaces each with [REDACTED], every time it is there", () => {
    process.env["ONEUPTIME_INGESTION_KEY"] = INGESTION_KEY;

    expect(
      redactRunnerOwnCredentials(
        `key=${STARTED_WITH_KEY}\n${STARTED_WITH_KEY} ingest=${INGESTION_KEY}`,
      ),
    ).toBe(
      `key=${REDACTED_SECRET_TEXT}\n${REDACTED_SECRET_TEXT} ingest=${REDACTED_SECRET_TEXT}`,
    );
  });

  test("leaves everything else as it is", () => {
    expect(
      redactRunnerOwnCredentials("NAME READY\nweb-1 1/1\nRunner id 6f1e2d3c"),
    ).toBe("NAME READY\nweb-1 1/1\nRunner id 6f1e2d3c");
    expect(redactRunnerOwnCredentials("")).toBe("");
  });

  test("the key the server issued is hidden though the Runner was started with another", () => {
    LocalCache.setString("RUNNER", "RUNNER_KEY", ISSUED_KEY);

    expect(redactRunnerOwnCredentials(`now ${ISSUED_KEY}`)).toBe(
      `now ${REDACTED_SECRET_TEXT}`,
    );
  });
});

describe("redactRunnerCredentialsFromResult", () => {
  test("hides them in the output and in the error message", () => {
    expect(
      redactRunnerCredentialsFromResult({
        success: false,
        output: `[stdout]\n${STARTED_WITH_KEY}`,
        exitCode: 1,
        errorMessage: `could not reach ${STARTED_WITH_KEY}.example`,
      }),
    ).toEqual({
      success: false,
      output: `[stdout]\n${REDACTED_SECRET_TEXT}`,
      exitCode: 1,
      errorMessage: `could not reach ${REDACTED_SECRET_TEXT}.example`,
    });
  });

  test("a result that holds none is handed back as it is", () => {
    const result: {
      success: boolean;
      output: string;
      exitCode?: number | undefined;
    } = { success: true, output: "[stdout]\nok", exitCode: 0 };

    expect(redactRunnerCredentialsFromResult(result)).toBe(result);
  });

  test("a result with no error message is not given one", () => {
    expect(
      redactRunnerCredentialsFromResult({
        success: true,
        output: STARTED_WITH_KEY,
      }),
    ).toEqual({ success: true, output: REDACTED_SECRET_TEXT });
  });
});

describe("a Bash step that finds the key elsewhere and prints it", () => {
  function bashJob(script: string): ClaimedJob {
    return {
      jobId: "job-1",
      runbookExecutionId: "execution-1",
      origin: "Runbook",
      stepId: "step-1",
      stepType: "Bash",
      script: script,
      timeoutInMs: 20_000,
    } as unknown as ClaimedJob;
  }

  async function reported(script: string): Promise<{
    success: boolean;
    output: string;
    errorMessage?: string;
  }> {
    await Executor.executeAndReport(bashJob(script));

    expect(submitJobResult).toHaveBeenCalledTimes(1);

    return submitJobResult.mock.calls[0]![0] as {
      success: boolean;
      output: string;
      errorMessage?: string;
    };
  }

  test("a key read from where it was mounted is sent as [REDACTED]", async () => {
    const mounted: string = path.join(scratch, "runner-key");
    fs.writeFileSync(mounted, STARTED_WITH_KEY);

    const result: { success: boolean; output: string } = await reported(
      `echo "found: $(cat ${mounted})"`,
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(`[stdout]\nfound: ${REDACTED_SECRET_TEXT}\n`);
    expect(JSON.stringify(submitJobResult.mock.calls)).not.toContain(
      STARTED_WITH_KEY,
    );
  });

  test("on stderr, from a failing step, too", async () => {
    const mounted: string = path.join(scratch, "runner-key");
    fs.writeFileSync(mounted, STARTED_WITH_KEY);

    const result: {
      success: boolean;
      output: string;
      errorMessage?: string;
    } = await reported(`cat ${mounted} >&2; exit 4`);

    expect(result.success).toBe(false);
    expect(result.output).toBe(`[stderr]\n${REDACTED_SECRET_TEXT}`);
    expect(result.errorMessage).toBe("Exit code 4");
    expect(JSON.stringify(submitJobResult.mock.calls)).not.toContain(
      STARTED_WITH_KEY,
    );
  });

  test("the key the server issued at registration, too", async () => {
    LocalCache.setString("RUNNER", "RUNNER_KEY", ISSUED_KEY);

    const result: { success: boolean; output: string } = await reported(
      `echo "${ISSUED_KEY}"`,
    );

    expect(result.output).toBe(`[stdout]\n${REDACTED_SECRET_TEXT}\n`);
  });

  test("negative control: what a step prints otherwise is sent as it is", async () => {
    const result: { success: boolean; output: string } =
      await reported('echo "disk at 91%"');

    expect(result.output).toBe("[stdout]\ndisk at 91%\n");
  });
});
