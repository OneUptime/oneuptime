import {
  AddSsoProviderSignInsEndedAt1799800000000,
  END_SIGN_INS_OF_OIDC_PROVIDERS_OFF,
  END_SIGN_INS_OF_SAML_PROVIDERS_OFF,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799800000000-AddSsoProviderSignInsEndedAt";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * AddSsoProviderSignInsEndedAt adds, to a project's SAML and OIDC providers,
 * when each was last turned off (Server/Utils/ProjectSsoProviderStanding):
 * the sign-ins a provider gave before then no longer count, even once it is
 * turned on again.
 *
 * A provider that is off when the release is installed is treated as turned
 * off then, so turning it on again later does not bring back the sign-ins it
 * gave before, as for one turned off afterwards. A provider that is on is
 * left as never turned off: the sign-ins it gave keep counting.
 *
 * Fake QueryRunner: this pins the statements and their order. They were run
 * against Postgres when the migration was written.
 */

const OWN_CLASS_NAME: string = "AddSsoProviderSignInsEndedAt1799800000000";

const recordQueries: (
  direction: "up" | "down",
) => Promise<Array<string>> = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new AddSsoProviderSignInsEndedAt1799800000000()[direction](queryRunner);

  return statements;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

const timestampOf: (className: string) => number | null = (
  className: string,
): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

describe("AddSsoProviderSignInsEndedAt migration", () => {
  test("adds the column to both provider tables, then ends the sign-ins of the providers that are off", async () => {
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "ProjectSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "ProjectOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
      END_SIGN_INS_OF_SAML_PROVIDERS_OFF,
      END_SIGN_INS_OF_OIDC_PROVIDERS_OFF,
    ]);
  });

  test("stamps only the providers that are off, with the time it runs", () => {
    expect(END_SIGN_INS_OF_SAML_PROVIDERS_OFF).toBe(
      `UPDATE "ProjectSSO" SET "signInsEndedAt" = now() WHERE "isEnabled" = false`,
    );
    expect(END_SIGN_INS_OF_OIDC_PROVIDERS_OFF).toBe(
      `UPDATE "ProjectOIDC" SET "signInsEndedAt" = now() WHERE "isEnabled" = false`,
    );
  });

  test("down drops the columns again", async () => {
    expect(await recordQueries("down")).toEqual([
      `ALTER TABLE "ProjectOIDC" DROP COLUMN "signInsEndedAt"`,
      `ALTER TABLE "ProjectSSO" DROP COLUMN "signInsEndedAt"`,
    ]);
  });

  test("is registered exactly once, after every migration with an earlier stamp", () => {
    expect(new AddSsoProviderSignInsEndedAt1799800000000().name).toBe(
      OWN_CLASS_NAME,
    );

    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOf(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);

    expect(
      registeredNames.slice(ownIndex + 1).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp <= ownTimestamp;
      }),
    ).toEqual([]);
  });
});
