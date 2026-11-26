import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityUserVault from "../../../../../Models/AnalyticsModels/SecurityUserVault";
import SecurityUserVaultService from "../../../../../Server/Services/SecurityUserVaultService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import SecurityUserErasureEvents, {
  getEventUserColumn,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureEvents";
import ObjectID from "../../../../../Types/ObjectID";
import {
  HASHED_USER_ATTRIBUTES,
  ScrubbedUserRole,
} from "../../../../../Utils/SecurityEvent/ScrubbedUser";
import { describe, expect, test } from "@jest/globals";

/*
 * What an erasure (#10908) sends to ClickHouse on an install, which is
 * always a cluster (Server/Utils/AnalyticsDatabase/ClusterConfig): each
 * delete and update a mutation on the LOCAL table, ON CLUSTER, as every
 * delete of an analytics table is; each read through the Distributed table;
 * and every value a parameter - the project and the tokens, never the
 * person. The statements run on real servers in
 * SecurityUserErasureClickhouse (one node) and
 * SecurityUserVaultTableKeeperClickhouse (two replicas).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000e1",
);
const TOKENS: Array<string> = ["[HASHED:5e29db14e508e09a]"];

const VAULT: string = new SecurityUserVault().tableName;
const EVENTS: string = new SecurityEvent().tableName;

function parameterValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params as Record<string, unknown>);
}

describe("the vault's statements", () => {
  test("the delete is a mutation on the local table, ON CLUSTER, by project and token", () => {
    const statement: Statement =
      SecurityUserVaultService.toEraseTokensStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
      });

    expect(statement.query).toMatch(
      new RegExp(
        `^ALTER TABLE \\S+\\.${VAULT}Local ON CLUSTER '[^']+' DELETE WHERE projectId = \\{p\\d+:String\\} AND token IN \\(\\{p\\d+:Array\\(String\\)\\}\\)$`,
      ),
    );
    expect(parameterValues(statement)).toEqual(
      expect.arrayContaining([PROJECT_ID.toString(), TOKENS]),
    );
  });

  test("the reads go through the Distributed table, at any age", () => {
    for (const statement of [
      SecurityUserVaultService.toCountRowsOfTokensStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
      }),
      SecurityUserVaultService.toFindEntriesOfTokensStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
      }),
    ]) {
      expect(statement.query).toContain(`.${VAULT} WHERE projectId = `);
      expect(statement.query).not.toContain(`${VAULT}Local`);
      // A lookup for naming stops at 30 days; an erasure takes every row, whatever its age.
      expect(statement.query).not.toContain("lastSeenAt");
    }
  });
});

describe("the events' statements", () => {
  test.each([ScrubbedUserRole.Principal, ScrubbedUserRole.Target])(
    "the %s update is a mutation on the local table, ON CLUSTER, matching what the rule left beside the user",
    (role: ScrubbedUserRole) => {
      const statement: Statement =
        SecurityUserErasureEvents.toUnnameEventsStatement({
          projectId: PROJECT_ID,
          role,
          tokens: TOKENS,
        });

      expect(statement.query).toMatch(
        new RegExp(
          `^ALTER TABLE \\S+\\.${EVENTS}Local ON CLUSTER '[^']+' UPDATE ${getEventUserColumn(role)} = attributes\\[`,
        ),
      );
      expect(statement.query).toContain(", observables = ");
      expect(statement.query).toContain(", attributes = mapUpdate(");
      expect(statement.query).toContain(", attributeKeys = mapKeys(");
      expect(statement.query).toMatch(
        /WHERE projectId = \{p\d+:String\} AND multiSearchAny\(attributes\[\{p\d+:String\}\], \{p\d+:Array\(String\)\}\)$/,
      );
      expect(parameterValues(statement)).toEqual(
        expect.arrayContaining([HASHED_USER_ATTRIBUTES[role], TOKENS]),
      );
    },
  );

  test("only who acted gets the request's user back: who was acted on never had it", () => {
    expect(
      SecurityUserErasureEvents.toUnnameEventsStatement({
        projectId: PROJECT_ID,
        role: ScrubbedUserRole.Principal,
        tokens: TOKENS,
      }).query,
    ).toContain("mapApply(");
    expect(
      SecurityUserErasureEvents.toUnnameEventsStatement({
        projectId: PROJECT_ID,
        role: ScrubbedUserRole.Target,
        tokens: TOKENS,
      }).query,
    ).not.toContain("mapApply(");
  });

  test("the reads go through the Distributed table", () => {
    for (const statement of [
      SecurityUserErasureEvents.toCountEventsStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
      }),
      SecurityUserErasureEvents.toNamedPairsStatement({
        projectId: PROJECT_ID,
        role: ScrubbedUserRole.Principal,
        tokens: TOKENS,
      }),
    ]) {
      expect(statement.query).toContain(`.${EVENTS} WHERE projectId = `);
      expect(statement.query).not.toContain(`${EVENTS}Local`);
    }
  });

  test("no value is spelt into a statement's text: every one is a parameter", () => {
    for (const statement of [
      SecurityUserErasureEvents.toUnnameEventsStatement({
        projectId: PROJECT_ID,
        role: ScrubbedUserRole.Principal,
        tokens: TOKENS,
      }),
      SecurityUserVaultService.toEraseTokensStatement({
        projectId: PROJECT_ID,
        tokens: TOKENS,
      }),
    ]) {
      expect(statement.query).not.toContain("HASHED");
      expect(statement.query).not.toContain(PROJECT_ID.toString());
      expect(statement.query).not.toContain("oneuptime.principal_user");
    }
  });
});
