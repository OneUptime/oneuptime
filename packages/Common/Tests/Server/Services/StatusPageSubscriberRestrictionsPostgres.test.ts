import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { IncidentSubscriberAudienceCounts } from "../../../Types/StatusPage/IncidentSubscriberAudience";
import { SubscriberRestrictionMessages } from "../../../Types/StatusPage/SubscriberRestrictions";
import { DataSource } from "typeorm";

/*
 * WHO A STATUS PAGE'S NOTIFICATIONS REACH, AGAINST POSTGRES: Only Private
 * Users Can Subscribe and Allowed Email Domains
 * (Types/StatusPage/SubscriberRestrictions), asked in SQL
 * (Utils/StatusPage/SubscriberRestrictionSql) by the two readers of a
 * page's subscribers:
 *
 *   - getSubscribersByStatusPage, which every sender reads its subscribers
 *     through, in _id batches;
 *   - countActiveSubscribersByChannel, the "Will notify" audience summary.
 *
 * They must agree with each other, and with the rules the server refuses
 * a sign-up by. The SQL is hand-written - row-valued IN, regular
 * expressions, regexp_split_to_array over the stored list - so only a real
 * driver can judge it.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_RESTRICTIONS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SUBSCRIBER_RESTRICTIONS_TESTS=true \
 *   SUBSCRIBER_RESTRICTIONS_TEST_DATABASE_HOST=127.0.0.1 \
 *   SUBSCRIBER_RESTRICTIONS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StatusPageSubscriberRestrictionsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. The
 * tables are structure-only clones (LIKE ... INCLUDING ALL) in a uniquely
 * named schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_RESTRICTIONS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "StatusPage",
  "StatusPagePrivateUser",
  "StatusPageSubscriber",
  // The loader reads each subscriber's resources too.
  "StatusPageResource",
  "StatusPageSubscriberStatusPageResource",
];

interface SubscriberRow {
  statusPageId: ObjectID;
  email?: string | null;
  phone?: string | null;
  slack?: string | null;
  teams?: string | null;
  webhook?: string | null;
  isUnsubscribed?: boolean;
  isSubscriptionConfirmed?: boolean;
}

describePostgres(
  "who a status page's notifications reach, against Postgres",
  () => {
    const schema: string = `subscriber_restrictions_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    const pageA: ObjectID = ObjectID.generate();
    const pageB: ObjectID = ObjectID.generate();
    let database: DataSource;

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    const token: () => string = (): string => {
      return `${ObjectID.generate().toString()}${ObjectID.generate().toString()}`.replace(
        /-/g,
        "",
      );
    };

    async function setPage(
      statusPageId: ObjectID,
      settings: { limit?: boolean; domains?: string | null },
    ): Promise<void> {
      await query(
        `UPDATE "${schema}"."StatusPage" SET "limitSubscribersToPrivateUsers" = $2, "allowedSubscriberEmailDomains" = $3 WHERE "_id" = $1`,
        [
          statusPageId.toString(),
          settings.limit ?? false,
          settings.domains ?? null,
        ],
      );
    }

    async function addPrivateUser(
      statusPageId: ObjectID,
      email: string,
      options: { deleted?: boolean } = {},
    ): Promise<void> {
      await query(
        `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "email", "deletedAt", "version") VALUES ($1, $2, $3, $4, $5, 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          statusPageId.toString(),
          email,
          options.deleted ? new Date() : null,
        ],
      );
    }

    async function addSubscriber(row: SubscriberRow): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."StatusPageSubscriber"
         ("_id", "projectId", "statusPageId", "subscriberEmail", "subscriberPhone",
          "slackIncomingWebhookUrl", "microsoftTeamsIncomingWebhookUrl", "subscriberWebhook",
          "isUnsubscribed", "isSubscriptionConfirmed", "unsubscribeToken", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)`,
        [
          id,
          projectId.toString(),
          row.statusPageId.toString(),
          row.email ?? null,
          row.phone ?? null,
          row.slack ?? null,
          row.teams ?? null,
          row.webhook ?? null,
          row.isUnsubscribed ?? false,
          row.isSubscriptionConfirmed ?? true,
          token(),
        ],
      );

      return id;
    }

    // What a subscriber is told on: its one contact, as the sender reads it.
    const contactOf: (subscriber: StatusPageSubscriber) => string = (
      subscriber: StatusPageSubscriber,
    ): string => {
      return [
        subscriber.subscriberEmail?.toString(),
        subscriber.subscriberPhone?.toString(),
        subscriber.slackIncomingWebhookUrl?.toString(),
        subscriber.microsoftTeamsIncomingWebhookUrl?.toString(),
        subscriber.subscriberWebhook?.toString(),
      ]
        .filter((value: string | undefined): boolean => {
          return Boolean(value);
        })
        .join(" + ");
    };

    async function sentTo(statusPageId: ObjectID): Promise<Array<string>> {
      const subscribers: Array<StatusPageSubscriber> =
        await StatusPageSubscriberService.getSubscribersByStatusPage(
          statusPageId,
          { isRoot: true },
        );

      return subscribers.map(contactOf).sort();
    }

    async function counted(
      statusPageId: ObjectID,
    ): Promise<IncidentSubscriberAudienceCounts | undefined> {
      const counts: Dictionary<IncidentSubscriberAudienceCounts> =
        await StatusPageSubscriberService.countActiveSubscribersByChannel({
          projectId: projectId,
          statusPageIds: [statusPageId],
        });

      return counts[statusPageId.toString().toLowerCase()];
    }

    /*
     * The per-channel counts of the subscribers a send reaches: what the
     * audience summary must show for the page.
     */
    async function countsOfWhatIsSent(
      statusPageId: ObjectID,
    ): Promise<IncidentSubscriberAudienceCounts | undefined> {
      const subscribers: Array<StatusPageSubscriber> =
        await StatusPageSubscriberService.getSubscribersByStatusPage(
          statusPageId,
          { isRoot: true },
        );

      if (subscribers.length === 0) {
        return undefined;
      }

      const has: (value: unknown) => boolean = (value: unknown): boolean => {
        return Boolean(value?.toString().trim());
      };

      return {
        email: subscribers.filter((s: StatusPageSubscriber): boolean => {
          return has(s.subscriberEmail);
        }).length,
        sms: subscribers.filter((s: StatusPageSubscriber): boolean => {
          return has(s.subscriberPhone);
        }).length,
        slack: subscribers.filter((s: StatusPageSubscriber): boolean => {
          return has(s.slackIncomingWebhookUrl);
        }).length,
        microsoftTeams: subscribers.filter(
          (s: StatusPageSubscriber): boolean => {
            return has(s.microsoftTeamsIncomingWebhookUrl);
          },
        ).length,
        webhook: subscribers.filter((s: StatusPageSubscriber): boolean => {
          return has(s.subscriberWebhook);
        }).length,
      };
    }

    // One subscriber on every channel, and a few email subscribers.
    async function seedEveryKindOfSubscriber(
      statusPageId: ObjectID,
    ): Promise<void> {
      await addSubscriber({ statusPageId, email: "reader@acme.com" });
      await addSubscriber({ statusPageId, email: "Second.Reader@EU.Acme.com" });
      await addSubscriber({ statusPageId, email: "stranger@evilacme.com" });
      await addSubscriber({ statusPageId, email: "partner@acme.de" });
      await addSubscriber({ statusPageId, phone: "+14155550100" });
      await addSubscriber({
        statusPageId,
        slack: "https://hooks.slack.com/services/T/B/x",
      });
      await addSubscriber({
        statusPageId,
        teams: "https://example.webhook.office.com/x",
      });
      await addSubscriber({
        statusPageId,
        webhook: "https://hooks.example.com/1",
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SUBSCRIBER_RESTRICTIONS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["SUBSCRIBER_RESTRICTIONS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SUBSCRIBER_RESTRICTIONS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    beforeEach(async () => {
      await query(
        `TRUNCATE ${TABLES.map((table: string): string => {
          return `"${schema}"."${table}"`;
        }).join(", ")}`,
      );

      for (const [statusPageId, slug] of [
        [pageA, "page-a"],
        [pageB, "page-b"],
      ] as Array<[ObjectID, string]>) {
        await query(
          `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, $3, $3, 1)`,
          [statusPageId.toString(), projectId.toString(), slug],
        );
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the harness reads the clones, not public", async () => {
      await addSubscriber({ statusPageId: pageA, email: "reader@acme.com" });

      const rows: Array<{ count: string }> = await query(
        `SELECT COUNT(*)::text AS "count" FROM "StatusPageSubscriber" WHERE "statusPageId" = $1`,
        [pageA.toString()],
      );

      expect(rows[0]!.count).toBe("1");
    });

    test("a page with neither setting is sent to every confirmed subscriber, on every channel", async () => {
      await seedEveryKindOfSubscriber(pageA);
      await addSubscriber({
        statusPageId: pageA,
        email: "left@acme.com",
        isUnsubscribed: true,
      });
      await addSubscriber({
        statusPageId: pageA,
        email: "unconfirmed@acme.com",
        isSubscriptionConfirmed: false,
      });

      expect(await sentTo(pageA)).toEqual(
        [
          "reader@acme.com",
          "second.reader@eu.acme.com",
          "stranger@evilacme.com",
          "partner@acme.de",
          "+14155550100",
          "https://hooks.slack.com/services/T/B/x",
          "https://example.webhook.office.com/x",
          "https://hooks.example.com/1",
        ].sort(),
      );
      expect(await counted(pageA)).toEqual({
        email: 4,
        sms: 1,
        slack: 1,
        microsoftTeams: 1,
        webhook: 1,
      });
    });

    describe("Only Private Users Can Subscribe", () => {
      beforeEach(async () => {
        await setPage(pageA, { limit: true });
        await addPrivateUser(pageA, "reader@acme.com");
        // Stored with other case and spaces than the subscriber's.
        await addPrivateUser(pageA, "  SECOND.reader@eu.acme.com ");
        await addPrivateUser(pageA, "gone@acme.com", { deleted: true });
        await addPrivateUser(pageB, "elsewhere@acme.com");
      });

      test("is sent only to email subscribers at a private user's address, with no other contact", async () => {
        await seedEveryKindOfSubscriber(pageA);
        // A private user removed since - by hand or by SCIM.
        await addSubscriber({ statusPageId: pageA, email: "gone@acme.com" });
        // A private user of another page.
        await addSubscriber({
          statusPageId: pageA,
          email: "elsewhere@acme.com",
        });
        // A private user's address, with a phone number besides.
        await addSubscriber({
          statusPageId: pageA,
          email: "reader@acme.com",
          phone: "+14155550199",
        });

        expect(await sentTo(pageA)).toEqual(
          ["reader@acme.com", "second.reader@eu.acme.com"].sort(),
        );
        expect(await counted(pageA)).toEqual({
          email: 2,
          sms: 0,
          slack: 0,
          microsoftTeams: 0,
          webhook: 0,
        });
      });

      test("a page with no private user is sent to no one", async () => {
        await setPage(pageB, { limit: true });
        await query(
          `DELETE FROM "${schema}"."StatusPagePrivateUser" WHERE "statusPageId" = $1`,
          [pageB.toString()],
        );
        await seedEveryKindOfSubscriber(pageB);

        expect(await sentTo(pageB)).toEqual([]);
        expect(await counted(pageB)).toBeUndefined();
      });

      test("a private user removed is sent nothing from then on, with the subscriber left as it was", async () => {
        await addSubscriber({ statusPageId: pageA, email: "reader@acme.com" });
        expect(await sentTo(pageA)).toEqual(["reader@acme.com"]);

        await query(
          `UPDATE "${schema}"."StatusPagePrivateUser" SET "deletedAt" = now() WHERE "email" = 'reader@acme.com'`,
        );

        expect(await sentTo(pageA)).toEqual([]);

        const rows: Array<{ count: string }> = await query(
          `SELECT COUNT(*)::text AS "count" FROM "${schema}"."StatusPageSubscriber" WHERE "isUnsubscribed" = false`,
        );
        expect(rows[0]!.count).toBe("1");
      });

      test("the other page, with the setting off, is sent to everyone", async () => {
        await seedEveryKindOfSubscriber(pageB);

        expect(await sentTo(pageB)).toHaveLength(8);
      });
    });

    describe("Allowed Email Domains", () => {
      test("email subscribers at one of the domains or a subdomain; subscribers with no email are left alone", async () => {
        await setPage(pageA, { domains: "acme.com\nacme.de" });
        await seedEveryKindOfSubscriber(pageA);
        await addSubscriber({
          statusPageId: pageA,
          email: "a@acme.com.evil.com",
        });
        await addSubscriber({ statusPageId: pageA, email: "a@acme.co" });

        expect(await sentTo(pageA)).toEqual(
          [
            "reader@acme.com",
            "second.reader@eu.acme.com",
            "partner@acme.de",
            "+14155550100",
            "https://hooks.slack.com/services/T/B/x",
            "https://example.webhook.office.com/x",
            "https://hooks.example.com/1",
          ].sort(),
        );
        expect(await counted(pageA)).toEqual({
          email: 3,
          sms: 1,
          slack: 1,
          microsoftTeams: 1,
          webhook: 1,
        });
      });

      test("a list stored however it was written is read as the server reads it", async () => {
        // Upper case, an "@", commas, semicolons, blank lines and spaces.
        await setPage(pageA, { domains: " @ACME.com ,\n\n  x.org; ACME.DE  " });
        await seedEveryKindOfSubscriber(pageA);
        await addSubscriber({ statusPageId: pageA, email: "someone@x.org" });

        expect(
          (await sentTo(pageA)).filter((contact: string): boolean => {
            return contact.includes("@");
          }),
        ).toEqual(
          [
            "reader@acme.com",
            "second.reader@eu.acme.com",
            "partner@acme.de",
            "someone@x.org",
          ].sort(),
        );
      });

      test("a list of nothing but blanks allows any domain", async () => {
        await setPage(pageA, { domains: " \n \n" });
        await seedEveryKindOfSubscriber(pageA);

        expect(await sentTo(pageA)).toHaveLength(8);
      });
    });

    test("both settings: a private user's address at an allowed domain", async () => {
      await setPage(pageA, { limit: true, domains: "acme.com" });
      await addPrivateUser(pageA, "reader@acme.com");
      await addPrivateUser(pageA, "partner@acme.de");
      await seedEveryKindOfSubscriber(pageA);

      expect(await sentTo(pageA)).toEqual(["reader@acme.com"]);
      expect(await counted(pageA)).toEqual({
        email: 1,
        sms: 0,
        slack: 0,
        microsoftTeams: 0,
        webhook: 0,
      });
    });

    test("turning the settings off sends to everyone again: no subscriber was changed", async () => {
      await setPage(pageA, { limit: true, domains: "acme.com" });
      await seedEveryKindOfSubscriber(pageA);
      expect(await sentTo(pageA)).toEqual([]);

      await setPage(pageA, { limit: false, domains: null });
      expect(await sentTo(pageA)).toHaveLength(8);
    });

    test("the audience summary counts exactly whom a send reaches, setting by setting", async () => {
      await addPrivateUser(pageA, "reader@acme.com");
      await addPrivateUser(pageA, "stranger@evilacme.com");
      await seedEveryKindOfSubscriber(pageA);
      await addSubscriber({
        statusPageId: pageA,
        email: "reader@acme.com",
        webhook: "https://hooks.example.com/2",
      });

      for (const settings of [
        {},
        { limit: true },
        { domains: "acme.com" },
        { domains: "evilacme.com\nacme.de" },
        { limit: true, domains: "acme.com" },
        { limit: true, domains: "nowhere.example" },
      ]) {
        await setPage(pageA, settings);

        expect([settings, await counted(pageA)]).toEqual([
          settings,
          await countsOfWhatIsSent(pageA),
        ]);
      }
    });

    test("reading in _id batches reaches every subscriber the page takes, once, however the ones it leaves out fall", async () => {
      await setPage(pageA, { domains: "acme.com" });

      const taken: Array<string> = [];

      for (let index: number = 0; index < 7; index++) {
        const email: string = `taken-${index}@acme.com`;
        taken.push(email);
        await addSubscriber({ statusPageId: pageA, email: email });
        await addSubscriber({
          statusPageId: pageA,
          email: `left-out-${index}@elsewhere.example`,
        });
      }

      const read: Array<string> = [];
      let afterId: ObjectID | undefined = undefined;

      for (;;) {
        const batch: Array<StatusPageSubscriber> =
          await StatusPageSubscriberService.getSubscribersByStatusPage(
            pageA,
            { isRoot: true },
            { afterId: afterId, limit: 2 },
          );

        read.push(...batch.map(contactOf));

        if (batch.length < 2) {
          break;
        }

        afterId = batch[batch.length - 1]!.id!;
      }

      expect(read.sort()).toEqual(taken.sort());
    });

    describe("what a new subscriber is refused with agrees with whom a send reaches", () => {
      const statusPage: (settings: {
        limit?: boolean;
        domains?: string | null;
      }) => Promise<StatusPage> = async (settings: {
        limit?: boolean;
        domains?: string | null;
      }): Promise<StatusPage> => {
        await setPage(pageA, settings);

        const page: StatusPage = new StatusPage();
        page._id = pageA.toString();
        page.limitSubscribersToPrivateUsers = settings.limit ?? false;
        if (settings.domains !== undefined && settings.domains !== null) {
          page.allowedSubscriberEmailDomains = settings.domains;
        }

        return page;
      };

      const refusal: (
        page: StatusPage,
        email: string,
        isSignUp?: boolean,
      ) => Promise<string | null> = async (
        page: StatusPage,
        email: string,
        isSignUp: boolean = true,
      ): Promise<string | null> => {
        try {
          await StatusPageSubscriberService.assertSubscriberAllowedOnPage({
            statusPage: page,
            subscriber: { subscriberEmail: new Email(email) },
            isSignUp: isSignUp,
          });
          return null;
        } catch (err) {
          expect(err).toBeInstanceOf(BadDataException);
          return (err as Error).message;
        }
      };

      test("a private user's address is taken, in any case; anyone else's is refused", async () => {
        const page: StatusPage = await statusPage({ limit: true });
        await addPrivateUser(pageA, "reader@acme.com");
        await addPrivateUser(pageA, "gone@acme.com", { deleted: true });

        expect(await refusal(page, "reader@acme.com")).toBeNull();
        expect(await refusal(page, "READER@acme.com")).toBeNull();
        expect(await refusal(page, "gone@acme.com")).toBe(
          SubscriberRestrictionMessages.notPrivateUser,
        );
        expect(await refusal(page, "stranger@acme.com", false)).toContain(
          "stranger@acme.com",
        );
      });

      test("an address at an allowed domain is taken; any other is refused", async () => {
        const page: StatusPage = await statusPage({ domains: "acme.com" });

        expect(await refusal(page, "a@eu.acme.com")).toBeNull();
        expect(await refusal(page, "a@evilacme.com")).toBe(
          "Only email addresses at acme.com can subscribe to this status page.",
        );
      });
    });
  },
);
