jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

import Entities from "../../../Models/DatabaseModels/Index";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import WorkspaceUserAuthTokenService, {
  LinksNotMadeBySignInCleanupResult,
} from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import { ExpressRequest } from "../../../Server/Utils/Express";
import SlackActionType from "../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAuthAction, {
  SlackAuthRefusalReason,
  SlackRequest,
} from "../../../Server/Utils/Workspace/Slack/Actions/Auth";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger } from "typeorm";

/*
 * ONLY A SIGN-IN CONNECTS A CHAT ACCOUNT, ON POSTGRES.
 *
 * A Slack or Microsoft Teams account acts as the member its link
 * (WorkspaceUserAuthToken) names. What decides it on real rows:
 *
 *   - the sign-ins' own write (refreshAuthToken, as OneUptime) stores a link
 *     that names no creator - what tells it from a link a person wrote
 *     through the API, which names them;
 *   - a person's create is refused before Postgres sees it;
 *   - the cleanup the data migration RemoveChatAccountLinksNotMadeBySignIn
 *     runs (WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn) removes
 *     every link that names a creator and only the notification methods - and
 *     their on-call rules - that point at such a link's account, through real
 *     IS NULL / IS NOT NULL / NOT IN reads of uuid columns;
 *   - a Slack press finds the member among Slack links only.
 *
 * Opt in with RUN_POSTGRES_WORKSPACE_USER_LINK_TESTS=true against a database
 * the registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_WORKSPACE_USER_LINK_TESTS=true \
 *   WORKSPACE_USER_LINK_TEST_DATABASE_HOST=127.0.0.1 \
 *   WORKSPACE_USER_LINK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/WorkspaceUserAuthTokenLinksPostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Without the
 * flag the suite is skipped, so the Common test job - whose Postgres is not
 * migrated - never runs it.
 *
 * The tables it writes are copied (LIKE ... INCLUDING ALL) from public into
 * a uniquely named schema that is dropped afterwards. Every row is synthetic.
 * Only what lies outside OneUptime's database is stubbed: the membership read
 * a press makes, Valkey, and workflows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WORKSPACE_USER_LINK_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables this suite writes.
const TABLES: Array<string> = [
  "WorkspaceProjectAuthToken",
  "WorkspaceUserAuthToken",
  "UserSlack",
  "UserMicrosoftTeams",
  "UserNotificationRule",
];

// The dashes of an id, taken out to name the schema.
const DASH: RegExp = /-/g;

// Every statement Postgres refuses, even one a caller swallowed.
class QueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

// A stored row, as Postgres hands it back.
type StoredRow = Dictionary<string | number | boolean | Date | null>;

describePostgres("chat account links, on Postgres", () => {
  const schema: string = `workspace_user_links_${ObjectID.generate()
    .toString()
    .replace(DASH, "")}`;

  const recorder: QueryRecorder = new QueryRecorder();
  let database: DataSource;

  const SLACK_TEAM_ID: string = "T0POSTGRES";
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  // A member who signed in; somebody who wrote links through the API.
  const victimId: ObjectID = ObjectID.generate();
  const writerId: ObjectID = ObjectID.generate();

  const VICTIM_SLACK: string = "U0PGVICTIM";
  const WRITER_SLACK: string = "U0PGWRITER";
  const VICTIM_TEAMS: string = "9b9b9b9b-1111-4222-8333-444444444444";

  // Who WorkspaceActionAuthorization takes for a member of the project.
  let memberUserIds: Set<string>;

  async function insert(
    table: string,
    row: Dictionary<unknown>,
  ): Promise<void> {
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
  }

  async function seedLink(data: {
    userId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    // Who wrote it through the API; none for a sign-in's.
    createdByUserId?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("WorkspaceUserAuthToken", {
      _id: id,
      projectId: data.projectId || projectId,
      userId: data.userId,
      workspaceType: data.workspaceType,
      workspaceUserId: data.workspaceUserId,
      authToken: "",
      miscData: JSON.stringify({ userId: data.workspaceUserId }),
      createdByUserId: data.createdByUserId || null,
      version: 1,
    });

    return id;
  }

  async function seedSlackMethod(data: {
    userId: ObjectID;
    slackUserId: string;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("UserSlack", {
      _id: id,
      projectId: projectId,
      userId: data.userId,
      slackUserId: data.slackUserId,
      isVerified: true,
      version: 1,
    });

    return id;
  }

  async function seedTeamsMethod(data: {
    userId: ObjectID;
    microsoftTeamsUserId: string;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("UserMicrosoftTeams", {
      _id: id,
      projectId: projectId,
      userId: data.userId,
      microsoftTeamsUserId: data.microsoftTeamsUserId,
      isVerified: true,
      version: 1,
    });

    return id;
  }

  async function seedRule(data: {
    userId: ObjectID;
    userSlackId?: ObjectID | undefined;
    userMicrosoftTeamsId?: ObjectID | undefined;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await insert("UserNotificationRule", {
      _id: id,
      projectId: projectId,
      userId: data.userId,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      notifyAfterMinutes: 0,
      userSlackId: data.userSlackId || null,
      userMicrosoftTeamsId: data.userMicrosoftTeamsId || null,
      version: 1,
    });

    return id;
  }

  async function idsIn(table: string): Promise<Array<string>> {
    const rows: Array<StoredRow> = await database.query(
      `SELECT "_id" FROM "${schema}"."${table}" ORDER BY "_id"`,
    );

    return rows.map((row: StoredRow): string => {
      return String(row["_id"]);
    });
  }

  function sorted(ids: Array<ObjectID>): Array<string> {
    return ids
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort();
  }

  // A Slack button pressed by `slackUserId` in the project's workspace.
  async function pressInSlack(slackUserId: string): Promise<SlackRequest> {
    return await SlackAuthAction.isAuthorized({
      req: {
        body: {
          payload: JSON.stringify({
            type: "block_actions",
            user: { id: slackUserId, username: "someone", name: "someone" },
            team: { id: SLACK_TEAM_ID },
            channel: { id: "C0PGINCIDENTS" },
            container: { type: "message" },
            message: { ts: "1700000000.000100" },
            actions: [
              {
                action_id: SlackActionType.AcknowledgeIncident,
                value: ObjectID.generate().toString(),
              },
            ],
          }),
        },
      } as unknown as ExpressRequest,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["WORKSPACE_USER_LINK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["WORKSPACE_USER_LINK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["WORKSPACE_USER_LINK_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      // Table names stay unqualified: the copies in the test schema are found first.
      synchronize: false,
      logger: recorder,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  });

  beforeEach(async () => {
    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    recorder.failures = [];

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);

    // Workflows run elsewhere.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    memberUserIds = new Set<string>([victimId.toString(), writerId.toString()]);

    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation(
        async (data: { userId: ObjectID; projectId: ObjectID }) => {
          return (
            data.projectId.toString() === projectId.toString() &&
            memberUserIds.has(data.userId.toString())
          );
        },
      );

    await insert("WorkspaceProjectAuthToken", {
      _id: ObjectID.generate(),
      projectId: projectId,
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: SLACK_TEAM_ID,
      authToken: "xoxb-synthetic-project-token",
      miscData: JSON.stringify({
        teamId: SLACK_TEAM_ID,
        teamName: "Synthetic",
        botUserId: "U0PGBOT",
      }),
      version: 1,
    });
  });

  afterEach(() => {
    // Nothing Postgres refused, even quietly.
    expect(recorder.failures).toEqual([]);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("the sign-ins' own write stores a link that names no creator, and the press finds it", async () => {
    await WorkspaceUserAuthTokenService.refreshAuthToken({
      projectId: projectId,
      userId: victimId,
      workspaceType: WorkspaceType.Slack,
      authToken: "",
      workspaceUserId: VICTIM_SLACK,
      miscData: { userId: VICTIM_SLACK },
    });

    const rows: Array<StoredRow> = await database.query(
      `SELECT "userId", "workspaceType", "workspaceUserId", "createdByUserId"
         FROM "${schema}"."WorkspaceUserAuthToken"`,
    );

    expect(rows).toEqual([
      {
        userId: victimId.toString(),
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: VICTIM_SLACK,
        createdByUserId: null,
      },
    ]);

    const press: SlackRequest = await pressInSlack(VICTIM_SLACK);

    expect(press.isAuthorized).toBe(true);
    expect(press.userId?.toString()).toBe(victimId.toString());
  });

  test("a person's create is refused before Postgres sees it, whatever their role", async () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectMember,
    ]) {
      const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      link.projectId = projectId;
      link.workspaceType = WorkspaceType.Slack;
      link.workspaceUserId = VICTIM_SLACK;
      link.authToken = "";
      link.miscData = { userId: VICTIM_SLACK };

      const props: DatabaseCommonInteractionProps = {
        userId: writerId,
        userType: UserType.User,
        tenantId: projectId,
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: projectId,
            permissions: [
              {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              },
            ],
          },
        },
      };

      await expect(
        WorkspaceUserAuthTokenService.create({ data: link, props: props }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    }

    expect(await idsIn("WorkspaceUserAuthToken")).toEqual([]);

    // Nobody signed in as the account: a press from it is asked to connect.
    const press: SlackRequest = await pressInSlack(VICTIM_SLACK);

    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
  });

  test("the cleanup removes every link a person wrote, and only the methods and rules made from them", async () => {
    // What sign-ins wrote.
    const victimSlackLink: ObjectID = await seedLink({
      userId: victimId,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: VICTIM_SLACK,
    });
    const victimTeamsLink: ObjectID = await seedLink({
      userId: victimId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: VICTIM_TEAMS,
    });

    /*
     * What a person wrote through the API: their own link to the victim's
     * accounts, one naming the victim to their own account, one elsewhere.
     */
    await seedLink({
      userId: writerId,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: VICTIM_SLACK,
      createdByUserId: writerId,
    });
    await seedLink({
      userId: writerId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: VICTIM_TEAMS,
      createdByUserId: writerId,
    });
    await seedLink({
      userId: victimId,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: WRITER_SLACK,
      createdByUserId: writerId,
    });
    await seedLink({
      userId: writerId,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: "U0PGELSEWHERE",
      createdByUserId: writerId,
      projectId: otherProjectId,
    });

    const victimSlackMethod: ObjectID = await seedSlackMethod({
      userId: victimId,
      slackUserId: VICTIM_SLACK,
    });
    const writerSlackMethod: ObjectID = await seedSlackMethod({
      userId: writerId,
      slackUserId: VICTIM_SLACK,
    });
    const victimMethodToWriter: ObjectID = await seedSlackMethod({
      userId: victimId,
      slackUserId: WRITER_SLACK,
    });
    const victimTeamsMethod: ObjectID = await seedTeamsMethod({
      userId: victimId,
      microsoftTeamsUserId: VICTIM_TEAMS,
    });
    const writerTeamsMethod: ObjectID = await seedTeamsMethod({
      userId: writerId,
      microsoftTeamsUserId: VICTIM_TEAMS,
    });

    const victimRule: ObjectID = await seedRule({
      userId: victimId,
      userSlackId: victimSlackMethod,
    });
    await seedRule({ userId: writerId, userSlackId: writerSlackMethod });
    await seedRule({ userId: victimId, userSlackId: victimMethodToWriter });
    const victimTeamsRule: ObjectID = await seedRule({
      userId: victimId,
      userMicrosoftTeamsId: victimTeamsMethod,
    });
    await seedRule({
      userId: writerId,
      userMicrosoftTeamsId: writerTeamsMethod,
    });

    // Before: the writer's link shadows the victim's account.
    const before: Array<StoredRow> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM "${schema}"."WorkspaceUserAuthToken"
        WHERE "workspaceUserId" = $1 AND "projectId" = $2`,
      [VICTIM_SLACK, projectId.toString()],
    );

    expect(before[0]!["count"]).toBe(2);

    const result: LinksNotMadeBySignInCleanupResult =
      await WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn();

    expect(result).toEqual({
      removedLinkCount: 4,
      removedSlackMethodCount: 2,
      removedMicrosoftTeamsMethodCount: 1,
      failedLinkCount: 0,
    });

    expect(await idsIn("WorkspaceUserAuthToken")).toEqual(
      sorted([victimSlackLink, victimTeamsLink]),
    );
    expect(await idsIn("UserSlack")).toEqual(sorted([victimSlackMethod]));
    expect(await idsIn("UserMicrosoftTeams")).toEqual(
      sorted([victimTeamsMethod]),
    );
    expect(await idsIn("UserNotificationRule")).toEqual(
      sorted([victimRule, victimTeamsRule]),
    );

    // The victim's account is the victim's again.
    const press: SlackRequest = await pressInSlack(VICTIM_SLACK);

    expect(press.userId?.toString()).toBe(victimId.toString());

    // And the writer's account is nobody's.
    const writerPress: SlackRequest = await pressInSlack(WRITER_SLACK);

    expect(writerPress.refusal?.reason).toBe(
      SlackAuthRefusalReason.NotConnected,
    );

    // Run again: nothing more.
    expect(
      await WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn(),
    ).toEqual({
      removedLinkCount: 0,
      removedSlackMethodCount: 0,
      removedMicrosoftTeamsMethodCount: 0,
      failedLinkCount: 0,
    });
  });

  test("a link that cannot be removed is left out of the next read, so the walk ends", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    const stuck: ObjectID = await seedLink({
      userId: writerId,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: VICTIM_SLACK,
      createdByUserId: writerId,
    });

    for (let index: number = 0; index < 3; index++) {
      await seedLink({
        userId: writerId,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: `U0PGTYPED${index}`,
        createdByUserId: writerId,
      });
    }

    const realDeleteBy: typeof WorkspaceUserAuthTokenService.deleteBy =
      WorkspaceUserAuthTokenService.deleteBy.bind(
        WorkspaceUserAuthTokenService,
      );

    jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockImplementation(
        async (
          deleteBy: Parameters<
            typeof WorkspaceUserAuthTokenService.deleteBy
          >[0],
        ): Promise<number> => {
          if (
            String((deleteBy.query as Dictionary<unknown>)["_id"]) ===
            stuck.toString()
          ) {
            throw new Error("the row is locked");
          }

          return await realDeleteBy(deleteBy);
        },
      );

    const result: LinksNotMadeBySignInCleanupResult =
      await WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn();

    expect(result.failedLinkCount).toBe(1);
    expect(result.removedLinkCount).toBe(3);
    expect(await idsIn("WorkspaceUserAuthToken")).toEqual(sorted([stuck]));
  });

  test("a Slack press finds the member among Slack links only", async () => {
    // A link of another chat whose account id reads like a Slack one.
    await seedLink({
      userId: writerId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: VICTIM_SLACK,
    });

    const press: SlackRequest = await pressInSlack(VICTIM_SLACK);

    expect(press.userId).toBeUndefined();
    expect(press.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
  });
});
