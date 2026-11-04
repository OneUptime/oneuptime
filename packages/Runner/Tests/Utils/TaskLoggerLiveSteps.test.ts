/*
 * ---------------------------------------------------------------------------
 * A step reaches the server as the Runner takes it.
 *
 * The server announces every line a run reports to the pages open on it
 * (Common/Server/Utils/AI/CodeTask/CodeTaskLive), so a task's conversation
 * in Code shows each step as AI takes it - provided the line is sent when
 * it is written. TaskLogger used to hold lines for a five-second timer.
 * Now a line waits a quarter of a second, so the lines a step writes
 * together go together, and the lines of a task are sent one at a time, in
 * the order they were written, whichever of its loggers wrote them: the
 * server numbers a run's lines as they arrive.
 *
 * Real timers, not jest's fake ones: this jest version cannot install fake
 * timers on the Node the Runner ships with.
 * ---------------------------------------------------------------------------
 */

import TaskLogger, { DEFAULT_LOG_SEND_DELAY_MS } from "../../Utils/TaskLogger";
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

const TASK_ID: string = "11111111-2222-4333-8444-555555555555";

function okResponse(): { isSuccess: () => boolean; data: JSONObject } {
  return {
    isSuccess: () => {
      return true;
    },
    data: {},
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

// The narration of every line sent, in the order the server received them.
function sentMessages(): Array<string> {
  return postMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: JSONObject }).data["message"] as string;
  });
}

/*
 * A server that takes `delayMs` to answer each line, and remembers how many
 * lines were on their way to it at once.
 */
function slowServer(delayMs: number): { mostAtOnce: () => number } {
  let inFlight: number = 0;
  let mostAtOnce: number = 0;

  postMock.mockImplementation(async () => {
    inFlight++;
    mostAtOnce = Math.max(mostAtOnce, inFlight);
    await sleep(delayMs);
    inFlight--;
    return okResponse();
  });

  return {
    mostAtOnce: (): number => {
      return mostAtOnce;
    },
  };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue(okResponse());
});

describe("a step is sent as it happens", () => {
  test("a line waits a quarter of a second, not five", () => {
    expect(DEFAULT_LOG_SEND_DELAY_MS).toBe(250);
  });

  test("a tool call reaches the server within the send delay, with no flush asked for", async () => {
    const logger: TaskLogger = new TaskLogger({ taskId: TASK_ID });

    try {
      await logger.toolCall({
        toolName: "read_file",
        message: "read src/payments/client.ts",
        toolArguments: { path: "src/payments/client.ts" },
        toolResult: "export const client = 1;",
      });

      // Written, not yet sent: the lines of a step go together.
      expect(postMock).not.toHaveBeenCalled();

      await sleep(DEFAULT_LOG_SEND_DELAY_MS + 250);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(sentMessages()[0]).toContain("read src/payments/client.ts");
      expect(
        (postMock.mock.calls[0]![0] as { data: JSONObject }).data["toolName"],
      ).toBe("read_file");
    } finally {
      await logger.dispose();
    }
  });

  test("the lines a step writes together go in one send, in the order written", async () => {
    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      flushIntervalMs: 60,
    });
    const flushSpy: jest.SpyInstance = jest.spyOn(logger, "flush");

    try {
      await logger.toolCall({ toolName: "write_file", message: "wrote a.ts" });
      await logger.info("Edited a.ts");
      await logger.toolCall({
        toolName: "run_command",
        message: "ran npm test",
      });

      await sleep(250);

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(sentMessages()).toHaveLength(3);
      expect(sentMessages()[0]).toContain("wrote a.ts");
      expect(sentMessages()[1]).toContain("Edited a.ts");
      expect(sentMessages()[2]).toContain("ran npm test");
    } finally {
      flushSpy.mockRestore();
      await logger.dispose();
    }
  });

  test("each later step is sent on its own delay, not held for a timer", async () => {
    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      flushIntervalMs: 40,
    });

    try {
      await logger.info("first step");
      await sleep(150);
      expect(sentMessages()).toHaveLength(1);

      await logger.info("second step");
      await sleep(150);
      expect(sentMessages()).toHaveLength(2);
      expect(sentMessages()[1]).toContain("second step");
    } finally {
      await logger.dispose();
    }
  });
});

describe("a task's lines go one at a time, in order", () => {
  test("never two lines on their way at once, however the sends are asked for", async () => {
    const server: { mostAtOnce: () => number } = slowServer(30);
    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      // Two lines a send, so a burst asks for several sends at once.
      batchSize: 2,
      flushIntervalMs: 10,
    });

    try {
      for (let index: number = 1; index <= 7; index++) {
        await logger.info(`line ${index}`);
      }

      await logger.dispose();

      expect(server.mostAtOnce()).toBe(1);
      expect(
        sentMessages().map((message: string): string => {
          return message.substring(message.indexOf("line "));
        }),
      ).toEqual([
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
      ]);
    } finally {
      await logger.dispose();
    }
  });

  test("a child logger's lines take their turn after the parent's on their way", async () => {
    const server: { mostAtOnce: () => number } = slowServer(40);
    const parent: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      context: "Handler",
      flushIntervalMs: 10,
    });
    const child: TaskLogger = parent.createChildLogger("Agent");

    try {
      await parent.info("cloned the repository");
      // The parent's line is on its way...
      await sleep(20);
      // ...when the child writes and asks for its line to go now.
      await child.info("read src/index.ts");
      await child.flush();

      expect(server.mostAtOnce()).toBe(1);
      expect(sentMessages()).toHaveLength(2);
      expect(sentMessages()[0]).toContain("cloned the repository");
      expect(sentMessages()[1]).toContain("[Handler:Agent]");
      expect(sentMessages()[1]).toContain("read src/index.ts");
    } finally {
      await child.dispose();
      await parent.dispose();
    }
  });

  test("a line the server refused does not hold back the next", async () => {
    postMock
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(okResponse());

    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      flushIntervalMs: 10,
    });

    try {
      await logger.info("lost on the way");
      await sleep(60);
      await logger.info("the next step");
      await sleep(60);

      expect(sentMessages()).toHaveLength(2);
      expect(sentMessages()[1]).toContain("the next step");
    } finally {
      await logger.dispose();
    }
  });

  test("dispose waits for the lines already on their way", async () => {
    slowServer(60);
    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      flushIntervalMs: 10,
    });

    await logger.info("pushed the branch");
    // On its way (sent after 10 ms, answered after 60 more).
    await sleep(30);

    let isDisposed: boolean = false;
    const disposing: Promise<void> = logger.dispose().then((): void => {
      isDisposed = true;
    });

    await sleep(5);
    expect(isDisposed).toBe(false);

    await disposing;
    expect(isDisposed).toBe(true);
    expect(sentMessages()).toHaveLength(1);
  });

  test("an error line is sent at once, after what is already waiting", async () => {
    const logger: TaskLogger = new TaskLogger({
      taskId: TASK_ID,
      flushIntervalMs: 60_000,
    });

    try {
      await logger.info("ran npm test");
      await logger.error("npm test failed");

      expect(sentMessages()).toHaveLength(2);
      expect(sentMessages()[0]).toContain("ran npm test");
      expect(sentMessages()[1]).toContain("npm test failed");
    } finally {
      await logger.dispose();
    }
  });
});
