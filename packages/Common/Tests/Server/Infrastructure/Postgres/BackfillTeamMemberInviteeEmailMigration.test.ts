import {
  BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT,
  BackfillTeamMemberInviteeEmail1809186970000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186970000-BackfillTeamMemberInviteeEmail";
import { AddTeamMemberInviteeEmail1809186960000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186960000-AddTeamMemberInviteeEmail";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * THE INVITATIONS ALREADY WAITING KEEP THE ADDRESS THEIR PROJECTS HAVE BEEN
 * SHOWN (#10175).
 *
 * Someone pending is now shown, searched and ordered by the address their
 * invitation kept (TeamMember.inviteeEmail), never by the one their account
 * has moved to. An invitation made before the column kept none, and its
 * project has been shown the account's address all along: the backfill
 * copies that, so nothing a project sees changes on the upgrade, and from
 * then on a change of address no longer shows. What is held here, with the
 * statements EXECUTED against a fake QueryRunner (PendingInviteeAddressPostgres
 * runs the statement on real rows):
 *
 *  - one UPDATE of "TeamMember", writing "inviteeEmail" alone, from the
 *    account the membership is of - never an INSERT or a DELETE;
 *  - only invitations still waiting: not accepted, not deleted, keeping no
 *    address yet - so an address an invitation kept is never overwritten,
 *    a member keeps none, and running it again changes nothing;
 *  - down() writes nothing;
 *  - registered once, right after the migration that adds the column, so
 *    it runs with the schema migrations, before any server of the release
 *    answers (SchemaMigrationWait).
 */

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new BackfillTeamMemberInviteeEmail1809186970000()[step](runner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    CLASS_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

// The statement's text on one line, its words one space apart.
function flat(statement: string): string {
  return statement.replace(/\s+/g, " ").trim();
}

describe("BackfillTeamMemberInviteeEmail1809186970000", () => {
  test("up runs the one statement, and it is an UPDATE of the invitations' address alone", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toEqual([BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT]);

    const statement: string = flat(statements[0]!);

    expect(statement).toMatch(/^UPDATE "TeamMember" AS "invitation" SET /);
    expect(statement).not.toMatch(/\b(INSERT|DELETE|DROP|ALTER|TRUNCATE)\b/i);

    // It sets one column, and only from the account the membership is of.
    const setClause: string = statement.slice(
      statement.indexOf(" SET ") + 5,
      statement.indexOf(" FROM "),
    );

    expect(setClause).toBe(`"inviteeEmail" = "account"."email"`);
    expect(statement).toContain(`FROM "User" AS "account"`);
    expect(statement).toContain(`"invitation"."userId" = "account"."_id"`);
  });

  test("only invitations still waiting, keeping no address yet, of an account that has one", () => {
    const statement: string = flat(
      BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT,
    );

    // Not accepted: a member keeps none, and the project sees their own.
    expect(statement).toContain(`"invitation"."hasAcceptedInvitation" = false`);
    // Not deleted.
    expect(statement).toContain(`"invitation"."deletedAt" IS NULL`);
    // Never over an address an invitation kept: running it again changes nothing.
    expect(statement).toContain(`"invitation"."inviteeEmail" IS NULL`);
    expect(statement).toContain(`"account"."email" IS NOT NULL`);

    // Every condition is required of the row: none is offered as an alternative.
    expect(statement).not.toMatch(/\bOR\b/i);
  });

  test("down() writes nothing", async () => {
    expect(await statementsOf("down")).toEqual([]);
  });

  test("registered once, right after the migration that adds the column", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === BackfillTeamMemberInviteeEmail1809186970000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      BackfillTeamMemberInviteeEmail1809186970000,
    );

    expect(registered[position - 1]).toBe(
      AddTeamMemberInviteeEmail1809186960000,
    );
    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(BackfillTeamMemberInviteeEmail1809186970000));
    expect(new BackfillTeamMemberInviteeEmail1809186970000().name).toBe(
      "BackfillTeamMemberInviteeEmail1809186970000",
    );
  });
});
