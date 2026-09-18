/*
 * ---------------------------------------------------------------------------
 * The task log is what a customer reads when a code fix does something they
 * did not expect, and it is shipped over the network from a worker that may
 * be running with the control plane already unreachable.
 *
 * That gives it one rule above all others: SENDING A LOG LINE MUST NEVER TAKE
 * THE TASK DOWN. Every failure mode - a non-200, a rejected request, a
 * transport error - has to come back as `false` and nothing else. A throw here
 * would abort a fix run because its narration failed, which is precisely
 * backwards.
 *
 * The rest is about the lines themselves. "No fix found" is not an error and
 * must not be logged as one: it is the ordinary outcome of a run that looked
 * and found nothing, and colouring it red trains people to ignore the log.
 * An error, on the other hand, must actually carry the reason - a red line
 * that says only "failed" sends the reader to the Runner's own logs, which
 * customers cannot see.
 * ---------------------------------------------------------------------------
 */

import AIAgentTaskLog from "../../Utils/CodeFixTaskLog";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";

const TASK_ID: string = "11111111-2222-4333-8444-555555555555";

interface ApiPostSpy {
  mock: { calls: Array<Array<unknown>> };
}

type MockPostFunction = (statusCode: number) => ApiPostSpy;

const mockPost: MockPostFunction = (statusCode: number): ApiPostSpy => {
  return jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(statusCode, {}, {}) as never,
    ) as unknown as ApiPostSpy;
};

type ReadSentBodyFunction = (spy: ApiPostSpy) => JSONObject;

const readSentBody: ReadSentBodyFunction = (spy: ApiPostSpy): JSONObject => {
  const call: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
    string,
    unknown
  >;

  return call["data"] as JSONObject;
};

describe("AIAgentTaskLog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("sendLog", () => {
    test("reports success when the control plane accepts the line", async () => {
      mockPost(200);

      await expect(
        AIAgentTaskLog.sendLog({
          taskId: TASK_ID,
          severity: LogSeverity.Information,
          message: "hello",
        }),
      ).resolves.toBe(true);
    });

    test("sends the task id, severity and message it was given", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendLog({
        taskId: TASK_ID,
        severity: LogSeverity.Warning,
        message: "something to say",
      });

      const body: JSONObject = readSentBody(spy);

      expect(body["taskId"]).toBe(TASK_ID);
      expect(body["severity"]).toBe(LogSeverity.Warning);
      expect(body["message"]).toBe("something to say");
    });

    test("authenticates as this runner on every line", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendLog({
        taskId: TASK_ID,
        severity: LogSeverity.Information,
        message: "hello",
      });

      const body: JSONObject = readSentBody(spy);
      const credentials: JSONObject = RunnerAPIRequest.getDefaultRequestBody();

      expect(body["aiAgentKey"]).toBe(credentials["aiAgentKey"]);
      expect(body["aiAgentId"]).toBe(credentials["aiAgentId"]);
    });

    test("posts to the create-log route", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendLog({
        taskId: TASK_ID,
        severity: LogSeverity.Information,
        message: "hello",
      });

      const call: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(String(call["url"])).toContain(
        "/api/ai-agent-task-log/create-log",
      );
    });

    /*
     * The URL is memoised behind a null check. Building it twice would be
     * harmless; NOT rebuilding it after the first call is the behaviour worth
     * pinning, because a mutable static that is only ever half-initialised is
     * how a second call ends up posting somewhere else.
     */
    test("posts to the same route on a second call", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendLog({
        taskId: TASK_ID,
        severity: LogSeverity.Information,
        message: "one",
      });
      await AIAgentTaskLog.sendLog({
        taskId: TASK_ID,
        severity: LogSeverity.Information,
        message: "two",
      });

      const first: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      const second: Record<string, unknown> = spy.mock.calls[1]![0] as Record<
        string,
        unknown
      >;

      expect(String(second["url"])).toBe(String(first["url"]));
    });
  });

  describe("a log line never takes the task down", () => {
    test("returns false, not a throw, on a non-200", async () => {
      mockPost(500);

      await expect(
        AIAgentTaskLog.sendLog({
          taskId: TASK_ID,
          severity: LogSeverity.Information,
          message: "hello",
        }),
      ).resolves.toBe(false);
    });

    test("returns false on a 4xx too", async () => {
      mockPost(401);

      await expect(
        AIAgentTaskLog.sendLog({
          taskId: TASK_ID,
          severity: LogSeverity.Information,
          message: "hello",
        }),
      ).resolves.toBe(false);
    });

    test("returns false when the request rejects outright", async () => {
      jest
        .spyOn(API, "post")
        .mockRejectedValue(new Error("ECONNREFUSED") as never);

      await expect(
        AIAgentTaskLog.sendLog({
          taskId: TASK_ID,
          severity: LogSeverity.Information,
          message: "hello",
        }),
      ).resolves.toBe(false);
    });

    test("every convenience wrapper swallows a transport failure too", async () => {
      jest
        .spyOn(API, "post")
        .mockRejectedValue(new Error("ECONNREFUSED") as never);

      await expect(AIAgentTaskLog.sendTaskStartedLog(TASK_ID)).resolves.toBe(
        false,
      );
      await expect(AIAgentTaskLog.sendTaskCompletedLog(TASK_ID)).resolves.toBe(
        false,
      );
      await expect(
        AIAgentTaskLog.sendTaskNoFixFoundLog(TASK_ID, "nothing to change"),
      ).resolves.toBe(false);
      await expect(
        AIAgentTaskLog.sendTaskErrorLog(TASK_ID, "boom"),
      ).resolves.toBe(false);
    });
  });

  describe("the lines each wrapper writes", () => {
    test("a started line is informational", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskStartedLog(TASK_ID);

      const body: JSONObject = readSentBody(spy);

      expect(body["severity"]).toBe(LogSeverity.Information);
      expect(body["message"]).toBe("Task execution started");
    });

    test("a completed line is informational", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskCompletedLog(TASK_ID);

      const body: JSONObject = readSentBody(spy);

      expect(body["severity"]).toBe(LogSeverity.Information);
      expect(body["message"]).toBe("Task execution completed successfully");
    });

    /*
     * A run that looked and found nothing is an ordinary outcome, not a
     * failure. Logging it as an Error would put a red line on the customer's
     * Logs page every time the agent correctly decided there was nothing to
     * change.
     */
    test("no-fix-found is informational, not an error", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskNoFixFoundLog(TASK_ID, "nothing to change");

      const body: JSONObject = readSentBody(spy);

      expect(body["severity"]).toBe(LogSeverity.Information);
      expect(body["severity"]).not.toBe(LogSeverity.Error);
    });

    test("no-fix-found carries the reason when there is one", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskNoFixFoundLog(TASK_ID, "nothing to change");

      expect(readSentBody(spy)["message"]).toBe(
        "Task execution completed with no fix to propose: nothing to change",
      );
    });

    /*
     * An empty reason must not produce a line ending in a dangling colon -
     * that reads as a truncated message and sends the reader looking for the
     * rest of it.
     */
    test("no-fix-found reads cleanly when there is no reason", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskNoFixFoundLog(TASK_ID, "");

      const message: string = readSentBody(spy)["message"] as string;

      expect(message).toBe("Task execution completed with no fix to propose");
      expect(message.endsWith(":")).toBe(false);
    });

    test("an error line is severity Error", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskErrorLog(TASK_ID, "boom");

      expect(readSentBody(spy)["severity"]).toBe(LogSeverity.Error);
    });

    /*
     * The reason has to survive into the line. A red "Task execution failed"
     * with nothing after it sends the customer to the Runner's own logs,
     * which they cannot see.
     */
    test("an error line carries the reason", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskErrorLog(TASK_ID, "git clone timed out");

      expect(readSentBody(spy)["message"]).toBe(
        "Task execution failed: git clone timed out",
      );
    });

    test("every wrapper stamps the task it was told about", async () => {
      const spy: ApiPostSpy = mockPost(200);

      await AIAgentTaskLog.sendTaskStartedLog(TASK_ID);
      await AIAgentTaskLog.sendTaskCompletedLog(TASK_ID);
      await AIAgentTaskLog.sendTaskNoFixFoundLog(TASK_ID, "reason");
      await AIAgentTaskLog.sendTaskErrorLog(TASK_ID, "boom");

      for (const call of spy.mock.calls) {
        const body: JSONObject = (call[0] as Record<string, unknown>)[
          "data"
        ] as JSONObject;

        expect(body["taskId"]).toBe(TASK_ID);
      }
    });
  });
});
