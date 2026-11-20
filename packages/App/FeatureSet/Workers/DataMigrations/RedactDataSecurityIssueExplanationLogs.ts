import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import LlmLogService from "Common/Server/Services/LlmLogService";
import logger from "Common/Server/Utils/Logger";

/*
 * TAKES DATA SECURITY ISSUES OUT OF THE AI LOGS EXPLAIN WITH AI WROTE THEM
 * TO (#10361).
 *
 * Explain with AI on a Data Security issue kept what it sent OneUptime AI
 * and what OneUptime AI answered in the project's AI Logs: the first 5,000
 * characters of the prompt - the issue's store, its cloud id and region,
 * the data types it holds, the evidence that it is exposed - in
 * LlmLog.requestPrompt, and the explanation in responsePreview. The AI Logs
 * are read by every Project Member and Viewer, and an issue only by Project
 * Owners, Project Admins and the Security roles. It keeps none since #10361
 * (storeContentPreviews: false), and no provider error either
 * (storeErrorDetails: false), which can quote the prompt it was sent.
 *
 * So every row of that feature, deleted ones too, is written as the call
 * writes one now: each preview it holds becomes the words a call that keeps
 * none writes in its place, and a failed call's status message the words a
 * call that keeps no error details writes. A page of rows at a time, by
 * "_id", in one statement each. Rows that hold no preview are left as they
 * are; a call that failed before it was sent holds no answer, and keeps
 * none.
 *
 * Idempotent, and safe to run twice at once: a row written so already is
 * not read again, and writing the same words twice changes nothing.
 *
 * The words are written out here, as they were when it ran, and
 * AIService's own constants are pinned to them
 * (RedactDataSecurityIssueExplanationLogs.test.ts). Nothing to roll back:
 * the previews it took out are gone.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface LogIdRow {
  _id: string;
}

export default class RedactDataSecurityIssueExplanationLogs extends DataMigrationBase {
  // Rows read, and written in one statement, per page.
  public static readonly PAGE_SIZE: number = 500;

  // Explain with AI's label (AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE), as stored.
  public static readonly FEATURE: string = "DataSecurityIssueExplanation";

  // What a call that keeps no preview writes in its place (LLM_LOG_PREVIEW_NOT_KEPT).
  public static readonly PREVIEW_NOT_KEPT: string =
    "[Redacted — this content is private to the requesting user]";

  // What a call that keeps no error details writes (LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS).
  public static readonly ERROR_WITHOUT_DETAILS: string =
    "The LLM provider request failed. Review the provider under Project Settings → AI → LLM Providers, then try again.";

  // A failed call's status (LlmLogStatus.Error), as stored.
  public static readonly ERROR_STATUS: string = "Error";

  /*
   * A row of the feature that still holds something to take out: a
   * preview, or a failed call's error. $1 the feature, $2 the words in a
   * preview's place, $3 the failed status, $4 the words in an error's place.
   */
  public static readonly HOLDS_SOMETHING: string = `"feature" = $1 AND (("requestPrompt" IS NOT NULL AND "requestPrompt" <> $2) OR ("responsePreview" IS NOT NULL AND "responsePreview" <> $2) OR ("status" = $3 AND "statusMessage" IS DISTINCT FROM $4))`;

  // The next page of such rows, after the id of the last one read ($5).
  public static readonly SELECT_PAGE: string = `SELECT "_id" FROM "LlmLog" WHERE ${RedactDataSecurityIssueExplanationLogs.HOLDS_SOMETHING} AND "_id" > $5 ORDER BY "_id" ASC LIMIT ${RedactDataSecurityIssueExplanationLogs.PAGE_SIZE}`;

  // The first page.
  public static readonly SELECT_FIRST_PAGE: string = `SELECT "_id" FROM "LlmLog" WHERE ${RedactDataSecurityIssueExplanationLogs.HOLDS_SOMETHING} ORDER BY "_id" ASC LIMIT ${RedactDataSecurityIssueExplanationLogs.PAGE_SIZE}`;

  /*
   * A page written as a call writes one now ($5 its ids): a preview it holds
   * replaced, one it never held left empty, and a failed call's error
   * replaced. Held to the feature again, so an id is never another row's.
   */
  public static readonly REDACT_PAGE: string = `UPDATE "LlmLog" SET "requestPrompt" = CASE WHEN "requestPrompt" IS NULL THEN NULL ELSE $2 END, "responsePreview" = CASE WHEN "responsePreview" IS NULL THEN NULL ELSE $2 END, "statusMessage" = CASE WHEN "status" = $3 THEN $4 ELSE "statusMessage" END WHERE "_id" = ANY($5::uuid[]) AND ${RedactDataSecurityIssueExplanationLogs.HOLDS_SOMETHING}`;

  public constructor() {
    super("RedactDataSecurityIssueExplanationLogs");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      LlmLogService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const words: Array<string> = [
      RedactDataSecurityIssueExplanationLogs.FEATURE,
      RedactDataSecurityIssueExplanationLogs.PREVIEW_NOT_KEPT,
      RedactDataSecurityIssueExplanationLogs.ERROR_STATUS,
      RedactDataSecurityIssueExplanationLogs.ERROR_WITHOUT_DETAILS,
    ];
    let afterId: string | null = null;
    let written: number = 0;

    for (;;) {
      const rows: Array<LogIdRow> = (await repository.manager.query(
        afterId === null
          ? RedactDataSecurityIssueExplanationLogs.SELECT_FIRST_PAGE
          : RedactDataSecurityIssueExplanationLogs.SELECT_PAGE,
        afterId === null ? words : [...words, afterId],
      )) as Array<LogIdRow>;

      if (rows.length > 0) {
        await repository.manager.query(
          RedactDataSecurityIssueExplanationLogs.REDACT_PAGE,
          [
            ...words,
            rows.map((row: LogIdRow): string => {
              return String(row._id);
            }),
          ],
        );

        written += rows.length;
      }

      if (rows.length < RedactDataSecurityIssueExplanationLogs.PAGE_SIZE) {
        break;
      }

      const lastId: string = String(rows[rows.length - 1]!._id);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        break;
      }

      afterId = lastId;
    }

    logger.info(
      `${this.name}: took the previews out of ${written} AI Logs row(s) of Explain with AI.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
