/*
 * A workflow run as a file someone can keep, attach to a ticket or send on.
 *
 * Two files, for two jobs:
 *
 *   - The log, as plain text (.txt): the Full Log tab's lines, exactly as the
 *     runner printed them, under a short heading that says which workflow and
 *     which run they belong to, how it ended and when. A log that has been
 *     passed along twice still says what it is.
 *   - The whole run, as JSON (.json): the same heading as data, every step the
 *     Steps tab shows with what it received and returned, and the log as a
 *     list of lines, for reading in an editor or feeding to a script.
 *
 * Both are built from what the dashboard already holds - the run it read
 * through the API - and nothing else. That is what keeps them safe to hand
 * on: the runner redacts secret variables and sensitive values before a run
 * is ever stored, so the log and the steps arrive redacted, and the only
 * other fields written here are the run's own id, status and times and its
 * workflow's id and name. A user can download exactly what they could read.
 *
 * This module only builds names and text; it touches no browser API, so it
 * is tested as plain functions. DownloadWorkflowRun saves the result.
 */

import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "../../../Types/Workflow/WorkflowStatus";
import {
  WorkflowStepTrace,
  parseTrace,
} from "../../../Types/Workflow/StepTrace";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";

export type WorkflowRunDate = Date | string | null | undefined;

/** Which run a log belongs to: what names the file and heads it. */
export interface WorkflowRunDetails {
  /** The run's id, which is its WorkflowLog row's id. */
  runId?: string | null | undefined;
  workflowId?: string | null | undefined;
  workflowName?: string | null | undefined;
  status?: WorkflowStatus | string | null | undefined;
  /**
   * When the trigger fired and the run was queued: the row's createdAt, which
   * the run lists call Scheduled At.
   */
  scheduledAt?: WorkflowRunDate;
  startedAt?: WorkflowRunDate;
  completedAt?: WorkflowRunDate;
}

/** A run, with everything a download writes. */
export interface WorkflowRunExport extends WorkflowRunDetails {
  logs: string;
  stepTrace: WorkflowStepTrace;
}

export enum WorkflowRunExportFormat {
  // The log as plain text.
  Log = "Log",
  // The whole run - steps included - as JSON.
  JSON = "JSON",
}

export interface WorkflowRunExportFile {
  fileName: string;
  content: string;
  mimeType: string;
}

export const WORKFLOW_RUN_LOG_EXTENSION: string = "txt";
export const WORKFLOW_RUN_JSON_EXTENSION: string = "json";

export const WORKFLOW_RUN_LOG_MIME_TYPE: string = "text/plain;charset=utf-8";
export const WORKFLOW_RUN_JSON_MIME_TYPE: string =
  "application/json;charset=utf-8";

/*
 * The workflow's name is cut to this many characters in a file name. Each one
 * can take three bytes in UTF-8 (a Japanese or Chinese name), and most file
 * systems stop at 255 bytes, which the run id and the time also need room in.
 */
export const WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH: number = 50;

// A name with nothing left once it is made safe for a file name.
export const WORKFLOW_RUN_FILE_NAME_FALLBACK: string = "workflow";

// Under the heading of a run that printed nothing.
export const WORKFLOW_RUN_EMPTY_LOG_LINE: string =
  "This run did not log anything.";

export type ToDateFunction = (value: WorkflowRunDate) => Date | null;

/*
 * A run's time as a real date, or null. Models carry Date objects, a step
 * trace carries ISO strings, and an old or partial row can carry nothing at
 * all - or something that is not a date, which is treated as nothing rather
 * than printed as "Invalid Date".
 */
export const toRunDate: ToDateFunction = (
  value: WorkflowRunDate,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return isNaN(date.getTime()) ? null : date;
};

type ToIsoStringFunction = (value: WorkflowRunDate) => string | null;

const toIsoString: ToIsoStringFunction = (
  value: WorkflowRunDate,
): string | null => {
  const date: Date | null = toRunDate(value);

  return date ? date.toISOString() : null;
};

type CleanTextFunction = (value: string | null | undefined) => string | null;

const cleanText: CleanTextFunction = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed : null;
};

export type GetWorkflowNameForFileNameFunction = (
  workflowName: string | null | undefined,
) => string;

/*
 * The workflow's name as the start of a file name: lower case, with every run
 * of spaces, punctuation and characters a file system refuses (/ \ : * ? " < >
 * |) turned into one dash. Letters and digits of every script stay, so a
 * workflow called "Nächtlicher Abgleich" or "夜間同期" keeps its name.
 */
export const getWorkflowNameForFileName: GetWorkflowNameForFileNameFunction = (
  workflowName: string | null | undefined,
): string => {
  const slug: string = (workflowName || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  /*
   * Cut by characters, not by UTF-16 units, so a letter outside the Basic
   * Multilingual Plane is never split in half.
   */
  const shortened: string = Array.from(slug)
    .slice(0, WORKFLOW_RUN_FILE_NAME_MAX_NAME_LENGTH)
    .join("")
    .replace(/-+$/g, "");

  return shortened || WORKFLOW_RUN_FILE_NAME_FALLBACK;
};

export type GetRunTimeForFileNameFunction = (
  run: WorkflowRunDetails,
) => string | null;

/*
 * When the run happened, as a file name can hold it: the time it started, or
 * the time it was queued when it never started, in UTC, with dashes where an
 * ISO time has colons (which Windows does not allow) - 2026-09-30T10-00-01.
 * The same shape every other OneUptime download stamps its file with.
 */
export const getRunTimeForFileName: GetRunTimeForFileNameFunction = (
  run: WorkflowRunDetails,
): string | null => {
  const date: Date | null =
    toRunDate(run.startedAt) || toRunDate(run.scheduledAt);

  if (!date) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace(/:/g, "-");
};

type GetRunIdForFileNameFunction = (
  runId: string | null | undefined,
) => string | null;

// An id is letters, digits and dashes; anything else is not one to trust.
const getRunIdForFileName: GetRunIdForFileNameFunction = (
  runId: string | null | undefined,
): string | null => {
  const id: string = (cleanText(runId) || "").replace(/[^A-Za-z0-9-]+/g, "");

  return id || null;
};

export type GetWorkflowRunFileNameFunction = (
  run: WorkflowRunDetails,
  format: WorkflowRunExportFormat,
) => string;

/**
 * What a downloaded run is called: the workflow, the run and when it ran, so
 * a folder of them sorts by workflow and then by time, and two runs never
 * share a name - nightly-sync-run-0193c0de-…-2026-09-30T10-00-01.txt.
 */
export const getWorkflowRunFileName: GetWorkflowRunFileNameFunction = (
  run: WorkflowRunDetails,
  format: WorkflowRunExportFormat,
): string => {
  const parts: Array<string> = [
    getWorkflowNameForFileName(run.workflowName),
    "run",
  ];

  const runId: string | null = getRunIdForFileName(run.runId);

  if (runId) {
    parts.push(runId);
  }

  const time: string | null = getRunTimeForFileName(run);

  if (time) {
    parts.push(time);
  }

  const extension: string =
    format === WorkflowRunExportFormat.JSON
      ? WORKFLOW_RUN_JSON_EXTENSION
      : WORKFLOW_RUN_LOG_EXTENSION;

  return `${parts.join("-")}.${extension}`;
};

export type HasWorkflowRunContentFunction = (
  run: Pick<WorkflowRunExport, "logs" | "stepTrace">,
) => boolean;

/** There is something to copy or download: a log, or at least one step. */
export const hasWorkflowRunContent: HasWorkflowRunContentFunction = (
  run: Pick<WorkflowRunExport, "logs" | "stepTrace">,
): boolean => {
  if (typeof run.logs === "string" && run.logs.length > 0) {
    return true;
  }

  const steps: unknown = run.stepTrace?.steps;

  // A hole in the list is not a step, as the Steps tab counts them.
  return (
    Array.isArray(steps) &&
    steps.some((step: unknown): boolean => {
      return Boolean(step) && typeof step === "object";
    })
  );
};

export type GetWorkflowRunHeadingLinesFunction = (
  run: WorkflowRunDetails,
) => Array<string>;

/*
 * The heading above a downloaded log, one fact to a line. A fact the
 * dashboard does not have - a run that has not finished has no Completed at -
 * is left out rather than written as a blank.
 */
export const getWorkflowRunHeadingLines: GetWorkflowRunHeadingLinesFunction = (
  run: WorkflowRunDetails,
): Array<string> => {
  const lines: Array<string> = [];

  type AddLineFunction = (label: string, value: string | null) => void;

  const addLine: AddLineFunction = (
    label: string,
    value: string | null,
  ): void => {
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  };

  addLine("Workflow", cleanText(run.workflowName));
  addLine("Workflow ID", cleanText(run.workflowId));
  addLine("Run ID", cleanText(run.runId));
  addLine("Status", run.status ? getWorkflowStatusLabel(run.status) : null);
  addLine("Scheduled at", toIsoString(run.scheduledAt));
  addLine("Started at", toIsoString(run.startedAt));
  addLine("Completed at", toIsoString(run.completedAt));

  return lines;
};

export type BuildWorkflowRunLogTextFunction = (
  run: WorkflowRunExport,
) => string;

/**
 * The .txt: the heading, a blank line, then the log exactly as it was
 * printed - not re-wrapped, not cut short however long it is - ending with a
 * newline, as a text file should.
 */
export const buildWorkflowRunLogText: BuildWorkflowRunLogTextFunction = (
  run: WorkflowRunExport,
): string => {
  const heading: Array<string> = getWorkflowRunHeadingLines(run);
  const logs: string = typeof run.logs === "string" ? run.logs : "";
  const body: string = logs.length > 0 ? logs : WORKFLOW_RUN_EMPTY_LOG_LINE;

  const text: string =
    heading.length > 0 ? `${heading.join("\n")}\n\n${body}` : body;

  return text.endsWith("\n") ? text : `${text}\n`;
};

export type GetLogLinesFunction = (logs: string) => Array<string>;

/*
 * The log as its lines. Splitting on "\n" and joining them back with it gives
 * the log back exactly, so nothing is lost; an empty log has no lines rather
 * than one empty one.
 */
export const getLogLines: GetLogLinesFunction = (
  logs: string,
): Array<string> => {
  if (typeof logs !== "string" || logs.length === 0) {
    return [];
  }

  return logs.split("\n");
};

export type GetWorkflowRunJsonFunction = (run: WorkflowRunExport) => JSONObject;

/**
 * The .json, as an object:
 *
 *   workflow   - its id and name
 *   run        - its id, status (as the API stores it: "Success", not the
 *                list's "Executed"), and when it was scheduled, started and
 *                completed, as ISO times or null
 *   stepTrace  - the steps, in the same shape the API returns a run's
 *                stepTrace in (see Types/Workflow/StepTrace)
 *   log        - the full log, one string per line
 */
export const getWorkflowRunJson: GetWorkflowRunJsonFunction = (
  run: WorkflowRunExport,
): JSONObject => {
  return {
    workflow: {
      id: cleanText(run.workflowId),
      name: cleanText(run.workflowName),
    },
    run: {
      id: cleanText(run.runId),
      status: cleanText(run.status),
      scheduledAt: toIsoString(run.scheduledAt),
      startedAt: toIsoString(run.startedAt),
      completedAt: toIsoString(run.completedAt),
    },
    stepTrace: (run.stepTrace || { steps: [] }) as unknown as JSONObject,
    log: getLogLines(run.logs),
  };
};

export type BuildWorkflowRunJsonTextFunction = (
  run: WorkflowRunExport,
) => string;

export const buildWorkflowRunJsonText: BuildWorkflowRunJsonTextFunction = (
  run: WorkflowRunExport,
): string => {
  return `${JSON.stringify(getWorkflowRunJson(run), null, 2)}\n`;
};

export type GetWorkflowRunExportFileFunction = (
  run: WorkflowRunExport,
  format: WorkflowRunExportFormat,
) => WorkflowRunExportFile;

export const getWorkflowRunExportFile: GetWorkflowRunExportFileFunction = (
  run: WorkflowRunExport,
  format: WorkflowRunExportFormat,
): WorkflowRunExportFile => {
  if (format === WorkflowRunExportFormat.JSON) {
    return {
      fileName: getWorkflowRunFileName(run, format),
      content: buildWorkflowRunJsonText(run),
      mimeType: WORKFLOW_RUN_JSON_MIME_TYPE,
    };
  }

  return {
    fileName: getWorkflowRunFileName(run, WorkflowRunExportFormat.Log),
    content: buildWorkflowRunLogText(run),
    mimeType: WORKFLOW_RUN_LOG_MIME_TYPE,
  };
};

export type GetWorkflowRunExportFromWorkflowLogFunction = (
  log: WorkflowLog,
) => WorkflowRunExport;

/**
 * A row of the run lists, as a run to download. Reads only the columns the
 * lists already ask the API for - the run's id, status and times, its
 * workflow, its log and its steps - so a row downloads exactly what the user
 * was allowed to read.
 */
export const getWorkflowRunExportFromWorkflowLog: GetWorkflowRunExportFromWorkflowLogFunction =
  (log: WorkflowLog): WorkflowRunExport => {
    const workflowId: string | null =
      log.workflowId?.toString() ||
      (log.workflow?._id ? String(log.workflow._id) : null);

    return {
      runId: log._id ? String(log._id) : null,
      workflowId: workflowId,
      workflowName: log.workflow?.name || null,
      status: log.workflowStatus || null,
      scheduledAt: log.createdAt || null,
      startedAt: log.startedAt || null,
      completedAt: log.completedAt || null,
      logs: typeof log.logs === "string" ? log.logs : "",
      stepTrace: parseTrace((log.stepTrace as JSONValue) || null),
    };
  };
