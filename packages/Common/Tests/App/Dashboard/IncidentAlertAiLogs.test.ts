import {
  AI_LOGS_EMPTY_DESCRIPTIONS,
  AI_LOGS_EMPTY_TITLE,
  AI_LOGS_FILTER_OPTIONS,
  AI_LOGS_HIDDEN_KIND_NOTES,
  AI_LOGS_PAGE_SUBTITLES,
  AI_LOGS_PAGE_TITLE,
  AI_LOG_KIND_LABELS,
  ALL_KINDS_FILTER,
  AiLogs,
  AiLogsEntry,
  AiLogsStatusLook,
  appendAiLogsEntries,
  describeCommandOrigin,
  describeExecutionMode,
  describeFixKind,
  describeFixTaskType,
  describeVerdicts,
  describeVerification,
  getAiLogDetail,
  getAiLogStatusLook,
  getAiLogSubjectLabel,
  getKindsForFilter,
  parseAiLogs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiLogs";
import {
  INCIDENT_ALERT_AI_DESCRIPTORS,
  getIncidentAlertAiDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiDescriptors";
import { describeSubject } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
  getResourceInvestigationSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiLogs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AIRunAutoGrade from "../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  INCIDENT_ALERT_AI_LOG_KINDS,
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiLogKind,
  IncidentAlertAiSubjectKind,
} from "../../../Types/AI/IncidentAlertAiLogs";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The pure half of the Incidents and Alerts AI Logs page: how it reads the
 * logs route's body and the words it uses for each entry. Every label is
 * English the extractor found, so it is in every Dashboard locale.
 */

const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000002";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function rawEntry(overrides: JSONObject = {}): JSONObject {
  return {
    kind: IncidentAlertAiLogKind.Investigation,
    id: "run-1",
    at: "2026-10-05T10:00:00.000Z",
    subject: {
      kind: "incident",
      id: INCIDENT_ID,
      title: "Database down",
      number: 42,
      numberWithPrefix: "INC-42",
    },
    status: AIRunStatus.Completed,
    summary: "The disk filled up.",
    ...overrides,
  };
}

function entry(overrides: Partial<AiLogsEntry> = {}): AiLogsEntry {
  return {
    kind: IncidentAlertAiLogKind.Investigation,
    id: "run-1",
    at: "2026-10-05T10:00:00.000Z",
    subject: {
      kind: "incident",
      id: INCIDENT_ID,
      title: "Database down",
      number: 42,
      numberWithPrefix: "INC-42",
    },
    status: null,
    completedAt: null,
    summary: null,
    reportSummary: null,
    humanVerdict: null,
    autoGrade: null,
    suggestionType: null,
    executionMode: null,
    rationale: null,
    verificationStatus: null,
    runbookName: null,
    ruleName: null,
    taskNumber: null,
    codeFixTaskType: null,
    command: null,
    commandOrigin: null,
    exitCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("the descriptors", () => {
  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "%s: its pages are real routes of its own product",
    (subjectKind: IncidentAlertAiSubjectKind) => {
      const product: string =
        subjectKind === "incident" ? "incidents" : "alerts";

      for (const page of [
        getIncidentAlertAiDescriptor(subjectKind).insightsPage,
        getIncidentAlertAiDescriptor(subjectKind).logsPage,
        getIncidentAlertAiDescriptor(subjectKind).settingsPage,
        getIncidentAlertAiDescriptor(subjectKind).autoRemediationRulesPage,
        getIncidentAlertAiDescriptor(subjectKind).subjectViewPage,
      ]) {
        expect(RouteMap[page]!.toString()).toContain(`/${product}/`);
      }
    },
  );

  test("the two products never share a page", () => {
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.incident.insightsPage).toBe(
      PageMap.INCIDENTS_AI_INSIGHTS,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.alert.insightsPage).toBe(
      PageMap.ALERTS_AI_INSIGHTS,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.incident.logsPage).toBe(
      PageMap.INCIDENTS_AI_LOGS,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.alert.logsPage).toBe(
      PageMap.ALERTS_AI_LOGS,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.incident.subjectViewPage).toBe(
      PageMap.INCIDENT_VIEW,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.alert.subjectViewPage).toBe(
      PageMap.ALERT_VIEW,
    );
    expect(INCIDENT_ALERT_AI_DESCRIPTORS.incident.testIdPrefix).not.toBe(
      INCIDENT_ALERT_AI_DESCRIPTORS.alert.testIdPrefix,
    );
  });
});

describe("parseAiLogs", () => {
  test("reads the shape the route returns", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        subjectKind: "incident",
        entries: [
          rawEntry({
            humanVerdict: AIRunHumanVerdict.Confirmed,
            autoGrade: AIRunAutoGrade.Partial,
            completedAt: "2026-10-05T10:04:00.000Z",
          }),
        ],
        nextBefore: "2026-10-05T09:00:00.000Z",
        hiddenKinds: [IncidentAlertAiLogKind.Command],
      },
      "incident",
    );

    expect(parsed).toEqual({
      entries: [
        entry({
          status: AIRunStatus.Completed,
          summary: "The disk filled up.",
          completedAt: "2026-10-05T10:04:00.000Z",
          humanVerdict: AIRunHumanVerdict.Confirmed,
          autoGrade: AIRunAutoGrade.Partial,
        }),
      ],
      nextBefore: "2026-10-05T09:00:00.000Z",
      hiddenKinds: [IncidentAlertAiLogKind.Command],
    });
  });

  test("reads the report's Summary an investigation without a TL;DR has", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry({
            summary: null,
            reportSummary: "The certificate expired at midnight.",
          }),
          rawEntry({ id: "run-2", reportSummary: "   " }),
        ],
        nextBefore: null,
        hiddenKinds: [],
      },
      "incident",
    );

    expect(
      parsed?.entries.map((parsedEntry: AiLogsEntry) => {
        return [parsedEntry.summary, parsedEntry.reportSummary];
      }),
    ).toEqual([
      [null, "The certificate expired at midnight."],
      ["The disk filled up.", null],
    ]);
  });

  test("reads every field of every kind", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry({
            kind: IncidentAlertAiLogKind.Fix,
            id: "fix-1",
            status: AutoRemediationSuggestionStatus.Approved,
            suggestionType: AutoRemediationSuggestionType.Runbook,
            executionMode: AutoRemediationExecutionMode.Suggest,
            rationale: "Restart the pod.",
            verificationStatus: AutoRemediationVerificationStatus.Failed,
            runbookName: "Restart",
            ruleName: "Pods",
          }),
          rawEntry({
            kind: IncidentAlertAiLogKind.FixTask,
            id: "task-1",
            taskNumber: 7,
            codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          }),
          rawEntry({
            kind: IncidentAlertAiLogKind.Command,
            id: "job-1",
            command: "kubectl get pods",
            commandOrigin: RunnerJobOrigin.AiInvestigation,
            exitCode: 0,
            errorMessage: "",
          }),
        ],
        nextBefore: null,
        hiddenKinds: [],
      },
      "incident",
    );

    expect(parsed?.entries).toEqual([
      expect.objectContaining({
        kind: IncidentAlertAiLogKind.Fix,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        executionMode: AutoRemediationExecutionMode.Suggest,
        rationale: "Restart the pod.",
        verificationStatus: AutoRemediationVerificationStatus.Failed,
        runbookName: "Restart",
        ruleName: "Pods",
      }),
      expect.objectContaining({
        kind: IncidentAlertAiLogKind.FixTask,
        taskNumber: 7,
        codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
      }),
      expect.objectContaining({
        kind: IncidentAlertAiLogKind.Command,
        command: "kubectl get pods",
        commandOrigin: RunnerJobOrigin.AiInvestigation,
        exitCode: 0,
        // An empty string is no value.
        errorMessage: null,
      }),
    ]);
  });

  test("reads ids and dates sent in their serialized envelope", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry({
            id: { _type: "ObjectID", value: "run-9" },
            at: { _type: "DateTime", value: "2026-10-05T10:00:00.000Z" },
          }),
        ],
      },
      "incident",
    );

    expect(parsed?.entries[0]?.id).toBe("run-9");
    expect(parsed?.entries[0]?.at).toBe("2026-10-05T10:00:00.000Z");
  });

  test("is null for a body that is not the logs at all", () => {
    expect(parseAiLogs(null, "incident")).toBeNull();
    expect(parseAiLogs("logs", "incident")).toBeNull();
    expect(parseAiLogs([], "incident")).toBeNull();
    expect(parseAiLogs({ investigations: [] }, "incident")).toBeNull();
  });

  test.each([
    ["no id", { id: "" }],
    ["no time", { at: undefined }],
    ["a time that is not one", { at: "yesterday" }],
    ["no subject", { subject: undefined }],
    ["a subject without an id", { subject: { kind: "incident" } }],
    ["a kind a newer server added", { kind: "Postmortem" }],
    [
      "the other product's subject",
      { subject: { kind: "alert", id: ALERT_ID } },
    ],
  ])("drops an entry with %s", (_name: string, overrides: JSONObject) => {
    const parsed: AiLogs | null = parseAiLogs(
      { entries: [rawEntry(overrides), rawEntry({ id: "run-2" })] },
      "incident",
    );

    expect(
      parsed?.entries.map((parsedEntry: AiLogsEntry): string => {
        return parsedEntry.id;
      }),
    ).toEqual(["run-2"]);
  });

  test("an entry listed twice is shown once", () => {
    const parsed: AiLogs | null = parseAiLogs(
      { entries: [rawEntry(), rawEntry()] },
      "incident",
    );

    expect(parsed?.entries).toHaveLength(1);
  });

  test("the same id of two kinds is two entries", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry(),
          rawEntry({ kind: IncidentAlertAiLogKind.FixTask }),
        ],
      },
      "incident",
    );

    expect(parsed?.entries).toHaveLength(2);
  });

  test("reads the alert page's subjects as alerts", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry({
            subject: { kind: "alert", id: ALERT_ID, title: "CPU high" },
          }),
        ],
      },
      "alert",
    );

    expect(parsed?.entries[0]?.subject).toEqual({
      kind: "alert",
      id: ALERT_ID,
      title: "CPU high",
      number: null,
      numberWithPrefix: null,
    });
  });

  test("an unreadable next page or hidden kinds read as none", () => {
    expect(
      parseAiLogs(
        { entries: [], nextBefore: "not a date", hiddenKinds: "Fix" },
        "incident",
      ),
    ).toEqual({ entries: [], nextBefore: null, hiddenKinds: [] });
    expect(
      parseAiLogs(
        { entries: [], hiddenKinds: ["Fix", "Mystery", "Command"] },
        "incident",
      )?.hiddenKinds,
    ).toEqual([IncidentAlertAiLogKind.Fix, IncidentAlertAiLogKind.Command]);
  });

  test("a number that is not finite is no number", () => {
    const parsed: AiLogs | null = parseAiLogs(
      {
        entries: [
          rawEntry({
            kind: IncidentAlertAiLogKind.Command,
            exitCode: "1",
          }),
        ],
      },
      "incident",
    );

    expect(parsed?.entries[0]?.exitCode).toBeNull();
  });
});

describe("appendAiLogsEntries", () => {
  test("adds the next page after the entries shown", () => {
    expect(
      appendAiLogsEntries([entry({ id: "a" })], [entry({ id: "b" })]).map(
        (appended: AiLogsEntry): string => {
          return appended.id;
        },
      ),
    ).toEqual(["a", "b"]);
  });

  test("never shows an entry twice", () => {
    expect(
      appendAiLogsEntries(
        [entry({ id: "a" }), entry({ id: "b" })],
        [entry({ id: "b" }), entry({ id: "c" })],
      ).map((appended: AiLogsEntry): string => {
        return appended.id;
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("the filter", () => {
  test("offers everything, then each kind once", () => {
    expect(
      AI_LOGS_FILTER_OPTIONS.map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual([ALL_KINDS_FILTER, ...INCIDENT_ALERT_AI_LOG_KINDS]);
  });

  test("asks the route for one kind, or for every kind", () => {
    expect(getKindsForFilter(ALL_KINDS_FILTER)).toBeUndefined();
    expect(getKindsForFilter("nonsense")).toBeUndefined();

    for (const kind of INCIDENT_ALERT_AI_LOG_KINDS) {
      expect(getKindsForFilter(kind)).toEqual([kind]);
    }
  });
});

describe("status pills", () => {
  test.each([
    [
      IncidentAlertAiLogKind.Investigation,
      AIRunStatus.Running,
      "Investigating",
      Yellow500,
    ],
    [
      IncidentAlertAiLogKind.Investigation,
      AIRunStatus.Completed,
      "Completed",
      Green500,
    ],
    [IncidentAlertAiLogKind.Investigation, AIRunStatus.Error, "Failed", Red500],
    [
      IncidentAlertAiLogKind.Investigation,
      AIRunStatus.Stale,
      "Timed out",
      Gray500,
    ],
    [
      IncidentAlertAiLogKind.FixTask,
      AIRunStatus.Completed,
      "Pull request opened",
      Green500,
    ],
    [
      IncidentAlertAiLogKind.FixTask,
      AIRunStatus.Running,
      "In progress",
      Yellow500,
    ],
    [
      IncidentAlertAiLogKind.FixTask,
      AIRunStatus.NoFixFound,
      "No fix found",
      Gray500,
    ],
    [
      IncidentAlertAiLogKind.Fix,
      AutoRemediationSuggestionStatus.Suggested,
      "Waiting for approval",
      Yellow500,
    ],
    [
      IncidentAlertAiLogKind.Fix,
      AutoRemediationSuggestionStatus.AutoExecuted,
      "Applied automatically",
      Green500,
    ],
    [
      IncidentAlertAiLogKind.Fix,
      AutoRemediationSuggestionStatus.Approved,
      "Applied after approval",
      Green500,
    ],
    [
      IncidentAlertAiLogKind.Fix,
      AutoRemediationSuggestionStatus.Dismissed,
      "Dismissed",
      Gray500,
    ],
    [
      IncidentAlertAiLogKind.Command,
      RunnerJobStatus.Succeeded,
      "Succeeded",
      Green500,
    ],
    [IncidentAlertAiLogKind.Command, RunnerJobStatus.Failed, "Failed", Red500],
    [
      IncidentAlertAiLogKind.Command,
      RunnerJobStatus.TimedOut,
      "Not picked up in time",
      Red500,
    ],
    [
      IncidentAlertAiLogKind.Command,
      RunnerJobStatus.Pending,
      "Waiting to run",
      Yellow500,
    ],
  ])(
    "%s %s reads %s",
    (
      kind: IncidentAlertAiLogKind,
      status: string,
      label: string,
      color: unknown,
    ) => {
      const look: AiLogsStatusLook | null = getAiLogStatusLook({
        kind,
        status,
      });

      expect(look?.label).toBe(label);
      expect(look?.color).toBe(color);
    },
  );

  // Every status of every kind, so a status added later fails here first.
  test("every status of every kind has words of its own", () => {
    const labelsOf: (
      kind: IncidentAlertAiLogKind,
      statuses: Array<string>,
    ) => Record<string, string | undefined> = (
      kind: IncidentAlertAiLogKind,
      statuses: Array<string>,
    ): Record<string, string | undefined> => {
      const labels: Record<string, string | undefined> = {};

      for (const status of statuses) {
        labels[status] = getAiLogStatusLook({ kind, status })?.label;
      }

      return labels;
    };

    expect(
      labelsOf(
        IncidentAlertAiLogKind.Investigation,
        Object.values(AIRunStatus),
      ),
    ).toEqual({
      [AIRunStatus.Queued]: "Queued",
      [AIRunStatus.Running]: "Investigating",
      [AIRunStatus.WaitingForApproval]: "Waiting for approval",
      [AIRunStatus.Completed]: "Completed",
      [AIRunStatus.NoFixFound]: "No fix found",
      [AIRunStatus.Error]: "Failed",
      [AIRunStatus.Cancelled]: "Cancelled",
      [AIRunStatus.Stale]: "Timed out",
    });
    expect(
      labelsOf(IncidentAlertAiLogKind.FixTask, Object.values(AIRunStatus)),
    ).toEqual({
      [AIRunStatus.Queued]: "Queued",
      [AIRunStatus.Running]: "In progress",
      [AIRunStatus.WaitingForApproval]: "Waiting for approval",
      [AIRunStatus.Completed]: "Pull request opened",
      [AIRunStatus.NoFixFound]: "No fix found",
      [AIRunStatus.Error]: "Failed",
      [AIRunStatus.Cancelled]: "Cancelled",
      [AIRunStatus.Stale]: "Timed out",
    });
    expect(
      labelsOf(
        IncidentAlertAiLogKind.Fix,
        Object.values(AutoRemediationSuggestionStatus),
      ),
    ).toEqual({
      [AutoRemediationSuggestionStatus.Planning]: "Planning",
      [AutoRemediationSuggestionStatus.Suggested]: "Waiting for approval",
      [AutoRemediationSuggestionStatus.Approved]: "Applied after approval",
      [AutoRemediationSuggestionStatus.AutoExecuted]: "Applied automatically",
      [AutoRemediationSuggestionStatus.Dismissed]: "Dismissed",
      [AutoRemediationSuggestionStatus.NoneApplicable]: "No fix found",
    });
    expect(
      labelsOf(IncidentAlertAiLogKind.Command, Object.values(RunnerJobStatus)),
    ).toEqual({
      [RunnerJobStatus.Pending]: "Waiting to run",
      [RunnerJobStatus.Claimed]: "Starting",
      [RunnerJobStatus.Running]: "Running",
      [RunnerJobStatus.Succeeded]: "Succeeded",
      [RunnerJobStatus.Failed]: "Failed",
      [RunnerJobStatus.TimedOut]: "Not picked up in time",
      [RunnerJobStatus.Cancelled]: "Cancelled",
    });
  });

  test("a status a newer server added shows as it is, in a neutral pill", () => {
    expect(
      getAiLogStatusLook({
        kind: IncidentAlertAiLogKind.Command,
        status: "Paused",
      }),
    ).toEqual({ label: "Paused", color: Gray500 });
  });

  test("an entry without a status has no pill", () => {
    expect(
      getAiLogStatusLook({
        kind: IncidentAlertAiLogKind.Command,
        status: null,
      }),
    ).toBeNull();
  });
});

describe("the facts under an entry", () => {
  test("say how a fix ran and how it turned out", () => {
    expect(describeFixKind(AutoRemediationSuggestionType.CommandPlan)).toBe(
      "Command plan",
    );
    expect(describeFixKind(AutoRemediationSuggestionType.Runbook)).toBe(
      "Runbook",
    );
    expect(describeFixKind(null)).toBeNull();
    expect(describeExecutionMode(AutoRemediationExecutionMode.FullAuto)).toBe(
      "Runs without approval",
    );
    expect(describeExecutionMode(AutoRemediationExecutionMode.Suggest)).toBe(
      "Asks for approval",
    );
    expect(describeExecutionMode("Later")).toBeNull();

    for (const status of Object.values(AutoRemediationVerificationStatus)) {
      expect(describeVerification(status)).toBeTruthy();
    }

    expect(describeVerification(null)).toBeNull();
    expect(describeVerification("Unknown")).toBeNull();
  });

  test("say what a fix pull request was for", () => {
    expect(describeFixTaskType(CodeFixTaskType.FixFromIncident)).toBe(
      "Fix the root cause the investigation found",
    );
    expect(describeFixTaskType(CodeFixTaskType.ImproveInstrumentation)).toBe(
      "Add the telemetry the investigation was missing",
    );
    expect(describeFixTaskType(CodeFixTaskType.FixException)).toBeNull();
    expect(describeFixTaskType(null)).toBeNull();
  });

  test("say why a command ran", () => {
    expect(describeCommandOrigin(RunnerJobOrigin.AiInvestigation)).toBe(
      "While investigating (read-only)",
    );
    expect(describeCommandOrigin(RunnerJobOrigin.AiRemediation)).toBe(
      "To fix it",
    );
    expect(describeCommandOrigin(RunnerJobOrigin.Runbook)).toBeNull();
  });

  test("say what people and the grader made of a finding", () => {
    expect(
      describeVerdicts({
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Match,
      }),
    ).toEqual(["Confirmed by your team", "Matched the recorded root cause"]);
    expect(
      describeVerdicts({
        humanVerdict: AIRunHumanVerdict.Rejected,
        autoGrade: AIRunAutoGrade.Mismatch,
      }),
    ).toEqual([
      "Rejected by your team",
      "Did not match the recorded root cause",
    ]);
    expect(
      describeVerdicts({
        humanVerdict: null,
        autoGrade: AIRunAutoGrade.Partial,
      }),
    ).toEqual(["Partly matched the recorded root cause"]);
    expect(describeVerdicts({ humanVerdict: null, autoGrade: null })).toEqual(
      [],
    );
  });
});

describe("getAiLogDetail", () => {
  test("an investigation shows its finding, as the server wrote it", () => {
    expect(getAiLogDetail(entry({ summary: "The disk filled up." }))).toEqual({
      text: "The disk filled up.",
      isOwnWords: false,
      isCommand: false,
    });
  });

  test("without a TL;DR, the Summary its report opens with", () => {
    expect(
      getAiLogDetail(
        entry({
          status: AIRunStatus.Completed,
          summary: null,
          reportSummary: "The certificate expired at midnight.",
        }),
      ),
    ).toEqual({
      text: "The certificate expired at midnight.",
      isOwnWords: false,
      isCommand: false,
    });
  });

  test("the TL;DR wins over the report's Summary", () => {
    expect(
      getAiLogDetail(
        entry({
          summary: "The disk filled up.",
          reportSummary: "A longer story about the disk.",
        }),
      )?.text,
    ).toBe("The disk filled up.");
  });

  test("an investigation still running says so", () => {
    for (const status of [AIRunStatus.Queued, AIRunStatus.Running]) {
      expect(getAiLogDetail(entry({ status }))).toEqual({
        text: "Still investigating.",
        isOwnWords: false,
        isCommand: false,
      });
    }
  });

  test("an investigation that recorded no finding says so, as a resource's AI Logs do", () => {
    for (const status of [
      AIRunStatus.Completed,
      AIRunStatus.Error,
      AIRunStatus.Stale,
      AIRunStatus.Cancelled,
    ]) {
      expect(getAiLogDetail(entry({ status }))?.text).toBe(
        "No summary was recorded.",
      );
    }
  });

  test("says it the resource AI Logs' way, whatever the entry", () => {
    for (const status of Object.values(AIRunStatus)) {
      for (const [summary, reportSummary] of [
        [null, null],
        ["A finding.", null],
        [null, "A report summary."],
      ] as Array<[string | null, string | null]>) {
        expect(
          getAiLogDetail(entry({ status, summary, reportSummary }))?.text,
        ).toBe(
          getResourceInvestigationSummary({
            analysisTldr: summary,
            reportSummary,
            status,
          }),
        );
      }
    }
  });

  test("a fix shows its reason; a fix pull request what it was for; a command the command", () => {
    expect(
      getAiLogDetail(
        entry({ kind: IncidentAlertAiLogKind.Fix, rationale: "Restart it." }),
      ),
    ).toEqual({ text: "Restart it.", isOwnWords: false, isCommand: false });
    expect(
      getAiLogDetail(
        entry({
          kind: IncidentAlertAiLogKind.FixTask,
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
        }),
      ),
    ).toEqual({
      text: "Fix the root cause the investigation found",
      isOwnWords: true,
      isCommand: false,
    });
    expect(
      getAiLogDetail(
        entry({ kind: IncidentAlertAiLogKind.Command, command: "uptime" }),
      ),
    ).toEqual({ text: "uptime", isOwnWords: false, isCommand: true });
    expect(
      getAiLogDetail(entry({ kind: IncidentAlertAiLogKind.Command })),
    ).toBeNull();
  });
});

describe("getAiLogSubjectLabel", () => {
  test("names an incident by its prefixed number and title, as every AI page does", () => {
    expect(getAiLogSubjectLabel(entry().subject)).toBe(
      "Incident INC-42: Database down",
    );
  });

  test("falls back to the bare number, the number alone, the title alone, or the kind", () => {
    expect(
      getAiLogSubjectLabel({
        kind: "incident",
        id: INCIDENT_ID,
        title: "Database down",
        number: 42,
        numberWithPrefix: null,
      }),
    ).toBe("Incident #42: Database down");
    expect(
      getAiLogSubjectLabel({
        kind: "alert",
        id: ALERT_ID,
        title: null,
        number: 7,
        numberWithPrefix: "ALT-7",
      }),
    ).toBe("Alert ALT-7");
    expect(
      getAiLogSubjectLabel({
        kind: "alert",
        id: ALERT_ID,
        title: "CPU high",
        number: null,
        numberWithPrefix: null,
      }),
    ).toBe("Alert: CPU high");
    expect(
      getAiLogSubjectLabel({
        kind: "alert",
        id: ALERT_ID,
        title: null,
        number: null,
        numberWithPrefix: null,
      }),
    ).toBe("Alert");
  });

  test("is the shared AI pages' name for the same subject", () => {
    expect(
      getAiLogSubjectLabel({
        kind: "alert",
        id: ALERT_ID,
        title: "CPU high",
        number: 7,
        numberWithPrefix: "ALT-7",
      }),
    ).toBe(
      describeSubject({
        kind: "alert",
        id: ALERT_ID,
        title: "CPU high",
        number: 7,
        numberWithPrefix: "ALT-7",
      }),
    );
  });
});

describe("the statuses are the resource AI Logs' own", () => {
  test("an investigation's and a fix's pill say what a resource's AI Logs say", () => {
    for (const status of Object.values(AIRunStatus)) {
      expect(
        getAiLogStatusLook({
          kind: IncidentAlertAiLogKind.Investigation,
          status,
        }),
      ).toEqual(getResourceInvestigationStatusLook(status));
    }

    for (const status of Object.values(AutoRemediationSuggestionStatus)) {
      expect(
        getAiLogStatusLook({ kind: IncidentAlertAiLogKind.Fix, status }),
      ).toEqual(getResourceFixStatusLook(status));
    }
  });
});

describe("the words are in every Dashboard locale", () => {
  const LOCALE_CODES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  const WORDS: Array<string> = [
    AI_LOGS_PAGE_TITLE,
    AI_LOGS_EMPTY_TITLE,
    ...Object.values(AI_LOGS_PAGE_SUBTITLES),
    ...Object.values(AI_LOGS_EMPTY_DESCRIPTIONS),
    ...Object.values(AI_LOGS_HIDDEN_KIND_NOTES),
    ...Object.values(AI_LOG_KIND_LABELS),
    ...AI_LOGS_FILTER_OPTIONS.map((option: { label: string }): string => {
      return option.label;
    }),
    ...INCIDENT_ALERT_AI_LOG_KINDS.flatMap(
      (kind: IncidentAlertAiLogKind): Array<string> => {
        const statuses: Array<string> =
          kind === IncidentAlertAiLogKind.Fix
            ? Object.values(AutoRemediationSuggestionStatus)
            : kind === IncidentAlertAiLogKind.Command
              ? Object.values(RunnerJobStatus)
              : Object.values(AIRunStatus);

        return statuses.map((status: string): string => {
          return getAiLogStatusLook({ kind, status })!.label;
        });
      },
    ),
  ];

  test("seventeen of them", () => {
    expect(LOCALE_CODES).toHaveLength(17);
  });

  test.each(LOCALE_CODES)("%s has every one", (code: string) => {
    const locale: Record<string, unknown> = readLocale(code);

    expect(
      WORDS.filter((word: string): boolean => {
        return typeof locale[word] !== "string";
      }),
    ).toEqual([]);
  });
});
