import BaseAPI from "../../../Server/API/BaseAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentOnCallRuleOwningTeamService from "../../../Server/Services/IncidentOnCallRuleOwningTeamService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import AiFirstResponderRules from "../../../Server/Utils/AI/FirstResponder/AiFirstResponderRules";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOnCallRuleOwningTeam from "../../../Models/DatabaseModels/IncidentOnCallRuleOwningTeam";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A RULE TEAMS OWN IS CHANGED ONLY THROUGH THOSE TEAMS, against a migrated
 * Postgres - through the routes BaseAPI registers over the production
 * services, the real user middleware (which reads the member's teams and
 * their permission rows from the tables below), the real permission
 * pipeline, query serializer and TypeORM.
 *
 * GovTech's case: an oversight team (Team X) and a team that runs services
 * (Team Y) each keep incident on-call rules only they may change - next to
 * the project's rules, which everyone who may change rules changes. The rule,
 * as this suite states it on its own (canChange):
 *
 *   - a rule no team owns is changed by every permission that changes rules;
 *   - a rule some teams own is changed only with the permissions of the
 *     member's teams that own it - another team of theirs lends it none -
 *     and by a Project Admin;
 *   - adding or removing an owning team is changing the rule: the owning
 *     team's own permissions, through the teams that own the rule;
 *   - every member who may read rules reads every one of them.
 *
 * Opt in with RUN_POSTGRES_RECORD_SCOPE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_SCOPE_TESTS=true \
 *   RECORD_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/TeamOwnedRulesPostgres.test.ts
 *
 * CI runs it with the other record scope suites in
 * .github/workflows/postgres-schema-drift.yaml. The tables it writes are
 * copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic. Workflows, live updates, the audit log
 * and OneUptime AI's hand-off are stubbed.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RECORD_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// Copying a table takes a few seconds on a busy database.
jest.setTimeout(10 * 60 * 1000);

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "IncidentOnCallRule",
  "IncidentOnCallRuleOwningTeam",
];

/*
 * What a team of the member's may do to incident on-call rules: nothing,
 * read them (Viewer), change them and who owns them (Editor), or everything
 * as a Project Admin.
 */
type Grant = "none" | "viewer" | "editor" | "admin";

const GRANT_ROWS: Readonly<Record<Grant, Array<Permission>>> = {
  none: [],
  viewer: [
    Permission.ReadIncidentOnCallRule,
    Permission.ReadIncidentOnCallRuleOwningTeam,
  ],
  editor: [
    Permission.ReadIncidentOnCallRule,
    Permission.CreateIncidentOnCallRule,
    Permission.EditIncidentOnCallRule,
    Permission.DeleteIncidentOnCallRule,
    Permission.ReadIncidentOnCallRuleOwningTeam,
    Permission.CreateIncidentOnCallRuleOwningTeam,
    Permission.DeleteIncidentOnCallRuleOwningTeam,
  ],
  admin: [Permission.ProjectAdmin],
};

type TeamName = "teamX" | "teamY";

interface Config {
  teamX: Grant | "not a member";
  teamY: Grant | "not a member";
}

interface RuleFixture {
  key: string;
  id: ObjectID;
  owners: Array<TeamName>;
}

type Write =
  | "edit the rule"
  | "delete the rule"
  | "add Team Z as an owning team"
  | "remove an owning team"
  | "hand the rule to Team Z on its form";

const WRITES: ReadonlyArray<Write> = [
  "edit the rule",
  "delete the rule",
  "add Team Z as an owning team",
  "remove an owning team",
  "hand the rule to Team Z on its form",
];

// What a route answered.
interface Outcome {
  error?: unknown;
  ids?: Array<string>;
  count?: number;
  isEmptySuccess?: boolean;
  item?: BaseModel | null;
}

describePostgres(
  "a rule teams own is changed only through the teams that own it, on Postgres",
  () => {
    const schema: string = `team_owned_rules_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    new BaseAPI(
      IncidentOnCallRule,
      IncidentOnCallRuleService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      IncidentOnCallRuleOwningTeam,
      IncidentOnCallRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
    );

    const memberId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    // The oversight team, the team that runs services, and one owning nothing.
    const teamXId: ObjectID = ObjectID.generate();
    const teamYId: ObjectID = ObjectID.generate();
    const teamZId: ObjectID = ObjectID.generate();

    const teamIdOf: (team: TeamName) => ObjectID = (
      team: TeamName,
    ): ObjectID => {
      return team === "teamX" ? teamXId : teamYId;
    };

    const ruleFixture: (key: string, owners: Array<TeamName>) => RuleFixture = (
      key: string,
      owners: Array<TeamName>,
    ): RuleFixture => {
      return { key: key, id: ObjectID.generate(), owners: owners };
    };

    const RULES: Array<RuleFixture> = [
      ruleFixture("the project's rule", []),
      ruleFixture("Team X's rule", ["teamX"]),
      ruleFixture("Team Y's rule", ["teamY"]),
      ruleFixture("Team X's and Team Y's rule", ["teamX", "teamY"]),
    ];

    const CONFIGS: Array<Config> = [
      // GovTech's two teams, each a member of one.
      { teamX: "not a member", teamY: "editor" },
      { teamX: "editor", teamY: "not a member" },
      // On both: each team's own permissions on its own rules.
      { teamX: "editor", teamY: "viewer" },
      { teamX: "viewer", teamY: "editor" },
      { teamX: "editor", teamY: "editor" },
      { teamX: "viewer", teamY: "viewer" },
      // A Project Admin changes every rule, whoever owns it.
      { teamX: "admin", teamY: "not a member" },
    ];

    /*
     * THE RULE, stated on its own: whether the member may make a change that
     * needs `permission` to a rule `owners` own, with `config`'s teams.
     */
    const canChange: (
      config: Config,
      owners: Array<TeamName>,
      permission: Permission,
    ) => boolean = (
      config: Config,
      owners: Array<TeamName>,
      permission: Permission,
    ): boolean => {
      const teams: Array<TeamName> = (
        ["teamX", "teamY"] as Array<TeamName>
      ).filter((team: TeamName): boolean => {
        return config[team] !== "not a member";
      });

      const grantsOf: (team: TeamName) => Array<Permission> = (
        team: TeamName,
      ): Array<Permission> => {
        return GRANT_ROWS[config[team] as Grant];
      };

      // A Project Admin changes every rule.
      if (
        teams.some((team: TeamName): boolean => {
          return grantsOf(team).includes(Permission.ProjectAdmin);
        })
      ) {
        return true;
      }

      return teams.some((team: TeamName): boolean => {
        return (
          grantsOf(team).includes(permission) &&
          (owners.length === 0 || owners.includes(team))
        );
      });
    };

    const canRead: (config: Config) => boolean = (config: Config): boolean => {
      return (["teamX", "teamY"] as Array<TeamName>).some(
        (team: TeamName): boolean => {
          return config[team] !== "not a member" && config[team] !== "none";
        },
      );
    };

    const expectedOutcome: (
      config: Config,
      write: Write,
      rule: RuleFixture,
    ) => boolean = (
      config: Config,
      write: Write,
      rule: RuleFixture,
    ): boolean => {
      switch (write) {
        case "edit the rule":
          return canChange(
            config,
            rule.owners,
            Permission.EditIncidentOnCallRule,
          );
        case "delete the rule":
          return canChange(
            config,
            rule.owners,
            Permission.DeleteIncidentOnCallRule,
          );
        case "add Team Z as an owning team":
          return canChange(
            config,
            rule.owners,
            Permission.CreateIncidentOnCallRuleOwningTeam,
          );
        case "remove an owning team":
          return (
            rule.owners.length > 0 &&
            canChange(
              config,
              rule.owners,
              Permission.DeleteIncidentOnCallRuleOwningTeam,
            )
          );
        case "hand the rule to Team Z on its form":
          // The rule itself, Team Z added, and every owning team before removed.
          return (
            canChange(config, rule.owners, Permission.EditIncidentOnCallRule) &&
            canChange(
              config,
              rule.owners,
              Permission.CreateIncidentOnCallRuleOwningTeam,
            ) &&
            (rule.owners.length === 0 ||
              canChange(
                config,
                rule.owners,
                Permission.DeleteIncidentOnCallRuleOwningTeam,
              ))
          );
      }
    };

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];
          return value instanceof ObjectID ? value.toString() : value;
        }),
      );
    };

    const query: (
      sql: string,
      values: Array<unknown>,
    ) => Promise<Array<Dictionary<unknown>>> = async (
      sql: string,
      values: Array<unknown>,
    ): Promise<Array<Dictionary<unknown>>> => {
      return (await database.query(sql, values)) as Array<Dictionary<unknown>>;
    };

    const descriptionOf: (rule: RuleFixture) => Promise<unknown> = async (
      rule: RuleFixture,
    ): Promise<unknown> => {
      const rows: Array<Dictionary<unknown>> = await query(
        `SELECT "description" FROM "${schema}"."IncidentOnCallRule" WHERE "_id" = $1`,
        [rule.id.toString()],
      );

      return rows[0]?.["description"];
    };

    const isRuleThere: (rule: RuleFixture) => Promise<boolean> = async (
      rule: RuleFixture,
    ): Promise<boolean> => {
      const rows: Array<Dictionary<unknown>> = await query(
        `SELECT "_id" FROM "${schema}"."IncidentOnCallRule" WHERE "_id" = $1 AND "deletedAt" IS NULL`,
        [rule.id.toString()],
      );

      return rows.length === 1;
    };

    // The teams that own a rule now, by id.
    const ownersOf: (rule: RuleFixture) => Promise<Array<string>> = async (
      rule: RuleFixture,
    ): Promise<Array<string>> => {
      const rows: Array<Dictionary<unknown>> = await query(
        `SELECT "teamId" FROM "${schema}"."IncidentOnCallRuleOwningTeam" WHERE "incidentOnCallRuleId" = $1 AND "deletedAt" IS NULL`,
        [rule.id.toString()],
      );

      return rows
        .map((row: Dictionary<unknown>): string => {
          return String(row["teamId"]).toLowerCase();
        })
        .sort();
    };

    // Every rule, and who owns it, made again from nothing.
    const seedRules: () => Promise<void> = async (): Promise<void> => {
      for (const table of [
        "IncidentOnCallRuleOwningTeam",
        "IncidentOnCallRule",
      ]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      for (const rule of RULES) {
        await insert("IncidentOnCallRule", {
          _id: rule.id,
          projectId: projectId,
          name: rule.key,
          description: "As it was",
          version: 1,
        });

        for (const team of rule.owners) {
          await insert("IncidentOnCallRuleOwningTeam", {
            _id: ObjectID.generate(),
            projectId: projectId,
            incidentOnCallRuleId: rule.id,
            teamId: teamIdOf(team),
            version: 1,
          });
        }
      }
    };

    const setTeam: (
      team: TeamName,
      grant: Grant | "not a member",
    ) => Promise<void> = async (
      team: TeamName,
      grant: Grant | "not a member",
    ): Promise<void> => {
      const teamId: ObjectID = teamIdOf(team);

      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamMember" WHERE "teamId" = $1 AND "userId" = $2`,
        [teamId.toString(), memberId.toString()],
      );

      if (grant === "not a member") {
        return;
      }

      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: teamId,
        userId: memberId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      for (const permission of GRANT_ROWS[grant]) {
        await insert("TeamPermission", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: teamId,
          permission: permission,
          isBlockPermission: false,
          scope: PermissionScope.All,
          version: 1,
        });
      }
    };

    const applyConfig: (config: Config) => Promise<void> = async (
      config: Config,
    ): Promise<void> => {
      await setTeam("teamX", config.teamX);
      await setTeam("teamY", config.teamY);
    };

    // Sends one request through its route, as Express would.
    const send: (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }) => Promise<Outcome> = async (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }): Promise<Outcome> => {
      jest.mocked(Response.sendEntityResponse).mockClear();
      jest.mocked(Response.sendEntityArrayResponse).mockClear();
      jest.mocked(Response.sendJsonObjectResponse).mockClear();
      jest.mocked(Response.sendEmptySuccessResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const req: ExpressRequest = {
        method: "POST",
        params: data.id ? { id: data.id.toString() } : {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${memberId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: data.body || {},
      } as unknown as ExpressRequest;

      const res: ExpressResponse = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;

      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        data.uri,
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          return {
            error: jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
          };
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        return { error: forwardedError };
      }

      const itemCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityResponse,
      ).mock.calls[0];

      if (itemCall) {
        return { item: (itemCall[2] as BaseModel | null) || null };
      }

      const listCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (listCall) {
        return {
          ids: (listCall[2] as Array<BaseModel>)
            .map((model: BaseModel): string => {
              return model.id!.toString().toLowerCase();
            })
            .sort(),
          count: (listCall[3] as PositiveNumber).toNumber(),
        };
      }

      if (
        jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0
      ) {
        return { isEmptySuccess: true };
      }

      throw new Error(`${data.uri} answered nothing.`);
    };

    /*
     * Tries one write on one rule as the member and says whether it was
     * made - checking the database, never the answer alone.
     */
    const tryWrite: (
      write: Write,
      rule: RuleFixture,
    ) => Promise<boolean> = async (
      write: Write,
      rule: RuleFixture,
    ): Promise<boolean> => {
      switch (write) {
        case "edit the rule": {
          const outcome: Outcome = await send({
            uri: "/incident-on-call-rule/:id/update-item",
            id: rule.id,
            body: {
              data: JSONFunctions.serialize({ description: "Changed" }),
            },
          });

          const isMade: boolean = (await descriptionOf(rule)) === "Changed";

          expect(Boolean(outcome.isEmptySuccess)).toBe(isMade);
          return isMade;
        }
        case "delete the rule": {
          const outcome: Outcome = await send({
            uri: "/incident-on-call-rule/:id/delete-item",
            id: rule.id,
          });

          const isMade: boolean = !(await isRuleThere(rule));

          expect(Boolean(outcome.isEmptySuccess)).toBe(isMade);
          return isMade;
        }
        case "add Team Z as an owning team": {
          const outcome: Outcome = await send({
            uri: "/incident-on-call-rule-owning-team",
            body: {
              data: JSONFunctions.serialize({
                incidentOnCallRuleId: rule.id.toString(),
                projectId: projectId.toString(),
                teamId: teamZId.toString(),
              }),
            },
          });

          const isMade: boolean = (await ownersOf(rule)).includes(
            teamZId.toString().toLowerCase(),
          );

          expect(outcome.error === undefined).toBe(isMade);
          return isMade;
        }
        case "remove an owning team": {
          const rows: Array<Dictionary<unknown>> = await query(
            `SELECT "_id" FROM "${schema}"."IncidentOnCallRuleOwningTeam" WHERE "incidentOnCallRuleId" = $1 ORDER BY "teamId" LIMIT 1`,
            [rule.id.toString()],
          );

          if (rows.length === 0) {
            return false;
          }

          const before: number = (await ownersOf(rule)).length;

          const outcome: Outcome = await send({
            uri: "/incident-on-call-rule-owning-team/:id/delete-item",
            id: new ObjectID(String(rows[0]!["_id"])),
          });

          const isMade: boolean = (await ownersOf(rule)).length < before;

          expect(Boolean(outcome.isEmptySuccess)).toBe(isMade);
          return isMade;
        }
        case "hand the rule to Team Z on its form": {
          const outcome: Outcome = await send({
            uri: "/incident-on-call-rule/:id/update-item",
            id: rule.id,
            body: {
              data: JSONFunctions.serialize({ description: "Handed over" }),
              miscDataProps: { owningTeams: [teamZId.toString()] },
            },
          });

          const owners: Array<string> = await ownersOf(rule);
          const isHandedOver: boolean =
            owners.length === 1 &&
            owners[0] === teamZId.toString().toLowerCase();
          const isChanged: boolean =
            (await descriptionOf(rule)) === "Handed over";

          // All of it or, refused before anything is saved, none of it.
          expect(isChanged).toBe(isHandedOver);
          expect(Boolean(outcome.isEmptySuccess)).toBe(isHandedOver);
          return isHandedOver;
        }
      }
    };

    const describeConfig: (config: Config) => string = (
      config: Config,
    ): string => {
      const team: (name: string, grant: Config["teamX"]) => string = (
        name: string,
        grant: Config["teamX"],
      ): string => {
        return grant === "not a member"
          ? `not on ${name}`
          : `on ${name} (${grant})`;
      };

      return `${team("Team X", config.teamX)}, ${team("Team Y", config.teamY)}`;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["RECORD_SCOPE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["RECORD_SCOPE_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RECORD_SCOPE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      // The session token names the member; it is not a signed token here.
      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        token: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(token),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      // Permissions are read from the tables every time: nothing is cached.
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );

      getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      // Workflows, live updates, the audit log and AI's hand-off run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      for (const service of [
        IncidentOnCallRuleService,
        IncidentOnCallRuleOwningTeamService,
      ] as Array<unknown> as Array<DatabaseService<BaseModel>>) {
        getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
          undefined as never,
        );
        getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
          undefined as never,
        );
      }

      getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AiFirstResponderRules, "handOffForRules").mockResolvedValue(
        undefined as never,
      );

      await insert("Project", {
        _id: projectId,
        name: "GovTech",
        slug: projectId.toString(),
        version: 1,
      });

      await insert("User", {
        _id: memberId,
        name: "A Member",
        email: `${memberId.toString()}@example.com`,
        slug: memberId.toString(),
        version: 1,
      });

      for (const [teamId, name] of [
        [teamXId, "Oversight"],
        [teamYId, "Platform"],
        [teamZId, "Database"],
      ] as Array<[ObjectID, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: name,
          slug: teamId.toString(),
          version: 1,
        });
      }
    });

    beforeEach(async () => {
      await seedRules();
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(CONFIGS)(
      "every member who reads rules reads every rule, whoever owns it: %o",
      async (config: Config) => {
        await applyConfig(config);

        const outcome: Outcome = await send({
          uri: "/incident-on-call-rule/get-list",
          body: { query: {}, select: { name: true }, limit: 100, skip: 0 },
        });

        if (!canRead(config)) {
          expect(outcome.ids || []).toEqual([]);
          return;
        }

        expect(outcome.ids).toEqual(
          RULES.map((rule: RuleFixture): string => {
            return rule.id.toString().toLowerCase();
          }).sort(),
        );
      },
    );

    describe.each(CONFIGS)("a member %o", (config: Config) => {
      test.each(
        WRITES.flatMap((write: Write): Array<[Write, string]> => {
          return RULES.map((rule: RuleFixture): [Write, string] => {
            return [write, rule.key];
          });
        }),
      )(
        `${describeConfig(config)}: %s on %s`,
        async (write: Write, key: string) => {
          await applyConfig(config);
          await seedRules();

          const rule: RuleFixture = RULES.find(
            (fixture: RuleFixture): boolean => {
              return fixture.key === key;
            },
          )!;

          expect(await tryWrite(write, rule)).toBe(
            expectedOutcome(config, write, rule),
          );
        },
      );
    });

    test("a member of Team Y is told why Team X's rule is read-only to them", async () => {
      await applyConfig({ teamX: "not a member", teamY: "editor" });

      const outcome: Outcome = await send({
        uri: "/incident-on-call-rule/:id/update-item",
        id: RULES[1]!.id,
        body: { data: JSONFunctions.serialize({ description: "Changed" }) },
      });

      expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
      expect((outcome.error as NotAuthorizedException).message).toContain(
        "Teams own it",
      );
      expect(await descriptionOf(RULES[1]!)).toBe("As it was");
    });

    test("an owning team added to Team X's rule by a member of Team Y is refused, saying why", async () => {
      await applyConfig({ teamX: "not a member", teamY: "editor" });

      const outcome: Outcome = await send({
        uri: "/incident-on-call-rule-owning-team",
        body: {
          data: JSONFunctions.serialize({
            incidentOnCallRuleId: RULES[1]!.id.toString(),
            projectId: projectId.toString(),
            teamId: teamYId.toString(),
          }),
        },
      });

      expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
      expect((outcome.error as NotAuthorizedException).message).toContain(
        "Teams own the incident on-call rule it belongs to",
      );
      expect(await ownersOf(RULES[1]!)).toEqual([
        teamXId.toString().toLowerCase(),
      ]);
    });

    test("a rule created on its form with owning teams is theirs from the start", async () => {
      await applyConfig({ teamX: "not a member", teamY: "editor" });

      const outcome: Outcome = await send({
        uri: "/incident-on-call-rule",
        body: {
          data: JSONFunctions.serialize({
            projectId: projectId.toString(),
            name: "Page Platform",
          }),
          miscDataProps: { owningTeams: [teamYId.toString()] },
        },
      });

      expect(outcome.error).toBeUndefined();

      const created: Array<Dictionary<unknown>> = await query(
        `SELECT "_id" FROM "${schema}"."IncidentOnCallRule" WHERE "name" = $1`,
        ["Page Platform"],
      );

      expect(created).toHaveLength(1);

      const owners: Array<Dictionary<unknown>> = await query(
        `SELECT "teamId" FROM "${schema}"."IncidentOnCallRuleOwningTeam" WHERE "incidentOnCallRuleId" = $1`,
        [String(created[0]!["_id"])],
      );

      expect(
        owners.map((row: Dictionary<unknown>): string => {
          return String(row["teamId"]).toLowerCase();
        }),
      ).toEqual([teamYId.toString().toLowerCase()]);
    });

    test("a rule's form that sends no owning teams leaves who owns it alone", async () => {
      await applyConfig({ teamX: "editor", teamY: "not a member" });

      const outcome: Outcome = await send({
        uri: "/incident-on-call-rule/:id/update-item",
        id: RULES[1]!.id,
        body: { data: JSONFunctions.serialize({ description: "Changed" }) },
      });

      expect(outcome.isEmptySuccess).toBe(true);
      expect(await ownersOf(RULES[1]!)).toEqual([
        teamXId.toString().toLowerCase(),
      ]);
    });
  },
);
