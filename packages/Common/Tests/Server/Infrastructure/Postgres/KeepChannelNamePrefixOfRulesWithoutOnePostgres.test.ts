import { KeepChannelNamePrefixOfRulesWithoutOne1802250000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1802250000000-KeepChannelNamePrefixOfRulesWithoutOne";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The KeepChannelNamePrefixOfRulesWithoutOne migration against a real
 * Postgres, on real rows. A rule that creates channels and got the server's
 * old default because it had no prefix gets that default written in, in
 * every way JavaScript read "no prefix" and "creates channels"; every other
 * rule is left exactly as it was - one with a prefix of its own (spaces
 * included), one that creates no channels, a rule that is not a JSON object.
 * Run twice, the second run changes nothing; and the name each migrated rule
 * gives an incident's channel is the one it gave before.
 *
 * Opt in with RUN_POSTGRES_CHANNEL_NAME_PREFIX_TESTS=true and the normal
 * database credentials; CHANNEL_NAME_PREFIX_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * database must already be migrated: the rule table is cloned from public
 * into a uniquely named schema (so the source's rows are never read or
 * modified), and the schema is dropped afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CHANNEL_NAME_PREFIX_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "WorkspaceNotificationRule";

interface Seed {
  eventType: NotificationRuleEventType;
  notificationRule: JSONValue;
  // The rule's newChannelTemplateName after the migration; undefined: absent.
  expectedPrefix: JSONValue | undefined;
  changed: boolean;
}

// The rest of a rule, which the migration must not touch.
const REST_OF_RULE: JSONObject = {
  _type: "IncidentNotificationRule",
  filterCondition: "All",
  filters: [
    { checkOn: "Incident Title", conditionType: "Contains", value: "db" },
  ],
  shouldPostToExistingChannel: true,
  existingChannelNames: "ops",
  inviteUsersToNewChannel: ["a0000000-0000-4000-8000-000000000001"],
  shouldInviteOwnersToNewChannel: true,
};

function ruleWith(fields: JSONObject): JSONObject {
  return { ...REST_OF_RULE, ...fields };
}

const SEEDS: Record<string, Seed> = {
  "an incident rule saved without a prefix": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: ruleWith({ shouldCreateNewChannel: true }),
    expectedPrefix: "oneuptime-incident-",
    changed: true,
  },
  "an alert rule with an empty prefix": {
    eventType: NotificationRuleEventType.Alert,
    notificationRule: ruleWith({
      shouldCreateNewChannel: true,
      newChannelTemplateName: "",
    }),
    expectedPrefix: "oneuptime-alert-",
    changed: true,
  },
  "a maintenance rule with a null prefix": {
    eventType: NotificationRuleEventType.ScheduledMaintenance,
    notificationRule: ruleWith({
      shouldCreateNewChannel: true,
      newChannelTemplateName: null,
    }),
    expectedPrefix: "oneuptime-scheduled maintenance-",
    changed: true,
  },
  "a monitor rule, whose form never asked": {
    eventType: NotificationRuleEventType.Monitor,
    notificationRule: ruleWith({ shouldCreateNewChannel: true }),
    expectedPrefix: "oneuptime-monitor-",
    changed: true,
  },
  "an on-call policy rule with a prefix of false": {
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    notificationRule: ruleWith({
      shouldCreateNewChannel: true,
      newChannelTemplateName: false,
    }),
    expectedPrefix: "oneuptime-on-call duty policy-",
    changed: true,
  },
  "an incident episode rule whose switch is the string true": {
    eventType: NotificationRuleEventType.IncidentEpisode,
    notificationRule: ruleWith({ shouldCreateNewChannel: "true" }),
    expectedPrefix: "oneuptime-incident episode-",
    changed: true,
  },
  "an alert episode rule whose switch is 1 and prefix 0": {
    eventType: NotificationRuleEventType.AlertEpisode,
    notificationRule: ruleWith({
      shouldCreateNewChannel: 1,
      newChannelTemplateName: 0,
    }),
    expectedPrefix: "oneuptime-alert episode-",
    changed: true,
  },
  "a rule with a prefix of its own": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: ruleWith({
      shouldCreateNewChannel: true,
      newChannelTemplateName: "foo-",
    }),
    expectedPrefix: "foo-",
    changed: false,
  },
  "a rule whose prefix is spaces": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: ruleWith({
      shouldCreateNewChannel: true,
      newChannelTemplateName: "   ",
    }),
    expectedPrefix: "   ",
    changed: false,
  },
  "a rule that creates no channels": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: ruleWith({ shouldCreateNewChannel: false }),
    expectedPrefix: undefined,
    changed: false,
  },
  "a rule without the switch": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: ruleWith({ newChannelTemplateName: "" }),
    expectedPrefix: "",
    changed: false,
  },
  "a rule whose switch is an empty string": {
    eventType: NotificationRuleEventType.Alert,
    notificationRule: ruleWith({ shouldCreateNewChannel: "" }),
    expectedPrefix: undefined,
    changed: false,
  },
  "a rule whose switch is 0": {
    eventType: NotificationRuleEventType.Alert,
    notificationRule: ruleWith({
      shouldCreateNewChannel: 0,
      newChannelTemplateName: "",
    }),
    expectedPrefix: "",
    changed: false,
  },
  "a rule whose switch is null": {
    eventType: NotificationRuleEventType.Alert,
    notificationRule: ruleWith({ shouldCreateNewChannel: null }),
    expectedPrefix: undefined,
    changed: false,
  },
  "a rule that is a JSON string": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: "not an object",
    expectedPrefix: undefined,
    changed: false,
  },
  "a rule that is a JSON array": {
    eventType: NotificationRuleEventType.Incident,
    notificationRule: [{ shouldCreateNewChannel: true }],
    expectedPrefix: undefined,
    changed: false,
  },
};

describePostgres(
  "KeepChannelNamePrefixOfRulesWithoutOne against Postgres",
  () => {
    const schema: string = `channel_name_prefix_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let requiredColumns: Array<{ column_name: string; udt_name: string }> = [];

    const ids: Map<string, string> = new Map();
    const rulesBefore: Map<string, JSONValue> = new Map();
    const rulesAfterUp: Map<string, JSONValue> = new Map();
    const rulesAfterSecondUp: Map<string, JSONValue> = new Map();

    async function runInSchema(
      step: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      try {
        await queryRunner.query(`SET search_path TO "${schema}"`);
        await step(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    async function insertRule(seed: Seed): Promise<string> {
      const row: Record<string, unknown> = {
        _id: ObjectID.generate().toString(),
        eventType: seed.eventType,
        workspaceType: WorkspaceType.Slack,
        notificationRule: JSON.stringify(seed.notificationRule),
      };

      for (const column of requiredColumns) {
        if (column.column_name in row) {
          continue;
        }

        if (column.udt_name === "uuid") {
          row[column.column_name] = ObjectID.generate().toString();
        } else if (column.udt_name === "int4" || column.udt_name === "int8") {
          row[column.column_name] = 1;
        } else if (column.udt_name === "bool") {
          row[column.column_name] = false;
        } else if (column.udt_name === "timestamptz") {
          row[column.column_name] = new Date().toISOString();
        } else if (column.udt_name === "jsonb") {
          row[column.column_name] = "{}";
        } else {
          row[column.column_name] =
            `${column.column_name}-${ObjectID.generate().toString()}`;
        }
      }

      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${TABLE}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((column: string, index: number): string => {
            return column === "notificationRule"
              ? `$${index + 1}::jsonb`
              : `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          return row[column];
        }),
      );

      return row["_id"] as string;
    }

    async function readRules(into: Map<string, JSONValue>): Promise<void> {
      for (const label of Object.keys(SEEDS)) {
        const rows: Array<{ notificationRule: JSONValue }> =
          await database.query(
            `SELECT "notificationRule" FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
            [ids.get(label)],
          );

        expect(rows).toHaveLength(1);
        into.set(label, rows[0]!.notificationRule);
      }
    }

    async function up(): Promise<void> {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new KeepChannelNamePrefixOfRulesWithoutOne1802250000000().up(
          queryRunner,
        );
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CHANNEL_NAME_PREFIX_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["CHANNEL_NAME_PREFIX_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CHANNEL_NAME_PREFIX_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
      );

      requiredColumns = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, TABLE],
      );

      for (const [label, seed] of Object.entries(SEEDS)) {
        ids.set(label, await insertRule(seed));
      }

      await readRules(rulesBefore);
      await up();
      await readRules(rulesAfterUp);
      await up();
      await readRules(rulesAfterSecondUp);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(Object.keys(SEEDS))("%s", (label: string) => {
      const seed: Seed = SEEDS[label]!;
      const before: JSONValue = rulesBefore.get(label)!;
      const after: JSONValue = rulesAfterUp.get(label)!;

      expect(before).toEqual(seed.notificationRule);

      if (!seed.changed) {
        expect(after).toEqual(before);
        return;
      }

      // The default, written in; everything else in the rule as it was.
      expect(after).toEqual({
        ...(before as JSONObject),
        newChannelTemplateName: seed.expectedPrefix,
      });
      expect(seed.expectedPrefix).toBe(
        WorkspaceChannelName.getLegacyDefaultPrefix(seed.eventType),
      );
    });

    test("a second run changes nothing", () => {
      expect(Object.fromEntries(rulesAfterSecondUp)).toEqual(
        Object.fromEntries(rulesAfterUp),
      );
    });

    test("each migrated rule names an incident's channel as the server did before", () => {
      for (const [label, seed] of Object.entries(SEEDS)) {
        if (!seed.changed) {
          continue;
        }

        const prefix: string = WorkspaceChannelName.getPrefix(
          rulesAfterUp.get(label) as JSONObject,
        );

        const name: string = WorkspaceChannelName.getChannelName({
          workspaceType: WorkspaceType.Slack,
          prefix: prefix,
          parts: WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 42,
            numberWithPrefix: "INC-42",
          }),
        });

        // What `newChannelTemplateName || default` gave, in Slack.
        expect(name).toBe(
          `oneuptime-${seed.eventType.toLowerCase()}-inc-42`
            .toLowerCase()
            .replace(/[^a-z0-9\-_]/g, ""),
        );
      }
    });
  },
);
