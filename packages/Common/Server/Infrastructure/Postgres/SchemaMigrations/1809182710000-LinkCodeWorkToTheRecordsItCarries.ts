import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The Code work that already carries an incident or an alert, linked to it
 * (#9186).
 *
 * Before AddCarriedRecordsToCodeWork, a Code task that held an incident or
 * alert only as context - added to its request or a reply, or the incident
 * of the postmortem action item it was asked from - and a pull request
 * OneUptime AI opened from an incident's or alert's AI conversation named no
 * record, so every reader of the repository's tasks and pull requests read
 * them, a private record's included. The links are filled in from what the
 * work kept, where it can be told for certain:
 *
 *   1. each turn's own: the incidents and alerts its request's context
 *      names (taskContext.request.context, each item's recordId - the ids
 *      the request was asked with, as Code read them under the person's
 *      permissions);
 *   2. a postmortem action item's task: the action item's incident, which
 *      its request names (IncidentPostmortemActionItem.codeTaskId names the
 *      latest task asked for it; an earlier one carries the incident in its
 *      context, so 1 links it);
 *   3. every task: what its replies carry, as a task carries what every one
 *      of its turns does;
 *   4. a pull request OneUptime AI opened from a chat: the incident or alert
 *      whose AI conversation it was opened in, when exactly one such
 *      conversation's call that opened a pull request matches it - in the
 *      same project, by the same person, with the title the pull request
 *      record keeps, within minutes of it. The call is the chat's
 *      open_code_pull_request step (AIRunEvent), and the conversation is
 *      the run's.
 *
 * What can't be told stays as it was: a pull request opened from Ask AI (a
 * conversation keeps only its latest subject, not the one it had when the
 * pull request was opened), one whose conversation is gone, and a record a
 * request names only in its words.
 *
 * Every id written is one the link would hold: a UUID, in lower case. In one
 * transaction, so a stop part way leaves nothing half done. Nothing to undo
 * beyond the columns themselves, which AddCarriedRecordsToCodeWork's down()
 * drops: down() clears nothing here.
 */

const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// A list already in `column`, with `added` (a jsonb list), each id once.
function mergedList(column: string, added: string): string {
  return `(SELECT jsonb_agg(DISTINCT "merged"."id") FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END || ${added}) AS "merged"("id"))`;
}

// 1. Each turn's own: what its request's context names, by kind.
function linkTurnsToTheirContext(kind: "Incident" | "Alert"): string {
  const column: string =
    kind === "Incident" ? "carriedIncidentIds" : "carriedAlertIds";

  return `UPDATE "AIRun" AS "run" SET "${column}" = ${mergedList(`"run"."${column}"`, `"found"."ids"`)} FROM (SELECT "turn"."_id" AS "runId", jsonb_agg(DISTINCT lower("item" ->> 'recordId')) AS "ids" FROM "AIRun" AS "turn" CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof("turn"."taskContext" -> 'request' -> 'context') = 'array' THEN "turn"."taskContext" -> 'request' -> 'context' ELSE '[]'::jsonb END) AS "item" WHERE "turn"."runType" = 'CodeFix' AND jsonb_typeof("item") = 'object' AND "item" ->> 'type' = '${kind}' AND lower("item" ->> 'recordId') ~ '${UUID_PATTERN}' GROUP BY "turn"."_id") AS "found" WHERE "run"."_id" = "found"."runId"`;
}

export const LINK_TURNS_TO_THEIR_INCIDENTS: string =
  linkTurnsToTheirContext("Incident");

export const LINK_TURNS_TO_THEIR_ALERTS: string =
  linkTurnsToTheirContext("Alert");

// 2. A postmortem action item's task: the action item's incident.
export const LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT: string = `UPDATE "AIRun" AS "task" SET "carriedIncidentIds" = ${mergedList(`"task"."carriedIncidentIds"`, `"items"."ids"`)} FROM (SELECT "item"."codeTaskId" AS "taskId", jsonb_agg(DISTINCT lower("item"."incidentId"::text)) AS "ids" FROM "IncidentPostmortemActionItem" AS "item" WHERE "item"."codeTaskId" IS NOT NULL AND "item"."incidentId" IS NOT NULL GROUP BY "item"."codeTaskId") AS "items" WHERE "task"."_id" = "items"."taskId" AND "task"."runType" = 'CodeFix'`;

// 3. Every task: what its replies carry, by kind.
function linkTasksToWhatTheirRepliesCarry(
  column: "carriedIncidentIds" | "carriedAlertIds",
): string {
  return `UPDATE "AIRun" AS "task" SET "${column}" = ${mergedList(`"task"."${column}"`, `"turns"."ids"`)} FROM (SELECT "reply"."codeTaskId" AS "taskId", jsonb_agg(DISTINCT "carried"."id") AS "ids" FROM "AIRun" AS "reply" CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof("reply"."${column}") = 'array' THEN "reply"."${column}" ELSE '[]'::jsonb END) AS "carried"("id") WHERE "reply"."codeTaskId" IS NOT NULL GROUP BY "reply"."codeTaskId") AS "turns" WHERE "task"."_id" = "turns"."taskId"`;
}

export const LINK_TASKS_TO_THE_INCIDENTS_THEIR_REPLIES_CARRY: string =
  linkTasksToWhatTheirRepliesCarry("carriedIncidentIds");

export const LINK_TASKS_TO_THE_ALERTS_THEIR_REPLIES_CARRY: string =
  linkTasksToWhatTheirRepliesCarry("carriedAlertIds");

/*
 * How long after the pull request record its chat's call may be recorded,
 * and how long before: the call's step is written once the tool returns,
 * the record just before that.
 */
export const CHAT_CALL_MATCH_WINDOW: {
  minutesBefore: number;
  minutesAfter: number;
} = {
  minutesBefore: 1,
  minutesAfter: 15,
};

// 4. A pull request opened from an incident's or alert's AI conversation.
export const LINK_CHAT_PULL_REQUESTS_TO_THEIR_THREAD: string = `WITH "matched" AS (SELECT "pullRequest"."_id" AS "pullRequestId", COUNT(DISTINCT "chat"."conversationId") AS "chats", MIN("conversation"."incidentId"::text) AS "incidentId", MIN("conversation"."alertId"::text) AS "alertId", BOOL_AND("conversation"."incidentId" IS NOT NULL OR "conversation"."alertId" IS NOT NULL) AS "isThread" FROM "AIAgentTaskPullRequest" AS "pullRequest" INNER JOIN "AIRunEvent" AS "call" ON "call"."projectId" = "pullRequest"."projectId" AND "call"."eventType" = 'ToolCallCompleted' AND "call"."toolName" = 'open_code_pull_request' AND "call"."userId" IS NOT DISTINCT FROM "pullRequest"."createdByUserId" AND "call"."createdAt" >= "pullRequest"."createdAt" - INTERVAL '${CHAT_CALL_MATCH_WINDOW.minutesBefore} minutes' AND "call"."createdAt" <= "pullRequest"."createdAt" + INTERVAL '${CHAT_CALL_MATCH_WINDOW.minutesAfter} minutes' INNER JOIN "AIRun" AS "chat" ON "chat"."_id" = "call"."aiRunId" AND "chat"."runType" = 'Chat' INNER JOIN "AIConversation" AS "conversation" ON "conversation"."_id" = "chat"."conversationId" WHERE "pullRequest"."aiRunId" IS NULL AND "pullRequest"."carriedIncidentIds" IS NULL AND "pullRequest"."carriedAlertIds" IS NULL AND char_length(COALESCE("pullRequest"."title", '')) > 0 AND jsonb_typeof("call"."toolArguments") = 'object' AND left(btrim("call"."toolArguments" ->> 'title'), char_length("pullRequest"."title")) = "pullRequest"."title" GROUP BY "pullRequest"."_id") UPDATE "AIAgentTaskPullRequest" AS "pullRequest" SET "carriedIncidentIds" = CASE WHEN "matched"."incidentId" IS NOT NULL THEN jsonb_build_array(lower("matched"."incidentId")) END, "carriedAlertIds" = CASE WHEN "matched"."alertId" IS NOT NULL THEN jsonb_build_array(lower("matched"."alertId")) END FROM "matched" WHERE "pullRequest"."_id" = "matched"."pullRequestId" AND "matched"."chats" = 1 AND "matched"."isThread"`;

// In the order they run: a task gathers its replies' once they have theirs.
export const LINK_CODE_WORK_STATEMENTS: ReadonlyArray<string> = [
  LINK_TURNS_TO_THEIR_INCIDENTS,
  LINK_TURNS_TO_THEIR_ALERTS,
  LINK_ACTION_ITEM_TASKS_TO_THEIR_INCIDENT,
  LINK_TASKS_TO_THE_INCIDENTS_THEIR_REPLIES_CARRY,
  LINK_TASKS_TO_THE_ALERTS_THEIR_REPLIES_CARRY,
  LINK_CHAT_PULL_REQUESTS_TO_THEIR_THREAD,
];

export class LinkCodeWorkToTheRecordsItCarries1809182710000
  implements MigrationInterface
{
  public name: string = "LinkCodeWorkToTheRecordsItCarries1809182710000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of LINK_CODE_WORK_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // The links go with their columns (AddCarriedRecordsToCodeWork.down).
  }
}
