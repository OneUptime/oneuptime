import { AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799900000000-AddGlobalAndStatusPageSsoSignInsEndedAt";
import {
  END_SIGN_INS_OF_GLOBAL_OIDC_PROVIDERS_OFF,
  END_SIGN_INS_OF_GLOBAL_SAML_PROVIDERS_OFF,
  END_SIGN_INS_OF_STATUS_PAGE_OIDC_PROVIDERS_OFF,
  END_SIGN_INS_OF_STATUS_PAGE_SAML_PROVIDERS_OFF,
  EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff1799910000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799910000000-EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff";
import {
  END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER,
  EndStatusPageSsoSessionsWithoutProvider1799920000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799920000000-EndStatusPageSsoSessionsWithoutProvider";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AddGlobalAndStatusPageSsoSignInsEndedAt adds, to the server's global SAML
 * and OIDC providers and to a status page's, when each was last turned off
 * (signInsEndedAt, Server/Utils/SsoSignInsEnded), and to a status page
 * session the provider that signed it in (statusPageSsoId,
 * statusPageOidcId). It is generated, and only adds the columns.
 *
 * The two data fixes after it:
 *
 *   - EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff treats a
 *     provider that is off at the upgrade as turned off then, so turning it
 *     on again does not bring back the sign-ins it gave before;
 *   - EndStatusPageSsoSessionsWithoutProvider ends, once, the live status
 *     page sessions of people only an SSO provider ever signed in: made
 *     before sessions named their provider, they cannot say which one.
 *
 * Fake QueryRunner: this pins the statements and their order. They are run
 * against Postgres in StatusPageSsoSessionsPostgres.test.ts.
 */

const ADD_COLUMNS_CLASS_NAME: string =
  "AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000";
const STAMP_CLASS_NAME: string =
  "EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff1799910000000";
const END_SESSIONS_CLASS_NAME: string =
  "EndStatusPageSsoSessionsWithoutProvider1799920000000";

const recordQueries: (
  migration: MigrationInterface,
  direction: "up" | "down",
) => Promise<Array<string>> = async (
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

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

// Registered once, after every migration with an earlier stamp and before every later one.
const expectRegisteredInOrder: (className: string) => void = (
  className: string,
): void => {
  expect(
    registeredNames.filter((name: string): boolean => {
      return name === className;
    }),
  ).toHaveLength(1);

  const ownIndex: number = registeredNames.indexOf(className);
  const ownTimestamp: number = timestampOf(className)!;

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
};

describe("AddGlobalAndStatusPageSsoSignInsEndedAt migration", () => {
  test("adds the columns, and nothing else", async () => {
    expect(
      await recordQueries(
        new AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "GlobalSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "GlobalOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "StatusPagePrivateUserSession" ADD "statusPageSsoId" uuid`,
      `ALTER TABLE "StatusPagePrivateUserSession" ADD "statusPageOidcId" uuid`,
      `ALTER TABLE "StatusPageSSO" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "StatusPageOIDC" ADD "signInsEndedAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down drops them again, in reverse", async () => {
    expect(
      await recordQueries(
        new AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "StatusPageOIDC" DROP COLUMN "signInsEndedAt"`,
      `ALTER TABLE "StatusPageSSO" DROP COLUMN "signInsEndedAt"`,
      `ALTER TABLE "StatusPagePrivateUserSession" DROP COLUMN "statusPageOidcId"`,
      `ALTER TABLE "StatusPagePrivateUserSession" DROP COLUMN "statusPageSsoId"`,
      `ALTER TABLE "GlobalOIDC" DROP COLUMN "signInsEndedAt"`,
      `ALTER TABLE "GlobalSSO" DROP COLUMN "signInsEndedAt"`,
    ]);
  });

  test("is registered exactly once, after every migration with an earlier stamp", () => {
    expect(new AddGlobalAndStatusPageSsoSignInsEndedAt1799900000000().name).toBe(
      ADD_COLUMNS_CLASS_NAME,
    );

    expectRegisteredInOrder(ADD_COLUMNS_CLASS_NAME);
  });
});

describe("EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff data fix", () => {
  test("ends the sign-ins of every global and status page provider that is off", async () => {
    expect(
      await recordQueries(
        new EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff1799910000000(),
        "up",
      ),
    ).toEqual([
      END_SIGN_INS_OF_GLOBAL_SAML_PROVIDERS_OFF,
      END_SIGN_INS_OF_GLOBAL_OIDC_PROVIDERS_OFF,
      END_SIGN_INS_OF_STATUS_PAGE_SAML_PROVIDERS_OFF,
      END_SIGN_INS_OF_STATUS_PAGE_OIDC_PROVIDERS_OFF,
    ]);
  });

  test("stamps only providers that are off and not stamped yet, with the time it runs", () => {
    for (const [statement, table] of [
      [END_SIGN_INS_OF_GLOBAL_SAML_PROVIDERS_OFF, "GlobalSSO"],
      [END_SIGN_INS_OF_GLOBAL_OIDC_PROVIDERS_OFF, "GlobalOIDC"],
      [END_SIGN_INS_OF_STATUS_PAGE_SAML_PROVIDERS_OFF, "StatusPageSSO"],
      [END_SIGN_INS_OF_STATUS_PAGE_OIDC_PROVIDERS_OFF, "StatusPageOIDC"],
    ]) {
      expect(statement).toBe(
        `UPDATE "${table}" SET "signInsEndedAt" = now() WHERE "isEnabled" = false AND "signInsEndedAt" IS NULL`,
      );
    }
  });

  test("down changes nothing: the stamps go with their columns", async () => {
    expect(
      await recordQueries(
        new EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff1799910000000(),
        "down",
      ),
    ).toEqual([]);
  });

  test("is registered exactly once, right after the columns it fills", () => {
    expect(
      new EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff1799910000000()
        .name,
    ).toBe(STAMP_CLASS_NAME);

    expectRegisteredInOrder(STAMP_CLASS_NAME);

    expect(registeredNames.indexOf(STAMP_CLASS_NAME)).toBeGreaterThan(
      registeredNames.indexOf(ADD_COLUMNS_CLASS_NAME),
    );
  });
});

describe("EndStatusPageSsoSessionsWithoutProvider data fix", () => {
  test("ends the live sessions of people only SSO signed in that name no provider, and nothing else", async () => {
    expect(
      await recordQueries(
        new EndStatusPageSsoSessionsWithoutProvider1799920000000(),
        "up",
      ),
    ).toEqual([END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER]);

    for (const condition of [
      `"privateUser"."isSsoUser" = true`,
      `"session"."isRevoked" = false`,
      `"session"."refreshTokenExpiresAt" > now()`,
      `"session"."statusPageSsoId" IS NULL`,
      `"session"."statusPageOidcId" IS NULL`,
    ]) {
      expect(END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER).toContain(
        condition,
      );
    }
  });

  test("down changes nothing: a session ended stays ended", async () => {
    expect(
      await recordQueries(
        new EndStatusPageSsoSessionsWithoutProvider1799920000000(),
        "down",
      ),
    ).toEqual([]);
  });

  test("is registered exactly once, after the columns it reads", () => {
    expect(new EndStatusPageSsoSessionsWithoutProvider1799920000000().name).toBe(
      END_SESSIONS_CLASS_NAME,
    );

    expectRegisteredInOrder(END_SESSIONS_CLASS_NAME);

    expect(registeredNames.indexOf(END_SESSIONS_CLASS_NAME)).toBeGreaterThan(
      registeredNames.indexOf(ADD_COLUMNS_CLASS_NAME),
    );
  });
});
