import Entities from "../../../Models/DatabaseModels/Index";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * The status page template lookup against a real, migrated database.
 *
 * StatusPageSubscriberNotificationTemplateLookup.test.ts pins the lookup's
 * logic with the tables faked. What only Postgres can show is that the SQL
 * the fix relies on works: the page's links read its project through the
 * StatusPage relation, and the template query filters on the linked ids with
 * QueryHelper.any. The regression it guards: with more than 100 newer
 * templates of the same event and channel in OTHER projects, the page's own
 * linked template must still be found (the old query read 100 of them across
 * every project and looked for the linked id in memory).
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_TEMPLATE_LOOKUP_TESTS=true and
 * config.env; point it at a migrated database with
 * SUBSCRIBER_TEMPLATE_LOOKUP_TEST_DATABASE_HOST/PORT/NAME (default
 * localhost:5400; the Postgres Schema Drift job runs it). Only the table
 * definitions are copied from public, into an isolated schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_TEMPLATE_LOOKUP_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "StatusPage",
  "StatusPageSubscriberNotificationTemplate",
  "StatusPageSubscriberNotificationTemplateStatusPage",
];

const EVENT: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;
const METHOD: StatusPageSubscriberNotificationMethod =
  StatusPageSubscriberNotificationMethod.Email;

describePostgres("status page template lookup against Postgres", () => {
  const schema: string = `subscriber_template_lookup_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  // Every seeded row gets a later createdAt than the one before it.
  let clock: number = Date.UTC(2026, 0, 1);

  function nextCreatedAt(): Date {
    clock += 1000;
    return new Date(clock);
  }

  async function seedStatusPage(projectId: ObjectID): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, 'Site 03', $3, 1)`,
      [id.toString(), projectId.toString(), `site-${id.toString()}`],
    );
    return id;
  }

  async function seedTemplate(
    projectId: ObjectID,
    overrides: {
      eventType?: StatusPageSubscriberNotificationEventType;
      notificationMethod?: StatusPageSubscriberNotificationMethod;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."StatusPageSubscriberNotificationTemplate" ("_id", "projectId", "templateName", "eventType", "notificationMethod", "templateBody", "createdAt", "version") VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [
        id.toString(),
        projectId.toString(),
        `Template ${id.toString()}`,
        overrides.eventType || EVENT,
        overrides.notificationMethod || METHOD,
        `<p>${id.toString()}</p>`,
        nextCreatedAt(),
      ],
    );
    return id;
  }

  async function link(data: {
    projectId: ObjectID;
    statusPageId: ObjectID;
    templateId: ObjectID;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."StatusPageSubscriberNotificationTemplateStatusPage" ("_id", "projectId", "statusPageId", "statusPageSubscriberNotificationTemplateId", "version") VALUES ($1, $2, $3, $4, 1)`,
      [
        ObjectID.generate().toString(),
        data.projectId.toString(),
        data.statusPageId.toString(),
        data.templateId.toString(),
      ],
    );
  }

  async function seedOtherProjectsTemplates(count: number): Promise<void> {
    for (let i: number = 0; i < count; i++) {
      await seedTemplate(ObjectID.generate());
    }
  }

  function lookUp(
    statusPageId: ObjectID,
  ): Promise<StatusPageSubscriberNotificationTemplate | null> {
    return StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
      {
        statusPageId,
        eventType: EVENT,
        notificationMethod: METHOD,
      },
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SUBSCRIBER_TEMPLATE_LOOKUP_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["SUBSCRIBER_TEMPLATE_LOOKUP_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SUBSCRIBER_TEMPLATE_LOOKUP_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
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

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      })
        .reverse()
        .join("; "),
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("finds the page's linked template behind 150 newer templates from other projects", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = await seedStatusPage(projectId);
    const linkedTemplateId: ObjectID = await seedTemplate(projectId);
    await link({ projectId, statusPageId, templateId: linkedTemplateId });
    await seedOtherProjectsTemplates(150);

    // Harness guard: the old query's first page really does miss it.
    const newestHundred: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."StatusPageSubscriberNotificationTemplate" WHERE "eventType" = $1 AND "notificationMethod" = $2 ORDER BY "createdAt" DESC LIMIT 100`,
      [EVENT, METHOD],
    );
    expect(
      newestHundred.map((row: { _id: string }): string => {
        return row._id;
      }),
    ).not.toContain(linkedTemplateId.toString());

    const template: StatusPageSubscriberNotificationTemplate | null =
      await lookUp(statusPageId);

    expect(template?.id?.toString()).toBe(linkedTemplateId.toString());
    expect(template?.templateBody).toBe(
      `<p>${linkedTemplateId.toString()}</p>`,
    );
  });

  test("never returns another project's template, even when a link points at it", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = await seedStatusPage(projectId);
    const foreignTemplateId: ObjectID = await seedTemplate(ObjectID.generate());
    await link({ projectId, statusPageId, templateId: foreignTemplateId });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("ignores a link row stamped with another project", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = await seedStatusPage(projectId);
    const otherTemplateId: ObjectID = await seedTemplate(otherProjectId);
    await link({
      projectId: otherProjectId,
      statusPageId,
      templateId: otherTemplateId,
    });

    expect(await lookUp(statusPageId)).toBeNull();
  });

  test("matches the event type and channel among the page's linked templates", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = await seedStatusPage(projectId);
    const smsTemplateId: ObjectID = await seedTemplate(projectId, {
      notificationMethod: StatusPageSubscriberNotificationMethod.SMS,
    });
    const stateChangeTemplateId: ObjectID = await seedTemplate(projectId, {
      eventType:
        StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged,
    });
    const emailTemplateId: ObjectID = await seedTemplate(projectId);
    for (const templateId of [
      smsTemplateId,
      stateChangeTemplateId,
      emailTemplateId,
    ]) {
      await link({ projectId, statusPageId, templateId });
    }

    expect((await lookUp(statusPageId))?.id?.toString()).toBe(
      emailTemplateId.toString(),
    );
  });

  test("returns null for a page without links", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = await seedStatusPage(projectId);
    await seedTemplate(projectId);

    expect(await lookUp(statusPageId)).toBeNull();
  });
});
