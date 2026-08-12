/*
 * ---------------------------------------------------------------------------
 * TaskLogger as the last gate before a run's trail leaves the process.
 *
 * Everything this class buffers is POSTed to the server, stored against the
 * run, and rendered on its Logs page. Three kinds of content flow through it,
 * and all three can carry a credential:
 *
 *   - the one-line NARRATION, which callers build from raw git error messages
 *     (and Node puts the whole command line into those);
 *   - the verbatim tool ARGUMENTS — a `write_file` call's `content` is an
 *     entire source file, which can perfectly well contain a secret the model
 *     just read out of the repository it is fixing;
 *   - the verbatim tool RESULT, which is whatever a model-composed shell
 *     command printed.
 *
 * Redacting here rather than at each call site is the point: it is the one
 * place every one of them passes through, so no future caller can forget.
 * ---------------------------------------------------------------------------
 */

import TaskLogger from "../../Utils/TaskLogger";
import SecretRedactor from "../../Utils/SecretRedactor";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const TOKEN: string = "ghs_16C7e42F292c6912E7710c838347Ae178B4a";

// Everything sent to the server across every flush, in order.
function sentBodies(): Array<JSONObject> {
  return postMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function okResponse(): { isSuccess: () => boolean; data: JSONObject } {
  return {
    isSuccess: () => {
      return true;
    },
    data: {},
  };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue(okResponse());
  SecretRedactor.clearRegistered();
});

afterEach(() => {
  SecretRedactor.clearRegistered();
});

function buildLogger(): TaskLogger {
  return new TaskLogger({
    taskId: "11111111-2222-4333-8444-555555555555",
    context: "Fix Exception Handler",
    // Large enough that nothing auto-flushes mid-test.
    batchSize: 1000,
    flushIntervalMs: 60_000,
  });
}

describe("redaction on the way out", () => {
  test("a token in a log message never reaches the server", async () => {
    SecretRedactor.register(TOKEN, "repository-token");
    const logger: TaskLogger = buildLogger();

    try {
      await logger.error(
        `Failed to process repository acme/checkout: Command failed: ` +
          `git push https://x-access-token:${TOKEN}@github.com/acme/checkout.git`,
      );

      const message: string = sentBodies()[0]?.["message"] as string;

      expect(message).not.toContain(TOKEN);
      expect(message).toContain("[redacted:repository-token]");
      // The rest of the message survives so the failure is still diagnosable.
      expect(message).toContain("Failed to process repository acme/checkout");
    } finally {
      await logger.dispose();
    }
  });

  /*
   * The tool ARGUMENTS are stored verbatim on the run's transcript. A
   * `write_file` whose content happens to include a credential the model read
   * out of the repository would otherwise be persisted in full.
   */
  test("a secret nested in tool arguments is redacted", async () => {
    SecretRedactor.register(TOKEN, "repository-token");
    const logger: TaskLogger = buildLogger();

    try {
      await logger.toolCall({
        toolName: "write_file",
        message: "wrote src/config.ts (120 chars)",
        toolArguments: {
          path: "src/config.ts",
          content: `export const token: string = "${TOKEN}";`,
        },
        toolResult: `Wrote 120 characters to src/config.ts.`,
      });
      await logger.flush();

      const body: JSONObject = sentBodies()[0] as JSONObject;

      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect((body["toolArguments"] as JSONObject)["path"]).toBe(
        "src/config.ts",
      );
    } finally {
      await logger.dispose();
    }
  });

  test("a secret in a tool result is redacted", async () => {
    SecretRedactor.register(TOKEN, "repository-token");
    const logger: TaskLogger = buildLogger();

    try {
      await logger.toolCall({
        toolName: "run_command",
        message: "ran env (exit 0)",
        toolArguments: { command: "env" },
        toolResult: `GITHUB_TOKEN=${TOKEN}\nPATH=/usr/bin`,
      });
      await logger.flush();

      const body: JSONObject = sentBodies()[0] as JSONObject;

      expect(body["toolResult"]).not.toContain(TOKEN);
      expect(body["toolResult"]).toContain("PATH=/usr/bin");
    } finally {
      await logger.dispose();
    }
  });

  test("an unregistered credential shape is still caught by the pattern pass", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.info("found AKIAIOSFODNN7EXAMPLE in the repository config");
      await logger.flush();

      expect(sentBodies()[0]?.["message"]).not.toContain(
        "AKIAIOSFODNN7EXAMPLE",
      );
    } finally {
      await logger.dispose();
    }
  });

  test("ordinary log lines are passed through unchanged", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.info("Code agent modified 3 file(s)");
      await logger.flush();

      expect(sentBodies()[0]?.["message"]).toContain(
        "Code agent modified 3 file(s)",
      );
    } finally {
      await logger.dispose();
    }
  });
});

describe("buffering and delivery", () => {
  test("nothing is sent until a flush", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.info("one");
      await logger.info("two");

      expect(postMock).not.toHaveBeenCalled();

      await logger.flush();

      expect(postMock).toHaveBeenCalledTimes(2);
    } finally {
      await logger.dispose();
    }
  });

  /*
   * An error is the line an operator is most likely to be waiting for, and
   * the run may be about to die. It flushes immediately rather than sitting
   * in a buffer that a crash would discard.
   */
  test("an error flushes immediately", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.error("clone failed");

      expect(postMock).toHaveBeenCalledTimes(1);
    } finally {
      await logger.dispose();
    }
  });

  test("a full batch auto-flushes without waiting for the timer", async () => {
    const logger: TaskLogger = new TaskLogger({
      taskId: "task",
      batchSize: 3,
      flushIntervalMs: 60_000,
    });

    try {
      await logger.info("one");
      await logger.info("two");
      await logger.info("three");

      // The auto-flush is fire-and-forget; give it a turn of the loop.
      await new Promise((resolve: (value: unknown) => void) => {
        setImmediate(resolve);
      });

      expect(postMock).toHaveBeenCalledTimes(3);
    } finally {
      await logger.dispose();
    }
  });

  test("flushing an empty buffer sends nothing", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.flush();

      expect(postMock).not.toHaveBeenCalled();
    } finally {
      await logger.dispose();
    }
  });

  test("the severity and the run id travel with every line", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.warning("verification failed");
      await logger.flush();

      const body: JSONObject = sentBodies()[0] as JSONObject;

      expect(body["severity"]).toBe(LogSeverity.Warning);
      expect(body["taskId"]).toBe("11111111-2222-4333-8444-555555555555");
    } finally {
      await logger.dispose();
    }
  });

  test("the handler context is stamped into the rendered line", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.info("Running code agent...");
      await logger.flush();

      expect(sentBodies()[0]?.["message"]).toContain("[Fix Exception Handler]");
    } finally {
      await logger.dispose();
    }
  });

  /*
   * A dropped log line must never take the fix run down with it: the run's
   * work is the pull request, not its trail.
   */
  test("a server that rejects a log line does not break the caller", async () => {
    postMock.mockResolvedValue({
      isSuccess: () => {
        return false;
      },
      data: {},
    });

    const logger: TaskLogger = buildLogger();

    try {
      await expect(logger.info("one")).resolves.toBeUndefined();
      await expect(logger.flush()).resolves.toBeUndefined();
    } finally {
      await logger.dispose();
    }
  });

  test("a network failure while shipping logs does not break the caller", async () => {
    postMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const logger: TaskLogger = buildLogger();

    try {
      await logger.info("one");
      await expect(logger.flush()).resolves.toBeUndefined();
    } finally {
      await logger.dispose();
    }
  });

  test("logProcessOutput splits multi-line output into separate lines", async () => {
    const logger: TaskLogger = buildLogger();

    try {
      await logger.logProcessOutput("CodeAgent", "first\n\nsecond\n   \nthird");
      await logger.flush();

      const messages: Array<string> = sentBodies().map((body: JSONObject) => {
        return body["message"] as string;
      });

      // Blank lines are dropped; each real line is its own entry.
      expect(messages).toHaveLength(3);
      expect(messages[0]).toContain("[CodeAgent] first");
      expect(messages[2]).toContain("[CodeAgent] third");
    } finally {
      await logger.dispose();
    }
  });

  test("a child logger keeps the run id and nests the context", async () => {
    const logger: TaskLogger = buildLogger();
    const child: TaskLogger = logger.createChildLogger("BuildVerification");

    try {
      await child.info("Verifying the fix...");
      await child.flush();

      const body: JSONObject = sentBodies()[0] as JSONObject;

      expect(body["taskId"]).toBe("11111111-2222-4333-8444-555555555555");
      expect(body["message"]).toContain(
        "[Fix Exception Handler:BuildVerification]",
      );
    } finally {
      await child.dispose();
      await logger.dispose();
    }
  });
});
