import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE,
  CODE_TASK_LIMITS,
  CODE_TASK_LOG_WINDOWS_IN_HOURS,
  CodeTaskBranchName,
  CodeTaskChangeStats,
  CodeTaskContextInput,
  CodeTaskContextInputUtil,
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskState,
  CodeTaskStateUtil,
  CodeTaskTitle,
  DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
  DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS,
} from "../../../Types/AI/CodeTask";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../../Types/AI/CodeFixTaskType";
import { getCodeTaskRequest } from "../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * What a person can add to a request in Code is checked on both sides with
 * the same rules (the Dashboard's dialog before it is added, the server
 * before anything is read): these pin them. A path can never leave the
 * repository, a link is only a web address, a record is named by a real id,
 * and nothing malformed is ever passed on.
 */

const INCIDENT_ID: string = "6a0e2d4c-1b3f-4e5a-8c7d-9f0e1a2b3c4d";
const SERVICE_ID: string = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function refusal(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as BadDataException).message;
  }

  throw new Error("Expected a refusal, but the input was accepted.");
}

describe("CodeTaskContextInputUtil.normalizePath", () => {
  test.each([
    ["src/api/users.ts", "src/api/users.ts"],
    ["/src/api/users.ts", "src/api/users.ts"],
    ["./src/api/users.ts", "src/api/users.ts"],
    [".//src//api/", "src/api"],
    ["src\\api\\users.ts", "src/api/users.ts"],
    ["  packages/App/  ", "packages/App"],
    ["README.md", "README.md"],
    [".github/workflows/ci.yaml", ".github/workflows/ci.yaml"],
  ])("reads %j as the repository path %j", (raw: string, path: string) => {
    expect(CodeTaskContextInputUtil.normalizePath(raw)).toBe(path);
  });

  test.each([
    "../secrets.txt",
    "src/../../etc/passwd",
    "src/..",
    "..\\windows\\system32",
    "src/./api",
  ])("never lets %j step outside the repository", (raw: string) => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.normalizePath(raw);
      }),
    ).toBe("A path must stay inside the repository (no '..').");
  });

  test.each(["src/\u0000.ts", "src/a\nb.ts", "src/\u007f"])(
    "refuses control characters (%j)",
    (raw: string) => {
      expect(
        refusal(() => {
          return CodeTaskContextInputUtil.normalizePath(raw);
        }),
      ).toBe("A path cannot hold control characters.");
    },
  );

  test.each(["", "   ", "/", "./", "///"])(
    "asks for a path when there is none (%j)",
    (raw: string) => {
      expect(
        refusal(() => {
          return CodeTaskContextInputUtil.normalizePath(raw);
        }),
      ).toBe("A file needs a path in the repository.");
    },
  );

  test("refuses a path that is too long, and anything that is not text", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.normalizePath(
          "a".repeat(CODE_TASK_LIMITS.maxPathLength + 1),
        );
      }),
    ).toContain(`at most ${CODE_TASK_LIMITS.maxPathLength} characters`);
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.normalizePath(42);
      }),
    ).toBe("A file needs a path in the repository.");
  });
});

describe("CodeTaskContextInputUtil.readItem", () => {
  test("a note keeps its text, trimmed", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Note",
        text: "  TypeError at checkout  ",
      }),
    ).toEqual({
      type: CodeTaskContextType.Note,
      text: "TypeError at checkout",
    });
  });

  test("an empty or oversized note is refused with what is wrong", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({ type: "Note", text: " " });
      }),
    ).toBe("A note cannot be empty.");
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({
          type: "Note",
          text: "x".repeat(CODE_TASK_LIMITS.maxNoteLength + 1),
        });
      }),
    ).toContain(`at most ${CODE_TASK_LIMITS.maxNoteLength} characters`);
  });

  test("a link is a full http(s) address, with an optional name", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Link",
        url: "https://docs.example.com/spec#retries",
        title: "  Retry spec  ",
      }),
    ).toEqual({
      type: CodeTaskContextType.Link,
      url: "https://docs.example.com/spec#retries",
      title: "Retry spec",
    });

    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Link",
        url: "http://intranet.example/wiki",
      }),
    ).toEqual({
      type: CodeTaskContextType.Link,
      url: "http://intranet.example/wiki",
    });
  });

  test.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "data:text/html,<script>alert(1)</script>",
    "docs.example.com/spec",
    "not a url",
  ])("a link that is not a web address is refused (%j)", (url: string) => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({ type: "Link", url });
      }),
    ).toBe(
      "A link must be a full web address, starting with https:// or http://.",
    );
  });

  test("a link's name is cut to its limit", () => {
    const item: CodeTaskContextInput = CodeTaskContextInputUtil.readItem({
      type: "Link",
      url: "https://example.com",
      title: "n".repeat(CODE_TASK_LIMITS.maxLinkTitleLength + 50),
    });

    expect(item.title).toHaveLength(CODE_TASK_LIMITS.maxLinkTitleLength);
  });

  test.each([
    [CodeTaskContextType.Incident, "incident"],
    [CodeTaskContextType.Alert, "alert"],
    [CodeTaskContextType.Exception, "exception"],
    [CodeTaskContextType.Monitor, "monitor"],
  ])(
    "a %s is named by its id, read in lower case",
    (type: CodeTaskContextType, word: string) => {
      expect(
        CodeTaskContextInputUtil.readItem({
          type,
          id: INCIDENT_ID.toUpperCase(),
        }),
      ).toEqual({ type, id: INCIDENT_ID });

      expect(
        refusal(() => {
          return CodeTaskContextInputUtil.readItem({ type, id: "42" });
        }),
      ).toBe(`Pick the ${word} to add.`);
    },
  );

  test("a trace is its 32 (or 16) hex character id, in lower case", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Trace",
        traceId: ` ${TRACE_ID.toUpperCase()} `,
      }),
    ).toEqual({ type: CodeTaskContextType.Trace, traceId: TRACE_ID });

    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Trace",
        traceId: TRACE_ID.substring(0, 16),
      }).traceId,
    ).toBe(TRACE_ID.substring(0, 16));

    for (const bad of [
      TRACE_ID.substring(0, 31),
      `${TRACE_ID}0`,
      `${TRACE_ID.substring(0, 31)}g`,
      "",
    ]) {
      expect(
        refusal(() => {
          return CodeTaskContextInputUtil.readItem({
            type: "Trace",
            traceId: bad,
          });
        }),
      ).toContain("A trace ID is 32 (or 16) hexadecimal characters");
    }
  });

  test("logs are a search, a window of an hour, a day or a week, and an optional service", () => {
    expect(
      CodeTaskContextInputUtil.readItem({ type: "Logs", search: "timeout" }),
    ).toEqual({
      type: CodeTaskContextType.Logs,
      search: "timeout",
      hours: DEFAULT_CODE_TASK_LOG_WINDOW_IN_HOURS,
    });

    for (const hours of CODE_TASK_LOG_WINDOWS_IN_HOURS) {
      expect(
        CodeTaskContextInputUtil.readItem({
          type: "Logs",
          search: "timeout",
          hours,
          serviceId: SERVICE_ID,
        }),
      ).toEqual({
        type: CodeTaskContextType.Logs,
        search: "timeout",
        hours,
        serviceId: SERVICE_ID,
      });
    }

    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({
          type: "Logs",
          search: "timeout",
          hours: 2,
        });
      }),
    ).toBe("Logs can look back the last hour, day or week.");
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({
          type: "Logs",
          search: "timeout",
          serviceId: "checkout",
        });
      }),
    ).toBe("Pick the service to add.");
  });

  test("an unknown kind, or something that is not an object, is refused", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({ type: "Secret" });
      }),
    ).toContain("Unknown context type.");
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem("Note");
      }),
    ).toBe("Each piece of context must be an object.");
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem([{ type: "Note" }]);
      }),
    ).toBe("Each piece of context must be an object.");
  });

  test("fields a kind does not have are dropped, never passed on", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "File",
        path: "src/index.ts",
        id: INCIDENT_ID,
        url: "https://example.com",
        snapshot: "pretend this was read from OneUptime",
      }),
    ).toEqual({ type: CodeTaskContextType.File, path: "src/index.ts" });
  });
});

describe("CodeTaskContextInputUtil.readList", () => {
  test("no context is an empty list", () => {
    expect(CodeTaskContextInputUtil.readList(undefined)).toEqual([]);
    expect(CodeTaskContextInputUtil.readList(null)).toEqual([]);
    expect(CodeTaskContextInputUtil.readList([])).toEqual([]);
  });

  test("keeps each piece once, in the order it was added", () => {
    expect(
      CodeTaskContextInputUtil.readList([
        { type: "File", path: "src/a.ts" },
        { type: "Incident", id: INCIDENT_ID },
        { type: "File", path: "./src/a.ts" },
        { type: "Incident", id: INCIDENT_ID.toUpperCase() },
        { type: "Note", text: "two" },
      ]),
    ).toEqual([
      { type: CodeTaskContextType.File, path: "src/a.ts" },
      { type: CodeTaskContextType.Incident, id: INCIDENT_ID },
      { type: CodeTaskContextType.Note, text: "two" },
    ]);
  });

  test("refuses more pieces than a request can carry, and a list that is not one", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readList(
          Array.from(
            { length: CODE_TASK_LIMITS.maxContextItems + 1 },
            (_value: unknown, index: number) => {
              return { type: "Note", text: `note ${index}` };
            },
          ),
        );
      }),
    ).toBe(
      `A request can carry at most ${CODE_TASK_LIMITS.maxContextItems} pieces of context.`,
    );
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readList({ type: "Note" });
      }),
    ).toBe("Context must be a list.");
  });

  test("one bad piece refuses the whole list", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readList([
          { type: "Note", text: "fine" },
          { type: "File", path: "../outside" },
        ]);
      }),
    ).toBe("A path must stay inside the repository (no '..').");
  });
});

describe("CodeTaskTitle.fromMessage", () => {
  test("is the first line with words, without heading or quote marks", () => {
    expect(
      CodeTaskTitle.fromMessage(
        "\n\n## Fix the   flaky checkout test\nIt fails on Mondays.",
      ),
    ).toBe("Fix the flaky checkout test");
    expect(CodeTaskTitle.fromMessage("> # quoted heading")).toBe(
      "quoted heading",
    );
  });

  test("is cut at a word near the limit, and says so", () => {
    const title: string = CodeTaskTitle.fromMessage(`${"word ".repeat(60)}end`);

    expect(title.length).toBeLessThanOrEqual(CODE_TASK_LIMITS.maxTitleLength);
    expect(title.endsWith("word…")).toBe(true);
  });

  test("a single long word is cut where the limit is", () => {
    const title: string = CodeTaskTitle.fromMessage("x".repeat(500));

    expect(title).toHaveLength(CODE_TASK_LIMITS.maxTitleLength);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("CodeTaskStateUtil", () => {
  test.each([
    [AIRunStatus.Queued, false, CodeTaskState.Working],
    [AIRunStatus.Running, false, CodeTaskState.Working],
    [AIRunStatus.WaitingForApproval, false, CodeTaskState.Working],
    [AIRunStatus.Completed, false, CodeTaskState.Done],
    [AIRunStatus.Completed, true, CodeTaskState.WaitingForYou],
    [AIRunStatus.NoFixFound, false, CodeTaskState.Done],
    [AIRunStatus.Error, false, CodeTaskState.Failed],
    [AIRunStatus.Stale, false, CodeTaskState.Failed],
    [AIRunStatus.Cancelled, false, CodeTaskState.Stopped],
  ])(
    "a turn %s (asks: %s) is %s",
    (status: AIRunStatus, needsUserInput: boolean, state: CodeTaskState) => {
      expect(CodeTaskStateUtil.fromRun({ status, needsUserInput })).toBe(state);
    },
  );

  test("a question only waits when the turn finished", () => {
    expect(
      CodeTaskStateUtil.fromRun({
        status: AIRunStatus.Error,
        needsUserInput: true,
      }),
    ).toBe(CodeTaskState.Failed);
  });

  test("a new turn may start unless one is still working", () => {
    expect(CodeTaskStateUtil.acceptsReply(CodeTaskState.Working)).toBe(false);

    for (const state of [
      CodeTaskState.WaitingForYou,
      CodeTaskState.Done,
      CodeTaskState.Failed,
      CodeTaskState.Stopped,
    ]) {
      expect(CodeTaskStateUtil.acceptsReply(state)).toBe(true);
    }
  });
});

describe("the CodeRequest recipe", () => {
  test("reads its work from the task context, and is told apart", () => {
    expect(
      CodeFixTaskTypeHelper.getContextKind(CodeFixTaskType.CodeRequest),
    ).toBe(CodeFixContextKind.TaskContext);
    expect(
      CodeFixTaskTypeHelper.isCodeRequest(CodeFixTaskType.CodeRequest),
    ).toBe(true);
    expect(
      CodeFixTaskTypeHelper.isCodeRequest(CodeFixTaskType.FixException),
    ).toBe(false);
    expect(CodeFixTaskTypeHelper.isCodeRequest(null)).toBe(false);
  });

  test("is never handed to a Runner that does not say it can do it", () => {
    const given: Array<CodeFixTaskType> =
      CodeFixTaskTypeHelper.getTaskTypesForRunnersThatDoNotSay();

    expect(given).not.toContain(CodeFixTaskType.CodeRequest);
    expect(given).toEqual(
      Object.values(CodeFixTaskType).filter((type: CodeFixTaskType) => {
        return (
          type !== CodeFixTaskType.CodeRequest &&
          !CodeFixTaskTypeHelper.isRunByServer(type)
        );
      }),
    );
  });

  test("a Runner's list of recipes keeps only real ones, once each", () => {
    expect(
      CodeFixTaskTypeHelper.readSupportedTaskTypes([
        "CodeRequest",
        "FixException",
        "CodeRequest",
        "DropDatabase",
        42,
        null,
      ]),
    ).toEqual([CodeFixTaskType.CodeRequest, CodeFixTaskType.FixException]);
    expect(CodeFixTaskTypeHelper.readSupportedTaskTypes([])).toEqual([]);
  });

  test("a Runner that sends no list did not say", () => {
    for (const value of [
      undefined,
      null,
      "CodeRequest",
      { 0: "CodeRequest" },
    ]) {
      expect(CodeFixTaskTypeHelper.readSupportedTaskTypes(value)).toBeNull();
    }
  });

  test("a run that cannot say what was asked has no request", () => {
    expect(getCodeTaskRequest(undefined)).toBeNull();
    expect(getCodeTaskRequest({})).toBeNull();
    expect(
      getCodeTaskRequest({ request: { message: "   ", context: [] } }),
    ).toBeNull();
    expect(
      getCodeTaskRequest({
        request: { message: 42, context: [] } as unknown as {
          message: string;
          context: [];
        },
      }),
    ).toBeNull();
    expect(
      getCodeTaskRequest({
        request: {
          message: "Add a retry",
          context: "nope" as unknown as [],
        },
      }),
    ).toEqual({ message: "Add a retry", context: [] });
  });

  test("the branch a request was picked to start from is read back only when git would take it", () => {
    expect(
      getCodeTaskRequest({
        request: {
          message: "Backport it",
          context: [],
          baseBranch: "release/2026-10",
        },
      }),
    ).toEqual({
      message: "Backport it",
      context: [],
      baseBranch: "release/2026-10",
    });

    for (const stored of ["", "a..b", "-x", "has space", 7, null]) {
      const request: ReturnType<typeof getCodeTaskRequest> = getCodeTaskRequest(
        {
          request: {
            message: "Backport it",
            context: [],
            baseBranch: stored as unknown as string,
          },
        },
      );

      expect(request).toEqual({ message: "Backport it", context: [] });
      expect(request).not.toHaveProperty("baseBranch");
    }
  });
});

/*
 * The branch a person picks in Code's request box, read the way git reads a
 * branch name (git check-ref-format for refs/heads/<name>): what a Runner
 * will check out, so nothing git would refuse - or read as an option - is
 * ever passed on.
 */
describe("CodeTaskBranchName", () => {
  test.each([
    ["main"],
    ["release/2026-10"],
    ["feature/JIRA-123_retry"],
    ["v1.2.3"],
    ["dependabot/npm_and_yarn/express-5.0.0"],
    ["a".repeat(CODE_TASK_LIMITS.maxBranchNameLength)],
    ["déjà-vu"],
  ])("%s is a branch name", (name: string) => {
    expect(CodeTaskBranchName.isValid(name)).toBe(true);
    expect(CodeTaskBranchName.read(name)).toBe(name);
  });

  test.each([
    ["", "empty"],
    ["@", "the lone @"],
    ["-x", "starting with -, read as an option"],
    ["--upload-pack=evil", "an option"],
    ["/x", "starting with /"],
    ["x/", "ending with /"],
    ["x.", "ending with ."],
    ["a..b", "two dots"],
    ["a@{1}", "@{"],
    ["a//b", "an empty part"],
    ["has space", "a space"],
    ["a~1", "~"],
    ["a^2", "^"],
    ["a:b", ":"],
    ["a?", "?"],
    ["a*", "*"],
    ["a[0]", "["],
    ["a\\b", "a backslash"],
    ["a\tb", "a tab"],
    ["a\u0000b", "a NUL"],
    ["a\u007fb", "DEL"],
    [".hidden", "a part starting with ."],
    ["x/.hidden", "a later part starting with ."],
    ["x.lock", "ending with .lock"],
    ["x.lock/y", "a part ending with .lock"],
    ["a".repeat(CODE_TASK_LIMITS.maxBranchNameLength + 1), "too long"],
  ])("%p is not (%s)", (name: string) => {
    expect(CodeTaskBranchName.isValid(name)).toBe(false);
    expect(() => {
      return CodeTaskBranchName.read(name.trim() ? name : `${name}x y`);
    }).toThrow(CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE);
  });

  test("nothing picked - absent, null or blank - is no branch: the main one", () => {
    expect(CodeTaskBranchName.read(undefined)).toBeNull();
    expect(CodeTaskBranchName.read(null)).toBeNull();
    expect(CodeTaskBranchName.read("")).toBeNull();
    expect(CodeTaskBranchName.read("   ")).toBeNull();
  });

  test("a name is read trimmed; anything but text is refused", () => {
    expect(CodeTaskBranchName.read("  dev  ")).toBe("dev");
    for (const raw of [7, true, {}, ["main"]]) {
      expect(
        refusal(() => {
          return CodeTaskBranchName.read(raw);
        }),
      ).toBe(CODE_TASK_BRANCH_NAME_REFUSED_MESSAGE);
    }
  });

  test("a name of 400,000 characters is read in time in line with its length", () => {
    for (const name of [
      `${"a/".repeat(200_000)}x`,
      `${".".repeat(400_000)}`,
      `${"a".repeat(400_000)}.lock`,
    ]) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          CodeTaskBranchName.isValid(name);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    }
  });
});

/*
 * How much a task changed, as its list row says it ("+23 −1"): what AI
 * wrote over its turns - each file it touched counted once, and the lines
 * each turn added and took out.
 */
describe("CodeTaskChangeStats.fromOutcomes", () => {
  test("every turn's lines, each file once", () => {
    expect(
      CodeTaskChangeStats.fromOutcomes([
        {
          summary: "Retries.",
          filesChanged: [
            {
              path: "src/client.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 9,
              deletions: 1,
            },
            {
              path: "test/retries.test.ts",
              status: CodeTaskFileStatus.Added,
              additions: 14,
              deletions: 0,
            },
          ],
        },
        undefined,
        null,
        { summary: "A question.", filesChanged: [] },
        {
          summary: "Logged.",
          filesChanged: [
            {
              path: "src/client.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 4,
              deletions: 2,
            },
          ],
        },
      ]),
    ).toEqual({ files: 2, additions: 27, deletions: 3 });
  });

  test("no file changed: nothing to say", () => {
    expect(CodeTaskChangeStats.fromOutcomes([])).toBeNull();
    expect(
      CodeTaskChangeStats.fromOutcomes([
        { summary: "Explained.", filesChanged: [] },
        undefined,
      ]),
    ).toBeNull();
  });

  test("counts that are not counts add nothing; a file with no path is not a file", () => {
    expect(
      CodeTaskChangeStats.fromOutcomes([
        {
          summary: "",
          filesChanged: [
            {
              path: "a.ts",
              status: CodeTaskFileStatus.Modified,
              additions: -5,
              deletions: Number.NaN,
            },
            {
              path: "b.ts",
              status: CodeTaskFileStatus.Modified,
              additions: 2.9,
              deletions: "3" as unknown as number,
            },
            { status: CodeTaskFileStatus.Added } as never,
            null as never,
          ],
        },
      ]),
    ).toEqual({ files: 2, additions: 2, deletions: 0 });
  });
});

describe("reading what outside people typed takes time in line with its length", () => {
  const LONG: number = 400_000;

  /*
   * How long the work takes: the fastest of up to three attempts, counted as
   * it would have run on a usual runner when every attempt overran on a slow
   * one (Tests/Helpers/FastestRun).
   */
  function timed(read: () => unknown): number {
    return fastestRun({
      run: (): void => {
        try {
          read();
        } catch {
          // A refusal is an answer too; only how long it took matters here.
        }
      },
      limitInMs: 2000,
    }).inMs;
  }

  test.each([
    [
      "a trace id of hex and one bad letter",
      () => {
        return CodeTaskContextInputUtil.readItem({
          type: "Trace",
          traceId: `${"a".repeat(LONG)}g`,
        });
      },
    ],
    [
      "a path of slashes and dots",
      () => {
        return CodeTaskContextInputUtil.normalizePath(
          `${"./".repeat(LONG / 2)}x`,
        );
      },
    ],
    [
      "a title of spaces",
      () => {
        return CodeTaskTitle.fromMessage(`${" \t".repeat(LONG / 2)}x`);
      },
    ],
    [
      "a title of heading marks",
      () => {
        return CodeTaskTitle.fromMessage(`${"#".repeat(LONG)} x`);
      },
    ],
  ])("%s", (_name: string, read: () => unknown) => {
    expect(timed(read)).toBeLessThan(2000);
  });
});

/*
 * A function of a service's profile, as the Profiler's Fix with AI and
 * Code's own dialog add it: the service and the function are needed; the
 * file, the kind of profile and the window are optional - the last hour,
 * day or week, or the start and end the Profiler was showing, at most a
 * week long, with the window it was compared with.
 */
describe("a Profile in a request", () => {
  test("a service and a function, the last hour by default", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Profile",
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
      }),
    ).toEqual({
      type: CodeTaskContextType.Profile,
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
      hours: DEFAULT_CODE_TASK_PROFILE_WINDOW_IN_HOURS,
    });
  });

  test("its file, its kind and the window the Profiler was showing, with the one it was compared with", () => {
    expect(
      CodeTaskContextInputUtil.readItem({
        type: "Profile",
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        fileName: " src/orders/parse.ts ",
        profileType: "memory",
        startTime: "2026-10-20T10:00:00Z",
        endTime: "2026-10-20T11:00:00Z",
        beforeStartTime: "2026-10-20T09:00:00Z",
        beforeEndTime: "2026-10-20T10:00:00Z",
      }),
    ).toEqual({
      type: CodeTaskContextType.Profile,
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
      profileType: "memory",
      startTime: "2026-10-20T10:00:00.000Z",
      endTime: "2026-10-20T11:00:00.000Z",
      beforeStartTime: "2026-10-20T09:00:00.000Z",
      beforeEndTime: "2026-10-20T10:00:00.000Z",
    });
  });

  test("a day or a week back, from Code's dialog", () => {
    for (const hours of CODE_TASK_LOG_WINDOWS_IN_HOURS) {
      expect(
        CodeTaskContextInputUtil.readItem({
          type: "Profile",
          serviceId: SERVICE_ID,
          functionName: "parseOrder",
          hours,
        }),
      ).toMatchObject({ hours });
    }
  });

  test.each([
    ["no service", { functionName: "parseOrder" }, "Pick the service to add."],
    [
      "a service that is not an id",
      { serviceId: "checkout", functionName: "parseOrder" },
      "Pick the service to add.",
    ],
    [
      "a window of two hours back",
      { serviceId: SERVICE_ID, functionName: "parseOrder", hours: 2 },
      "A profile can look back the last hour, day or week.",
    ],
    [
      "a start with no end",
      {
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        startTime: "2026-10-20T10:00:00Z",
      },
      "A profile's time range needs a start and an end, as ISO timestamps.",
    ],
    [
      "a window that ends before it starts",
      {
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        startTime: "2026-10-20T11:00:00Z",
        endTime: "2026-10-20T10:00:00Z",
      },
      "A profile's time range must start before it ends.",
    ],
    [
      "a window longer than the limit",
      {
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        startTime: "2026-10-01T00:00:00Z",
        endTime: "2026-10-20T00:00:00Z",
      },
      `A profile's time range can be at most ${CODE_TASK_LIMITS.maxProfileWindowInDays} days long.`,
    ],
    [
      "a kind of profile that is too long to be one",
      {
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        profileType: "x".repeat(CODE_TASK_LIMITS.maxProfileTypeLength + 1),
      },
      "That kind of profile is not one we know.",
    ],
  ])(
    "%s is refused",
    (_name: string, entry: Record<string, unknown>, message: string) => {
      expect(
        refusal(() => {
          return CodeTaskContextInputUtil.readItem({
            type: "Profile",
            ...entry,
          });
        }),
      ).toBe(message);
    },
  );

  test("a function with no name is refused", () => {
    expect(
      refusal(() => {
        return CodeTaskContextInputUtil.readItem({
          type: "Profile",
          serviceId: SERVICE_ID,
          functionName: "  ",
        });
      }),
    ).toContain("function name");
  });
});
