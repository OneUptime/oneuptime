import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddTeamMemberInviteeName1809186500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186500000-AddTeamMemberInviteeName";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Permission from "../../../../Types/Permission";

/*
 * AddTeamMemberInviteeName (OneUptime issue #9823): TeamMember.inviteeName,
 * the name an inviter typed for the person they invited. Until the person
 * accepts, the project sees what it invited - the address, and this name -
 * never the profile of an account the address already had. Nullable with no
 * default: Postgres adds it to "TeamMember" without rewriting it, and
 * nothing is backfilled (the names typed before went onto the accounts).
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

describe("AddTeamMemberInviteeName1809186500000", () => {
  test("adds the one column to TeamMember, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTeamMemberInviteeName1809186500000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "TeamMember" ADD "inviteeName" character varying(100)`,
    ]);
  });

  test("nullable, no default, no index, no row rewritten or backfilled", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddTeamMemberInviteeName1809186500000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |INSERT /i,
      );
    }
  });

  test("the column is the model's: optional short text, as long as the migration makes it", () => {
    const member: TeamMember = new TeamMember();

    expect(member.getTableColumnMetadata("inviteeName")).toBeDefined();
    expect(member.getTableColumnMetadata("inviteeName").required).toBe(false);
    expect(ColumnLength.ShortText).toBe(100);
  });

  test("only OneUptime changes it after the invitation, and the project reads it as it reads its people", () => {
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = new TeamMember().getColumnAccessControlFor("inviteeName")!;

    expect(access.update).toEqual([]);
    expect(access.create).toEqual(
      new TeamMember().getColumnAccessControlFor("user")!.create,
    );

    // Whoever reads the project's people reads the name typed for them.
    for (const permission of new TeamMember().getColumnAccessControlFor("user")!
      .read) {
      expect(access.read).toContain(permission);
    }

    // And the person invited, on their own invitation.
    expect(access.read).toContain(Permission.CurrentUser);
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddTeamMemberInviteeName1809186500000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "TeamMember" DROP COLUMN "inviteeName"`]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddTeamMemberInviteeName1809186500000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddTeamMemberInviteeName1809186500000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddTeamMemberInviteeName1809186500000));
    expect(new AddTeamMemberInviteeName1809186500000().name).toBe(
      "AddTeamMemberInviteeName1809186500000",
    );
  });
});
