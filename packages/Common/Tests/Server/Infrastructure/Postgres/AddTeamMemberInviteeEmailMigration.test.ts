import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTeamMemberInviteeEmail1809186940000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186940000-AddTeamMemberInviteeEmail";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * AddTeamMemberInviteeEmail (OneUptime issue #10175): TeamMember.inviteeEmail,
 * the address a person was invited at. Until they accept, the project sees
 * what it invited - this address, and the name typed for them - never the
 * address their account has moved to since. Nullable with no default:
 * Postgres adds it to "TeamMember" without rewriting it. The invitations
 * already waiting keep the address their projects have been shown, in the
 * backfill registered right after it (BackfillTeamMemberInviteeEmail, with
 * its own suite and PendingInviteeAddressPostgres).
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check found nothing left
 * to generate once it had run.)
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

describe("AddTeamMemberInviteeEmail1809186940000", () => {
  test("adds the one column to TeamMember, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTeamMemberInviteeEmail1809186940000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "TeamMember" ADD "inviteeEmail" character varying(100)`,
    ]);
  });

  test("nullable, no default, no index, no row rewritten or backfilled here", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddTeamMemberInviteeEmail1809186940000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |INSERT /i,
      );
    }
  });

  test("the column is the model's: an optional address, as long as the migration makes it", () => {
    const member: TeamMember = new TeamMember();

    expect(member.getTableColumnMetadata("inviteeEmail")).toBeDefined();
    expect(member.getTableColumnMetadata("inviteeEmail").required).toBe(false);
    expect(member.getTableColumnMetadata("inviteeEmail").type).toBe(
      TableColumnType.Email,
    );
    expect(ColumnLength.Email).toBe(100);
  });

  test("only OneUptime writes it - from the address it sent the invitation to - and the project reads it as it reads its people", () => {
    const member: TeamMember = new TeamMember();
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = member.getColumnAccessControlFor("inviteeEmail")!;

    // Nobody sends it: the address is the one the invitation went to.
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(member.getTableColumnMetadata("inviteeEmail").computed).toBe(true);

    // Whoever reads the project's people reads the address they invited.
    for (const permission of member.getColumnAccessControlFor("user")!.read) {
      expect(access.read).toContain(permission);
    }

    // And the person invited, on their own invitation.
    expect(access.read).toContain(Permission.CurrentUser);
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTeamMemberInviteeEmail1809186940000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "TeamMember" DROP COLUMN "inviteeEmail"`]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddTeamMemberInviteeEmail1809186940000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddTeamMemberInviteeEmail1809186940000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddTeamMemberInviteeEmail1809186940000));
    expect(new AddTeamMemberInviteeEmail1809186940000().name).toBe(
      "AddTeamMemberInviteeEmail1809186940000",
    );
  });
});
