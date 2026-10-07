import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ObjectID from "../../../Types/ObjectID";
import { expect } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The user condition ProjectMembership.userIdWhileMember builds for a read
 * of a person's own rows: their row, and only while they are a member of the
 * project. A read carrying it comes back empty for somebody who is not a
 * member, so suites that fake a service's reads need to recognise it, and
 * suites that check a read's query need to tell it from a plain id.
 */
export interface UserIdWhileMember {
  userId: string;
  projectId: string;
}

// Any column expression: the condition is checked by the SQL it renders.
const ALIAS: string = '"row"."userId"';

/*
 * The person and project the condition was built for, or null when `value`
 * is not that condition - a plain id included.
 */
export function readUserIdWhileMember(
  value: unknown,
): UserIdWhileMember | null {
  if (
    !(value instanceof FindOperator) ||
    value.type !== "raw" ||
    typeof value.getSql !== "function"
  ) {
    return null;
  }

  const parameters: Record<string, unknown> =
    (value.objectLiteralParameters as Record<string, unknown> | undefined) ||
    {};
  const sql: string = (value.getSql as (alias: string) => string)(ALIAS);

  for (const [userKey, userId] of Object.entries(parameters)) {
    for (const [projectKey, projectId] of Object.entries(parameters)) {
      if (userKey === projectKey) {
        continue;
      }

      const expected: string = `(${ALIAS} = :${userKey} AND ${ProjectMembership.getMembershipExistsSql(
        {
          projectIdSql: `:${projectKey}`,
          userIdSql: ALIAS,
        },
      )})`;

      if (sql === expected) {
        return { userId: String(userId), projectId: String(projectId) };
      }
    }
  }

  return null;
}

// Asserts `value` is the membership condition for this person and project.
export function expectUserIdWhileMember(
  value: unknown,
  expected: { userId: ObjectID | string; projectId: ObjectID | string },
): void {
  expect(readUserIdWhileMember(value)).toEqual({
    userId: expected.userId.toString(),
    projectId: expected.projectId.toString(),
  });
}
