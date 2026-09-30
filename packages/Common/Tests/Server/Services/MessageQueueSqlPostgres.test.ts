/* eslint-disable @typescript-eslint/no-explicit-any */
import Entities from "../../../Models/DatabaseModels/Index";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MessageQueueLabelRuleEngineService from "../../../Server/Services/MessageQueueLabelRuleEngineService";
import MessageQueueOwnerRuleEngineService from "../../../Server/Services/MessageQueueOwnerRuleEngineService";
import MessageQueueService, {
  MessageQueueFindOrCreateResult,
} from "../../../Server/Services/MessageQueueService";
import logger from "../../../Server/Utils/Logger";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  MessageQueueIdentity,
  buildMessageQueueDisplayName,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * The hand-written Postgres of the Queues product, EXECUTED - not string
 * matched. The unit suites replace manager.query with a mock, so a renamed
 * join table or column (MessageQueueLabel, automaticAssignments, ...) or a
 * name predicate Postgres reads differently from the TypeScript that wrote
 * the name would pass them and then fail - or archive the wrong queues - in
 * production every five minutes. Here the real service methods run against
 * structure-only clones of the MIGRATED tables:
 *
 *   - the (projectId, queueIdentifier) partial unique index, and
 *     findOrCreateByIdentity racing itself on it;
 *   - the family refinement compare-and-set and the auto-archive restore;
 *   - the auto-archive sweep (every "untouched" rule - description, rename,
 *     a person's labels and owners vs a rule's, a person's restore - its
 *     window, its batch bound and its order) and the budget count;
 *   - the automaticAssignments bookkeeping;
 *   - the sighting heartbeat's hook-free write;
 *   - a person adding a queue and restoring one through the real create and
 *     update pipelines.
 *
 * Opt in with RUN_POSTGRES_MESSAGE_QUEUE_SQL_TESTS=true against a Postgres
 * migrated to the current head (the clones copy public.<table>) - the
 * Postgres Schema Drift workflow's database right after its drift check, as
 * for DatabaseServerSqlPostgres. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MESSAGE_QUEUE_SQL_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from MESSAGE_QUEUE_SQL_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml). Every table
 * and row lives in a unique schema that is dropped afterwards; search_path
 * holds only that schema, so a statement naming a table that was not cloned
 * fails loudly instead of touching real data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MESSAGE_QUEUE_SQL_TESTS"] === "true"
    ? describe
    : describe.skip;

const DAY_MS: number = 24 * 60 * 60 * 1000;

// Tables the SQL under test reads or writes.
const TABLES: Array<string> = [
  "MessageQueue",
  "MessageQueueLabel",
  "MessageQueueOwnerUser",
  "MessageQueueOwnerTeam",
  "Label",
];

/*
 * Tables only ever seeded by hand here: their NOT NULL columns are relaxed
 * so a fixture names only what the SQL reads. MessageQueue keeps every
 * constraint - the ORM writes it.
 */
const FIXTURE_TABLES: Array<string> = TABLES.filter((table: string) => {
  return table !== "MessageQueue";
});

describePostgres("Queues SQL against Postgres", () => {
  const schema: string = `message_queue_sql_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const teamId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let cache: Map<string, string>;

  function silence(): void {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  }

  // A faithful in-memory Redis for the heartbeat's atomic gates.
  function mockCache(): void {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (ns: string, key: string) => {
        cache.delete(`${ns}:${key}`);
      });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MESSAGE_QUEUE_SQL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MESSAGE_QUEUE_SQL_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MESSAGE_QUEUE_SQL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    for (const table of FIXTURE_TABLES) {
      // Primary-key columns (a join table's pair included) stay NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT c.column_name FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
          AND c.column_name NOT IN (
            SELECT a.attname FROM pg_index i
            INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass AND i.indisprimary
          )`,
        [schema, table],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  let labelRules: jest.SpyInstance;
  let ownerRules: jest.SpyInstance;

  beforeEach(async () => {
    silence();
    cache = new Map<string, string>();
    mockCache();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    labelRules = jest
      .spyOn(MessageQueueLabelRuleEngineService, "applyRulesToMessageQueue")
      .mockResolvedValue(undefined);
    ownerRules = jest
      .spyOn(MessageQueueOwnerRuleEngineService, "applyRulesToMessageQueue")
      .mockResolvedValue(undefined);
    jest
      .spyOn(MessageQueueService as any, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(MessageQueueService as any, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    MessageQueueService.clearAutoCreateBudgetMemo();
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  function ago(ms: number): Date {
    return new Date(Date.now() - ms);
  }

  function identityOf(value: {
    system: string;
    brokerScope?: string;
    destination: string;
  }): MessageQueueIdentity {
    const identity: MessageQueueIdentity | null = toMessageQueueIdentity(value);
    if (!identity) {
      throw new Error(`not an identity: ${JSON.stringify(value)}`);
    }
    return identity;
  }

  async function insertQueue(data: {
    name?: string;
    destinationName?: string;
    queueIdentifier?: string;
    messagingSystem?: string;
    description?: string | null;
    project?: ObjectID;
    source?: string | null;
    lastSeenAt?: Date | null;
    createdAt?: Date;
    isArchived?: boolean;
    archivedAt?: Date | null;
    autoArchivedAt?: Date | null;
    manuallyRestoredAt?: Date | null;
    automaticAssignments?: unknown;
    deletedAt?: Date | null;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const destination: string =
      data.destinationName || `queue-${id.toString().substring(0, 8)}`;
    await database.query(
      `INSERT INTO "${schema}"."MessageQueue" (
        "_id", "version", "projectId", "name", "slug", "queueIdentifier",
        "messagingSystem", "destinationName", "description", "discoverySource",
        "lastSeenAt", "createdAt", "isArchived", "archivedAt", "autoArchivedAt",
        "manuallyRestoredAt", "automaticAssignments", "deletedAt"
      ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        data.name === undefined ? destination : data.name,
        `${destination.substring(0, 60)}-${id.toString()}`,
        data.queueIdentifier || `kafka||${destination.toLowerCase()}`,
        data.messagingSystem || "kafka",
        destination,
        data.description ?? null,
        data.source === undefined ? "traces" : data.source,
        data.lastSeenAt === undefined ? ago(10 * DAY_MS) : data.lastSeenAt,
        data.createdAt || ago(30 * DAY_MS),
        Boolean(data.isArchived),
        data.archivedAt ?? null,
        data.autoArchivedAt ?? null,
        data.manuallyRestoredAt ?? null,
        data.automaticAssignments === undefined
          ? null
          : JSON.stringify(data.automaticAssignments),
        data.deletedAt ?? null,
      ],
    );
    return id;
  }

  async function insertRow(
    table: string,
    values: Record<string, unknown>,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const columns: Array<string> = ["_id", ...Object.keys(values)];
    const parameters: Array<unknown> = [
      id.toString(),
      ...Object.values(values),
    ];
    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${parameters
        .map((_value: unknown, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      parameters.map((value: unknown): unknown => {
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );
    return id;
  }

  async function link(
    table: string,
    columns: Record<string, ObjectID>,
  ): Promise<void> {
    const names: Array<string> = Object.keys(columns);
    await database.query(
      `INSERT INTO "${schema}"."${table}" (${names
        .map((name: string): string => {
          return `"${name}"`;
        })
        .join(", ")}) VALUES (${names
        .map((_name: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      Object.values(columns).map((value: ObjectID): string => {
        return value.toString();
      }),
    );
  }

  async function queueState(id: ObjectID): Promise<any> {
    const rows: Array<any> = await database.query(
      `SELECT * FROM "${schema}"."MessageQueue" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0];
  }

  async function liveQueues(): Promise<Array<any>> {
    return await database.query(
      `SELECT * FROM "${schema}"."MessageQueue" WHERE "deletedAt" IS NULL ORDER BY "createdAt"`,
    );
  }

  function flushPromises(): Promise<void> {
    return new Promise((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  function personProps(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      userId: userId,
      tenantId: projectId,
      userGlobalAccessPermission: {
        projectIds: [projectId],
        globalPermissions: [Permission.Public, Permission.User],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId: projectId,
          permissions: permissions.map(
            (permission: Permission): UserPermission => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            },
          ),
          _type: "UserTenantAccessPermission",
        },
      },
      userTeamIds: [],
    };
  }

  /*
   * -------------------------------------------------------------------------
   * Identity
   * -------------------------------------------------------------------------
   */
  test("the identity index keeps one LIVE row per project and identifier", async () => {
    await insertQueue({
      destinationName: "orders",
      queueIdentifier: "kafka||orders",
    });

    await expect(
      insertQueue({
        destinationName: "orders",
        queueIdentifier: "kafka||orders",
      }),
    ).rejects.toThrow(/IDX_message_queue_identifier|unique/);

    // Another project, or a deleted row, never collides.
    await insertQueue({
      destinationName: "orders",
      queueIdentifier: "kafka||orders",
      project: otherProjectId,
    });
    await insertQueue({
      destinationName: "payments",
      queueIdentifier: "kafka||payments",
      deletedAt: new Date(),
    });
    await insertQueue({
      destinationName: "payments",
      queueIdentifier: "kafka||payments",
    });

    /*
     * The migrated schema carries the index under the name the model declares
     * (a clone made with LIKE ... INCLUDING ALL renames it, so the name is
     * read from public).
     */
    for (const [schemaName, indexName] of [
      ["public", "IDX_message_queue_identifier"],
      [schema, null],
    ] as Array<[string, string | null]>) {
      const indexes: Array<{ indexname: string; indexdef: string }> =
        await database.query(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'MessageQueue' AND indexdef LIKE '%("projectId", "queueIdentifier")%'`,
          [schemaName],
        );
      expect(indexes).toHaveLength(1);
      if (indexName) {
        expect(indexes[0]!.indexname).toBe(indexName);
      }
      expect(indexes[0]!.indexdef).toContain("CREATE UNIQUE INDEX");
      expect(indexes[0]!.indexdef).toContain('WHERE ("deletedAt" IS NULL)');
    }
  });

  test("findOrCreateByIdentity creates once, then finds - with the columns discovery owns", async () => {
    const first: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity({
        projectId: projectId,
        identity: identityOf({ system: "jms", destination: "orders" }),
        system: "activemq",
        destination: "Orders",
        brokerAddress: "broker-1.internal:61616",
        source: "broker-metrics",
        allowCreate: true,
      });

    expect(first.created).toBe(true);
    const stored: any = await queueState(first.queue!.id!);
    expect(stored.queueIdentifier).toBe("jms||orders");
    expect(stored.messagingSystem).toBe("activemq");
    expect(stored.destinationName).toBe("Orders");
    expect(stored.name).toBe("Orders");
    expect(stored.brokerAddress).toBe("broker-1.internal:61616");
    expect(stored.discoverySource).toBe("broker-metrics");
    expect(stored.lastSeenAt).toBeInstanceOf(Date);
    // Left to the broker-metrics sighting that follows: its only writer.
    expect(stored.brokerMetricsLastSeenAt).toBeNull();
    expect(stored.isArchived).toBe(false);
    expect(stored.slug).toBeTruthy();
    await flushPromises();
    expect(labelRules).toHaveBeenCalledTimes(1);
    expect(ownerRules).toHaveBeenCalledTimes(1);

    // Any spelling of the identity finds the same row.
    const second: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity({
        projectId: projectId,
        identity: {
          system: "ActiveMQ",
          brokerScope: "",
          destination: "ORDERS",
        },
        system: "jms",
        destination: "ORDERS",
        source: "traces",
        allowCreate: true,
      });

    expect(second.created).toBe(false);
    expect(second.queue!.id!.toString()).toBe(first.queue!.id!.toString());
    expect(await liveQueues()).toHaveLength(1);
  });

  test("racing writers end with one row and one creator; every loser gets the winner", async () => {
    const results: Array<MessageQueueFindOrCreateResult> = await Promise.all(
      Array.from({ length: 8 }, () => {
        return MessageQueueService.findOrCreateByIdentity({
          projectId: projectId,
          identity: identityOf({
            system: "kafka",
            destination: "orders.created",
          }),
          system: "kafka",
          destination: "orders.created",
          source: "traces",
          allowCreate: true,
        });
      }),
    );

    const rows: Array<any> = await liveQueues();
    expect(rows).toHaveLength(1);
    expect(
      results.filter((result: MessageQueueFindOrCreateResult): boolean => {
        return result.created;
      }),
    ).toHaveLength(1);
    for (const result of results) {
      expect(result.queue!.id!.toString()).toBe(rows[0]._id);
    }
    await flushPromises();
    // Only the winner ran the rule engines.
    expect(labelRules).toHaveBeenCalledTimes(1);
  });

  test("a sighting refines jms to activemq in the database - never back, never across", async () => {
    const id: ObjectID = await insertQueue({
      destinationName: "orders",
      queueIdentifier: "jms||orders",
      messagingSystem: "jms",
      lastSeenAt: new Date(),
    });
    const sight: (system: string) => Promise<void> = async (
      system: string,
    ): Promise<void> => {
      await MessageQueueService.findOrCreateByIdentity({
        projectId: projectId,
        identity: identityOf({ system: "jms", destination: "orders" }),
        system: system,
        destination: "orders",
        source: "traces",
        allowCreate: false,
      });
    };

    await sight("kafka");
    expect((await queueState(id)).messagingSystem).toBe("jms");

    await sight("activemq");
    expect((await queueState(id)).messagingSystem).toBe("activemq");

    await sight("jms");
    expect((await queueState(id)).messagingSystem).toBe("activemq");
  });

  test("discovery restores only a row it archived itself", async () => {
    const autoArchived: ObjectID = await insertQueue({
      destinationName: "auto",
      queueIdentifier: "kafka||auto",
      isArchived: true,
      archivedAt: ago(DAY_MS),
      autoArchivedAt: ago(DAY_MS),
    });
    const archivedByPerson: ObjectID = await insertQueue({
      destinationName: "person",
      queueIdentifier: "kafka||person",
      isArchived: true,
      archivedAt: ago(DAY_MS),
    });

    for (const destination of ["auto", "person"]) {
      await MessageQueueService.findOrCreateByIdentity({
        projectId: projectId,
        identity: identityOf({ system: "kafka", destination }),
        system: "kafka",
        destination,
        source: "traces",
        allowCreate: false,
      });
    }

    const restored: any = await queueState(autoArchived);
    expect(restored.isArchived).toBe(false);
    expect(restored.archivedAt).toBeNull();
    expect(restored.autoArchivedAt).toBeNull();
    expect((await queueState(archivedByPerson)).isArchived).toBe(true);
  });

  /*
   * -------------------------------------------------------------------------
   * The sweep
   * -------------------------------------------------------------------------
   */
  test("the auto-archive sweep archives exactly the stale rows nobody invested in", async () => {
    const archived: Map<string, ObjectID> = new Map();
    const kept: Map<string, ObjectID> = new Map();

    archived.set("plain stale", await insertQueue({}));
    kept.set("manual", await insertQueue({ source: "manual" }));
    kept.set("no discovery source", await insertQueue({ source: null }));
    kept.set("seen yesterday", await insertQueue({ lastSeenAt: ago(DAY_MS) }));
    archived.set(
      "never seen, created long ago",
      await insertQueue({ lastSeenAt: null, createdAt: ago(20 * DAY_MS) }),
    );
    kept.set(
      "never seen, created yesterday",
      await insertQueue({ lastSeenAt: null, createdAt: ago(DAY_MS) }),
    );
    kept.set(
      "already archived by a person",
      await insertQueue({ isArchived: true, archivedAt: ago(20 * DAY_MS) }),
    );
    kept.set("deleted", await insertQueue({ deletedAt: new Date() }));
    archived.set(
      "broker metrics source",
      await insertQueue({ source: "broker-metrics" }),
    );

    // A description or a rename is a person's investment; a blank one is not.
    kept.set(
      "described",
      await insertQueue({ description: "Checkout order events" }),
    );
    archived.set("blank description", await insertQueue({ description: "  " }));
    kept.set("renamed", await insertQueue({ name: "Orders (production)" }));

    /*
     * A destination longer than the name column gets a clamped name
     * (buildMessageQueueDisplayName) - which Postgres must still read as
     * discovery's own, with the trailing spaces the clamp trimmed.
     */
    const longDestination: string = `orders-${"x".repeat(150)}`;
    archived.set(
      "long destination, generated name",
      await insertQueue({
        destinationName: longDestination,
        name: buildMessageQueueDisplayName({ destination: longDestination }),
      }),
    );
    const spacedDestination: string = `${"a".repeat(98)} ${"b".repeat(40)}`;
    expect(
      buildMessageQueueDisplayName({ destination: spacedDestination }),
    ).toBe(`${"a".repeat(98)}…`);
    archived.set(
      "long destination cut at a space, generated name",
      await insertQueue({
        destinationName: spacedDestination,
        name: buildMessageQueueDisplayName({ destination: spacedDestination }),
      }),
    );
    kept.set(
      "long destination, renamed",
      await insertQueue({
        destinationName: `payments-${"y".repeat(150)}`,
        name: "Payments",
      }),
    );

    // Labels: a person's count, a rule's do not.
    const labelA: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "a",
    });
    const labelB: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "b",
    });
    const foreignLabel: ObjectID = await insertRow("Label", {
      projectId: otherProjectId,
      name: "x",
    });
    const deletedLabel: ObjectID = await insertRow("Label", {
      projectId: projectId,
      name: "d",
      deletedAt: new Date(),
    });
    const humanLabelled: ObjectID = await insertQueue({});
    await link("MessageQueueLabel", {
      messageQueueId: humanLabelled,
      labelId: labelA,
    });
    kept.set("labelled by a person", humanLabelled);
    const ruleLabelled: ObjectID = await insertQueue({
      automaticAssignments: { labelIds: [labelA.toString()] },
    });
    await link("MessageQueueLabel", {
      messageQueueId: ruleLabelled,
      labelId: labelA,
    });
    archived.set("labelled only by a rule", ruleLabelled);
    const mixedLabels: ObjectID = await insertQueue({
      automaticAssignments: { labelIds: [labelA.toString()] },
    });
    await link("MessageQueueLabel", {
      messageQueueId: mixedLabels,
      labelId: labelA,
    });
    await link("MessageQueueLabel", {
      messageQueueId: mixedLabels,
      labelId: labelB,
    });
    kept.set("a rule's label plus a person's", mixedLabels);
    const foreignLabelled: ObjectID = await insertQueue({});
    await link("MessageQueueLabel", {
      messageQueueId: foreignLabelled,
      labelId: foreignLabel,
    });
    archived.set("labelled from another project", foreignLabelled);
    const deletedLabelled: ObjectID = await insertQueue({});
    await link("MessageQueueLabel", {
      messageQueueId: deletedLabelled,
      labelId: deletedLabel,
    });
    archived.set("labelled with a deleted label", deletedLabelled);

    // Owners: the same rule.
    const humanOwned: ObjectID = await insertQueue({});
    await insertRow("MessageQueueOwnerUser", {
      projectId: projectId,
      messageQueueId: humanOwned,
      userId: userId,
    });
    kept.set("owned by a person-added user", humanOwned);
    const teamOwned: ObjectID = await insertQueue({});
    await insertRow("MessageQueueOwnerTeam", {
      projectId: projectId,
      messageQueueId: teamOwned,
      teamId: teamId,
    });
    kept.set("owned by a person-added team", teamOwned);
    const ruleOwned: ObjectID = await insertQueue({
      automaticAssignments: {
        ownerUserIds: [userId.toString()],
        ownerTeamIds: [teamId.toString()],
      },
    });
    await insertRow("MessageQueueOwnerUser", {
      projectId: projectId,
      messageQueueId: ruleOwned,
      userId: userId,
    });
    await insertRow("MessageQueueOwnerTeam", {
      projectId: projectId,
      messageQueueId: ruleOwned,
      teamId: teamId,
    });
    archived.set("owned only through owner rules", ruleOwned);
    const deletedOwner: ObjectID = await insertQueue({});
    await insertRow("MessageQueueOwnerUser", {
      projectId: projectId,
      messageQueueId: deletedOwner,
      userId: userId,
      deletedAt: new Date(),
    });
    archived.set("owned by a deleted owner row", deletedOwner);
    const foreignOwner: ObjectID = await insertQueue({});
    await insertRow("MessageQueueOwnerUser", {
      projectId: otherProjectId,
      messageQueueId: foreignOwner,
      userId: userId,
    });
    archived.set("owned by another project's row", foreignOwner);

    // A person's Restore holds until seen again or 30 days pass.
    kept.set(
      "restored by a person last week, not seen since",
      await insertQueue({ manuallyRestoredAt: ago(7 * DAY_MS) }),
    );
    archived.set(
      "restored by a person 40 days ago",
      await insertQueue({
        lastSeenAt: ago(50 * DAY_MS),
        manuallyRestoredAt: ago(40 * DAY_MS),
      }),
    );
    archived.set(
      "restored, then seen, then quiet",
      await insertQueue({
        lastSeenAt: ago(10 * DAY_MS),
        manuallyRestoredAt: ago(12 * DAY_MS),
      }),
    );

    const count: number =
      await MessageQueueService.autoArchiveStaleMessageQueues();

    const archivedIds: Set<string> = new Set();
    for (const row of await liveQueues()) {
      if (row.autoArchivedAt) {
        archivedIds.add(row._id);
      }
    }

    for (const [label, id] of archived) {
      const state: any = await queueState(id);
      expect({ label, isArchived: state.isArchived }).toEqual({
        label,
        isArchived: true,
      });
      expect({ label, auto: Boolean(state.autoArchivedAt) }).toEqual({
        label,
        auto: true,
      });
      expect(state.archivedAt).toBeInstanceOf(Date);
      expect(state.archivedByUserId).toBeNull();
    }
    for (const [label, id] of kept) {
      expect({ label, auto: archivedIds.has(id.toString()) }).toEqual({
        label,
        auto: false,
      });
    }
    expect(count).toBe(archived.size);

    // Nothing is archived twice.
    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(0);
  });

  test("the sweep archives at most 500 rows a run, the longest-unseen first", async () => {
    await database.query(
      `INSERT INTO "${schema}"."MessageQueue" (
        "_id", "version", "projectId", "name", "slug", "queueIdentifier",
        "messagingSystem", "destinationName", "discoverySource", "lastSeenAt",
        "createdAt", "isArchived"
      )
      SELECT gen_random_uuid(), 1, $1, 'q-' || n, 'q-' || n || '-' || md5(random()::text), 'kafka||q-' || n,
        'kafka', 'q-' || n, 'traces', now() - make_interval(days => 1000 - n), now() - interval '1000 days', false
      FROM generate_series(1, 502) AS n`,
      [projectId.toString()],
    );

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(500);

    const left: Array<{ name: string }> = await database.query(
      `SELECT "name" FROM "${schema}"."MessageQueue" WHERE "isArchived" = false ORDER BY "name"`,
    );
    // The two seen most recently wait for the next run.
    expect(
      left.map((row: { name: string }): string => {
        return row.name;
      }),
    ).toEqual(["q-501", "q-502"]);

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(2);
  });

  test("the window follows MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS", async () => {
    const tenDays: ObjectID = await insertQueue({
      lastSeenAt: ago(10 * DAY_MS),
    });
    const previous: string | undefined =
      process.env["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"];
    process.env["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"] = "14";

    try {
      await expect(
        MessageQueueService.autoArchiveStaleMessageQueues(),
      ).resolves.toBe(0);
      expect((await queueState(tenDays)).isArchived).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"];
      } else {
        process.env["MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS"] = previous;
      }
    }

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(1);
  });

  test("the auto-create budget counts live, non-archived, non-manual rows of the project", async () => {
    await insertQueue({ source: "traces" });
    await insertQueue({ source: "broker-metrics" });
    await insertQueue({ source: null });
    await insertQueue({ source: "manual" });
    await insertQueue({ source: "traces", isArchived: true });
    await insertQueue({ source: "traces", deletedAt: new Date() });
    await insertQueue({ source: "traces", project: otherProjectId });

    // traces, broker-metrics and the NULL source count; the rest do not.
    await expect(
      MessageQueueService.countAutoCreatedMessageQueues(projectId),
    ).resolves.toBe(3);
  });

  test("automatic assignments are recorded deduped and forgotten precisely", async () => {
    const id: ObjectID = await insertQueue({});
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();

    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: id,
      kind: "labelIds",
      ids: [a, a.toString().toUpperCase()],
    });
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: id,
      kind: "labelIds",
      ids: [a, b],
    });
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: id,
      kind: "ownerTeamIds",
      ids: [b],
    });

    let state: any = await queueState(id);
    expect([...state.automaticAssignments.labelIds].sort()).toEqual(
      [a.toString(), b.toString()].sort(),
    );
    expect(state.automaticAssignments.ownerTeamIds).toEqual([b.toString()]);

    await MessageQueueService.forgetAutomaticAssignments({
      messageQueueId: id,
      kind: "labelIds",
      ids: [a],
    });

    state = await queueState(id);
    expect(state.automaticAssignments.labelIds).toEqual([b.toString()]);
    expect(state.automaticAssignments.ownerTeamIds).toEqual([b.toString()]);

    // Forgetting where nothing was recorded writes nothing.
    const untouched: ObjectID = await insertQueue({});
    await MessageQueueService.forgetAutomaticAssignments({
      messageQueueId: untouched,
      kind: "ownerUserIds",
      ids: [a],
    });
    expect((await queueState(untouched)).automaticAssignments).toBeNull();

    // A malformed value is replaced by a well-formed object.
    const malformed: ObjectID = await insertQueue({
      automaticAssignments: ["not", "an", "object"],
    });
    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: malformed,
      kind: "ownerUserIds",
      ids: [a],
    });
    expect((await queueState(malformed)).automaticAssignments).toEqual({
      ownerUserIds: [a.toString()],
    });
  });

  test("a sighting writes its liveness and the broker address through the real heartbeat", async () => {
    const id: ObjectID = await insertQueue({ lastSeenAt: ago(5 * DAY_MS) });
    const at: Date = ago(60 * 1000);
    const before: number = Date.now();

    await MessageQueueService.recordSighting({
      projectId: projectId,
      queueId: id,
      source: "broker-metrics",
      brokerAddress: "  kafka-1.internal:9092 ",
      at: at,
    });

    let state: any = await queueState(id);
    // When discovery saw it; the broker's own datapoint time has its column.
    expect(state.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(state.brokerMetricsLastSeenAt.getTime()).toBe(at.getTime());
    expect(state.brokerAddress).toBe("kafka-1.internal:9092");
    const afterBrokerMetrics: number = state.lastSeenAt.getTime();

    // A trace sighting in its own window moves lastSeenAt only.
    await MessageQueueService.recordSighting({
      projectId: projectId,
      queueId: id,
      source: "traces",
      at: ago(10 * 60 * 1000),
    });

    state = await queueState(id);
    expect(state.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      afterBrokerMetrics,
    );
    expect(state.brokerMetricsLastSeenAt.getTime()).toBe(at.getTime());
    expect(state.brokerAddress).toBe("kafka-1.internal:9092");

    // A fresh sighting keeps the queue out of the sweep.
    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(0);
  });

  /*
   * One pass: the queue is created from late broker metrics, then both
   * sources report it - traces first, then the broker's datapoints from
   * forty minutes ago (Azure Monitor / CloudWatch lag). The stored row must
   * never go back behind the create or the trace sighting.
   */
  test("lastSeenAt never moves backwards in the database, whichever source writes last", async () => {
    const created: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity({
        projectId: projectId,
        identity: identityOf({
          system: "servicebus",
          brokerScope: "orders-prod",
          destination: "orders",
        }),
        system: "servicebus",
        destination: "orders",
        source: "broker-metrics",
        allowCreate: true,
      });
    const id: ObjectID = created.queue!.id!;
    await flushPromises();

    let state: any = await queueState(id);
    const createdLastSeenAt: number = state.lastSeenAt.getTime();
    expect(state.brokerMetricsLastSeenAt).toBeNull();

    await MessageQueueService.recordSighting({
      projectId: projectId,
      queueId: id,
      source: "traces",
      at: ago(60 * 1000),
    });

    state = await queueState(id);
    const afterTraces: number = state.lastSeenAt.getTime();
    expect(afterTraces).toBeGreaterThanOrEqual(createdLastSeenAt);

    const newestDatapoint: Date = ago(40 * 60 * 1000);
    await MessageQueueService.recordSighting({
      projectId: projectId,
      queueId: id,
      source: "broker-metrics",
      at: newestDatapoint,
    });

    state = await queueState(id);
    expect(state.lastSeenAt.getTime()).toBeGreaterThanOrEqual(afterTraces);
    expect(state.brokerMetricsLastSeenAt.getTime()).toBe(
      newestDatapoint.getTime(),
    );
  });

  /*
   * -------------------------------------------------------------------------
   * People
   * -------------------------------------------------------------------------
   */
  describe("a person adding a queue", () => {
    function manual(
      messagingSystem: string,
      destinationName: string,
      brokerScope?: string,
    ): MessageQueue {
      const data: MessageQueue = new MessageQueue();
      data.messagingSystem = messagingSystem;
      data.destinationName = destinationName;
      if (brokerScope) {
        data.brokerScope = brokerScope;
      }
      return data;
    }

    test("the real create pipeline stores the identity discovery would build", async () => {
      const created: MessageQueue = await MessageQueueService.create({
        data: manual(
          "azure_servicebus",
          "Orders/Subscriptions/Billing",
          "orders-prod.servicebus.windows.net",
        ),
        props: personProps([
          Permission.CreateMessageQueue,
          Permission.ReadMessageQueue,
        ]),
      });

      const stored: any = await queueState(created.id!);
      expect(stored.projectId).toBe(projectId.toString());
      expect(stored.messagingSystem).toBe("servicebus");
      expect(stored.destinationName).toBe("Orders");
      expect(stored.brokerScope).toBe("orders-prod");
      expect(stored.queueIdentifier).toBe("servicebus|orders-prod|orders");
      expect(stored.discoverySource).toBe("manual");
      expect(stored.name).toBe("Orders");
      expect(stored.createdByUserId).toBe(userId.toString());
      await flushPromises();
      expect(labelRules).toHaveBeenCalledTimes(1);

      // Discovery sighting the same queue finds the person's row.
      const found: MessageQueueFindOrCreateResult =
        await MessageQueueService.findOrCreateByIdentity({
          projectId: projectId,
          identity: identityOf({
            system: "servicebus",
            brokerScope: "orders-prod",
            destination: "orders",
          }),
          system: "servicebus",
          destination: "orders",
          source: "traces",
          allowCreate: true,
        });
      expect(found).toMatchObject({ created: false });
      expect(found.queue!.id!.toString()).toBe(created.id!.toString());
    });

    test("the same queue twice is refused, naming it for a caller who may read it", async () => {
      await insertQueue({
        name: "Checkout orders",
        destinationName: "orders",
        queueIdentifier: "aws_sqs||orders",
        messagingSystem: "aws_sqs",
      });

      await expect(
        MessageQueueService.create({
          data: manual(
            "AmazonSQS",
            "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
          ),
          props: personProps([
            Permission.CreateMessageQueue,
            Permission.ReadMessageQueue,
          ]),
        }),
      ).rejects.toThrow(
        'The Amazon SQS queue "orders" already exists: "Checkout orders".',
      );
      expect(await liveQueues()).toHaveLength(1);
    });
  });

  test("a person's Restore through the real update pipeline holds the sweep off", async () => {
    const id: ObjectID = await insertQueue({
      isArchived: true,
      archivedAt: ago(DAY_MS),
      autoArchivedAt: ago(DAY_MS),
      lastSeenAt: ago(20 * DAY_MS),
    });

    await MessageQueueService.updateOneById({
      id: id,
      data: { isArchived: false } as any,
      props: personProps([
        Permission.EditMessageQueue,
        Permission.ReadMessageQueue,
      ]),
    });

    const restored: any = await queueState(id);
    expect(restored.isArchived).toBe(false);
    expect(restored.autoArchivedAt).toBeNull();
    expect(restored.manuallyRestoredAt).toBeInstanceOf(Date);

    // Stale for 20 days, but restored by a person just now: left alone.
    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(0);

    // And a person archiving it takes it out of discovery's hands.
    await MessageQueueService.updateOneById({
      id: id,
      data: { isArchived: true } as any,
      props: personProps([
        Permission.EditMessageQueue,
        Permission.ReadMessageQueue,
      ]),
    });

    const archived: any = await queueState(id);
    expect(archived.isArchived).toBe(true);
    expect(archived.autoArchivedAt).toBeNull();
    expect(archived.manuallyRestoredAt).toBeNull();
    expect(archived.archivedByUserId).toBe(userId.toString());

    await MessageQueueService.findOrCreateByIdentity({
      projectId: projectId,
      identity: parseIdentity(archived.queueIdentifier),
      system: archived.messagingSystem,
      destination: archived.destinationName,
      source: "traces",
      allowCreate: false,
    });
    expect((await queueState(id)).isArchived).toBe(true);
  });

  function parseIdentity(identifier: string): MessageQueueIdentity {
    const [system, brokerScope, destination] = identifier.split("|");
    return identityOf({
      system: system!,
      brokerScope: brokerScope!,
      destination: destination!,
    });
  }
});
