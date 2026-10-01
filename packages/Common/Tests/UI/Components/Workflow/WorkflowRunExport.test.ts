/*
 * A workflow run as a file: what a downloaded run is called and what is in it.
 *
 * The maintainer's report was that there was no way to download a run's log.
 * What a download has to get right, and what this pins down:
 *
 *   - the name says which workflow, which run and when, and is a name every
 *     file system accepts, whatever the workflow is called;
 *   - the .txt is the whole log, exactly as printed, under a heading that
 *     says what it is - never cut short, however long the log;
 *   - the .json is the same run as data, steps included, in the shape the API
 *     returns them in;
 *   - nothing goes into either file but the run's own log, steps, id, status
 *     and times and its workflow's id and name - the runner redacts secrets
 *     before a run is stored, so that is what keeps a download redacted.
 */

import {
  WORKFLOW_RUN_EMPTY_LOG_LINE,
  WORKFLOW_RUN_FILE_NAME_FALLBACK,
  WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH,
  WORKFLOW_RUN_JSON_MIME_TYPE,
  WORKFLOW_RUN_LOG_MIME_TYPE,
  WorkflowRunExport,
  WorkflowRunExportFile,
  WorkflowRunExportFormat,
  buildWorkflowRunJsonText,
  buildWorkflowRunLogText,
  getLogLines,
  getRunTimeForFileName,
  getWorkflowNameForFileName,
  getWorkflowRunExportFile,
  getWorkflowRunExportFromWorkflowLog,
  getWorkflowRunFileName,
  getWorkflowRunHeadingLines,
  getWorkflowRunJson,
  hasWorkflowRunContent,
  toRunDate,
} from "../../../../UI/Components/Workflow/WorkflowRunExport";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { describe, expect, test } from "@jest/globals";

const RUN_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const WORKFLOW_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const REDACTED: string = "[REDACTED]";

const LOG: string = [
  "Sep 30 2026, 10:00:01 GMT: Executing Component: api-get-1",
  "Sep 30 2026, 10:00:01 GMT: Component Args:",
  `Sep 30 2026, 10:00:01 GMT: {"url":"https://example.com","headers":{"Authorization":"${REDACTED}"}}`,
  "Sep 30 2026, 10:00:02 GMT: Executing Port: Success",
].join("\n");

const aStep: (
  overrides?: Partial<WorkflowStepTraceEntry>,
) => WorkflowStepTraceEntry = (
  overrides?: Partial<WorkflowStepTraceEntry>,
): WorkflowStepTraceEntry => {
  return {
    componentId: "api-get-1",
    metadataId: "api-get",
    title: "Get from API",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-09-30T10:00:01.000Z",
    completedAt: "2026-09-30T10:00:02.000Z",
    durationInMs: 1000,
    argumentValues: {
      url: "https://example.com",
      headers: { Authorization: REDACTED },
    },
    returnValues: { "response-status": 200 },
    executedPort: "success",
    executedPortTitle: "Success",
    ...overrides,
  };
};

const aTrace: () => WorkflowStepTrace = (): WorkflowStepTrace => {
  return { steps: [aStep()], truncated: false };
};

const aRun: (overrides?: Partial<WorkflowRunExport>) => WorkflowRunExport = (
  overrides?: Partial<WorkflowRunExport>,
): WorkflowRunExport => {
  return {
    runId: RUN_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Nightly sync",
    status: WorkflowStatus.Success,
    scheduledAt: new Date("2026-09-30T10:00:00.000Z"),
    startedAt: new Date("2026-09-30T10:00:01.000Z"),
    completedAt: new Date("2026-09-30T10:00:03.000Z"),
    logs: LOG,
    stepTrace: aTrace(),
    ...overrides,
  };
};

// Characters no file name may hold on Windows, macOS or Linux.
const RESERVED_IN_A_FILE_NAME: Array<string> = [
  "\\",
  "/",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
];

// Not one reserved character, and no control character (a tab, a newline).
const isSafeFileName: (name: string) => boolean = (name: string): boolean => {
  return Array.from(name).every((character: string): boolean => {
    return (
      character.charCodeAt(0) >= 32 &&
      !RESERVED_IN_A_FILE_NAME.includes(character)
    );
  });
};

describe("what a downloaded run is called", () => {
  test("the workflow, the run and when it started", () => {
    expect(getWorkflowRunFileName(aRun(), WorkflowRunExportFormat.Log)).toBe(
      `nightly-sync-run-${RUN_ID}-2026-09-30T10-00-01.txt`,
    );
  });

  test("the whole run is a .json of the same name", () => {
    expect(getWorkflowRunFileName(aRun(), WorkflowRunExportFormat.JSON)).toBe(
      `nightly-sync-run-${RUN_ID}-2026-09-30T10-00-01.json`,
    );
  });

  test("a run that never started is stamped with when it was queued", () => {
    expect(
      getWorkflowRunFileName(
        aRun({ startedAt: null }),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe(`nightly-sync-run-${RUN_ID}-2026-09-30T10-00-00.txt`);
  });

  test("a run with no time at all has none in its name", () => {
    expect(
      getWorkflowRunFileName(
        aRun({ startedAt: null, scheduledAt: undefined }),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe(`nightly-sync-run-${RUN_ID}.txt`);
  });

  test("a run with no id has none in its name", () => {
    expect(
      getWorkflowRunFileName(
        aRun({ runId: null }),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe("nightly-sync-run-2026-09-30T10-00-01.txt");
  });

  test("with nothing known it is still a usable name", () => {
    expect(getWorkflowRunFileName({}, WorkflowRunExportFormat.Log)).toBe(
      "workflow-run.txt",
    );
  });

  test("the time is UTC, with dashes where a time has colons", () => {
    // 23:30 at UTC-5 is 04:30 the next day in UTC.
    expect(
      getRunTimeForFileName({ startedAt: "2026-09-30T23:30:05.123-05:00" }),
    ).toBe("2026-10-01T04-30-05");
  });

  test("a time given as text reads the same as one given as a date", () => {
    expect(
      getWorkflowRunFileName(
        aRun({ startedAt: "2026-09-30T10:00:01.000Z" }),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe(getWorkflowRunFileName(aRun(), WorkflowRunExportFormat.Log));
  });

  test("a time that is not a time is treated as missing", () => {
    expect(
      getWorkflowRunFileName(
        aRun({ startedAt: "not a date", scheduledAt: new Date("garbage") }),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe(`nightly-sync-run-${RUN_ID}.txt`);
  });

  test("two runs of one workflow never share a name, and one run keeps its", () => {
    const first: string = getWorkflowRunFileName(
      aRun(),
      WorkflowRunExportFormat.Log,
    );
    const again: string = getWorkflowRunFileName(
      aRun(),
      WorkflowRunExportFormat.Log,
    );
    const second: string = getWorkflowRunFileName(
      aRun({ runId: "0193c0de-2222-4aaa-8bbb-000000000002" }),
      WorkflowRunExportFormat.Log,
    );

    expect(again).toBe(first);
    expect(second).not.toBe(first);
  });

  test("an id is only ever letters, digits and dashes in the name", () => {
    const name: string = getWorkflowRunFileName(
      aRun({ runId: "../../etc/passwd" }),
      WorkflowRunExportFormat.Log,
    );

    expect(name).toBe("nightly-sync-run-etcpasswd-2026-09-30T10-00-01.txt");
    expect(isSafeFileName(name)).toBe(true);
  });
});

describe("the workflow's name, in a file name", () => {
  test.each([
    ["Nightly sync", "nightly-sync"],
    ["  Nightly   Sync  ", "nightly-sync"],
    ["Sync / EU: prod", "sync-eu-prod"],
    ['a/b\\c:d*e?f"g<h>i|j', "a-b-c-d-e-f-g-h-i-j"],
    ["release_v2 -- canary", "release_v2-canary"],
    ["Ünïcödé Wörkflow", "ünïcödé-wörkflow"],
    ["Nächtlicher Abgleich", "nächtlicher-abgleich"],
    ["夜間同期", "夜間同期"],
    ["रात का सिंक", "रात-का-सिंक"],
    ["همگام\u200cسازی شبانه", "همگام-سازی-شبانه"],
    ["🚀 Deploy 🚀", "deploy"],
  ])("%j becomes %j", (name: string, expected: string) => {
    expect(getWorkflowNameForFileName(name)).toBe(expected);
  });

  test.each([[""], ["   "], ["!!!"], ["🚀"], [null], [undefined]])(
    "%j has nothing left, so the file says workflow",
    (name: string | null | undefined) => {
      expect(getWorkflowNameForFileName(name)).toBe(
        WORKFLOW_RUN_FILE_NAME_FALLBACK,
      );
    },
  );

  test("a long name is cut, and never left ending in a dash", () => {
    const name: string = `${"a".repeat(WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH - 1)} b c d`;
    const slug: string = getWorkflowNameForFileName(name);

    expect(Array.from(slug).length).toBeLessThanOrEqual(
      WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH,
    );
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("a".repeat(WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH - 1));
  });

  test("a long name in a script beyond the basic plane is cut between letters", () => {
    // U+20000, a CJK ideograph that takes two UTF-16 units.
    const ideograph: string = "\u{20000}";
    const slug: string = getWorkflowNameForFileName(ideograph.repeat(80));

    expect(Array.from(slug)).toHaveLength(
      WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH,
    );
    expect(slug).toBe(ideograph.repeat(WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH));
  });

  test("a whole file name fits the 255 bytes most file systems allow", () => {
    const name: string = getWorkflowRunFileName(
      aRun({ workflowName: "夜".repeat(200) }),
      WorkflowRunExportFormat.JSON,
    );

    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(255);
  });

  test("no name, however awkward, gives a file name a file system refuses", () => {
    const awkward: Array<string> = [
      "a/b",
      "C:\\Windows\\System32",
      "what?",
      'say "hi"',
      "<script>alert(1)</script>",
      "pipe | grep",
      "tab\there",
      "new\nline",
      "nul\u0000byte",
      "..",
      ".hidden",
      "trailing.",
    ];

    for (const workflowName of awkward) {
      const name: string = getWorkflowRunFileName(
        aRun({ workflowName }),
        WorkflowRunExportFormat.Log,
      );

      expect({
        workflowName,
        name,
        unsafe: !isSafeFileName(name),
      }).toEqual({ workflowName, name, unsafe: false });
      expect(name.startsWith(".")).toBe(false);
    }

    // The check would notice a name that is not safe.
    expect(isSafeFileName("a/b.txt")).toBe(false);
    expect(isSafeFileName("tab\there.txt")).toBe(false);
    expect(isSafeFileName("nightly-sync-run.txt")).toBe(true);
  });
});

describe("the log, as a .txt", () => {
  test("is a heading, a blank line, then the log, ending in a newline", () => {
    expect(buildWorkflowRunLogText(aRun())).toBe(
      [
        "Workflow: Nightly sync",
        `Workflow ID: ${WORKFLOW_ID}`,
        `Run ID: ${RUN_ID}`,
        "Status: Executed",
        "Scheduled at: 2026-09-30T10:00:00.000Z",
        "Started at: 2026-09-30T10:00:01.000Z",
        "Completed at: 2026-09-30T10:00:03.000Z",
        "",
        LOG,
      ].join("\n") + "\n",
    );
  });

  test.each([
    [WorkflowStatus.Success, "Executed"],
    [WorkflowStatus.Error, "Error"],
    [WorkflowStatus.Timeout, "Timeout"],
    [WorkflowStatus.Running, "Running"],
    [WorkflowStatus.Scheduled, "Scheduled"],
    [WorkflowStatus.Waiting, "Waiting"],
    [WorkflowStatus.WorkflowCountExceeded, "Execution Exceeded Current Plan"],
  ])(
    "a run that is %s reads as the run list says: %s",
    (status: WorkflowStatus, label: string) => {
      expect(getWorkflowRunHeadingLines(aRun({ status }))).toContain(
        `Status: ${label}`,
      );
    },
  );

  test("says nothing about what it does not know", () => {
    const lines: Array<string> = getWorkflowRunHeadingLines({
      runId: RUN_ID,
      status: WorkflowStatus.Running,
      startedAt: new Date("2026-09-30T10:00:01.000Z"),
      completedAt: null,
      workflowName: "   ",
    });

    expect(lines).toEqual([
      `Run ID: ${RUN_ID}`,
      "Status: Running",
      "Started at: 2026-09-30T10:00:01.000Z",
    ]);
  });

  test("with nothing known, it is just the log", () => {
    expect(
      buildWorkflowRunLogText({ logs: "one\ntwo", stepTrace: { steps: [] } }),
    ).toBe("one\ntwo\n");
  });

  test("keeps the log exactly as printed: blank lines, tabs, carriage returns, every script", () => {
    const awkwardLog: string =
      '  leading spaces\n\n\ttabbed\r\nwindows line\r\n夜間同期 — ✓ done   \n{"a":1}';
    const text: string = buildWorkflowRunLogText(aRun({ logs: awkwardLog }));

    expect(text.endsWith(`\n\n${awkwardLog}\n`)).toBe(true);
  });

  test("does not add a second newline to a log that ends in one", () => {
    const text: string = buildWorkflowRunLogText(aRun({ logs: "last line\n" }));

    expect(text.endsWith("last line\n")).toBe(true);
    expect(text.endsWith("last line\n\n")).toBe(false);
  });

  test("an empty log says so, instead of ending at the heading", () => {
    const text: string = buildWorkflowRunLogText(aRun({ logs: "" }));

    expect(text.endsWith(`\n\n${WORKFLOW_RUN_EMPTY_LOG_LINE}\n`)).toBe(true);
  });

  /*
   * The Full Log tab draws a line at a time; a download is the way to get a
   * log too long to read there, so it must never be cut.
   */
  test("a very long log is kept whole", () => {
    const lines: Array<string> = Array.from(
      { length: 200000 },
      (_unused: unknown, index: number): string => {
        return `Sep 30 2026, 10:00:01 GMT: line ${index} ${"x".repeat(40)}`;
      },
    );
    const longLog: string = lines.join("\n");
    const text: string = buildWorkflowRunLogText(aRun({ logs: longLog }));

    expect(longLog.length).toBeGreaterThan(10_000_000);
    expect(text.endsWith(`\n\n${longLog}\n`)).toBe(true);
    expect(text).toContain("line 0 ");
    expect(text).toContain("line 199999 ");
  });

  test("one enormous line - a whole response body - is kept whole", () => {
    const body: string = `Sep 30 2026, 10:00:01 GMT: ${'{"k":"v"},'.repeat(500000)}`;

    expect(buildWorkflowRunLogText(aRun({ logs: body }))).toContain(body);
  });
});

describe("the run, as a .json", () => {
  type ParsedRun = {
    workflow: { id: string | null; name: string | null };
    run: {
      id: string | null;
      status: string | null;
      scheduledAt: string | null;
      startedAt: string | null;
      completedAt: string | null;
    };
    stepTrace: WorkflowStepTrace;
    log: Array<string>;
  };

  const parse: (run: WorkflowRunExport) => ParsedRun = (
    run: WorkflowRunExport,
  ): ParsedRun => {
    return JSON.parse(buildWorkflowRunJsonText(run)) as ParsedRun;
  };

  test("holds the workflow, the run, its steps and its log, and nothing else", () => {
    const parsed: ParsedRun = parse(aRun());

    expect(Object.keys(parsed)).toEqual([
      "workflow",
      "run",
      "stepTrace",
      "log",
    ]);
    expect(parsed.workflow).toEqual({ id: WORKFLOW_ID, name: "Nightly sync" });
    expect(parsed.run).toEqual({
      id: RUN_ID,
      status: "Success",
      scheduledAt: "2026-09-30T10:00:00.000Z",
      startedAt: "2026-09-30T10:00:01.000Z",
      completedAt: "2026-09-30T10:00:03.000Z",
    });
  });

  test("keeps the status as the API stores it, for scripts", () => {
    expect(
      parse(aRun({ status: WorkflowStatus.WorkflowCountExceeded })).run.status,
    ).toBe("Workflow Count Exceeded");
  });

  test("writes a time it does not have as null", () => {
    const parsed: ParsedRun = parse(
      aRun({ completedAt: null, startedAt: "garbage", workflowName: "" }),
    );

    expect(parsed.run.completedAt).toBeNull();
    expect(parsed.run.startedAt).toBeNull();
    expect(parsed.workflow.name).toBeNull();
  });

  test("carries the steps exactly as the Steps tab has them", () => {
    const trace: WorkflowStepTrace = {
      steps: [
        aStep(),
        aStep({
          componentId: "if-else-1",
          metadataId: "if-else",
          title: "If / Else",
          executedPort: "no",
          executedPortTitle: "No",
          nextSteps: [],
          warnings: [
            {
              message:
                "{{local.components.webhook-1.returnValues.x}} did not resolve",
              argumentId: "input-1",
              unresolvedReferences: [
                "{{local.components.webhook-1.returnValues.x}}",
              ],
            },
          ],
        }),
        aStep({
          componentId: "slack-1",
          status: WorkflowStepStatus.Error,
          errorMessage: "channel_not_found",
          executedPort: "error",
        }),
      ],
      truncated: true,
      singleStepComponentId: "api-get-1",
      runErrorMessage: "Workflow Timed out.",
      resumesAt: "2026-09-30T11:00:00.000Z",
    };

    expect(parse(aRun({ stepTrace: trace })).stepTrace).toEqual(trace);
  });

  test("gives the log as its lines, which join back into the log exactly", () => {
    const awkwardLog: string = "one\n\n\ttwo\r\nthree\n";
    const parsed: ParsedRun = parse(aRun({ logs: awkwardLog }));

    expect(parsed.log).toEqual(["one", "", "\ttwo\r", "three", ""]);
    expect(parsed.log.join("\n")).toBe(awkwardLog);
  });

  test("an empty log has no lines", () => {
    expect(parse(aRun({ logs: "" })).log).toEqual([]);
    expect(getLogLines("")).toEqual([]);
  });

  test("a very long log keeps every line", () => {
    const lines: Array<string> = Array.from(
      { length: 100000 },
      (_unused: unknown, index: number): string => {
        return `line ${index}`;
      },
    );
    const parsed: ParsedRun = parse(aRun({ logs: lines.join("\n") }));

    expect(parsed.log).toHaveLength(100000);
    expect(parsed.log[99999]).toBe("line 99999");
  });

  test("is indented for reading and ends in a newline", () => {
    const text: string = buildWorkflowRunJsonText(aRun());

    expect(text.startsWith('{\n  "workflow": {\n    "id": ')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("the object and the text agree", () => {
    expect(JSON.parse(buildWorkflowRunJsonText(aRun()))).toEqual(
      JSON.parse(JSON.stringify(getWorkflowRunJson(aRun()))),
    );
  });
});

describe("what the browser is handed", () => {
  test("the log is plain UTF-8 text", () => {
    const file: WorkflowRunExportFile = getWorkflowRunExportFile(
      aRun(),
      WorkflowRunExportFormat.Log,
    );

    expect(file).toEqual({
      fileName: `nightly-sync-run-${RUN_ID}-2026-09-30T10-00-01.txt`,
      content: buildWorkflowRunLogText(aRun()),
      mimeType: WORKFLOW_RUN_LOG_MIME_TYPE,
    });
    expect(file.mimeType).toBe("text/plain;charset=utf-8");
  });

  test("the run is UTF-8 JSON", () => {
    const file: WorkflowRunExportFile = getWorkflowRunExportFile(
      aRun(),
      WorkflowRunExportFormat.JSON,
    );

    expect(file).toEqual({
      fileName: `nightly-sync-run-${RUN_ID}-2026-09-30T10-00-01.json`,
      content: buildWorkflowRunJsonText(aRun()),
      mimeType: WORKFLOW_RUN_JSON_MIME_TYPE,
    });
    expect(file.mimeType).toBe("application/json;charset=utf-8");
  });
});

describe("is there anything to copy or download", () => {
  test("a log is enough", () => {
    expect(
      hasWorkflowRunContent({ logs: "a line", stepTrace: { steps: [] } }),
    ).toBe(true);
  });

  test("a step is enough", () => {
    expect(hasWorkflowRunContent({ logs: "", stepTrace: aTrace() })).toBe(true);
  });

  test("neither is nothing", () => {
    expect(hasWorkflowRunContent({ logs: "", stepTrace: { steps: [] } })).toBe(
      false,
    );
  });

  test("a hole in the steps is not a step", () => {
    expect(
      hasWorkflowRunContent({
        logs: "",
        stepTrace: {
          steps: [null, undefined] as unknown as Array<WorkflowStepTraceEntry>,
        },
      }),
    ).toBe(false);
  });
});

describe("a row of the run lists, as a run to download", () => {
  const aRow: () => WorkflowLog = (): WorkflowLog => {
    const workflow: Workflow = new Workflow();
    workflow._id = WORKFLOW_ID;
    workflow.name = "Nightly sync";

    const row: WorkflowLog = new WorkflowLog();
    row._id = RUN_ID;
    row.workflowId = new ObjectID(WORKFLOW_ID);
    row.workflow = workflow;
    row.workflowStatus = WorkflowStatus.Error;
    row.logs = LOG;
    row.stepTrace = aTrace() as unknown as JSONObject;
    row.createdAt = new Date("2026-09-30T10:00:00.000Z");
    row.startedAt = new Date("2026-09-30T10:00:01.000Z");
    row.completedAt = new Date("2026-09-30T10:00:03.000Z");

    return row;
  };

  test("reads the run, its workflow, its log and its steps", () => {
    const run: WorkflowRunExport = getWorkflowRunExportFromWorkflowLog(aRow());

    expect(run).toEqual({
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
      workflowName: "Nightly sync",
      status: WorkflowStatus.Error,
      scheduledAt: new Date("2026-09-30T10:00:00.000Z"),
      startedAt: new Date("2026-09-30T10:00:01.000Z"),
      completedAt: new Date("2026-09-30T10:00:03.000Z"),
      logs: LOG,
      stepTrace: aTrace(),
    });
  });

  test("finds the workflow's id on the workflow when the row did not select it", () => {
    const row: WorkflowLog = aRow();
    delete row.workflowId;

    expect(getWorkflowRunExportFromWorkflowLog(row).workflowId).toBe(
      WORKFLOW_ID,
    );
  });

  test("a row without a log or steps downloads an empty log and no steps", () => {
    const row: WorkflowLog = aRow();
    delete row.logs;
    delete row.stepTrace;

    const run: WorkflowRunExport = getWorkflowRunExportFromWorkflowLog(row);

    expect(run.logs).toBe("");
    expect(run.stepTrace).toEqual({ steps: [] });
  });

  test("steps written by an older build that are not a trace read as none", () => {
    const row: WorkflowLog = aRow();
    row.stepTrace = { notSteps: true } as unknown as JSONObject;

    expect(getWorkflowRunExportFromWorkflowLog(row).stepTrace).toEqual({
      steps: [],
    });
  });

  test("the row's file is named after its workflow and run", () => {
    expect(
      getWorkflowRunFileName(
        getWorkflowRunExportFromWorkflowLog(aRow()),
        WorkflowRunExportFormat.Log,
      ),
    ).toBe(`nightly-sync-run-${RUN_ID}-2026-09-30T10-00-01.txt`);
  });

  /*
   * The row is a model, and a model can carry columns the API never sends to
   * a dashboard - resumeData holds a sleeping run's return values unredacted.
   * Whatever the row carries, a download writes only what it is meant to.
   */
  test("never writes a column it does not mean to, whatever the row carries", () => {
    const secret: string = "sk_live_resume_data_secret";
    const row: WorkflowLog = aRow();

    row.resumeData = { componentReturnValues: { token: secret } };
    row.resumeAt = new Date("2026-09-30T12:00:00.000Z");
    row.projectId = new ObjectID("0193c0de-9999-4aaa-8bbb-000000000009");

    const run: WorkflowRunExport = getWorkflowRunExportFromWorkflowLog(row);

    for (const format of [
      WorkflowRunExportFormat.Log,
      WorkflowRunExportFormat.JSON,
    ]) {
      const content: string = getWorkflowRunExportFile(run, format).content;

      expect(content).not.toContain(secret);
      expect(content).not.toContain("resume");
      expect(content).not.toContain("0193c0de-9999");
    }
  });

  test("a redacted value stays redacted in both files", () => {
    const run: WorkflowRunExport = getWorkflowRunExportFromWorkflowLog(aRow());

    expect(buildWorkflowRunLogText(run)).toContain(
      `"Authorization":"${REDACTED}"`,
    );
    expect(
      JSON.parse(buildWorkflowRunJsonText(run)).stepTrace.steps[0]
        .argumentValues.headers.Authorization,
    ).toBe(REDACTED);
  });
});

describe("reading a run's time", () => {
  test.each([
    [new Date("2026-09-30T10:00:01.000Z"), "2026-09-30T10:00:01.000Z"],
    ["2026-09-30T10:00:01.000Z", "2026-09-30T10:00:01.000Z"],
    ["2026-09-30T12:00:01+02:00", "2026-09-30T10:00:01.000Z"],
  ])("%j is a time", (value: Date | string, iso: string) => {
    expect(toRunDate(value)?.toISOString()).toBe(iso);
  });

  test.each([[null], [undefined], [""], ["yesterday-ish"], [new Date("x")]])(
    "%j is no time",
    (value: Date | string | null | undefined) => {
      expect(toRunDate(value)).toBeNull();
    },
  );
});
