import ProjectService from "../../Services/ProjectService";
import WelcomeChecklistService from "../../Services/WelcomeChecklistService";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";

/*
 * THE TEST PAGES MEMBERS ACKNOWLEDGED BEFORE THEIR NOTE WAS KEPT (#7042).
 *
 * An invited member's first steps on Home end when a test page has reached
 * them (#6807): WelcomeChecklistService notes each member who acknowledges
 * one, on the project's welcomeChecklistState. That note started with #6807,
 * and until #7043 two people answering at once could lose one of theirs. So
 * a member who acknowledged a test page before - or whose note was lost -
 * still saw "Send yourself a test page" as a step to do.
 *
 * This notes them from the acknowledgements every test page already
 * records, as WelcomeChecklistService.noteTestPagesAcknowledgedBefore:
 *
 *   - each person's own page of a test, its UserOnCallLog, acknowledged by
 *     them (UserOnCallLogTimelineService.acknowledgeTestPage writes who and
 *     when);
 *   - the run itself, OnCallDutyPolicyExecutionLog, which names who answered
 *     it first - the same person for a test to themselves.
 *
 * A row of each is a test page by its event type (UserNotificationEventType
 * .TestPage); a real page's acknowledgement never counts.
 *
 * Walks the projects that are not deleted in primary key order, a batch at
 * a time, so each statement reads one batch's rows through the projectId
 * indexes and none runs into the statement timeout. Idempotent and safe to
 * run twice at once: a member noted already - live, or by a run before - is
 * left as they are, and every write holds the project row's lock
 * (changeState), so a member noted meanwhile is kept.
 */

export const TEST_PAGE_ACKNOWLEDGEMENT_BACKFILL_BATCH_SIZE: number = 200;

/*
 * The batch's projects, after the last one read ($2), in primary key order.
 * A deleted project shows no Home to anybody, and its row is not written.
 */
export const PROJECT_BATCH_SQL: string = `SELECT "_id"::text AS "_id" FROM "Project" WHERE "deletedAt" IS NULL AND ($2::uuid IS NULL OR "_id" > $2::uuid) ORDER BY "_id" ASC LIMIT $1`;

/*
 * Who acknowledged a test page in each of the batch's projects ($1), each
 * person once per project, with their first acknowledgement, oldest first.
 */
export const ACKNOWLEDGED_TEST_PAGES_SQL: string = `SELECT "projectId"::text AS "projectId", "userId"::text AS "userId", MIN("acknowledgedAt") AS "acknowledgedAt" FROM (SELECT "projectId", "acknowledgedByUserId" AS "userId", "acknowledgedAt" FROM "UserOnCallLog" WHERE "projectId" = ANY($1::uuid[]) AND "userNotificationEventType" = $2 AND "acknowledgedAt" IS NOT NULL AND "acknowledgedByUserId" IS NOT NULL UNION ALL SELECT "projectId", "acknowledgedByUserId" AS "userId", "acknowledgedAt" FROM "OnCallDutyPolicyExecutionLog" WHERE "projectId" = ANY($1::uuid[]) AND "userNotificationEventType" = $2 AND "acknowledgedAt" IS NOT NULL AND "acknowledgedByUserId" IS NOT NULL) AS "acknowledged" GROUP BY "projectId", "userId" ORDER BY MIN("acknowledgedAt") ASC, "userId" ASC`;

export interface TestPageAcknowledgementBackfillResult {
  // Projects read.
  projects: number;
  // Projects where somebody had acknowledged a test page.
  projectsWithTestPages: number;
  // Members noted now: not noted before.
  membersNoted: number;
}

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

type NoteFunction = (data: {
  projectId: ObjectID;
  userIds: Array<string>;
}) => Promise<number>;

const readRows: (result: unknown) => Array<Record<string, unknown>> = (
  result: unknown,
): Array<Record<string, unknown>> => {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : [];
};

const readId: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const id: string = value.trim().toLowerCase();

  return ObjectID.isValidUUID(id) ? id : null;
};

/*
 * The members who acknowledged a test page, by project, in the order the
 * rows came: oldest first. A row with no project or no person is no answer.
 */
export const groupAcknowledgedMembersByProject: (
  rows: Array<Record<string, unknown>>,
) => Map<string, Array<string>> = (
  rows: Array<Record<string, unknown>>,
): Map<string, Array<string>> => {
  const membersByProject: Map<string, Array<string>> = new Map();

  for (const row of rows) {
    const projectId: string | null = readId(row["projectId"]);
    const userId: string | null = readId(row["userId"]);

    if (!projectId || !userId) {
      continue;
    }

    const members: Array<string> = membersByProject.get(projectId) || [];

    if (!members.includes(userId)) {
      members.push(userId);
    }

    membersByProject.set(projectId, members);
  }

  return membersByProject;
};

export default class TestPageAcknowledgementBackfill {
  public static async backfill(options?: {
    batchSize?: number | undefined;
    query?: QueryFunction | undefined;
    note?: NoteFunction | undefined;
  }): Promise<TestPageAcknowledgementBackfillResult> {
    const batchSize: number = Math.max(
      1,
      Math.floor(
        options?.batchSize || TEST_PAGE_ACKNOWLEDGEMENT_BACKFILL_BATCH_SIZE,
      ),
    );

    const query: QueryFunction =
      options?.query ||
      (async (sql: string, parameters: Array<unknown>): Promise<unknown> => {
        return await ProjectService.getRepository().manager.query(
          sql,
          parameters,
        );
      });

    const note: NoteFunction =
      options?.note ||
      (async (data: {
        projectId: ObjectID;
        userIds: Array<string>;
      }): Promise<number> => {
        return await WelcomeChecklistService.noteTestPagesAcknowledgedBefore(
          data,
        );
      });

    const result: TestPageAcknowledgementBackfillResult = {
      projects: 0,
      projectsWithTestPages: 0,
      membersNoted: 0,
    };

    let lastProjectId: string | null = null;

    for (;;) {
      const projectIds: Array<string> = readRows(
        await query(PROJECT_BATCH_SQL, [batchSize, lastProjectId]),
      )
        .map((row: Record<string, unknown>): string | null => {
          return readId(row["_id"]);
        })
        .filter((id: string | null): id is string => {
          return Boolean(id);
        });

      if (projectIds.length === 0) {
        break;
      }

      result.projects += projectIds.length;

      const membersByProject: Map<
        string,
        Array<string>
      > = groupAcknowledgedMembersByProject(
        readRows(
          await query(ACKNOWLEDGED_TEST_PAGES_SQL, [
            projectIds,
            UserNotificationEventType.TestPage,
          ]),
        ),
      );

      for (const [projectId, userIds] of membersByProject) {
        result.projectsWithTestPages++;

        try {
          result.membersNoted += await note({
            projectId: new ObjectID(projectId),
            userIds: userIds,
          });
        } catch (err) {
          // Deleted since the batch was read: nobody sees its Home.
          if (err instanceof NotFoundException) {
            continue;
          }

          throw err;
        }
      }

      lastProjectId = projectIds[projectIds.length - 1]!;

      if (projectIds.length < batchSize) {
        break;
      }
    }

    return result;
  }
}
