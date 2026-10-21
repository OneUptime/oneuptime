import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { IncidentSubscriberAudienceCounts } from "../../../Types/StatusPage/IncidentSubscriberAudience";
import { DataSource } from "typeorm";

/*
 * StatusPageSubscriberService.countActiveSubscribersByChannel against a
 * migrated Postgres: the per-page, per-channel counts the audience summary
 * shows before an incident or a public note is sent.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_AUDIENCE_COUNT_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SUBSCRIBER_AUDIENCE_COUNT_TESTS=true \
 *   SUBSCRIBER_AUDIENCE_COUNT_TEST_DATABASE_HOST=127.0.0.1 \
 *   SUBSCRIBER_AUDIENCE_COUNT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StatusPageSubscriberAudienceCountsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * The query is hand-written SQL (COUNT(*) FILTER ..., = ANY($2::uuid[])), so
 * only a real driver can judge it. It runs against a structure-only clone of
 * the migrated StatusPageSubscriber table (LIKE ... INCLUDING ALL) in a
 * uniquely named schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_AUDIENCE_COUNT_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("subscriber audience counts against Postgres", () => {
  const schema: string = `subscriber_audience_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const pageA: ObjectID = ObjectID.generate();
  const pageB: ObjectID = ObjectID.generate();
  const pageC: ObjectID = ObjectID.generate();

  let database: DataSource;

  interface SubscriberRow {
    projectId?: ObjectID;
    statusPageId: ObjectID;
    email?: string | null;
    phone?: string | null;
    webhook?: string | null;
    slack?: string | null;
    teams?: string | null;
    isUnsubscribed?: boolean;
    isSubscriptionConfirmed?: boolean;
    isDeleted?: boolean;
  }

  async function seed(row: SubscriberRow): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."StatusPageSubscriber"
         ("_id", "projectId", "statusPageId", "subscriberEmail", "subscriberPhone",
          "subscriberWebhook", "slackIncomingWebhookUrl", "microsoftTeamsIncomingWebhookUrl",
          "isUnsubscribed", "isSubscriptionConfirmed", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)`,
      [
        ObjectID.generate().toString(),
        (row.projectId || projectId).toString(),
        row.statusPageId.toString(),
        row.email ?? null,
        row.phone ?? null,
        row.webhook ?? null,
        row.slack ?? null,
        row.teams ?? null,
        row.isUnsubscribed ?? false,
        row.isSubscriptionConfirmed ?? true,
        row.isDeleted ? new Date() : null,
      ],
    );
  }

  function countFor(
    statusPageIds: Array<ObjectID>,
    forProjectId: ObjectID = projectId,
  ): Promise<Dictionary<IncidentSubscriberAudienceCounts>> {
    return StatusPageSubscriberService.countActiveSubscribersByChannel({
      projectId: forProjectId,
      statusPageIds: statusPageIds,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SUBSCRIBER_AUDIENCE_COUNT_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["SUBSCRIBER_AUDIENCE_COUNT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SUBSCRIBER_AUDIENCE_COUNT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."StatusPageSubscriber" (LIKE public."StatusPageSubscriber" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."StatusPageSubscriber"`);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("the harness reads the clone, not public", async () => {
    await seed({ statusPageId: pageA, email: "a@example.com" });

    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS "count" FROM "StatusPageSubscriber" WHERE "statusPageId" = $1`,
      [pageA.toString()],
    );

    expect(rows[0]!.count).toBe("1");
  });

  test("counts each channel of each page", async () => {
    await seed({ statusPageId: pageA, email: "one@example.com" });
    await seed({ statusPageId: pageA, email: "two@example.com" });
    await seed({
      statusPageId: pageA,
      email: "three@example.com",
      phone: "+15550100",
    });
    await seed({ statusPageId: pageA, phone: "+15550101" });
    await seed({ statusPageId: pageA, webhook: "https://hooks.example.com/1" });
    await seed({
      statusPageId: pageA,
      slack: "https://hooks.slack.com/services/T/B/x",
    });
    await seed({
      statusPageId: pageB,
      teams: "https://example.webhook.office.com/x",
    });
    await seed({ statusPageId: pageB, email: "four@example.com" });

    const counts: Dictionary<IncidentSubscriberAudienceCounts> = await countFor(
      [pageA, pageB],
    );

    expect(counts).toEqual({
      [pageA.toString().toLowerCase()]: {
        email: 3,
        sms: 2,
        slack: 1,
        microsoftTeams: 0,
        webhook: 1,
      },
      [pageB.toString().toLowerCase()]: {
        email: 1,
        sms: 0,
        slack: 0,
        microsoftTeams: 1,
        webhook: 0,
      },
    });
  });

  test("only confirmed, still-subscribed, not deleted subscribers count", async () => {
    await seed({ statusPageId: pageA, email: "counted@example.com" });
    await seed({
      statusPageId: pageA,
      email: "unsubscribed@example.com",
      isUnsubscribed: true,
    });
    await seed({
      statusPageId: pageA,
      email: "unconfirmed@example.com",
      isSubscriptionConfirmed: false,
    });
    await seed({
      statusPageId: pageA,
      email: "deleted@example.com",
      isDeleted: true,
    });

    const counts: Dictionary<IncidentSubscriberAudienceCounts> = await countFor(
      [pageA],
    );

    expect(counts[pageA.toString().toLowerCase()]!.email).toBe(1);
  });

  test("an empty or blank value is no channel", async () => {
    await seed({ statusPageId: pageA, email: "", phone: "   " });
    await seed({ statusPageId: pageA, webhook: "https://hooks.example.com/1" });

    const counts: Dictionary<IncidentSubscriberAudienceCounts> = await countFor(
      [pageA],
    );

    expect(counts[pageA.toString().toLowerCase()]).toEqual({
      email: 0,
      sms: 0,
      slack: 0,
      microsoftTeams: 0,
      webhook: 1,
    });
  });

  test("only the pages asked about, and only in the project asked about", async () => {
    await seed({ statusPageId: pageA, email: "a@example.com" });
    await seed({ statusPageId: pageC, email: "c@example.com" });
    // Another project's subscriber on the same page id is never counted.
    await seed({
      projectId: otherProjectId,
      statusPageId: pageA,
      email: "theirs@example.com",
    });

    expect(await countFor([pageA])).toEqual({
      [pageA.toString().toLowerCase()]: {
        email: 1,
        sms: 0,
        slack: 0,
        microsoftTeams: 0,
        webhook: 0,
      },
    });

    expect(await countFor([pageA], otherProjectId)).toEqual({
      [pageA.toString().toLowerCase()]: {
        email: 1,
        sms: 0,
        slack: 0,
        microsoftTeams: 0,
        webhook: 0,
      },
    });
  });

  test("a page with no active subscriber has no entry", async () => {
    await seed({
      statusPageId: pageB,
      email: "gone@example.com",
      isUnsubscribed: true,
    });

    expect(await countFor([pageA, pageB])).toEqual({});
  });
});
