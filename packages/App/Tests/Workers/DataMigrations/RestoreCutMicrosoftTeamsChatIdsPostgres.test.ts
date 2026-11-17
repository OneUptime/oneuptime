import RestoreCutMicrosoftTeamsChatIds from "../../../FeatureSet/Workers/DataMigrations/RestoreCutMicrosoftTeamsChatIds";
import Entities from "Common/Models/DatabaseModels/Index";
import { WidenWorkspaceMessageIdColumns1809182970000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182970000-WidenWorkspaceMessageIdColumns";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";
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

/*
 * MICROSOFT TEAMS CHAT IDS THROUGH THE UPGRADE THAT KEEPS THEM WHOLE, ON A
 * REAL POSTGRES (issue #9284).
 *
 * On the tables as they were before the upgrade - every id of a message's
 * place a varchar(100) - with each Microsoft Teams personal chat kept cut
 * to its first 100 characters, as the code wrote it, the upgrade runs as it
 * does: the schema migration (1809182970000-WidenWorkspaceMessageIdColumns),
 * then the RestoreCutMicrosoftTeamsChatIds data migration.
 *
 *   - the schema migration keeps every value, rewrites no row and keeps the
 *     index on "WorkspaceLiveMessage"."channelId" as it is (the same
 *     relfilenode, valid) - each table locked only for its catalog change -
 *     and a 131-character chat id fits after it, a 501-character one not;
 *   - the data migration puts each project's chats back whole, in the kept
 *     messages and in the logs, and touches nothing else: no Slack row,
 *     no other project's row, no id it cannot tell, no name;
 *   - a second run changes nothing, and two runs at once come to the same;
 *   - down() narrows the tables back without cutting an id: a kept message
 *     whose place is longer is forgotten, a log's id emptied.
 *
 * Opt in with RUN_POSTGRES_TEAMS_CHAT_IDS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema), dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from TEAMS_CHAT_IDS_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from TEAMS_CHAT_IDS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TEAMS_CHAT_IDS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "WorkspaceProjectAuthToken",
  "WorkspaceLiveMessage",
  "WorkspaceNotificationLog",
];

const PROJECT_A: string = "92840000-0000-4000-8000-0000000000a1";
const PROJECT_B: string = "92840000-0000-4000-8000-0000000000b1";

// Personal chats' ids as the Bot Framework gives them: 131 characters.
const AMIT_CHAT: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";
const JANE_CHAT: string =
  "a:1ko1Q0eJNq3zKYs_oT83Pn8aVFgonj5G1wK8itwnYL4qjtJVbPem6bQoOt9ky3GTE1cY_wt6HRBrS5bkp-bZ8XgAPV73h0dJjkkwvkko-LHWpnDd57IvAVFs1pJ2DULPc";
const GROUP_CHAT: string = "19:9f2b1c0a7e5d4c3b@thread.v2";
const TEAMS_CHANNEL: string = "19:inc-8@thread.tacv2";

// A chat neither project lists any more: no chat can be told for it.
const GONE_CHAT: string = `a:1gone${"G".repeat(124)}`;

function cut(chatId: string): string {
  return chatId.substring(0, 100);
}

function chatsOf(...ids: Array<string>): Record<string, unknown> {
  const chats: Record<string, unknown> = {};

  for (const id of ids) {
    chats[id] = {
      id: id,
      name: `Chat ${id.substring(0, 8)}`,
      chatType: id.startsWith("a:") ? "personal" : "groupChat",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    };
  }

  return chats;
}

// The rows of the two tables, by id, as the upgrade must leave them.
interface PlaceRow {
  id: string;
  table: "WorkspaceLiveMessage" | "WorkspaceNotificationLog";
  projectId: string;
  workspaceType: "MicrosoftTeams" | "Slack";
  channelId: string | null;
  channelName: string | null;
  // What channelId reads after the data migration.
  restoredTo: string | null;
}

const ROWS: Array<PlaceRow> = [
  // Project A's page from Amit's personal chat: the place and the run's card.
  {
    id: "92840000-0000-4000-8000-000000000101",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: cut(AMIT_CHAT),
    channelName: "Amit Rajput",
    restoredTo: AMIT_CHAT,
  },
  {
    id: "92840000-0000-4000-8000-000000000102",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: cut(AMIT_CHAT),
    channelName: "Amit Rajput",
    restoredTo: AMIT_CHAT,
  },
  // A channel and a group chat: never cut, never touched.
  {
    id: "92840000-0000-4000-8000-000000000103",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: TEAMS_CHANNEL,
    channelName: "inc-8",
    restoredTo: TEAMS_CHANNEL,
  },
  {
    id: "92840000-0000-4000-8000-000000000104",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: GROUP_CHAT,
    channelName: "On-call",
    restoredTo: GROUP_CHAT,
  },
  // A Slack row that happens to hold the same 100 characters: not Teams.
  {
    id: "92840000-0000-4000-8000-000000000105",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "Slack",
    channelId: cut(AMIT_CHAT),
    channelName: "ops",
    restoredTo: cut(AMIT_CHAT),
  },
  // Project B: Jane's chat, put back; Amit's cut id is not B's chat.
  {
    id: "92840000-0000-4000-8000-000000000106",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_B,
    workspaceType: "MicrosoftTeams",
    channelId: cut(JANE_CHAT),
    channelName: "Jane Doe",
    restoredTo: JANE_CHAT,
  },
  {
    id: "92840000-0000-4000-8000-000000000107",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_B,
    workspaceType: "MicrosoftTeams",
    channelId: cut(AMIT_CHAT),
    channelName: "Amit Rajput",
    restoredTo: cut(AMIT_CHAT),
  },
  // A chat the connection no longer lists: left as it is.
  {
    id: "92840000-0000-4000-8000-000000000108",
    table: "WorkspaceLiveMessage",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: cut(GONE_CHAT),
    channelName: "Gone",
    restoredTo: cut(GONE_CHAT),
  },
  // The logs: the card that reached Amit's chat, and an update that did not.
  {
    id: "92840000-0000-4000-8000-000000000201",
    table: "WorkspaceNotificationLog",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: cut(AMIT_CHAT),
    channelName: "Amit Rajput",
    restoredTo: AMIT_CHAT,
  },
  {
    id: "92840000-0000-4000-8000-000000000202",
    table: "WorkspaceNotificationLog",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: cut(AMIT_CHAT),
    // A chat the send could not name was named by its (cut) id.
    channelName: cut(AMIT_CHAT),
    restoredTo: AMIT_CHAT,
  },
  {
    id: "92840000-0000-4000-8000-000000000203",
    table: "WorkspaceNotificationLog",
    projectId: PROJECT_B,
    workspaceType: "MicrosoftTeams",
    channelId: cut(JANE_CHAT),
    channelName: "Jane Doe",
    restoredTo: JANE_CHAT,
  },
  {
    id: "92840000-0000-4000-8000-000000000204",
    table: "WorkspaceNotificationLog",
    projectId: PROJECT_A,
    workspaceType: "Slack",
    channelId: cut(AMIT_CHAT),
    channelName: "ops",
    restoredTo: cut(AMIT_CHAT),
  },
  {
    id: "92840000-0000-4000-8000-000000000205",
    table: "WorkspaceNotificationLog",
    projectId: PROJECT_A,
    workspaceType: "MicrosoftTeams",
    channelId: null,
    channelName: null,
    restoredTo: null,
  },
];

describePostgres(
  "Microsoft Teams chat ids through the upgrade that keeps them whole (Postgres)",
  () => {
    const schema: string = `teams_chat_ids_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    async function withRunner(
      work: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await work(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    async function columnType(table: string, column: string): Promise<string> {
      const rows: Array<{ data_type: string; max: number | null }> =
        await database.query(
          `SELECT data_type, character_maximum_length AS "max" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schema, table, column],
        );

      return rows[0]!.max
        ? `${rows[0]!.data_type}(${rows[0]!.max})`
        : rows[0]!.data_type;
    }

    // Every row's place, as Postgres holds it, by id.
    async function storedPlaces(): Promise<
      Record<string, [string | null, string | null]>
    > {
      const places: Record<string, [string | null, string | null]> = {};

      for (const table of [
        "WorkspaceLiveMessage",
        "WorkspaceNotificationLog",
      ]) {
        const rows: Array<{
          _id: string;
          channelId: string | null;
          channelName: string | null;
        }> = await database.query(
          `SELECT "_id", "channelId", "channelName" FROM "${schema}"."${table}"`,
        );

        for (const row of rows) {
          places[row._id] = [row.channelId, row.channelName];
        }
      }

      return places;
    }

    // The table's and its channelId index's files: a rewrite or a rebuild moves them.
    async function liveMessageFiles(): Promise<{
      table: string;
      index: string;
      indexIsValid: boolean;
    }> {
      const rows: Array<{
        table: string;
        index: string;
        indexIsValid: boolean;
      }> = await database.query(
        `SELECT pg_relation_filenode(t.oid)::text AS "table", pg_relation_filenode(i.indexrelid)::text AS "index", i.indisvalid AS "indexIsValid" FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_index i ON i.indrelid = t.oid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0] WHERE n.nspname = $1 AND t.relname = 'WorkspaceLiveMessage' AND a.attname = 'channelId' AND i.indnatts = 1`,
        [schema],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    async function seedAsWritten(): Promise<void> {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      const tokens: Array<[string, string, string, Record<string, unknown>]> = [
        [
          "92840000-0000-4000-8000-000000000001",
          PROJECT_A,
          "MicrosoftTeams",
          { availableChats: chatsOf(AMIT_CHAT, GROUP_CHAT) },
        ],
        [
          "92840000-0000-4000-8000-000000000002",
          PROJECT_B,
          "MicrosoftTeams",
          { availableChats: chatsOf(JANE_CHAT) },
        ],
        // A connection of no chats, and one whose chats are not a map.
        [
          "92840000-0000-4000-8000-000000000003",
          PROJECT_A,
          "Slack",
          { botUserId: "B0BOT" },
        ],
        [
          "92840000-0000-4000-8000-000000000004",
          PROJECT_B,
          "MicrosoftTeams",
          { availableChats: [JANE_CHAT] },
        ],
      ];

      for (const [id, projectId, workspaceType, miscData] of tokens) {
        await database.query(
          `INSERT INTO "${schema}"."WorkspaceProjectAuthToken" ("_id", "version", "projectId", "authToken", "workspaceType", "workspaceProjectId", "miscData") VALUES ($1, 1, $2, 'token', $3, 'tenant', $4)`,
          [id, projectId, workspaceType, JSON.stringify(miscData)],
        );
      }

      for (const row of ROWS) {
        if (row.table === "WorkspaceLiveMessage") {
          await database.query(
            `INSERT INTO "${schema}"."WorkspaceLiveMessage" ("_id", "version", "projectId", "workspaceType", "messageKey", "destinationType", "channelId", "channelName", "messageId") VALUES ($1, 1, $2, $3, $4, 'Chat', $5, $6, '')`,
            [
              row.id,
              row.projectId,
              row.workspaceType,
              `OnCallPageRequest:Alert:${row.id}`,
              row.channelId,
              row.channelName,
            ],
          );
        } else {
          await database.query(
            `INSERT INTO "${schema}"."WorkspaceNotificationLog" ("_id", "version", "projectId", "workspaceType", "channelId", "channelName", "status") VALUES ($1, 1, $2, $3, $4, $5, 'Success')`,
            [
              row.id,
              row.projectId,
              row.workspaceType,
              row.channelId,
              row.channelName,
            ],
          );
        }
      }
    }

    function asWritten(): Record<string, [string | null, string | null]> {
      const places: Record<string, [string | null, string | null]> = {};

      for (const row of ROWS) {
        places[row.id] = [row.channelId, row.channelName];
      }

      return places;
    }

    function restored(): Record<string, [string | null, string | null]> {
      const places: Record<string, [string | null, string | null]> = {};

      for (const row of ROWS) {
        places[row.id] = [row.restoredTo, row.channelName];
      }

      return places;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TEAMS_CHAT_IDS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TEAMS_CHAT_IDS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEAMS_CHAT_IDS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The tables as they were before the upgrade.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new WidenWorkspaceMessageIdColumns1809182970000().down(
          queryRunner,
        );
      });
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the upgrade: every value kept by the schema migration, in place; each project's chats put back whole by the data migration, and nothing else touched", async () => {
      await seedAsWritten();

      // Before the upgrade, on the old columns.
      for (const [table, column] of [
        ["WorkspaceLiveMessage", "channelId"],
        ["WorkspaceLiveMessage", "channelName"],
        ["WorkspaceLiveMessage", "teamId"],
        ["WorkspaceLiveMessage", "messageId"],
        ["WorkspaceNotificationLog", "channelId"],
        ["WorkspaceNotificationLog", "channelName"],
        ["WorkspaceNotificationLog", "threadId"],
      ] as const) {
        expect(await columnType(table, column)).toBe("character varying(100)");
      }

      expect(await storedPlaces()).toEqual(asWritten());

      // A whole personal chat id did not fit: the code cut it to.
      await expect(
        database.query(
          `UPDATE "${schema}"."WorkspaceLiveMessage" SET "channelId" = $1 WHERE "_id" = $2`,
          [AMIT_CHAT, ROWS[0]!.id],
        ),
      ).rejects.toThrow("value too long");

      const filesBefore: {
        table: string;
        index: string;
        indexIsValid: boolean;
      } = await liveMessageFiles();

      // The schema migration keeps every value, in place.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new WidenWorkspaceMessageIdColumns1809182970000().up(queryRunner);
      });

      for (const [table, column] of [
        ["WorkspaceLiveMessage", "channelId"],
        ["WorkspaceLiveMessage", "channelName"],
        ["WorkspaceLiveMessage", "teamId"],
        ["WorkspaceLiveMessage", "messageId"],
        ["WorkspaceNotificationLog", "channelId"],
        ["WorkspaceNotificationLog", "channelName"],
        ["WorkspaceNotificationLog", "threadId"],
      ] as const) {
        expect(await columnType(table, column)).toBe("character varying(500)");
      }

      expect(await storedPlaces()).toEqual(asWritten());

      // No row rewritten, the index kept as it was - and still valid.
      expect(await liveMessageFiles()).toEqual(filesBefore);
      expect(filesBefore.indexIsValid).toBe(true);

      // The data migration puts each project's chats back whole.
      await new RestoreCutMicrosoftTeamsChatIds().migrate();

      expect(await storedPlaces()).toEqual(restored());

      // The kept message is found by its chat's whole id, through the index.
      const found: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."WorkspaceLiveMessage" WHERE "channelId" = $1 ORDER BY "_id"`,
        [AMIT_CHAT],
      );

      expect(
        found.map((row: { _id: string }): string => {
          return row._id;
        }),
      ).toEqual([ROWS[0]!.id, ROWS[1]!.id]);

      // A second run changes nothing.
      await new RestoreCutMicrosoftTeamsChatIds().migrate();

      expect(await storedPlaces()).toEqual(restored());
    });

    test("two runs at once come to the same as one", async () => {
      await seedAsWritten();

      await withRunner(async (queryRunner: QueryRunner) => {
        if (
          (await columnType("WorkspaceLiveMessage", "channelId")) !==
          "character varying(500)"
        ) {
          await new WidenWorkspaceMessageIdColumns1809182970000().up(
            queryRunner,
          );
        }
      });

      await Promise.all([
        new RestoreCutMicrosoftTeamsChatIds().migrate(),
        new RestoreCutMicrosoftTeamsChatIds().migrate(),
      ]);

      expect(await storedPlaces()).toEqual(restored());
    });

    test("after the upgrade a whole personal chat id fits, and an id longer than any column keeps is refused rather than cut", async () => {
      await seedAsWritten();

      await withRunner(async (queryRunner: QueryRunner) => {
        if (
          (await columnType("WorkspaceLiveMessage", "channelId")) !==
          "character varying(500)"
        ) {
          await new WidenWorkspaceMessageIdColumns1809182970000().up(
            queryRunner,
          );
        }
      });

      await database.query(
        `UPDATE "${schema}"."WorkspaceLiveMessage" SET "channelId" = $1 WHERE "_id" = $2`,
        [AMIT_CHAT, ROWS[0]!.id],
      );

      await expect(
        database.query(
          `UPDATE "${schema}"."WorkspaceLiveMessage" SET "channelId" = $1 WHERE "_id" = $2`,
          [`a:1${"x".repeat(498)}`, ROWS[0]!.id],
        ),
      ).rejects.toThrow("value too long");

      expect((await storedPlaces())[ROWS[0]!.id]![0]).toBe(AMIT_CHAT);
    });

    test("down() narrows the tables back without cutting an id: a kept message whose place is longer is forgotten, a log's id emptied, a name cut", async () => {
      await seedAsWritten();

      await withRunner(async (queryRunner: QueryRunner) => {
        if (
          (await columnType("WorkspaceLiveMessage", "channelId")) !==
          "character varying(500)"
        ) {
          await new WidenWorkspaceMessageIdColumns1809182970000().up(
            queryRunner,
          );
        }
      });

      await new RestoreCutMicrosoftTeamsChatIds().migrate();

      const longName: string = "Amit, Jane, Nitin and the on-call ".repeat(5);
      await database.query(
        `UPDATE "${schema}"."WorkspaceNotificationLog" SET "channelName" = $1 WHERE "_id" = $2`,
        [longName, ROWS[8]!.id],
      );

      await withRunner(async (queryRunner: QueryRunner) => {
        await new WidenWorkspaceMessageIdColumns1809182970000().down(
          queryRunner,
        );
      });

      expect(await columnType("WorkspaceLiveMessage", "channelId")).toBe(
        "character varying(100)",
      );

      const places: Record<string, [string | null, string | null]> =
        await storedPlaces();

      // The kept messages in a whole personal chat are forgotten.
      expect(places[ROWS[0]!.id]).toBeUndefined();
      expect(places[ROWS[1]!.id]).toBeUndefined();
      expect(places[ROWS[5]!.id]).toBeUndefined();
      // Those that fit stay as they were.
      expect(places[ROWS[2]!.id]).toEqual([TEAMS_CHANNEL, "inc-8"]);
      expect(places[ROWS[6]!.id]).toEqual([cut(AMIT_CHAT), "Amit Rajput"]);

      // A log keeps its row, without an id it cannot hold whole.
      expect(places[ROWS[8]!.id]).toEqual([null, longName.substring(0, 100)]);
      expect(places[ROWS[10]!.id]).toEqual([null, "Jane Doe"]);
      expect(places[ROWS[11]!.id]).toEqual([cut(AMIT_CHAT), "ops"]);

      // Back up, for any test after this one.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new WidenWorkspaceMessageIdColumns1809182970000().up(queryRunner);
      });
    });
  },
);
