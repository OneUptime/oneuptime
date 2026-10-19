import {
  CodeTaskChanges,
  CodeTaskFileChange,
  CodeTaskFileDiff,
  CodeTaskFileStatus,
  CodeTaskOutcome,
} from "../../../../Types/AI/CodeTask";
import { JSONObject } from "../../../../Types/JSON";

/*
 * READS WHAT A RUNNER SAYS A CODE TASK'S TURN ENDED WITH.
 *
 * A Runner reports the AI's reply, the files the turn changed, their diff,
 * and the branch and pull request it pushed to, with the turn's Completed
 * status (/ai-agent-task/update-task-status). Nothing of it is taken on
 * trust: every field is type-checked, unknown fields are dropped, and every
 * text is capped - a Runner is another program, possibly older or newer
 * than this server, and the report is kept on the run and shown in the
 * conversation. The Runner redacts secrets before it reports (its
 * SecretRedactor knows the repository token and its own environment).
 *
 * Null when the report carries no outcome at all, or one that is not an
 * object: the turn is then kept exactly as a turn of an older Runner.
 */

export const MAX_OUTCOME_SUMMARY_LENGTH: number = 20000;
export const MAX_OUTCOME_FILES: number = 300;
export const MAX_DIFF_FILES: number = 100;
export const MAX_FILE_PATCH_LENGTH: number = 20000;
export const MAX_DIFF_LENGTH: number = 200000;
const MAX_PATH_LENGTH: number = 1000;
const MAX_BRANCH_LENGTH: number = 255;
const MAX_URL_LENGTH: number = 2000;

export interface CodeTaskOutcomeRead {
  outcome: CodeTaskOutcome;
  changes: CodeTaskChanges | null;
  needsInput: boolean;
}

export default class CodeTaskOutcomeReader {
  public static read(raw: unknown): CodeTaskOutcomeRead | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const report: JSONObject = raw as JSONObject;

    const outcome: CodeTaskOutcome = {
      summary: CodeTaskOutcomeReader.cut(
        typeof report["summary"] === "string" ? report["summary"] : "",
        MAX_OUTCOME_SUMMARY_LENGTH,
      ),
      filesChanged: CodeTaskOutcomeReader.readFiles(
        report["filesChanged"],
        MAX_OUTCOME_FILES,
      ),
    };

    const branchName: string | undefined = CodeTaskOutcomeReader.readText(
      report["branchName"],
      MAX_BRANCH_LENGTH,
    );

    if (branchName) {
      outcome.branchName = branchName;
    }

    const pullRequestNumber: unknown = report["pullRequestNumber"];

    if (
      typeof pullRequestNumber === "number" &&
      Number.isSafeInteger(pullRequestNumber) &&
      pullRequestNumber > 0
    ) {
      outcome.pullRequestNumber = pullRequestNumber;
    }

    const pullRequestUrl: string | undefined =
      CodeTaskOutcomeReader.readWebAddress(report["pullRequestUrl"]);

    if (pullRequestUrl) {
      outcome.pullRequestUrl = pullRequestUrl;
    }

    if (typeof report["openedPullRequest"] === "boolean") {
      outcome.openedPullRequest = report["openedPullRequest"];
    }

    return {
      outcome,
      changes: CodeTaskOutcomeReader.readChanges(report["changes"]),
      needsInput: report["needsInput"] === true,
    };
  }

  private static readChanges(raw: unknown): CodeTaskChanges | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const changes: JSONObject = raw as JSONObject;
    const entries: unknown = changes["files"];

    if (!Array.isArray(entries)) {
      return null;
    }

    let isTruncated: boolean =
      changes["isTruncated"] === true || entries.length > MAX_DIFF_FILES;
    let budget: number = MAX_DIFF_LENGTH;
    const files: Array<CodeTaskFileDiff> = [];

    for (const entry of entries.slice(0, MAX_DIFF_FILES)) {
      const file: CodeTaskFileChange | null =
        CodeTaskOutcomeReader.readFile(entry);

      if (!file) {
        continue;
      }

      const rawPatch: unknown = (entry as JSONObject)["patch"];
      let patch: string | null = typeof rawPatch === "string" ? rawPatch : null;
      let isPatchTruncated: boolean =
        (entry as JSONObject)["isPatchTruncated"] === true;

      if (patch !== null) {
        const allowed: number = Math.min(MAX_FILE_PATCH_LENGTH, budget);

        if (patch.length > allowed) {
          patch = patch.substring(0, allowed);
          isPatchTruncated = true;
          isTruncated = true;
        }

        budget -= patch.length;
      }

      files.push({
        ...file,
        patch,
        ...(isPatchTruncated ? { isPatchTruncated: true } : {}),
      });
    }

    return { files, isTruncated };
  }

  private static readFiles(
    raw: unknown,
    max: number,
  ): Array<CodeTaskFileChange> {
    if (!Array.isArray(raw)) {
      return [];
    }

    const files: Array<CodeTaskFileChange> = [];

    for (const entry of raw.slice(0, max)) {
      const file: CodeTaskFileChange | null =
        CodeTaskOutcomeReader.readFile(entry);

      if (file) {
        files.push(file);
      }
    }

    return files;
  }

  private static readFile(raw: unknown): CodeTaskFileChange | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const entry: JSONObject = raw as JSONObject;
    const path: string | undefined = CodeTaskOutcomeReader.readText(
      entry["path"],
      MAX_PATH_LENGTH,
    );

    if (!path) {
      return null;
    }

    const status: CodeTaskFileStatus = Object.values(
      CodeTaskFileStatus,
    ).includes(entry["status"] as CodeTaskFileStatus)
      ? (entry["status"] as CodeTaskFileStatus)
      : CodeTaskFileStatus.Modified;

    const file: CodeTaskFileChange = {
      path,
      status,
      additions: CodeTaskOutcomeReader.readCount(entry["additions"]),
      deletions: CodeTaskOutcomeReader.readCount(entry["deletions"]),
    };

    const previousPath: string | undefined = CodeTaskOutcomeReader.readText(
      entry["previousPath"],
      MAX_PATH_LENGTH,
    );

    if (previousPath) {
      file.previousPath = previousPath;
    }

    return file;
  }

  private static readCount(raw: unknown): number {
    return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
      ? raw
      : 0;
  }

  private static readText(raw: unknown, max: number): string | undefined {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return undefined;
    }

    return raw.trim().substring(0, max);
  }

  // An https:// (or http://) address, or nothing.
  private static readWebAddress(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) {
      return undefined;
    }

    try {
      const parsed: URL = new URL(raw);

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return undefined;
      }

      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  private static cut(text: string, max: number): string {
    return text.length > max
      ? `${text.substring(0, max)}\n… (truncated)`
      : text;
  }
}
